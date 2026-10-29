// Plain data model of the Jira configuration that access questions depend on.
// Built by src/jira/loaders.ts from REST responses; consumed by pure resolvers in src/core.

/** Permission holder exactly as Jira returns it in permission schemes and security levels. */
export interface Holder {
  type: string;
  parameter?: string;
  value?: string;
}

export interface Grant {
  id?: number;
  permission: string;
  holder: Holder;
}

export interface PermissionScheme {
  id: number;
  name: string;
  grants: Grant[];
}

export interface GroupRef {
  id: string;
  name: string;
}

export interface RoleActors {
  id: string;
  name: string;
  userIds: string[];
  groups: GroupRef[];
}

export interface ProjectModel {
  id: string;
  key: string;
  name: string;
  leadAccountId?: string;
  /** "classic" = company-managed, "next-gen" = team-managed. */
  style: 'classic' | 'next-gen' | string;
  /** Role actors for this project, keyed by role id. */
  roles: Record<string, RoleActors>;
}

export interface SecurityLevel {
  id: string;
  name: string;
  schemeId?: string;
  schemeName?: string;
  members: Holder[];
}

export interface IssueModel {
  key: string;
  id: string;
  reporterId?: string;
  assigneeId?: string;
  securityLevel?: SecurityLevel;
  /** Values of user / group picker custom fields, keyed by field id (e.g. customfield_10050). */
  fieldValues?: Record<string, { userIds: string[]; groupNames: string[] }>;
}

export interface SubjectUser {
  accountId: string;
  displayName: string;
  active: boolean;
  groups: GroupRef[];
  /** Application (product) access keys such as "jira-software"; undefined = not loaded. */
  applicationRoles?: string[];
}

/** Lookup names for ids found in holders (roles, groups, fields), for human-readable evidence. */
export interface NameIndex {
  roles: Record<string, string>;
  groupsById: Record<string, string>;
  fields: Record<string, string>;
}

export const EMPTY_NAMES: NameIndex = { roles: {}, groupsById: {}, fields: {} };
