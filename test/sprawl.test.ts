import { describe, expect, it } from 'vitest';
import { audit, canonicalName, fieldFindings, groupFindings, isSystemGroup, type ConfigData, type FieldInfo } from '../src/core/sprawl';

const NOW = '2026-10-30T00:00:00Z';
const f = (id: string, name: string, extra: Partial<FieldInfo> = {}): FieldInfo => ({ id, name, screensCount: 1, contextsCount: 1, lastUsed: { type: 'TRACKED', value: '2026-10-01T00:00:00Z' }, ...extra });

function data(over: Partial<ConfigData> = {}): ConfigData {
  return {
    scannedAt: NOW,
    fields: [],
    groups: [],
    groupReferences: {},
    groupGrants: [],
    permissionSchemes: [],
    securitySchemes: [],
    workflowSchemes: [],
    workflows: { total: 0, inactive: [] },
    screens: { total: 0, unused: [] },
    projects: { total: 2, scanned: 2 },
    ...over,
  };
}

describe('canonicalName', () => {
  it.each([
    ['CD Sprint Goal', 'cd sprint goal'], ['CD Sprint goal', 'cd sprint goal'], ['CD Sprint Goal (old)', 'cd sprint goal'],
    ['CD Customer tier ', 'cd customer tier'], ['CD Cust. Tier', 'cd customer tier'], ['CD Legacy Region 2', 'cd region 2'],
    ['CD Release train (copy)', 'cd release train'], ['Story Points', 'story points'],
  ])('%s → %s', (name, key) => expect(canonicalName(name)).toBe(key));
});

describe('fieldFindings', () => {
  it('clusters near-duplicates and leaves distinct fields alone', () => {
    const out = fieldFindings([f('1', 'CD Sprint Goal'), f('2', 'CD Sprint goal'), f('3', 'CD Sprint Goal (old)'), f('4', 'Story Points')], NOW);
    const dup = out.filter((x) => x.rule === 'FIELD_DUPLICATE_NAME');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.objects.map((o) => o.id)).toEqual(['1', '2', '3']);
    expect(dup[0]!.evidence[0]).toContain('screens');
  });

  it('flags fields on no screen, never used, stale; skips locked fields', () => {
    const out = fieldFindings([
      f('10', 'A', { screensCount: 0 }),
      f('11', 'B', { lastUsed: { type: 'NO_INFORMATION' } }),
      f('12', 'C', { lastUsed: { type: 'TRACKED', value: '2025-01-01T00:00:00Z' } }),
      f('13', 'D', { screensCount: 0, isLocked: true }),
      f('14', 'E', { lastUsed: { type: 'NOT_TRACKED' } }),
    ], NOW);
    expect(out.map((x) => `${x.rule}:${x.objects[0]!.id}`).sort()).toEqual(['FIELD_NEVER_USED:11', 'FIELD_NOT_ON_SCREEN:10', 'FIELD_STALE:12']);
  });

  it('produces stable ids', () => {
    const a = fieldFindings([f('10', 'A', { screensCount: 0 })], NOW)[0]!.id;
    const b = fieldFindings([f('10', 'A', { screensCount: 0 })], NOW)[0]!.id;
    expect(a).toBe(b);
    expect(a).toMatch(/^FNOS-[0-9a-z]+$/);
  });
});

