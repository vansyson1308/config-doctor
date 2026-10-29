// Input validation for values that reach us from the Rovo LLM (which can hallucinate).
// Pure functions only: no Forge imports.

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,254}-[1-9][0-9]{0,9}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,254}$/;
// Atlassian account IDs: legacy 24-hex ids or "<number>:<uuid>" style ids.
const ACCOUNT_ID = /^(?:[0-9a-f]{24}|[0-9]{1,10}:[0-9a-f-]{36}|[0-9a-zA-Z:_-]{10,128})$/;

/** Normalises and validates a Jira issue key such as "proj-123" -> "PROJ-123". */
export function parseIssueKey(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'issueKey must be a string' };
  const value = raw.trim().toUpperCase();
  if (!ISSUE_KEY.test(value)) return { ok: false, error: `"${raw}" is not a valid issue key (expected e.g. PROJ-123)` };
  return { ok: true, value };
}

export function parseProjectKey(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'projectKey must be a string' };
  const value = raw.trim().toUpperCase();
  if (!PROJECT_KEY.test(value)) return { ok: false, error: `"${raw}" is not a valid project key` };
  return { ok: true, value };
}

export function looksLikeAccountId(raw: string): boolean {
  return ACCOUNT_ID.test(raw.trim()) && !raw.includes('@') && !/\s/.test(raw.trim());
}

/** Trims a free-text input, rejecting empty or oversized values. */
export function parseText(raw: unknown, field: string, maxLength = 200): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${field} must be a string` };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: `${field} is required` };
  if (value.length > maxLength) return { ok: false, error: `${field} is longer than ${maxLength} characters` };
  return { ok: true, value };
}

/** Optional free text: undefined/empty becomes undefined. */
export function parseOptionalText(raw: unknown, field: string, maxLength = 200): Validation<string | undefined> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, value: undefined };
  }
  return parseText(raw, field, maxLength);
}
