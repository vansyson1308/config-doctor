# Security policy

## Reporting a vulnerability
Email **sonnv.hd34@gmail.com** with "Config Doctor security" in the subject. Please include the steps to
reproduce, the affected version (shown in Jira → Apps → Manage apps) and the impact you expect. Do not open a
public GitHub issue for a vulnerability. You will get an acknowledgement within 5 working days.

Please test only on Jira sites you administer, and do not access other people's data.

## What the app can do
- **Read** Jira configuration (projects, permission and issue security schemes, roles, groups and members,
  custom field metadata, screens, workflows, filter JQL) and the issues an admin asks about. Interactive
  requests run as the invoking admin; the weekly scan runs as the app.
- **Write**, only in two opt-in, previewed, token-confirmed and audited flows (details in
  [docs/PRIVACY.md](docs/PRIVACY.md)):
  - the **Demo Lab** creates its own `cdlab` / `CD Lab` / `CDLAB` objects and later deletes only the objects
    it recorded;
  - the **cleanup plan** creates Jira issues in a project the admin names.
- **Store**, in Forge storage inside the customer's installation: an audit log (90 days), scan snapshots
  (365 days), a site-index cache, short-lived confirmation tokens and the Demo Lab ledger.

## What the app cannot do
- It cannot be used by non-admins: every resolver, Rovo action and MCP tool checks the Administer Jira global
  permission server-side from the Forge context. Inputs supplied by the LLM are validated and never used for
  authorization.
- It does not change permission schemes, groups, fields, workflows or any other existing configuration, and
  never deletes anything it did not create.
- It sends no data outside Atlassian: no egress is declared, and it calls no external LLM (the agent runs on
  Atlassian Rovo). It is eligible for *Runs on Atlassian*.
- It never invites, creates or deactivates users.

## Supported versions
Only the latest production version of the app is supported.
