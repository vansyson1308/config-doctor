// Maps the wording people (and the LLM) use to Jira's built-in project permission keys.
// Unknown wording is rejected with the list of supported keys rather than guessed.
import type { Validation } from './validate';

export const PROJECT_PERMISSIONS = [
  'BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES', 'ASSIGN_ISSUES', 'ASSIGNABLE_USER',
  'RESOLVE_ISSUES', 'CLOSE_ISSUES', 'DELETE_ISSUES', 'LINK_ISSUES', 'MOVE_ISSUES', 'SCHEDULE_ISSUES',
  'SET_ISSUE_SECURITY', 'MODIFY_REPORTER', 'ADD_COMMENTS', 'EDIT_ALL_COMMENTS', 'EDIT_OWN_COMMENTS',
  'DELETE_ALL_COMMENTS', 'DELETE_OWN_COMMENTS', 'CREATE_ATTACHMENTS', 'DELETE_ALL_ATTACHMENTS',
  'DELETE_OWN_ATTACHMENTS', 'WORK_ON_ISSUES', 'EDIT_OWN_WORKLOGS', 'EDIT_ALL_WORKLOGS', 'DELETE_OWN_WORKLOGS',
  'DELETE_ALL_WORKLOGS', 'MANAGE_WATCHERS', 'VIEW_VOTERS_AND_WATCHERS', 'ADMINISTER_PROJECTS',
  'MANAGE_SPRINTS_PERMISSION', 'VIEW_DEV_TOOLS', 'VIEW_READONLY_WORKFLOW', 'SERVICEDESK_AGENT',
] as const;

const SYNONYMS: Record<string, string> = {
  see: 'BROWSE_PROJECTS', view: 'BROWSE_PROJECTS', browse: 'BROWSE_PROJECTS', read: 'BROWSE_PROJECTS', access: 'BROWSE_PROJECTS', open: 'BROWSE_PROJECTS',
  edit: 'EDIT_ISSUES', update: 'EDIT_ISSUES', change: 'EDIT_ISSUES', modify: 'EDIT_ISSUES',
  create: 'CREATE_ISSUES', 'create issue': 'CREATE_ISSUES', 'create issues': 'CREATE_ISSUES',
  transition: 'TRANSITION_ISSUES', move: 'TRANSITION_ISSUES', 'change status': 'TRANSITION_ISSUES',
  comment: 'ADD_COMMENTS', 'add comment': 'ADD_COMMENTS', 'add comments': 'ADD_COMMENTS',
  assign: 'ASSIGN_ISSUES', 'be assigned': 'ASSIGNABLE_USER', assignable: 'ASSIGNABLE_USER',
  delete: 'DELETE_ISSUES', resolve: 'RESOLVE_ISSUES', close: 'CLOSE_ISSUES', link: 'LINK_ISSUES',
  attach: 'CREATE_ATTACHMENTS', 'log work': 'WORK_ON_ISSUES', 'administer project': 'ADMINISTER_PROJECTS', 'project admin': 'ADMINISTER_PROJECTS',
};

/** Normalises a permission name; empty input means BROWSE_PROJECTS ("can they see it?"). */
export function normalizePermission(raw: unknown): Validation<string> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: 'BROWSE_PROJECTS' };
  if (typeof raw !== 'string') return { ok: false, error: 'permission must be a string' };
  const text = raw.trim();
  const asKey = text.toUpperCase().replace(/[\s-]+/g, '_');
  if ((PROJECT_PERMISSIONS as readonly string[]).includes(asKey)) return { ok: true, value: asKey };
  const word = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b(the|an?|issues?|work items?|this|it)\b/g, ' ').replace(/\s+/g, ' ').trim();
  // Exact phrase only: "edit comments" must not silently become EDIT_ISSUES.
  const hit = SYNONYMS[word];
  if (hit) return { ok: true, value: hit };
  return { ok: false, error: `Unknown permission "${raw}". Use a Jira project permission such as BROWSE_PROJECTS, EDIT_ISSUES, TRANSITION_ISSUES, ADD_COMMENTS, CREATE_ISSUES.` };
}
