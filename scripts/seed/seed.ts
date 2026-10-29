// Idempotent demo-data seeder for Config Doctor (LOCAL script, NOT part of the Forge app).
// Usage: npm run seed            (creates/updates the demo scenario)
//        npm run seed -- --check (read-only: reports what exists / what would be created)
// Re-running converges to the same state: every step is find-or-create by name.
// Note: security-level members take group NAMES and the lowercase type `projectrole`
// (SecuritySchemeLevelMemberBean in the v3 spec); permission grants take group ids.
import { mkdirSync, writeFileSync } from 'node:fs';
import { client, readEnv, JiraHttpError, type Jira } from './jira.ts';
import {
  CUSTOM_FIELDS, DEMO_USERS, GROUPS, ISSUES, PROJECTS, ROLE_DEVELOPERS, SCHEMES, SECURITY_LEVELS, SECURITY_SCHEME,
  legacyGrants, paymentsGrants, vendorGrants, type Grant,
} from './scenario.ts';

const CHECK_ONLY = process.argv.includes('--check');
const report: { created: string[]; existing: string[]; skipped: string[] } = { created: [], existing: [], skipped: [] };
const note = (kind: keyof typeof report, msg: string) => {
  report[kind].push(msg);
  console.log(`${kind === 'created' ? (CHECK_ONLY ? '[would create]' : '[created]') : kind === 'existing' ? '[ok]' : '[skip]'} ${msg}`);
};

interface User { accountId: string; displayName: string; active: boolean; accountType: string }
interface Group { groupId: string; name: string }
interface Role { id: number; name: string; scope?: unknown }
interface PermissionScheme { id: number; name: string; permissions?: Array<{ permission: string; holder: { type: string; value?: string; parameter?: string } }> }
interface SecurityScheme { id: number; name: string; levels?: Array<{ id: string; name: string }> }
interface Field { id: string; name: string }

async function findUser(jira: Jira, displayName: string): Promise<User | null> {
  const users = await jira.get<User[]>(`/rest/api/3/user/search?query=${encodeURIComponent(displayName)}&maxResults=20`);
  return users.find((u) => u.displayName === displayName && u.active && u.accountType === 'atlassian') ?? null;
}

async function ensureGroup(jira: Jira, name: string): Promise<Group | null> {
  const found = await jira.get<{ values: Group[] }>(`/rest/api/3/group/bulk?groupName=${encodeURIComponent(name)}`);
  const hit = found.values.find((g) => g.name === name);
  if (hit) { note('existing', `group ${name}`); return hit; }
  note('created', `group ${name}`);
  if (CHECK_ONLY) return null;
  return jira.post<Group>('/rest/api/3/group', { name });
}

async function ensureMember(jira: Jira, group: Group | null, user: User): Promise<void> {
  if (!group) { note('created', `membership ${user.displayName} → (new group)`); return; }
  const members = await jira.all<{ accountId: string }>(`/rest/api/3/group/member?groupId=${group.groupId}&includeInactiveUsers=true`);
  if (members.some((m) => m.accountId === user.accountId)) { note('existing', `membership ${user.displayName} → ${group.name}`); return; }
  note('created', `membership ${user.displayName} → ${group.name}`);
  if (!CHECK_ONLY) await jira.post(`/rest/api/3/group/user?groupId=${group.groupId}`, { accountId: user.accountId });
}

async function ensureRole(jira: Jira, name: string): Promise<Role | null> {
  const roles = await jira.get<Role[]>('/rest/api/3/role');
  const hit = roles.find((r) => r.name === name && !r.scope);
  if (hit) { note('existing', `project role ${name}`); return hit; }
  note('created', `project role ${name}`);
  if (CHECK_ONLY) return null;
  return jira.post<Role>('/rest/api/3/role', { name, description: 'Config Doctor demo role' });
}

function addonsRoleId(roles: Role[]): string {
  const role = roles.find((r) => r.name === 'atlassian-addons-project-access' && !r.scope);
  if (!role) throw new Error('Global role atlassian-addons-project-access not found');
  return String(role.id);
}

