// Backend for the Jira admin page (F5). Every call is admin-gated and audited (source "admin-page"),
// exactly like the Rovo actions; the page works even on sites where Rovo is not active.
import Resolver from '@forge/resolver';
import { runChangeImpact } from '../actions/changeImpact';
import { runExplainAccess } from '../actions/explainAccess';
import { parseIssueKey } from '../core/validate';
import { InvalidInputError } from '../actions/runAction';
import { runWhoCanSee } from '../actions/whoCanSee';
import { getLabState, previewLab, runLab } from '../lab/labService';
import { tryThese } from '../core/lab';
import { runAudited } from '../actions/runAction';
import { summarizeSnapshot } from '../actions/sprawlAudit';
import { getScanState, isRunning, startScan, STEPS } from '../scan/job';
import { readAudit } from '../storage/audit';
import { latestSnapshots, newFindingIds, trend } from '../storage/snapshots';

const resolver = new Resolver();

interface Req { payload?: Record<string, unknown>; context: { accountId?: string } }
const account = (req: Req) => req.context.accountId ?? null;

resolver.define('getDashboard', async (req: Req) => runAudited({
  key: 'admin-dashboard', source: 'admin-page', accountId: account(req), inputs: {}, audit: false,
  run: async () => {
    const [state, snaps, history] = await Promise.all([getScanState(), latestSnapshots(2), trend(12)]);
    const latest = snaps[0];
    const fresh = latest ? new Set(newFindingIds(latest, snaps[1])) : new Set<string>();
    return {
      scan: state ? { status: isRunning(state) ? 'running' : state.status === 'running' ? 'stuck' : state.status, startedAt: state.startedAt, finishedAt: state.finishedAt ?? null, progress: `${state.stepIndex + 1}/${STEPS.length} ${state.step}`, trigger: state.trigger, error: state.error ?? null } : null,
      summary: latest ? summarizeSnapshot(latest, snaps[1], 5) : null,
      findings: latest ? latest.findings.map((f) => ({ id: f.id, rule: f.rule, title: f.title, risk: f.risk, effort: f.effort, recommendation: f.recommendation, evidence: f.evidence.slice(0, 2).join(' · '), isNew: fresh.has(f.id) })) : [],
      trend: history.map((h) => ({ date: h.scannedAt.slice(0, 16).replace('T', ' '), score: h.healthScore, series: 'Health score' })),
    };
  },
  summarize: (r) => `score ${r.summary?.healthScore ?? 'n/a'}`,
}));

resolver.define('runScan', async (req: Req) => runAudited({
  key: 'admin-run-scan', source: 'admin-page', accountId: account(req), inputs: {},
  run: async () => {
    const r = await startScan('admin-page', account(req));
    return { started: r.started, jobId: r.state.id };
  },
  summarize: (r) => (r.started ? `started ${r.jobId}` : `already running ${r.jobId}`),
}));

resolver.define('getAudit', async (req: Req) => runAudited({
  key: 'admin-audit-log', source: 'admin-page', accountId: account(req), inputs: {}, audit: false,
  run: async () => readAudit(50, typeof req.payload?.cursor === 'string' ? req.payload.cursor : undefined),
  summarize: (r) => `${r.records.length} records`,
}));

resolver.define('checkAccess', async (req: Req) => runAudited({
  key: 'explain-access', source: 'admin-page', accountId: account(req), inputs: req.payload ?? {},
  run: async () => runExplainAccess({
    user: String(req.payload?.user ?? ''),
    target: String(req.payload?.target ?? ''),
    ...(typeof req.payload?.permission === 'string' && req.payload.permission ? { permission: req.payload.permission } : {}),
  }, account(req)),
  summarize: (v) => `${v.user.displayName} ${v.permission} ${v.issue?.key ?? v.project.key}: ${v.verdict}`,
}));

resolver.define('whoCanSee', async (req: Req) => runAudited({
  key: 'list-who-can-see', source: 'admin-page', accountId: account(req), inputs: req.payload ?? {},
  run: async () => {
    const key = parseIssueKey(req.payload?.issueKey);
    if (!key.ok) throw new InvalidInputError(key.error);
    return runWhoCanSee(key.value);
  },
  summarize: (r) => `${r.issue.key}: ${r.viewerCount} viewers, jira ${r.groundTruth.check}`,
}));

resolver.define('previewImpact', async (req: Req) => runAudited({
  key: 'preview-change-impact', source: 'admin-page', accountId: account(req), inputs: req.payload ?? {},
  run: async () => runChangeImpact({ changeType: req.payload?.changeType, target: req.payload?.target, newScheme: req.payload?.newScheme }),
  summarize: (r) => `${r.change}: risk ${r.risk}; ${r.summary}`.slice(0, 280),
}));

resolver.define('labStatus', async (req: Req) => runAudited({
  key: 'demo-lab-status', source: 'admin-page', accountId: account(req), inputs: {}, audit: false,
  run: async () => {
    const state = await getLabState();
    const project = state.objects.find((o) => o.type === 'project');
    return { state, tryThese: state.status === 'ready' && project ? tryThese(project.name) : [] };
  },
  summarize: (r) => r.state.status,
}));

resolver.define('labPreview', async (req: Req) => runAudited({
  key: 'demo-lab-preview', source: 'admin-page', accountId: account(req), inputs: req.payload ?? {},
  run: async () => previewLab(req.payload?.mode === 'remove' ? 'remove' : 'create', account(req)!),
  summarize: (r) => `${r.mode}: ${r.lines.length} lines`,
}));

// Each call runs one time slice (UI resolvers have 25 s); the page calls again until done.
resolver.define('labRun', async (req: Req) => runAudited({
  key: 'demo-lab-run', source: 'admin-page', accountId: account(req), inputs: {}, audit: false,
  run: async () => runLab(account(req)!, typeof req.payload?.token === 'string' ? req.payload.token : undefined),
  summarize: (r) => `${r.mode} ${r.done ? 'done' : 'continuing'}: ${r.status}`,
}));

export const adminResolver = resolver.getDefinitions();
