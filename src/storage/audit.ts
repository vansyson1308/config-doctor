// Audit log: every action invocation is recorded in Forge KVS.
// Keys sort newest-first: audit:<inverted-epoch-ms>:<random>.
import { kvs, WhereConditions } from '@forge/kvs';

export interface AuditRecord {
  at: string;
  accountId: string | null;
  action: string;
  source: 'rovo' | 'mcp' | 'admin-page' | 'scheduler' | 'consumer';
  inputs: Record<string, unknown>;
  outcome: 'ok' | 'started' | 'denied' | 'invalid-input' | 'error';
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

const MAX_INPUT_KEYS = 12;
const MAX_INPUTS_BYTES = 2048;
const SECRET_KEY = /token|secret|password|auth/i;

/**
 * Keeps stored inputs small, primitive and non-secret, so an oversized or hostile payload can
 * never make the audit write fail (KVS 240 KiB limit) or store credential-like values.
 */
export function sanitizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let bytes = 0;
  for (const [k, v] of Object.entries(inputs)) {
    if (k === 'context' || Object.keys(out).length >= MAX_INPUT_KEYS) continue;
    const key = k.slice(0, 40);
    let value: unknown;
    if (SECRET_KEY.test(key)) value = '[redacted]';
    else if (typeof v === 'string') value = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) value = v;
    else continue;
    bytes += key.length + JSON.stringify(value).length;
    if (bytes > MAX_INPUTS_BYTES) break;
    out[key] = value;
  }
  return out;
}

/**
 * Writes one audit record. Denied calls are coalesced per account per minute (the key is
 * deterministic), so a non-admin cannot flood the log and bury real activity.
 */
export async function writeAudit(record: AuditRecord): Promise<void> {
  const at = Date.parse(record.at);
  const key = record.outcome === 'denied'
    ? `${PREFIX}${String(MAX_TS - Math.floor(at / 60_000) * 60_000).padStart(13, '0')}:denied-${(record.accountId ?? 'anon').replace(/[^a-zA-Z0-9:._-]/g, '')}`
    : auditKey(at);
  await kvs.set(key, record, { ttl: RETENTION });
}

export async function readAudit(limit = 50, cursor?: string): Promise<{ records: AuditRecord[]; cursor?: string }> {
  let q = kvs.query().where('key', WhereConditions.beginsWith(PREFIX)).limit(Math.min(Math.max(limit, 1), 100));
  if (cursor) q = q.cursor(cursor);
  const page = await q.getMany<AuditRecord>();
  return { records: page.results.map((r) => r.value), cursor: page.nextCursor };
}
