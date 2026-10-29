// Cleanup plan = the ONLY write Config Doctor performs, and only in two explicit steps:
//   preview-cleanup-plan (GET)   → shows exactly what would be created and returns a one-time token
//   create-cleanup-plan (CREATE) → creates the issues, only with a valid token issued to the SAME user
// Tokens live 15 minutes in KVS, are single-use, and are bound to accountId + project + finding ids.
import { randomUUID } from 'node:crypto';
import { kvs } from '@forge/kvs';
import { buildCleanupPlan, parseFindingIds, selectFindings, type CleanupPlan } from '../core/cleanupPlan';
import { parseProjectKey } from '../core/validate';
import { JiraError, jira, jiraGet, route } from '../jira/client';
import { writeAudit } from '../storage/audit';
import { latestSnapshots } from '../storage/snapshots';
import { InvalidInputError, defineAction } from './runAction';

const MAX_PLANS_PER_HOUR = 3;
const CREATE_BUDGET_MS = 40_000;

interface PendingPlan { accountId: string; plan: CleanupPlan; createdAt: string }

const TOKEN_TTL = { value: 15, unit: 'MINUTES' } as const;
const tokenKey = (t: string) => `confirm:${t}`;

async function issueTypes(projectKey: string) {
  const p = await jira<{ id: string; issueTypes?: Array<{ id: string; name: string; subtask: boolean; hierarchyLevel?: number }> }>(route`/rest/api/3/project/${projectKey}`, { as: 'user', allow: [404] });
  if (!p) throw new InvalidInputError(`Project ${projectKey} does not exist or you cannot see it.`);
  const types = p.issueTypes ?? [];
  const epic = types.find((t) => t.hierarchyLevel === 1) ?? types.find((t) => t.name === 'Epic');
  const task = types.find((t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0 && t.name === 'Task') ?? types.find((t) => !t.subtask && (t.hierarchyLevel ?? 0) === 0);
  if (!task) throw new InvalidInputError(`Project ${projectKey} has no standard issue type to create tasks with.`);
  return { epic, task };
}

export async function previewCleanupPlan(accountId: string, rawProject: unknown, rawIds: unknown) {
  const pk = parseProjectKey(rawProject);
  if (!pk.ok) throw new InvalidInputError(`${pk.error}. Which project should hold the cleanup plan?`);
  const [latest] = await latestSnapshots(1);
  if (!latest) throw new InvalidInputError('There is no completed configuration scan yet. Run the sprawl audit first.');
  const { selected, unknown } = selectFindings(latest.findings, parseFindingIds(rawIds));
  if (selected.length === 0) throw new InvalidInputError(`None of the finding ids matched the latest scan${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}.`);
  const types = await issueTypes(pk.value);
  const plan = buildCleanupPlan(pk.value, selected, latest.scannedAt, latest.healthScore);
  const token = randomUUID();
  await kvs.set(tokenKey(token), { accountId, plan, createdAt: new Date().toISOString() } satisfies PendingPlan, { ttl: TOKEN_TTL });
  return {
    confirmToken: token,
    expiresInMinutes: TOKEN_TTL.value,
    willCreate: {
      project: pk.value,
      container: types.epic ? `1 ${types.epic.name}: "${plan.epic.summary}"` : `1 ${types.task.name}: "${plan.epic.summary}" (project has no epic type)`,
      tasks: plan.tasks.map((t) => ({ findingId: t.findingId, summary: t.summary })),
      labels: ['config-doctor-cleanup'],
    },
    ...(unknown.length ? { unknownFindingIds: unknown } : {}),
    ...(plan.skipped.length ? { notIncludedBecauseOfLimit: plan.skipped.length } : {}),
    instructions: 'Nothing has been created. Show this preview to the user and ask for explicit confirmation; only then call create-cleanup-plan with confirmToken.',
  };
}

const REQUIRED = new Set(['project', 'issuetype', 'summary']);

/**
 * Creates an issue as the invoking user. If Jira rejects optional fields that are not on the create
 * screen ("cannot be set"), those fields are dropped and the call is retried once.
 */
async function createIssue(fields: Record<string, unknown>): Promise<string> {
  try {
    const r = await jira<{ key: string }>(route`/rest/api/3/issue`, { method: 'POST', body: { fields }, as: 'user' });
    if (!r?.key) throw new Error('Jira did not return an issue key');
    return r.key;
  } catch (err) {
    if (!(err instanceof JiraError) || err.status !== 400) throw err;
    let errors: Record<string, string> = {};
    try { errors = (JSON.parse(err.body) as { errors?: Record<string, string> }).errors ?? {}; } catch { /* not JSON */ }
    const drop = Object.keys(errors).filter((k) => !REQUIRED.has(k) && k in fields);
    if (drop.length === 0) throw err;
    const reduced = Object.fromEntries(Object.entries(fields).filter(([k]) => !drop.includes(k)));
    const r = await jira<{ key: string }>(route`/rest/api/3/issue`, { method: 'POST', body: { fields: reduced }, as: 'user' });
    if (!r?.key) throw new Error('Jira did not return an issue key');
    return r.key;
  }
}

/** Atomically swaps the token for a tombstone; only the caller that saw the plan may proceed. */
async function claimToken(key: string): Promise<PendingPlan | undefined> {
  const previous = await kvs.set<string, PendingPlan | string>(key, 'used', { keyPolicy: 'OVERRIDE', returnValue: 'PREVIOUS', ttl: TOKEN_TTL });
  const value = previous?.value;
  return value && typeof value === 'object' ? value : undefined;
}

async function underHourlyCap(accountId: string): Promise<boolean> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `cleanupcount:${accountId.replace(/[^a-zA-Z0-9:._-]/g, '')}:${hour}`;
  const used = (await kvs.get<number>(key)) ?? 0;
  if (used >= MAX_PLANS_PER_HOUR) return false;
  await kvs.set(key, used + 1, { ttl: { value: 2, unit: 'HOURS' } });
  return true;
}

