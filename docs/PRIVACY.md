# Config Doctor — privacy and data handling

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
- **Cleanup-plan confirmation tokens** — 15 minutes, single use.
No issue content (summaries, descriptions, comments) is stored.

## What it sends elsewhere
Nothing. The app declares no external egress and calls only Jira REST APIs through Forge. It does not use
an external LLM: the Rovo agent runs on Atlassian's Rovo platform.

## What it changes
Nothing in Jira configuration. The only write is creating Jira issues for a cleanup plan: a preview first,
then a single-use, 15-minute token bound to that user, Rovo's own confirmation card (a click), at most 3 plans
per admin per hour, and an audit record written before the issues are created.

## Who can use it
Only users with the Administer Jira global permission (checked server-side on every call).

## Removal
Uninstalling the app removes its Forge storage according to Atlassian's hosted-storage data lifecycle.

Contact: the app owner listed in the Atlassian developer console.
