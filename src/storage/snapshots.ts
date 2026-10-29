// Audit snapshots in KVS. Keys sort newest-first (inverted timestamp). Each scan stores:
//   snap:<inv>     the full AuditResult (findings capped per rule by the core)
//   snapsum:<inv>  a small summary used for the trend chart
import { kvs, WhereConditions } from '@forge/kvs';
import type { AuditResult, Rule } from '../core/sprawl';

export interface SnapshotMeta {
  jobId: string;
  trigger: string;
  requestedBy: string | null;
  durationMs: number;
}

export interface Snapshot extends AuditResult {
  meta: SnapshotMeta;
}

export interface SnapshotSummary {
  scannedAt: string;
  healthScore: number;
  findings: number;
  counts: Record<Rule, number>;
  trigger: string;
}

const MAX_TS = 9_999_999_999_999;
const TTL = { value: 365, unit: 'DAYS' } as const;
const MAX_BYTES = 230 * 1024;

const inv = (iso: string) => String(MAX_TS - Date.parse(iso)).padStart(13, '0');

/** Trims evidence until the snapshot fits the KVS value limit. */
export function fitSnapshot(s: Snapshot): Snapshot {
  let out = s;
  for (const keep of [5, 3, 1]) {
    if (Buffer.byteLength(JSON.stringify(out)) <= MAX_BYTES) return out;
    out = { ...out, findings: out.findings.map((f) => ({ ...f, evidence: f.evidence.slice(0, keep), objects: f.objects.slice(0, keep * 4) })) };
  }
  while (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES && out.findings.length > 0) {
    out = { ...out, findings: out.findings.slice(0, Math.floor(out.findings.length * 0.8)) };
  }
  return out;
}

export async function saveSnapshot(s: Snapshot): Promise<void> {
  const key = inv(s.scannedAt);
  const fitted = fitSnapshot(s);
  await kvs.set(`snap:${key}`, fitted, { ttl: TTL });
  const summary: SnapshotSummary = { scannedAt: s.scannedAt, healthScore: s.healthScore, findings: s.findings.length, counts: s.counts, trigger: s.meta.trigger };
  await kvs.set(`snapsum:${key}`, summary, { ttl: TTL });
}

export async function latestSnapshots(n: number): Promise<Snapshot[]> {
  const page = await kvs.query().where('key', WhereConditions.beginsWith('snap:')).limit(n).getMany<Snapshot>();
  return page.results.map((r) => r.value);
}

export async function trend(n = 12): Promise<SnapshotSummary[]> {
  const page = await kvs.query().where('key', WhereConditions.beginsWith('snapsum:')).limit(n).getMany<SnapshotSummary>();
  return page.results.map((r) => r.value).reverse();
}

/** Finding ids present in `latest` but not in `previous` (F4 "new since last scan"). */
export function newFindingIds(latest: Snapshot, previous: Snapshot | undefined): string[] {
  if (!previous) return [];
  const before = new Set(previous.findings.map((f) => f.id));
  return latest.findings.filter((f) => !before.has(f.id)).map((f) => f.id);
}
