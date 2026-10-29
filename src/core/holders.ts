// Evaluates whether a subject user matches a single permission holder.
// Pure: no I/O. Mirrors Jira's documented holder semantics (see RESEARCH.md / permission scheme docs).
import type { GroupRef, Holder, IssueModel, NameIndex, ProjectModel, SubjectUser } from './model';

/**
 * yes          the holder grants to this user for this project/issue
 * no           it does not
 * conditional  depends on a specific issue (reporter, assignee, user/group picker field) and no issue was given
 * unknown      cannot be decided from the loaded data (e.g. product access not loaded, unknown holder type)
 */
export type MatchState = 'yes' | 'no' | 'conditional' | 'unknown';

export interface HolderMatch {
  state: MatchState;
  /** Human-readable holder, e.g. "group cd-staff-hq", "role CD Developers". */
  holder: string;
  /** How the user matches (or why not), e.g. "member of group cd-dev-vn via role CD Developers". */
  via: string;
}

export interface MatchContext {
  subject: SubjectUser;
  project: ProjectModel;
  issue?: IssueModel;
  names: NameIndex;
}

const holderId = (h: Holder): string => h.value ?? h.parameter ?? '';

function groupName(h: Holder, names: NameIndex): string {
  // Permission schemes: parameter = group name, value = group id. Security levels may only carry the name.
  if (h.parameter && h.value) return h.parameter;
  const id = holderId(h);
  return names.groupsById[id] ?? id;
}

function inGroup(groups: GroupRef[], h: Holder): GroupRef | undefined {
  return groups.find((g) => g.id === h.value || g.id === h.parameter || g.name === h.parameter || g.name === h.value);
}

export function describeHolder(h: Holder, ctx: Pick<MatchContext, 'project' | 'names'>): string {
  const id = holderId(h);
  switch (h.type) {
    case 'anyone': return 'anyone (including anonymous)';
    case 'applicationRole': return id ? `users with ${id} access` : 'any logged-in user';
    case 'group': return `group ${groupName(h, ctx.names)}`;
    case 'user': return `user ${id}`;
    case 'projectLead': return `project lead of ${ctx.project.key}`;
    case 'projectRole': return `role ${ctx.project.roles[id]?.name ?? ctx.names.roles[id] ?? id}`;
    case 'reporter': return 'issue reporter';
    case 'assignee': return 'issue assignee';
    case 'userCustomField': return `user in field ${ctx.names.fields[id] ?? id}`;
    case 'groupCustomField': return `group in field ${ctx.names.fields[id] ?? id}`;
    case 'sd.customer.portal.only': return 'service desk customers (portal only)';
    default: return `${h.type} ${id}`.trim();
  }
}

function matchRole(h: Holder, ctx: MatchContext, label: string): HolderMatch {
  const role = ctx.project.roles[holderId(h)];
  if (!role) return { state: 'no', holder: label, via: `role has no members in ${ctx.project.key}` };
  if (role.userIds.includes(ctx.subject.accountId)) {
    return { state: 'yes', holder: label, via: `directly in role ${role.name} in ${ctx.project.key}` };
  }
  const viaGroup = role.groups.find((g) => ctx.subject.groups.some((sg) => sg.id === g.id || sg.name === g.name));
  if (viaGroup) return { state: 'yes', holder: label, via: `member of group ${viaGroup.name}, which is in role ${role.name} in ${ctx.project.key}` };
  return { state: 'no', holder: label, via: `not in role ${role.name} in ${ctx.project.key} (directly or via its groups)` };
}

function matchIssueUserField(h: Holder, ctx: MatchContext, label: string, kind: 'user' | 'group'): HolderMatch {
  if (!ctx.issue) return { state: 'conditional', holder: label, via: `only on issues where ${label.replace(/^(user|group) in /, '')} names them` };
  const values = ctx.issue.fieldValues?.[holderId(h)];
  if (!values) return { state: 'no', holder: label, via: `field empty on ${ctx.issue.key}` };
  if (kind === 'user') {
    return values.userIds.includes(ctx.subject.accountId)
      ? { state: 'yes', holder: label, via: `named in that field on ${ctx.issue.key}` }
      : { state: 'no', holder: label, via: `not named in that field on ${ctx.issue.key}` };
  }
  const hit = values.groupNames.find((n) => ctx.subject.groups.some((g) => g.name === n));
  return hit
    ? { state: 'yes', holder: label, via: `member of group ${hit} named in that field on ${ctx.issue.key}` }
    : { state: 'no', holder: label, via: `not in any group named in that field on ${ctx.issue.key}` };
}

function matchIssueParty(ctx: MatchContext, label: string, who: 'reporterId' | 'assigneeId'): HolderMatch {
  const word = who === 'reporterId' ? 'reporter' : 'assignee';
  if (!ctx.issue) return { state: 'conditional', holder: label, via: `only on issues where they are the ${word}` };
  return ctx.issue[who] === ctx.subject.accountId
    ? { state: 'yes', holder: label, via: `is the ${word} of ${ctx.issue.key}` }
    : { state: 'no', holder: label, via: `is not the ${word} of ${ctx.issue.key}` };
}

export function matchHolder(h: Holder, ctx: MatchContext): HolderMatch {
  const label = describeHolder(h, ctx);
  const id = holderId(h);
  switch (h.type) {
    case 'anyone':
      return { state: 'yes', holder: label, via: 'granted to everyone' };
    case 'applicationRole': {
      if (!id) return { state: 'yes', holder: label, via: 'granted to any logged-in user' };
      if (!ctx.subject.applicationRoles) return { state: 'unknown', holder: label, via: 'product access not loaded' };
      return ctx.subject.applicationRoles.includes(id)
        ? { state: 'yes', holder: label, via: `has ${id} product access` }
        : { state: 'no', holder: label, via: `no ${id} product access` };
    }
    case 'group': {
      const g = inGroup(ctx.subject.groups, h);
      return g ? { state: 'yes', holder: label, via: `member of group ${g.name}` } : { state: 'no', holder: label, via: `not a member of ${label}` };
    }
    case 'user':
      return id === ctx.subject.accountId ? { state: 'yes', holder: label, via: 'granted to them by name' } : { state: 'no', holder: label, via: 'granted to a different user' };
    case 'projectLead':
      return ctx.project.leadAccountId === ctx.subject.accountId
        ? { state: 'yes', holder: label, via: `is project lead of ${ctx.project.key}` }
        : { state: 'no', holder: label, via: `is not project lead of ${ctx.project.key}` };
    case 'projectRole':
      return matchRole(h, ctx, label);
    case 'reporter':
      return matchIssueParty(ctx, label, 'reporterId');
    case 'assignee':
      return matchIssueParty(ctx, label, 'assigneeId');
    case 'userCustomField':
      return matchIssueUserField(h, ctx, label, 'user');
    case 'groupCustomField':
      return matchIssueUserField(h, ctx, label, 'group');
    case 'sd.customer.portal.only':
      return { state: 'no', holder: label, via: 'portal-only customers do not get Jira access' };
    default:
      return { state: 'unknown', holder: label, via: `holder type "${h.type}" is not modelled` };
  }
}
