# RESEARCH — verified facts and open questions (checked 2026-10-29)

Dev site: https://configdoctor.atlassian.net (org: configdoctor). Note: Jira 'projects' are called 'spaces' in the current UI; /jira/projects/create returns 404 — create via Spaces > + or REST.

## Codegeist 2026 rules (https://codegeist2026.devpost.com/rules)
- Build a Forge app integrating ≥1 of Jira, Confluence, JSM, Bitbucket, Teamwork Graph, Rovo.
- Categories: Software Teams / Business Teams / Specialized Industries. 1st $15k, 2nd $8k, 3rd $5k per category.
- Bonus ($1,500 × 6 each): Best Agents (rovo:agent / agentConnector / reusable rovo:skill & action), Best app with Atlassian MCP (rovo:mcp), Best Teamwork Graph integration, Best Marketplace published app.
- Submit: installation link for judges, demo video < 5 min (YouTube, public), category + bonus selection, explanation of tech requirement.
- Judging: technological implementation, design, potential impact, innovation, presentation.
- Submission period Oct 27 – Dec 22, 2026 12:00 PT; judging Jan 5 – Feb 3, 2027; winners ~Feb 15, 2027.

## Forge setup (https://developer.atlassian.com/platform/forge/getting-started/, updated Aug 26, 2026)
- Node.js 22.x (≥22.23.4) or 24.x (≥24.22.1). `npm install -g @forge/cli` (no sudo).
- API token: https://id.atlassian.com/manage-profile/security/api-tokens → "Create API token with scopes" → app **Forge**.
- `forge login` (email + token) or env `FORGE_EMAIL`, `FORGE_API_TOKEN`.
- Dev site: http://go.atlassian.com/cloud-dev, or `forge install --demo-site` (demo site active 90 days by default).
- Flow: forge login → forge create → forge deploy → forge install → forge tunnel.
- Pricing: consumption-based since Jan 1, 2026 with a free allowance (https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/).

## Rovo modules (manifest reference)
- rovo:agent: key, name (≤30 chars), prompt (string or resource), conversationStarters, actions, skills (Preview), followUpPrompt. No model choice. https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/
- action: key, name, function (or endpoint), actionVerb GET|CREATE|UPDATE|DELETE|TRIGGER, description (LLM uses it to pick the action), inputs (string/integer/number/boolean). Payload includes inputs + context (cloudId, accountId, jira.issueKey…). Returns string/JSON. Data limit 5 MB. Inputs can be hallucinated — never use for authorization. Agents invoked from Automation do not run CREATE/UPDATE/DELETE/TRIGGER. https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/
- rovo:mcp (Preview): exposes action keys as tools to Rovo Studio agents; external MCP at https://mcp.atlassian.com/forge/<appId> is Early Access. https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-mcp/
- Hello world agent needs Rovo activated and @forge/cli ≥10.8.0 for Rovo templates. https://developer.atlassian.com/platform/forge/build-a-hello-world-rovo-agent/

## Limits (https://developer.atlassian.com/platform/forge/limits-invocation/, Sep 1, 2026)
- Runtime: 25 s listed for functions/UI; async events & scheduled triggers up to 900 s (default 55 s, set timeoutSeconds). Actions possibly 55 s — UNVERIFIED (page truncated; conflicting figures).
- Rate: 1,200/min per user; 7,000/min and 300/s per install.
- Scheduled triggers: max 5 modules per app; only 1 may use fiveMinute. https://developer.atlassian.com/platform/forge/limits-scheduled-trigger/

## Authorize API (https://developer.atlassian.com/platform/forge/runtime-reference/authorize-api/)
- authorize() checks the CURRENT user's permissions via Jira bulk permissions API. Checking another user needs another approach.

## Verified 2026-10-30 (M0)

Sources: Jira REST v3 OpenAPI spec https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
(downloaded 2026-10-30, spec version 1001.0.0-SNAPSHOT; "Permissions required" and OAuth scopes
read from each operation) and the Forge pages linked below. "Probe" = measured on the demo site
2026-10-30 by `ping-jira` (note=probe): HTTP status as app / as invoking admin user.

### Environment findings
- Forge CLI 15.0.0 requires Node ^22.23.4 || ^24.22.1 || >=26.12.1 (CLI error message). Owner machine
  switched to Node 24.22.2 via nvm.
- `forge create` requires a Developer Space; one was created: "configdoctor"
  (id 99ce1af9-831c-44a7-ae28-63461f52901b). App id: ari:cloud:ecosystem::app/9e634caf-091b-4ebc-9529-c0b895d818b8.
  Template: Rovo > "Rovo Agent and action" > rovo-agent (template dir rovo-agent-rovo).
