# Prompt 03 — Publish the repo, enable Sharing, verify the install link (QC round 2)

Reviewer QC of M6 (2026-10-30): fresh clone → 137/137 tests pass, `tsc --noEmit` clean. Demo Lab deletion
guards reviewed (recorded ids + name re-check before every delete) — OK. Owner decisions for this round:
- Make the GitHub repo **public now**: `vansyson1308/config-doctor` (owner's GitHub account).
- Public support contact: **sonnv.hd34@gmail.com**.
- The owner authorizes you to complete the Distribution → Sharing form in the developer console in his name
  with the answers below. Do not accept any other terms or change anything else in the console.

Do, in order, with evidence in docs/PROGRESS.md (new section "Publish & Share"):

## 1. Fix before going public (QC findings)
1. `docs/PRIVACY.md` is out of date: "What it changes: Nothing in Jira configuration" is false since M6.
   Rewrite that section to describe exactly the two opt-in writes (Demo Lab: creates/deletes only its own
   recorded, `cdlab-`/`CD Lab`/`CDLAB` objects after preview + confirm, using the admin's account and existing
   users only; Cleanup plan: creates issues after preview + token + confirmation). Add what Demo Lab stores
   (its ledger of created object ids) and the contact line "Support: sonnv.hd34@gmail.com". Add "Last updated"
   date. Make every claim match the code — check src/lab and src/storage.
2. Add `LICENSE` (MIT, "Copyright (c) 2026 Nguyen Van Son") — README already says MIT.
3. Add `SECURITY.md` (how to report a vulnerability → the support email; what the app can/cannot do).
4. Consistency pass across README, SPEC, AGENTS, SUBMISSION, MARKETPLACE: anywhere that still says "read-only
   except the cleanup plan" or "the only write" must mention Demo Lab too. PROGRESS history may stay as is.
5. Pre-publish secret scan of the WHOLE git history (not just HEAD): search for API tokens (e.g. `ATATT`),
   `.env` contents, passwords, private keys. Report the command and result. If anything is found, STOP and tell me.
   Confirm `.env`, `scripts/seed/.state/`, `coverage/` are not tracked.
6. Commit.

## 2. Create and push the public repo
- Use the GitHub CLI on this machine (`gh auth status`). If not logged in, stop and ask me to run `gh auth login`.
- `gh repo create vansyson1308/config-doctor --public --source . --remote origin --push` (if `origin` already
  points at a local path, rename it to `local` first). Set description "Deterministic, auditable answers to
  Jira's hardest admin questions — explained by a Rovo agent. Codegeist 2026." and topics: atlassian, forge,
  jira, rovo, mcp, codegeist.
- Verify in the browser that README renders with screenshots, and record the public URLs of README and
  docs/PRIVACY.md.

## 3. Enable Sharing in the developer console
Console → app 9e634caf-091b-4ebc-9529-c0b895d818b8 → Distribution → Edit → Sharing. Answers:
- Vendor / owner name: Nguyen Van Son. App name: Config Doctor.
- Support contact: sonnv.hd34@gmail.com
- Privacy policy URL: the public GitHub URL of docs/PRIVACY.md (blob URL on main).
- Personal data: **Yes** — stores Atlassian account IDs in the app's audit log (90 days) inside Forge storage;
  no egress; no personal data stored outside Atlassian. Answer the remaining personal-data questions
  consistently with PRIVACY.md. If a question has no answer in PRIVACY.md, stop and ask me.
Save → copy the installation link (production environment).

## 4. Verify the install link like a judge
- Put the link in docs/SUBMISSION.md §1 and README "For judges".
- Uninstall the dev-environment app from configdoctor.atlassian.net, then install via the link (production) as
  a judge would: admin page → Run scan → Create demo lab → Try these (CDLAB-2 NO_ACCESS, Jira AGREES; impact of
  removing cdlab-contractors) → Remove demo lab. Record evidence (screens/log lines).
- Leave configdoctor.atlassian.net with the PRODUCTION install afterwards; keep the demo site as it is (Demo Lab
  present, ready for the video).

## 5. Final
Commit + push. Summarise for me: repo URL, privacy URL, install link, verification evidence, and anything owner-only
that remains (expected: video recording, Devpost submission, Marketplace listing).
