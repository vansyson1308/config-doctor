import { describe, expect, it } from 'vitest';
import { EMPTY_LAB, LAB, createPreview, sidePrefix, labGrants, labLevels, recorded, removalPlan, removePreview, tryThese, withObject, withoutObject, type LabState } from '../src/core/lab';
import { explainAccess } from '../src/core/access';
import { impactOfGroupRemoval } from '../src/core/impact';
import { audit } from '../src/core/sprawl';

const ids = { staff: 'g-staff', oldReviewers: 'g-old', devRole: '20001', appRole: '10003' };
const admin = { accountId: 'acc-admin', displayName: 'Admin', active: true, groups: [{ id: 'g-con', name: LAB.groups.contractors }] };
const scheme = { id: 1, name: LAB.permissionScheme, grants: labGrants(ids) };
const project = {
  id: 'p1', key: 'CDLAB', name: LAB.projectName, style: 'classic', leadAccountId: 'acc-admin',
  roles: { [ids.devRole]: { id: ids.devRole, name: LAB.role, userIds: [], groups: [{ id: 'g-con', name: LAB.groups.contractors }] }, [ids.appRole]: { id: ids.appRole, name: 'atlassian-addons-project-access', userIds: ['acc-app'], groups: [] } },
};
const names = { roles: { [ids.devRole]: LAB.role, [ids.appRole]: 'atlassian-addons-project-access' }, groupsById: { 'g-staff': LAB.groups.staff, 'g-old': LAB.groups.oldReviewers, 'g-con': LAB.groups.contractors }, fields: {} };
const restricted = { id: 'l1', name: LAB.levels.restricted, members: [{ type: 'group', parameter: LAB.groups.staff }, { type: 'projectRole', parameter: ids.appRole, value: ids.appRole }] };

describe('Demo Lab scenario (proves the story the lab is built for)', () => {
  it('the admin passes the scheme via cdlab-contractors but is blocked from CDLAB-2 by "Lab restricted"', () => {
    const v = explainAccess({ subject: admin, project, scheme, issue: { key: 'CDLAB-2', id: '2', securityLevel: restricted }, permission: 'BROWSE_PROJECTS', names, baseUrl: 'https://x' });
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.blockingLayer).toBe('ISSUE_SECURITY');
    expect(v.fixOptions[0]).toMatchObject({ kind: 'ADD_TO_GROUP', target: LAB.groups.staff, resolves: true });
  });

  it('removing cdlab-contractors costs the admin Browse in CDLAB', () => {
    const index = { builtAt: '', groupSizes: {}, schemes: { '1': scheme }, projects: [{ key: 'CDLAB', name: 'Lab', style: 'classic', schemeId: 1, roles: project.roles, securityLevels: [restricted] }] };
    const r = impactOfGroupRemoval(index, { id: 'g-con', name: LAB.groups.contractors }, [admin], names);
    expect(r.projects[0]!.loses.BROWSE_PROJECTS).toEqual(['Admin']);
    expect(r.usersLosingBrowse).toBe(1);
  });

  it('produces the planted findings: duplicate fields and an empty group that still holds Browse', () => {
    const r = audit({
      scannedAt: '2026-10-30T00:00:00Z',
      fields: LAB.fields.map((n, i) => ({ id: `customfield_9${i}`, name: n, screensCount: 0, customType: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' })),
      groups: [{ id: 'g-old', name: LAB.groups.oldReviewers, memberCount: 0 }],
      groupReferences: { 'g-old': ['BROWSE'] },
      groupGrants: [{ schemeId: '1', schemeName: LAB.permissionScheme, permission: 'BROWSE_PROJECTS', groupId: 'g-old' }],
      permissionSchemes: [], securitySchemes: [], workflowSchemes: [],
      workflows: { total: 0, inactive: [] }, screens: { total: 0, unused: [] }, projects: { total: 1, scanned: 1 },
    });
    expect(r.counts.FIELD_DUPLICATE_NAME).toBe(1);
    expect(r.counts.GROUP_EMPTY_GRANTED).toBe(1);
  });
});

describe('Demo Lab bookkeeping', () => {
  it('records objects idempotently and removes only recorded ones, project first', () => {
    let s: LabState = EMPTY_LAB;
    s = withObject(s, { type: 'group', id: 'g1', name: LAB.groups.staff });
    s = withObject(s, { type: 'group', id: 'g1', name: LAB.groups.staff });
    s = withObject(s, { type: 'project', id: '100', name: 'CDLAB' });
    s = withObject(s, { type: 'field', id: 'customfield_1', name: LAB.fields[0]! });
    expect(s.objects).toHaveLength(3);
    expect(sidePrefix('CDLAB')).toBe('CDLAB: ');
    expect(recorded(s, 'group', LAB.groups.staff)?.id).toBe('g1');
    s = withObject(s, { type: 'screen', id: '5', name: 'CDLAB: Edit Screen' });
    s = withObject(s, { type: 'workflow', id: 'w', name: 'CDLAB: Workflow' });
    s = withObject(s, { type: 'workflowScheme', id: '7', name: 'CDLAB: Workflow Scheme' });
    expect(removalPlan(s).map((o) => o.type)).toEqual(['project', 'field', 'workflowScheme', 'workflow', 'screen', 'group']);
    expect(removePreview(s).find((l) => l.includes('CDLAB: Workflow Scheme'))).toMatch(/created by Jira/);
    expect(removePreview(s).at(-1)).toMatch(/never changed/);
    expect(withoutObject(s, { type: 'group', id: 'g1', name: '' }).objects).toHaveLength(5);
    expect(removePreview(EMPTY_LAB)[0]).toMatch(/Nothing to remove/);
  });

  it('previews creation without inviting users, and offers site-specific questions', () => {
    expect(createPreview('Sơn').join(' ')).toMatch(/No users are invited/);
    expect(tryThese('CDLAB').map((t) => t.kind)).toEqual(['access', 'viewers', 'impact', 'scan']);
    expect(labLevels({ devRole: '1', appRole: '2' })[0]!.members).toEqual([{ type: 'group', parameter: 'cdlab-staff' }, { type: 'projectrole', parameter: '2' }]);
  });
});
