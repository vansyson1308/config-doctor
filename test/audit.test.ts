import { describe, expect, it } from 'vitest';
import { sanitizeInputs } from '../src/storage/audit';

describe('sanitizeInputs (audit integrity)', () => {
  it('drops context and non-primitives, truncates strings, redacts secrets', () => {
    const out = sanitizeInputs({ user: 'Emma', issueKey: 'PAY-3', context: { cloudId: 'x' }, nested: { a: 1 }, confirmToken: 'abc', long: 'x'.repeat(500), n: 3 });
    expect(out).toEqual({ user: 'Emma', issueKey: 'PAY-3', confirmToken: '[redacted]', long: 'x'.repeat(200), n: 3 });
  });
  it('caps key count and total size so a hostile payload cannot break the audit write', () => {
    const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 'y'.repeat(150)]));
    const out = sanitizeInputs(many);
    expect(Object.keys(out).length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(out).length).toBeLessThan(2600);
  });
});
