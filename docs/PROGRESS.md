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
