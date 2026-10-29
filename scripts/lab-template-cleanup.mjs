// One-time cleanup for demo labs created by Config Doctor ≤ M6 build 1, which used a Jira project
// TEMPLATE: the template added "CDLAB: …" screens/schemes/workflow and the "Category" / "Story Points"
// fields that deleting the project does not remove. Current builds create the lab project without a
// template, so this script is only needed once per site that ran the old lab.
// Strict: only objects whose names start with "CDLAB: " plus the two template fields (by id, re-checked
// by name and type). Dry run by default.
// Usage: node --env-file=.env scripts/lab-template-cleanup.mjs <siteBaseUrl> [--apply] [--fields=customfield_1,customfield_2]
const base = process.argv[2]?.replace(/\/+$/, '');
const apply = process.argv.includes('--apply');
const fieldIds = (process.argv.find((a) => a.startsWith('--fields='))?.slice(9) ?? '').split(',').filter(Boolean);
if (!base) { console.error('site base url required'); process.exit(1); }
const auth = 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const call = async (method, p) => {
  const r = await fetch(base + p, { method, headers: { Authorization: auth, Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${method} ${p}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const all = async (p) => {
  const out = [];
  for (let s = 0; ; ) {
    const page = await call('GET', `${p}${p.includes('?') ? '&' : '?'}startAt=${s}&maxResults=50`);
    const v = page.values ?? [];
    out.push(...v);
    if (v.length === 0 || page.isLast === true || (page.total !== undefined && out.length >= page.total)) return out;
    s += v.length;
  }
};
const lab = (n) => typeof n === 'string' && n.startsWith('CDLAB: ');
const plan = [];
for (const s of (await all('/rest/api/3/issuetypescreenscheme')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/issuetypescreenscheme/${s.id}`, s.name]);
for (const s of (await all('/rest/api/3/screenscheme')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/screenscheme/${s.id}`, s.name]);
for (const s of (await all('/rest/api/3/workflowscheme')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/workflowscheme/${s.id}`, s.name]);
for (const w of (await all('/rest/api/3/workflows/search')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/workflow/${w.id}`, w.name]);
// Screens last among config objects: workflow transitions reference them.
for (const s of (await all('/rest/api/3/screens')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/screens/${s.id}`, s.name]);
for (const s of (await all('/rest/api/3/issuetypescheme')).filter((x) => lab(x.name))) plan.push(['DELETE', `/rest/api/3/issuetypescheme/${s.id}`, s.name]);
for (const id of fieldIds) {
  const f = (await call('GET', `/rest/api/3/field/search?id=${id}`)).values.find((x) => x.id === id);
  const expected = { 'Category': 'com.atlassian.jira.plugin.system.customfieldtypes:jwm-category', 'Story Points': 'com.atlassian.jira.plugin.system.customfieldtypes:float' };
  if (f && expected[f.name] === f.schema?.custom) plan.push(['POST', `/rest/api/3/field/${id}/trash`, `field ${f.name} (${id}) → trash`]);
  else console.log(`skip ${id}: not a template field`);
}
for (const [m, p, label] of plan) {
  console.log(`${apply ? 'apply' : 'would'} ${m} ${label}`);
  if (!apply) continue;
  try {
    await call(m, p);
  } catch (err) {
    // Jira-locked template fields (e.g. Work Management "Category") cannot be trashed; Jira manages them.
    if (String(err.message).includes('Field is locked')) console.log(`  kept: ${label} is locked by Jira`);
    else throw err;
  }
}
console.log(`${plan.length} object(s) ${apply ? 'cleaned' : 'found (dry run; add --apply)'}`);
