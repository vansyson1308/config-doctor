// Demo Lab: an opt-in, self-contained scenario the app creates (and later removes) so judges can try
// Config Doctor on their own, nearly empty site. Pure: names, grants, previews. No Jira calls here.
//
// Story the lab enables (using only the installing admin's account):
// - the admin can browse CDLAB through role "cdlab-developers" via group "cdlab-contractors";
// - CDLAB-2 sits at security level "Lab restricted" (group cdlab-staff + the app) → the admin cannot see it:
//   "Why can't I see CDLAB-2?" → NO_ACCESS via ISSUE_SECURITY, fix "add me to cdlab-staff";
// - removing cdlab-contractors would cost the admin Browse/Create/Edit/Transition in CDLAB;
// - cdlab-old-reviewers is empty but still holds Browse (a backdoor finding);
// - three near-duplicate fields "CD Lab Sprint Goal / goal / (old)" on no screen.

export const LAB = {
  projectKey: 'CDLAB',
  projectName: 'Config Doctor Demo Lab',
  groups: { staff: 'cdlab-staff', contractors: 'cdlab-contractors', oldReviewers: 'cdlab-old-reviewers' },
  role: 'cdlab-developers',
  permissionScheme: 'cdlab Permission Scheme',
  securityScheme: 'cdlab Security',
  levels: { restricted: 'Lab restricted', team: 'Lab team' },
  fields: ['CD Lab Sprint Goal', 'CD Lab Sprint goal', 'CD Lab Sprint Goal (old)'],
  issues: [
    { summary: 'Lab: onboarding checklist', level: null },
    { summary: 'Lab: salary bands (restricted)', level: 'restricted' },
    { summary: 'Lab: team retro notes', level: 'team' },
  ] as Array<{ summary: string; level: 'restricted' | 'team' | null }>,
} as const;

export type LabObjectType = 'group' | 'membership' | 'role' | 'permissionScheme' | 'securityScheme' | 'project' | 'roleActor' | 'field' | 'issue'
  // Objects Jira itself creates for a new project (named "CDLAB: …") and template fields; recorded so
  // removal leaves nothing behind (verified 2026-10-30: deleting a project does not delete them).
  | 'issueTypeScreenScheme' | 'screenScheme' | 'workflowScheme' | 'workflow' | 'screen' | 'issueTypeScheme' | 'templateField';

export interface LabObject {
  type: LabObjectType;
  id: string;
  name: string;
}

export interface LabState {
  status: 'none' | 'creating' | 'ready' | 'removing' | 'removed' | 'failed';
  objects: LabObject[];
  /** Custom field ids that existed before the lab project was created (to spot template fields). */
  preFieldIds?: string[];
  /** Jira's side objects for the lab project have been recorded. */
  sideRecorded?: boolean;
  /** Template fields Jira added for the lab project have been looked for (after the lab's own fields). */
  templateFieldsChecked?: boolean;
  createdBy?: string;
  updatedAt?: string;
  error?: string;
}

export const EMPTY_LAB: LabState = { status: 'none', objects: [] };

/** Everything "Create demo lab" will create, in order (shown to the admin before they confirm). */
export function createPreview(adminName: string): string[] {
  return [
    `3 groups: ${LAB.groups.staff}, ${LAB.groups.contractors} (you are added), ${LAB.groups.oldReviewers} (left empty)`,
    `1 project role: ${LAB.role}`,
    `1 permission scheme "${LAB.permissionScheme}" and 1 issue security scheme "${LAB.securityScheme}" (levels "${LAB.levels.restricted}", "${LAB.levels.team}")`,
    `1 project ${LAB.projectKey} "${LAB.projectName}" led by ${adminName}`,
    `3 issues (${LAB.projectKey}-1 open, ${LAB.projectKey}-2 at "${LAB.levels.restricted}" which you will NOT be able to see, ${LAB.projectKey}-3 at "${LAB.levels.team}")`,
    `3 custom fields: ${LAB.fields.join(', ')} (on no screen)`,
    'No users are invited or created. Every object is recorded so "Remove demo lab" deletes exactly these and nothing else.',
  ];
}

const REMOVE_ORDER: LabObjectType[] = [
  'project', 'templateField', 'field',
  // Dependency order for Jira's per-project objects: a screen scheme is used by the issue type screen
  // scheme, screens by screen schemes and workflows, workflows by the workflow scheme.
  'issueTypeScreenScheme', 'screenScheme', 'workflowScheme', 'workflow', 'screen', 'issueTypeScheme',
  'securityScheme', 'permissionScheme', 'role', 'group',
];

/** Prefix Jira gives the objects it creates for a new project. */
export const sidePrefix = (projectKey: string): string => `${projectKey}: `;

