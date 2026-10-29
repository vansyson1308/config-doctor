# PROGRESS

## M0 — Environment & feasibility (2026-10-30) — DONE

**Built**
- Forge app `config-doctor` (Developer Space "configdoctor", app id 9e634caf-091b-4ebc-9529-c0b895d818b8),
  TypeScript, from the rovo-agent template.
- Rovo agent "Config Doctor" (prompt in `agent/prompt.md`), action `ping-jira` (GET): server info,
  invoking accountId, Jira-admin check; `note=probe` adds an endpoint access matrix.
- Shared action runner `src/actions/runAction.ts`: identity from `context.principal`, server-side admin
  gate, structured errors, audit record for every call (`src/storage/audit.ts`, KVS, 90-day TTL).
- Jira client `src/jira/client.ts`: asApp/asUser, 429/503 backoff honouring Retry-After, pagination.
- `src/core/validate.ts` (pure) + vitest.

**Evidence**
- `npx tsc --noEmit` clean; `npm test` → 14 passed; `forge lint` → No issues found.
- `forge deploy -e development` → Deployed; `forge install` → installed in Jira on
  configdoctor.atlassian.net and one-atlas-sery.atlassian.net.
- Rovo chat on https://one-atlas-sery.atlassian.net: agent "Config Doctor" selected, starter
  "Is Config Doctor working on this site?" → action returned baseUrl https://one-atlas-sery.atlassian.net,
  version 1001.0.0-SNAPSHOT, accountId 712020:8f2e…, isJiraAdmin true (checked with mypermissions asUser).
- `forge logs` probe line (2026-10-29T17:23:50Z): all 11 config endpoints 200 as app and as user.
- First attempt `forge logs`: asApp POST /permissions/check → 403 "Only Jira administrators and Connect
  apps…" → admin gate moved to asUser (RESEARCH.md).

**Open issues**
- Rovo unavailable on configdoctor.atlassian.net → demo site used (SPEC "Environment decisions").
- Optional action inputs were not passed by Rovo; design all actions so optional inputs are nice-to-have.
- Demo site expires 2027-01-27 (after submission, before end of judging; judges install on their own sites).

## M1 — Demo data seeder (2026-10-30) — DONE

**Built**: `scripts/seed/` (local Node script, owner's classic API token from git-ignored `.env`): groups,
memberships, global role, 3 permission schemes, issue security scheme with 2 levels, projects PAY and VEND,
8 issues, 12 sprawl custom fields. Contents listed in `scripts/seed/README.md`.

**Evidence**
- Target: https://one-atlas-sery.atlassian.net (demo site; uses its existing users, no invites).
- First full run created all objects (retries for permission propagation, see README).
- Two consecutive re-runs: `Summary: 0 created, 44 already present, 0 skipped.` (idempotent; state file
  `docs/evidence/m1-seed-last-run.json`).
- `npx tsc -p scripts/tsconfig.json` clean.

**Open issues**: none. Workflows are not cloned: the demo site already has 94 workflows / 26 workflow schemes.

## M2 — F1 Access Explainer (2026-10-30) — DONE

**Built**
- Pure core: `src/core/holders.ts` (all holder types), `access.ts` (verdict, evidence chain, blocking
  layer, fixes simulated against the model, blast radius from `siteIndex.ts`, ground-truth reconcile),
  `whoCanSee.ts`, `permissionKeys.ts`. 63 unit tests incl. 29 resolver fixtures (`test/fixtures/world.ts`).
- Loaders `src/jira/loaders.ts`, `siteIndexLoader.ts` (KVS-cached index, deadline-bounded).
- Actions `explain-access(user, issueKey, permission?)` and `list-who-can-see(issueKey)`; agent prompt
  updated with presentation rules.

**Evidence**
- `npm test` → 63 passed; `npx tsc --noEmit` clean; `forge lint` → No issues found; deployed to development.
- 10 scripted questions (`docs/M2_QUESTIONS.md`) asked in Rovo chat on the demo site, runs B/C/D
  (fresh chat each): 30/30 action results identical across runs, all equal to the expected table, all
  `jira AGREES` (`docs/evidence/m2-runs.txt`, from `forge logs`).
- Example answer (run 0): "Emma Paris cannot see PAY-3: blocked by the issue security level … member of
  cd-contractors-2024 in role CD Developers … Internal only = group cd-staff-hq … Fix: add to cd-staff-hq,
  risk medium, also grants VEND and PAY levels … Jira AGREES".

**Found and fixed during acceptance**
- Jira permission answers flip right after config changes → cross-check now takes the majority of up to 3
  `permissions/check` calls and discloses every raw answer.
- `user/permission/search?issueKey=` ignores issue security (listed 7 users for PAY-3; real answer 3) → not
  used as ground truth; each candidate is checked with `permissions/check` instead.
- App accounts reached the viewer candidates through the app access role → only `atlassian` accounts count.
- Fix suggestions never propose app/system groups or roles (`atlassian-addons-*`).

**Open issues**
- Team-managed projects: verdicts carry a note to rely on Jira's check (model covers company-managed schemes).

## M3 — F2 Sprawl Audit + F4 scheduled scan (2026-10-30) — DONE

**Built**
- Pure core `src/core/sprawl.ts` (12 rules, near-duplicate name canonicalisation, explainable health score =
  100 − Σ weighted category ratios, stable finding ids, risk/effort ranking), `references.ts`, `cleanupPlan.ts`.
- Chunked scanner `src/scan/` on Forge async events (`scan-queue`, consumer timeout 600 s): 10 steps, parts in
  KVS, time-sliced (steps chained in one invocation for up to 240 s, then a continuation event), group counts
  and projects chunked; snapshots + trend in KVS (`src/storage/snapshots.ts`). Weekly `scheduledTrigger`.
- Actions: `run-sprawl-audit` (cached result; starts a background scan when missing/older than 24 h),
  `list-findings(category)`, `preview-cleanup-plan` (GET, returns 15-min single-use token bound to the user) →
  `create-cleanup-plan` (CREATE, token required). The only write in the app.

**Evidence**
- `npm test` → 116 passed; tsc clean; forge lint clean; deployed (scope `write:jira-work` added, major version approved).
- Demo-site scan `scan-1793297690377`: all steps 0.8–2.9 s, total 198 s (queue latency), health score 39,
  221 findings, 25/25 projects (`forge logs`). configdoctor.atlassian.net scanned via the weekly trigger.
- Seeded mess found (Rovo `list-findings`): 4 duplicate clusters (CD Sprint Goal ×3, CD Customer Tier ×3,
  CD Release Train ×2, CD Legacy Region ×2); all 12 CD fields on no screen; `cd-legacy-empty` and
  `cd-old-reviewers` = empty groups that still hold grants; `CD Legacy Scheme (copy)` unused. Non-mess cd-
  groups (staff, dev, contractors, admins) correctly not flagged.
- Cleanup plan: preview listed 1 epic + 3 tasks and asked yes/no; after "yes" Rovo showed its own review card;
  after confirm: PAY-6 (Epic) + PAY-7..9 (Tasks, parent PAY-6, label `config-doctor-cleanup`), verified via REST.

**Open issues**
- Queue latency ~20 s/event is avoided by time slicing; very large sites still chunk safely.
- Group references do not include filter/dashboard sharing or global permissions (stated in the finding evidence).
