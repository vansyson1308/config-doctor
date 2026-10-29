// Demo Lab service: the ONLY place Config Doctor creates or deletes Jira configuration (AGENTS.md rule 2
// exception). Opt-in from the admin page, preview → single-use token → confirm, every object recorded in
// KVS, removal touches recorded objects only. Configuration is created as the admin (asUser); the lab's
// issues are created by the app, which is a member of the lab's security levels.
import { randomUUID } from 'node:crypto';
import { kvs } from '@forge/kvs';
import { EMPTY_LAB, LAB, createPreview, labGrants, labLevels, recorded, removalPlan, removePreview, sidePrefix, withObject, withoutObject, type LabObject, type LabObjectType, type LabState } from '../core/lab';
import { InvalidInputError } from '../actions/runAction';
import { JiraError, jira, jiraGet, paginate, route } from '../jira/client';
import { writeAudit } from '../storage/audit';

const STATE_KEY = 'lab:state';
const TOKEN_TTL = { value: 10, unit: 'MINUTES' } as const;
const SLICE_MS = 17_000;

type Mode = 'create' | 'remove';
interface Pending { accountId: string; mode: Mode }
interface Ctx { state: LabState; accountId: string; deadline: number; log: string[] }

export async function getLabState(): Promise<LabState> {
  return (await kvs.get<LabState>(STATE_KEY)) ?? EMPTY_LAB;
}

async function save(ctx: Ctx): Promise<void> {
  ctx.state = { ...ctx.state, updatedAt: new Date().toISOString() };
  await kvs.set(STATE_KEY, ctx.state);
}

async function record(ctx: Ctx, obj: LabObject): Promise<void> {
  ctx.state = withObject(ctx.state, obj);
  ctx.log.push(`created ${obj.type} ${obj.name}`);
  await save(ctx);
}

class Conflict extends InvalidInputError {}

// ---------- preview / confirm ----------

export async function previewLab(mode: Mode, accountId: string) {
  const state = await getLabState();
  const me = await jiraGet<{ displayName: string }>(route`/rest/api/3/myself`, 'user');
  if (mode === 'create' && state.status === 'ready') throw new InvalidInputError('The demo lab already exists. Remove it first to recreate it.');
  if (mode === 'remove' && state.objects.length === 0) throw new InvalidInputError('There is no demo lab to remove.');
  const token = randomUUID();
  await kvs.set(`labconfirm:${token}`, { accountId, mode } satisfies Pending, { ttl: TOKEN_TTL });
  return { mode, token, lines: mode === 'create' ? createPreview(me.displayName) : removePreview(state), expiresInMinutes: TOKEN_TTL.value };
}

/** Starts (with a fresh token) or continues (same admin, run in progress) a create/remove run. */
export async function runLab(accountId: string, token: string | undefined) {
  let state = await getLabState();
  let mode: Mode;
  if (token) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new InvalidInputError('Invalid confirmation token.');
    const prev = await kvs.set<string, Pending | string>(`labconfirm:${token}`, 'used', { keyPolicy: 'OVERRIDE', returnValue: 'PREVIOUS', ttl: TOKEN_TTL });
    const pending = prev?.value && typeof prev.value === 'object' ? prev.value : undefined;
    if (!pending) throw new InvalidInputError('This confirmation is unknown, already used or expired. Preview again.');
    if (pending.accountId !== accountId) throw new InvalidInputError('This confirmation was issued to a different admin.');
    mode = pending.mode;
    state = { ...state, status: mode === 'create' ? 'creating' : 'removing', createdBy: mode === 'create' ? accountId : state.createdBy, error: undefined };
    await writeAudit({ at: new Date().toISOString(), accountId, action: `demo-lab-${mode}`, source: 'admin-page', inputs: {}, outcome: 'started', summary: `${mode} demo lab (${state.objects.length} objects recorded)`, durationMs: 0 });
  } else {
    if (state.status !== 'creating' && state.status !== 'removing') throw new InvalidInputError('No demo lab run is in progress.');
    mode = state.status === 'creating' ? 'create' : 'remove';
  }
  const ctx: Ctx = { state, accountId, deadline: Date.now() + SLICE_MS, log: [] };
  await save(ctx);
  const started = Date.now();
  try {
    const done = mode === 'create' ? await createSteps(ctx) : await removeSteps(ctx);
    if (done) {
      ctx.state = mode === 'create' ? { ...ctx.state, status: 'ready' } : { ...EMPTY_LAB, status: 'removed' };
      await save(ctx);
      await writeAudit({ at: new Date().toISOString(), accountId, action: `demo-lab-${mode}`, source: 'admin-page', inputs: {}, outcome: 'ok', summary: mode === 'create' ? `demo lab ready: ${ctx.state.objects.length} objects` : 'demo lab removed', durationMs: Date.now() - started });
    }
    return { mode, done, status: ctx.state.status, objects: ctx.state.objects, log: ctx.log };
  } catch (err) {
    const message = err instanceof JiraError ? `Jira ${err.status} on ${err.path}: ${err.body.slice(0, 200)}` : err instanceof Error ? err.message : String(err);
    ctx.state = { ...ctx.state, status: 'failed', error: message };
    await save(ctx);
    await writeAudit({ at: new Date().toISOString(), accountId, action: `demo-lab-${mode}`, source: 'admin-page', inputs: {}, outcome: 'error', summary: message.slice(0, 280), durationMs: Date.now() - started });
    if (err instanceof Conflict) throw err;
    throw new InvalidInputError(`Demo lab ${mode} stopped: ${message}. Fix the cause and run it again; finished steps are kept.`);
  }
}

