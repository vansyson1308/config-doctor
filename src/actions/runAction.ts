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

export function defineAction<T extends object>(spec: ActionSpec<T>) {
  return async (payload: ActionPayload = {}, context: ForgeContext = {}): Promise<ActionResult> => {
    const started = Date.now();
    const accountId = context.principal?.accountId ?? null;
    let outcome: AuditRecord['outcome'] = 'ok';
    let summary = '';
    let result: ActionResult;
    try {
      if (spec.requireAdmin !== false) await requireJiraAdmin(accountId ?? undefined);
      const data = await spec.run({ payload, accountId });
      summary = spec.summarize(data);
      result = { ok: true, ...data };
    } catch (err: unknown) {
      if (err instanceof NotAuthorizedError) outcome = 'denied';
      else if (err instanceof InvalidInputError) outcome = 'invalid-input';
      else outcome = 'error';
      const message = err instanceof JiraError
        ? `Jira returned HTTP ${err.status} for ${err.path}.`
        : err instanceof Error ? err.message : 'Unexpected error';
      if (outcome === 'error') log.error(`action ${spec.key} failed`, err);
      summary = message.slice(0, 300);
      result = { ok: false, error: { kind: outcome, message } };
    }
    try {
      await writeAudit({
        at: new Date(started).toISOString(),
        accountId,
        action: spec.key,
        source: sourceOf(payload),
        inputs: sanitizeInputs(payload),
        outcome,
        summary,
        durationMs: Date.now() - started,
      });
    } catch (err: unknown) {
      // The action result is still returned; a failed audit write is logged loudly.
      log.error(`audit write failed for ${spec.key}`, err);
    }
    return result;
  };
}
