// Loads Jira configuration into the pure core model (src/core/model.ts).
// Every call goes through client.ts (backoff + pagination). Interactive callers pass as='user'.
import type { Route } from '@forge/api';
import type { Grant, GroupRef, Holder, IssueModel, NameIndex, PermissionScheme, ProjectModel, RoleActors, SecurityLevel, SubjectUser } from '../core/model';
import { looksLikeAccountId } from '../core/validate';
import type { Member } from '../core/whoCanSee';
import { mapPool } from '../util/pool';
import { JiraError, jira, jiraGet, paginate, route, type Principal } from './client';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

interface RawUser { accountId: string; displayName: string; active: boolean; accountType?: string; applicationRoles?: { items?: Array<{ key: string }> } }
interface RawGroup { name: string; groupId: string }
interface RawHolder { type: string; parameter?: string; value?: string; group?: { name: string; groupId: string } }
interface RawGrant { id?: number; permission: string; holder: RawHolder }
interface RawScheme { id: number; name: string; permissions?: RawGrant[] }
interface RawRoleActor { type: string; actorUser?: { accountId: string }; actorGroup?: { name: string; groupId: string } }
interface RawProject { id: string; key: string; name: string; style?: string; simplified?: boolean; lead?: { accountId: string } }
interface RawIssue { id: string; key: string; fields: Record<string, unknown> & { project?: { key: string }; reporter?: RawUser | null; assignee?: RawUser | null; security?: { id: string; name: string } | null } }

/** Normalises holders: security-level reads use the same shape as permission grants. */
export function toHolder(h: RawHolder): Holder {
  const type = h.type === 'projectrole' ? 'projectRole' : h.type;
  if (type === 'group' && h.group) return { type, parameter: h.group.name, value: h.group.groupId };
  return { type, ...(h.parameter !== undefined ? { parameter: h.parameter } : {}), ...(h.value !== undefined ? { value: h.value } : {}) };
}

// ---------- users ----------

export interface UserMatch { user: SubjectUser; matchedBy: 'accountId' | 'displayName' | 'search' }

/**
 * Resolves free text (name, email fragment or accountId) to exactly one active person.
 * Ambiguity is an error listing the candidates, never a guess.
 */
export async function resolveUser(query: string, as: Principal): Promise<UserMatch> {
  const q = query.trim().replace(/^@/, '');
  if (looksLikeAccountId(q)) {
    const u = await jira<RawUser>(route`/rest/api/3/user?accountId=${q}&expand=applicationRoles`, { as, allow: [404] });
    if (u) return { user: await withGroups(u, as), matchedBy: 'accountId' };
  }
  const found = (await jiraGet<RawUser[]>(route`/rest/api/3/user/search?query=${q}&maxResults=20`, as))
    .filter((u) => u.accountType === 'atlassian' || u.accountType === undefined);
  const exact = found.filter((u) => u.displayName.toLowerCase() === q.toLowerCase());
  const pool = exact.length > 0 ? exact : found;
  if (pool.length === 0) throw new NotFoundError(`No Jira user matches "${q}". Check the spelling or use their account ID.`);
  if (pool.length > 1) {
    throw new NotFoundError(`"${q}" matches ${pool.length} people: ${pool.slice(0, 6).map((u) => u.displayName).join(', ')}. Which one? (Use the full name or account ID.)`);
  }
  const full = await jiraGet<RawUser>(route`/rest/api/3/user?accountId=${pool[0]!.accountId}&expand=applicationRoles`, as);
  return { user: await withGroups(full, as), matchedBy: exact.length ? 'displayName' : 'search' };
}

async function withGroups(u: RawUser, as: Principal): Promise<SubjectUser> {
  const groups = await jiraGet<RawGroup[]>(route`/rest/api/3/user/groups?accountId=${u.accountId}`, as);
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    active: u.active,
    groups: groups.map((g) => ({ id: g.groupId, name: g.name })),
    ...(u.applicationRoles?.items ? { applicationRoles: u.applicationRoles.items.map((r) => r.key) } : {}),
  };
}

