# Prompt 04 — Produce the Codegeist demo video (for Codex, run on the owner's Windows PC)

You are producing the < 4:45 demo video for **Config Doctor for Jira** (Atlassian Codegeist 2026) from the
REAL app on the REAL demo site. Read README.md, docs/SUBMISSION.md §3 (shot list + voice-over) and §1.3, and
docs/screenshots/ first. Never fake UI, numbers or answers: everything on screen must be the live app.

## Output
- `video/out/config-doctor-codegeist2026.mp4` — 1920×1080, 30 fps, H.264 + AAC, < 4:45, < 500 MB.
- `video/out/config-doctor-codegeist2026.srt` — English subtitles (also burned into a second file
  `…-subtitled.mp4`).
- `docs/marketplace/` — 5 PNG screenshots at 1920×1080 (overview+trend, access explainer CDLAB-2 / PAY-3,
  impact preview, audit log, Rovo chat answer) for the Marketplace listing (needs ≥ 1840×900).
- `video/README.md` — how to re-render. Add `video/.profile/`, `video/raw/`, `video/out/*.mp4` to .gitignore.
Do NOT upload anything anywhere. The owner reviews and uploads to YouTube himself.

## Tooling (install what is missing, ask before anything paid)
- Node + Playwright (`npx playwright install chromium`), ffmpeg (`winget install Gyan.FFmpeg`), Python 3 with
  `edge-tts` for the voice-over (voice `en-US-AndrewNeural` or `en-US-GuyNeural`, rate −5%). If edge-tts is
  unavailable, fall back to Windows SAPI and tell the owner.
- Browser: Playwright **persistent context** with its own profile dir `video/.profile` (headed, 1920×1080,
  deviceScaleFactor 1). On the first run, open https://one-atlas-sery.atlassian.net and **pause for the owner to
  log in himself** (never type credentials). Reuse the profile afterwards.

## Pipeline
1. **Prep the site** (demo site only): ask the owner to run `npm run demo:reset` (it asks before deleting; it only
   deletes issues labelled `config-doctor-cleanup`), make sure the Demo Lab is REMOVED so scene 7 can create it,
   then trigger **Run scan now** and wait for the score. Also open Rovo once to warm it up.
2. **Voice-over first**: write `video/script.json` from SUBMISSION §3 (scene id, narration text, on-screen
   action list). Tighten wording to stay within each scene's time; keep claims exactly as in the docs
   (30/30 identical runs, Jira AGREES, read-only except the two opt-in writes). Generate one MP3 per scene with
   edge-tts and measure each duration (ffprobe). Total narration must be ≤ 4:30.
3. **Title + end cards**: render HTML → 1920×1080 PNG using docs/brand/logo.svg and the style of
   docs/brand/devpost-thumbnail-1200x800.png (dark navy gradient, white text). End card shows: "Config Doctor
   for Jira", "Code computes. Rovo explains.", github.com/vansyson1308/config-doctor, "Install link in the
   Devpost description".
4. **Record each scene separately** with Playwright `recordVideo` (1920×1080): drive the UI with real clicks and
   typing (type at a human pace, ~25 ms/char), inject a visible cursor-highlight CSS, browser zoom 110%. For Rovo
   scenes open a fresh chat, select the Config Doctor agent, send the prompt and **wait until the answer has
   finished streaming** (poll until the text stops changing for 3 s), then scroll the answer slowly so key
   lines (verdict, evidence, "Jira AGREES", blast radius) are readable. Hold each scene at least as long as its
   narration; if a live answer differs from the script (names, counts), UPDATE the narration text to match what
   is on screen and regenerate that scene's audio — the video must never contradict the screen.
   Scene 5 (cleanup plan) really creates issues: only do it once per final take, and say "yes" in chat and
   click Rovo's Confirm card exactly as a user would.
   Scene 9 (Rovo Studio + MCP): if the Studio agent is not set up, set up a draft agent with the config-doctor
   tools (do not publish it) or, if that is blocked, replace scene 9 with the admin-page "Who can see" view and
   adjust narration; tell the owner.
5. **Edit with ffmpeg**: trim dead time (loading spinners > 1.5 s → speed up 2× or cut), add 0.3 s crossfades,
   lay each scene's MP3 on its clip, add subtle zoom-in (crop/scale) on the key answer region for scenes 2, 5, 6,
   7 so text is readable at 1080p, light background music is OPTIONAL (only royalty-free, −28 dB, and credit it in
   video/README.md). Normalize audio to −16 LUFS. Build the SRT from script.json + actual scene offsets.
6. **QC before handing over** (write results to video/QC.md): duration < 4:45; every scene's narration matches
   what is on screen; text readable at 1080p (check frames at each key moment — export stills to video/qc/);
   no personal data other than demo-site users; no browser bookmarks/extensions/other tabs visible; no
   notifications; audio has no clipping; first 15 s clearly states the problem; last card shows repo + tagline.
7. Capture the 5 Marketplace screenshots (1920×1080) during the same session.
8. Commit `video/` tooling, script.json, SRT, QC.md and docs/marketplace/*.png (not the MP4s), and summarise:
   final file paths, duration, any narration changes, anything the owner must check.

Afterwards the demo site should be left with the Demo Lab present (as after scene 7) — tell the owner.
