import { describe, expect, it } from 'vitest';
import { explainAccess, reconcile, requiredPermissions, type AccessInput } from '../src/core/access';
import type { IssueModel, SubjectUser } from '../src/core/model';
import { BASE, G, issues, names, payProject, paymentsScheme, people, ROLE_DEV, schemeWith, siteIndex, U, user } from './fixtures/world';

function ask(subject: SubjectUser, issue?: IssueModel, permission = 'BROWSE_PROJECTS', over: Partial<AccessInput> = {}) {
  return explainAccess({ subject, project: payProject, scheme: paymentsScheme, issue, permission, names, baseUrl: BASE, index: siteIndex, ...over });
}

describe('explainAccess — permission scheme layer', () => {
  it('1. grants browse through a role that contains one of the user\'s groups', () => {
    const v = ask(people.cassi, issues.open);
    expect(v.verdict).toBe('HAS_ACCESS');
    const hit = v.evidence.find((e) => e.userMatches === true);
    expect(hit?.via).toContain('cd-dev-vn');
    expect(hit?.via).toContain('CD Developers');
  });

  it('2. grants browse through a direct group grant', () => {
    const v = ask(people.kevin, issues.open);
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence[0]).toMatchObject({ layer: 'PERMISSION_SCHEME', grant: 'group cd-staff-hq', userMatches: true });
  });

  it('3. denies a user with no matching grant and blames the permission scheme', () => {
    const v = ask(people.outsider, issues.open);
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.blockingLayer).toBe('PERMISSION_SCHEME');
    expect(v.evidence.every((e) => e.userMatches !== true)).toBe(true);
  });

  it('4. reporter grant: only conditional without an issue', () => {
    const outsiderReporter = user('acc-rep', 'Rita Reporter', []);
    const v = ask(outsiderReporter, undefined);
    expect(v.verdict).toBe('CONDITIONAL');
    expect(v.notes.join(' ')).toMatch(/specific issue/);
  });

  it('5. reporter grant: yes on an issue they reported', () => {
    const rita = user('acc-rep', 'Rita Reporter', []);
    const v = ask(rita, { key: 'PAY-9', id: '9', reporterId: 'acc-rep' });
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence.find((e) => e.userMatches === true)?.grant).toBe('issue reporter');
  });

  it('6. assignee grant evaluates the issue assignee', () => {
    const scheme = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'assignee' } }]);
    expect(ask(people.max, { key: 'PAY-7', id: '7', assigneeId: U.max }, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('HAS_ACCESS');
    expect(ask(people.max, { key: 'PAY-7', id: '7', assigneeId: U.kevin }, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('NO_ACCESS');
  });

  it('7. project lead grant', () => {
    const v = ask(people.owner, issues.open, 'DELETE_ISSUES');
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence.some((e) => e.permission === 'DELETE_ISSUES' && e.grant.startsWith('project lead'))).toBe(true);
  });

  it('8. non-browse permissions also require BROWSE_PROJECTS', () => {
    expect(requiredPermissions('EDIT_ISSUES')).toEqual(['BROWSE_PROJECTS', 'EDIT_ISSUES']);
    const scheme = schemeWith([{ permission: 'EDIT_ISSUES', holder: { type: 'group', parameter: G.contractors.name, value: G.contractors.id } }]);
    const v = ask(people.max, issues.open, 'EDIT_ISSUES', { scheme });
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.evidence[0]?.permission).toBe('BROWSE_PROJECTS');
  });

  it('9. "anyone" and "any logged-in user" grants', () => {
    const anyone = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'anyone' } }]);
    expect(ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { scheme: anyone }).verdict).toBe('HAS_ACCESS');
    const loggedIn = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'applicationRole' } }]);
    expect(ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { scheme: loggedIn }).verdict).toBe('HAS_ACCESS');
  });

  it('10. application role grant: unknown product access is INCONCLUSIVE, known access decides', () => {
    const scheme = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'applicationRole', parameter: 'jira-software', value: 'jira-software' } }]);
    expect(ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('INCONCLUSIVE');
    const withSw = { ...people.outsider, applicationRoles: ['jira-software'] };
    expect(ask(withSw, issues.open, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('HAS_ACCESS');
    const without = { ...people.outsider, applicationRoles: ['jira-servicedesk'] };
    const v = ask(without, issues.open, 'BROWSE_PROJECTS', { scheme });
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.fixOptions[0]?.kind).toBe('GRANT_PRODUCT_ACCESS');
  });

  it('11. user and user-picker custom field grants', () => {
    const scheme = schemeWith([
      { permission: 'BROWSE_PROJECTS', holder: { type: 'user', parameter: U.max, value: U.max } },
      { permission: 'BROWSE_PROJECTS', holder: { type: 'userCustomField', parameter: 'customfield_10200', value: 'customfield_10200' } },
    ]);
    expect(ask(people.max, issues.open, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('HAS_ACCESS');
    const approved = { key: 'PAY-8', id: '8', fieldValues: { customfield_10200: { userIds: [U.kevin], groupNames: [] } } };
    const v = ask(people.kevin, approved, 'BROWSE_PROJECTS', { scheme });
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence.find((e) => e.userMatches === true)?.grant).toBe('user in field Approver');
  });

  it('12. group-picker custom field grant', () => {
    const scheme = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'groupCustomField', value: 'customfield_10201' } }]);
    const issue = { key: 'PAY-6', id: '6', fieldValues: { customfield_10201: { userIds: [], groupNames: ['cd-contractors-2024'] } } };
    expect(ask(people.max, issue, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('HAS_ACCESS');
    expect(ask(people.kevin, issue, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('NO_ACCESS');
  });

  it('13. deactivated accounts are blocked at the ACCOUNT layer with no fix options', () => {
    const v = ask({ ...people.kevin, active: false }, issues.open);
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.blockingLayer).toBe('ACCOUNT');
    expect(v.fixOptions).toEqual([]);
  });

  it('14. service desk portal-only grants never give Jira access', () => {
    const scheme = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'sd.customer.portal.only' } }]);
    expect(ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('NO_ACCESS');
  });

  it('15. unknown holder types make the verdict INCONCLUSIVE rather than guessing', () => {
    const scheme = schemeWith([{ permission: 'BROWSE_PROJECTS', holder: { type: 'someAppHolder', value: 'x' } }]);
    expect(ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { scheme }).verdict).toBe('INCONCLUSIVE');
  });

  it('16. a permission granted to nobody is explained explicitly', () => {
    const v = ask(people.kevin, issues.open, 'MANAGE_WATCHERS');
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.evidence.at(-1)?.via).toContain('granted to nobody');
  });
});