const outOfTime = (ctx: Ctx) => Date.now() > ctx.deadline;

// ---------- Jira's per-project side objects ----------

/** Objects Jira names "<KEY>: …" when it sets up a project (screens, schemes, workflow). */
async function listSideObjects(prefix: string): Promise<LabObject[]> {
  const pick = <T extends { name: string }>(type: LabObjectType, rows: T[], id: (r: T) => string) =>
    rows.filter((r) => r.name.startsWith(prefix)).map((r) => ({ type, id: id(r), name: r.name }));
  const [itss, ss, ws, wf, sc, its] = await Promise.all([
    paginate<{ id: string; name: string }>((x) => route`/rest/api/3/issuetypescreenscheme?startAt=${x}&maxResults=50`, { as: 'user' }),
    paginate<{ id: number; name: string }>((x) => route`/rest/api/3/screenscheme?startAt=${x}&maxResults=50`, { as: 'user' }),
    paginate<{ id: number; name: string }>((x) => route`/rest/api/3/workflowscheme?startAt=${x}&maxResults=50`, { as: 'user' }),
    paginate<{ id: string; name: string }>((x) => route`/rest/api/3/workflows/search?queryString=${prefix.trim()}&startAt=${x}&maxResults=50`, { as: 'user' }),
    paginate<{ id: number; name: string }>((x) => route`/rest/api/3/screens?queryString=${prefix.trim()}&startAt=${x}&maxResults=100`, { as: 'user' }),
    paginate<{ id: string; name: string }>((x) => route`/rest/api/3/issuetypescheme?startAt=${x}&maxResults=50`, { as: 'user' }),
  ]);
  return [
    ...pick('issueTypeScreenScheme', itss, (r) => String(r.id)),
    ...pick('screenScheme', ss, (r) => String(r.id)),
    ...pick('workflowScheme', ws, (r) => String(r.id)),
    ...pick('workflow', wf, (r) => String(r.id)),
    ...pick('screen', sc, (r) => String(r.id)),
    ...pick('issueTypeScheme', its, (r) => String(r.id)),
  ];
}

/**
 * Jira creates template fields (e.g. "Story Points") asynchronously after the project. They are recorded
 * once the lab's own fields exist, inside a tight window: absent from the pre-project snapshot AND with an id
 * lower than the lab's first field, so a field someone else creates later is never attributed to the lab.
 */
