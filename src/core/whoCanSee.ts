// F1 "Who can see PROJ-123 and why?": expands every Browse holder into concrete users, applies the
// issue security level with the same evaluator as explainAccess, and reconciles with Jira's own list.
import { evaluate } from './access';
import { describeHolder } from './holders';
import type { GroupRef, Holder, IssueModel, NameIndex, PermissionScheme, ProjectModel, SubjectUser } from './model';

export interface Member {
  accountId: string;
  displayName: string;
  active: boolean;
}

export interface WhoCanSeeInput {
  project: ProjectModel;
  scheme: PermissionScheme;
  issue: IssueModel;
  names: NameIndex;
  /** Members of every group referenced by Browse grants, role actors or the security level. */
  groupMembers: Record<string, Member[]>;
  /** Display info for directly referenced users (leads, reporters, direct grants). */
  people: Record<string, Member>;
  /** Users Jira reports as able to browse the issue (user/permission/search); undefined if unavailable. */
  jiraUsers?: Member[];
  /** Jira's list is capped; true if it may be incomplete. */
  jiraListTruncated?: boolean;
}

export interface HolderSummary {
  holder: string;
  members: number | 'everyone';
  afterSecurity: number | 'everyone' | 'unknown';
}

export interface Viewer {
  accountId: string;
  displayName: string;
  paths: string[];
}

export interface WhoCanSeeResult {
  issue: { key: string; securityLevel: string | null };
  project: string;
  scheme: string;
  holders: HolderSummary[];
  viewers: Viewer[];
  viewerCount: number;
  broadGrants: string[];
  groundTruth: {
    check: 'AGREES' | 'DISAGREES' | 'PARTIAL' | 'UNAVAILABLE';
    jiraCount?: number;
    onlyJiraSees?: string[];
    onlyModelSees?: string[];
  };
  notes: string[];
}

const BROAD = new Set(['anyone', 'applicationRole']);
const MAX_VIEWERS = 200;

function holderKey(h: Holder): string {
  return h.value ?? h.parameter ?? '';
}

function groupRefFor(h: Holder, names: NameIndex): GroupRef {
  const id = h.value ?? h.parameter ?? '';
  return { id, name: h.parameter ?? names.groupsById[id] ?? id };
}

/** Members of a group, looked up by id first, then by name (security levels may carry only names). */
function membersOf(g: GroupRef, input: WhoCanSeeInput): Member[] {
  return input.groupMembers[g.id] ?? input.groupMembers[g.name] ?? [];
}

function expandHolder(h: Holder, input: WhoCanSeeInput): Array<{ member: Member; path: string }> {
  const label = describeHolder(h, input);
  const person = (id?: string) => (id ? input.people[id] ?? { accountId: id, displayName: id, active: true } : undefined);
  switch (h.type) {
    case 'group':
      return membersOf(groupRefFor(h, input.names), input).map((m) => ({ member: m, path: label }));
    case 'projectRole': {
      const role = input.project.roles[holderKey(h)];
      if (!role) return [];
      const direct = role.userIds.map((id) => person(id)!).map((m) => ({ member: m, path: `${label} (direct)` }));
      const viaGroups = role.groups.flatMap((g) => membersOf(g, input).map((m) => ({ member: m, path: `${label} via group ${g.name}` })));
      return [...direct, ...viaGroups];
    }
    case 'user': {
      const p = person(holderKey(h));
      return p ? [{ member: p, path: 'granted by name' }] : [];
    }
    case 'projectLead': {
      const p = person(input.project.leadAccountId);
      return p ? [{ member: p, path: label }] : [];
    }
    case 'reporter': {
      const p = person(input.issue.reporterId);
      return p ? [{ member: p, path: `reporter of ${input.issue.key}` }] : [];
    }
    case 'assignee': {
      const p = person(input.issue.assigneeId);
      return p ? [{ member: p, path: `assignee of ${input.issue.key}` }] : [];
    }
    case 'userCustomField':
      return (input.issue.fieldValues?.[holderKey(h)]?.userIds ?? []).map((id) => ({ member: person(id)!, path: label }));
    case 'groupCustomField':
      return (input.issue.fieldValues?.[holderKey(h)]?.groupNames ?? [])
        .flatMap((n) => membersOf({ id: n, name: n }, input).map((m) => ({ member: m, path: `${label} (${n})` })));
    default:
      return [];
  }
}

/** Groups (from the loaded set) that contain a user — enough to evaluate every referenced holder. */
function subjectFor(m: Member, input: WhoCanSeeInput, groupIndex: Map<string, GroupRef[]>): SubjectUser {
  return { accountId: m.accountId, displayName: m.displayName, active: m.active, groups: groupIndex.get(m.accountId) ?? [] };
}

