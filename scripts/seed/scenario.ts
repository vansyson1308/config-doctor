// The demo scenario the seeder creates. Every object name is prefixed "CD" / "cd-" so it is easy to
// recognise, and the seeder only ever creates or updates these objects.
// Demo users are EXISTING users on the target site (owner decision: no invites/new accounts).

export const DEMO_USERS = {
  /** The "Why can't Linh see PAY-3?" subject. */
  subject: 'Emma Paris',
  staff: ['Kevin Campbell', 'Alana Grant'],
  devVn: ['Emma Paris', 'Cassi Owens'],
  contractors: ['Max Taylor', 'Ryan Lee', 'Emma Paris'],
} as const;

export const GROUPS = {
  staffHq: 'cd-staff-hq',
  devVn: 'cd-dev-vn',
  contractors: 'cd-contractors-2024',
  paymentsAdmins: 'cd-payments-admins',
  legacyEmpty: 'cd-legacy-empty',
  oldReviewers: 'cd-old-reviewers',
} as const;

export const ROLE_DEVELOPERS = 'CD Developers';

export const SCHEMES = {
  payments: 'CD Payments Permission Scheme',
  vendor: 'CD Vendor Permission Scheme',
  legacyUnused: 'CD Legacy Scheme (copy)',
} as const;

export const SECURITY_SCHEME = 'CD Payments Security';
export const SECURITY_LEVELS = { internal: 'Internal only', team: 'Payments team' } as const;

export const PROJECTS = {
  payments: {
    key: 'PAY',
    name: 'CD Payments Platform',
    projectTypeKey: 'software',
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
  },
  vendor: {
    key: 'VEND',
    name: 'CD Vendor Portal',
    projectTypeKey: 'business',
    projectTemplateKey: 'com.atlassian.jira-core-project-templates:jira-core-simplified-process-control',
  },
} as const;

/** Issues per project, in creation order. `security` names a level in SECURITY_LEVELS. */
export const ISSUES: Record<'PAY' | 'VEND', Array<{ summary: string; security?: keyof typeof SECURITY_LEVELS }>> = {
  PAY: [
    { summary: 'CD: Card tokenisation service' },
    { summary: 'CD: Refund API rate limits' },
    { summary: 'CD: Fraud rule thresholds (confidential)', security: 'internal' },
    { summary: 'CD: Settlement report export', security: 'team' },
    { summary: 'CD: PCI evidence collection' },
  ],
  VEND: [
    { summary: 'CD: Vendor onboarding checklist' },
    { summary: 'CD: Contractor laptop return' },
    { summary: 'CD: Invoice portal access request' },
  ],
};

/** Custom fields: deliberate near-duplicates and fields on no screen (sprawl audit targets). */
export const CUSTOM_FIELDS = [
  'CD Sprint Goal',
  'CD Sprint goal',
  'CD Sprint Goal (old)',
  'CD Customer Tier',
  'CD Customer tier ',
  'CD Cust. Tier',
  'CD Legacy Region',
  'CD Legacy Region 2',
  'CD Temp Field 2023',
  'CD Release Train',
  'CD Release train (copy)',
  'CD Cost Center',
];

type Holder = { type: string; parameter?: string; value?: string };
export interface Grant { permission: string; holder: Holder }

/** Builds permission grants once group ids and role ids are known. */
export function paymentsGrants(ids: { staffHq: string; paymentsAdmins: string; oldReviewers: string; devRole: string; addonsRole: string }): Grant[] {
  const role = (id: string): Holder => ({ type: 'projectRole', value: id });
  const group = (id: string): Holder => ({ type: 'group', value: id });
  const memberPerms = ['CREATE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES', 'ADD_COMMENTS', 'ASSIGNABLE_USER', 'ASSIGN_ISSUES', 'RESOLVE_ISSUES', 'CLOSE_ISSUES', 'LINK_ISSUES', 'CREATE_ATTACHMENTS', 'WORK_ON_ISSUES', 'SET_ISSUE_SECURITY'];
  return [
    { permission: 'BROWSE_PROJECTS', holder: role(ids.devRole) },
    { permission: 'BROWSE_PROJECTS', holder: group(ids.staffHq) },
    { permission: 'BROWSE_PROJECTS', holder: role(ids.addonsRole) },
    { permission: 'BROWSE_PROJECTS', holder: group(ids.oldReviewers) },
    { permission: 'BROWSE_PROJECTS', holder: { type: 'reporter' } },
    ...memberPerms.map((p) => ({ permission: p, holder: role(ids.devRole) })),
    { permission: 'EDIT_ISSUES', holder: group(ids.staffHq) },
    { permission: 'ADMINISTER_PROJECTS', holder: group(ids.paymentsAdmins) },
    { permission: 'MODIFY_REPORTER', holder: group(ids.paymentsAdmins) },
    { permission: 'CREATE_ISSUES', holder: group(ids.paymentsAdmins) },
    { permission: 'SET_ISSUE_SECURITY', holder: group(ids.paymentsAdmins) },
    { permission: 'DELETE_ISSUES', holder: { type: 'projectLead' } },
  ];
}

export function vendorGrants(ids: { contractors: string; staffHq: string; paymentsAdmins: string; addonsRole: string }): Grant[] {
  const group = (id: string): Holder => ({ type: 'group', value: id });
  return [
    { permission: 'BROWSE_PROJECTS', holder: group(ids.contractors) },
    { permission: 'BROWSE_PROJECTS', holder: group(ids.staffHq) },
    { permission: 'BROWSE_PROJECTS', holder: { type: 'projectRole', value: ids.addonsRole } },
    { permission: 'CREATE_ISSUES', holder: group(ids.contractors) },
    { permission: 'EDIT_ISSUES', holder: group(ids.contractors) },
    { permission: 'TRANSITION_ISSUES', holder: group(ids.contractors) },
    { permission: 'ADD_COMMENTS', holder: group(ids.contractors) },
    { permission: 'CREATE_ISSUES', holder: group(ids.paymentsAdmins) },
    { permission: 'ADMINISTER_PROJECTS', holder: group(ids.paymentsAdmins) },
  ];
}

export function legacyGrants(ids: { legacyEmpty: string }): Grant[] {
  return [{ permission: 'BROWSE_PROJECTS', holder: { type: 'group', value: ids.legacyEmpty } }];
}
