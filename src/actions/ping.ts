// M0 hello-world action: proves the app can call Jira and identify / authorize the invoking user.
// With input note="probe" it also reports, per config endpoint, the HTTP status as app and as user,
// which is how RESEARCH.md's asApp/asUser decisions were verified.
import { checkInvokingUserIsAdmin } from '../jira/auth';
import { JiraError, jira, jiraGet, route, type Principal } from '../jira/client';
import { defineAction } from './runAction';
import type { Route } from '@forge/api';

interface ServerInfo {
  baseUrl: string;
  version: string;
  deploymentType: string;
  serverTitle: string;
  serverTime: string;
}

async function status(path: Route, as: Principal): Promise<number> {
  try {
    await jira<unknown>(path, { as });
    return 200;
  } catch (err: unknown) {
    return err instanceof JiraError ? err.status : -1;
  }
}

async function probe(accountId: string): Promise<Record<string, { app: number; user: number }>> {
  const endpoints: Record<string, () => Route> = {
    'GET /permissionscheme?expand=all': () => route`/rest/api/3/permissionscheme?expand=all`,
    'GET /role': () => route`/rest/api/3/role`,
    'GET /project/search': () => route`/rest/api/3/project/search?maxResults=5`,
    'GET /group/bulk': () => route`/rest/api/3/group/bulk?maxResults=5`,
    'GET /user/groups': () => route`/rest/api/3/user/groups?accountId=${accountId}`,
    'GET /issuesecurityschemes/level/member': () => route`/rest/api/3/issuesecurityschemes/level/member?maxResults=5`,
    'GET /field/search?type=custom': () => route`/rest/api/3/field/search?type=custom&maxResults=5&expand=lastUsed,screensCount`,
    'GET /screens': () => route`/rest/api/3/screens?maxResults=5`,
    'GET /workflows/search': () => route`/rest/api/3/workflows/search?maxResults=5`,
    'GET /workflowscheme': () => route`/rest/api/3/workflowscheme?maxResults=5`,
    'GET /user/permission/search': () => route`/rest/api/3/user/permission/search?permissions=BROWSE_PROJECTS&maxResults=5&projectKey=${'SALES'}`,
  };
  const out: Record<string, { app: number; user: number }> = {};
  for (const [name, build] of Object.entries(endpoints)) {
    out[name] = { app: await status(build(), 'app'), user: await status(build(), 'user') };
  }
  return out;
}

export const pingJira = defineAction({
  key: 'ping-jira',
  requireAdmin: false,
  async run({ payload, accountId }) {
    const server = await jiraGet<ServerInfo>(route`/rest/api/3/serverInfo`);
    const admin = accountId ? await checkInvokingUserIsAdmin() : { isAdmin: false, method: 'none' };
    const wantsProbe = typeof payload.note === 'string' && payload.note.toLowerCase().includes('probe');
    return {
      site: { baseUrl: server.baseUrl, title: server.serverTitle, version: server.version, deploymentType: server.deploymentType, serverTime: server.serverTime },
      invokingUser: { accountId, isJiraAdmin: admin.isAdmin, checkedWith: admin.method },
      ...(wantsProbe && accountId && admin.isAdmin ? { endpointProbe: await probe(accountId) } : {}),
    };
  },
  summarize: (r) => `site=${r.site.baseUrl} admin=${r.invokingUser.isJiraAdmin}${'endpointProbe' in r ? ' probe' : ''}`,
});