- **Rovo is NOT usable on https://configdoctor.atlassian.net** (checked 2026-10-30): no Chat / Ask Rovo
  button in Jira or Confluence; home.atlassian.com/o/<org>/chat redirects to the Rovo marketing page,
  although admin.atlassian.com shows Standard plans and an empty Rovo blocklist.
  Fallback adopted: **Forge demo site**
  (https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/, updated Aug 14, 2026:
  "a fully featured Atlassian cloud site with realistic seeded data and enterprise editions of Jira,
  Confluence, Jira Service Management, and Rovo"; active 90 days). `forge site provision` →
  **https://one-atlas-sery.atlassian.net** (expires 2027-01-27). "Ask Rovo" is present there and the
  Config Doctor agent answers. The app is installed on BOTH sites.
- Deploys that change scopes need `forge deploy --approve MAJOR_VERSION_RULE` (major version
  upgrade), then `forge install --upgrade`.

### Forge platform
| Item | Finding | Source |
|---|---|---|
| Action runtime | 55 s ("web trigger, action and rovo:agentConnector modules"); other functions/UI 25 s; async events and scheduled triggers up to 900 s (default 55, set `timeoutSeconds`) | https://developer.atlassian.com/platform/forge/limits-invocation/ (fetched 2026-10-30) |
| Action payload | 5 MB; input types string/integer/number/boolean; payload `context` has cloudId, moduleKey, jira.{issueKey, projectKey…}; "never rely on values passed as inputs to perform critical checks like authorization" | rovo-action page, updated Aug 3, 2026 |
| Invoking user | handler `(payload, context)`; `context.principal.accountId` | https://developer.atlassian.com/platform/forge/function-reference/arguments/ (updated Nov 25, 2025) |
| asUser() in Rovo actions | Works: asUser GET /mypermissions answered for the invoking admin | Probe 2026-10-30 |
| Optional action inputs | Rovo did not pass an optional input even when told its exact value (2 tries). Rule: never depend on optional inputs for behaviour that matters | Measured 2026-10-30 |
| rovo:agent | key, name (≤30 chars), description, icon, prompt (string or `resource:<key>;<path>`), conversationStarters, actions, skills (Preview), followUpPrompt | rovo-agent page, updated Oct 2, 2026 |
| rovo:mcp | Preview ("fully supported"); key, name (≤30), tools = action keys (≤50, key <64 chars); one module per app; tools usable by custom agents in Rovo Studio; external endpoint `https://mcp.atlassian.com/forge/<appId>` is off by default (admin enables in Apps > Sites > site > Connected apps > Tools) | rovo-mcp page and build-a-hello-world-rovo-mcp, both updated Oct 29, 2026 |
| Admin page | `jira:adminPage` (key, title; UI Kit via `resource` + `render: native`, or Custom UI); supports `useAsConfig`, `useAsGetStarted`; docs state no admin-only guarantee, so the resolver enforces the admin check | jira-admin-page page, updated Sep 22, 2026 |
| Scheduled trigger | interval fiveMinute / hour / day / week; ≤5 per app; first run ~5 min after deploy; no user context | scheduled-trigger page, updated Jun 17, 2026 |
| Async events | `import { Queue } from '@forge/events'`; `new Queue({ key })`; `queue.push({ body })` or array; ≤50 events and 200 KB per push; `delayInSeconds` ≤ 900; consumer module `{ key, queue, function }`; `timeoutSeconds` ≤ 900 | async-events-api (Sep 1, 2026), consumer module (Apr 3, 2026) |
| KVS | `import { kvs, WhereConditions } from '@forge/kvs'`; key ≤500 chars of `[a-zA-Z0-9:._\s-#]`; value ≤240 KiB; `kvs.query().where('key', WhereConditions.beginsWith(p)).limit(n).cursor(c).getMany()`; `set` option `ttl {value, unit}` (@forge/kvs 2.1.1 typings); ~1000 RPS per install | limits-kvs-ce (Sep 28, 2026), kvs-api (Aug 21, 2026) |

### Jira REST endpoints (spec + probe)
Classic scopes in the app: read:jira-work, read:jira-user, manage:jira-configuration,
manage:jira-project, storage:app (write:jira-work is added only for cleanup-plan issues).

| Endpoint | Jira permission (spec) | Classic scope | Pagination | Probe app / user |
|---|---|---|---|---|
| POST /rest/api/3/permissions/check | Administer Jira to check OTHER users; ≤1000 projects and issues per call | read:jira-work | n/a | **app 403** ("Only Jira administrators and Connect apps can perform this operation"); works as admin user → F1 ground truth runs asUser |
| GET /rest/api/3/mypermissions?permissions=ADMINISTER | none (answers for caller) | read:jira-work | n/a | admin gate, asUser |
| GET /rest/api/3/permissionscheme?expand=all | access Jira | read:jira-work | none (all schemes) | 200 / 200 |
| GET /rest/api/3/project/{key}/permissionscheme | Administer Jira or Administer projects | read:jira-work | n/a | not probed |
| GET /rest/api/3/role ; /project/{key}/role/{id} | Administer Jira ; Administer projects or Jira | manage:jira-configuration ; read:jira-work | none | 200 / 200 |
| GET /rest/api/3/project/search | only projects where caller has Browse / Administer projects / Administer Jira | read:jira-work | startAt, maxResults, isLast | 200 / 200 (visibility depends on caller) |
| GET /rest/api/3/project/{key}/issuesecuritylevelscheme | Administer Jira or Administer projects | read:jira-work | n/a | not probed |
| GET /rest/api/3/issuesecurityschemes/level/member | Administer Jira | manage:jira-configuration | startAt, maxResults | 200 / 200 |
| GET /rest/api/3/group/bulk | Browse users and groups | read:jira-user | startAt, maxResults | 200 / 200 |
| GET /rest/api/3/group/member | Browse users and groups or Administer Jira | manage:jira-configuration | maxResults ≤ 50 | not probed |
| GET /rest/api/3/user/groups?accountId= | Browse users and groups | read:jira-user | none | 200 / 200 |
| GET /rest/api/3/user/permission/search | Administer Jira (any project) or Administer projects | read:jira-user | startAt, maxResults | 200 / 200 → ground truth for list-who-can-see |
| GET /rest/api/3/field/search?type=custom&expand=lastUsed,screensCount,contextsCount | access Jira | read:jira-work | startAt, maxResults | 200 / 200; lastUsed.type TRACKED / NOT_TRACKED / NO_INFORMATION |
| GET /rest/api/3/field/{id}/screens | Administer Jira | manage:jira-project | startAt, maxResults | not probed |
| GET /rest/api/3/screens | Administer Jira | manage:jira-project | startAt, maxResults | 200 / 200 |
| GET /rest/api/3/workflows/search (replaces /workflow/search, removed Jun 1, 2026) | Administer Jira for all workflows | manage:jira-configuration | startAt, maxResults | 200 / 200 |
| GET /rest/api/3/workflowscheme ; /workflowscheme/project?projectId= | Administer Jira | manage:jira-configuration | startAt, maxResults | 200 / 200 |
| GET /rest/api/3/serverInfo | none | — | n/a | 200 |

**asApp vs asUser decision.** Interactive actions (Rovo, MCP, admin page) first verify that the
invoking user is a Jira admin (asUser mypermissions), then read configuration **asUser**, so project
visibility matches an admin's view. The F1 ground-truth check uses asUser `permissions/check` with
the subject's accountId. Scheduled and async scans have no user context and read **asApp**; the
scanner records how many projects it could see, so coverage gaps are reported rather than hidden.

### Behaviour verified on the demo site (2026-10-30, M1/M2)
- **Eventual consistency**: for 1–3 minutes after group membership / scheme changes, `mypermissions`,
  `POST /issue` and even `permissions/check` give inconsistent answers (same call flipped yes/no).
  Config Doctor's cross-check uses the majority of up to 3 calls and discloses all raw answers.
- **`GET /user/permission/search?issueKey=…` ignores issue security levels**: for PAY-3 (`Internal only`)
  it returned 7 users while `permissions/check` per user allows exactly 3. Used only to discover candidates.
- `POST /permissions/check` with `accountId` works **asUser** for a Jira admin (asApp → 403).
- `POST /rest/api/3/search/jql` intermittently returns 404 "Issue does not exist" on new data (retry).
- Security-level members: create with group **names** + type `projectrole`; reads return `projectRole`
  with group name and id (`expand=all`).
- New permission schemes get automatic grants for roles `atlassian-addons-project-access` and
  `jira-guest-member`; Forge app accounts (accountType `app`) are actors of the addons role.

### Verified in M3–M5 (2026-10-30)
- **Rovo shows its own confirmation card for `actionVerb: CREATE` actions** ("Please review … Confirm selected /
  Cancel") before invoking them; the action ran only after the click (demo site, create-cleanup-plan).
- **Team-managed projects** return a "Simplified Permission Scheme" from `GET /project/{key}/permissionscheme`
  (scoped project roles + `applicationRole` with empty parameter for open access), so the same evaluator applies.
- `rovo:mcp` tools appear in Rovo Studio → Create agent → Tools → Add tools → *config-doctor* (5 tools) and run
  with `payload.context = { cloudId, moduleKey: <action key>, userAccess }`, identical in shape to native-agent
  calls, so audit source cannot distinguish them (both recorded as "rovo").
- Async-event latency ≈ 15–30 s per event; chaining steps in one consumer invocation cut a full scan from 198 s to 10–13 s.
- Interactive site index on the demo site is ~374 KB (> one KVS value); cache values are now chunked.
- A brand-new site (configdoctor.atlassian.net, 0 projects) exposes product-provisioned fields (JSM "Approvers",
  "Impact", …, Jira Software/Plans/Forms types) and product-access groups; these are treated as managed, not sprawl.
- `POST /permissions/check` and `/mypermissions` are eventually consistent after changes (see M2); `search/jql`
  intermittently 404s on fresh data.

## Still UNVERIFIED
- [~] Whether asApp sees every project when a project's permission scheme omits the app's role. Mitigated, not verified: the scan records
  coverage gaps (403/400) and withholds unused-scheme advice; run-sprawl-audit compares the admin's visible project count with the scan's.
- [ ] Jira event keys for configuration changes (only needed if F4 adds event-driven rescans).