const grantKey = (g: Grant) => `${g.permission}|${g.holder.type}|${g.holder.value ?? ''}`;

async function ensurePermissionScheme(jira: Jira, name: string, grants: Grant[]): Promise<PermissionScheme | null> {
  const all = await jira.get<{ permissionSchemes: PermissionScheme[] }>('/rest/api/3/permissionscheme?expand=permissions');
  const hit = all.permissionSchemes.find((s) => s.name === name);
  if (!hit) {
    note('created', `permission scheme ${name} (${grants.length} grants)`);
    if (CHECK_ONLY) return null;
    return jira.post<PermissionScheme>('/rest/api/3/permissionscheme', { name, description: 'Config Doctor demo scheme', permissions: grants });
  }
  const have = new Set((hit.permissions ?? []).map((p) => `${p.permission}|${p.holder.type}|${p.holder.value ?? ''}`));
  const missing = grants.filter((g) => !have.has(grantKey(g)));
  if (missing.length === 0) { note('existing', `permission scheme ${name}`); return hit; }
  for (const g of missing) {
    note('created', `grant ${g.permission} → ${g.holder.type}:${g.holder.value ?? ''} in ${name}`);
    if (!CHECK_ONLY) await jira.post(`/rest/api/3/permissionscheme/${hit.id}/permission`, g);
  }
  return hit;
}

async function ensureSecurityScheme(jira: Jira, ids: { staffHq: string; devRole: string }): Promise<SecurityScheme | null> {
  const all = await jira.get<{ issueSecuritySchemes: SecurityScheme[] }>('/rest/api/3/issuesecurityschemes');
  const hit = all.issueSecuritySchemes.find((s) => s.name === SECURITY_SCHEME);
  if (hit) { note('existing', `issue security scheme ${SECURITY_SCHEME}`); return jira.get<SecurityScheme>(`/rest/api/3/issuesecurityschemes/${hit.id}`); }
  note('created', `issue security scheme ${SECURITY_SCHEME} with levels "${SECURITY_LEVELS.internal}", "${SECURITY_LEVELS.team}"`);
  if (CHECK_ONLY) return null;
  const created = await jira.post<{ id: string }>('/rest/api/3/issuesecurityschemes', {
    name: SECURITY_SCHEME,
    description: 'Config Doctor demo: confidential payments issues',
    levels: [
      { name: SECURITY_LEVELS.internal, description: 'HQ staff only', isDefault: false, members: [{ type: 'group', parameter: GROUPS.staffHq }] },
      { name: SECURITY_LEVELS.team, description: 'Payments developers and HQ staff', isDefault: false, members: [{ type: 'projectrole', parameter: ids.devRole }, { type: 'group', parameter: GROUPS.staffHq }] },
    ],
  });
  return jira.get<SecurityScheme>(`/rest/api/3/issuesecurityschemes/${created.id}`);
}

async function ensureProject(jira: Jira, spec: (typeof PROJECTS)[keyof typeof PROJECTS], leadAccountId: string, schemeId: number | undefined, securitySchemeId?: number): Promise<{ id: string; key: string } | null> {
  try {
    const p = await jira.get<{ id: string; key: string }>(`/rest/api/3/project/${spec.key}`);
    note('existing', `project ${spec.key}`);
    if (schemeId !== undefined && !CHECK_ONLY) await jira.put(`/rest/api/3/project/${spec.key}/permissionscheme`, { id: schemeId });
    return p;
  } catch (err) {
    if (!(err instanceof JiraHttpError) || err.status !== 404) throw err;
  }
  note('created', `project ${spec.key} "${spec.name}"`);
  if (CHECK_ONLY) return null;
  return jira.post<{ id: string; key: string }>('/rest/api/3/project', {
    key: spec.key, name: spec.name, projectTypeKey: spec.projectTypeKey, projectTemplateKey: spec.projectTemplateKey,
    leadAccountId, assigneeType: 'UNASSIGNED', description: 'Config Doctor demo project',
    ...(schemeId !== undefined ? { permissionScheme: schemeId } : {}),
    ...(securitySchemeId !== undefined ? { issueSecurityScheme: securitySchemeId } : {}),
  });
}

