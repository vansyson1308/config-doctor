# Demo-data seeder (local only, not part of the Forge app)

Creates the Config Doctor demo scenario on a Jira site you administer. Idempotent: every step is
find-or-create by name, so re-running converges to the same state (second run prints
`0 created, 44 already present`). It never deletes anything and never invites or creates users.

```bash
cp .env.example .env              # set JIRA_EMAIL and a classic JIRA_API_TOKEN (never commit .env)
npm run seed -- --check           # read-only: what exists / what would be created
npm run seed                      # create / converge
```

## What it creates (all names prefixed "CD" / "cd-")

| Object | Details |
|---|---|
| Groups | `cd-staff-hq` (Kevin Campbell, Alana Grant, owner), `cd-dev-vn` (Emma Paris, Cassi Owens), `cd-contractors-2024` (Max Taylor, Ryan Lee, Emma Paris), `cd-payments-admins` (owner), `cd-legacy-empty` (empty), `cd-old-reviewers` (empty, but granted Browse in PAY) |
| Project role | `CD Developers` (global role) |
| Permission schemes | `CD Payments Permission Scheme` (PAY: Browse via role CD Developers, group cd-staff-hq, reporter, cd-old-reviewers; edit/transition via the role; admin via cd-payments-admins), `CD Vendor Permission Scheme` (VEND: Browse/edit via cd-contractors-2024, Browse via cd-staff-hq), `CD Legacy Scheme (copy)` (used by no project) |
| Issue security scheme | `CD Payments Security`: level `Internal only` = group cd-staff-hq; level `Payments team` = role CD Developers + group cd-staff-hq |
| Projects | `PAY` CD Payments Platform (software, company-managed; role CD Developers = groups cd-dev-vn + cd-contractors-2024), `VEND` CD Vendor Portal (business, company-managed) |
| Issues | PAY-1..PAY-5 (PAY-3 `Internal only`, PAY-4 `Payments team`), VEND-1..VEND-3 |
| Custom fields | 12 text fields on no screen, incl. near-duplicates: `CD Sprint Goal` / `CD Sprint goal` / `CD Sprint Goal (old)`, `CD Customer Tier` / `CD Customer tier ` / `CD Cust. Tier`, `CD Release Train` / `CD Release train (copy)`, `CD Legacy Region` / `CD Legacy Region 2`, `CD Temp Field 2023`, `CD Cost Center` |

Demo users are existing users of the Forge demo site; missing users are skipped, not invited.

## Demo stories this enables
- "Why can't Emma Paris see PAY-3?" → passes the scheme via role CD Developers, blocked by the
  `Internal only` security level; fix: add to `cd-staff-hq` (also grants VEND + both PAY levels).
- "What if I remove group cd-contractors-2024?" → Max and Ryan lose PAY and VEND; Emma loses VEND but
  keeps PAY through `cd-dev-vn`.
- Sprawl audit: empty/unused groups, an unused scheme, duplicate and screen-less custom fields.

## Platform behaviour observed while seeding (2026-10-30)
- Group/scheme changes propagate with a delay of 1–3 minutes: `POST /issue` returns 403 and
  `security` "cannot be set" until then. The seeder retries those cases.
- `POST /rest/api/3/search/jql` intermittently returns 404 "Issue does not exist" on fresh data; retried.
- Issue-security level members take group **names** and lowercase type `projectrole` on create, but are
  returned as `projectRole` with group name + id on read.
- New permission schemes automatically get grants for `atlassian-addons-project-access` and
  `jira-guest-member` roles.
