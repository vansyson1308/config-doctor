// F3 Change Impact Preview: read-only simulations computed with the same evaluator as F1.
// Nothing here (or in the calling action) changes Jira.
import { evaluate } from './access';
import type { GroupRef, Holder, NameIndex, PermissionScheme, ProjectModel, SubjectUser } from './model';
import type { IndexedProject, Risk, SiteIndex } from './siteIndex';

export const KEY_PERMISSIONS = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES', 'ADMINISTER_PROJECTS'] as const;
const SAMPLE = 8;

export interface ProjectImpact {
  project: string;
  /** Permission → people who would lose it. */
  loses: Record<string, string[]>;
  /** Permission → people who would gain it (scheme switch only). */
  gains: Record<string, string[]>;
  /** People in the group who keep Browse through another path, with that path. */
  keepsAccess: Array<{ user: string; via: string }>;
}

export interface ImpactReport {
  change: string;
  risk: Risk;
  summary: string;
  usersLosingBrowse: number;
  usersLosingAnyPermission: number;
  /** People whose outcome could not be decided from the loaded data (never counted as losses). */
  undetermined: string[];
  projects: ProjectImpact[];
  references: string[];
  notes: string[];
}

function toProjectModel(p: IndexedProject): ProjectModel {
  return { id: p.id ?? p.key, key: p.key, name: p.name, style: p.style, roles: p.roles };
}

type Tri = 'yes' | 'no' | 'unknown';

function tri(subject: SubjectUser, project: ProjectModel, scheme: PermissionScheme, permission: string, names: NameIndex): Tri {
  const v = evaluate({ subject, project, scheme, permission, names, baseUrl: '' }).verdict;
  return v === 'HAS_ACCESS' ? 'yes' : v === 'NO_ACCESS' || v === 'CONDITIONAL' ? 'no' : 'unknown';
}

function can(subject: SubjectUser, project: ProjectModel, scheme: PermissionScheme, permission: string, names: NameIndex): boolean {
  return tri(subject, project, scheme, permission, names) === 'yes';
}

function firstPath(subject: SubjectUser, project: ProjectModel, scheme: PermissionScheme, names: NameIndex): string {
  const v = evaluate({ subject, project, scheme, permission: 'BROWSE_PROJECTS', names, baseUrl: '' });
  return v.evidence.find((e) => e.userMatches === true)?.via ?? 'another grant';
}

function withoutGroup(subject: SubjectUser, group: GroupRef): SubjectUser {
  return { ...subject, groups: subject.groups.filter((g) => g.id !== group.id && g.name !== group.name) };
}

function stripGroupFromProject(p: ProjectModel, group: GroupRef): ProjectModel {
  const roles = Object.fromEntries(Object.entries(p.roles).map(([id, r]) => [id, { ...r, groups: r.groups.filter((g) => g.id !== group.id && g.name !== group.name) }]));
  return { ...p, roles };
}

function riskFor(losingBrowse: number, projects: number, adminLoss: boolean): Risk {
  if (adminLoss || losingBrowse >= 10 || projects >= 4) return 'high';
  if (losingBrowse > 0 || projects >= 2) return 'medium';
  return 'low';
}

