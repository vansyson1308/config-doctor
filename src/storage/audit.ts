// Audit log: every action invocation is recorded in Forge KVS.
// Keys sort newest-first: audit:<inverted-epoch-ms>:<random>.
import { kvs, WhereConditions } from '@forge/kvs';

export interface AuditRecord {
  at: string;
  accountId: string | null;
  action: string;
  source: 'rovo' | 'mcp' | 'admin-page' | 'scheduler' | 'consumer';
  inputs: Record<string, unknown>;
  outcome: 'ok' | 'denied' | 'invalid-input' | 'error';
  summary: string;
  durationMs: number;
}

const PREFIX = 'audit:';
const MAX_TS = 9_999_999_999_999;
const RETENTION = { value: 90, unit: 'DAYS' } as const;

function auditKey(now: number): string {
  const inverted = String(MAX_TS - now).padStart(13, '0');
  return `${PREFIX}${inverted}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Keeps stored inputs small and free of anything that is not a primitive. */
export function sanitizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (k === 'context') continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

export async function writeAudit(record: AuditRecord): Promise<void> {
  await kvs.set(auditKey(Date.parse(record.at)), record, { ttl: RETENTION });
}

export async function readAudit(limit = 50, cursor?: string): Promise<{ records: AuditRecord[]; cursor?: string }> {
  let q = kvs.query().where('key', WhereConditions.beginsWith(PREFIX)).limit(Math.min(Math.max(limit, 1), 100));
  if (cursor) q = q.cursor(cursor);
  const page = await q.getMany<AuditRecord>();
  return { records: page.results.map((r) => r.value), cursor: page.nextCursor };
}
