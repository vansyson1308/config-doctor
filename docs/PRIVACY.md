# Config Doctor — privacy and data handling

Last updated: 2026-10-30

Config Doctor is a Forge app that runs entirely on Atlassian's infrastructure.

## What it reads
Jira configuration needed to answer admin questions: projects, permission schemes, project roles and
their actors, groups and group membership, issue security schemes and levels, custom field metadata,
screens, workflows and workflow schemes, filter JQL (for field-usage checks), and the specific issues an
admin asks about (key, reporter, assignee, security level, user/group picker fields used in grants).
Interactive requests read data **as the invoking admin**; the weekly scan reads as the app.

## What it stores (Forge storage, inside the customer's installation)
- **Audit log** — for every action: time, invoking accountId, action name, sanitized inputs (≤12 primitive
  values, strings ≤200 chars, secrets redacted), outcome, one-line result summary, duration. Retained 90 days.
- **Scan snapshots** — health score, counts and findings (object names and ids such as field and group
  names), retained 365 days; a site index used for blast-radius calculations (cached up to 24 hours).
- **Confirmation tokens** — cleanup plan: 15 minutes, single use, bound to the admin's accountId; Demo Lab:
  10 minutes, single use, bound to the admin's accountId.
- **Demo Lab ledger** (only if an admin creates the Demo Lab) — the lab's status, the id and name of every
  object it or Jira created for it (including the admin's lab group membership, recorded as group id +
  accountId), the custom field ids that existed before the lab (so Jira's template fields can be told
  apart), the accountId of the admin who created it, the last update time and the last error message. Kept
  until the app is uninstalled; after "Remove demo lab" it holds only the status "removed".
No issue content (summaries, descriptions, comments) is stored.

## What it sends elsewhere
Nothing. The app declares no external egress and calls only Jira REST APIs through Forge. It does not use
an external LLM: the Rovo agent runs on Atlassian's Rovo platform.

## What it changes
Read-only by default: no action changes Jira configuration. There are exactly two opt-in writes, both started
by a Jira administrator, both previewed first, both confirmed with a single-use token, and both audited:

1. **Demo Lab** (admin page → "Create demo lab"). After a preview listing every object and the admin's
   confirmation, it creates — with the admin's own account — project CDLAB, groups `cdlab-staff`,
   `cdlab-contractors` and `cdlab-old-reviewers`, role `cdlab-developers`, "cdlab Permission Scheme",
   "cdlab Security" with two levels, three "CD Lab Sprint Goal…" custom fields and three issues (the issues
   are created by the app). It adds the admin to `cdlab-contractors` and the app's own user to the lab
   project's add-ons role. It never invites or creates users. Every object it creates, and every screen,
   scheme, workflow and template field Jira creates for the lab project, is recorded in the ledger above.
   "Remove demo lab" (again preview + confirm) deletes **only** recorded objects, after checking that each
   recorded id still has the recorded name. When creating, it stops (and touches nothing) if an object with a
   lab name already exists that it did not create. Fields are moved to Jira's trash; Jira-locked fields are
   left in place.
2. **Cleanup plan** (Rovo chat). Creates Jira issues (an epic and one task per finding) in a project the admin
   names: a preview first, then a single-use, 15-minute token bound to that admin, Rovo's own confirmation
   card (a click), at most 3 plans per admin per hour, and an audit record written before the issues are
   created. It never deletes anything.

## Who can use it
Only users with the Administer Jira global permission (checked server-side on every call).

## Removal
Uninstalling the app removes its Forge storage according to Atlassian's hosted-storage data lifecycle.

Support: sonnv.hd34@gmail.com (security reports: see SECURITY.md).