/** "What happens if I delete group G?" — every member of G evaluated with and without it, per project. */
export function impactOfGroupRemoval(index: SiteIndex, group: GroupRef, members: SubjectUser[], names: NameIndex): ImpactReport {
  const projects: ProjectImpact[] = [];
  const losingBrowse = new Set<string>();
  const losingAny = new Set<string>();
  const undetermined = new Set<string>();
  let adminLoss = false;
  const references: string[] = [];
  for (const ip of index.projects) {
    const scheme = ip.schemeId !== null ? index.schemes[String(ip.schemeId)] : undefined;
    if (!scheme) continue;
    const before = toProjectModel(ip);
    const after = stripGroupFromProject(before, group);
    const inRoles = Object.values(ip.roles).filter((r) => r.groups.some((g) => g.id === group.id || g.name === group.name));
    inRoles.forEach((r) => references.push(`actor of role ${r.name} in ${ip.key}`));
    const inGrants = scheme.grants.some((g) => g.holder.type === 'group' && (g.holder.value === group.id || g.holder.parameter === group.name));
    // Only projects where the group actually participates can change; skip the rest (no noise).
    if (inRoles.length === 0 && !inGrants) continue;
    const impact: ProjectImpact = { project: ip.key, loses: {}, gains: {}, keepsAccess: [] };
    for (const m of members) {
      const reduced = withoutGroup(m, group);
      for (const perm of KEY_PERMISSIONS) {
        const a = tri(m, before, scheme, perm, names);
        const b = tri(reduced, after, scheme, perm, names);
        if (a === 'unknown' || b === 'unknown') {
          if (a !== b) undetermined.add(m.displayName);
          continue;
        }
        if (a === 'yes' && b === 'no') {
          (impact.loses[perm] ??= []).push(m.displayName);
          losingAny.add(m.accountId);
          if (perm === 'BROWSE_PROJECTS') losingBrowse.add(m.accountId);
          if (perm === 'ADMINISTER_PROJECTS') adminLoss = true;
        }
      }
      if (can(m, before, scheme, 'BROWSE_PROJECTS', names) && can(reduced, after, scheme, 'BROWSE_PROJECTS', names)) {
        impact.keepsAccess.push({ user: m.displayName, via: firstPath(reduced, after, scheme, names) });
      }
    }
    if (Object.keys(impact.loses).length || impact.keepsAccess.length) projects.push(impact);
  }
  for (const s of Object.values(index.schemes)) {
    for (const g of s.grants) if (g.holder.type === 'group' && (g.holder.value === group.id || g.holder.parameter === group.name)) references.push(`${g.permission} in permission scheme "${s.name}"`);
  }
  for (const ip of index.projects) for (const l of ip.securityLevels) if (l.members.some((h) => h.type === 'group' && (h.value === group.id || h.parameter === group.name))) references.push(`member of security level "${l.name}" (${ip.key})`);
  const affectedProjects = projects.filter((p) => Object.keys(p.loses).length > 0);
  const risk = riskFor(losingBrowse.size, affectedProjects.length, adminLoss);
  const notes = [
    'Simulated with each member\'s current groups and every project\'s permission scheme and role actors (project-level permissions). Issue-level effects are listed under references (security levels).',
    ...(members.length === 0 ? ['The group has no members, so removing it changes nobody\'s access today (but its grants would stop applying to future members).'] : []),
  ];
  return {
    change: `Remove group ${group.name}`,
    risk,
    summary: `${losingBrowse.size} user(s) would lose Browse in ${affectedProjects.filter((p) => p.loses.BROWSE_PROJECTS).length} project(s); ${losingAny.size} user(s) lose at least one key permission.`,
    usersLosingBrowse: losingBrowse.size,
    usersLosingAnyPermission: losingAny.size,
    undetermined: [...undetermined].slice(0, SAMPLE),
    projects: projects.map((p) => ({ ...p, loses: Object.fromEntries(Object.entries(p.loses).map(([k, v]) => [k, v.slice(0, SAMPLE)])) })),
    references: [...new Set(references)],
    notes: undetermined.size ? [...notes, `${undetermined.size} member(s) could not be decided (e.g. product-access grants without loaded product access); they are not counted as losses.`] : notes,
  };
}

/** "What if PROJECT switches to permission scheme S?" — candidates evaluated under both schemes. */
export function impactOfSchemeSwitch(project: ProjectModel, from: PermissionScheme, to: PermissionScheme, candidates: SubjectUser[], names: NameIndex): ImpactReport {
  const impact: ProjectImpact = { project: project.key, loses: {}, gains: {}, keepsAccess: [] };
  const losing = new Set<string>();
  const losingBrowse = new Set<string>();
  const undetermined = new Set<string>();
  let adminLoss = false;
  for (const c of candidates) {
    for (const perm of KEY_PERMISSIONS) {
      const ta = tri(c, project, from, perm, names);
      const tb = tri(c, project, to, perm, names);
      if (ta === 'unknown' || tb === 'unknown') {
        if (ta !== tb) undetermined.add(c.displayName);
        continue;
      }
      const a = ta === 'yes';
      const b = tb === 'yes';
      if (a && !b) {
        (impact.loses[perm] ??= []).push(c.displayName);
        losing.add(c.accountId);
        if (perm === 'BROWSE_PROJECTS') losingBrowse.add(c.accountId);
        if (perm === 'ADMINISTER_PROJECTS') adminLoss = true;
      }
      if (!a && b) (impact.gains[perm] ??= []).push(c.displayName);
    }
  }
  const gainBrowse = impact.gains.BROWSE_PROJECTS?.length ?? 0;
  const broad = (s: PermissionScheme) => s.grants.some((g) => g.permission === 'BROWSE_PROJECTS' && (g.holder.type === 'anyone' || (g.holder.type === 'applicationRole' && !g.holder.value && !g.holder.parameter)));
  const notes = ['Evaluated for every person reachable through either scheme\'s grants (groups, roles, direct users); reporter/assignee-only access is conditional and not counted.'];
  if (undetermined.size) notes.push(`${undetermined.size} person(s) could not be decided from the loaded data; they are not counted.`);
  if (broad(to) && !broad(from)) notes.push(`"${to.name}" grants Browse to everyone / any logged-in user: the project would become visible site-wide.`);
  const risk: Risk = adminLoss || losingBrowse.size >= 10 || broad(to) ? 'high' : losingBrowse.size > 0 || gainBrowse > 0 ? 'medium' : 'low';
  return {
    change: `Switch ${project.key} from "${from.name}" to "${to.name}"`,
    risk,
    summary: `${losingBrowse.size} user(s) would lose Browse, ${gainBrowse} would gain it; ${losing.size} lose at least one key permission.`,
    usersLosingBrowse: losingBrowse.size,
    usersLosingAnyPermission: losing.size,
    undetermined: [...undetermined].slice(0, SAMPLE),
    projects: [{ ...impact, loses: Object.fromEntries(Object.entries(impact.loses).map(([k, v]) => [k, v.slice(0, SAMPLE)])), gains: Object.fromEntries(Object.entries(impact.gains).map(([k, v]) => [k, v.slice(0, SAMPLE)])) }],
    references: [],
    notes,
  };
}

