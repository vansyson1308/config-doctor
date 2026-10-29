// Scanner collectors: each reads one slice of site configuration (asApp — scans have no user
// context) and returns plain data for src/core/sprawl.ts. Every list endpoint is paginated.
import type { FieldInfo, GrantRef, GroupInfo, SchemeUse } from '../core/sprawl';
import type { IndexedProject } from '../core/siteIndex';
import { jira, jiraGet, paginate, route } from '../jira/client';
import { loadAllProjects, loadAllSchemes } from '../jira/siteIndexLoader';
import { loadRoleActors, loadRoleNames, toHolder } from '../jira/loaders';
import { mapPool } from '../util/pool';

const AS = 'app' as const;

export async function collectFields(): Promise<FieldInfo[]> {
  const raw = await paginate<{ id: string; name: string; screensCount?: number; contextsCount?: number; isLocked?: boolean; lastUsed?: FieldInfo['lastUsed'] }>(
    (s) => route`/rest/api/3/field/search?type=custom&expand=lastUsed,screensCount,contextsCount,isLocked&startAt=${s}&maxResults=50`, { as: AS, maxItems: 20000 });
  return raw.map((f) => ({
    id: f.id, name: f.name,
    ...(f.screensCount !== undefined ? { screensCount: f.screensCount } : {}),
    ...(f.contextsCount !== undefined ? { contextsCount: f.contextsCount } : {}),
    ...(f.isLocked !== undefined ? { isLocked: f.isLocked } : {}),
    ...(f.lastUsed ? { lastUsed: f.lastUsed } : {}),
  }));
}

export async function collectGroups(): Promise<{ groups: GroupInfo[]; productAccessGroups: string[] }> {
  const groups = await paginate<{ groupId: string; name: string }>((s) => route`/rest/api/3/group/bulk?startAt=${s}&maxResults=50`, { as: AS, maxItems: 20000 });
  const roles = await jiraGet<Array<{ key: string; groups?: string[]; defaultGroups?: string[] }>>(route`/rest/api/3/applicationrole`, AS);
  const productAccessGroups = [...new Set(roles.flatMap((r) => [...(r.groups ?? []), ...(r.defaultGroups ?? [])]))];
  return { groups: groups.map((g) => ({ id: g.groupId, name: g.name, memberCount: null })), productAccessGroups };
}

export async function countGroupMembers(groups: GroupInfo[]): Promise<GroupInfo[]> {
  const counted = await mapPool(groups, 8, async (g) => {
    const page = await jira<{ total?: number }>(route`/rest/api/3/group/member?groupId=${g.id}&includeInactiveUsers=false&maxResults=1`, { as: AS, allow: [404] });
    return { ...g, memberCount: page?.total ?? null };
  });
  return counted.results.map((g, i) => g ?? groups[i]!);
}

/** Projects with their permission scheme id and the actors of roles referenced by that scheme. */
export async function collectProjects(offset: number, limit: number, deadlineMs: number): Promise<{ projects: IndexedProject[]; total: number; done: boolean }> {
  const all = await loadAllProjects(AS);
  const slice = all.slice(offset, offset + limit);
  const [schemes, roleNames] = await Promise.all([loadAllSchemes(AS), loadRoleNames(AS)]);
  const done = await mapPool(slice, 8, async (p): Promise<IndexedProject> => {
    const ref = await jira<{ id: number }>(route`/rest/api/3/project/${p.key}/permissionscheme`, { as: AS, allow: [404, 403] });
    const scheme = ref ? schemes[String(ref.id)] : undefined;
    const roleIds = [...new Set((scheme?.grants ?? []).filter((g) => g.holder.type === 'projectRole').map((g) => g.holder.value ?? g.holder.parameter ?? ''))]
      .filter((id) => id && !/^atlassian-addons/i.test(roleNames[id] ?? ''));
    const actors = await Promise.all(roleIds.map((id) => loadRoleActors(p.key, id, roleNames[id] ?? id, AS)));
    return { id: p.id, key: p.key, name: p.name, style: p.style ?? 'classic', schemeId: ref?.id ?? null, roles: Object.fromEntries(actors.map((a) => [a.id, a])), securityLevels: [] };
  }, deadlineMs);
  const projects = done.results.filter((x): x is IndexedProject => !!x);
  return { projects, total: all.length, done: offset + limit >= all.length && !done.timedOut };
}

