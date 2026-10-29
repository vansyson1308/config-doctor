// F2 Sprawl Audit core: deterministic findings + health score from a configuration snapshot.
// Pure: the scanner (src/scan) collects ConfigData; this module never calls Jira.

export interface FieldInfo {
  id: string;
  name: string;
  /** schema.custom, e.g. com.atlassian.jira.plugin.system.customfieldtypes:textfield */
  customType?: string;
  screensCount?: number;
  contextsCount?: number;
  isLocked?: boolean;
  lastUsed?: { type: 'TRACKED' | 'NOT_TRACKED' | 'NO_INFORMATION'; value?: string };
}

export interface GroupInfo { id: string; name: string; memberCount: number | null }
export interface SchemeUse { id: string; name: string; projectKeys: string[]; isDefault?: boolean }
export interface GrantRef { schemeId: string; schemeName: string; permission: string; groupId?: string; groupName?: string }

export interface ConfigData {
  scannedAt: string;
  fields: FieldInfo[];
  groups: GroupInfo[];
  /** Group ids/names referenced anywhere we can see (grants, security levels, role actors, product access). */
  groupReferences: Record<string, string[]>;
  /** Permission grants that reference a group (to spot grants to empty groups). */
  groupGrants: GrantRef[];
  permissionSchemes: SchemeUse[];
  securitySchemes: SchemeUse[];
  workflowSchemes: SchemeUse[];
  workflows: { total: number; inactive: Array<{ id: string; name: string; isEditable?: boolean }> };
  screens: { total: number; unused: Array<{ id: string; name: string }> };
  projects: { total: number; scanned: number };
  /** Things the scanner could not see (403/400/skipped); unused-scheme advice is withheld when non-empty. */
  coverageGaps?: string[];
}

export type Rule =
  | 'FIELD_DUPLICATE_NAME' | 'FIELD_NOT_ON_SCREEN' | 'FIELD_NEVER_USED' | 'FIELD_STALE'
  | 'GROUP_EMPTY_GRANTED' | 'GROUP_EMPTY' | 'GROUP_UNREFERENCED'
  | 'PERMISSION_SCHEME_UNUSED' | 'SECURITY_SCHEME_UNUSED' | 'WORKFLOW_SCHEME_UNUSED'
  | 'WORKFLOW_INACTIVE' | 'SCREEN_UNUSED';

export type Level = 'low' | 'medium' | 'high';

export interface Finding {
  id: string;
  rule: Rule;
  title: string;
  objects: Array<{ type: string; id: string; name: string }>;
  evidence: string[];
  risk: Level;
  effort: Level;
  recommendation: string;
}

export interface CategoryScore { category: string; weight: number; affected: number; total: number; penalty: number }

export interface AuditResult {
  scannedAt: string;
  healthScore: number;
  breakdown: CategoryScore[];
  findings: Finding[];
  counts: Record<Rule, number>;
  totals: { fields: number; groups: number; permissionSchemes: number; workflowSchemes: number; workflows: number; screens: number; projects: number };
  coverage: { projectsScanned: number; projectsTotal: number; complete: boolean; gaps: string[] };
  /** Every finding id (uncapped), for exact "new since last scan" diffs. */
  allFindingIds: string[];
}

const STALE_DAYS = 180;
const SMALL_SAMPLE = 20;
const SYSTEM_GROUP = /^(site-admins|administrators|jira-administrators|jira-admins.*|jira-software-users.*|jira-servicemanagement-.*|jira-servicedesk-.*|jira-core-users.*|jira-users.*|jira-guests-.*|jira-customer-service-.*|jira-product-discovery-.*|jira-work-?management-.*|confluence-.*|atlassian-addons.*|trusted-users.*|system-administrators.*|org-admins.*|.*-user-access-admins-.*|.*-admins-[a-z0-9-]+|statuspage-.*|analytics-.*|assets-.*|rovo-.*|studio-.*|goals-.*|projects-users-.*|townsquare-.*|atlas-.*|focus-.*|compass-.*|loom-.*|talent-.*|bitbucket-.*|opsgenie-.*|trello-.*)$/i;

