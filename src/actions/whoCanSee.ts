// Rovo action `list-who-can-see`: "Who can see PAY-3 and why?"
import type { GroupRef, Holder } from '../core/model';
import { whoCanSee, type Member } from '../core/whoCanSee';
import { jiraGet, route } from '../jira/client';
import { NotFoundError, jiraViewersAmong, loadGroupMembers, projectBrowseCandidates, loadIssue, loadProject, loadProjectScheme, loadRoleNames, namesFrom } from '../jira/loaders';
import { mapPool } from '../util/pool';
import { parseTarget } from './inputs';
import { InvalidInputError, defineAction } from './runAction';

function groupsIn(holders: Holder[]): GroupRef[] {
  return holders.filter((h) => h.type === 'group').map((h) => ({ id: h.value ?? h.parameter ?? '', name: h.parameter ?? h.value ?? '' }));
}

export async function runWhoCanSee(issueKey: string) {
  const roleNames = await loadRoleNames('user');
  const projectKey = issueKey.split('-')[0]!;
  const scheme = await loadProjectScheme(projectKey, 'user');
  const browseHolders = scheme.grants.filter((g) => g.permission === 'BROWSE_PROJECTS').map((g) => g.holder);
  const { issue, readAs } = await loadIssue(issueKey, browseHolders, 'user');
  const levelHolders = issue.securityLevel?.members ?? [];
  const project = await loadProject(projectKey, [...browseHolders, ...levelHolders], roleNames, 'user');

  const roleGroups = Object.values(project.roles).flatMap((r) => r.groups);
  const groups = new Map<string, GroupRef>();
  for (const g of [...groupsIn(browseHolders), ...groupsIn(levelHolders), ...roleGroups]) if (g.id) groups.set(g.id, g);
  const loaded = await mapPool([...groups.values()], 6, async (g) => [g.id, await loadGroupMembers(g, 'user')] as const);
  const groupMembers: Record<string, Member[]> = Object.fromEntries(loaded.results.filter((x): x is readonly [string, Member[]] => !!x));
  // Index members by group name too: security levels can reference groups by name.
  for (const g of groups.values()) if (groupMembers[g.id]) groupMembers[g.name] = groupMembers[g.id]!;

  const ids = [project.leadAccountId, issue.reporterId, issue.assigneeId, ...Object.values(project.roles).flatMap((r) => r.userIds),
    ...browseHolders.filter((h) => h.type === 'user').map((h) => h.value ?? h.parameter)].filter((x): x is string => !!x);
  const people: Record<string, Member> = {};
  await mapPool([...new Set(ids)], 6, async (id) => {
    const u = await jiraGet<{ accountId: string; displayName: string; active: boolean; accountType?: string }>(route`/rest/api/3/user?accountId=${id}`, 'user');
    // Only people: Forge/Connect app accounts (accountType "app") are not viewers.
    if (u.accountType === undefined || u.accountType === 'atlassian') people[id] = { accountId: u.accountId, displayName: u.displayName, active: u.active };
  });

  // Ground truth: Jira's per-user permission check for every candidate we know of (our expansion plus
  // everyone Jira reports with project-level Browse). See loaders.projectBrowseCandidates for why the
  // search endpoint alone is not trusted.
  const candidates = new Map<string, Member>();
  for (const m of [...Object.values(groupMembers).flat(), ...Object.values(people), ...(await projectBrowseCandidates(project.key))]) candidates.set(m.accountId, m);
  const base = { project, scheme, issue, names: namesFrom(scheme, roleNames, {}, levelHolders), groupMembers, people };
  const modelOnly = whoCanSee(base);
  const jira = await jiraViewersAmong([...candidates.values()], { issueId: issue.id, projectId: project.id }, new Set(modelOnly.viewers.map((v) => v.accountId)));
  const result = jira ? whoCanSee({ ...base, jiraUsers: jira.users, jiraListTruncated: jira.truncated }) : modelOnly;
  return readAs === 'app' ? { ...result, notes: [...result.notes, 'You cannot see this issue yourself; it was read with the app\'s access.'] } : result;
}

export const whoCanSeeAction = defineAction({
  key: 'list-who-can-see',
  async run({ payload }) {
    const t = parseTarget(payload);
    if (t.kind !== 'issue') throw new InvalidInputError('Give an issue key such as PAY-3 (project-wide viewer lists are not supported yet).');
    try {
      return await runWhoCanSee(t.issueKey);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidInputError(err.message);
      throw err;
    }
  },
  summarize: (r) => `${r.issue.key}: ${r.viewerCount} viewers, jira ${r.groundTruth.check}`,
});
