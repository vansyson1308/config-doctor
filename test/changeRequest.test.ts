import { describe, expect, it } from 'vitest';
import { jqlMentionsField, parseChangeType, parseFieldRef } from '../src/core/changeRequest';

describe('parseChangeType', () => {
  it.each([
    ['remove-group', 'remove-group'], ['delete group', 'remove-group'], ['remove_group', 'remove-group'],
    ['delete-field', 'delete-field'], ['delete the custom field', 'delete-field'],
    ['switch-permission-scheme', 'switch-permission-scheme'], ['change permission scheme', 'switch-permission-scheme'],
  ])('%s', (raw, v) => expect(parseChangeType(raw)).toEqual({ ok: true, value: v }));
  it('rejects unsupported changes', () => {
    expect(parseChangeType('rename project').ok).toBe(false);
    expect(parseChangeType('').ok).toBe(false);
  });
});

describe('parseFieldRef', () => {
  it('recognises ids and names', () => {
    expect(parseFieldRef('customfield_10050')).toEqual({ id: 'customfield_10050' });
    expect(parseFieldRef('cf[10050]')).toEqual({ id: 'customfield_10050' });
    expect(parseFieldRef('10050')).toEqual({ id: 'customfield_10050' });
    expect(parseFieldRef('"CD Sprint Goal"')).toEqual({ name: 'CD Sprint Goal' });
  });
});

describe('jqlMentionsField', () => {
  const field = { id: 'customfield_10050', name: 'Sprint Goal' };
  it('matches cf[], customfield_ and quoted names', () => {
    expect(jqlMentionsField('project = PAY AND cf[10050] is not EMPTY', field)).toBe(true);
    expect(jqlMentionsField('customfield_10050 ~ "x"', field)).toBe(true);
    expect(jqlMentionsField('"Sprint Goal" ~ "launch"', field)).toBe(true);
    expect(jqlMentionsField('project = PAY', field)).toBe(false);
  });
  it('matches unquoted single-word names only as a clause', () => {
    const tier = { id: 'customfield_1', name: 'Tier' };
    expect(jqlMentionsField('Tier = Gold', tier)).toBe(true);
    expect(jqlMentionsField('summary ~ Tiered', tier)).toBe(false);
  });
});
