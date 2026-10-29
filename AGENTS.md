# AGENTS.md — Config Doctor for Jira (Codegeist 2026)

You are the coding agent building **Config Doctor for Jira**, a Forge app with a Rovo agent, for
Atlassian Codegeist 2026 (deadline **Dec 22, 2026 12:00 PT**). The owner (Sơn) does acceptance;
a reviewer (Claude) writes prompts and QCs each turn. Read `docs/SPEC.md`, `docs/PLAN.md` and
`docs/RESEARCH.md` before any work. Work only on the current milestone in `docs/PLAN.md`.

## Product principle (non-negotiable)
**Code computes, the LLM explains.** Every fact the agent states (who has access, why, which
fields are unused, what a change would break) must come from deterministic code in a Forge
function that calls Jira REST APIs. The Rovo prompt only routes to actions and phrases results.
Never let the LLM count, filter, or infer permissions itself.

## Hard rules
1. **Source-driven.** Before using any Jira REST endpoint, Forge module, scope, or limit, open the
   official page on developer.atlassian.com and confirm: path, required permission, scopes,
   pagination, response shape. Record it in `docs/RESEARCH.md` (URL + date checked). If you cannot
   verify something, stop and say so — do not guess. Items marked UNVERIFIED in RESEARCH.md must be
   verified before use.
2. **Read-only by default.** No action may modify Jira configuration (schemes, fields, groups,
   workflows). Two narrow, explicit exceptions, both two-step (preview → single-use confirm token) and audited:
   (a) creating Jira issues for a cleanup plan after the user confirms in chat;
   (b) the opt-in **Demo Lab** on the admin page, which creates a self-contained, `cdlab`/`CD Lab`/`CDLAB`-
   labelled scenario with the admin's own account (never inviting or creating users), records every object
   it and Jira create for it, and later deletes ONLY those recorded objects. Nothing else is ever deleted.
3. **Never trust LLM-supplied inputs for authorization.** Rovo action inputs can be hallucinated.
   Validate every input (issue key exists, accountId resolves, project exists). Check the *invoking*
   user is a Jira admin (or has the needed permission) using `context.accountId`, server-side.
4. **Audit everything.** Every action invocation writes an audit record (who, when, action, inputs,
   result summary, duration) to Forge storage. Audit log is viewable on the admin page.
5. **Respect limits.** Forge function runtime limits are short (see RESEARCH.md). Long scans must be
   chunked into async events / scheduled triggers with progress stored in Forge storage; the chat
   action returns cached results + "scan in progress" status. Handle Jira rate limits (429) with
   backoff. Paginate every list endpoint.
6. **Evidence chains.** Every verdict returns structured evidence: the permission scheme, the grant,
   the group/role, the security level, with links to the admin screens. Output schema in SPEC.md.
7. **Tests.** Pure logic (permission resolution, sprawl scoring, impact analysis) lives in
   `src/core/` with no Forge imports and is unit-tested with fixtures in `test/fixtures/`.
   Run `npm test` and `npx tsc --noEmit` (if TS) before finishing a turn. `forge lint` must pass.
8. **Small, verifiable turns.** End every turn with: what changed, commands run + results, what is
   unverified, next step. Do not mark a milestone done unless its acceptance criteria in PLAN.md pass.
9. **No secrets in repo.** Forge credentials come from `forge login` / env vars, never committed.
10. **New project only.** All code is written during the hackathon period (Oct 27 – Dec 22, 2026).

## Stack
- Forge (`@forge/cli`, Node 22.x or 24.x), JavaScript or TypeScript (prefer TypeScript).
- Modules: `rovo:agent`, `action`, admin page (Custom UI or UI Kit — verify module name),
  `scheduledTrigger`, `trigger` (events) if useful, `rovo:mcp` (bonus prize).
- Storage: Forge KVS / Entity store (verify limits).
- `@forge/api` `requestJira` with `asApp()` / `asUser()` — choose per endpoint and document why.

## Commands
- `forge deploy` → `forge install` (dev site) → `forge tunnel` for live dev → `forge logs` for debug.
- `npm test`, `forge lint`.