// ---------- projects, schemes, roles ----------

export async function loadProjectScheme(projectKey: string, as: Principal): Promise<PermissionScheme> {
  const s = await jiraGet<RawScheme>(route`/rest/api/3/project/${projectKey}/permissionscheme?expand=permissions,group`, as);
  return { id: s.id, name: s.name, grants: (s.permissions ?? []).map((g): Grant => ({ ...(g.id !== undefined ? { id: g.id } : {}), permission: g.permission, holder: toHolder(g.holder) })) };
}

export async function loadRoleActors(projectKey: string, roleId: string, roleName: string, as: Principal): Promise<RoleActors> {
  const r = await jira<{ actors?: RawRoleActor[] }>(route`/rest/api/3/project/${projectKey}/role/${roleId}`, { as, allow: [404] });
  const actors = r?.actors ?? [];
  return {
    id: roleId,
    name: roleName,
    userIds: actors.filter((a) => a.actorUser).map((a) => a.actorUser!.accountId),
    groups: actors.filter((a) => a.actorGroup).map((a) => ({ id: a.actorGroup!.groupId, name: a.actorGroup!.name })),
  };
}

export async function loadRoleNames(as: Principal): Promise<Record<string, string>> {
  const roles = await jiraGet<Array<{ id: number; name: string }>>(route`/rest/api/3/role`, as);
  return Object.fromEntries(roles.map((r) => [String(r.id), r.name]));
}

function roleIdsIn(holders: Holder[]): string[] {
  return [...new Set(holders.filter((h) => h.type === 'projectRole').map((h) => h.value ?? h.parameter ?? ''))].filter(Boolean);
}

export async function loadProject(projectKey: string, holders: Holder[], roleNames: Record<string, string>, as: Principal): Promise<ProjectModel> {
  const p = await jira<RawProject>(route`/rest/api/3/project/${projectKey}?expand=lead`, { as, allow: [404] });
  if (!p) throw new NotFoundError(`Project ${projectKey} does not exist or is not visible.`);
  const ids = roleIdsIn(holders);
  const loaded = await mapPool(ids, 6, (id) => loadRoleActors(p.key, id, roleNames[id] ?? id, as));
  const roles: Record<string, RoleActors> = {};
  loaded.results.forEach((r) => { if (r) roles[r.id] = r; });
  return { id: p.id, key: p.key, name: p.name, style: p.style ?? (p.simplified ? 'next-gen' : 'classic'), ...(p.lead ? { leadAccountId: p.lead.accountId } : {}), roles };
}

// ---------- issues & security ----------

export async function loadSecurityLevel(levelId: string, levelName: string, as: Principal): Promise<SecurityLevel> {
  const members = await paginate<{ issueSecuritySchemeId: string; holder: RawHolder }>((startAt) => route`/rest/api/3/issuesecurityschemes/level/member?levelId=${levelId}&expand=all&startAt=${startAt}&maxResults=50`, { as });
  const schemeId = members[0]?.issueSecuritySchemeId;
  let schemeName: string | undefined;
  if (schemeId) schemeName = (await jira<{ name: string }>(route`/rest/api/3/issuesecurityschemes/${schemeId}`, { as, allow: [404] }))?.name;
  return { id: levelId, name: levelName, ...(schemeId ? { schemeId } : {}), ...(schemeName ? { schemeName } : {}), members: members.map((m) => toHolder(m.holder)) };
}

function fieldIdsIn(holders: Holder[]): string[] {
  return [...new Set(holders.filter((h) => h.type === 'userCustomField' || h.type === 'groupCustomField').map((h) => h.value ?? h.parameter ?? ''))].filter(Boolean);
}