async function ensureRoleActorGroup(jira: Jira, projectKey: string, roleId: number, group: Group): Promise<void> {
  const role = await jira.get<{ actors?: Array<{ actorGroup?: { groupId: string } }> }>(`/rest/api/3/project/${projectKey}/role/${roleId}`);
  if (role.actors?.some((a) => a.actorGroup?.groupId === group.groupId)) { note('existing', `role actor ${group.name} in ${projectKey}`); return; }
  note('created', `role actor ${group.name} → ${ROLE_DEVELOPERS} in ${projectKey}`);
  if (!CHECK_ONLY) await jira.post(`/rest/api/3/project/${projectKey}/role/${roleId}`, { groupId: [group.groupId] });
}

// Reporter is not set explicitly: the template's create screen has no Reporter field, so the
// seeding owner becomes reporter.
async function ensureIssues(jira: Jira, projectKey: 'PAY' | 'VEND', levels: Record<string, string>): Promise<void> {
  const jql = `project = ${projectKey} ORDER BY key ASC`;
  const found = await retryOn404(() => jira.post<{ issues: Array<{ key: string; fields: { summary: string } }> }>('/rest/api/3/search/jql', { jql, fields: ['summary'], maxResults: 100 }));
  const haveSummaries = new Set(found.issues.map((i) => i.fields.summary));
  for (const issue of ISSUES[projectKey]) {
    if (haveSummaries.has(issue.summary)) { note('existing', `issue "${issue.summary}"`); continue; }
    note('created', `issue ${projectKey} "${issue.summary}"${issue.security ? ` [${SECURITY_LEVELS[issue.security]}]` : ''}`);
    if (CHECK_ONLY) continue;
    const levelId = issue.security ? levels[SECURITY_LEVELS[issue.security]] : undefined;
    // createmeta can lag behind fresh permission changes; the project's own issue types are enough.
    const types = await jira.get<{ issueTypes?: Array<{ id: string; name: string; subtask: boolean }> }>(`/rest/api/3/project/${projectKey}`);
    const type = (types.issueTypes ?? []).find((t) => !t.subtask && t.name === 'Task') ?? (types.issueTypes ?? []).find((t) => !t.subtask);
    if (!type) throw new Error(`No issue type for ${projectKey}`);
    const body = {
      fields: {
        project: { key: projectKey }, summary: issue.summary, issuetype: { id: type.id },
        ...(levelId ? { security: { id: levelId } } : {}),
      },
    };
    await withPropagationRetry(() => jira.post('/rest/api/3/issue', body));
  }
}

/** JQL search intermittently answers 404 "Issue does not exist" on fresh data (observed 2026-10-30). */
async function retryOn404<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof JiraHttpError) || err.status !== 404 || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
}

/**
 * Jira Cloud permission caches are eventually consistent: right after group/scheme changes,
 * POST /issue can return 403 while permissions/check already says yes. Retry for up to ~5 minutes.
 */
