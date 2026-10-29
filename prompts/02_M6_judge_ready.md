# Prompt 02 — M6 "Judge-ready" (QC round 1 from the reviewer)

Context: M0–M5 pass. Reviewer QC (2026-10-30) re-ran `npm test` (132 passed) and `tsc --noEmit` (clean) on a fresh
clone, and read manifest, agent prompt, runAction, auth, cleanupPlan, README, SUBMISSION, PROGRESS. Engineering
quality is high. The remaining risk to winning 1st place is NOT code correctness — it is what a JUDGE experiences
when they install the app on their OWN, nearly empty Jira site, plus a few bonus-prize opportunities.

Add a milestone **M6 — Judge-ready** to docs/PLAN.md with the items below and their acceptance criteria, then
execute it with the same working loop as before (verify docs first → implement → test on real sites → evidence in
docs/PROGRESS.md → commit). Do the items in this order. Stop and ask me only for owner-only steps.

## 1. Demo Lab — make the "wow" reproducible on any site (highest priority)
Problem: a judge installs on a fresh site, runs a scan, gets ~98/100 "healthy", and has no realistic access
problem to ask about. The conversation starters ("Emma Paris", "PAY-3", "cd-contractors-2024") only exist on our
demo site, so on a judge's site they fail. Judges will not run `scripts/seed`.

Build an opt-in **Demo Lab** on the admin page (and mention it in the Getting started hint):
- Button "Create demo lab" → shows exactly what will be created (preview) → explicit confirm → creates a small,
  clearly labelled, self-contained scenario owned by the app, using ONLY the installing admin's own account and
  users that already exist on the site (never invite or create users):
  - a project `CDLAB` ("Config Doctor Demo Lab") with its own permission scheme and issue security scheme,
  - groups/roles prefixed `cdlab-`, including one group that is empty but still holds a grant (backdoor finding),
  - near-duplicate custom fields prefixed `CD Lab …` (e.g. "CD Lab Sprint Goal" / "CD Lab Sprint goal"),
  - at least one issue that the admin themself CANNOT see because of the issue security level (Jira admins do not
    bypass issue security — verify this), so "Why can't I see CDLAB-2?" gives a real NO_ACCESS with a fix,
  - a group whose removal changes access (for "What happens if I remove group cdlab-contractors?").
  Verify every creation endpoint, required permission and scope in the official docs first and record them in
  RESEARCH.md. If issue creation with a security level the creator is not in is impossible, find the documented
  way (e.g. create, then set level) and record it.
- Every object created is recorded (ids) in Forge storage. Button "Remove demo lab" previews and, after confirm,
  deletes ONLY the objects the lab recorded — nothing else, ever. Make it idempotent and safe to re-run.
- Audit both operations. This is the only place the app creates/deletes configuration; update AGENTS.md hard
  rule 2 and SPEC.md to state this narrow, opt-in, self-owned exception explicitly, and keep everything else read-only.
- After "Create demo lab", the admin page shows a "Try these" card with ready-made questions that work on THIS
  site (Check access CDLAB-2 for me, Who can see CDLAB-2, Impact of removing cdlab-contractors, Run scan).
Acceptance: on configdoctor.atlassian.net (no Rovo) and on the demo site: create lab → scan shows the lab findings
→ "Why can't I see CDLAB-2?" NO_ACCESS via ISSUE_SECURITY, Jira AGREES → impact preview shows a real loss →
remove lab → a new scan is back to the pre-lab score and nothing outside the lab changed (diff the config counts
before/after). Run create/remove twice to prove idempotency.

## 2. Site-agnostic agent starters and copy
- Replace the conversation starters with ones that work on any site after Demo Lab, e.g. "Why can't I see
  CDLAB-2?", "Who can see CDLAB-2 and why?", "How healthy is our Jira configuration?",
  "What happens if I remove group cdlab-contractors?", "Is Config Doctor working on this site?".
- Update README "For judges" and SUBMISSION §1.3 testing instructions to: install → admin page → Create demo lab →
  Try these (no scripts). Keep `scripts/seed` documented as the developer path.

## 3. Bonus-prize check: Teamwork Graph (time-box 2 hours)
Investigate whether a Forge app can read Teamwork Graph data today (official docs only). If yes and it is small,
add one meaningful use, e.g. in Change Impact Preview show which teams own/work in the affected projects so the
admin knows who to notify. If not available to Forge or needs unavailable access, record why in RESEARCH.md and
skip — do not fake it.

## 4. Marketplace bonus readiness (prepare only, owner submits)
Write docs/MARKETPLACE.md: exact steps and all listing texts (name, tagline, summary, highlights ×3, description,
privacy/security answers, support contact placeholder, screenshot list) so I can "submit for listing" and paste the
review-ticket link into Devpost. Do not create any account or accept terms.

## 5. Judge-facing polish
- Screenshots: capture 5 PNGs of the admin page and Rovo answers on the demo site into docs/screenshots/ (if you
  can drive a logged-in browser; otherwise list exactly which shots I should take) and reference them in README.
- `scripts/demo-reset`: restores the demo site to the recording state (removes cleanup-plan issues it created,
  e.g. PAY-6..PAY-11, via label `config-doctor-cleanup` only; re-runs the seed; triggers a scan) so the video can
  be re-shot cleanly. Confirm before deleting; only delete issues carrying that label.
- Re-time the video script in SUBMISSION §3 to include a 15-second Demo Lab shot and stay under 4:45.
- Make sure the Devpost text mentions: deterministic + Jira ground truth, 30/30 identical runs, audit log, works
  without Rovo, Demo Lab for judges, MCP.

## 6. Final regression
`npm test`, `npx tsc --noEmit`, `forge lint`, deploy development + production, install/upgrade on both sites,
re-run the 10 scripted F1 questions once and the 3 impact scenarios once. Append evidence to PROGRESS.md and
summarise for me: what changed, evidence, what remains owner-only.
