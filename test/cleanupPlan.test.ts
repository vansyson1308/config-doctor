import { describe, expect, it } from 'vitest';
import { buildCleanupPlan, parseFindingIds, selectFindings } from '../src/core/cleanupPlan';
import type { Finding } from '../src/core/sprawl';

const finding = (id: string, risk: Finding['risk'] = 'low'): Finding => ({
  id, rule: 'GROUP_EMPTY', title: `Group ${id} has no members`, objects: [{ type: 'group', id, name: id }],
  evidence: ['0 members'], risk, effort: 'low', recommendation: 'Delete the group.',
});

describe('cleanup plan', () => {
  const all = [finding('GE-a1', 'medium'), finding('GE-b2'), finding('GE-c3')];

  it('parses finding ids from free text, ignoring junk', () => {
    expect(parseFindingIds('GE-a1, ge-b2;  nonsense FDN-zz9')).toEqual(['GE-a1', 'ge-b2', 'FDN-zz9']);
    expect(parseFindingIds(undefined)).toEqual([]);
  });

  it('selects by id case-insensitively and reports unknown ids', () => {
    const r = selectFindings(all, ['ge-c3', 'GE-a1', 'GE-zz']);
    expect(r.selected.map((f) => f.id)).toEqual(['GE-c3', 'GE-a1']);
    expect(r.unknown).toEqual(['GE-zz']);
  });

  it('defaults to the top ranked findings', () => {
    expect(selectFindings(all, [], 2).selected.map((f) => f.id)).toEqual(['GE-a1', 'GE-b2']);
  });

  it('builds an epic and one labelled task per finding with evidence in ADF', () => {
    const plan = buildCleanupPlan('PAY', all, '2026-10-30T10:00:00Z', 54);
    expect(plan.epic.summary).toContain('health score 54');
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0]).toMatchObject({ labels: ['config-doctor-cleanup'], findingId: 'GE-a1' });
    expect(plan.tasks[0]!.summary).toMatch(/^\[MEDIUM risk \/ low effort\]/);
    expect(JSON.stringify(plan.tasks[0]!.description)).toContain('0 members');
    expect(plan.skipped).toEqual([]);
  });

  it('caps the plan at 25 tasks and lists the rest as skipped', () => {
    const many = Array.from({ length: 30 }, (_, i) => finding(`GE-${i}`));
    const plan = buildCleanupPlan('PAY', many, '2026-10-30T10:00:00Z', 40);
    expect(plan.tasks).toHaveLength(25);
    expect(plan.skipped).toHaveLength(5);
  });
});
