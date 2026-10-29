import { describe, expect, it } from 'vitest';
import { looksLikeAccountId, parseIssueKey, parseOptionalText, parseProjectKey, parseText } from '../src/core/validate';

describe('parseIssueKey', () => {
  it('normalises case and whitespace', () => {
    expect(parseIssueKey(' proj-123 ')).toEqual({ ok: true, value: 'PROJ-123' });
  });
  it.each(['PROJ', 'PROJ-0', '123-4', 'PROJ-12a', '', 'PR OJ-1'])('rejects %s', (raw) => {
    expect(parseIssueKey(raw).ok).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(parseIssueKey(42).ok).toBe(false);
  });
});

describe('parseProjectKey', () => {
  it('accepts keys', () => {
    expect(parseProjectKey('pay')).toEqual({ ok: true, value: 'PAY' });
  });
  it('rejects bad keys', () => {
    expect(parseProjectKey('P').ok).toBe(false);
    expect(parseProjectKey(null).ok).toBe(false);
  });
});

describe('looksLikeAccountId', () => {
  it('accepts modern ids', () => {
    expect(looksLikeAccountId('712020:8f2ea97f-e04e-4388-a8fd-57f28d7adb2f')).toBe(true);
    expect(looksLikeAccountId('5b10a2844c20165700ede21g')).toBe(true);
  });
  it('rejects emails and names', () => {
    expect(looksLikeAccountId('linh@example.com')).toBe(false);
    expect(looksLikeAccountId('Linh Tran')).toBe(false);
  });
});

describe('parseText / parseOptionalText', () => {
  it('trims and enforces bounds', () => {
    expect(parseText('  hi ', 'x')).toEqual({ ok: true, value: 'hi' });
    expect(parseText('', 'x').ok).toBe(false);
    expect(parseText('a'.repeat(5), 'x', 4).ok).toBe(false);
    expect(parseText(3, 'x').ok).toBe(false);
  });
  it('optional allows empty', () => {
    expect(parseOptionalText(undefined, 'x')).toEqual({ ok: true, value: undefined });
    expect(parseOptionalText(' ', 'x')).toEqual({ ok: true, value: undefined });
    expect(parseOptionalText('a', 'x')).toEqual({ ok: true, value: 'a' });
  });
});