function readFieldValue(v: unknown): { userIds: string[]; groupNames: string[] } {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const userIds: string[] = [];
  const groupNames: string[] = [];
  for (const x of arr) {
    if (x && typeof x === 'object') {
      const o = x as { accountId?: string; name?: string };
      if (o.accountId) userIds.push(o.accountId);
      else if (o.name) groupNames.push(o.name);
    }
  }
  return { userIds, groupNames };
}

/**
 * Loads an issue. An admin may be excluded by an issue security level, so if the user cannot see the
 * issue we retry as the app before reporting it as not found.
 */
export async function loadIssue(issueKey: string, schemeHolders: Holder[], as: Principal): Promise<{ issue: IssueModel; projectKey: string; readAs: Principal }> {
  const fieldIds = fieldIdsIn(schemeHolders);
  const fields = ['project', 'reporter', 'assignee', 'security', ...fieldIds].join(',');
  let raw: RawIssue | null = null;
  let readAs: Principal = as;
  // Jira Cloud occasionally answers a stale 404 right after permission changes (observed on the demo
  // site), so the user read is tried twice before falling back to the app's access.
  const attempts: Principal[] = as === 'user' ? ['user', 'user', 'app'] : ['app'];
  for (const [i, who] of attempts.entries()) {
    if (i === 1) await new Promise((r) => setTimeout(r, 800));
    raw = await jira<RawIssue>(route`/rest/api/3/issue/${issueKey}?fields=${fields}`, { as: who, allow: [404, 403] });
    if (raw) { readAs = who; break; }
  }
  if (!raw) throw new NotFoundError(`Issue ${issueKey} does not exist, or neither you nor the app can see it (it may be protected by an issue security level).`);
  const f = raw.fields;
  const fieldValues = Object.fromEntries(fieldIds.map((id) => [id, readFieldValue(f[id])]));
  const security = f.security ? await loadSecurityLevel(f.security.id, f.security.name, as) : undefined;
  const issue: IssueModel = {
    key: raw.key, id: raw.id,
    ...(f.reporter?.accountId ? { reporterId: f.reporter.accountId } : {}),
    ...(f.assignee?.accountId ? { assigneeId: f.assignee.accountId } : {}),
    ...(security ? { securityLevel: security } : {}),
    ...(fieldIds.length ? { fieldValues } : {}),
  };
  return { issue, projectKey: f.project?.key ?? issueKey.split('-')[0]!, readAs };
}

export async function loadFieldNames(ids: string[], as: Principal): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const fields = await jiraGet<Array<{ id: string; name: string }>>(route`/rest/api/3/field`, as);
  return Object.fromEntries(fields.filter((f) => ids.includes(f.id)).map((f) => [f.id, f.name]));
}

export function namesFrom(scheme: PermissionScheme, roleNames: Record<string, string>, fields: Record<string, string>, extraHolders: Holder[] = []): NameIndex {
  const groupsById: Record<string, string> = {};
  for (const h of [...scheme.grants.map((g) => g.holder), ...extraHolders]) {
    if (h.type === 'group' && h.value && h.parameter) groupsById[h.value] = h.parameter;
  }
  return { roles: roleNames, groupsById, fields };
}

// ---------- ground truth ----------

interface BulkPermissionGrants { projectPermissions?: Array<{ permission: string; issues: number[]; projects: number[] }> }

/**
 * One call to Jira's own permission check for another user (asUser: the invoking admin has
 * Administer Jira). Returns undefined if the check is unavailable.
 */
export async function jiraPermissionCheck(accountId: string, permission: string, target: { issueId?: string; projectId: string }): Promise<boolean | undefined> {
  try {
    const body = {
      accountId,
      projectPermissions: [{
        permissions: [permission],
        projects: [Number(target.projectId)],
        ...(target.issueId ? { issues: [Number(target.issueId)] } : {}),
      }],
    };
    const r = await jira<BulkPermissionGrants>(route`/rest/api/3/permissions/check`, { method: 'POST', body, as: 'user' });
    const entry = r?.projectPermissions?.find((p) => p.permission === permission);
    if (!entry) return false;
    return target.issueId ? entry.issues.includes(Number(target.issueId)) : entry.projects.includes(Number(target.projectId));
  } catch (err) {
    if (err instanceof JiraError) return undefined;
    throw err;
  }
}

