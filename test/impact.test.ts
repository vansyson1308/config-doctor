import { describe, expect, it } from 'vitest';
import { candidateGroupsAndUsers, impactOfFieldDeletion, impactOfGroupRemoval, impactOfSchemeSwitch } from '../src/core/impact';
import { G, names, payProject, paymentsScheme, people, siteIndex, vendorScheme } from './fixtures/world';

describe('impactOfGroupRemoval', () => {
  const members = [people.max, people.emma, { ...people.kevin, groups: [...people.kevin.groups, G.contractors] }];
  const r = impactOfGroupRemoval(siteIndex, G.contractors, members, names);

  it('the demo case: removing cd-contractors-2024', () => {
    const pay = r.projects.find((p) => p.project === 'PAY')!;
    const vend = r.projects.find((p) => p.project === 'VEND')!;
    // Max loses PAY (role via contractors) and VEND (direct grant).
    expect(pay.loses.BROWSE_PROJECTS).toEqual(['Max Taylor']);
    expect(vend.loses.BROWSE_PROJECTS).toEqual(['Max Taylor', 'Emma Paris']);
    // Emma keeps PAY through cd-dev-vn; Kevin keeps everything through cd-staff-hq.
    expect(pay.keepsAccess.map((k) => k.user)).toContain('Emma Paris');
    expect(pay.keepsAccess.find((k) => k.user === 'Emma Paris')?.via).toContain('cd-dev-vn');
    expect(r.usersLosingBrowse).toBe(2);
    expect(r.risk).toBe('medium');
  });

  it('lists every reference to the group', () => {
    expect(r.references).toEqual(expect.arrayContaining([
      'actor of role CD Developers in PAY',
      'BROWSE_PROJECTS in permission scheme "CD Vendor Permission Scheme"',
      'EDIT_ISSUES in permission scheme "CD Vendor Permission Scheme"',
    ]));
  });

  it('also reports non-browse permissions lost (edit/transition)', () => {
    const vend = r.projects.find((p) => p.project === 'VEND')!;
    expect(vend.loses.EDIT_ISSUES).toEqual(expect.arrayContaining(['Max Taylor', 'Emma Paris']));
    const pay = r.projects.find((p) => p.project === 'PAY')!;
    // Kevin (also a contractor in this fixture) loses the role-based transition right but keeps Browse via cd-staff-hq.
    expect(pay.loses.TRANSITION_ISSUES).toEqual(['Max Taylor', 'Kevin Campbell']);
  });

  it('an empty group changes nothing today and says so', () => {
    const e = impactOfGroupRemoval(siteIndex, G.legacy, [], names);
    expect(e.usersLosingBrowse).toBe(0);
    expect(e.risk).toBe('low');
    expect(e.notes.join(' ')).toMatch(/no members/);
  });

  it('flags admin loss as high risk', () => {
    const admins = impactOfGroupRemoval(siteIndex, G.admins, [people.owner], names);
    expect(admins.projects.find((p) => p.project === 'PAY')?.loses.ADMINISTER_PROJECTS).toEqual(['Sơn Owner']);
    expect(admins.risk).toBe('high');
  });
});

describe('impactOfSchemeSwitch', () => {
  it('PAY switching to the vendor scheme: who loses and who gains', () => {
    const cands = [people.emma, people.cassi, people.max, people.kevin, people.outsider];
    const r = impactOfSchemeSwitch(payProject, paymentsScheme, vendorScheme, cands, names);
    const p = r.projects[0]!;
    expect(p.loses.BROWSE_PROJECTS).toEqual(['Cassi Owens']);
    expect(p.loses.TRANSITION_ISSUES).toEqual(expect.arrayContaining(['Emma Paris', 'Cassi Owens', 'Max Taylor']));
    expect(r.usersLosingBrowse).toBe(1);
    expect(r.change).toContain('CD Vendor Permission Scheme');
  });

  it('warns when the new scheme opens the project to everyone', () => {
    const open = { ...vendorScheme, name: 'Open', grants: [{ permission: 'BROWSE_PROJECTS', holder: { type: 'applicationRole' } }] };
    const r = impactOfSchemeSwitch(payProject, paymentsScheme, open, [people.outsider], names);
    expect(r.risk).toBe('high');
    expect(r.projects[0]!.gains.BROWSE_PROJECTS).toEqual(['Olive Outsider']);
    expect(r.notes.join(' ')).toMatch(/site-wide/);
  });

  it('collects candidates from both schemes (groups via roles too)', () => {
    const c = candidateGroupsAndUsers(payProject, [paymentsScheme, vendorScheme]);
    expect(c.groups.map((g) => g.name).sort()).toEqual(['cd-contractors-2024', 'cd-dev-vn', 'cd-payments-admins', 'cd-staff-hq']);
    expect(c.userIds).toContain('acc-owner');
  });
});

describe('impactOfFieldDeletion', () => {
  const base = { field: { id: 'customfield_1', name: 'CD Sprint Goal' }, screens: [], contexts: 1, filters: [], permissionGrants: [], securityLevels: [], issuesWithValue: 0, lastUsed: null };
  it('low risk when unused everywhere', () => {
    expect(impactOfFieldDeletion(base).risk).toBe('low');
  });
  it('medium with data or screens, high when it drives access', () => {
    expect(impactOfFieldDeletion({ ...base, issuesWithValue: 12, screens: ['Default Screen'] }).risk).toBe('medium');
    const r = impactOfFieldDeletion({ ...base, permissionGrants: ['BROWSE_PROJECTS in "X"'] });
    expect(r.risk).toBe('high');
    expect(r.references).toContain('grants BROWSE_PROJECTS in "X"');
  });
});
