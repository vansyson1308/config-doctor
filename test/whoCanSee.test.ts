import { describe, expect, it } from 'vitest';
import { whoCanSee, type Member, type WhoCanSeeInput } from '../src/core/whoCanSee';
import { G, issues, names, payProject, paymentsScheme, U } from './fixtures/world';

const m = (accountId: string, displayName: string, active = true): Member => ({ accountId, displayName, active });
const emma = m(U.emma, 'Emma Paris');
const kevin = m(U.kevin, 'Kevin Campbell');
const max = m(U.max, 'Max Taylor');
const cassi = m(U.cassi, 'Cassi Owens');
const owner = m(U.owner, 'Sơn Owner');
const gone = m('acc-gone', 'Former Staff', false);

function input(over: Partial<WhoCanSeeInput> = {}): WhoCanSeeInput {
  return {
    project: payProject,
    scheme: paymentsScheme,
    issue: issues.open,
    names,
    groupMembers: {
      [G.staff.id]: [kevin, owner, gone],
      [G.devVn.id]: [emma, cassi],
      [G.contractors.id]: [max, emma],
    },
    people: { [U.kevin]: kevin, [U.owner]: owner },
    ...over,
  };
}

describe('whoCanSee', () => {
  it('lists every active viewer of an unrestricted issue with all their paths', () => {
    const r = whoCanSee(input());
    expect(r.viewers.map((v) => v.displayName)).toEqual(['Cassi Owens', 'Emma Paris', 'Kevin Campbell', 'Max Taylor', 'Sơn Owner']);
    const e = r.viewers.find((v) => v.displayName === 'Emma Paris')!;
    expect(e.paths).toEqual(expect.arrayContaining(['role CD Developers via group cd-dev-vn', 'role CD Developers via group cd-contractors-2024']));
    expect(r.viewers.find((v) => v.displayName === 'Kevin Campbell')!.paths).toEqual(expect.arrayContaining(['group cd-staff-hq', 'reporter of PAY-1']));
    expect(r.viewers.some((v) => v.displayName === 'Former Staff')).toBe(false);
  });

  it('applies the issue security level: "Internal only" keeps only cd-staff-hq', () => {
    const r = whoCanSee(input({ issue: issues.internal }));
    expect(r.viewers.map((v) => v.displayName)).toEqual(['Kevin Campbell', 'Sơn Owner']);
    const roleRow = r.holders.find((h) => h.holder === 'role CD Developers')!;
    expect(roleRow).toEqual({ holder: 'role CD Developers', members: 3, afterSecurity: 0 });
    expect(r.notes[0]).toContain('Internal only');
  });

  it('agrees with Jira when the lists match and names the differences when they do not', () => {
    const ok = whoCanSee(input({ issue: issues.internal, jiraUsers: [kevin, owner] }));
    expect(ok.groundTruth).toEqual({ check: 'AGREES', jiraCount: 2 });
    const diff = whoCanSee(input({ issue: issues.internal, jiraUsers: [kevin, emma] }));
    expect(diff.groundTruth).toMatchObject({ check: 'DISAGREES', onlyJiraSees: ['Emma Paris'], onlyModelSees: ['Sơn Owner'] });
  });

  it('does not report model-only viewers when Jira\'s list was truncated', () => {
    const r = whoCanSee(input({ jiraUsers: [kevin], jiraListTruncated: true }));
    expect(r.groundTruth.onlyModelSees).toBeUndefined();
  });

  it('flags broad grants instead of pretending to enumerate them', () => {
    const scheme = { ...paymentsScheme, grants: [...paymentsScheme.grants, { permission: 'BROWSE_PROJECTS', holder: { type: 'applicationRole' } }] };
    const r = whoCanSee(input({ scheme }));
    expect(r.broadGrants).toEqual(['any logged-in user']);
    expect(r.notes.join(' ')).toMatch(/authoritative/);
    expect(whoCanSee(input({ scheme })).groundTruth.check).toBe('UNAVAILABLE');
  });

  it('skips the app access role and matches security-level groups given by name only', () => {
    const level = { ...issues.internal.securityLevel, members: [{ type: 'group', parameter: 'cd-staff-hq' }] };
    const r = whoCanSee(input({ issue: { ...issues.internal, securityLevel: level } }));
    expect(r.holders.some((h) => /addons/.test(h.holder))).toBe(false);
    expect(r.viewers.map((v) => v.displayName)).toEqual(['Kevin Campbell', 'Sơn Owner']);
  });
});
