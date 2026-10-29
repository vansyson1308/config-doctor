// A small, fully specified Jira "world" mirroring the seeded demo scenario, plus builders for variants.
import type { Grant, GroupRef, IssueModel, NameIndex, PermissionScheme, ProjectModel, SubjectUser } from '../../src/core/model';
import type { SiteIndex } from '../../src/core/siteIndex';

export const G = {
  staff: { id: 'g-staff', name: 'cd-staff-hq' },
  devVn: { id: 'g-dev', name: 'cd-dev-vn' },
  contractors: { id: 'g-con', name: 'cd-contractors-2024' },
  admins: { id: 'g-adm', name: 'cd-payments-admins' },
  legacy: { id: 'g-leg', name: 'cd-legacy-empty' },
  everyone: { id: 'g-all', name: 'jira-users' },
} satisfies Record<string, GroupRef>;

export const ROLE_DEV = '10100';
export const ROLE_ADDONS = '10003';

export const U = {
  emma: 'acc-emma',
  kevin: 'acc-kevin',
  max: 'acc-max',
  owner: 'acc-owner',
  cassi: 'acc-cassi',
};

export const names: NameIndex = {
  roles: { [ROLE_DEV]: 'CD Developers', [ROLE_ADDONS]: 'atlassian-addons-project-access' },
  groupsById: Object.fromEntries(Object.values(G).map((g) => [g.id, g.name])),
  fields: { customfield_10200: 'Approver', customfield_10201: 'Owning team' },
};

const group = (g: GroupRef) => ({ type: 'group', parameter: g.name, value: g.id });
const role = (id: string) => ({ type: 'projectRole', parameter: id, value: id });

export const paymentsScheme: PermissionScheme = {
  id: 11001,
  name: 'CD Payments Permission Scheme',
  grants: [
    { permission: 'BROWSE_PROJECTS', holder: role(ROLE_DEV) },
    { permission: 'BROWSE_PROJECTS', holder: group(G.staff) },
    { permission: 'BROWSE_PROJECTS', holder: role(ROLE_ADDONS) },
    { permission: 'BROWSE_PROJECTS', holder: { type: 'reporter' } },
    { permission: 'EDIT_ISSUES', holder: role(ROLE_DEV) },
    { permission: 'EDIT_ISSUES', holder: group(G.staff) },
    { permission: 'TRANSITION_ISSUES', holder: role(ROLE_DEV) },
    { permission: 'ADMINISTER_PROJECTS', holder: group(G.admins) },
    { permission: 'DELETE_ISSUES', holder: { type: 'projectLead' } },
  ],
};

export const vendorScheme: PermissionScheme = {
  id: 11002,
  name: 'CD Vendor Permission Scheme',
  grants: [
    { permission: 'BROWSE_PROJECTS', holder: group(G.contractors) },
    { permission: 'BROWSE_PROJECTS', holder: group(G.staff) },
    { permission: 'EDIT_ISSUES', holder: group(G.contractors) },
  ],
};

export const payProject: ProjectModel = {
  id: '20001',
  key: 'PAY',
  name: 'CD Payments Platform',
  leadAccountId: U.owner,
  style: 'classic',
  roles: {
    [ROLE_DEV]: { id: ROLE_DEV, name: 'CD Developers', userIds: [], groups: [G.devVn, G.contractors] },
    [ROLE_ADDONS]: { id: ROLE_ADDONS, name: 'atlassian-addons-project-access', userIds: ['acc-app'], groups: [] },
  },
};

export const internalOnly = {
  id: '30001', name: 'Internal only', schemeId: '40001', schemeName: 'CD Payments Security',
  members: [group(G.staff)],
};
export const paymentsTeam = {
  id: '30002', name: 'Payments team', schemeId: '40001', schemeName: 'CD Payments Security',
  members: [role(ROLE_DEV), group(G.staff)],
};

export const issues = {
  open: { key: 'PAY-1', id: '1', reporterId: U.kevin },
  internal: { key: 'PAY-3', id: '3', reporterId: U.kevin, securityLevel: internalOnly },
  team: { key: 'PAY-4', id: '4', reporterId: U.kevin, securityLevel: paymentsTeam },
} satisfies Record<string, IssueModel>;

export function user(accountId: string, displayName: string, groups: GroupRef[], extra: Partial<SubjectUser> = {}): SubjectUser {
  return { accountId, displayName, active: true, groups, ...extra };
}

export const people = {
  emma: user(U.emma, 'Emma Paris', [G.devVn, G.contractors]),
  kevin: user(U.kevin, 'Kevin Campbell', [G.staff]),
  max: user(U.max, 'Max Taylor', [G.contractors]),
  cassi: user(U.cassi, 'Cassi Owens', [G.devVn]),
  owner: user(U.owner, 'Sơn Owner', [G.staff, G.admins]),
  outsider: user('acc-out', 'Olive Outsider', [G.everyone]),
};

export const siteIndex: SiteIndex = {
  builtAt: '2026-10-30T00:00:00Z',
  schemes: { [paymentsScheme.id]: paymentsScheme, [vendorScheme.id]: vendorScheme },
  groupSizes: { [G.staff.id]: 3, [G.contractors.id]: 3, [G.devVn.id]: 2 },
  projects: [
    { key: 'PAY', name: payProject.name, style: 'classic', schemeId: paymentsScheme.id, roles: payProject.roles, securityLevels: [internalOnly, paymentsTeam] },
    { key: 'VEND', name: 'CD Vendor Portal', style: 'classic', schemeId: vendorScheme.id, roles: {}, securityLevels: [] },
  ],
};

export function schemeWith(grants: Grant[], base: PermissionScheme = paymentsScheme): PermissionScheme {
  return { ...base, grants };
}

export const BASE = 'https://example.atlassian.net';