async function recordTemplateFields(ctx: Ctx): Promise<void> {
  if (!ctx.state.preFieldIds || ctx.state.templateFieldsChecked) return;
  const num = (id: string) => Number(id.replace('customfield_', ''));
  const labIds = ctx.state.objects.filter((o) => o.type === 'field').map((o) => num(o.id));
  if (labIds.length < LAB.fields.length) return;
  const firstLab = Math.min(...labIds);
  const before = new Set(ctx.state.preFieldIds);
  for (const f of await customFieldIds()) {
    if (!before.has(f.id) && num(f.id) < firstLab && !(LAB.fields as readonly string[]).includes(f.name)) {
      ctx.state = withObject(ctx.state, { type: 'templateField', id: f.id, name: f.name });
      ctx.log.push(`recorded template field ${f.name}`);
    }
  }
  ctx.state = { ...ctx.state, templateFieldsChecked: true };
  await save(ctx);
}

async function customFieldIds(): Promise<Array<{ id: string; name: string }>> {
  return paginate<{ id: string; name: string }>((x) => route`/rest/api/3/field/search?type=custom&startAt=${x}&maxResults=50`, { as: 'user', maxItems: 20000 });
}

/** Records everything Jira created alongside the lab project, so removal leaves nothing behind. */
async function recordSideObjects(ctx: Ctx): Promise<void> {
  if (ctx.state.sideRecorded) return;
  for (const obj of await listSideObjects(sidePrefix(LAB.projectKey))) {
    if (!recorded(ctx.state, obj.type, obj.name)) ctx.state = withObject(ctx.state, obj);
  }
  ctx.state = { ...ctx.state, sideRecorded: true };
  ctx.log.push('recorded the screens, schemes and fields Jira created for the lab project');
  await save(ctx);
}

// ---------- create ----------

async function findGroup(name: string): Promise<{ groupId: string } | undefined> {
  const r = await jiraGet<{ values: Array<{ groupId: string; name: string }> }>(route`/rest/api/3/group/bulk?groupName=${name}`, 'user');
  return r.values.find((g) => g.name === name);
}

async function ensureGroup(ctx: Ctx, name: string): Promise<string> {
  const mine = recorded(ctx.state, 'group', name);
  if (mine) return mine.id;
  if (await findGroup(name)) throw new Conflict(`A group named ${name} already exists and was not created by the demo lab; it will not be touched. Rename or remove it, then retry.`);
  const created = await jira<{ groupId: string }>(route`/rest/api/3/group`, { method: 'POST', body: { name }, as: 'user' });
  await record(ctx, { type: 'group', id: created!.groupId, name });
  return created!.groupId;
}

async function rolesByName(): Promise<Array<{ id: number; name: string; scope?: unknown }>> {
  return jiraGet(route`/rest/api/3/role`, 'user');
}

