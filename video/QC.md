# Video QC — 2026-10-30

File: `video/out/config-doctor-codegeist2026.mp4`. The contact sheet (one frame every 4 s) is
`video/qc/contact-sheet.png`, and per-scene stills are in `video/qc/`.

| Check | Result |
|---|---|
| Duration < 4:45 | **PASS**: 268.0 s (4:28). |
| Format | **PASS**: 1920×1080, 30 fps, H.264 + AAC 48 kHz, `+faststart`, 25.6 MB (subtitled copy 28.9 MB). |
| Audio level, clipping | **PASS**: integrated −16.3 LUFS, true peak −1.3 dBFS (ffmpeg `ebur128`), LRA 3.6 LU. Narration only, no music. |
| First 15 s states the problem | **PASS**: the title card, then PAY-3 (locked issue). "Every Jira admin gets this ticket: why can't Emma see PAY-3? … takes hours." |
| Last card | **PASS**: "Config Doctor for Jira", "Code computes. Rovo explains.", github.com/vansyson1308/config-doctor, "Install link in the Devpost description". |
| Narration matches screen | **PASS**: narration was written after recording, from the live answers. Checked scene by scene below. |
| Readable at 1080p | **PASS**: checked on stills. Rovo answers are shown as a zoomed panel (~1.1×), the Demo Lab result at 1.33×, admin pages at native resolution. |
| No bookmarks, extensions, other tabs | **PASS**: Chrome full screen. The debugging bar and the extension's border are cropped out. |
| No notifications or dialogs | **PASS**: a Windows "open .bin file" dialog appeared in take 1 at 7:14. Those parts are used only as Rovo-panel crops, which the dialog did not cover (checked on the contact sheets). Take 2 is clean. |
| Personal data | **PASS, with notes**: only demo-site users appear (Emma Paris, Kevin Campbell, Alana Grant, Max Taylor, Ryan Lee) plus the owner's own name, avatar initials and a truncated account ID ("712020:8f2…") in the audit log. No email addresses. |
| Subtitles | **PASS**: 44 cues from edge-tts sentence boundaries; burned-in copy checked at 0:30. |

## Scene by scene (claim → what the screen shows)
1. PAY-3 "CD: Fraud rule thresholds (confidential)" with the security lock icon.
2. Rovo, Config Doctor agent: "@Emma Paris cannot see PAY-3: blocked by the issue security level". The evidence
   shows Browse via cd-contractors-2024 → CD Developers, and that the Internal only level admits only cd-staff-hq.
   The fix is to add her to cd-staff-hq (risk medium, blast radius listed). "Jira cross-check: AGREES".
3. "There are 3 people who can see PAY-3": Alana Grant and Kevin Campbell via cd-staff-hq, plus the reporter. The
   CD Developers role is filtered out by the level. "Jira cross-check: AGREES".
4. Audit log, page 1: today's `explain-access` "Emma Paris BROWSE_PROJECTS PAY-3: NO_ACCESS (ISSUE_SECURITY),
   jira AGREES". Page 2: yesterday's run (20:37:05) has the same text. "30 out of 30" comes from M2 (PROGRESS.md);
   it is a test result, not something shown on screen.
5. "Health score is 42/100 … The audit covered all 25 projects". Then "5 sets of duplicate custom fields" with
   customfield IDs and recommendations. Preview: 1 epic and 3 tasks, labelled config-doctor-cleanup, "Create
   these 4 issues in PAY? (yes/no)". Then "yes", Rovo's "Please review" card with confirmToken, "Confirm
   selected", and the result: PAY-12 (epic) and PAY-13 to PAY-15.
6. "Removing the group cd-contractors-2024 would have a medium risk impact". PAY: Max Taylor and Ryan Lee lose
   Browse, Create, Edit and Transition, while Emma Paris keeps access via cd-dev-vn. VEND: Max, Ryan and Emma
   lose access. References are listed.
7. Demo Lab: the preview list, "Confirm: create demo lab", "Demo lab is ready (24 objects recorded)". Try these →
   CDLAB-2: NO_ACCESS, blocked by ISSUE_SECURITY, Jira check AGREES. The evidence chain and a simulated fix with
   its blast radius are shown. "Remove" is described in narration but not shown, because the lab is left in
   place by design.
8. Admin page: score 42, trend, the "Where the points go" breakdown, the Findings tab, and an Impact preview of
   cd-contractors-2024 (medium).
9. Rovo Studio, a draft agent with 5 Config Doctor tools and an empty Instructions field. Test chat: "No, Kevin
   Campbell cannot transition PAY-2 … only grants transition rights to … CD Developers …". `forge logs` shows
   `explain-access … TRANSITION_ISSUES PAY-2: NO_ACCESS (PERMISSION_SCHEME), jira AGREES`.

## For the owner to check before uploading
- **Rovo Studio is shown in Vietnamese** (the account's language) in scene 9; the Marketplace screenshots are all
  English. If you want English throughout, switch the Atlassian account language to English and ask me to
  re-record scene 9 (about 2 minutes).
- A small OS arrow cursor sometimes shows next to the orange click highlight; it is harmless.
- Scene 5 created PAY-12 to PAY-15 on the demo site. Run `npm run demo:reset` before any future re-recording. It
  lists the issues and asks before deleting them.
- The demo site is left with the Demo Lab **present** (CDLAB, 24 objects), as scene 7 leaves it.
- Watch the subtitled copy once. Subtitle line breaks are automatic, at 58 characters.
