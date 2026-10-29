# Codegeist 2026 submission — Config Doctor for Jira

Deadline: **Dec 22, 2026 12:00 PT** (target: submit by Dec 15).
Category: **Apps for Software Teams**. Bonus prizes: **Best Agents** (rovo:agent + actions),
**Best app with Atlassian MCP** (rovo:mcp).

## 1. Installation link for judges

**Install link:** `<<PASTE HERE after step 1.2>>`

### 1.1 Status
- Production environment deployed (`forge deploy -e production`, 2026-10-30).
- Sharing is **not yet enabled**: it needs the owner's declarations in the developer console.

### 1.2 Owner steps (5 minutes)
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
2. Jira → ⚙ Settings → Apps → **Config Doctor** → **Run scan now** (10–60 s) → explore Overview, Findings,
   **Check access** (any user + issue key; "Who can see" below it), **Impact preview** (e.g. remove a group)
   and **Audit log**. These work even if Rovo is not enabled on your site.
3. With Rovo: Ask Rovo → agent selector → **Config Doctor** → "How healthy is our Jira configuration?",
   "Why can't <user> see <ISSUE-KEY>?", "What happens if I remove group <group>?".
4. MCP: Rovo Studio → Create agent → Tools → Add tools → **config-doctor** → pick tools → Test.
5. Optional demo data: `scripts/seed` (README) recreates our scenario on your site.

## 2. Devpost write-up (draft)

**Tagline:** Deterministic, auditable answers to "why can't they see it?" — explained by Rovo.

### Inspiration
"Why can't X see this issue?" is one of the most common tickets a Jira admin gets. Answering it means
tracing permission schemes, project roles, groups and issue security levels by hand — often half a day.
At the same time configuration sprawl (duplicate fields, dead groups, unused schemes) makes every change
risky, and admins can't see what a change will break before making it. Generic AI makes this worse: an LLM
asked about permissions will happily guess, and nobody can audit what it did.

### What it does
Config Doctor is a Rovo agent plus a Jira admin page whose every answer is computed by code:
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

### How we built it
Forge (Node 24, TypeScript) with `rovo:agent`, 9 `action`s, `rovo:mcp`, `jira:adminPage` (UI Kit),
async-event `consumer` and `scheduledTrigger`, Forge KVS. All reasoning lives in `src/core` — pure functions
with no Forge imports and 100+ unit tests over fixtures (holder types, roles, groups, reporter/assignee,
user/group-picker fields, security levels, product access). The agent prompt only routes questions and
formats evidence. Every action validates LLM-supplied inputs, identifies the user from the Forge context,
checks they are a Jira admin server-side, and writes an audit record. The scanner is chunked and time-sliced
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

## 3. Demo video script (target 4:30, hard limit < 5:00)

Recording setup: demo site https://one-atlas-sery.atlassian.net seeded with `npm run seed`; browser zoom 110%;
Rovo panel open on the PAY board; admin page in a second tab; a fresh Rovo chat per scene. Before recording:
run one scan so the trend has history; optionally fix one finding and re-scan so the trend moves.

| # | Time | Screen | Action | Voice-over (approx.) |
|---|---|---|---|---|
| 1 | 0:00–0:20 | Title card → Jira PAY board | Show PAY-3 "Fraud rule thresholds (confidential)" | "Every Jira admin knows this ticket: *why can't Emma see PAY-3?* Tracing schemes, roles, groups and security levels by hand takes hours. Config Doctor answers it in seconds — and proves it." |
| 2 | 0:20–1:15 | Rovo → Config Doctor | Type "Why can't Emma Paris see PAY-3?" | "The agent calls a deterministic action. Verdict: no access, blocked by the issue security level. Evidence: she passes the permission scheme through the CD Developers role via cd-contractors-2024, but 'Internal only' admits only cd-staff-hq. The fix is simulated — adding her to cd-staff-hq resolves it — and the blast radius shows it also opens VEND and two more security levels. And Jira's own permission API agrees." |
| 3 | 1:15–1:45 | Same chat | "Who can see PAY-3 and why?" | "Three people, each with the exact path — checked person by person against Jira." |
| 4 | 1:45–2:15 | Plain Rovo vs Config Doctor (split or two takes) | Ask plain Rovo the same question; then show the audit log rows of three identical Config Doctor runs | "Ask a generic assistant and you get a plausible guess. Config Doctor gives the same, verifiable answer every time — here are three runs in the audit log." |
| 5 | 2:15–3:05 | Rovo | "How healthy is our Jira configuration?" (score 42) → "Show all duplicate fields" → "Create a cleanup plan in PAY for the top 3" → preview → "yes" → Rovo's Confirm card → PAY epic opens | "A health score with a breakdown you can audit, ranked findings — near-duplicate fields, empty groups that still hold grants. One confirmed request turns them into a cleanup epic. It's the only thing Config Doctor ever writes: preview, your yes, Rovo's confirmation, a single-use token — and it's audited before it writes." |
| 6 | 3:05–3:45 | Rovo | "What happens if I remove group cd-contractors-2024?" | "Before you change anything: Max and Ryan lose VEND and PAY; Emma loses VEND but keeps PAY through cd-dev-vn. A read-only simulation, in seconds." |
| 7 | 3:45–4:15 | Admin page | Overview (score, trend), Findings, Check access + Who can see, Impact preview, Audit log | "The admin page: weekly scans, trend, every finding, access and impact tools that work even without Rovo, and an audit log of every action — chat, MCP, page or scheduler." |
| 8 | 4:15–4:30 | Rovo Studio agent | Custom agent using config-doctor MCP tools answers "Can Kevin transition PAY-2?" | "And through Rovo MCP, any agent can use the same trusted tools." |
| 9 | 4:30–4:40 | Title card | Name, tagline, install link | "Config Doctor. Code computes, Rovo explains." |

Upload: YouTube, **public**, title "Config Doctor for Jira — Codegeist 2026", link in Devpost.

## 4. Submission checklist
- [ ] Installation link generated (section 1.2) and tested on a second site
- [ ] Demo video recorded (< 5 min), uploaded public on YouTube
- [ ] Devpost: category Apps for Software Teams; bonus Best Agents + Best app with Atlassian MCP
- [ ] Devpost text pasted from section 2; testing instructions from 1.3
- [ ] Repository link (optional): push this repo to GitHub (public) if you want judges to read the code
