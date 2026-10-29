// Shared wrapper for every Rovo action / MCP tool:
//  1. identifies the invoking user from the Forge context (never from inputs),
//  2. enforces Jira-admin authorization server-side (unless the action opts out),
//  3. times the call and writes an audit record whatever the outcome,
//  4. returns a JSON object the agent can phrase. Errors become structured results, not throws,
//     so the agent can explain them instead of failing silently.
import { NotAuthorizedError, requireJiraAdmin } from '../jira/auth';
import { JiraError } from '../jira/client';
import { sanitizeInputs, writeAudit, type AuditRecord } from '../storage/audit';
import { log } from '../util/log';

export interface ForgeContext {
  principal?: { accountId: string };
  installContext?: string;
}

export type ActionPayload = Record<string, unknown> & {
  context?: { cloudId?: string; moduleKey?: string; jira?: { issueKey?: string; projectKey?: string } };
};

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export interface ActionResult {
  ok: boolean;
  error?: { kind: AuditRecord['outcome']; message: string };
  [key: string]: unknown;
}

export interface ActionSpec<T> {
  key: string;
  requireAdmin?: boolean;
  run: (args: { payload: ActionPayload; accountId: string | null }) => Promise<T>;
  summarize: (result: T) => string;
}

function sourceOf(payload: ActionPayload): AuditRecord['source'] {
  return payload.context?.moduleKey ? 'rovo' : 'mcp';
}

/**
 * Runs `fn` with the admin gate, timing, structured errors and an audit record. Shared by Rovo
 * actions, MCP tools and the admin page resolver.
 */
export async function runAudited<T extends object>(opts: {
  key: string;
  source: AuditRecord['source'];
  accountId: string | null;
  inputs: Record<string, unknown>;
  requireAdmin?: boolean;
  /** false for read-only page views (dashboard polling); actions are always audited. */
  audit?: boolean;
  run: () => Promise<T>;
  summarize: (result: T) => string;
}): Promise<ActionResult> {
  const started = Date.now();
  let outcome: AuditRecord['outcome'] = 'ok';
  let summary = '';
  let result: ActionResult;
  try {
    if (opts.requireAdmin !== false) await requireJiraAdmin(opts.accountId ?? undefined);
    const data = await opts.run();
    summary = opts.summarize(data);
    result = { ok: true, ...data };
  } catch (err: unknown) {
    if (err instanceof NotAuthorizedError) outcome = 'denied';
    else if (err instanceof InvalidInputError) outcome = 'invalid-input';
    else outcome = 'error';
    const message = err instanceof JiraError
      ? `Jira returned HTTP ${err.status} for ${err.path}.`
      : err instanceof Error ? err.message : 'Unexpected error';
    if (outcome === 'error') log.error(`action ${opts.key} failed`, err);
    summary = message.slice(0, 300);
    result = { ok: false, error: { kind: outcome, message } };
  }
  log.info('action', { action: opts.key, source: opts.source, outcome, summary, durationMs: Date.now() - started });
  if (opts.audit === false && outcome !== 'denied') return result;
  try {
    await writeAudit({
      at: new Date(started).toISOString(),
      accountId: opts.accountId,
      action: opts.key,
      source: opts.source,
      inputs: sanitizeInputs(opts.inputs),
      outcome,
      summary,
      durationMs: Date.now() - started,
    });
  } catch (err: unknown) {
    // The result is still returned; a failed audit write is logged loudly.
    log.error(`audit write failed for ${opts.key}`, err);
  }
  return result;
}

export function defineAction<T extends object>(spec: ActionSpec<T>) {
  return async (payload: ActionPayload = {}, context: ForgeContext = {}): Promise<ActionResult> => {
    const accountId = context.principal?.accountId ?? null;
    return runAudited({
      key: spec.key,
      source: sourceOf(payload),
      accountId,
      inputs: payload,
      ...(spec.requireAdmin !== undefined ? { requireAdmin: spec.requireAdmin } : {}),
      run: () => spec.run({ payload, accountId }),
      summarize: spec.summarize,
    });
  };
}
