// F1 Access Explainer core: computes a verdict + evidence chain + fix options for
// "can <user> <permission> on <issue|project>, and why?". Pure: all data is passed in.
import { matchHolder, type HolderMatch, type MatchContext } from './holders';
import type { GroupRef, IssueModel, NameIndex, PermissionScheme, ProjectModel, SubjectUser } from './model';
import { blastRadiusForGroup, blastRadiusForRole, type Risk, type SiteIndex } from './siteIndex';
import { isSystemGroup } from './sprawl';

export type Verdict = 'HAS_ACCESS' | 'NO_ACCESS' | 'CONDITIONAL' | 'INCONCLUSIVE';
export type Layer = 'ACCOUNT' | 'PERMISSION_SCHEME' | 'ISSUE_SECURITY';
export type GroundTruth = 'AGREES' | 'DISAGREES' | 'DECIDED_BY_JIRA' | 'UNAVAILABLE';

export interface EvidenceItem {
  layer: Layer;
  permission?: string;
  scheme?: string;
  level?: string;
  grant: string;
  userMatches: boolean | 'conditional' | 'unknown';
  via: string;
}

export interface FixOption {
  action: string;
  kind: 'ADD_TO_GROUP' | 'ADD_TO_ROLE' | 'GRANT_PRODUCT_ACCESS';
  target: string;
  resolves: boolean;
  alsoGrants: string;
  risk: Risk;
  adminLink?: string;
}

export interface AccessInput {
  subject: SubjectUser;
  project: ProjectModel;
  scheme: PermissionScheme;
  issue?: IssueModel;
  permission: string;
  names: NameIndex;
  baseUrl: string;
  index?: SiteIndex;
}

export interface AccessVerdict {
  verdict: Verdict;
  permission: string;
  user: { accountId: string; displayName: string; active: boolean };
  project: { key: string; name: string; style: string };
  issue?: { key: string; securityLevel: string | null };
  blockingLayer: Layer | null;
  evidence: EvidenceItem[];
  fixOptions: FixOption[];
  groundTruthCheck: GroundTruth;
  groundTruth?: { jiraSays: boolean; source: string; checks?: Array<boolean | undefined> };
  adminLinks: string[];
  notes: string[];
}

const MAX_EVIDENCE_PER_PERMISSION = 12;

/** Holders that exist for apps / the platform; never suggest adding a human to them. */
export function isSystemHolderName(name: string): boolean {
  return /^atlassian-addons/i.test(name) || isSystemGroup(name);
}

function toUserMatches(m: HolderMatch): EvidenceItem['userMatches'] {
  return m.state === 'yes' ? true : m.state === 'no' ? false : m.state;
}

interface LayerResult {
  state: 'pass' | 'fail' | 'conditional' | 'unknown';
  evidence: EvidenceItem[];
}

function combine(matches: HolderMatch[]): LayerResult['state'] {
  if (matches.some((m) => m.state === 'yes')) return 'pass';
  if (matches.some((m) => m.state === 'unknown')) return 'unknown';
  if (matches.some((m) => m.state === 'conditional')) return 'conditional';
  return 'fail';
}

export function requiredPermissions(permission: string): string[] {
  return permission === 'BROWSE_PROJECTS' ? ['BROWSE_PROJECTS'] : ['BROWSE_PROJECTS', permission];
}

function evaluateScheme(input: AccessInput, ctx: MatchContext, permission: string): LayerResult {
  const grants = input.scheme.grants.filter((g) => g.permission === permission);
  const matches = grants.map((g) => matchHolder(g.holder, ctx));
  const ordered = matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => Number(b.m.state === 'yes') - Number(a.m.state === 'yes'))
    .slice(0, MAX_EVIDENCE_PER_PERMISSION);
  const evidence: EvidenceItem[] = ordered.map(({ m }) => ({
    layer: 'PERMISSION_SCHEME', permission, scheme: input.scheme.name, grant: m.holder, userMatches: toUserMatches(m), via: m.via,
  }));
  if (grants.length === 0) {
    evidence.push({ layer: 'PERMISSION_SCHEME', permission, scheme: input.scheme.name, grant: '(no grants)', userMatches: false, via: `${permission} is granted to nobody in this scheme` });
  }
  return { state: combine(matches), evidence };
}

function evaluateSecurity(ctx: MatchContext, issue: IssueModel): LayerResult {
  const level = issue.securityLevel;
  if (!level) return { state: 'pass', evidence: [] };
  const matches = level.members.map((h) => matchHolder(h, ctx));
  const evidence: EvidenceItem[] = matches.map((m) => ({
    layer: 'ISSUE_SECURITY', level: level.name, scheme: level.schemeName, grant: m.holder, userMatches: toUserMatches(m), via: m.via,
  }));
  if (level.members.length === 0) evidence.push({ layer: 'ISSUE_SECURITY', level: level.name, grant: '(no members)', userMatches: false, via: 'the level has no members, so nobody can see the issue' });
  return { state: combine(matches), evidence };
}

