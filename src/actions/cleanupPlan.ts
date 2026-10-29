// Cleanup plan = the ONLY write Config Doctor performs, and only in two explicit steps:
//   preview-cleanup-plan (GET)   → shows exactly what would be created and returns a one-time token
//   create-cleanup-plan (CREATE) → creates the issues, only with a valid token issued to the SAME user
// Tokens live 15 minutes in KVS, are single-use, and are bound to accountId + project + finding ids.
import { randomUUID } from 'node:crypto';
import { kvs } from '@forge/kvs';
import { buildCleanupPlan, parseFindingIds, selectFindings, type CleanupPlan } from '../core/cleanupPlan';
import { parseProjectKey } from '../core/validate';
import { JiraError, jira, jiraGet, route } from '../jira/client';
import { latestSnapshots } from '../storage/snapshots';
import { InvalidInputError, defineAction } from './runAction';

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

export async function createCleanupPlan(accountId: string, rawToken: unknown) {
  if (typeof rawToken !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawToken.trim())) {
    throw new InvalidInputError('A valid confirmToken from preview-cleanup-plan is required. Run the preview first and confirm with the user.');
  }
  const key = tokenKey(rawToken.trim());
  const pending = await kvs.get<PendingPlan>(key);
  if (!pending) throw new InvalidInputError('This confirmation token is unknown or expired (15 minutes). Run preview-cleanup-plan again.');
  if (pending.accountId !== accountId) throw new InvalidInputError('This confirmation token was issued to a different user.');
  await kvs.delete(key); // single use, even if creation fails part-way
  const { plan } = pending;
  const types = await issueTypes(plan.projectKey);
  const parentType = types.epic ?? types.task;
  const parentKey = await createIssue({ project: { key: plan.projectKey }, issuetype: { id: parentType.id }, summary: plan.epic.summary, description: plan.epic.description, labels: ['config-doctor-cleanup'] });
  const created: string[] = [];
  const failed: Array<{ findingId: string; error: string }> = [];
  for (const t of plan.tasks) {
    const base = { project: { key: plan.projectKey }, issuetype: { id: types.task.id }, summary: t.summary, description: t.description, labels: t.labels };
    try {
      created.push(await createIssue(types.epic ? { ...base, parent: { key: parentKey } } : base));
    } catch (err) {
      try {
        created.push(await createIssue(base)); // parent link not allowed in this project: create unlinked
      } catch (err2) {
        failed.push({ findingId: t.findingId, error: err2 instanceof JiraError ? `HTTP ${err2.status}` : String(err2) });
      }
      void err;
    }
  }
  const base = await jiraGet<{ baseUrl: string }>(route`/rest/api/3/serverInfo`);
  return { container: parentKey, containerUrl: `${base.baseUrl}/browse/${parentKey}`, created, failed };
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
