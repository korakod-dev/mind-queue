# Media scripts

Rebuild the README screenshots and the two videos in `media/` from a **real game played on a local
server** (bot players + one simulated phone, driven through your installed Google Chrome).

```bash
npm run dev                                  # in another terminal (port 8790)
scripts/media/make-screenshots.sh            # → docs/screenshots/*.jpg (~3 min)
scripts/media/make-videos.sh                 # → media/how-to-play.mp4, classroom-atmosphere.mp4, online-atmosphere.mp4 (~15 min)
```

Both scripts **reset the room**. Use them only against the local server (default `BASE_URL=http://localhost:8790`).

Requirements: Google Chrome, `ffmpeg`, Python 3 with `numpy`, and `npm install` (for `playwright-core` and `ws`).
The host key is read from `.dev.vars`.

| File | What it does |
|---|---|
| `paths.mjs` | Shared paths; temporary files go to `scripts/media/.work/` (git-ignored) |
| `reset.mjs` | Resets the room over the WebSocket |
| `bots.mjs` | Bot players: join, tap after the green light, answer the gamble and the guess |
| `shots.mjs` | Plays a game and screenshots every phase (big screen 1600×900, phone 390×844 @2×) |
| `win.mjs` | Solo game so the phone is queue #1 → the real winner screen |
| `record.mjs` | Screencasts the big screen + phone during a full game and logs phase/event times |
| `build-clips.py` | Exact 30 fps clips from the frames + the segment plan and captions (edit captions here) |
| `templates.mjs` | Renders the caption/frame template for each video step |
| `soundtrack.py` | Procedural music + sound effects synced to the game moments (no samples) |
| `compose.py` | Builds `how-to-play.mp4` and the projector frames for the classroom video |
| `online.html` + `render-online.mjs` | Online class from home: the presenter's shared screen + participant tiles (generic video-call look, no real app branding; captions in `render-online.mjs`) |
| `classroom.html` + `render-classroom.mjs` | Illustrated classroom with the recorded big screen on the projector (captions in `render-classroom.mjs`) |

When the game's flow or timing changes, update the segment boundaries/captions in `build-clips.py`,
the captions in `render-classroom.mjs` / `render-online.mjs`, and the per-phase reactions in `classroom.html` / `online.html`.
