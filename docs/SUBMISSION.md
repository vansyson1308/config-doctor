# Codegeist 2026 submission — Config Doctor for Jira

Deadline: **Dec 22, 2026 12:00 PT** (target: submit by Dec 15).
Category: **Apps for Software Teams**. Bonus prizes: **Best Agents** (rovo:agent + actions),
**Best app with Atlassian MCP** (rovo:mcp).

## 1. Installation link for judges

**Install link (Jira, production):** [Install Config Doctor](https://developer.atlassian.com/console/install/9e634caf-091b-4ebc-9529-c0b895d818b8?signature=AYABeOh5RBpSCBEMnhI1EgjyRf4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBiEClVQFqsyPld7QPy8pH5gAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDMrUp27H9KIomStu%2FAIBEIA73nReCop%2B9kls7fZ8tP4Cqh2%2Bf5i06H%2FdwkbOlgZY6zGKKCSFrUtepHkTlHWY4AsjMGbglxd3c6HwiksAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEGhl3IFhLphI8h41sLChD4AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMP7NVcMzhk7kqmHDEAgEQgDtnP9EBsPJcIedyLoJSFDUKA2I2EJL0pAF2GCq3qepjZOKKijKmDOvlBSb%2FhTmrLAgrnIG56UXmfkeG7wAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAZnaqQlO3nRjSfts%2FXUHarMAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwHnLSvCurY2aq%2FahgCARCAOzVFD2hOFpcu3tENvTudHyDvxeosM5bhXOl%2FOGeYm2sewDs%2FXi5puf786dtnhaMQiAY7dwFTrt02LqMSAgAAAAAMAAAQAAAAAAAAAAAAAAAAANZH6odmNKK6noGD0DjMH4f%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJIYYqSsLKJLUylT1HyXmg8ebjalNH6mwn3wDNFyDYI3dqCsy0i%2F88gAj5A2NjCpay413lEVF%2BUOktsYm2SqN5QV48%3D&product=jira)

Raw link:

```
https://developer.atlassian.com/console/install/9e634caf-091b-4ebc-9529-c0b895d818b8?signature=AYABeOh5RBpSCBEMnhI1EgjyRf4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBiEClVQFqsyPld7QPy8pH5gAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDMrUp27H9KIomStu%2FAIBEIA73nReCop%2B9kls7fZ8tP4Cqh2%2Bf5i06H%2FdwkbOlgZY6zGKKCSFrUtepHkTlHWY4AsjMGbglxd3c6HwiksAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEGhl3IFhLphI8h41sLChD4AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMP7NVcMzhk7kqmHDEAgEQgDtnP9EBsPJcIedyLoJSFDUKA2I2EJL0pAF2GCq3qepjZOKKijKmDOvlBSb%2FhTmrLAgrnIG56UXmfkeG7wAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAZnaqQlO3nRjSfts%2FXUHarMAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwHnLSvCurY2aq%2FahgCARCAOzVFD2hOFpcu3tENvTudHyDvxeosM5bhXOl%2FOGeYm2sewDs%2FXi5puf786dtnhaMQiAY7dwFTrt02LqMSAgAAAAAMAAAQAAAAAAAAAAAAAAAAANZH6odmNKK6noGD0DjMH4f%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJIYYqSsLKJLUylT1HyXmg8ebjalNH6mwn3wDNFyDYI3dqCsy0i%2F88gAj5A2NjCpay413lEVF%2BUOktsYm2SqN5QV48%3D&product=jira
```

### 1.1 Status
- Production environment deployed (`forge deploy -e production`, 2026-10-30).
- Sharing **enabled** (Sharing with anyone, Jira) on 2026-10-30; privacy policy
  https://github.com/vansyson1308/config-doctor/blob/main/docs/PRIVACY.md, support sonnv.hd34@gmail.com.

### 1.2 Owner steps (done 2026-10-30 — kept for reference)
1. Open https://developer.atlassian.com/console/myapps/9e634caf-091b-4ebc-9529-c0b895d818b8/manage/distribution
2. **Edit** → Distribution status: **Sharing**. Suggested answers:
   - App name / owner: Config Doctor — Sơn Nguyễn Văn
   - Customer support contact: your email
   - Privacy policy: link to `docs/PRIVACY.md` (public repo URL) or paste its text into a public page
   - Personal data: **Yes, the app stores Atlassian account IDs** (in its own audit log, 90 days; see PRIVACY.md).
     It does **not** store personal data outside Atlassian (no egress).
3. Save → copy the **installation link** into the line above, and into the Devpost form.
4. Test it: open the link → choose a site → Install → Jira Settings → Apps → Config Doctor → Run scan now.

### 1.3 Judge quick start (paste into Devpost "testing instructions")
1. Install with the link above as a Jira site admin (Administer Jira).
2. Jira → ⚙ Settings → Apps → **Config Doctor** → **Create demo lab** → Confirm (30–60 s; creates a labelled
   CDLAB scenario with only your account — no invites; removable with one click).
3. **Try these** card: "Why can't I see CDLAB-2?" → NO_ACCESS via issue security, Jira AGREES, fix + blast radius;
   "Who can see CDLAB-2?"; "What happens if I remove group cdlab-contractors?"; **Run scan** → health score and the
   lab's findings (near-duplicate fields, an empty group that still holds a grant).
4. Explore **Findings**, **Impact preview**, **Audit log** (every action is recorded). All of this works without Rovo.
5. With Rovo: Ask Rovo → agent selector → **Config Doctor** → use the conversation starters.
6. MCP: Rovo Studio → Create agent → Tools → Add tools → **config-doctor** → pick tools → Test.
7. Finish with **Remove demo lab**: your site's configuration returns exactly to its previous state.

## 2. Devpost write-up (draft)

**Tagline:** Deterministic, auditable answers to "why can't they see it?" — explained by Rovo.

### Inspiration
"Why can't X see this issue?" is one of the most common tickets a Jira admin gets. Answering it means
tracing permission schemes, project roles, groups and issue security levels by hand — often half a day.
At the same time configuration sprawl (duplicate fields, dead groups, unused schemes) makes every change
risky, and admins can't see what a change will break before making it. Generic AI makes this worse: an LLM
asked about permissions will happily guess, and nobody can audit what it did.

### What it does
Config Doctor is a Rovo agent plus a Jira admin page whose every answer is computed by deterministic code
and cross-checked with Jira's own permission API (ground truth) — 30 of 30 scripted questions answered
identically across three runs. It works without Rovo too (admin page), every action lands in an audit log,
the same tools are exposed over Rovo MCP, and judges can try it on an empty site with the one-click Demo Lab:
- **Access Explainer** — "Why can't Linh see PROJ-123?" returns a verdict, the blocking layer (permission
  scheme, issue security level or account), the evidence chain (grant → role → group), and fix options that
  are *simulated* against the model, each with its blast radius ("adding Linh to staff-hq also grants VEND
  and two PAY security levels"). Every verdict is cross-checked with Jira's own permission API; if they
  disagree, Config Doctor says so instead of hiding it.
- **Who can see this?** — every viewer and the path that gives them access, after issue security,
  verified person by person against Jira.
- **Sprawl Audit** — an explainable health score (0–100) and ranked findings: near-duplicate fields
  ("Sprint Goal" / "Sprint goal" / "Sprint Goal (old)"), fields on no screen, empty groups that still hold
  grants (a silent backdoor), unused schemes, inactive workflows, unused screens. One confirmation turns
  findings into a Jira cleanup epic.
- **Change Impact Preview** — "What happens if I remove group contractors-2024?" → who loses which
  permission in which project, and who keeps access through another path. Read-only simulation.
- **Proactive watch** — weekly scan, trend and "new since last scan".
- **Audit log** — every action from chat, MCP, the admin page or the scheduler: who, when, inputs, result.
- **MCP** — the same tools are available to any Rovo Studio agent via `rovo:mcp`.
- **Demo Lab** — one click builds a labelled scenario on any site (a restricted issue you can't see, an empty
  group that still holds a grant, near-duplicate fields); one click removes exactly what it created.

### How we built it
Forge (Node 24, TypeScript) with `rovo:agent`, 9 `action`s, `rovo:mcp`, `jira:adminPage` (UI Kit),
async-event `consumer` and `scheduledTrigger`, Forge KVS. All reasoning lives in `src/core` — pure functions
with no Forge imports and 100+ unit tests over fixtures (holder types, roles, groups, reporter/assignee,
user/group-picker fields, security levels, product access). The agent prompt only routes questions and
formats evidence. Every action validates LLM-supplied inputs, identifies the user from the Forge context,
checks they are a Jira admin server-side, and writes an audit record. The app is read-only except two opt-in,
previewed, token-confirmed writes: the Demo Lab (creates and later deletes only its own recorded objects) and
the cleanup plan (creates issues). The scanner is chunked and time-sliced
over async events (a full scan of a 25-project demo site takes ~10 s), and snapshots feed the trend chart.

### Challenges
- **Jira's own answers are eventually consistent.** Right after a group change, `permissions/check` flipped
  between yes and no; we now take the majority of up to three checks and show every raw answer.
- **`user/permission/search` ignores issue security levels** — it listed 7 users for an issue only 3 can see,
  so viewer lists are verified per person with `permissions/check`.
- Forge app users cannot run `permissions/check` for other users (403); the check runs as the invoking admin.
- Keeping actions under Forge's 55 s limit: cached site index, bounded concurrency and deadlines.
- Rovo sometimes drops optional inputs — every action works with required inputs plus deterministic context.

### Accomplishments
- 30 / 30 scripted access questions answered identically across three runs, all matching Jira's own check.
- 132 unit tests over the pure core (≈95% statement coverage); an independent code + security review whose
  findings were all fixed before submission.
- A sprawl audit that found every planted problem in our demo site, and a cleanup plan created only after
  preview → explicit yes → Rovo's own confirmation.
- One admin page that delivers the core value even on sites where Rovo is not enabled.

### What we learned
Agents are most trustworthy when the model never computes facts. Treat the LLM as a router and narrator, make
code produce evidence, compare with the platform's ground truth, and log everything.

### What's next
Filter/dashboard-sharing analysis for groups, team-managed project access levels, Confluence space
permissions, scheduled "permission drift" alerts, and a Marketplace listing.

### Built with
Atlassian Forge · Rovo agents and actions · Rovo MCP · Jira Cloud REST API v3 · Forge UI Kit · Forge KVS ·
Forge async events and scheduled triggers · TypeScript · Vitest

### Technical requirement explanation (Devpost field)
Config Doctor is a Forge app (manifest `rovo:agent`, `action`, `rovo:mcp`, `jira:adminPage`, `consumer`,
`scheduledTrigger`) that integrates with Jira (REST API v3) and Rovo (agent + MCP tools). It runs entirely on
Atlassian infrastructure with no external egress.

## 3. Demo video script (target 4:35, hard limit < 4:45)

Recording setup: demo site https://one-atlas-sery.atlassian.net. Before recording run `npm run demo:reset`
(removes cleanup-plan issues after you confirm, re-seeds), then Run scan now. Browser zoom 110%; Rovo panel on the
PAY board; admin page in a second tab; a fresh Rovo chat per scene. Remove any existing demo lab first so scene 7
shows it being created.

| # | Time | Screen | Action | Voice-over (approx.) |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Title card → PAY board | Show PAY-3 "Fraud rule thresholds (confidential)" | "Every Jira admin knows this ticket: *why can't Emma see PAY-3?* Config Doctor answers it in seconds — and proves it." |
| 2 | 0:15–1:05 | Rovo → Config Doctor | "Why can't Emma Paris see PAY-3?" | "A deterministic action, not a guess: blocked by the issue security level. Evidence: she passes the scheme via role CD Developers through cd-contractors-2024, but 'Internal only' admits only cd-staff-hq. The fix is simulated first, with its blast radius — and Jira's own permission API agrees." |
| 3 | 1:05–1:30 | Same chat | "Who can see PAY-3 and why?" | "Three people, each with the exact path, checked person by person against Jira." |
| 4 | 1:30–1:55 | Audit log | Three identical runs of the same question | "Same question, same answer, every time — 30 out of 30 in our test runs — and every call is in the audit log." |
| 5 | 1:55–2:45 | Rovo | "How healthy is our Jira configuration?" → "Show all duplicate fields" → "Create a cleanup plan in PAY for the top 3" → preview → "yes" → Rovo's Confirm card → epic opens | "An explainable health score and ranked findings. One confirmed request becomes a cleanup epic — preview, your yes, Rovo's confirmation, a single-use token, audited before it writes." |
| 6 | 2:45–3:20 | Rovo | "What happens if I remove group cd-contractors-2024?" | "Before you change anything: Max and Ryan lose VEND and PAY; Emma loses VEND but keeps PAY through cd-dev-vn. A read-only simulation." |
| 7 | 3:20–3:35 | Admin page → Demo lab | Create demo lab → preview → Confirm → Try these: "Why can't I see CDLAB-2?" | "Judges: no setup scripts. One click builds a labelled lab on your own site — and one click removes exactly what it created." |
| 8 | 3:35–4:05 | Admin page | Overview (score, trend), Findings, Impact preview, Audit log | "Weekly scans, trend, findings, access and impact tools that work even without Rovo, and an audit log of every action." |
| 9 | 4:05–4:25 | Rovo Studio agent | Custom agent with config-doctor MCP tools: "Can Kevin transition PAY-2?" | "Through Rovo MCP, any agent can use the same trusted tools." |
| 10 | 4:25–4:35 | Title card | Name, tagline, install link | "Config Doctor. Code computes, Rovo explains." |

Upload: YouTube, **public**, title "Config Doctor for Jira — Codegeist 2026", link in Devpost.

## 4. Submission checklist
- [ ] Installation link generated (section 1.2) and tested on a second site
- [ ] Demo video recorded (< 4:45), uploaded public on YouTube
- [ ] Optional bonus: Marketplace listing submitted (docs/MARKETPLACE.md) and review-ticket link added to Devpost
- [ ] Devpost: category Apps for Software Teams; bonus Best Agents + Best app with Atlassian MCP
- [ ] Devpost text pasted from section 2; testing instructions from 1.3
- [ ] Repository link (optional): push this repo to GitHub (public) if you want judges to read the code
