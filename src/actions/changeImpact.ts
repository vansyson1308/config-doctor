// Rovo action `preview-change-impact` (F3): read-only simulation of a configuration change.
// Nothing is changed in Jira; results come from src/core/impact.ts.
import type { GroupRef, PermissionScheme, SubjectUser } from '../core/model';
import { parseChangeType, parseFieldRef, jqlMentionsField } from '../core/changeRequest';
import { candidateGroupsAndUsers, impactOfFieldDeletion, impactOfGroupRemoval, impactOfSchemeSwitch, type FieldUsage } from '../core/impact';
import { parseProjectKey } from '../core/validate';
import { jira, jiraGet, paginate, route } from '../jira/client';
import { loadGroupMembersCounted, loadProject, loadProjectScheme, loadRoleNames, namesFrom, toHolder } from '../jira/loaders';
import { getSiteIndex, loadAllSchemes } from '../jira/siteIndexLoader';
import { mapPool } from '../util/pool';
import { InvalidInputError, defineAction } from './runAction';

const BUDGET_MS = 40_000;
const MEMBER_CAP = 150;

async function findGroup(name: string): Promise<GroupRef> {
  const q = name.trim().replace(/^["']|["']$/g, '');
  const exact = await jiraGet<{ values: Array<{ groupId: string; name: string }> }>(route`/rest/api/3/group/bulk?groupName=${q}`, 'user');
  const hit = exact.values.find((g) => g.name.toLowerCase() === q.toLowerCase());
  if (hit) return { id: hit.groupId, name: hit.name };
  const picker = await jiraGet<{ groups: Array<{ name: string; groupId: string }> }>(route`/rest/api/3/groups/picker?query=${q}&maxResults=8&caseInsensitive=true`, 'user');
  if (picker.groups.length === 1) return { id: picker.groups[0]!.groupId, name: picker.groups[0]!.name };
  throw new InvalidInputError(picker.groups.length
    ? `No group named "${q}". Did you mean: ${picker.groups.map((g) => g.name).join(', ')}?`
    : `No group named "${q}".`);
}

/** Each person's groups AND product access, so product-access grants are decided, not guessed. */
async function subjectsWithGroups(members: Array<{ accountId: string; displayName: string; active: boolean }>): Promise<SubjectUser[]> {
  const r = await mapPool(members, 6, async (m) => {
    const [groups, user] = await Promise.all([
      jiraGet<Array<{ name: string; groupId: string }>>(route`/rest/api/3/user/groups?accountId=${m.accountId}`, 'user'),
      jira<{ applicationRoles?: { items?: Array<{ key: string }> } }>(route`/rest/api/3/user?accountId=${m.accountId}&expand=applicationRoles`, { as: 'user', allow: [404] }),
    ]);
    return {
      accountId: m.accountId, displayName: m.displayName, active: m.active,
      groups: groups.map((g) => ({ id: g.groupId, name: g.name })),
      ...(user?.applicationRoles?.items ? { applicationRoles: user.applicationRoles.items.map((x) => x.key) } : {}),
    };
  });
  return r.results.filter((x): x is SubjectUser => !!x);
}

async function groupRemoval(target: string, deadline: number) {
  const group = await findGroup(target);
  const [counted, index, roleNames] = await Promise.all([loadGroupMembersCounted(group, 'user', 1000), getSiteIndex('user', deadline), loadRoleNames('user')]);
  const active = counted.members.filter((m) => m.active);
  const subjects = await subjectsWithGroups(active.slice(0, MEMBER_CAP));
  const truncated = active.length > MEMBER_CAP || counted.total > counted.members.length;
  const allSchemes = Object.values(index.schemes);
  const names = namesFrom({ id: 0, name: '', grants: allSchemes.flatMap((s) => s.grants) }, roleNames, {});
  const report = impactOfGroupRemoval(index, group, subjects, names);
  const notes = [...report.notes];
  if (truncated) notes.push(`The group has ${counted.total} members (${active.length}+ active); ${subjects.length} were simulated, so the counts are a lower bound.`);
  if (!index.complete) notes.push(`Only ${index.projects.length} of ${index.projectsTotal} projects were analysed (time budget).`);
  const risk = truncated && report.risk === 'low' ? 'medium' : report.risk;
  return { ...report, risk, group: { name: group.name, members: counted.total, simulated: subjects.length }, notes };
}

function findScheme(schemes: Record<string, PermissionScheme>, ref: string): PermissionScheme {
  const t = ref.trim().replace(/^["']|["']$/g, '').toLowerCase();
  const list = Object.values(schemes);
  const hit = list.find((s) => String(s.id) === t) ?? list.find((s) => s.name.toLowerCase() === t) ?? (() => {
    const partial = list.filter((s) => s.name.toLowerCase().includes(t));
    return partial.length === 1 ? partial[0] : undefined;
  })();
  if (!hit) throw new InvalidInputError(`No permission scheme matches "${ref}". Schemes include: ${list.slice(0, 8).map((s) => s.name).join(', ')}…`);
  return hit;
}

async function schemeSwitch(target: string, newScheme: unknown) {
  const pk = parseProjectKey(target);
  if (!pk.ok) throw new InvalidInputError('For a scheme switch, target is the project key (e.g. PAY).');
  if (typeof newScheme !== 'string' || !newScheme.trim()) throw new InvalidInputError('Which permission scheme should the project switch to? (newScheme)');
  const [from, schemes, roleNames] = await Promise.all([loadProjectScheme(pk.value, 'user'), loadAllSchemes('user'), loadRoleNames('user')]);
  const to = findScheme(schemes, newScheme);
  if (to.id === from.id) throw new InvalidInputError(`${pk.value} already uses "${to.name}".`);
  const project = await loadProject(pk.value, [...from.grants, ...to.grants].map((g) => g.holder), roleNames, 'user');
  const { groups, userIds } = candidateGroupsAndUsers(project, [from, to]);
  const memberLists = await mapPool(groups, 6, (g) => loadGroupMembersCounted(g, 'user', MEMBER_CAP));
  const people = new Map<string, { accountId: string; displayName: string; active: boolean }>();
  let truncated = false;
  memberLists.results.forEach((r) => {
    if (!r) return;
    if (r.total > r.members.length) truncated = true;
    r.members.forEach((m) => people.set(m.accountId, m));
  });
  await mapPool(userIds.filter((id) => !people.has(id)), 6, async (id) => {
    const u = await jira<{ accountId: string; displayName: string; active: boolean; accountType?: string }>(route`/rest/api/3/user?accountId=${id}`, { as: 'user', allow: [404] });
    if (u && (u.accountType ?? 'atlassian') === 'atlassian') people.set(id, u);
  });
  const activePeople = [...people.values()].filter((p) => p.active);
  if (activePeople.length > MEMBER_CAP) truncated = true;
  const subjects = await subjectsWithGroups(activePeople.slice(0, MEMBER_CAP));
  const names = namesFrom({ id: 0, name: '', grants: [...from.grants, ...to.grants] }, roleNames, {});
  const report = impactOfSchemeSwitch(project, from, to, subjects, names);
  if (!truncated) return report;
  return { ...report, risk: report.risk === 'low' ? 'medium' as const : report.risk, notes: [...report.notes, `Only ${subjects.length} people were simulated (large groups); counts are a lower bound.`] };
}

async function fieldDeletion(target: string) {
  const ref = parseFieldRef(target);
  const fields = await paginate<{ id: string; name: string; screensCount?: number; contextsCount?: number; lastUsed?: { type: string; value?: string } }>(
    (s) => ref.id
      ? route`/rest/api/3/field/search?id=${ref.id}&expand=screensCount,contextsCount,lastUsed&startAt=${s}&maxResults=50`
      : route`/rest/api/3/field/search?type=custom&query=${ref.name ?? ''}&expand=screensCount,contextsCount,lastUsed&startAt=${s}&maxResults=50`,
    { as: 'user', maxItems: 200 });
  // Exact (case-sensitive) name first: near-duplicates like "Sprint Goal" / "Sprint goal" are common.
  const caseSensitive = fields.filter((f) => ref.id ? f.id === ref.id : f.name === ref.name);
  const exact = caseSensitive.length ? caseSensitive : fields.filter((f) => f.name.toLowerCase() === (ref.name ?? '').toLowerCase());
  if (exact.length !== 1) {
    throw new InvalidInputError(exact.length > 1
      ? `Several fields are named "${target}": ${exact.map((f) => f.id).join(', ')}. Use the field id.`
      : `No custom field matches "${target}".${fields.length ? ` Similar: ${fields.slice(0, 6).map((f) => `${f.name} (${f.id})`).join(', ')}` : ''}`);
  }
  const field = exact[0]!;
  const num = field.id.replace('customfield_', '');
  const [screens, filters, schemes, count, levelMembers] = await Promise.all([
    paginate<{ name: string }>((s) => route`/rest/api/3/field/${field.id}/screens?startAt=${s}&maxResults=50`, { as: 'user', maxItems: 200 }),
    paginate<{ id: string; name: string; jql?: string }>((s) => route`/rest/api/3/filter/search?expand=jql&overrideSharePermissions=true&startAt=${s}&maxResults=100`, { as: 'user', maxItems: 1000 }),
    loadAllSchemes('user'),
    jira<{ count: number }>(route`/rest/api/3/search/approximate-count`, { method: 'POST', body: { jql: `cf[${num}] is not EMPTY` }, as: 'user', allow: [400] }),
    paginate<{ issueSecurityLevelId: string; issueSecuritySchemeId: string; holder: Parameters<typeof toHolder>[0] }>(
      (s) => route`/rest/api/3/issuesecurityschemes/level/member?expand=all&startAt=${s}&maxResults=50`, { as: 'user', maxItems: 5000 }),
  ]);
  const grants = Object.values(schemes).flatMap((s) => s.grants
    .filter((g) => (g.holder.type === 'userCustomField' || g.holder.type === 'groupCustomField') && (g.holder.value ?? g.holder.parameter) === field.id)
    .map((g) => `${g.permission} in "${s.name}"`));
  const usage: FieldUsage = {
    field: { id: field.id, name: field.name },
    screens: screens.map((s) => s.name),
    contexts: field.contextsCount ?? null,
    filters: filters.filter((f) => f.jql && jqlMentionsField(f.jql, field)).map((f) => `"${f.name}" (id ${f.id})`),
    permissionGrants: grants,
    securityLevels: levelMembers
      .map((m) => ({ m, h: toHolder(m.holder) }))
      .filter(({ h }) => (h.type === 'userCustomField' || h.type === 'groupCustomField' || /^(userCF|groupCF)$/i.test(h.type)) && (h.value ?? h.parameter) === field.id)
      .map(({ m }) => `level ${m.issueSecurityLevelId} (scheme ${m.issueSecuritySchemeId})`),
    issuesWithValue: count?.count ?? null,
    lastUsed: field.lastUsed?.value?.slice(0, 10) ?? field.lastUsed?.type ?? null,
    extraNotes: [
      'The issue count is Jira\'s approximate count of issues you can see.',
      ...(filters.length >= 1000 ? ['Only the first 1000 filters were checked.'] : []),
    ],
  };
  return { ...impactOfFieldDeletion(usage), usage };
}

/** Shared by the Rovo action, MCP tool and admin page. */
export async function runChangeImpact(input: { changeType: unknown; target: unknown; newScheme?: unknown }) {
  const started = Date.now();
  const type = parseChangeType(input.changeType);
  if (!type.ok) throw new InvalidInputError(type.error);
  const target = typeof input.target === 'string' ? input.target.trim() : '';
  if (!target) throw new InvalidInputError('target is required: the group name, field name/id, or project key.');
  const result = type.value === 'remove-group' ? await groupRemoval(target, started + BUDGET_MS)
    : type.value === 'switch-permission-scheme' ? await schemeSwitch(target, input.newScheme)
      : await fieldDeletion(target);
  return { readOnly: 'Simulation only: nothing was changed in Jira.', ...result };
}

export const changeImpactAction = defineAction({
  key: 'preview-change-impact',
  async run({ payload }) {
    return runChangeImpact({ changeType: payload.changeType, target: payload.target, newScheme: payload.newScheme });
  },
  summarize: (r) => `${r.change}: risk ${r.risk}; ${r.summary}`.slice(0, 280),
});
