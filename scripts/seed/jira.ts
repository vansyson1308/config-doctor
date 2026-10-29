// Minimal Jira REST client for the LOCAL demo seeder (not part of the Forge app).
// Auth: the owner's classic API token from .env (Basic auth). Never commit .env.

export interface SeedEnv {
  baseUrl: string;
  email: string;
  token: string;
}

export function readEnv(): SeedEnv {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, '');
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    throw new Error('Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env (see .env.example).');
  }
  if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(baseUrl)) {
    throw new Error(`JIRA_BASE_URL must look like https://<site>.atlassian.net, got ${baseUrl}`);
  }
  return { baseUrl, email, token };
}

export class JiraHttpError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, body: string) {
    super(`${status} ${path}: ${body.slice(0, 400)}`);
    this.status = status;
    this.path = path;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function client(env: SeedEnv) {
  const auth = 'Basic ' + Buffer.from(`${env.email}:${env.token}`).toString('base64');

  async function call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(env.baseUrl + path, {
        method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt < 5) {
        const ra = Number(res.headers.get('Retry-After'));
        await sleep((Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok && !okStatuses.includes(res.status)) throw new JiraHttpError(res.status, `${method} ${path}`, text);
      return (text ? JSON.parse(text) : null) as T;
    }
  }

  return {
    get: <T>(path: string) => call<T>('GET', path),
    post: <T>(path: string, body?: unknown, ok: number[] = []) => call<T>('POST', path, body, ok),
    put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body),
    /** Collects every page of a startAt/maxResults endpoint that returns { values, isLast, total }. */
    async all<T>(path: string, pageSize = 50): Promise<T[]> {
      const out: T[] = [];
      for (let startAt = 0; ; ) {
        const sep = path.includes('?') ? '&' : '?';
        const page = await call<{ values?: T[]; isLast?: boolean; total?: number }>('GET', `${path}${sep}startAt=${startAt}&maxResults=${pageSize}`);
        const values = page.values ?? [];
        out.push(...values);
        if (values.length === 0 || page.isLast === true || (page.total !== undefined && out.length >= page.total)) return out;
        startAt += values.length;
      }
    },
  };
}

export type Jira = ReturnType<typeof client>;
