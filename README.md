# Config Doctor for Jira

**Deterministic, auditable answers to Jira's most common admin questions — explained by a Rovo agent.**

> "Why can't Linh see PROJ-123?" · "Who can see this issue and why?" · "How messy is our configuration?" ·
> "What breaks if I delete group contractors-2024?"

Config Doctor is a Forge app for Jira Cloud. Code computes, the LLM explains: every fact the agent states
(who has access, through which grant, what a change would break, which fields are unused) is computed by
deterministic TypeScript from Jira's REST APIs, cross-checked with Jira's own permission check, and written
to an audit log. Rovo only routes the question and phrases the evidence.

Built for Atlassian Codegeist 2026 (Apps for Software Teams; bonus: Best Agents, Best app with Atlassian MCP).

## Features

| | Feature | Where |
|---|---|---|
| F1 | **Access Explainer** — verdict, blocking layer (permission scheme / issue security / account), evidence chain (grant → role → group), fix options simulated against the model with blast radius, and Jira's own `permissions/check` as ground truth (disagreements are shown, never hidden). "Who can see X" expands every path and checks each person with Jira. | Rovo agent, admin page, MCP |
| F2 | **Sprawl Audit** — health score 0–100 with an explainable breakdown; findings for duplicate / screen-less / unused custom fields, empty groups that still hold grants, unreferenced groups, unused permission / security / workflow schemes, inactive workflows, unused screens; ranked by risk and effort. Optional **cleanup plan** (epic + one task per finding) after preview → explicit confirmation. | Rovo agent, admin page, MCP |
| F3 | **Change Impact Preview** — read-only simulation of removing a group, deleting a custom field, or switching a project's permission scheme: who loses / gains which permission, who keeps access through another path, references, risk. | Rovo agent, MCP |
| F4 | **Proactive watch** — weekly scheduled scan (chunked async events), snapshots, trend and "new since last scan". | automatic |
| F5 | **Admin page** — score, trend, findings, access check (works even where Rovo is not enabled), audit log of every action. | Jira settings → Apps → Config Doctor |
| F6 | **MCP tools** — `explain-access`, `list-who-can-see`, `run-sprawl-audit`, `list-findings`, `preview-change-impact` exposed with `rovo:mcp` for Rovo Studio agents and MCP clients. | Rovo Studio / MCP |

**Safety by design:** read-only except the cleanup plan (preview → single-use token bound to the admin →
Rovo's own confirmation card → at most 3 plans per admin per hour, audited before it writes). Every action requires the invoking user to be a Jira administrator, checked server-side from
the Forge context (never from LLM inputs). Every action is audited (who, when, inputs, outcome, duration).
No data leaves Atlassian (no egress; eligible for *Runs on Atlassian*).

## Install

### For judges / site admins (installation link)
1. Open the installation link in [`docs/SUBMISSION.md`](docs/SUBMISSION.md) while signed in as a Jira site admin.
2. Choose your Jira site → **Install**, accept the listed scopes.
3. In Jira: **Settings (⚙) → Apps → Config Doctor** opens the admin page. Click **Run scan now** (a scan of a
   typical site takes 10–60 seconds) and try **Check access**.
4. If your site has Rovo: open **Ask Rovo** → agent selector → **Config Doctor**, then try the starters,
   e.g. "How healthy is our Jira configuration?" or "Why can't <name> see <ISSUE-KEY>?".
5. Optional MCP: in Rovo Studio create an agent → **Tools → Add tools → config-doctor** → pick the tools.

Requirements: Jira Cloud; you must hold the **Administer Jira** global permission (non-admins get a polite
refusal, recorded in the audit log). Rovo is needed only for the chat/MCP surfaces; the admin page works without it.

### For developers (Forge CLI)
Prerequisites: Node.js 22.23.4+ or 24.22.1+ (`node -v`), Forge CLI (`npm install -g @forge/cli`), a Forge
API token, and a Jira Cloud site where you are admin (`forge site provision` creates a demo site with Rovo).

```bash
git clone <this repo> config-doctor && cd config-doctor
npm install
forge login                      # email + API token (or FORGE_EMAIL / FORGE_API_TOKEN env vars)
forge register config-doctor     # gives the app your own app id (updates manifest.yml)
npm test && npx tsc --noEmit && forge lint
forge deploy -e development --non-interactive
forge install -e development -s <your-site>.atlassian.net -p Jira --confirm-scopes --non-interactive
```
When a deploy changes scopes, add `--approve MAJOR_VERSION_RULE` to `forge deploy` and run
`forge install --upgrade` afterwards. Logs: `forge logs -e development`.

### Demo data (optional)
`scripts/seed` creates the demo scenario (groups, roles, two projects, an issue security scheme, duplicate
fields) on a site you administer, using existing users only. See [`scripts/seed/README.md`](scripts/seed/README.md).

## How it works

```
Rovo agent / Rovo Studio (MCP) / Admin page (UI Kit)
        │  inputs (may be hallucinated → validated)        context.principal.accountId (trusted)
        ▼
src/actions/*  ── runAudited: admin gate (asUser mypermissions) → run → audit record (KVS, 90 days)
        │
        ├─ src/jira/*   REST loaders: asUser for interactive reads, asApp for scans; 429 backoff; pagination
        ├─ src/core/*   PURE logic, no Forge imports, 132 unit tests:
        │                 holders.ts · access.ts · whoCanSee.ts · siteIndex.ts (blast radius)
        │                 sprawl.ts (rules + score) · impact.ts · cleanupPlan.ts
        └─ src/scan/*   async-event scanner (time-sliced, chunked) → snapshots + trend in KVS; weekly trigger
```

Ground truth and honesty: F1 verdicts are compared with `POST /rest/api/3/permissions/check` (majority of up
to three calls, because Jira's permission caches are eventually consistent right after changes); viewer lists
are checked per person, because `user/permission/search` ignores issue security levels (both verified, see
[`docs/RESEARCH.md`](docs/RESEARCH.md)).

## Repository map
- `manifest.yml` — Forge modules: `rovo:agent`, 9 `action`s, `rovo:mcp`, `jira:adminPage`, `consumer`, `scheduledTrigger`.
- `agent/prompt.md` — the agent's instructions (routing + presentation only).
- `src/` — app code (see diagram); `test/` — vitest suites and fixtures.
- `docs/` — `SPEC.md`, `PLAN.md`, `RESEARCH.md` (verified API facts with URLs), `PROGRESS.md` (milestone evidence),
  `PRIVACY.md`, `SUBMISSION.md` (install link, Devpost text, demo script).

## Development commands
`npm test` · `npx tsc --noEmit` · `forge lint` · `forge deploy` · `forge install` · `forge logs` · `npm run seed`

## License
MIT