describe('groupFindings', () => {
  it('distinguishes empty-but-granted, empty, and unreferenced groups; ignores system groups', () => {
    const out = groupFindings({
      groups: [
        { id: 'g1', name: 'cd-old-reviewers', memberCount: 0 },
        { id: 'g2', name: 'cd-legacy-empty', memberCount: 0 },
        { id: 'g3', name: 'marketing-2019', memberCount: 4 },
        { id: 'g4', name: 'cd-staff-hq', memberCount: 3 },
        { id: 'g5', name: 'site-admins', memberCount: 0 },
        { id: 'g6', name: 'jira-software-users-acme', memberCount: 9 },
      ],
      groupReferences: { g1: ['grant BROWSE in CD Payments'], g2: ['grant BROWSE in CD Legacy Scheme (copy)'], g4: ['grant BROWSE in CD Payments'] },
      groupGrants: [{ schemeId: '1', schemeName: 'CD Payments Permission Scheme', permission: 'BROWSE_PROJECTS', groupId: 'g1' }],
    });
    const byGroup = Object.fromEntries(out.map((x) => [x.objects[0]!.name + ':' + x.rule, x]));
    expect(byGroup['cd-old-reviewers:GROUP_EMPTY_GRANTED']?.risk).toBe('medium');
    expect(byGroup['cd-legacy-empty:GROUP_EMPTY']).toBeDefined();
    expect(byGroup['marketing-2019:GROUP_UNREFERENCED']).toBeDefined();
    expect(out.some((x) => /site-admins|jira-software-users|cd-staff-hq/.test(x.objects[0]!.name))).toBe(false);
  });
  it('system group patterns', () => {
    expect(isSystemGroup('atlassian-addons-admin')).toBe(true);
    expect(isSystemGroup('cd-contractors-2024')).toBe(false);
  });
});

describe('audit', () => {
  const messy = data({
    fields: [f('1', 'CD Sprint Goal', { screensCount: 0 }), f('2', 'CD Sprint goal', { screensCount: 0 }), f('3', 'Team'), f('4', 'Severity')],
    groups: [{ id: 'g2', name: 'cd-legacy-empty', memberCount: 0 }, { id: 'g4', name: 'cd-staff-hq', memberCount: 3 }],
    groupReferences: { g4: ['x'] },
    permissionSchemes: [{ id: '1', name: 'CD Legacy Scheme (copy)', projectKeys: [] }, { id: '2', name: 'Default', projectKeys: ['PAY'] }],
    workflowSchemes: [{ id: '5', name: 'WS', projectKeys: ['PAY'] }],
    workflows: { total: 4, inactive: [{ id: 'w1', name: 'Old flow' }] },
    screens: { total: 10, unused: [{ id: 's1', name: 'Old screen' }] },
  });

  it('scores a messy site below a clean one and explains the score', () => {
    const many = data({
      fields: Array.from({ length: 40 }, (_, i) => f(String(i), `Field ${i}`, i < 20 ? { screensCount: 0 } : {})),
      screens: { total: 43, unused: Array.from({ length: 20 }, (_, i) => ({ id: String(100 + i), name: `S${i}` })) },
      workflows: { total: 30, inactive: Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, name: `W${i}` })) },
    });
    expect(audit(many).healthScore).toBeLessThan(80);
    const r = audit(messy);
    const clean = audit(data({ fields: [f('3', 'Team')], groups: [{ id: 'g4', name: 'cd-staff-hq', memberCount: 3 }], groupReferences: { g4: ['x'] }, workflows: { total: 4, inactive: [] }, screens: { total: 10, unused: [] } }));
    expect(clean.healthScore).toBe(100);
    expect(r.healthScore).toBeLessThan(100);
    expect(Math.abs(r.breakdown.reduce((s, b) => s + b.penalty, 0) - (100 - r.healthScore))).toBeLessThanOrEqual(0.5);
    expect(r.breakdown.find((b) => b.category === 'Duplicate custom fields')).toMatchObject({ affected: 2, total: 4 });
  });

  it('counts every rule and ranks medium-risk findings first', () => {
    const r = audit(messy);
    expect(r.counts).toMatchObject({ FIELD_DUPLICATE_NAME: 1, FIELD_NOT_ON_SCREEN: 2, GROUP_EMPTY: 1, PERMISSION_SCHEME_UNUSED: 1, WORKFLOW_INACTIVE: 1, SCREEN_UNUSED: 1 });
    expect(r.findings[0]!.risk).toBe('medium');
    expect(r.coverage.complete).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(audit(messy))).toBe(JSON.stringify(audit(messy)));
  });

  it('reports incomplete coverage', () => {
    expect(audit(data({ projects: { total: 10, scanned: 7 } })).coverage).toMatchObject({ projectsScanned: 7, projectsTotal: 10, complete: false });
  });
});

