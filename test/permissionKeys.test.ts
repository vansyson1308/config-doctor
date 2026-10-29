import { describe, expect, it } from 'vitest';
import { normalizePermission } from '../src/core/permissionKeys';

describe('normalizePermission', () => {
  it.each([
    [undefined, 'BROWSE_PROJECTS'], ['', 'BROWSE_PROJECTS'], ['see', 'BROWSE_PROJECTS'], ['view the issue', 'BROWSE_PROJECTS'],
    ['edit', 'EDIT_ISSUES'], ['EDIT_ISSUES', 'EDIT_ISSUES'], ['edit issues', 'EDIT_ISSUES'], ['transition', 'TRANSITION_ISSUES'],
    ['comment', 'ADD_COMMENTS'], ['add-comments', 'ADD_COMMENTS'], ['browse projects', 'BROWSE_PROJECTS'], ['be assigned', 'ASSIGNABLE_USER'],
  ])('%s → %s', (raw, key) => {
    expect(normalizePermission(raw)).toEqual({ ok: true, value: key });
  });

  it('rejects unknown wording instead of guessing', () => {
    const r = normalizePermission('teleport');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('BROWSE_PROJECTS');
    expect(normalizePermission(5).ok).toBe(false);
  });
});

describe('review fix: no first-word guessing', () => {
  it.each(['edit comments', 'delete comments', 'close sprint'])('%s is rejected', (raw) => {
    expect(normalizePermission(raw).ok).toBe(false);
  });
});