export async function createCleanupPlan(accountId: string, rawToken: unknown) {
  if (typeof rawToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawToken.trim())) {
    throw new InvalidInputError('A valid confirmToken from preview-cleanup-plan is required. Run the preview first and confirm with the user.');
  }
  const key = tokenKey(rawToken.trim());
  const pending = await claimToken(key); // single use, even under concurrent calls
  if (!pending) throw new InvalidInputError('This confirmation token is unknown, already used, or expired (15 minutes). Run preview-cleanup-plan again.');
  if (pending.accountId !== accountId) throw new InvalidInputError('This confirmation token was issued to a different user.');
  if (!(await underHourlyCap(accountId))) throw new InvalidInputError(`At most ${MAX_PLANS_PER_HOUR} cleanup plans per hour can be created per admin.`);
  const { plan } = pending;
  const started = Date.now();
  // Intent record BEFORE writing: if the invocation dies mid-way, the audit log still shows the attempt.
  await writeAudit({ at: new Date(started).toISOString(), accountId, action: 'create-cleanup-plan', source: 'rovo', inputs: { project: plan.projectKey, tasks: plan.tasks.length }, outcome: 'started', summary: `creating 1 + ${plan.tasks.length} issues in ${plan.projectKey}`, durationMs: 0 });
  const types = await issueTypes(plan.projectKey);
  const parentType = types.epic ?? types.task;
  const parentKey = await createIssue({ project: { key: plan.projectKey }, issuetype: { id: parentType.id }, summary: plan.epic.summary, description: plan.epic.description, labels: ['config-doctor-cleanup'] });
  const created: string[] = [];
  const failed: Array<{ findingId: string; error: string }> = [];
  const notCreated: string[] = [];
  for (const t of plan.tasks) {
    if (Date.now() - started > CREATE_BUDGET_MS) { notCreated.push(t.findingId); continue; }
    const base = { project: { key: plan.projectKey }, issuetype: { id: types.task.id }, summary: t.summary, description: t.description, labels: t.labels };
    try {
      created.push(await createIssue(types.epic ? { ...base, parent: { key: parentKey } } : base));
    } catch (err) {
      // Only a rejected parent link (400) is retried unlinked; anything else may have been applied.
      if (err instanceof JiraError && err.status === 400 && types.epic) {
        try {
          created.push(await createIssue(base));
          continue;
        } catch (err2) {
          failed.push({ findingId: t.findingId, error: err2 instanceof JiraError ? `HTTP ${err2.status}` : String(err2) });
          continue;
        }
      }
      failed.push({ findingId: t.findingId, error: err instanceof JiraError ? `HTTP ${err.status}` : String(err) });
    }
  }
  const base = await jiraGet<{ baseUrl: string }>(route`/rest/api/3/serverInfo`);
  return { container: parentKey, containerUrl: `${base.baseUrl}/browse/${parentKey}`, created, failed, ...(notCreated.length ? { notCreatedTimeBudget: notCreated } : {}) };
}

export const previewCleanupPlanAction = defineAction({
  key: 'preview-cleanup-plan',
  async run({ payload, accountId }) {
    return previewCleanupPlan(accountId!, payload.projectKey, payload.findingIds);
  },
  summarize: (r) => `preview ${r.willCreate.project}: ${r.willCreate.tasks.length} tasks`,
});

export const createCleanupPlanAction = defineAction({
  key: 'create-cleanup-plan',
  async run({ payload, accountId }) {
    return createCleanupPlan(accountId!, payload.confirmToken);
  },
  summarize: (r) => `created ${r.container} + ${r.created.length} tasks${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
});