async function withPropagationRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // 403 = create permission not visible yet; 400 "cannot be set" = Set Issue Security not visible yet.
      const lagging = err instanceof JiraHttpError && (err.status === 403 || (err.status === 400 && err.message.includes('cannot be set')));
      if (!lagging || attempt >= 20) throw err;
      console.log(`  (permission not propagated yet, retry ${attempt}/20 in 15s)`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function ensureCustomFields(jira: Jira): Promise<void> {
  const fields = await jira.all<Field>('/rest/api/3/field/search?type=custom');
  const names = new Set(fields.map((f) => f.name));
  for (const name of CUSTOM_FIELDS) {
    if (names.has(name)) { note('existing', `custom field "${name}"`); continue; }
    note('created', `custom field "${name}" (not on any screen)`);
    if (!CHECK_ONLY) {
      await jira.post('/rest/api/3/field', {
        name, description: 'Config Doctor demo sprawl field',
        type: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield',
        searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher',
      });
    }
  }
}

async function main(): Promise<void> {
  const env = readEnv();
  const jira = client(env);
  const me = await jira.get<User>('/rest/api/3/myself');
  console.log(`Seeding ${env.baseUrl} as ${me.displayName}${CHECK_ONLY ? ' (check only)' : ''}`);

  const names = [...new Set([DEMO_USERS.subject, ...DEMO_USERS.staff, ...DEMO_USERS.devVn, ...DEMO_USERS.contractors])];
  const users = new Map<string, User>();
  for (const n of names) {
    const u = await findUser(jira, n);
    if (u) users.set(n, u); else note('skipped', `user "${n}" not on this site (no invites by design)`);
  }
  const pick = (list: readonly string[]) => list.map((n) => users.get(n)).filter((u): u is User => !!u);

  const g = {
    staffHq: await ensureGroup(jira, GROUPS.staffHq),
    devVn: await ensureGroup(jira, GROUPS.devVn),
    contractors: await ensureGroup(jira, GROUPS.contractors),
    paymentsAdmins: await ensureGroup(jira, GROUPS.paymentsAdmins),
    legacyEmpty: await ensureGroup(jira, GROUPS.legacyEmpty),
    oldReviewers: await ensureGroup(jira, GROUPS.oldReviewers),
  };
  for (const u of [...pick(DEMO_USERS.staff), me]) await ensureMember(jira, g.staffHq, u);
  for (const u of pick(DEMO_USERS.devVn)) await ensureMember(jira, g.devVn, u);
  for (const u of pick(DEMO_USERS.contractors)) await ensureMember(jira, g.contractors, u);
  await ensureMember(jira, g.paymentsAdmins, me);

  const devRole = await ensureRole(jira, ROLE_DEVELOPERS);
  if (CHECK_ONLY && (!devRole || Object.values(g).some((x) => !x))) {
    console.log('\nCheck stopped early: base objects missing, later steps depend on their ids.');
    return finish();
  }
  const roles = await jira.get<Role[]>('/rest/api/3/role');
  const addons = addonsRoleId(roles);
  const gid = (x: { groupId: string } | null) => x!.groupId;

  const payScheme = await ensurePermissionScheme(jira, SCHEMES.payments, paymentsGrants({ staffHq: gid(g.staffHq), paymentsAdmins: gid(g.paymentsAdmins), oldReviewers: gid(g.oldReviewers), devRole: String(devRole!.id), addonsRole: addons }));
  const vendScheme = await ensurePermissionScheme(jira, SCHEMES.vendor, vendorGrants({ contractors: gid(g.contractors), staffHq: gid(g.staffHq), paymentsAdmins: gid(g.paymentsAdmins), addonsRole: addons }));
  await ensurePermissionScheme(jira, SCHEMES.legacyUnused, legacyGrants({ legacyEmpty: gid(g.legacyEmpty) }));
  const sec = await ensureSecurityScheme(jira, { staffHq: gid(g.staffHq), devRole: String(devRole!.id) });

  const pay = await ensureProject(jira, PROJECTS.payments, me.accountId, payScheme?.id, sec ? Number(sec.id) : undefined);
  const vend = await ensureProject(jira, PROJECTS.vendor, me.accountId, vendScheme?.id);
  if (pay) {
    await ensureRoleActorGroup(jira, 'PAY', devRole!.id, g.devVn!);
    await ensureRoleActorGroup(jira, 'PAY', devRole!.id, g.contractors!);
    const levels = Object.fromEntries((sec?.levels ?? []).map((l) => [l.name, l.id]));
    await ensureIssues(jira, 'PAY', levels);
  }
  if (vend) await ensureIssues(jira, 'VEND', {});
  await ensureCustomFields(jira);
  finish();
}

function finish(): void {
  mkdirSync('scripts/seed/.state', { recursive: true });
  writeFileSync('scripts/seed/.state/last-run.json', JSON.stringify({ at: new Date().toISOString(), checkOnly: CHECK_ONLY, ...report }, null, 2));
  console.log(`\nSummary: ${report.created.length} ${CHECK_ONLY ? 'to create' : 'created'}, ${report.existing.length} already present, ${report.skipped.length} skipped.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