import { groupReferenceIndex } from '../src/core/references';

describe('groupReferenceIndex', () => {
  it('collects grants, security levels, role actors and product access by id and name', () => {
    const refs = groupReferenceIndex({
      projects: [{ key: 'PAY', name: 'Pay', style: 'classic', schemeId: 1, securityLevels: [], roles: { r1: { id: 'r1', name: 'Dev', userIds: [], groups: [{ id: 'g-dev', name: 'cd-dev-vn' }] } } }],
      schemes: { schemes: [], grants: [], schemeGroupRefs: [{ group: 'g-staff', ref: 'BROWSE_PROJECTS in permission scheme "X"' }] },
      security: { schemes: [], groupRefs: [{ group: 'g-staff', ref: 'member of issue security level 1' }] },
      productAccessGroups: ['jira-users'],
    });
    expect(refs['g-staff']).toHaveLength(2);
    expect(refs['g-dev']).toEqual(['role Dev in PAY']);
    expect(refs['cd-dev-vn']).toEqual(['role Dev in PAY']);
    expect(refs['jira-users']).toEqual(['product access group']);
  });
});

import { filterFindings, rulesForCategory } from '../src/core/sprawl';

describe('rulesForCategory / filterFindings', () => {
  it.each([
    ['duplicate fields', ['FIELD_DUPLICATE_NAME']],
    ['fields not on any screen', ['FIELD_NOT_ON_SCREEN']],
    ['empty groups', ['GROUP_EMPTY_GRANTED', 'GROUP_EMPTY', 'GROUP_UNREFERENCED']],
    ['unused permission schemes', ['PERMISSION_SCHEME_UNUSED']],
    ['workflow schemes', ['WORKFLOW_SCHEME_UNUSED']],
    ['inactive workflows', ['WORKFLOW_INACTIVE']],
    ['SCREEN_UNUSED', ['SCREEN_UNUSED']],
  ])('%s', (text, rules) => expect(rulesForCategory(text)).toEqual(rules));

  it('unknown categories return null', () => expect(rulesForCategory('bananas')).toBeNull());

  it('filters by rule and name fragment', () => {
    const r = audit(data({ fields: [f('1', 'CD Sprint Goal', { screensCount: 0 }), f('2', 'CD Sprint goal'), f('3', 'Other', { screensCount: 0 })] }));
    expect(filterFindings(r.findings, ['FIELD_NOT_ON_SCREEN']).map((x) => x.objects[0]!.id).sort()).toEqual(['1', '3']);
    expect(filterFindings(r.findings, ['FIELD_NOT_ON_SCREEN'], 'sprint').map((x) => x.objects[0]!.id)).toEqual(['1']);
  });
});

import { isDefaultScheme, isManagedField } from '../src/core/sprawl';

