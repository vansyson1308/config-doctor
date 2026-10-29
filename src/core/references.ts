// Where each group is referenced, assembled from the scanner's parts. Pure.
import type { IndexedProject } from './siteIndex';
import type { GrantRef, SchemeUse } from './sprawl';

export interface SchemesPart { schemes: SchemeUse[]; grants: GrantRef[]; schemeGroupRefs: Array<{ group: string; ref: string }> }
export interface SecurityPart { schemes: SchemeUse[]; groupRefs: Array<{ group: string; ref: string }> }

/** Group id or name → human-readable references (keys include both, so lookups by either work). */
export function groupReferenceIndex(parts: { projects: IndexedProject[]; schemes: SchemesPart; security: SecurityPart; productAccessGroups: string[] }): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  const add = (group: string, ref: string) => { if (group) refs[group] = [...(refs[group] ?? []), ref]; };
  parts.schemes.schemeGroupRefs.forEach((r) => add(r.group, r.ref));
  parts.security.groupRefs.forEach((r) => add(r.group, r.ref));
  for (const p of parts.projects) for (const role of Object.values(p.roles)) for (const g of role.groups) { add(g.id, `role ${role.name} in ${p.key}`); add(g.name, `role ${role.name} in ${p.key}`); }
  parts.productAccessGroups.forEach((g) => add(g, 'product access group'));
  return refs;
}

