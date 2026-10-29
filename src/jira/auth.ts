// Server-side authorization of the INVOKING user (accountId from the Forge context, never
// from LLM-supplied inputs).
//
// Verified on the dev site 2026-10-30: asApp POST /rest/api/3/permissions/check with another
// user's accountId returns 403 "Only Jira administrators and Connect apps can perform this
// operation", i.e. the Forge app user is not a Jira admin. So the admin check runs as the user
// (GET /rest/api/3/mypermissions?permissions=ADMINISTER via asUser), which Jira answers for the
// authenticated invoking user only and therefore cannot be spoofed by action inputs.
import { jira, route } from './client';

interface MyPermissions {
  permissions?: Record<string, { havePermission?: boolean }>;
}

export interface AdminCheck {
  isAdmin: boolean;
  method: 'mypermissions (asUser)';
}

export async function checkInvokingUserIsAdmin(): Promise<AdminCheck> {
  const mine = await jira<MyPermissions>(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { as: 'user' });
  return { isAdmin: mine?.permissions?.ADMINISTER?.havePermission === true, method: 'mypermissions (asUser)' };
}

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

export async function requireJiraAdmin(accountId: string | undefined): Promise<string> {
  if (!accountId) throw new NotAuthorizedError('No invoking user in context; Config Doctor only runs for signed-in Jira admins.');
  const { isAdmin } = await checkInvokingUserIsAdmin();
  if (!isAdmin) {
    throw new NotAuthorizedError('Config Doctor reads site-wide permission configuration, so it is restricted to Jira administrators (Administer Jira global permission).');
  }
  return accountId;
}