describe('explainAccess — issue security layer', () => {
  it('17. the demo case: Emma passes the scheme via role but is blocked by "Internal only"', () => {
    const v = ask(people.emma, issues.internal);
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.blockingLayer).toBe('ISSUE_SECURITY');
    expect(v.issue).toEqual({ key: 'PAY-3', securityLevel: 'Internal only' });
    const scheme = v.evidence.find((e) => e.layer === 'PERMISSION_SCHEME' && e.userMatches === true);
    expect(scheme?.via).toMatch(/cd-(dev-vn|contractors-2024)/);
    const sec = v.evidence.find((e) => e.layer === 'ISSUE_SECURITY');
    expect(sec).toMatchObject({ level: 'Internal only', grant: 'group cd-staff-hq', userMatches: false });
  });

  it('18. fix options are simulated: adding Emma to cd-staff-hq resolves it, with blast radius', () => {
    const v = ask(people.emma, issues.internal);
    expect(v.fixOptions).toHaveLength(1);
    const fix = v.fixOptions[0]!;
    expect(fix).toMatchObject({ kind: 'ADD_TO_GROUP', target: 'cd-staff-hq', resolves: true });
    expect(fix.alsoGrants).toContain('VEND');
    expect(fix.alsoGrants).toContain('Payments team');
  });

  it('19. role members pass a level that includes the role ("Payments team")', () => {
    const v = ask(people.cassi, issues.team);
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence.find((e) => e.layer === 'ISSUE_SECURITY' && e.userMatches === true)?.via).toContain('CD Developers');
  });

  it('20. a level with no members blocks everyone', () => {
    const empty = { ...issues.internal, securityLevel: { ...issues.internal.securityLevel, members: [] } };
    const v = ask(people.kevin, empty);
    expect(v.verdict).toBe('NO_ACCESS');
    expect(v.evidence.at(-1)?.via).toContain('nobody can see');
  });

  it('21. scheme-layer fixes include roles and are ranked: resolving first, then lower risk', () => {
    const v = ask(people.outsider, issues.open);
    expect(v.fixOptions.length).toBeGreaterThanOrEqual(2);
    expect(v.fixOptions.every((f) => f.resolves)).toBe(true);
    const roleFix = v.fixOptions.find((f) => f.kind === 'ADD_TO_ROLE');
    expect(roleFix?.target).toBe('CD Developers @ PAY');
    const rank = { low: 0, medium: 1, high: 2 } as const;
    const risks = v.fixOptions.map((f) => rank[f.risk]);
    expect([...risks].sort((a, b) => a - b)).toEqual(risks);
  });

  it('21b. never suggests adding a person to app/system roles or groups', () => {
    const v = ask(people.outsider, issues.open);
    expect(v.fixOptions.some((f) => /atlassian-addons/.test(f.target))).toBe(false);
  });

  it('22. role fix that does not satisfy the security level is marked resolves=false', () => {
    const outsiderOnInternal = ask(people.outsider, issues.internal);
    // Scheme blocks first; adding to CD Developers would pass the scheme but not "Internal only".
    const roleFix = outsiderOnInternal.fixOptions.find((f) => f.kind === 'ADD_TO_ROLE');
    expect(roleFix?.resolves).toBe(false);
    expect(outsiderOnInternal.fixOptions[0]?.resolves).toBe(true);
  });

  it('23. team-managed projects carry a note to rely on Jira\'s check', () => {
    const v = ask(people.kevin, issues.open, 'BROWSE_PROJECTS', { project: { ...payProject, style: 'next-gen' } });
    expect(v.notes.join(' ')).toMatch(/Team-managed/);
  });

  it('24. direct user role membership', () => {
    const project = { ...payProject, roles: { ...payProject.roles, [ROLE_DEV]: { ...payProject.roles[ROLE_DEV]!, userIds: ['acc-out'] } } };
    const v = ask(people.outsider, issues.open, 'BROWSE_PROJECTS', { project });
    expect(v.verdict).toBe('HAS_ACCESS');
    expect(v.evidence[0]?.via).toContain('directly in role');
  });
});