/** Core evaluation without fix options (used for fix simulation too). */
export function evaluate(input: AccessInput): { verdict: Verdict; blockingLayer: Layer | null; evidence: EvidenceItem[] } {
  const ctx: MatchContext = { subject: input.subject, project: input.project, issue: input.issue, names: input.names };
  if (!input.subject.active) {
    return {
      verdict: 'NO_ACCESS', blockingLayer: 'ACCOUNT',
      evidence: [{ layer: 'ACCOUNT', grant: 'active account', userMatches: false, via: 'the account is deactivated' }],
    };
  }
  const evidence: EvidenceItem[] = [];
  let conditional = false;
  let unknown = false;
  for (const perm of requiredPermissions(input.permission)) {
    const r = evaluateScheme(input, ctx, perm);
    evidence.push(...r.evidence);
    if (r.state === 'fail') return { verdict: 'NO_ACCESS', blockingLayer: 'PERMISSION_SCHEME', evidence };
    if (r.state === 'conditional') conditional = true;
    if (r.state === 'unknown') unknown = true;
  }
  if (input.issue) {
    const s = evaluateSecurity(ctx, input.issue);
    evidence.push(...s.evidence);
    if (s.state === 'fail') return { verdict: 'NO_ACCESS', blockingLayer: 'ISSUE_SECURITY', evidence };
    if (s.state === 'unknown') unknown = true;
    if (s.state === 'conditional') conditional = true;
  }
  if (unknown) return { verdict: 'INCONCLUSIVE', blockingLayer: null, evidence };
  return { verdict: conditional ? 'CONDITIONAL' : 'HAS_ACCESS', blockingLayer: null, evidence };
}

function withGroup(subject: SubjectUser, group: GroupRef): SubjectUser {
  return { ...subject, groups: [...subject.groups, group] };
}

function withRole(project: ProjectModel, roleId: string, accountId: string, roleName: string): ProjectModel {
  const role = project.roles[roleId] ?? { id: roleId, name: roleName, userIds: [], groups: [] };
  return { ...project, roles: { ...project.roles, [roleId]: { ...role, userIds: [...role.userIds, accountId] } } };
}

