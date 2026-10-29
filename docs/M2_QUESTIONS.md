# M2 acceptance — 10 scripted access questions (seeded demo site)

Site: https://one-atlas-sery.atlassian.net (seeded by `npm run seed`). Expected answers derive from
`scripts/seed/scenario.ts`; Jira's own permission check is the independent ground truth.

| # | Question | Expected verdict | Expected blocking layer / path |
|---|---|---|---|
| 1 | Why can't Emma Paris see PAY-3? | NO_ACCESS | ISSUE_SECURITY ("Internal only" = group cd-staff-hq); fix: add to cd-staff-hq |
| 2 | Can Emma Paris see PAY-4? | HAS_ACCESS | role CD Developers (via cd-dev-vn / cd-contractors-2024), level "Payments team" includes the role |
| 3 | Can Kevin Campbell see PAY-3? | HAS_ACCESS | group cd-staff-hq (scheme + level) |
| 4 | Can Max Taylor see PAY-3? | NO_ACCESS | ISSUE_SECURITY |
| 5 | Can Max Taylor see VEND-1? | HAS_ACCESS | group cd-contractors-2024 |
| 6 | Can Cassi Owens see VEND-2? | NO_ACCESS | PERMISSION_SCHEME (VEND grants Browse only to cd-contractors-2024, cd-staff-hq, app role) |
| 7 | Can Cassi Owens edit PAY-1? | HAS_ACCESS | role CD Developers via cd-dev-vn |
| 8 | Can Ryan Lee edit VEND-3? | HAS_ACCESS | group cd-contractors-2024 |
| 9 | Can Kevin Campbell transition PAY-2? | NO_ACCESS | PERMISSION_SCHEME (TRANSITION_ISSUES only for role CD Developers) |
| 10 | Who can see PAY-3? | 3 viewers | Alana Grant, Kevin Campbell, Sơn Nguyễn Văn (cd-staff-hq); Jira AGREES |

Evidence of each run: `forge logs` lines `{"message":"action","action":...,"summary":...}` (also stored in the
audit log). Results are recorded in docs/PROGRESS.md under M2.