export async function collectPermissionSchemes(projects: IndexedProject[]): Promise<{ schemes: SchemeUse[]; grants: GrantRef[]; schemeGroupRefs: Array<{ group: string; ref: string }> }> {
  const schemes = await loadAllSchemes(AS);
  const uses: SchemeUse[] = Object.values(schemes).map((s) => ({ id: String(s.id), name: s.name, projectKeys: projects.filter((p) => p.schemeId === s.id).map((p) => p.key) }));
  const grants: GrantRef[] = [];
  const refs: Array<{ group: string; ref: string }> = [];
  for (const s of Object.values(schemes)) {
    for (const g of s.grants) {
      if (g.holder.type !== 'group') continue;
      grants.push({ schemeId: String(s.id), schemeName: s.name, permission: g.permission, ...(g.holder.value ? { groupId: g.holder.value } : {}), ...(g.holder.parameter ? { groupName: g.holder.parameter } : {}) });
      refs.push({ group: g.holder.value ?? g.holder.parameter ?? '', ref: `${g.permission} in permission scheme "${s.name}"` });
    }
  }
  return { schemes: uses, grants, schemeGroupRefs: refs };
}

export async function collectSecuritySchemes(): Promise<{ schemes: SchemeUse[]; groupRefs: Array<{ group: string; ref: string }> }> {
  const list = await jiraGet<{ issueSecuritySchemes: Array<{ id: number; name: string }> }>(route`/rest/api/3/issuesecurityschemes`, AS);
  const mapping = await paginate<{ issueSecuritySchemeId: string; projectId: string }>((s) => route`/rest/api/3/issuesecurityschemes/project?startAt=${s}&maxResults=50`, { as: AS });
  const members = await paginate<{ issueSecuritySchemeId: string; issueSecurityLevelId: string; holder: Parameters<typeof toHolder>[0] }>(
    (s) => route`/rest/api/3/issuesecurityschemes/level/member?expand=all&startAt=${s}&maxResults=50`, { as: AS, maxItems: 20000 });
  const groupRefs = members.map((m) => ({ m, h: toHolder(m.holder) })).filter(({ h }) => h.type === 'group')
    .map(({ m, h }) => ({ group: h.value ?? h.parameter ?? '', ref: `member of issue security level ${m.issueSecurityLevelId} (scheme ${list.issueSecuritySchemes.find((s) => String(s.id) === String(m.issueSecuritySchemeId))?.name ?? m.issueSecuritySchemeId})` }));
  const schemes = list.issueSecuritySchemes.map((s) => ({ id: String(s.id), name: s.name, projectKeys: mapping.filter((m) => String(m.issueSecuritySchemeId) === String(s.id)).map((m) => `project ${m.projectId}`) }));
  return { schemes, groupRefs };
}

export async function collectWorkflowSchemes(projectIds: string[]): Promise<SchemeUse[]> {
  const schemes = await paginate<{ id: number; name: string }>((s) => route`/rest/api/3/workflowscheme?startAt=${s}&maxResults=50`, { as: AS });
  const used = new Map<string, string[]>();
  for (let i = 0; i < projectIds.length; i += 50) {
    const batch = projectIds.slice(i, i + 50);
    const query = new URLSearchParams(batch.map((id): [string, string] => ['projectId', id]));
    const r = await jira<{ values: Array<{ projectIds: string[]; workflowScheme: { id?: number; name: string } }> }>(
      route`/rest/api/3/workflowscheme/project?${query}`, { as: AS, allow: [400] });
    for (const v of r?.values ?? []) {
      const key = v.workflowScheme.id !== undefined ? String(v.workflowScheme.id) : v.workflowScheme.name;
      used.set(key, [...(used.get(key) ?? []), ...v.projectIds]);
    }
  }
  return schemes.map((s) => ({ id: String(s.id), name: s.name, projectKeys: used.get(String(s.id)) ?? used.get(s.name) ?? [] }));
}

export async function collectWorkflows(): Promise<{ total: number; inactive: Array<{ id: string; name: string }> }> {
  const first = await jiraGet<{ total?: number }>(route`/rest/api/3/workflows/search?maxResults=1`, AS);
  const inactive = await paginate<{ id: string; name: string; scope?: { type: string } }>((s) => route`/rest/api/3/workflows/search?isActive=false&startAt=${s}&maxResults=50`, { as: AS, maxItems: 20000 });
  return { total: first.total ?? inactive.length, inactive: inactive.map((w) => ({ id: w.id, name: w.name })) };
}

export async function collectScreens(): Promise<{ total: number; unused: Array<{ id: string; name: string }> }> {
  const screens = await paginate<{ id: number; name: string }>((s) => route`/rest/api/3/screens?startAt=${s}&maxResults=100`, { as: AS, maxItems: 20000 });
  const schemes = await paginate<{ screens?: Record<string, number> }>((s) => route`/rest/api/3/screenscheme?startAt=${s}&maxResults=100`, { as: AS, maxItems: 20000 });
  const used = new Set(schemes.flatMap((s) => Object.values(s.screens ?? {}).map(String)));
  return { total: screens.length, unused: screens.filter((s) => !used.has(String(s.id))).map((s) => ({ id: String(s.id), name: s.name })) };
}

