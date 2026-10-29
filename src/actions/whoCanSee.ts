// Rovo action `list-who-can-see`: "Who can see PAY-3 and why?"
import type { GroupRef, Holder } from '../core/model';
import { whoCanSee, type Member } from '../core/whoCanSee';
import { jiraGet, route } from '../jira/client';
import { NotFoundError, jiraViewersAmong, loadGroupMembersCounted, projectBrowseCandidates, loadIssue, loadProject, loadProjectScheme, loadRoleNames, namesFrom } from '../jira/loaders';
import { jira } from '../jira/client';

const BUDGET_MS = 42_000;
const GROUP_CAP = 500;
import { mapPool } from '../util/pool';
import { parseTarget } from './inputs';
import { InvalidInputError, defineAction } from './runAction';

function groupsIn(holders: Holder[]): GroupRef[] {
  return holders.filter((h) => h.type === 'group').map((h) => ({ id: h.value ?? h.parameter ?? '', name: h.parameter ?? h.value ?? '' }));
}

export async function runWhoCanSee(issueKey: string) {
  const started = Date.now();
  const roleNames = await loadRoleNames('user');
  let projectKey = issueKey.split('-')[0]!;
  let scheme = await loadProjectScheme(projectKey, 'user');
  let browseHolders = scheme.grants.filter((g) => g.permission === 'BROWSE_PROJECTS').map((g) => g.holder);
  let loaded = await loadIssue(issueKey, browseHolders, 'user');
  if (loaded.projectKey !== projectKey) {
    // Moved issue: the key's prefix is the old project.
    projectKey = loaded.projectKey;
    scheme = await loadProjectScheme(projectKey, 'user');
    browseHolders = scheme.grants.filter((g) => g.permission === 'BROWSE_PROJECTS').map((g) => g.holder);
    loaded = await loadIssue(loaded.issue.key, browseHolders, 'user');
  }
  const { issue, readAs } = loaded;
  const levelHolders = issue.securityLevel?.members ?? [];
  const project = await loadProject(projectKey, [...browseHolders, ...levelHolders], roleNames, 'user');

  const roleGroups = Object.values(project.roles).flatMap((r) => r.groups);
  const groups = new Map<string, GroupRef>();
  for (const g of [...groupsIn(browseHolders), ...groupsIn(levelHolders), ...roleGroups]) if (g.id) groups.set(g.id, g);
  const capNotes: string[] = [];
  const loadedGroups = await mapPool([...groups.values()], 6, async (g) => {
    const r = await loadGroupMembersCounted(g, 'user', GROUP_CAP);
    if (r.total > r.members.length) capNotes.push(`Group ${g.name} has ${r.total} members; the first ${r.members.length} were expanded.`);
    return [g.id, r.members] as const;
  });
  const groupMembers: Record<string, Member[]> = Object.fromEntries(loadedGroups.results.filter((x): x is readonly [string, Member[]] => !!x));
  // Index members by group name too: security levels can reference groups by name.
  for (const g of groups.values()) if (groupMembers[g.id]) groupMembers[g.name] = groupMembers[g.id]!;

  const ids = [project.leadAccountId, issue.reporterId, issue.assigneeId, ...Object.values(project.roles).flatMap((r) => r.userIds),
    ...browseHolders.filter((h) => h.type === 'user').map((h) => h.value ?? h.parameter)].filter((x): x is string => !!x);
  const people: Record<string, Member> = {};
  await mapPool([...new Set(ids)], 6, async (id) => {
    const u = await jira<{ accountId: string; displayName: string; active: boolean; accountType?: string }>(route`/rest/api/3/user?accountId=${id}`, { as: 'user', allow: [404] });
    // Only people: Forge/Connect app accounts (accountType "app") and deleted users are not viewers.
    if (u && (u.accountType === undefined || u.accountType === 'atlassian')) people[id] = { accountId: u.accountId, displayName: u.displayName, active: u.active };
  });

  // Ground truth: Jira's per-user permission check for every candidate we know of (our expansion plus
  // everyone Jira reports with project-level Browse). See loaders.projectBrowseCandidates for why the
  // search endpoint alone is not trusted.
  const candidates = new Map<string, Member>();
  for (const m of [...Object.values(groupMembers).flat(), ...Object.values(people), ...(await projectBrowseCandidates(project.key))]) candidates.set(m.accountId, m);
  const base = { project, scheme, issue, names: namesFrom(scheme, roleNames, {}, levelHolders), groupMembers, people };
  const modelOnly = whoCanSee(base);
  const truth = await jiraViewersAmong([...candidates.values()], { issueId: issue.id, projectId: project.id }, new Set(modelOnly.viewers.map((v) => v.accountId)), started + BUDGET_MS);
  const result = truth ? whoCanSee({ ...base, jiraUsers: truth.users, jiraListTruncated: truth.truncated }) : modelOnly;
  const notes = [...result.notes, ...capNotes];
  if (truth?.truncated) notes.push(`Jira's own check covered ${truth.checked} of ${[...candidates.values()].filter((c) => c.active).length} candidates (time/size limit).`);
  if (readAs === 'app') notes.push('This issue could not be read with your access (an issue security level you are not in, or a temporary Jira inconsistency); it was read with the app\'s access.');
  return { ...result, notes, readAs };
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
  summarize: (r) => `${r.issue.key}: ${r.viewerCount} viewers, jira ${r.groundTruth.check}${r.readAs === 'app' ? ', read as app' : ''}`,
});