/**
 * What "Remove demo lab" deletes, in a safe order: the project first (it holds issues, role actors and
 * scheme associations), then the objects that are no longer in use. Memberships, role actors and issues go
 * away with their parent objects and are not deleted separately.
 */
export function removalPlan(state: LabState): LabObject[] {
  return REMOVE_ORDER.flatMap((t) => state.objects.filter((o) => o.type === t));
}

export function removePreview(state: LabState): string[] {
  const plan = removalPlan(state);
  if (plan.length === 0) return ['Nothing to remove: no demo lab objects are recorded.'];
  return [
    ...plan.map((o) => `${o.type} ${o.name} (id ${o.id})${o.type === 'project' ? ' — deleted with its lab issues' : o.type === 'field' || o.type === 'templateField' ? ' — moved to the custom field trash' : ['issueTypeScreenScheme', 'screenScheme', 'workflowScheme', 'workflow', 'screen', 'issueTypeScheme', 'templateField'].includes(o.type) ? ' (created by Jira for the lab project)' : ''}`),
    'Only these recorded objects are touched. Anything not created by the demo lab is never changed.',
  ];
}

export function recorded(state: LabState, type: LabObjectType, name: string): LabObject | undefined {
  return state.objects.find((o) => o.type === type && o.name === name);
}

export function withObject(state: LabState, obj: LabObject): LabState {
  const rest = state.objects.filter((o) => !(o.type === obj.type && o.name === obj.name));
  return { ...state, objects: [...rest, obj] };
}

export function withoutObject(state: LabState, obj: LabObject): LabState {
  return { ...state, objects: state.objects.filter((o) => !(o.type === obj.type && o.id === obj.id)) };
}

interface Holder { type: string; value?: string; parameter?: string }
export interface LabGrant { permission: string; holder: Holder }

/** Permission grants for the lab scheme. The app's role gets Create + Set security so it can create CDLAB-2. */
export function labGrants(ids: { staff: string; oldReviewers: string; devRole: string; appRole: string }): LabGrant[] {
  const role = (id: string): Holder => ({ type: 'projectRole', value: id });
  const group = (id: string): Holder => ({ type: 'group', value: id });
  const dev = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES', 'ADD_COMMENTS', 'ASSIGNABLE_USER', 'ASSIGN_ISSUES', 'RESOLVE_ISSUES'];
  const app = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'SET_ISSUE_SECURITY', 'MODIFY_REPORTER', 'ASSIGN_ISSUES', 'TRANSITION_ISSUES', 'ADD_COMMENTS', 'DELETE_ISSUES'];
  return [
    ...dev.map((p) => ({ permission: p, holder: role(ids.devRole) })),
    ...app.map((p) => ({ permission: p, holder: role(ids.appRole) })),
    { permission: 'BROWSE_PROJECTS', holder: group(ids.staff) },
    { permission: 'EDIT_ISSUES', holder: group(ids.staff) },
    { permission: 'ADMINISTER_PROJECTS', holder: group(ids.staff) },
    { permission: 'BROWSE_PROJECTS', holder: group(ids.oldReviewers) },
  ];
}

/** Security levels: members use group NAMES and lowercase `projectrole` on create (verified, RESEARCH.md). */
export function labLevels(ids: { devRole: string; appRole: string }) {
  return [
    { name: LAB.levels.restricted, description: 'Only cdlab-staff (and the Config Doctor app that created the lab).', isDefault: false,
      members: [{ type: 'group', parameter: LAB.groups.staff }, { type: 'projectrole', parameter: ids.appRole }] },
    { name: LAB.levels.team, description: 'Lab developers and staff.', isDefault: false,
      members: [{ type: 'projectrole', parameter: ids.devRole }, { type: 'group', parameter: LAB.groups.staff }, { type: 'projectrole', parameter: ids.appRole }] },
  ];
}

/** Questions that work on any site once the lab exists (shown in the "Try these" card). */
export function tryThese(projectKey: string): Array<{ label: string; kind: 'access' | 'viewers' | 'impact' | 'scan'; args: Record<string, string> }> {
  return [
    { label: `Why can't I see ${projectKey}-2?`, kind: 'access', args: { user: 'me', target: `${projectKey}-2` } },
    { label: `Who can see ${projectKey}-2 and why?`, kind: 'viewers', args: { issueKey: `${projectKey}-2` } },
    { label: `What happens if I remove group ${LAB.groups.contractors}?`, kind: 'impact', args: { changeType: 'remove-group', target: LAB.groups.contractors } },
    { label: 'Run a scan and show the lab findings', kind: 'scan', args: {} },
  ];
}
