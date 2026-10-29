// Builds the site-wide SiteIndex (projects → scheme, role actors, security levels) used for blast
// radius and change-impact. Bounded concurrency + deadline; result says whether it is complete.
import type { Holder, PermissionScheme, SecurityLevel } from '../core/model';
import type { IndexedProject, SiteIndex } from '../core/siteIndex';
import { cacheGet, cacheSet } from '../storage/cache';
import { mapPool } from '../util/pool';
import { jira, jiraGet, paginate, route, type Principal } from './client';
import { loadRoleActors, loadRoleNames, toHolder } from './loaders';

export interface LoadedIndex extends SiteIndex {
  complete: boolean;
  projectsTotal: number;
  readAs: Principal;
}

interface RawProject { id: string; key: string; name: string; style?: string }
interface RawScheme { id: number; name: string; permissions?: Array<{ id?: number; permission: string; holder: { type: string; parameter?: string; value?: string; group?: { name: string; groupId: string } } }> }

const CACHE_KEY = 'siteIndex';
const SYSTEM_ROLE = /^atlassian-addons/i;

export async function loadAllSchemes(as: Principal): Promise<Record<string, PermissionScheme>> {
  const all = await jiraGet<{ permissionSchemes: RawScheme[] }>(route`/rest/api/3/permissionscheme?expand=permissions,group`, as);
  return Object.fromEntries(all.permissionSchemes.map((s) => [String(s.id), {
    id: s.id, name: s.name,
    grants: (s.permissions ?? []).map((g) => ({ ...(g.id !== undefined ? { id: g.id } : {}), permission: g.permission, holder: toHolder(g.holder) })),
  }]));
}

export async function loadAllProjects(as: Principal): Promise<RawProject[]> {
  return paginate<RawProject>((startAt) => route`/rest/api/3/project/search?startAt=${startAt}&maxResults=50`, { as, maxItems: 2000 });
}

async function securityLevelsFor(projectKey: string, as: Principal, memo: Map<string, Promise<SecurityLevel[]>>): Promise<SecurityLevel[]> {
  const scheme = await jira<{ id: number; name: string }>(route`/rest/api/3/project/${projectKey}/issuesecuritylevelscheme`, { as, allow: [404, 403] });
  if (!scheme) return [];
  const key = String(scheme.id);
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      const levels = await paginate<{ id: string; name: string }>((s) => route`/rest/api/3/issuesecurityschemes/level?schemeId=${key}&startAt=${s}&maxResults=50`, { as });
      const members = await paginate<{ issueSecurityLevelId: string; holder: Parameters<typeof toHolder>[0] }>((s) => route`/rest/api/3/issuesecurityschemes/level/member?schemeId=${key}&expand=all&startAt=${s}&maxResults=50`, { as });
      return levels.map((l) => ({
        id: l.id, name: l.name, schemeId: key, schemeName: scheme.name,
        members: members.filter((m) => m.issueSecurityLevelId === l.id).map((m) => toHolder(m.holder)),
      }));
    })());
  }
  return memo.get(key)!;
}

function roleIds(holders: Holder[], roleNames: Record<string, string>): string[] {
  return [...new Set(holders.filter((h) => h.type === 'projectRole').map((h) => h.value ?? h.parameter ?? ''))]
    .filter((id) => id && !SYSTEM_ROLE.test(roleNames[id] ?? ''));
}

export async function buildSiteIndex(as: Principal, deadlineMs: number): Promise<LoadedIndex> {
  const [projects, schemes, roleNames, appRoles] = await Promise.all([
    loadAllProjects(as), loadAllSchemes(as), loadRoleNames(as),
    jiraGet<Array<{ groups?: string[]; defaultGroups?: string[] }>>(route`/rest/api/3/applicationrole`, as),
  ]);
  const secMemo = new Map<string, Promise<SecurityLevel[]>>();
  const done = await mapPool(projects, 8, async (p): Promise<IndexedProject> => {
    const ref = await jira<{ id: number }>(route`/rest/api/3/project/${p.key}/permissionscheme`, { as, allow: [404, 403] });
    const scheme = ref ? schemes[String(ref.id)] : undefined;
    const levels = await securityLevelsFor(p.key, as, secMemo);
    const holders = [...(scheme?.grants.map((g) => g.holder) ?? []), ...levels.flatMap((l) => l.members)];
    const actors = await Promise.all(roleIds(holders, roleNames).map((id) => loadRoleActors(p.key, id, roleNames[id] ?? id, as)));
    return { key: p.key, name: p.name, style: p.style ?? 'classic', schemeId: ref?.id ?? null, roles: Object.fromEntries(actors.map((a) => [a.id, a])), securityLevels: levels };
  }, deadlineMs);
  const indexed = done.results.filter((x): x is IndexedProject => !!x);
  return {
    builtAt: new Date().toISOString(),
    projects: indexed,
    schemes,
    groupSizes: {},
    productAccessGroups: [...new Set(appRoles.flatMap((r) => [...(r.groups ?? []), ...(r.defaultGroups ?? [])]))],
    complete: !done.timedOut && indexed.length === projects.length,
    projectsTotal: projects.length,
    readAs: as,
  };
}

/** Cached index (≤ maxAgeMinutes old) or a fresh build within the deadline. */
export async function getSiteIndex(as: Principal, deadlineMs: number, maxAgeMinutes = 60): Promise<LoadedIndex> {
  const cached = await cacheGet<LoadedIndex>(CACHE_KEY);
  // An index built by the app (weekly scan) may miss projects the admin can see: reuse same-principal only.
  if (cached && cached.complete && cached.readAs === as && Date.now() - Date.parse(cached.builtAt) < maxAgeMinutes * 60_000) return cached;
  const fresh = await buildSiteIndex(as, deadlineMs);
  if (fresh.complete) await cacheSet(CACHE_KEY, fresh, maxAgeMinutes);
  return fresh;
}

export async function storeSiteIndex(index: LoadedIndex, ttlMinutes: number): Promise<void> {
  if (index.complete) await cacheSet(CACHE_KEY, index, ttlMinutes);
}
