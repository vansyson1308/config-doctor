# SPEC — Config Doctor for Jira

Working name (rename freely). Rovo agent name ≤ 30 chars: **Config Doctor**.
Codegeist category: **Apps for Software Teams**. Bonus targets: **Best Agents** (rovo:agent +
actions), **Best app with Atlassian MCP** (rovo:mcp), optionally Marketplace submission.

## Problem (evidence from Atlassian Community, 2026)
- "Why can't I see this?" is one of the most common admin tickets; tracing a stale group across
  permission schemes, project roles and shared objects takes about half a day.
- Configuration sprawl: custom fields created "just in case", cloned workflows, multiplying
  projects, stacked automations.
- Changes break existing setups; admins can't see impact before changing.
- Rovo itself is unreliable on large data (inconsistent analysis of ~1,000 issues) and on actions;
  admins have no audit/control over what AI does.
Config Doctor answers these with deterministic, auditable diagnostics — Rovo explains, code proves.

## Users
Jira site admins and project admins at teams of 20–2,000 people.

## Environment decisions (recorded 2026-10-30)
- Rovo is not usable on https://configdoctor.atlassian.net (see RESEARCH.md), so Rovo testing,
  seeding and the demo video use the Forge demo site **https://one-atlas-sery.atlassian.net**
  (enterprise editions + Rovo, expires 2027-01-27; re-provision with `forge site provision` if it expires).
  The app stays installed on configdoctor.atlassian.net as the "second site" for install tests.
- Owner decision: no new user accounts or invites. The seeder only uses users that already exist on
  the target site (the demo site ships with seeded users) plus the owner's account.
- MVP admin gate: every action is restricted to Jira administrators (Administer Jira). Project-admin
  access is out of scope for the hackathon build.

## Features (MVP → must ship)
### F1. Access Explainer
Ask: "Why can't @Linh see PROJ-123?" / "Who can see PROJ-123 and why?"
Code path:
1. Resolve user (accountId) and issue (key → project, issue security level).
2. Load the project's permission scheme; collect grants for BROWSE_PROJECTS (and the asked
   permission, e.g. EDIT_ISSUES, TRANSITION_ISSUES).
3. Expand each grant holder type (anyone, group, project role, user, reporter, assignee,
   user/group custom field, project lead…) against the user's groups and role memberships.
4. If the issue has a security level, check level members the same way.
5. Cross-check with Jira's own permission check API where possible (ground truth); if our
   reasoning disagrees, report "inconclusive" with both results — never hide it.
6. Return verdict + evidence chain + minimal fix options (e.g. "add Linh to group jira-dev-vn",
   "add to role Developers in PROJ"), each with blast radius (what else that grants).
### F2. Sprawl Audit (health score)
Scan custom fields, workflows/workflow schemes, screens, permission schemes, groups:
unused / not on any screen / not in any project / duplicate or near-duplicate names /
empty groups / groups not referenced anywhere / schemes used by no project.
Output: health score 0–100, findings ranked by risk and effort, each with evidence.
Optional (with confirmation): create a Jira "Cleanup plan" epic with one task per finding.
### F3. Change Impact Preview
Ask: "What happens if I remove group contractors-2024?" / "…if I delete field Sprint Goal?" /
"…if PROJ switches to permission scheme X?"
Output: affected projects, users who would lose/gain access (counts + sample), screens/filters
referencing a field, risk level. Read-only simulation, nothing is changed.
### F4. Proactive Watch (beats Rovo's passivity)
Scheduled trigger runs the sprawl scan weekly (chunked); stores snapshots; admin page shows trend
and new findings since last scan.
### F5. Admin page + Audit log
Dashboard: health score, top findings, last scan, audit log of every agent action.
### F6. MCP tools (bonus)
Expose F1–F3 actions via `rovo:mcp` so other agents (Rovo Studio / external MCP clients) can call
them.

## Rovo actions (draft — finalize after verifying module docs)
| key | verb | inputs | returns |
|---|---|---|---|
| explain-access | GET | user (name/email/accountId), issueKey, permission? | AccessVerdict |
| list-who-can-see | GET | issueKey | holders with paths |
| run-sprawl-audit | GET | scope? (site/project) | AuditSummary (cached if scan running) |
| preview-change-impact | GET | changeType, target | ImpactReport |
| create-cleanup-plan | CREATE | findingIds[], confirmToken | created issue keys |

## Output schema (AccessVerdict, example)
```json
{
  "verdict": "NO_ACCESS",
  "permission": "BROWSE_PROJECTS",
  "user": {"accountId": "…", "displayName": "Linh"},
  "issue": {"key": "PROJ-123", "project": "PROJ", "securityLevel": "Internal only"},
  "blockingLayer": "ISSUE_SECURITY",
  "evidence": [
    {"layer": "PERMISSION_SCHEME", "scheme": "Default", "grant": "Role: Developers", "userMatches": true, "via": "group jira-dev-vn"},
    {"layer": "ISSUE_SECURITY", "level": "Internal only", "members": ["group: staff-hq"], "userMatches": false}
  ],
  "fixOptions": [
    {"action": "Add Linh to group staff-hq", "alsoGrants": "access to 3 other projects", "risk": "medium"}
  ],
  "groundTruthCheck": "AGREES",
  "adminLinks": ["…/secure/admin/EditPermissions…"]
}
```

## Demo story (video < 5 min)
1. A messy demo site (seeded by script): 6 projects, 40 users, overlapping groups, issue security,
   80 custom fields with duplicates.
2. "Why can't Linh see PROJ-123?" → verdict in seconds with evidence chain + fix with blast radius.
3. Compare: plain Rovo answer vs Config Doctor (consistency: run 3 times, same answer).
4. Sprawl audit → health score 54 → cleanup plan epic created after confirmation.
5. "What if I delete group contractors-2024?" → 2 projects, 7 users lose access.
6. Admin page: trend + audit log. Same tool called from an external MCP client.

## Judging criteria mapping
- Technological implementation: Forge + Rovo agent + actions + MCP + scheduled triggers + storage + Jira REST.
- Design: one coherent admin product (chat + dashboard), not a PoC.
- Potential impact: the #1 admin ticket type, measurable time saved (half a day → seconds).
- Innovation: deterministic, auditable agent that fixes Rovo's known weaknesses.
- Presentation: story-driven demo with before/after.