/** Field types an admin can create; any other type (Jira Software, JSM, Plans, Forms, apps) is product-managed. */
const GENERIC_FIELD_TYPE = /^com\.atlassian\.jira\.plugin\.system\.customfieldtypes:(textfield|textarea|select|multiselect|radiobuttons|multicheckboxes|cascadingselect|datepicker|datetime|float|userpicker|multiuserpicker|grouppicker|multigrouppicker|labels|url|version|multiversion|project|readonlyfield)$/;
/** Generic-typed fields that Jira product templates provision on every site (not admin sprawl). */
const TEMPLATE_FIELDS = new Set(['approvers', 'impact', 'urgency', 'change type', 'change risk', 'change reason', 'actual start', 'actual end', 'incident manager', 'pending reason', 'root cause', 'workaround', 'severity', 'start date', 'flagged', 'affected services', 'product categorization', 'operational categorization', 'responders', 'major incident']);
/** Jira's built-in screens (Default Screen, Resolve Issue Screen, Workflow Screen). */
const SYSTEM_SCREEN_IDS = new Set(['1', '2', '3']);

/** True for fields owned by a Jira product, template or app: never recommend trashing these. */
export function isManagedField(f: FieldInfo): boolean {
  if (f.isLocked) return true;
  if (f.customType && !GENERIC_FIELD_TYPE.test(f.customType)) return true;
  return TEMPLATE_FIELDS.has(f.name.trim().toLowerCase());
}

/** Jira's default schemes are templates for new projects; being unused is normal. */
export function isDefaultScheme(s: SchemeUse): boolean {
  return s.isDefault === true || s.id === '0' || /^default (permission|software|workflow|issue security) scheme$/i.test(s.name.trim());
}

const DROP_TOKENS = new Set(['old', 'copy', 'new', 'legacy', 'deprecated', 'tmp', 'temp', 'test', 'v1', 'v2', 'v3', 'do', 'not', 'use']);
const ABBREVIATIONS: Record<string, string> = { cust: 'customer', cx: 'customer', env: 'environment', est: 'estimate', desc: 'description', num: 'number', no: 'number', dept: 'department', mgr: 'manager' };

/** Canonical form for near-duplicate detection: case, punctuation, copies/olds, trailing numbers, abbreviations. */
export function canonicalName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[()[\]{}.,:;!?'"_\-/\\]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => !DROP_TOKENS.has(t));
  return tokens.join(' ');
}

/** "cd region 2" → "cd region"; null when there is no trailing number. */
export function withoutTrailingNumber(key: string): string | null {
  const m = /^(.*\S)\s+\d+$/.exec(key);
  return m ? m[1]! : null;
}

export function isSystemGroup(name: string): boolean {
  return SYSTEM_GROUP.test(name);
}

