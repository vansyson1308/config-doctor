# Config Doctor — Codegeist demo video

Everything on screen is the live app on the Forge demo site https://one-atlas-sery.atlassian.net, recorded on
2026-10-30. Narration was written after recording, so each line matches what is on screen.

## Outputs (not committed)
- `video/out/config-doctor-codegeist2026.mp4`: 1920×1080, 30 fps, H.264 + AAC, 4:28, about 26 MB.
- `video/out/config-doctor-codegeist2026-subtitled.mp4`: the same video with English subtitles burned in.
- `video/out/config-doctor-codegeist2026.srt`: committed. Cue times come from edge-tts sentence boundaries.
- `docs/marketplace/*.png`: 5 Marketplace screenshots at 1920×1080, taken from the same recordings.

## How it was recorded
The owner's isolated Playwright profile could not be signed in, so the scenes were recorded in the owner's own
signed-in Chrome:
- Chrome ran full screen (F11). The browser was driven by the Claude in Chrome extension, using real clicks and
  typing at about 28 ms per character. The overlay script `video/overlay.js` was injected so viewers can see where
  each click lands.
- The whole desktop was captured with `ffmpeg -f gdigrab -framerate 30 -draw_mouse 0 -i desktop`. Capturing a
  single Chrome window with gdigrab gives white frames, which is why the full desktop is recorded.
- Chrome shows a "debugging this browser" bar while the extension is attached, and the extension adds a border at
  the edges. The edit crops both out. Layouts in `script.json`:
  - `full`: the page without the bar, centred on the brand background;
  - `panel`: the Rovo side panel, zoomed beside the scene title;
  - `zoom`: a 1440×810 region scaled to 1080p.
- Browser zoom was left at 100%, because the display already runs at 125% scaling.
- Take 1 (`raw/take1.mkv`) covers scenes 1, 2, 3, 5 and 6. From 7:14 on, an unrelated Windows "open .bin file"
  dialog covered the centre of the screen. The Rovo panel was not covered, so take 1 is only used up to 7:14 for
  full-frame shots, and as panel crops after that.
- Take 2 (`raw/take2.mkv`) re-recorded scenes 4, 7, 8 and 9.
- The in/out times in `script.json` are seconds into each take.

## Re-render
Run from the repository root. You need ffmpeg and ffprobe on PATH, Python 3 with `edge-tts`, and Node.

```bash
npm install --prefix video
```

```bash
node video/cards.mjs
```

```bash
python video/build.py
```

What each command does:
- `cards.mjs` renders the title and end cards and the per-scene backgrounds from `cards.html` and `bg.html`.
- `build.py`:
  1. generates one MP3 per scene with edge-tts (voice `en-US-AndrewNeural`, rate −5%), cached in `raw/voice/`;
  2. renders each segment. Waits are sped up 2.5–10×. Segments marked `elastic` stretch to fit the narration, at
     up to 2.5×;
  3. joins the scenes with 0.3 s crossfades;
  4. places each narration track 0.4 s after its scene starts;
  5. normalises loudness to −16 LUFS;
  6. writes the SRT and the subtitled copy, plus a QC still from the middle of each scene in `video/qc/`.

The raw takes are in `video/raw/`, which git ignores. Keep them if you want to re-render.

No background music is used.
