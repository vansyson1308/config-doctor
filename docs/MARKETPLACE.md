# Atlassian Marketplace listing — Config Doctor for Jira (prepared; owner submits)

Purpose: qualify for the Codegeist "Best Marketplace published app" bonus by submitting the app for listing
and pasting the review-ticket link into Devpost. Nothing here has been submitted, no account was created and
no terms were accepted — those steps are the owner's.

## Owner steps
1. **Publish the production version** (already deployed: `forge deploy -e production`). Distribution → Sharing
   must be enabled first (docs/SUBMISSION.md §1.2).
2. **Marketplace partner profile**: https://marketplace.atlassian.com/manage/vendors/create (owner signs up and
   accepts the Marketplace Partner Agreement).
3. **Create the listing**: Developer console → config-doctor → Distribution → "List on Marketplace" (or
   marketplace.atlassian.com → Manage partner → Create new app → Forge app → select config-doctor).
   Choose **Free** pricing (paid listings need extra billing setup; free is enough for the bonus).
4. Paste the texts below, upload the logo and screenshots (docs/screenshots/), answer the privacy & security
   questionnaire with §"Privacy & security answers".
5. Submit for approval → copy the **review ticket link** (Marketplace sends it by email / shows it on the
   listing page) into Devpost.

## Listing texts

**App name:** Config Doctor for Jira

**Tagline (≤ 80 chars):** Why can't they see it? Deterministic, auditable Jira access answers via Rovo.

**Summary (≤ 250 chars):** Config Doctor explains who can access what in Jira and why — permission schemes,
roles, groups and issue security — checked against Jira's own permission API, plus a configuration health
score and change-impact previews. Every action is audited.

**Highlights (3):**
1. **Answers you can verify.** "Why can't Linh see PROJ-123?" returns the blocking layer, the full evidence
   chain and fix options with their blast radius — and Jira's own permission check as ground truth.
2. **See the mess, fix it safely.** A 0–100 health score with an explainable breakdown: duplicate and unused
   fields, empty groups that still hold grants, unused schemes and screens. Preview what removing a group or
   switching a scheme would break before you touch it.
3. **Built for trust.** Read-only by default (the only writes are the opt-in Demo Lab, which removes exactly
   what it created, and a confirmed cleanup plan), admin-only, every action in an audit log, no data leaves
   Atlassian (Runs on Atlassian eligible). Works in Rovo chat, Rovo Studio (MCP tools) and a Jira admin page.

**Description:**
Access tickets ("I can't see this issue") are among the most common work for Jira admins, and answering them
means tracing permission schemes, project roles, group memberships and issue security levels by hand.
Config Doctor does that tracing with deterministic code and lets Rovo explain the result.

- **Access Explainer** — verdict, blocking layer, evidence chain (grant → role → group), fix options that are
  simulated before being suggested, each with its blast radius; cross-checked with Jira's permission API.
- **Who can see this?** — every viewer and the exact path that gives them access, after issue security.
- **Sprawl Audit** — explainable health score and ranked findings; optional cleanup plan as Jira issues
  (preview → confirm).
- **Change Impact Preview** — who loses or gains which permission if you remove a group, delete a field or
  switch a permission scheme. Read-only simulation.
- **Weekly scan, trend and "new since last scan"**, **audit log**, and **MCP tools** for Rovo Studio agents.
- **Demo Lab** — try everything on an empty site: one click creates a labelled scenario, one click removes
  exactly what it created.

Requirements: Jira Cloud; users need the Administer Jira global permission. Rovo is optional (the admin page
offers the same core features).

**Category:** Admin tools / Security (secondary: IT & helpdesk). **Keywords:** permissions, access, audit,
security, admin, Rovo, AI agent, configuration, cleanup, governance.

**Support contact:** `<<owner email or support URL>>` · **Documentation:** README (repo URL) ·
**Privacy policy:** docs/PRIVACY.md published at a public URL `<<link>>` · **EULA:** Atlassian Marketplace standard.

## Privacy & security answers (from docs/PRIVACY.md)
- Does the app store personal data? **Yes — Atlassian account IDs** in the app's own audit log (90 days) and
  scan snapshots (group/field names); stored in Forge storage within the customer's installation.
- Does the app transmit data outside Atlassian? **No** (no egress; Runs on Atlassian eligible).
- Does the app use AI / LLMs? Only Atlassian Rovo (Atlassian-hosted); the app itself calls no LLM.
- Data retention / deletion: audit 90 days, snapshots 365 days (TTL); uninstall removes app storage.
- Authentication & authorization: Forge-managed; every call checks Administer Jira server-side from the Forge
  context; LLM inputs are never used for authorization.
- Writes: none to configuration except the opt-in Demo Lab (its own labelled objects) and the confirmed cleanup plan.
- Security contact / vulnerability disclosure: `<<owner email>>`.

## Assets checklist
- Logo 144×144 PNG (simple stethoscope/shield on blue) — `<<to create>>`
- Banner 1840×900 (optional)
- Screenshots 1840×900 or larger (from docs/screenshots/): admin overview, access explainer, who-can-see,
  impact preview, Rovo chat answer, audit log.
- Demo video URL (same as Devpost).