async function createSteps(ctx: Ctx): Promise<boolean> {
  const me = await jiraGet<{ accountId: string }>(route`/rest/api/3/myself`, 'user');
  const app = await jiraGet<{ accountId: string }>(route`/rest/api/3/myself`, 'app');

  const staff = await ensureGroup(ctx, LAB.groups.staff);
  const contractors = await ensureGroup(ctx, LAB.groups.contractors);
  const oldReviewers = await ensureGroup(ctx, LAB.groups.oldReviewers);
  if (!recorded(ctx.state, 'membership', `${LAB.groups.contractors}:${me.accountId}`)) {
    await jira(route`/rest/api/3/group/user?groupId=${contractors}`, { method: 'POST', body: { accountId: me.accountId }, as: 'user', allow: [400] });
    await record(ctx, { type: 'membership', id: `${contractors}:${me.accountId}`, name: `${LAB.groups.contractors}:${me.accountId}` });
  }
  if (outOfTime(ctx)) return false;

  const roles = await rolesByName();
  const appRole = roles.find((r) => r.name === 'atlassian-addons-project-access' && !r.scope);
  if (!appRole) throw new Error('Role atlassian-addons-project-access not found');
  let devRole = recorded(ctx.state, 'role', LAB.role)?.id;
  if (!devRole) {
    if (roles.some((r) => r.name === LAB.role && !r.scope)) throw new Conflict(`A project role named ${LAB.role} already exists and was not created by the demo lab.`);
    const r = await jira<{ id: number }>(route`/rest/api/3/role`, { method: 'POST', body: { name: LAB.role, description: 'Config Doctor demo lab role' }, as: 'user' });
    devRole = String(r!.id);
    await record(ctx, { type: 'role', id: devRole, name: LAB.role });
  }
  const ids = { staff, oldReviewers, devRole, appRole: String(appRole.id) };

  let permScheme = recorded(ctx.state, 'permissionScheme', LAB.permissionScheme)?.id;
  if (!permScheme) {
    const all = await jiraGet<{ permissionSchemes: Array<{ id: number; name: string }> }>(route`/rest/api/3/permissionscheme`, 'user');
    if (all.permissionSchemes.some((s) => s.name === LAB.permissionScheme)) throw new Conflict(`A permission scheme named "${LAB.permissionScheme}" already exists and was not created by the demo lab.`);
    const s = await jira<{ id: number }>(route`/rest/api/3/permissionscheme`, { method: 'POST', body: { name: LAB.permissionScheme, description: 'Config Doctor demo lab', permissions: labGrants(ids) }, as: 'user' });
    permScheme = String(s!.id);
    await record(ctx, { type: 'permissionScheme', id: permScheme, name: LAB.permissionScheme });
  }
  let secScheme = recorded(ctx.state, 'securityScheme', LAB.securityScheme)?.id;
  if (!secScheme) {
    const all = await jiraGet<{ issueSecuritySchemes: Array<{ id: number; name: string }> }>(route`/rest/api/3/issuesecurityschemes`, 'user');
    if (all.issueSecuritySchemes.some((s) => s.name === LAB.securityScheme)) throw new Conflict(`An issue security scheme named "${LAB.securityScheme}" already exists and was not created by the demo lab.`);
    const s = await jira<{ id: string }>(route`/rest/api/3/issuesecurityschemes`, { method: 'POST', body: { name: LAB.securityScheme, description: 'Config Doctor demo lab', levels: labLevels(ids) }, as: 'user' });
    secScheme = String(s!.id);
    await record(ctx, { type: 'securityScheme', id: secScheme, name: LAB.securityScheme });
  }
  if (outOfTime(ctx)) return false;

  let project = recorded(ctx.state, 'project', LAB.projectKey)?.id;
  if (!project) {
    const existing = await jira<{ id: string }>(route`/rest/api/3/project/${LAB.projectKey}`, { as: 'user', allow: [404] });
    if (existing) throw new Conflict(`A project with key ${LAB.projectKey} already exists (or is in the recycle bin) and was not created by this demo lab.`);
    const foreign = await listSideObjects(sidePrefix(LAB.projectKey));
    if (foreign.length) throw new Conflict(`Objects named "${sidePrefix(LAB.projectKey)}…" already exist (${foreign.slice(0, 3).map((o) => o.name).join(', ')}); they were not created by this demo lab, so it will not start.`);
    ctx.state = { ...ctx.state, preFieldIds: (await customFieldIds()).map((f) => f.id), sideRecorded: false };
    await save(ctx);
    const p = await jira<{ id: number }>(route`/rest/api/3/project`, { method: 'POST', as: 'user', body: {
      // No projectTemplateKey on purpose: templates create their own screens, workflow, schemes and fields
      // that deleting the project leaves behind (verified 2026-10-30). Without one, Jira uses the site's
      // default schemes, so the lab adds nothing outside its recorded objects.
      key: LAB.projectKey, name: LAB.projectName, projectTypeKey: 'business',
      leadAccountId: me.accountId, assigneeType: 'UNASSIGNED', description: 'Created by Config Doctor demo lab. Remove it from the Config Doctor admin page.',
      permissionScheme: Number(permScheme), issueSecurityScheme: Number(secScheme),
    } });
    project = String(p!.id);
    await record(ctx, { type: 'project', id: project, name: LAB.projectKey });
  }
  await recordSideObjects(ctx);
  for (const [roleId, body, label] of [[devRole, { groupId: [contractors] }, `${LAB.role}<-${LAB.groups.contractors}`], [ids.appRole, { user: [app.accountId] }, 'app-role<-app']] as const) {
    if (recorded(ctx.state, 'roleActor', label)) continue;
    await jira(route`/rest/api/3/project/${project}/role/${roleId}`, { method: 'POST', body, as: 'user', allow: [400] });
    await record(ctx, { type: 'roleActor', id: `${project}:${roleId}`, name: label });
  }
  if (outOfTime(ctx)) return false;

  for (const name of LAB.fields) {
    if (recorded(ctx.state, 'field', name)) continue;
    const found = await jiraGet<{ values: Array<{ id: string; name: string }> }>(route`/rest/api/3/field/search?type=custom&query=${name}&maxResults=50`, 'user');
    if (found.values.some((f) => f.name === name)) throw new Conflict(`A custom field named "${name}" already exists and was not created by the demo lab.`);
    const f = await jira<{ id: string }>(route`/rest/api/3/field`, { method: 'POST', as: 'user', body: {
      name, description: 'Config Doctor demo lab (near-duplicate on purpose)',
      type: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield', searcherKey: 'com.atlassian.jira.plugin.system.customfieldtypes:textsearcher',
    } });
    await record(ctx, { type: 'field', id: f!.id, name });
    if (outOfTime(ctx)) return false;
  }
  await recordTemplateFields(ctx);
  return createIssues(ctx, project, secScheme);
}