export interface JiraVerdict { says: boolean | undefined; checks: Array<boolean | undefined> }

/**
 * Jira Cloud answers permission checks with eventual consistency (observed 2026-10-30: the same
 * check flipped between calls minutes after a group change). We ask up to three times and take the
 * majority; every raw answer is returned so nothing is hidden.
 */
export async function jiraPermissionVerdict(accountId: string, permission: string, target: { issueId?: string; projectId: string }, expected?: boolean): Promise<JiraVerdict> {
  const checks: Array<boolean | undefined> = [await jiraPermissionCheck(accountId, permission, target)];
  if (checks[0] === undefined) return { says: undefined, checks };
  if (expected === undefined || checks[0] === expected) return { says: checks[0], checks };
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    checks.push(await jiraPermissionCheck(accountId, permission, target));
    const yes = checks.filter((c) => c === true).length;
    const no = checks.filter((c) => c === false).length;
    if (yes >= 2) return { says: true, checks };
    if (no >= 2) return { says: false, checks };
  }
  return { says: checks[0], checks };
}

interface RawSearchUser { accountId: string; displayName: string; active: boolean; accountType?: string }

/**
 * Candidates who hold Browse at project level. NOTE: user/permission/search ignores issue security
 * levels (verified 2026-10-30: it listed users that permissions/check denies for PAY-3), so it is
 * only used to discover candidates, never as the answer.
 */
export async function projectBrowseCandidates(projectKey: string, cap = 200): Promise<Member[]> {
  try {
    const users: Member[] = [];
    for (let startAt = 0; startAt < cap; startAt += 100) {
      const page = await jiraGet<RawSearchUser[]>(route`/rest/api/3/user/permission/search?permissions=BROWSE_PROJECTS&projectKey=${projectKey}&startAt=${startAt}&maxResults=100`, 'user');
      users.push(...page.filter((u) => u.accountType === 'atlassian').map((u) => ({ accountId: u.accountId, displayName: u.displayName, active: u.active })));
      if (page.length < 100) break;
    }
    return users;
  } catch (err) {
    if (err instanceof JiraError) return [];
    throw err;
  }
}

/**
 * Jira's per-user answer for each candidate (bounded); used as ground truth for who-can-see.
 * Answers that differ from the model's expectation are re-checked (majority of 3), as in explain-access.
 */
export async function jiraViewersAmong(candidates: Member[], target: { issueId: string; projectId: string }, expectedViewers: Set<string>, cap = 60): Promise<{ users: Member[]; truncated: boolean } | undefined> {
  const active = candidates.filter((c) => c.active);
  const list = active.slice(0, cap);
  const answers = await mapPool(list, 6, async (c) => (await jiraPermissionVerdict(c.accountId, 'BROWSE_PROJECTS', target, expectedViewers.has(c.accountId))).says);
  if (answers.results.some((a) => a === undefined)) return undefined;
  return { users: list.filter((_, i) => answers.results[i] === true), truncated: active.length > cap };
}

export async function loadGroupMembers(group: GroupRef, as: Principal, cap = 500): Promise<Member[]> {
  const build = (startAt: number): Route => route`/rest/api/3/group/member?groupId=${group.id}&includeInactiveUsers=true&startAt=${startAt}&maxResults=50`;
  const raw = await paginate<RawUser>(build, { as, maxItems: cap });
  return raw.filter((u) => u.accountType === 'atlassian' || u.accountType === undefined).map((u) => ({ accountId: u.accountId, displayName: u.displayName, active: u.active }));
}
