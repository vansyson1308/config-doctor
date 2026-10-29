// Rovo action `run-sprawl-audit` (F2/F4): returns the latest cached audit, starting a background
// scan when there is none or it is older than a day. Chat never waits for a full scan.
import type { Finding } from '../core/sprawl';
import { jiraGet, route } from '../jira/client';
import { getScanState, isRunning, startScan, STEPS, type ScanState } from '../scan/job';
import { latestSnapshots, newFindingIds, trend, type Snapshot } from '../storage/snapshots';
import { defineAction } from './runAction';

const FRESH_MS = 24 * 60 * 60_000;

function brief(f: Finding) {
  return { id: f.id, title: f.title, risk: f.risk, effort: f.effort, evidence: f.evidence.slice(0, 3), recommendation: f.recommendation };
}

function scanStatus(s: ScanState | undefined) {
  if (!s) return { status: 'never-run' as const };
  return {
    status: isRunning(s) ? ('running' as const) : s.status === 'running' ? ('stuck' as const) : s.status,
    startedAt: s.startedAt,
    ...(s.finishedAt ? { finishedAt: s.finishedAt } : {}),
    progress: `${s.stepIndex + 1}/${STEPS.length} (${s.step})`,
    ...(s.error ? { error: s.error } : {}),
  };
}

export function summarizeSnapshot(latest: Snapshot, previous: Snapshot | undefined, top = 10) {
  const fresh = new Set(newFindingIds(latest, previous));
  return {
    scannedAt: latest.scannedAt,
    healthScore: latest.healthScore,
    previousScore: previous?.healthScore ?? null,
    breakdown: latest.breakdown.filter((b) => b.penalty > 0),
    counts: latest.counts,
    totals: latest.totals,
    coverage: latest.coverage,
    topFindings: latest.findings.slice(0, top).map((f) => ({ ...brief(f), newSinceLastScan: fresh.has(f.id) })),
    totalFindings: latest.findings.length,
    newSinceLastScan: fresh.size,
  };
}

export async function runSprawlAudit(accountId: string | null, source: ScanState['trigger']) {
  const [state, snaps, history] = await Promise.all([getScanState(), latestSnapshots(2), trend(6)]);
  const latest = snaps[0];
  let action: 'cached' | 'scan-started' | 'scan-running' = 'cached';
  let current = state;
  const stale = !latest || Date.now() - Date.parse(latest.scannedAt) > FRESH_MS;
  if (isRunning(state)) action = 'scan-running';
  else if (stale) {
    const r = await startScan(source, accountId);
    current = r.state;
    action = r.started ? 'scan-started' : 'scan-running';
  }
  // The scan reads as the app; compare with what this admin can see so hidden projects are not silent.
  const visible = await jiraGet<{ total?: number }>(route`/rest/api/3/project/search?maxResults=1`, 'user').catch(() => ({ total: undefined }));
  const hiddenFromScan = latest && visible.total !== undefined && visible.total > latest.coverage.projectsTotal ? visible.total - latest.coverage.projectsTotal : 0;
  return {
    action,
    scan: scanStatus(current),
    ...(hiddenFromScan ? { coverageWarning: `You can see ${visible.total} projects but the scan saw ${latest!.coverage.projectsTotal}; findings about unused schemes may be wrong for ${hiddenFromScan} project(s) the app cannot browse.` } : {}),
    snapshot: latest ? summarizeSnapshot(latest, snaps[1]) : null,
    trend: history.map((h) => ({ scannedAt: h.scannedAt, healthScore: h.healthScore })),
    note: latest
      ? action === 'cached' ? 'Results are from the latest completed scan.' : 'Showing the previous completed scan while a new one runs (usually 1–3 minutes).'
      : 'No completed scan yet. A scan has been started; ask again in a few minutes.',
  };
}

export const sprawlAuditAction = defineAction({
  key: 'run-sprawl-audit',
  async run({ accountId, payload }) {
    return runSprawlAudit(accountId, payload.context?.moduleKey ? 'rovo' : 'mcp');
  },
  summarize: (r) => `${r.action}; score ${r.snapshot?.healthScore ?? 'n/a'}; ${r.snapshot?.totalFindings ?? 0} findings`,
});
