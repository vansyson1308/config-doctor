// F2 Sprawl Audit core: deterministic findings + health score from a configuration snapshot.
// Pure: the scanner (src/scan) collects ConfigData; this module never calls Jira.

export interface FieldInfo {
  id: string;
  name: string;
  screensCount?: number;
  contextsCount?: number;
  isLocked?: boolean;
  lastUsed?: { type: 'TRACKED' | 'NOT_TRACKED' | 'NO_INFORMATION'; value?: string };
}

export interface GroupInfo { id: string; name: string; memberCount: number | null }
export interface SchemeUse { id: string; name: string; projectKeys: string[] }
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
  workflows: { total: number; inactive: Array<{ id: string; name: string }> };
  screens: { total: number; unused: Array<{ id: string; name: string }> };
  projects: { total: number; scanned: number };
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
  coverage: { projectsScanned: number; projectsTotal: number; complete: boolean };
}

const STALE_DAYS = 180;
const SYSTEM_GROUP = /^(site-admins|administrators|jira-administrators|jira-admins.*|jira-software-users.*|jira-servicemanagement-.*|jira-core-users.*|jira-users.*|confluence-.*|atlassian-addons.*|trusted-users.*|system-administrators.*|org-admins.*|.*-user-access-admins-.*|.*-admins-[a-z0-9-]+|statuspage-.*|analytics-.*|assets-.*|rovo-.*|studio-.*)$/i;
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
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
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
  for (const [key, group] of clusters) {
    if (group.length < 2) continue;
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
    if (f.isLocked) continue;
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
        title: `Custom field "${f.name}" has never been given a value`,
        objects: [{ type: 'customField', id: f.id, name: f.name }],
        evidence: [`${f.id}: lastUsed tracked, no value ever recorded`],
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
        evidence: ['No references in permission schemes, issue security levels, project role actors or product access groups.', 'Not checked: filter/dashboard sharing, global permissions, Confluence.'],
        risk: 'low', effort: 'medium',
        recommendation: 'Check filter/dashboard sharing and global permissions; if unused there too, delete the group.',
      });
    }
  }
  return out;
}

function unusedSchemeFindings(schemes: SchemeUse[], rule: Rule, label: string): Finding[] {
  return schemes.filter((s) => s.projectKeys.length === 0).map((s) => ({
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
  { category: 'Custom fields on no screen', weight: 15, rules: ['FIELD_NOT_ON_SCREEN'], total: (d) => d.fields.length },
  { category: 'Unused custom fields', weight: 10, rules: ['FIELD_NEVER_USED', 'FIELD_STALE'], total: (d) => d.fields.length },
  { category: 'Empty or dead groups', weight: 15, rules: ['GROUP_EMPTY_GRANTED', 'GROUP_EMPTY', 'GROUP_UNREFERENCED'], total: (d) => d.groups.filter((g) => !isSystemGroup(g.name)).length },
  { category: 'Unused schemes', weight: 15, rules: ['PERMISSION_SCHEME_UNUSED', 'SECURITY_SCHEME_UNUSED', 'WORKFLOW_SCHEME_UNUSED'], total: (d) => d.permissionSchemes.length + d.securitySchemes.length + d.workflowSchemes.length },
  { category: 'Inactive workflows', weight: 15, rules: ['WORKFLOW_INACTIVE'], total: (d) => d.workflows.total },
  { category: 'Unused screens', weight: 15, rules: ['SCREEN_UNUSED'], total: (d) => d.screens.total },
];

/** Affected objects for a category; a duplicate cluster counts every field in it. */
function affectedCount(findings: Finding[], rules: Rule[]): number {
  return new Set(findings.filter((f) => rules.includes(f.rule)).flatMap((f) => f.objects.map((o) => `${o.type}:${o.id}`))).size;
}

export function score(findings: Finding[], data: ConfigData): { healthScore: number; breakdown: CategoryScore[] } {
  const breakdown = WEIGHTS.map((w) => {
    const total = w.total(data);
    const affected = affectedCount(findings, w.rules);
    // Ratio scaled so 50% sprawl costs the full category weight.
    const penalty = total === 0 ? 0 : Math.min(1, (affected / total) * 2) * w.weight;
    return { category: w.category, weight: w.weight, affected, total, penalty: Math.round(penalty * 10) / 10 };
  });
  const healthScore = Math.max(0, Math.round(100 - breakdown.reduce((s, b) => s + b.penalty, 0)));
  return { healthScore, breakdown };
}

const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const MAX_FINDINGS_PER_RULE = 60;

export function audit(data: ConfigData): AuditResult {
  const findings: Finding[] = [
    ...fieldFindings(data.fields, data.scannedAt),
    ...groupFindings(data),
    ...unusedSchemeFindings(data.permissionSchemes, 'PERMISSION_SCHEME_UNUSED', 'Permission scheme'),
    ...unusedSchemeFindings(data.securitySchemes, 'SECURITY_SCHEME_UNUSED', 'Issue security scheme'),
    ...unusedSchemeFindings(data.workflowSchemes, 'WORKFLOW_SCHEME_UNUSED', 'Workflow scheme'),
    ...data.workflows.inactive.map((w): Finding => ({
      id: fid('WORKFLOW_INACTIVE', w.id), rule: 'WORKFLOW_INACTIVE', title: `Workflow "${w.name}" is inactive`,
      objects: [{ type: 'workflow', id: w.id, name: w.name }], evidence: ['Not used by any active workflow scheme'],
      risk: 'low', effort: 'low', recommendation: 'Delete the inactive workflow (export it first if you want a copy).',
    })),
    ...data.screens.unused.map((s): Finding => ({
      id: fid('SCREEN_UNUSED', s.id), rule: 'SCREEN_UNUSED', title: `Screen "${s.name}" is in no screen scheme`,
      objects: [{ type: 'screen', id: s.id, name: s.name }], evidence: ['Not referenced by any screen scheme'],
      risk: 'low', effort: 'low', recommendation: 'Delete the screen.',
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
    coverage: { projectsScanned: data.projects.scanned, projectsTotal: data.projects.total, complete: data.projects.scanned === data.projects.total },
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
