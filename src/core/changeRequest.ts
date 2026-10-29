// Parses the change being simulated by preview-change-impact. Pure.
import type { Validation } from './validate';

export type ChangeType = 'remove-group' | 'delete-field' | 'switch-permission-scheme';

const PATTERNS: Array<[RegExp, ChangeType]> = [
  [/scheme|switch|permission/i, 'switch-permission-scheme'],
  [/field/i, 'delete-field'],
  [/group/i, 'remove-group'],
];

export function parseChangeType(raw: unknown): Validation<ChangeType> {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'changeType is required: remove-group, delete-field or switch-permission-scheme.' };
  const exact = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (exact === 'remove-group' || exact === 'delete-group') return { ok: true, value: 'remove-group' };
  if (exact === 'delete-field' || exact === 'remove-field') return { ok: true, value: 'delete-field' };
  if (exact === 'switch-permission-scheme' || exact === 'change-permission-scheme') return { ok: true, value: 'switch-permission-scheme' };
  const hit = PATTERNS.find(([re]) => re.test(raw));
  return hit ? { ok: true, value: hit[1] } : { ok: false, error: `Unsupported change "${raw}". Supported: remove a group, delete a custom field, switch a project's permission scheme.` };
}

/** Field reference: "customfield_10050", "cf[10050]", "10050" or a name. */
export function parseFieldRef(raw: string): { id?: string; name?: string } {
  const t = raw.trim();
  const m = /^(?:customfield_|cf\[)?(\d{4,})\]?$/i.exec(t);
  return m ? { id: `customfield_${m[1]}` } : { name: t.replace(/^["']|["']$/g, '') };
}

/** True if a JQL string references the field by cf[id], customfield_id or quoted/plain name. */
export function jqlMentionsField(jql: string, field: { id: string; name: string }): boolean {
  const num = field.id.replace('customfield_', '');
  const lower = jql.toLowerCase();
  if (lower.includes(`cf[${num}]`) || lower.includes(field.id.toLowerCase())) return true;
  const name = field.name.trim().toLowerCase();
  return lower.includes(`"${name}"`) || lower.includes(`'${name}'`) || (!/\s/.test(name) && new RegExp(`(^|[\\s(])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(=|!=|~|in|is|>|<)`, 'i').test(jql));
}
