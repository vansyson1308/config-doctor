// Thin, defensive wrapper over Forge's requestJira.
// - asApp(): the app's own identity. Used for admin-config reads after the INVOKING user's
//   admin status has been verified server-side (see auth.ts). Documented per endpoint in RESEARCH.md.
// - asUser(): the invoking user's identity, used where Jira should enforce the user's own access.
// Retries 429 / 503 with backoff (honours Retry-After), paginates every list endpoint.
import api, { route, type Route } from '@forge/api';

export { route };
export type Principal = 'app' | 'user';

export class JiraError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Jira ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'JiraError';
  }
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function requester(as: Principal) {
  return as === 'user' ? api.asUser() : api.asApp();
}

export interface RequestOptions {
  as?: Principal;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Status codes that should be returned as null instead of throwing (e.g. 404). */
  allow?: number[];
}

export async function jira<T>(path: Route, opts: RequestOptions = {}): Promise<T | null> {
  const { as = 'app', method = 'GET', body, allow = [] } = opts;
  for (let attempt = 1; ; attempt++) {
    const res = await requester(as).requestJira(path, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // 429 means "not processed"; 503 on a POST is ambiguous (it may have been applied), so only GETs retry it.
    const retryable = res.status === 429 || (res.status === 503 && method === 'GET');
    if (retryable && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
      await sleep(Math.min(waitMs, 8000) + Math.floor(Math.random() * 250));
      continue;
    }
    if (allow.includes(res.status)) return null;
    if (!res.ok) throw new JiraError(res.status, path.value, await res.text());
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
}

/** Like jira() but never returns null for a 2xx response. */
export async function jiraGet<T>(path: Route, as: Principal = 'app'): Promise<T> {
  const result = await jira<T>(path, { as });
  if (result === null) throw new JiraError(204, path.value, 'empty response');
  return result;
}

interface OffsetPage<T> {
  values?: T[];
  isLast?: boolean;
  total?: number;
  startAt?: number;
  maxResults?: number;
}

/**
 * Collects every page of a startAt/maxResults endpoint.
 * `build(startAt)` must return the route for that page.
 */
export async function paginate<T>(
  build: (startAt: number) => Route,
  opts: { as?: Principal; maxItems?: number } = {},
): Promise<T[]> {
  const { as = 'app', maxItems = 5000 } = opts;
  const out: T[] = [];
  let startAt = 0;
  while (out.length < maxItems) {
    const page = await jiraGet<OffsetPage<T>>(build(startAt), as);
    const values = page.values ?? [];
    out.push(...values);
    if (values.length === 0 || page.isLast === true) break;
    if (page.total !== undefined && startAt + values.length >= page.total) break;
    startAt += values.length;
  }
  return out.slice(0, maxItems);
}
