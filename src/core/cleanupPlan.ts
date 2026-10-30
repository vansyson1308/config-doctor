// Builds the Jira issues for a cleanup plan from audit findings. Pure: creation happens in the
// action, only after an explicit preview → confirm-token round trip.
import type { Finding } from './sprawl';

export interface AdfDoc { type: 'doc'; version: 1; content: unknown[] }

export interface PlannedIssue {
  summary: string;
  description: AdfDoc;
  labels: string[];
  findingId: string;
}

export interface CleanupPlan {
  projectKey: string;
  epic: { summary: string; description: AdfDoc };
  tasks: PlannedIssue[];
  skipped: string[];
}

const LABEL = 'config-doctor-cleanup';
const MAX_TASKS = 25;

const text = (t: string) => ({ type: 'text', text: t });
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] });
const bullets = (items: string[]) => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [para(i)] })) });

export function adf(...blocks: unknown[]): AdfDoc {
  return { type: 'doc', version: 1, content: blocks };
}

/** Selects findings by id (in the given order) or, when none are given, the top `defaultCount` ranked ones. */
export function selectFindings(all: Finding[], ids: string[], defaultCount = 10): { selected: Finding[]; unknown: string[] } {
  if (ids.length === 0) return { selected: all.slice(0, defaultCount), unknown: [] };
  const byId = new Map(all.map((f) => [f.id.toUpperCase(), f]));
  const selected: Finding[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const f = byId.get(id.trim().toUpperCase());
    if (f && !selected.includes(f)) selected.push(f);
    else if (!f) unknown.push(id);
  }
  return { selected, unknown };
}

export function parseFindingIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^[A-Z]{2,6}-[0-9a-z]{1,10}$/i.test(s));
}

export function buildCleanupPlan(projectKey: string, findings: Finding[], scannedAt: string, healthScore: number): CleanupPlan {
  const tasks = findings.slice(0, MAX_TASKS).map((f): PlannedIssue => ({
    summary: `[${f.risk.toUpperCase()} risk / ${f.effort} effort] ${f.title}`.slice(0, 250),
    description: adf(
      para(`Finding ${f.id} (${f.rule}) from the Config Doctor scan of ${scannedAt.slice(0, 10)}.`),
      para('Evidence:'),
      bullets(f.evidence.length ? f.evidence : ['(none recorded)']),
      para(`Recommendation: ${f.recommendation}`),
      para('Config Doctor never changes existing configuration itself; an admin applies this change and verifies impact first (ask Config Doctor "what happens if…").'),
    ),
    labels: [LABEL],
    findingId: f.id,
  }));
  return {
    projectKey,
    epic: {
      summary: `Jira configuration cleanup — health score ${healthScore} (${scannedAt.slice(0, 10)})`,
      description: adf(
        para(`Created by Config Doctor from the configuration scan of ${scannedAt}. Health score: ${healthScore}/100.`),
        para(`${tasks.length} cleanup tasks, ordered by risk then effort:`),
        bullets(tasks.map((t) => t.summary)),
      ),
    },
    tasks,
    skipped: findings.slice(MAX_TASKS).map((f) => f.id),
  };
}
