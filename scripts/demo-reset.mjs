// Restores the recording site to its demo state so the video can be re-shot:
//   1. lists issues labelled `config-doctor-cleanup` (created by cleanup-plan tests) and, after you type
//      "yes", deletes ONLY those (Jira issue deletion is permanent — review the list first);
//   2. re-runs the idempotent seed (npm run seed);
//   3. reminds you to click "Run scan now" (scans run inside the app, they cannot be started from a script).
// Usage: node --env-file=.env scripts/demo-reset.mjs [--list-only]
import { createInterface } from 'node:readline/promises';
import { execSync } from 'node:child_process';

const base = process.env.JIRA_BASE_URL?.replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
if (!base || !process.env.JIRA_API_TOKEN) { console.error('Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env'); process.exit(1); }
const call = async (method, p, body) => {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(base + p, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 404 && p.includes('search/jql')) { await new Promise((res) => setTimeout(res, 1500)); continue; } // flaky search on fresh data
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${method} ${p}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`gave up on ${p}`);
};

const LABEL = 'config-doctor-cleanup';
const found = await call('POST', '/rest/api/3/search/jql', { jql: `labels = "${LABEL}" ORDER BY key DESC`, fields: ['summary', 'labels', 'issuetype'], maxResults: 100 });
const issues = found.issues.filter((i) => (i.fields.labels ?? []).includes(LABEL));
console.log(`${issues.length} issue(s) labelled ${LABEL} on ${base}:`);
for (const i of issues) console.log(`  ${i.key}  [${i.fields.issuetype?.name}]  ${i.fields.summary}`);

if (process.argv.includes('--list-only')) process.exit(0);
if (issues.length) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Permanently delete these ${issues.length} issue(s)? Type "yes" to continue: `)).trim();
  rl.close();
  if (answer !== 'yes') { console.log('Nothing deleted.'); process.exit(0); }
  // Children first so an epic is never deleted with subtasks/children still attached.
  for (const i of [...issues].sort((a, b) => (a.fields.issuetype?.name === 'Epic') - (b.fields.issuetype?.name === 'Epic'))) {
    await call('DELETE', `/rest/api/3/issue/${i.key}`);
    console.log(`deleted ${i.key}`);
  }
}
console.log('Re-running the seed…');
execSync('node --env-file=.env --experimental-strip-types scripts/seed/seed.ts', { stdio: 'inherit' });
console.log('\nDone. Now open Jira Settings → Apps → Config Doctor and click "Run scan now" (and "Create demo lab" if you want it in the video).');