function buildGroupIndex(input: WhoCanSeeInput): Map<string, GroupRef[]> {
  const index = new Map<string, GroupRef[]>();
  const nameById = (key: string) => input.names.groupsById[key] ?? key;
  for (const [key, members] of Object.entries(input.groupMembers)) {
    // Keys may be ids or names; resolve both so holder matching by id or by name works.
    const id = input.names.groupsById[key] ? key : Object.entries(input.names.groupsById).find(([, n]) => n === key)?.[0] ?? key;
    const ref = { id, name: nameById(id) };
    for (const m of members) index.set(m.accountId, [...(index.get(m.accountId) ?? []), ref]);
  }
  return index;
}

export function whoCanSee(input: WhoCanSeeInput): WhoCanSeeResult {
  const groupIndex = buildGroupIndex(input);
  const browse = input.scheme.grants.filter((g) => g.permission === 'BROWSE_PROJECTS');
  const viewers = new Map<string, Viewer>();
  const holders: HolderSummary[] = [];
  const broad: string[] = [];
  const passes = (m: Member) =>
    m.active && evaluate({ subject: subjectFor(m, input, groupIndex), project: input.project, scheme: input.scheme, issue: input.issue, permission: 'BROWSE_PROJECTS', names: input.names, baseUrl: '' }).verdict === 'HAS_ACCESS';

  for (const g of browse) {
    const label = describeHolder(g.holder, input);
    if (BROAD.has(g.holder.type)) {
      broad.push(label);
      holders.push({ holder: label, members: 'everyone', afterSecurity: input.issue.securityLevel ? 'unknown' : 'everyone' });
      continue;
    }
    if (/atlassian-addons/i.test(label)) continue; // app access role: not people
    const unique = new Map<string, { member: Member; paths: string[] }>();
    for (const { member, path } of expandHolder(g.holder, input)) {
      const entry = unique.get(member.accountId) ?? { member, paths: [] };
      unique.set(member.accountId, { member, paths: entry.paths.includes(path) ? entry.paths : [...entry.paths, path] });
    }
    let after = 0;
    for (const { member, paths } of unique.values()) {
      if (!passes(member)) continue;
      after++;
      const v = viewers.get(member.accountId) ?? { accountId: member.accountId, displayName: member.displayName, paths: [] };
      viewers.set(member.accountId, { ...v, paths: [...v.paths, ...paths.filter((p) => !v.paths.includes(p))] });
    }
    holders.push({ holder: label, members: unique.size, afterSecurity: after });
  }

  const list = [...viewers.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const notes: string[] = [];
  if (input.issue.securityLevel) notes.push(`Issue security level "${input.issue.securityLevel.name}" limits viewers to its members.`);
  if (broad.length) notes.push(`Broad grants (${broad.join(', ')}) cannot be listed person by person; Jira's own list is authoritative for them.`);
  if (list.length > MAX_VIEWERS) notes.push(`Showing the first ${MAX_VIEWERS} of ${list.length} viewers.`);

  return {
    issue: { key: input.issue.key, securityLevel: input.issue.securityLevel?.name ?? null },
    project: input.project.key,
    scheme: input.scheme.name,
    holders,
    viewers: list.slice(0, MAX_VIEWERS),
    viewerCount: list.length,
    broadGrants: broad,
    groundTruth: compareWithJira(list, input),
    notes,
  };
}

function compareWithJira(model: Viewer[], input: WhoCanSeeInput): WhoCanSeeResult['groundTruth'] {
  if (!input.jiraUsers) return { check: 'UNAVAILABLE' };
  const humans = input.jiraUsers.filter((u) => u.active);
  const jiraIds = new Set(humans.map((u) => u.accountId));
  const modelIds = new Set(model.map((v) => v.accountId));
  const onlyJira = humans.filter((u) => !modelIds.has(u.accountId)).map((u) => u.displayName);
  const onlyModel = input.jiraListTruncated ? [] : model.filter((v) => !jiraIds.has(v.accountId)).map((v) => v.displayName);
  const agrees = onlyJira.length === 0 && onlyModel.length === 0;
  return {
    // A capped check can only ever confirm part of the list.
    check: !agrees ? 'DISAGREES' : input.jiraListTruncated ? 'PARTIAL' : 'AGREES',
    jiraCount: humans.length,
    ...(onlyJira.length ? { onlyJiraSees: onlyJira.slice(0, 25) } : {}),
    ...(onlyModel.length ? { onlyModelSees: onlyModel.slice(0, 25) } : {}),
  };
}
