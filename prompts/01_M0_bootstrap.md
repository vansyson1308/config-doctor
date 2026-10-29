# Prompt 01 — M0 bootstrap (paste into the coding agent from the repo root)

Read AGENTS.md, docs/SPEC.md, docs/PLAN.md, docs/RESEARCH.md fully. We are on milestone M0.

Preconditions (owner already did): Node 22/24 installed, @forge/cli installed, `forge login` done,
developer site created at https://configdoctor.atlassian.net.

Do, in order:
1. Run `node -v`, `forge --version`, `forge whoami`. If any fails, stop and report.
2. Research step: open the official docs and resolve every UNVERIFIED item in docs/RESEARCH.md that
   M0–M2 need (permission check API, scheme/role/security/group endpoints, scopes, asApp vs asUser,
   admin page module, action runtime limit). Update RESEARCH.md with URL + finding for each. If a
   page can't be read, say so — do not guess.
3. Scaffold the app in this repo with `forge create` using a Rovo agent template (TypeScript if
   offered). Keep our AGENTS.md/CLAUDE.md/docs/prompts untouched.
4. Replace the template with: agent "Config Doctor" (prompt in a resource file), one action
   `ping-jira` (GET) that returns the site's server info and the invoking user's accountId and
   whether they are a Jira admin (verify how to check that).
5. Set up `src/core/` (pure logic, no Forge imports) + test runner (vitest or jest) with one passing test.
6. `forge lint`, `npm test`, `forge deploy`, `forge install` to https://configdoctor.atlassian.net (Jira).
7. Tell me exactly how to test it in Rovo chat on the site.

End with: what changed, commands + results, what's still unverified, and the proposed first step of M1.
