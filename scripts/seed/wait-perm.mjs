// Polls until the seeding user holds CREATE_ISSUES in PAY (group-membership changes propagate with a delay).
const auth = 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
for (let i = 0; i < 60; i++) {
  const r = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/mypermissions?projectKey=PAY&permissions=CREATE_ISSUES`, { headers: { Authorization: auth, Accept: 'application/json' } });
  const j = await r.json();
  if (j.permissions?.CREATE_ISSUES?.havePermission) { console.log(`ready after ${i * 10}s`); process.exit(0); }
  await new Promise((res) => setTimeout(res, 10_000));
}
console.log('still not ready after 10 min'); process.exit(1);