function fid(rule: Rule, key: string): string {
  // Stable id: rule + object key, safe for KVS keys and chat.
  let h = 0;
  for (const c of `${rule}:${key}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${rule.split('_').map((w) => w[0]).join('')}-${h.toString(36)}`;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

export function fieldFindings(fields: FieldInfo[], now: string): Finding[] {
  const out: Finding[] = [];
  const clusters = new Map<string, FieldInfo[]>();
  for (const f of fields) {
    const key = canonicalName(f.name);
    if (!key) continue;
    clusters.set(key, [...(clusters.get(key) ?? []), f]);
  }
  // "Region" + "Region 2" are copies; "Approver 1" + "Approver 2" (no plain "Approver") are deliberate.
  for (const key of [...clusters.keys()]) {
    const base = withoutTrailingNumber(key);
    if (base && clusters.has(base)) {
      clusters.set(base, [...clusters.get(base)!, ...clusters.get(key)!]);
      clusters.delete(key);
    }
  }
  for (const [key, group] of clusters) {
    if (group.length < 2 || group.every(isManagedField)) continue;
    out.push({
      id: fid('FIELD_DUPLICATE_NAME', key),
      rule: 'FIELD_DUPLICATE_NAME',
      title: `${group.length} custom fields look like the same field: ${group.map((f) => `"${f.name}"`).join(', ')}`,
      objects: group.map((f) => ({ type: 'customField', id: f.id, name: f.name })),
      evidence: group.map((f) => `${f.id} "${f.name}": ${f.screensCount ?? '?'} screens, ${f.contextsCount ?? '?'} contexts, last used ${f.lastUsed?.value?.slice(0, 10) ?? f.lastUsed?.type ?? 'unknown'}`),
      risk: 'medium',
      effort: 'medium',
      recommendation: 'Pick one field to keep, migrate values (bulk edit), update screens/filters, then trash the others.',
    });
  }
  for (const f of fields) {
    if (isManagedField(f)) continue;
    if (f.screensCount === 0) {
      out.push({
        id: fid('FIELD_NOT_ON_SCREEN', f.id), rule: 'FIELD_NOT_ON_SCREEN',
        title: `Custom field "${f.name}" is on no screen`,
        objects: [{ type: 'customField', id: f.id, name: f.name }],
        evidence: [`${f.id}: screensCount = 0, contexts = ${f.contextsCount ?? '?'}`],
        risk: 'low', effort: 'low',
        recommendation: 'If nobody sets it via automation or API, move it to trash (restorable for 60 days).',
      });
    }
    if (f.lastUsed?.type === 'NO_INFORMATION') {
      out.push({
        id: fid('FIELD_NEVER_USED', f.id), rule: 'FIELD_NEVER_USED',
        title: `Custom field "${f.name}" has no recorded use`,
        objects: [{ type: 'customField', id: f.id, name: f.name }],
        evidence: [`${f.id}: Jira tracks this field but reports no last-used date (lastUsed = NO_INFORMATION)`],
        risk: 'low', effort: 'low',
        recommendation: 'Confirm with the field owner, then trash it.',
      });
    } else if (f.lastUsed?.type === 'TRACKED' && f.lastUsed.value && daysBetween(f.lastUsed.value, now) > STALE_DAYS) {
      out.push({
        id: fid('FIELD_STALE', f.id), rule: 'FIELD_STALE',
        title: `Custom field "${f.name}" unused for ${Math.floor(daysBetween(f.lastUsed.value, now))} days`,
        objects: [{ type: 'customField', id: f.id, name: f.name }],
        evidence: [`${f.id}: last value change ${f.lastUsed.value.slice(0, 10)}`],
        risk: 'low', effort: 'low',
        recommendation: 'Hide it from screens first; trash it after one quiet quarter.',
      });
    }
  }
  return out;
}

export function groupFindings(data: Pick<ConfigData, 'groups' | 'groupReferences' | 'groupGrants'>): Finding[] {
  const out: Finding[] = [];
  for (const g of data.groups) {
    if (isSystemGroup(g.name)) continue;
    const refs = data.groupReferences[g.id] ?? data.groupReferences[g.name] ?? [];
    const grants = data.groupGrants.filter((r) => r.groupId === g.id || r.groupName === g.name);
    const obj = [{ type: 'group', id: g.id, name: g.name }];
    if (g.memberCount === 0 && grants.length > 0) {
      out.push({
        id: fid('GROUP_EMPTY_GRANTED', g.id), rule: 'GROUP_EMPTY_GRANTED',
        title: `Empty group "${g.name}" still holds ${grants.length} permission grant(s)`,
        objects: obj,
        evidence: grants.slice(0, 8).map((r) => `${r.permission} in "${r.schemeName}"`),
        risk: 'medium', effort: 'low',
        recommendation: 'Remove the grants (anyone later added to this group silently gains access), then delete the group.',
      });
    } else if (g.memberCount === 0) {
      out.push({
        id: fid('GROUP_EMPTY', g.id), rule: 'GROUP_EMPTY',
        title: `Group "${g.name}" has no members`,
        objects: obj,
        evidence: [`0 members; referenced by: ${refs.length ? refs.slice(0, 5).join('; ') : 'nothing found'}`],
        risk: 'low', effort: 'low',
        recommendation: refs.length ? 'Remove the references, then delete the group.' : 'Delete the group.',
      });
    }
    if (refs.length === 0 && g.memberCount !== 0) {
      out.push({
        id: fid('GROUP_UNREFERENCED', g.id), rule: 'GROUP_UNREFERENCED',
        title: `Group "${g.name}" (${g.memberCount ?? '?'} members) is not used by any permission scheme, security level, role or product access`,
        objects: obj,
        evidence: ['No references in permission schemes, issue security levels, project role actors or product access groups.', 'Not checked: filter/dashboard sharing, global permissions, notification schemes, comment/worklog visibility, Confluence.'],
        risk: 'low', effort: 'medium',
        recommendation: 'Check filter/dashboard sharing and global permissions; if unused there too, delete the group.',
      });
    }
  }
  return out;
}

function unusedSchemeFindings(schemes: SchemeUse[], rule: Rule, label: string): Finding[] {
  return schemes.filter((s) => s.projectKeys.length === 0 && !isDefaultScheme(s)).map((s) => ({
    id: fid(rule, s.id), rule,
    title: `${label} "${s.name}" is used by no project`,
    objects: [{ type: label.toLowerCase().replace(/ /g, '-'), id: s.id, name: s.name }],
    evidence: ['0 associated projects among the projects the scanner can see'],
    risk: 'low' as Level, effort: 'low' as Level,
    recommendation: `Delete the ${label.toLowerCase()} (or keep it only if it is a deliberate template).`,
  }));
}

const WEIGHTS: Array<{ category: string; weight: number; rules: Rule[]; total: (d: ConfigData) => number }> = [
  { category: 'Duplicate custom fields', weight: 15, rules: ['FIELD_DUPLICATE_NAME'], total: (d) => d.fields.length },
  { category: 'Custom fields on no screen', weight: 15, rules: ['FIELD_NOT_ON_SCREEN'], total: (d) => d.fields.filter((f) => !isManagedField(f)).length },
  { category: 'Unused custom fields', weight: 10, rules: ['FIELD_NEVER_USED', 'FIELD_STALE'], total: (d) => d.fields.filter((f) => !isManagedField(f)).length },
  { category: 'Empty or dead groups', weight: 15, rules: ['GROUP_EMPTY_GRANTED', 'GROUP_EMPTY', 'GROUP_UNREFERENCED'], total: (d) => d.groups.filter((g) => !isSystemGroup(g.name)).length },
  { category: 'Unused schemes', weight: 15, rules: ['PERMISSION_SCHEME_UNUSED', 'SECURITY_SCHEME_UNUSED', 'WORKFLOW_SCHEME_UNUSED'], total: (d) => [...d.permissionSchemes, ...d.securitySchemes, ...d.workflowSchemes].filter((s) => !isDefaultScheme(s)).length },
  { category: 'Inactive workflows', weight: 15, rules: ['WORKFLOW_INACTIVE'], total: (d) => d.workflows.total },
  { category: 'Unused screens', weight: 15, rules: ['SCREEN_UNUSED'], total: (d) => Math.max(0, d.screens.total - SYSTEM_SCREEN_IDS.size) },
];

/** Affected objects for a category; a duplicate cluster counts every field in it. */
function affectedCount(findings: Finding[], rules: Rule[]): number {
  return new Set(findings.filter((f) => rules.includes(f.rule)).flatMap((f) => f.objects.map((o) => `${o.type}:${o.id}`))).size;
}

export function score(findings: Finding[], data: ConfigData): { healthScore: number; breakdown: CategoryScore[] } {
  const breakdown = WEIGHTS.map((w) => {
    const total = w.total(data);
    const affected = affectedCount(findings, w.rules);
    // Ratio scaled so 50% sprawl costs the full category weight; damped for small categories so that
    // "2 of 2" on a brand-new site does not cost as much as 200 of 400 on a mature one.
    const confidence = Math.min(1, total / SMALL_SAMPLE);
    const penalty = total === 0 ? 0 : Math.min(1, (affected / total) * 2) * w.weight * confidence;
    return { category: w.category, weight: w.weight, affected, total, penalty: Math.round(penalty * 10) / 10 };
  });
  const healthScore = Math.max(0, Math.round(100 - breakdown.reduce((s, b) => s + b.penalty, 0)));
  return { healthScore, breakdown };
}

const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const MAX_FINDINGS_PER_RULE = 60;

export function audit(data: ConfigData): AuditResult {
  const gaps = [
    ...(data.coverageGaps ?? []),
    ...(data.projects.scanned < data.projects.total ? [`${data.projects.total - data.projects.scanned} project(s) not scanned`] : []),
  ];
  const findings: Finding[] = [
    ...fieldFindings(data.fields, data.scannedAt),
    ...groupFindings(data),
    // A scheme only looks unused if we saw every project; otherwise the advice could delete a live scheme.
    ...(gaps.length === 0 ? [
      ...unusedSchemeFindings(data.permissionSchemes, 'PERMISSION_SCHEME_UNUSED', 'Permission scheme'),
      ...unusedSchemeFindings(data.securitySchemes, 'SECURITY_SCHEME_UNUSED', 'Issue security scheme'),
      ...unusedSchemeFindings(data.workflowSchemes, 'WORKFLOW_SCHEME_UNUSED', 'Workflow scheme'),
    ] : []),
    ...data.workflows.inactive.filter((w) => w.isEditable !== false).map((w): Finding => ({
      id: fid('WORKFLOW_INACTIVE', w.id), rule: 'WORKFLOW_INACTIVE', title: `Workflow "${w.name}" is inactive`,
      objects: [{ type: 'workflow', id: w.id, name: w.name }], evidence: ['Not used by any active workflow scheme'],
      risk: 'low', effort: 'low', recommendation: 'Delete the inactive workflow (export it first if you want a copy).',
    })),
    ...data.screens.unused.filter((s) => !SYSTEM_SCREEN_IDS.has(s.id)).map((s): Finding => ({
      id: fid('SCREEN_UNUSED', s.id), rule: 'SCREEN_UNUSED', title: `Screen "${s.name}" is in no screen scheme`,
      objects: [{ type: 'screen', id: s.id, name: s.name }], evidence: ['Not referenced by any screen scheme', 'Not checked: workflow transition screens'],
      risk: 'low', effort: 'low', recommendation: 'Check that no workflow transition uses it (workflow editor), then delete the screen.',
    })),
  ];
  const counts = Object.fromEntries(['FIELD_DUPLICATE_NAME', 'FIELD_NOT_ON_SCREEN', 'FIELD_NEVER_USED', 'FIELD_STALE', 'GROUP_EMPTY_GRANTED', 'GROUP_EMPTY', 'GROUP_UNREFERENCED', 'PERMISSION_SCHEME_UNUSED', 'SECURITY_SCHEME_UNUSED', 'WORKFLOW_SCHEME_UNUSED', 'WORKFLOW_INACTIVE', 'SCREEN_UNUSED']
    .map((r) => [r, findings.filter((f) => f.rule === r).length])) as Record<Rule, number>;
  const { healthScore, breakdown } = score(findings, data);
  const perRule = new Map<Rule, number>();
  const ranked = [...findings]
    .sort((a, b) => RANK[a.risk] - RANK[b.risk] || RANK[b.effort] - RANK[a.effort] || a.title.localeCompare(b.title))
    .filter((f) => {
      const n = (perRule.get(f.rule) ?? 0) + 1;
      perRule.set(f.rule, n);
      return n <= MAX_FINDINGS_PER_RULE;
    });
  return {
    scannedAt: data.scannedAt,
    healthScore,
    breakdown,
    findings: ranked,
    counts,
    totals: {
      fields: data.fields.length, groups: data.groups.length, permissionSchemes: data.permissionSchemes.length,
      workflowSchemes: data.workflowSchemes.length, workflows: data.workflows.total, screens: data.screens.total, projects: data.projects.total,
    },
    coverage: {
      projectsScanned: data.projects.scanned,
      projectsTotal: data.projects.total,
      complete: gaps.length === 0,
      gaps: gaps.length ? [...gaps, 'Unused-scheme findings are withheld until every project can be scanned.'] : [],
    },
    allFindingIds: findings.map((f) => f.id),
  };
}

const CATEGORY_RULES: Array<{ match: RegExp; rules: Rule[] }> = [
  { match: /dup|duplicate|same field/i, rules: ['FIELD_DUPLICATE_NAME'] },
  { match: /screen.*field|field.*screen|not on (a|any) screen|no screen/i, rules: ['FIELD_NOT_ON_SCREEN'] },
  { match: /unused field|never used|stale|field/i, rules: ['FIELD_DUPLICATE_NAME', 'FIELD_NOT_ON_SCREEN', 'FIELD_NEVER_USED', 'FIELD_STALE'] },
  { match: /group/i, rules: ['GROUP_EMPTY_GRANTED', 'GROUP_EMPTY', 'GROUP_UNREFERENCED'] },
  { match: /security/i, rules: ['SECURITY_SCHEME_UNUSED'] },
  { match: /permission scheme/i, rules: ['PERMISSION_SCHEME_UNUSED'] },
  { match: /workflow scheme/i, rules: ['WORKFLOW_SCHEME_UNUSED'] },
  { match: /scheme/i, rules: ['PERMISSION_SCHEME_UNUSED', 'SECURITY_SCHEME_UNUSED', 'WORKFLOW_SCHEME_UNUSED'] },
  { match: /workflow/i, rules: ['WORKFLOW_INACTIVE'] },
  { match: /screen/i, rules: ['SCREEN_UNUSED'] },
];

/** Maps a free-text category ("duplicate fields", "groups", "schemes", a rule name…) to rules. */
export function rulesForCategory(raw: string): Rule[] | null {
  const text = raw.trim();
  const asRule = text.toUpperCase().replace(/[\s-]+/g, '_');
  const all = Object.keys(EMPTY_COUNTS) as Rule[];
  if (all.includes(asRule as Rule)) return [asRule as Rule];
  return CATEGORY_RULES.find((c) => c.match.test(text))?.rules ?? null;
}

const EMPTY_COUNTS: Record<Rule, 0> = {
  FIELD_DUPLICATE_NAME: 0, FIELD_NOT_ON_SCREEN: 0, FIELD_NEVER_USED: 0, FIELD_STALE: 0, GROUP_EMPTY_GRANTED: 0, GROUP_EMPTY: 0,
  GROUP_UNREFERENCED: 0, PERMISSION_SCHEME_UNUSED: 0, SECURITY_SCHEME_UNUSED: 0, WORKFLOW_SCHEME_UNUSED: 0, WORKFLOW_INACTIVE: 0, SCREEN_UNUSED: 0,
};

/** Findings for the given rules, optionally narrowed by a name fragment. */
export function filterFindings(findings: Finding[], rules: Rule[], nameContains?: string): Finding[] {
  const q = nameContains?.trim().toLowerCase();
  return findings.filter((f) => rules.includes(f.rule) && (!q || f.title.toLowerCase().includes(q) || f.objects.some((o) => o.name.toLowerCase().includes(q))));
}