function candidateFixes(input: AccessInput, layer: Layer): FixOption[] {
  const holders = layer === 'ISSUE_SECURITY'
    ? input.issue?.securityLevel?.members ?? []
    : input.scheme.grants.filter((g) => requiredPermissions(input.permission).includes(g.permission)).map((g) => g.holder);
  const seen = new Set<string>();
  const fixes: FixOption[] = [];
  const name = input.subject.displayName;
  const indexedProject = input.index?.projects.find((p) => p.key === input.project.key);
  for (const h of holders) {
    const id = h.value ?? h.parameter ?? '';
    if (h.type === 'group') {
      const group: GroupRef = { id: h.value ?? id, name: h.parameter ?? input.names.groupsById[id] ?? id };
      const key = `g:${group.id}|${group.name}`;
      if (seen.has(key) || isSystemHolderName(group.name)) continue;
      seen.add(key);
      const resolves = evaluate({ ...input, subject: withGroup(input.subject, group) }).verdict === 'HAS_ACCESS';
      const radius = input.index ? blastRadiusForGroup(input.index, group, { project: input.project.key }) : undefined;
      fixes.push({
        action: `Add ${name} to group ${group.name}`, kind: 'ADD_TO_GROUP', target: group.name, resolves,
        alsoGrants: radius?.summary ?? 'blast radius not computed (site index unavailable)', risk: radius?.risk ?? 'medium',
        adminLink: `${input.baseUrl}/jira/settings/system/groups`,
      });
    } else if (h.type === 'projectRole') {
      const roleName = input.project.roles[id]?.name ?? input.names.roles[id] ?? id;
      const key = `r:${id}`;
      if (seen.has(key) || isSystemHolderName(roleName)) continue;
      seen.add(key);
      const resolves = evaluate({ ...input, project: withRole(input.project, id, input.subject.accountId, roleName) }).verdict === 'HAS_ACCESS';
      const radius = indexedProject ? blastRadiusForRole(indexedProject, input.scheme, id, roleName) : blastRadiusForRole(
        { key: input.project.key, name: input.project.name, style: input.project.style, schemeId: input.scheme.id, roles: input.project.roles, securityLevels: input.issue?.securityLevel ? [input.issue.securityLevel] : [] },
        input.scheme, id, roleName);
      fixes.push({
        action: `Add ${name} to role ${roleName} in ${input.project.key}`, kind: 'ADD_TO_ROLE', target: `${roleName} @ ${input.project.key}`, resolves,
        alsoGrants: radius.summary, risk: radius.risk,
        adminLink: `${input.baseUrl}/plugins/servlet/project-config/${input.project.key}/roles`,
      });
    } else if (h.type === 'applicationRole' && id && !input.subject.applicationRoles?.includes(id)) {
      const key = `a:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fixes.push({
        action: `Give ${name} ${id} product access`, kind: 'GRANT_PRODUCT_ACCESS', target: id, resolves: false,
        alsoGrants: 'Product access applies site-wide and uses a licence seat', risk: 'medium',
      });
    }
  }
  const riskRank: Record<Risk, number> = { low: 0, medium: 1, high: 2 };
  return fixes.sort((a, b) => Number(b.resolves) - Number(a.resolves) || riskRank[a.risk] - riskRank[b.risk]).slice(0, 5);
}

export function adminLinks(input: AccessInput): string[] {
  const links = [`${input.baseUrl}/secure/admin/EditPermissions!default.jspa?schemeId=${input.scheme.id}`];
  if (input.issue?.securityLevel?.schemeId) links.push(`${input.baseUrl}/secure/admin/EditIssueSecurities!default.jspa?schemeId=${input.issue.securityLevel.schemeId}`);
  links.push(`${input.baseUrl}/plugins/servlet/project-config/${input.project.key}/roles`);
  return links;
}

export function explainAccess(input: AccessInput): AccessVerdict {
  const core = evaluate(input);
  const notes: string[] = [];
  if (input.project.style === 'next-gen') {
    notes.push('Team-managed project: access comes from the project access level and its own roles; rely on the Jira cross-check for the final answer.');
  }
  if (core.verdict === 'CONDITIONAL') notes.push('Access depends on the specific issue (e.g. only as reporter or assignee). Ask about a specific issue for a definite answer.');
  const fixOptions = core.verdict === 'NO_ACCESS' && core.blockingLayer && core.blockingLayer !== 'ACCOUNT' ? candidateFixes(input, core.blockingLayer) : [];
  if (core.blockingLayer === 'ACCOUNT') notes.push('Reactivate the account in admin.atlassian.com before changing any permissions.');
  return {
    verdict: core.verdict,
    permission: input.permission,
    user: { accountId: input.subject.accountId, displayName: input.subject.displayName, active: input.subject.active },
    project: { key: input.project.key, name: input.project.name, style: input.project.style },
    ...(input.issue ? { issue: { key: input.issue.key, securityLevel: input.issue.securityLevel?.name ?? null } } : {}),
    blockingLayer: core.blockingLayer,
    evidence: core.evidence,
    fixOptions,
    groundTruthCheck: 'UNAVAILABLE',
    adminLinks: adminLinks(input),
    notes,
  };
}

/**
 * Compares our computed verdict with Jira's own permission check. Disagreement is never hidden:
 * the verdict becomes INCONCLUSIVE and both answers are reported.
 */
export function reconcile(v: AccessVerdict, jiraSays: boolean | undefined, source: string, checks?: Array<boolean | undefined>): AccessVerdict {
  if (jiraSays === undefined) return { ...v, groundTruthCheck: 'UNAVAILABLE' };
  const ours = v.verdict === 'HAS_ACCESS' ? true : v.verdict === 'NO_ACCESS' ? false : undefined;
  const groundTruth = { jiraSays, source, ...(checks && checks.length > 1 ? { checks } : {}) };
  if (checks && new Set(checks).size > 1) {
    v = { ...v, notes: [...v.notes, `Jira's permission check gave different answers on repeated calls (${checks.map((c) => (c === undefined ? 'n/a' : c ? 'yes' : 'no')).join(', ')}), which happens shortly after permission changes; the majority answer is used.`] };
  }
  if (ours === jiraSays) return { ...v, groundTruthCheck: 'AGREES', groundTruth };
  if (ours === undefined) {
    // CONDITIONAL/INCONCLUSIVE locally: Jira's answer settles it but we say so explicitly.
    return { ...v, groundTruthCheck: 'DECIDED_BY_JIRA', groundTruth, verdict: jiraSays ? 'HAS_ACCESS' : 'NO_ACCESS', notes: [...v.notes, `Our model could not decide alone (${v.verdict}); Jira's permission check says ${jiraSays ? 'yes' : 'no'}.`] };
  }
  return {
    ...v, verdict: 'INCONCLUSIVE', groundTruthCheck: 'DISAGREES', groundTruth,
    notes: [...v.notes, `Config Doctor computed ${v.verdict} but Jira's permission check says ${jiraSays ? 'HAS_ACCESS' : 'NO_ACCESS'}. Something not modelled is involved (e.g. a holder type, app-defined permission or team-managed setting). Both results are shown; verify in the admin screens.`],
  };
}
