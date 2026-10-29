// Read-only configuration inventory (names of projects, groups, roles, schemes, fields, screens,
// workflows) for before/after comparisons, e.g. proving the Demo Lab leaves nothing behind.
// Usage: node --env-file=.env scripts/config-inventory.mjs [siteBaseUrl] > before.json
//        node scripts/config-inventory.mjs --diff before.json after.json
import { readFileSync } from 'node:fs';

if (process.argv[2] === '--diff') {
  const [a, b] = [JSON.parse(readFileSync(process.argv[3], 'utf8')), JSON.parse(readFileSync(process.argv[4], 'utf8'))];
  let same = true;
  for (const k of Object.keys(a.items)) {
    const added = b.items[k].filter((x) => !a.items[k].includes(x));
    const removed = a.items[k].filter((x) => !b.items[k].includes(x));
    console.log(`${k.padEnd(18)} before ${String(a.items[k].length).padStart(4)}  after ${String(b.items[k].length).padStart(4)}${added.length ? `  +${JSON.stringify(added)}` : ''}${removed.length ? `  -${JSON.stringify(removed)}` : ''}`);
    if (added.length || removed.length) same = false;
  }
  console.log(same ? 'IDENTICAL' : 'DIFFERENT');
  process.exit(0);
}

const base = (process.argv[2] ?? process.env.JIRA_BASE_URL).replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const get = async (p) => {
  const r = await fetch(base + p, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};
const all = async (p, key = 'values') => {
  const out = [];
  for (let s = 0; ; ) {
    const page = await get(`${p}${p.includes('?') ? '&' : '?'}startAt=${s}&maxResults=50`);
    const v = page[key] ?? [];
    out.push(...v);
    if (v.length === 0 || page.isLast === true || (page.total !== undefined && out.length >= page.total)) return out;
    s += v.length;
  }
};
const items = {
  projects: (await all('/rest/api/3/project/search')).map((p) => p.key),
  groups: (await all('/rest/api/3/group/bulk')).map((g) => g.name),
  roles: (await get('/rest/api/3/role')).filter((r) => !r.scope).map((r) => r.name),
  permissionSchemes: (await get('/rest/api/3/permissionscheme')).permissionSchemes.map((s) => s.name),
  securitySchemes: (await get('/rest/api/3/issuesecurityschemes')).issueSecuritySchemes.map((s) => s.name),
  customFields: (await all('/rest/api/3/field/search?type=custom')).map((f) => f.name),
  screens: (await all('/rest/api/3/screens')).map((s) => s.name),
  workflows: (await all('/rest/api/3/workflows/search')).map((w) => w.name),
  workflowSchemes: (await all('/rest/api/3/workflowscheme')).map((w) => w.name),
  screenSchemes: (await all('/rest/api/3/screenscheme')).map((w) => w.name),
  issueTypeSchemes: (await all('/rest/api/3/issuetypescheme')).map((w) => w.name),
  issueTypeScreenSchemes: (await all('/rest/api/3/issuetypescreenscheme')).map((w) => w.name),
  fieldConfigSchemes: (await all('/rest/api/3/fieldconfigurationscheme')).map((w) => w.name),
  issueTypes: (await get('/rest/api/3/issuetype')).map((t) => t.name + (t.scope ? ' [project]' : '')),
};
for (const k of Object.keys(items)) items[k].sort();
console.log(JSON.stringify({ site: base, at: new Date().toISOString(), items }, null, 1));
