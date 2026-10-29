// Shared parsing of LLM-supplied action inputs, with deterministic fallbacks from the payload context.
import { parseIssueKey, parseProjectKey } from '../core/validate';
import { InvalidInputError, type ActionPayload } from './runAction';

export type Target = { kind: 'issue'; issueKey: string } | { kind: 'project'; projectKey: string };

/** Accepts an issue key or a project key; falls back to the issue/project the user is looking at. */
export function parseTarget(payload: ActionPayload, field = 'issueKey'): Target {
  const raw = payload[field] ?? payload.target;
  if (typeof raw === 'string' && raw.trim()) {
    const issue = parseIssueKey(raw);
    if (issue.ok) return { kind: 'issue', issueKey: issue.value };
    const project = parseProjectKey(raw);
    if (project.ok) return { kind: 'project', projectKey: project.value };
    throw new InvalidInputError(`"${raw}" is neither an issue key (e.g. PAY-3) nor a project key (e.g. PAY).`);
  }
  const ctx = payload.context?.jira;
  if (ctx?.issueKey) {
    const issue = parseIssueKey(String(ctx.issueKey));
    if (issue.ok) return { kind: 'issue', issueKey: issue.value };
  }
  if (ctx?.projectKey) {
    const project = parseProjectKey(String(ctx.projectKey));
    if (project.ok) return { kind: 'project', projectKey: project.value };
  }
  throw new InvalidInputError('Which issue or project? Give an issue key like PAY-3 or a project key like PAY.');
}

const SELF = /^(me|myself|i|current user|the current user)$/i;

/** The person the question is about; "me" means the invoking user (from context, never inputs). */
export function parseSubject(payload: ActionPayload, invokingAccountId: string | null): { query: string; isSelf: boolean } {
  const raw = payload.user;
  if (typeof raw !== 'string' || raw.trim() === '') throw new InvalidInputError('Which user? Give a name, email or account ID.');
  const text = raw.trim();
  if (text.length > 120) throw new InvalidInputError('The user name is too long.');
  if (SELF.test(text)) {
    if (!invokingAccountId) throw new InvalidInputError('Cannot tell who "me" is without a signed-in user.');
    return { query: invokingAccountId, isSelf: true };
  }
  return { query: text, isSelf: false };
}
