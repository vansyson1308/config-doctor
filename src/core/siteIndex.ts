// Site-wide index used to compute the "blast radius" of a fix (what else a group or role grants).
import type { GroupRef, PermissionScheme, RoleActors, SecurityLevel } from './model';

export interface IndexedProject {
  key: string;
  name: string;
  style: string;
  schemeId: number | null;
  roles: Record<string, RoleActors>;
  securityLevels: SecurityLevel[];
}

export interface SiteIndex {
  builtAt: string;
  projects: IndexedProject[];
  schemes: Record<string, PermissionScheme>;
  /** Group id → member count (when known). */
  groupSizes: Record<string, number>;
}

export type Risk = 'low' | 'medium' | 'high';

export interface GrantedElsewhere {
  project: string;
  permissions: string[];
  via: string;
}

export interface BlastRadius {
  grants: GrantedElsewhere[];
  securityLevels: string[];
  otherProjectCount: number;
  risk: Risk;
  summary: string;
}

const ADMIN_PERMS = new Set(['ADMINISTER_PROJECTS', 'DELETE_ISSUES', 'DELETE_ALL_COMMENTS', 'DELETE_ALL_ATTACHMENTS', 'EDIT_WORKFLOW', 'MODIFY_REPORTER', 'SET_ISSUE_SECURITY']);

function sameGroup(a: GroupRef, holderValue?: string, holderParam?: string): boolean {
  return a.id === holderValue || a.id === holderParam || a.name === holderParam || a.name === holderValue;
}

export function riskOf(otherProjects: number, perms: Set<string>, groupSize?: number): Risk {
  const admin = [...perms].some((p) => ADMIN_PERMS.has(p));
  if (admin || otherProjects >= 4 || (groupSize ?? 0) > 100) return 'high';
  if (otherProjects >= 2 || perms.has('EDIT_ISSUES') || (groupSize ?? 0) > 25) return 'medium';
  return 'low';
}

function summarize(grants: GrantedElsewhere[], levels: string[], fallback: string): string {
  if (grants.length === 0 && levels.length === 0) return fallback;
  const parts = grants.slice(0, 5).map((g) => `${g.project} (${g.permissions.slice(0, 4).join(', ')}${g.permissions.length > 4 ? ', …' : ''})`);
  const more = grants.length > 5 ? ` and ${grants.length - 5} more projects` : '';
  const lv = levels.length ? `; security levels: ${levels.join(', ')}` : '';
  return `Also grants: ${parts.join('; ')}${more}${lv}`;
}

/** Everything a user would additionally get by joining `group`, excluding the project/permission being fixed. */
export function blastRadiusForGroup(index: SiteIndex, group: GroupRef, exclude?: { project: string }): BlastRadius {
  const grants: GrantedElsewhere[] = [];
  const levels: string[] = [];
  const allPerms = new Set<string>();
  for (const p of index.projects) {
    const scheme = p.schemeId !== null ? index.schemes[String(p.schemeId)] : undefined;
    const perms = new Set<string>();
    const vias = new Set<string>();
    for (const g of scheme?.grants ?? []) {
      if (g.holder.type === 'group' && sameGroup(group, g.holder.value, g.holder.parameter)) {
        perms.add(g.permission); vias.add('direct group grant');
      }
      if (g.holder.type === 'projectRole') {
        const role = p.roles[g.holder.value ?? g.holder.parameter ?? ''];
        if (role?.groups.some((rg) => rg.id === group.id || rg.name === group.name)) {
          perms.add(g.permission); vias.add(`role ${role.name}`);
        }
      }
    }
    for (const lvl of p.securityLevels) {
      const hit = lvl.members.some((m) => (m.type === 'group' && sameGroup(group, m.value, m.parameter))
        || (m.type === 'projectRole' && p.roles[m.value ?? m.parameter ?? '']?.groups.some((rg) => rg.id === group.id || rg.name === group.name)));
      if (hit) levels.push(`${p.key}: ${lvl.name}`);
    }
    if (perms.size > 0) {
      perms.forEach((x) => allPerms.add(x));
      grants.push({ project: p.key, permissions: [...perms].sort(), via: [...vias].join(', ') });
    }
  }
  const other = grants.filter((g) => g.project !== exclude?.project);
  const risk = riskOf(other.length, allPerms, index.groupSizes[group.id]);
  return {
    grants,
    securityLevels: [...new Set(levels)],
    otherProjectCount: other.length,
    risk,
    summary: summarize(grants, [...new Set(levels)], `No permission grants reference group ${group.name}`),
  };
}

/** What a user would get by joining `roleId` in one project (roles are per project). */
export function blastRadiusForRole(project: IndexedProject, scheme: PermissionScheme | undefined, roleId: string, roleName: string): BlastRadius {
  const perms = new Set((scheme?.grants ?? []).filter((g) => g.holder.type === 'projectRole' && (g.holder.value ?? g.holder.parameter) === roleId).map((g) => g.permission));
  const levels = project.securityLevels
    .filter((l) => l.members.some((m) => m.type === 'projectRole' && (m.value ?? m.parameter) === roleId))
    .map((l) => `${project.key}: ${l.name}`);
  const grants = perms.size ? [{ project: project.key, permissions: [...perms].sort(), via: `role ${roleName}` }] : [];
  return {
    grants,
    securityLevels: levels,
    otherProjectCount: 0,
    risk: riskOf(0, perms),
    summary: summarize(grants, levels, `Role ${roleName} grants nothing else in ${project.key}`),
  };
}