export interface FieldUsage {
  field: { id: string; name: string };
  screens: string[];
  contexts: number | null;
  filters: string[];
  permissionGrants: string[];
  securityLevels: string[];
  issuesWithValue: number | null;
  lastUsed: string | null;
  /** Coverage caveats from the loader (capped filter scan, approximate counts). */
  extraNotes?: string[];
}

/** "What if I delete field F?" — pure risk assessment over collected references. */
export function impactOfFieldDeletion(u: FieldUsage): ImpactReport {
  const references = [
    ...u.screens.map((s) => `on screen "${s}"`),
    ...u.filters.map((f) => `used in filter ${f}`),
    ...u.permissionGrants.map((g) => `grants ${g}`),
    ...u.securityLevels.map((l) => `member rule in security level ${l}`),
  ];
  const accessCritical = u.permissionGrants.length + u.securityLevels.length > 0;
  const hasData = (u.issuesWithValue ?? 0) > 0;
  const risk: Risk = accessCritical || (u.issuesWithValue ?? 0) >= 100 ? 'high' : hasData || u.filters.length > 0 || u.screens.length > 0 ? 'medium' : 'low';
  const notes = [
    ...(u.extraNotes ?? []),
    'Deleting a custom field moves it to the trash for 60 days; restoring brings data back, but filters and automation that referenced it break while it is trashed.',
    ...(accessCritical ? ['This field drives permissions or issue security: deleting it changes who can access issues.'] : []),
    ...(u.issuesWithValue === null ? ['Issue count unavailable (field not searchable).'] : []),
  ];
  return {
    change: `Delete custom field "${u.field.name}" (${u.field.id})`,
    risk,
    summary: `${u.issuesWithValue ?? '?'} issue(s) hold a value; on ${u.screens.length} screen(s); in ${u.filters.length} filter(s); ${u.permissionGrants.length + u.securityLevels.length} access rule(s). Last used: ${u.lastUsed ?? 'unknown'}.`,
    usersLosingBrowse: 0,
    usersLosingAnyPermission: 0,
    undetermined: [],
    projects: [],
    references,
    notes,
  };
}

/** Everyone reachable through Browse-type holders of the given schemes in a project (for scheme switch). */
export function candidateGroupsAndUsers(project: ProjectModel, schemes: PermissionScheme[]): { groups: GroupRef[]; userIds: string[] } {
  const groups = new Map<string, GroupRef>();
  const users = new Set<string>();
  const visit = (h: Holder) => {
    const id = h.value ?? h.parameter ?? '';
    if (h.type === 'group') groups.set(h.value ?? id, { id: h.value ?? id, name: h.parameter ?? id });
    if (h.type === 'user') users.add(id);
    if (h.type === 'projectRole') {
      const r = project.roles[id];
      r?.userIds.forEach((u) => users.add(u));
      r?.groups.forEach((g) => groups.set(g.id, g));
    }
  };
  for (const s of schemes) for (const g of s.grants) if ((KEY_PERMISSIONS as readonly string[]).includes(g.permission)) visit(g.holder);
  if (project.leadAccountId) users.add(project.leadAccountId);
  return { groups: [...groups.values()].filter((g) => !/^atlassian-addons/i.test(g.name)), userIds: [...users] };
}