describe('reconcile with Jira ground truth', () => {
  const base = ask(people.emma, issues.internal);
  it('25. agreement is reported', () => {
    expect(reconcile(base, false, 'permissions/check').groundTruthCheck).toBe('AGREES');
  });
  it('26. disagreement is never hidden: INCONCLUSIVE with both answers', () => {
    const r = reconcile(base, true, 'permissions/check');
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.groundTruthCheck).toBe('DISAGREES');
    expect(r.notes.at(-1)).toContain('NO_ACCESS');
    expect(r.groundTruth).toEqual({ jiraSays: true, source: 'permissions/check' });
  });
  it('27. Jira decides when our model was conditional; unavailable when no check ran', () => {
    const cond = ask(user('acc-rep', 'Rita', []), undefined);
    const r = reconcile(cond, false, 'permissions/check');
    expect(r).toMatchObject({ verdict: 'NO_ACCESS', groundTruthCheck: 'DECIDED_BY_JIRA' });
    expect(reconcile(base, undefined, 'x').groundTruthCheck).toBe('UNAVAILABLE');
  });
  it('28. admin links point at the scheme, security scheme and roles', () => {
    expect(base.adminLinks[0]).toContain('EditPermissions!default.jspa?schemeId=11001');
    expect(base.adminLinks.some((l) => l.includes('EditIssueSecurities'))).toBe(true);
  });
});
