// Rovo action `explain-access`: "Why can't <user> see/edit <issue|project>?"
// Deterministic: loads config, runs src/core/access.ts, cross-checks with Jira's permission check.
import { explainAccess as explain, reconcile, type AccessVerdict } from '../core/access';
import { normalizePermission } from '../core/permissionKeys';
import { jiraGet, route } from '../jira/client';
import { NotFoundError, jiraPermissionVerdict, loadFieldNames, loadIssue, loadProject, loadProjectScheme, loadRoleNames, namesFrom, resolveUser } from '../jira/loaders';
import { getSiteIndex } from '../jira/siteIndexLoader';
import { parseSubject, parseTarget } from './inputs';
import { InvalidInputError, defineAction } from './runAction';

const BUDGET_MS = 45_000;

export async function siteBaseUrl(): Promise<string> {
  const info = await jiraGet<{ baseUrl: string }>(route`/rest/api/3/serverInfo`);
  return info.baseUrl;
}

export async function runExplainAccess(input: { user: string; target: string; permission?: string }, invokingAccountId: string | null): Promise<AccessVerdict & { siteIndex: { complete: boolean; projects: number } | null; readAs?: 'user' | 'app' }> {
  const started = Date.now();
  const perm = normalizePermission(input.permission);
  if (!perm.ok) throw new InvalidInputError(perm.error);
  const target = parseTarget({ issueKey: input.target });
  const { query } = parseSubject({ user: input.user }, invokingAccountId);

  const [{ user: subject }, roleNames, baseUrl] = await Promise.all([resolveUser(query, 'user'), loadRoleNames('user'), siteBaseUrl()]);
  let projectKey = target.kind === 'project' ? target.projectKey : target.issueKey.split('-')[0]!;
  let scheme = await loadProjectScheme(projectKey, 'user');
  let schemeHolders = scheme.grants.map((g) => g.holder);
  let loadedIssue = target.kind === 'issue' ? await loadIssue(target.issueKey, schemeHolders, 'user') : undefined;
  if (loadedIssue && loadedIssue.projectKey !== projectKey) {
    // Old issue keys survive project moves: use the issue's real project and reload once.
    projectKey = loadedIssue.projectKey;
    scheme = await loadProjectScheme(projectKey, 'user');
    schemeHolders = scheme.grants.map((g) => g.holder);
    loadedIssue = await loadIssue(loadedIssue.issue.key, schemeHolders, 'user');
  }
  const levelHolders = loadedIssue?.issue.securityLevel?.members ?? [];
  const project = await loadProject(projectKey, [...schemeHolders, ...levelHolders], roleNames, 'user');
  const fieldIds = [...schemeHolders, ...levelHolders].filter((h) => /CustomField$/.test(h.type)).map((h) => h.value ?? h.parameter ?? '');
  const names = namesFrom(scheme, roleNames, await loadFieldNames(fieldIds, 'user'), levelHolders);

  const base = { subject, project, scheme, permission: perm.value, names, baseUrl, ...(loadedIssue ? { issue: loadedIssue.issue } : {}) };
  let verdict = explain(base);
  let siteIndex: { complete: boolean; projects: number } | null = null;
  if (verdict.verdict === 'NO_ACCESS' && verdict.blockingLayer !== 'ACCOUNT') {
    // Blast radius needs the site-wide index; only load it when we will suggest fixes.
    const index = await getSiteIndex('user', started + BUDGET_MS);
    siteIndex = { complete: index.complete, projects: index.projects.length };
    verdict = explain({ ...base, index });
    if (!index.complete) verdict = { ...verdict, notes: [...verdict.notes, `Blast radius covers ${index.projects.length} of ${index.projectsTotal} projects (time budget reached).`] };
  }
  const expected = verdict.verdict === 'HAS_ACCESS' ? true : verdict.verdict === 'NO_ACCESS' ? false : undefined;
  const jiraCheck = await jiraPermissionVerdict(subject.accountId, perm.value, { projectId: project.id, ...(loadedIssue ? { issueId: loadedIssue.issue.id } : {}) }, expected);
  verdict = reconcile(verdict, jiraCheck.says, 'POST /rest/api/3/permissions/check', jiraCheck.checks);
  if (loadedIssue?.readAs === 'app') verdict = { ...verdict, notes: [...verdict.notes, 'This issue could not be read with your access (an issue security level you are not in, or a temporary Jira inconsistency); it was read with the app\'s access.'] };
  return { ...verdict, siteIndex, readAs: loadedIssue?.readAs ?? 'user' };
}

export const explainAccessAction = defineAction({
  key: 'explain-access',
  async run({ payload, accountId }) {
    const target = typeof payload.issueKey === 'string' && payload.issueKey.trim() ? payload.issueKey : (() => {
      const t = parseTarget(payload);
      return t.kind === 'issue' ? t.issueKey : t.projectKey;
    })();
    try {
      return await runExplainAccess({
        user: String(payload.user ?? ''),
        target,
        ...(typeof payload.permission === 'string' ? { permission: payload.permission } : {}),
      }, accountId);
    } catch (err) {
      if (err instanceof NotFoundError) throw new InvalidInputError(err.message);
      throw err;
    }
  },
  summarize: (v) => `${v.user.displayName} ${v.permission} ${v.issue?.key ?? v.project.key}: ${v.verdict}${v.blockingLayer ? ` (${v.blockingLayer})` : ''}, jira ${v.groundTruthCheck}${v.readAs === 'app' ? ', read as app' : ''}`,
});
