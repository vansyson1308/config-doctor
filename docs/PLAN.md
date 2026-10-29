# PLAN — milestones (deadline Dec 22, 2026 12:00 PT; aim to submit by Dec 15)

Each milestone ends with its acceptance checks passing and a short report to the owner.

## M0 — Environment & feasibility (owner + agent) — target Nov 15
- Owner: Node 22/24, `npm i -g @forge/cli`, API token (Forge scope), `forge login`, dev site created.
- Check Rovo is available on the dev site (chat button visible; agents selectable). If not, record
  it — fallback is admin page + MCP, and ask Atlassian on the developer community.
- Agent: `forge create` from a Rovo agent template; deploy; install; hello-world action answers in Rovo chat.
- Agent: verify every UNVERIFIED item in RESEARCH.md that M1 needs (permission APIs, scopes, admin page module, runtime limit for actions).
Acceptance: screenshot/log of hello-world action returning data from Jira on the dev site; RESEARCH.md updated with URLs.

## M1 — Demo data seeder — target Nov 20
- `scripts/seed/`: idempotent script (Jira REST with owner's admin token, run locally, NOT part of the app) that creates projects, groups, users-as-needed (or uses existing), roles, issue security scheme, duplicate custom fields, cloned workflows.
Acceptance: re-running produces same state; README lists what was created.

## M2 — F1 Access Explainer (core) — target Nov 30
- `src/core/permissions.ts` pure resolver + unit tests (≥ 15 fixtures incl. security levels, roles, groups, reporter/assignee grants, nested cases).
- Forge action `explain-access` + `list-who-can-see`; ground-truth cross-check; evidence schema.
Acceptance: 10 scripted questions on the seeded site give correct, identical answers across 3 runs.

## M3 — F2 Sprawl Audit + F4 scheduled scan — target Dec 6
- Chunked scanner (async events / scheduled trigger), snapshots in storage, health score.
- `create-cleanup-plan` with preview → confirm token.
Acceptance: full scan of seeded site completes within limits; findings match seeded mess.

## M4 — F3 Change Impact + F5 Admin page + audit log — target Dec 11
Acceptance: 3 impact scenarios correct; admin page shows score, findings, trend, audit log.

## M5 — F6 MCP + polish + submission — target Dec 15
- `rovo:mcp` exposing F1–F3; test from an MCP client.
- Install link for judges, README, Devpost text, demo video (< 5 min, YouTube public).
Acceptance: fresh install on a second site works by following README only.

## M6 — Judge-ready (QC round 1) — target Dec 15
1. Demo Lab on the admin page (opt-in, preview → confirm, recorded objects, exact removal, audited).
   Acceptance: on configdoctor.atlassian.net and the demo site: create lab → scan shows lab findings →
   "Why can't I see CDLAB-2?" NO_ACCESS via ISSUE_SECURITY with Jira AGREES → impact preview shows a real
   loss → remove lab → new scan back to the pre-lab score and config inventory identical; twice per site.
2. Site-agnostic agent starters; README "For judges" and SUBMISSION §1.3 use the Demo Lab (no scripts).
3. Teamwork Graph bonus check (time-box 2 h): implement one use if available to Forge, else record why.
4. docs/MARKETPLACE.md with every listing text and step (owner submits).
5. Screenshots in docs/screenshots (5 PNGs), scripts/demo-reset, video script ≤ 4:45 incl. Demo Lab shot,
   Devpost text covers determinism + ground truth, 30/30 runs, audit log, works without Rovo, Demo Lab, MCP.
6. Final regression: tests, tsc, lint, deploy dev + prod, upgrade both sites, 10 F1 questions + 3 impact scenarios.