describe('fresh-site fairness (product defaults are not sprawl)', () => {
  it('never flags product-managed or template fields as unused / screen-less', () => {
    const r = audit(data({ fields: [
      f('1', 'Approvers', { screensCount: 0, lastUsed: { type: 'NO_INFORMATION' }, customType: 'com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker' }),
      f('2', 'Sprint', { screensCount: 0, customType: 'com.pyxis.greenhopper.jira:gh-sprint' }),
      f('3', 'My Field', { screensCount: 0, customType: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' }),
    ] }));
    expect(r.findings.map((x) => x.objects[0]!.name)).toEqual(['My Field']);
    expect(isManagedField({ id: 'x', name: 'Story point estimate', customType: 'com.pyxis.greenhopper.jira:jsw-story-points' })).toBe(true);
  });

  it('still reports duplicates that involve an admin-created field', () => {
    const r = audit(data({ fields: [
      f('1', 'Story Points', { customType: 'com.atlassian.jira.plugin.system.customfieldtypes:float' }),
      f('2', 'Story points', { customType: 'com.atlassian.jira.plugin.system.customfieldtypes:float' }),
      f('3', 'Sprint', { customType: 'com.pyxis.greenhopper.jira:gh-sprint' }),
      f('4', 'Sprint (old)', { customType: 'com.pyxis.greenhopper.jira:gh-sprint' }),
    ] }));
    expect(r.counts.FIELD_DUPLICATE_NAME).toBe(1);
  });

  it('ignores default schemes, system screens and non-editable workflows', () => {
    const r = audit(data({
      permissionSchemes: [{ id: '0', name: 'Default Permission Scheme', projectKeys: [] }, { id: '5', name: 'Default software scheme', projectKeys: [] }, { id: '9', name: 'Old', projectKeys: [] }],
      screens: { total: 4, unused: [{ id: '1', name: 'Default Screen' }, { id: '7', name: 'Mine' }] },
      workflows: { total: 2, inactive: [{ id: 'jira', name: 'jira', isEditable: false }, { id: 'w', name: 'Copy of jira' }] },
    }));
    expect(r.findings.map((x) => x.objects[0]!.name).sort()).toEqual(['Copy of jira', 'Mine', 'Old']);
    expect(isDefaultScheme({ id: '10000', name: 'Default software scheme', projectKeys: [] })).toBe(true);
  });

  it('damps penalties for tiny categories (an empty new site is not "sprawling")', () => {
    const fresh = audit(data({ permissionSchemes: [{ id: '9', name: 'Spare', projectKeys: [] }, { id: '8', name: 'Spare 2', projectKeys: [] }], projects: { total: 0, scanned: 0 } }));
    const unused = fresh.breakdown.find((b) => b.category === 'Unused schemes')!;
    expect(unused).toMatchObject({ affected: 2, total: 2 });
    expect(unused.penalty).toBeLessThanOrEqual(1.5);
    expect(fresh.healthScore).toBeGreaterThanOrEqual(95);
  });
});

describe('review fixes: numbered fields, coverage gaps', () => {
  it('numbered variants merge only with an un-numbered sibling', () => {
    const merged = fieldFindings([f('1', 'CD Legacy Region'), f('2', 'CD Legacy Region 2')], NOW).filter((x) => x.rule === 'FIELD_DUPLICATE_NAME');
    expect(merged).toHaveLength(1);
    const deliberate = fieldFindings([f('3', 'Approver 1'), f('4', 'Approver 2')], NOW).filter((x) => x.rule === 'FIELD_DUPLICATE_NAME');
    expect(deliberate).toHaveLength(0);
  });

  it('withholds unused-scheme advice when the scan has coverage gaps', () => {
    const schemes = [{ id: '9', name: 'Maybe used', projectKeys: [] }];
    expect(audit(data({ permissionSchemes: schemes })).counts.PERMISSION_SCHEME_UNUSED).toBe(1);
    const gap = audit(data({ permissionSchemes: schemes, coverageGaps: ['project HID returned 403'] }));
    expect(gap.counts.PERMISSION_SCHEME_UNUSED).toBe(0);
    expect(gap.coverage.complete).toBe(false);
    expect(gap.coverage.gaps.join(' ')).toMatch(/withheld/);
    const partial = audit(data({ permissionSchemes: schemes, projects: { total: 3, scanned: 2 } }));
    expect(partial.counts.PERMISSION_SCHEME_UNUSED).toBe(0);
  });

  it('lists every finding id for exact diffs', () => {
    const r = audit(data({ fields: [f('1', 'A', { screensCount: 0 })] }));
    expect(r.allFindingIds).toEqual(r.findings.map((x) => x.id));
  });
});