/** The app creates the issues: it is a member of both lab levels, the admin is not in "Lab restricted". */
async function createIssues(ctx: Ctx, projectId: string, secScheme: string): Promise<boolean> {
  const scheme = await jiraGet<{ levels?: Array<{ id: string; name: string }> }>(route`/rest/api/3/issuesecurityschemes/${secScheme}`, 'user');
  const levelId = (key: 'restricted' | 'team' | null) => (key ? scheme.levels?.find((l) => l.name === LAB.levels[key])?.id : undefined);
  const p = await jiraGet<{ issueTypes?: Array<{ id: string; name: string; subtask: boolean; hierarchyLevel?: number }> }>(route`/rest/api/3/project/${projectId}`, 'user');
  const type = (p.issueTypes ?? []).find((t) => !t.subtask && t.name === 'Task') ?? (p.issueTypes ?? []).find((t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0);
  if (!type) throw new Error('The lab project has no standard issue type');
  for (const issue of LAB.issues) {
    if (recorded(ctx.state, 'issue', issue.summary)) continue;
    if (outOfTime(ctx)) return false;
    const lv = levelId(issue.level);
    const body = { fields: { project: { id: projectId }, issuetype: { id: type.id }, summary: issue.summary, ...(lv ? { security: { id: lv } } : {}) } };
    // Permission changes on a fresh project can take a moment to apply: retry within this slice, then
    // let the next slice continue.
    let created: { key: string } | null = null;
    while (!created) {
      try {
        created = await jira<{ key: string }>(route`/rest/api/3/issue`, { method: 'POST', body, as: 'app' });
      } catch (err) {
        const lagging = err instanceof JiraError && (err.status === 403 || (err.status === 400 && err.body.includes('cannot be set')));
        if (!lagging) throw err;
        if (Date.now() + 5000 > ctx.deadline) { ctx.log.push('waiting for Jira to apply lab permissions…'); return false; }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    await record(ctx, { type: 'issue', id: created.key, name: issue.summary });
  }
  return true;
}

// ---------- remove ----------

async function removeSteps(ctx: Ctx): Promise<boolean> {
  // Labs created by earlier builds did not record Jira's per-project objects yet: record them first.
  if (recorded(ctx.state, 'project', LAB.projectKey) && !ctx.state.sideRecorded) await recordSideObjects(ctx);
  for (const obj of removalPlan(ctx.state)) {
    if (outOfTime(ctx)) return false;
    await removeOne(obj);
    ctx.state = withoutObject(ctx.state, obj);
    ctx.log.push(`removed ${obj.type} ${obj.name}`);
    await save(ctx);
  }
  // Memberships, role actors and issues disappear with their groups / project.
  ctx.state = { ...ctx.state, objects: [] };
  return true;
}

/** Deletes one recorded object after re-checking that the id still belongs to the lab's name. */
async function removeOne(obj: LabObject): Promise<void> {
  switch (obj.type) {
    case 'project': {
      const p = await jira<{ id: string; key: string }>(route`/rest/api/3/project/${obj.id}`, { as: 'user', allow: [404] });
      if (!p) return;
      if (p.key !== obj.name) throw new Error(`Project ${obj.id} is now ${p.key}, not ${obj.name}; refusing to delete it.`);
      await jira(route`/rest/api/3/project/${obj.id}?enableUndo=false`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'templateField':
    case 'field': {
      const f = await jiraGet<{ values: Array<{ id: string; name: string }> }>(route`/rest/api/3/field/search?id=${obj.id}`, 'user');
      const hit = f.values.find((x) => x.id === obj.id);
      if (!hit) return;
      if (hit.name !== obj.name) throw new Error(`Field ${obj.id} is now named "${hit.name}"; refusing to touch it.`);
      // Jira-locked template fields (e.g. Work Management "Category") cannot be trashed: Jira owns them.
      await jira(route`/rest/api/3/field/${obj.id}/trash`, { method: 'POST', as: 'user', allow: [400, 404] });
      return;
    }
    case 'issueTypeScreenScheme': {
      const r = await jiraGet<{ values: Array<{ id: string; name: string }> }>(route`/rest/api/3/issuetypescreenscheme?id=${obj.id}`, 'user');
      if (!r.values.some((x) => String(x.id) === obj.id && x.name === obj.name)) return;
      await jira(route`/rest/api/3/issuetypescreenscheme/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'screenScheme': {
      const r = await jiraGet<{ values: Array<{ id: number; name: string }> }>(route`/rest/api/3/screenscheme?id=${obj.id}`, 'user');
      if (!r.values.some((x) => String(x.id) === obj.id && x.name === obj.name)) return;
      await jira(route`/rest/api/3/screenscheme/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'workflowScheme': {
      const r = await jira<{ name: string }>(route`/rest/api/3/workflowscheme/${obj.id}`, { as: 'user', allow: [404] });
      if (!r || r.name !== obj.name) return;
      await jira(route`/rest/api/3/workflowscheme/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'workflow': {
      const r = await jiraGet<{ values: Array<{ id: string; name: string }> }>(route`/rest/api/3/workflows/search?queryString=${obj.name}&maxResults=50`, 'user');
      if (!r.values.some((x) => x.id === obj.id && x.name === obj.name)) return;
      await jira(route`/rest/api/3/workflow/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'screen': {
      const r = await jiraGet<{ values: Array<{ id: number; name: string }> }>(route`/rest/api/3/screens?id=${obj.id}`, 'user');
      if (!r.values.some((x) => String(x.id) === obj.id && x.name === obj.name)) return;
      await jira(route`/rest/api/3/screens/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'issueTypeScheme': {
      const r = await jiraGet<{ values: Array<{ id: string; name: string }> }>(route`/rest/api/3/issuetypescheme?id=${obj.id}`, 'user');
      if (!r.values.some((x) => String(x.id) === obj.id && x.name === obj.name)) return;
      await jira(route`/rest/api/3/issuetypescheme/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'securityScheme': {
      const s = await jira<{ name: string }>(route`/rest/api/3/issuesecurityschemes/${obj.id}`, { as: 'user', allow: [404] });
      if (!s) return;
      if (s.name !== obj.name) throw new Error(`Security scheme ${obj.id} was renamed; refusing to delete it.`);
      await jira(route`/rest/api/3/issuesecurityschemes/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'permissionScheme': {
      const s = await jira<{ name: string }>(route`/rest/api/3/permissionscheme/${obj.id}`, { as: 'user', allow: [404] });
      if (!s) return;
      if (s.name !== obj.name) throw new Error(`Permission scheme ${obj.id} was renamed; refusing to delete it.`);
      await jira(route`/rest/api/3/permissionscheme/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'role': {
      const r = await jira<{ name: string }>(route`/rest/api/3/role/${obj.id}`, { as: 'user', allow: [404] });
      if (!r) return;
      if (r.name !== obj.name) throw new Error(`Role ${obj.id} was renamed; refusing to delete it.`);
      await jira(route`/rest/api/3/role/${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    case 'group': {
      const g = await findGroup(obj.name);
      if (!g) return;
      if (g.groupId !== obj.id) throw new Error(`Group ${obj.name} now has a different id; refusing to delete it.`);
      await jira(route`/rest/api/3/group?groupId=${obj.id}`, { method: 'DELETE', as: 'user' });
      return;
    }
    default:
      return;
  }
}
