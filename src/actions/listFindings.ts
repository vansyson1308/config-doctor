// Rovo action `list-findings`: every finding of one category from the latest scan (the audit
// action only returns the top 10).
import { filterFindings, rulesForCategory } from '../core/sprawl';
import { latestSnapshots } from '../storage/snapshots';
import { InvalidInputError, defineAction } from './runAction';

const MAX_RETURNED = 40;

export async function listFindings(category: unknown, nameContains: unknown) {
  if (typeof category !== 'string' || !category.trim()) throw new InvalidInputError('Which category? e.g. duplicate fields, fields not on screens, groups, schemes, workflows, screens.');
  const rules = rulesForCategory(category);
  if (!rules) throw new InvalidInputError(`Unknown category "${category}". Use: duplicate fields, fields not on screens, unused fields, groups, permission schemes, workflow schemes, security schemes, workflows, screens.`);
  const [latest] = await latestSnapshots(1);
  if (!latest) throw new InvalidInputError('There is no completed scan yet. Run the sprawl audit first.');
  const all = filterFindings(latest.findings, rules, typeof nameContains === 'string' ? nameContains : undefined);
  return {
    scannedAt: latest.scannedAt,
    category,
    rules,
    total: all.length,
    countsInScan: Object.fromEntries(rules.map((r) => [r, latest.counts[r]])),
    findings: all.slice(0, MAX_RETURNED).map((f) => ({ id: f.id, rule: f.rule, title: f.title, risk: f.risk, effort: f.effort, evidence: f.evidence.slice(0, 4), recommendation: f.recommendation })),
    ...(all.length > MAX_RETURNED ? { note: `Showing ${MAX_RETURNED} of ${all.length}; the admin page lists all.` } : {}),
  };
}

export const listFindingsAction = defineAction({
  key: 'list-findings',
  async run({ payload }) {
    return listFindings(payload.category, payload.nameContains);
  },
  summarize: (r) => `${r.category}: ${r.total} findings`,
});
