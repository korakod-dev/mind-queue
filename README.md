# คิวหน้าห้องจิตแพทย์ — realtime classroom warm-up game

A ~5-minute game for 67 students on their phones, plus a presenter big screen.
Message: *psychiatrists are scarce; getting seen depends on speed and luck, not on who needs it most.*

- **Runtime:** Cloudflare Workers + one Durable Object (`GameRoom`, SQLite-backed, WebSocket Hibernation API)
- **Frontend:** vanilla HTML/CSS/JS in `public/`, served by Workers Static Assets (no build step)
- **Font:** [Prompt](https://fonts.google.com/specimen/Prompt) (Google Fonts, 3 weights; friendly rounded Thai that reads well at weight 800 from the back of the room)

![Classroom atmosphere (illustration)](docs/screenshots/classroom.jpg)

## Screenshots

### Big screen (projector)

| Lobby: scan the QR | Race result + claim code |
|---|---|
| ![Lobby](docs/screenshots/host-lobby.jpg) | ![Result](docs/screenshots/host-result.jpg) |
| **Waiting room: "now calling" board** | **Cancellation draw** |
| ![Waiting room](docs/screenshots/host-waiting.jpg) | ![Draw](docs/screenshots/host-draw.jpg) |
| **Reveal: the real numbers** | **End** |
| ![Reveal](docs/screenshots/host-reveal.jpg) | ![End](docs/screenshots/host-end.jpg) |

### Phones

| Join | Tap race | Queue ticket |
|---|---|---|
| ![Join](docs/screenshots/phone-join.jpg) | ![Tap race](docs/screenshots/phone-tap.jpg) | ![Ticket](docs/screenshots/phone-ticket.jpg) |
| **Bubble pop** | **Breathe together** | **Winner + claim code** |
| ![Bubbles](docs/screenshots/phone-bubbles.jpg) | ![Breathe](docs/screenshots/phone-breathe.jpg) | ![Winner](docs/screenshots/phone-win.jpg) |

### Videos

- [`media/how-to-play.mp4`](media/how-to-play.mp4): how to play from start to finish, using real screens with captions (83 s).
- [`media/classroom-atmosphere.mp4`](media/classroom-atmosphere.mp4): animated preview of the classroom atmosphere for the helper and team (82 s, illustration, not real footage).

Both videos use procedurally generated background music, so there are no copyright issues.

### Game flow

| # | Phase | What happens | Timing |
|---|---|---|---|
| 1 | LOBBY | Everyone scans the QR and picks a nickname + emoji | host advances |
| 2 | TAP_COUNTDOWN → TAP_RACE | 3-2-1, then 10 s of tapping. The **first tap to reach the server wins**; tapping more does not help | automatic |
| 3 | TAP_RESULT | Winner gets a 3-digit claim code; everyone else gets a queue ticket (1,000–2,999) | host advances |
| 4 | WAITING_ROOM | "Now calling #3" crawls up; bubble pop / breathing; random cancellation draws at 30 s and 60 s | 90 s, automatic |
| 5 | REVEAL | Real statistics, one line per click | host advances |
| 6 | END | "ระหว่างรอหมอ… เพื่อนดูแลกันได้ 💛" + hotline 1323; everyone gets a snack | — |

Presenter script and checklists: [`RUNSHEET.th.md`](RUNSHEET.th.md) (Thai). Snack-helper guide: [`helper-guide.html`](helper-guide.html).

## Layout

```
src/index.ts        Worker: /ws → Durable Object "main"; everything else → static assets
src/room.ts         GameRoom Durable Object: state machine, sockets, alarms, persistence
src/protocol.ts     WebSocket message + snapshot types (the protocol reference)
src/config.ts       every number in the game (+ stats source)
public/index.html   player page            public/js/player.js, bubbles.js, confetti.js
public/host.html    big screen (/host)     public/js/host.js
public/js/net.js    reconnecting WebSocket + server-clock sync (shared)
public/js/strings.js  all Thai UI strings
scripts/loadtest.mjs  80-player end-to-end load test
docs/screenshots/   README screenshots
media/              how-to-play + classroom-atmosphere videos
helper-guide.html   snack-helper guide (Thai)
RUNSHEET.th.md      presenter run sheet (Thai)
```

## Routes

| Route | Who | Notes |
|---|---|---|
| `/` | players | join + play |
| `/host?key=HOST_KEY` | presenter | key is moved to `sessionStorage` and removed from the address bar on load |
| `/ws` | both | WebSocket; becomes host only if `hello.hostKey` matches the `HOST_KEY` secret |

Host keys: `Space` / `→` / `PageDown` = next · `D` = cancellation draw · `R` = reset (confirm) · `H` = hide control bar · `F` = fullscreen.

## Setup

Requires Node 18+ (tested with Node 22).

```bash
npm install
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # then put a long random HOST_KEY in it
```

```bash
npm run dev
```

`wrangler dev` listens on `0.0.0.0:8790`, so phones on the same Wi-Fi can open `http://<laptop-LAN-IP>:8790/`.
On the laptop open `http://<laptop-LAN-IP>:8790/host?key=<HOST_KEY>`. Use the LAN IP rather than `localhost` so the QR code points phones at an address they can reach.
(macOS: `ipconfig getifaddr en0` prints the LAN IP.)

Typecheck the Worker:

```bash
npm run typecheck
```

## Deploy

1. Log in once:

   ```bash
   npx wrangler login
   ```

2. Set the host key secret (choose a long random string):

   ```bash
   npx wrangler secret put HOST_KEY
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

### Custom domain

`wrangler.jsonc` contains:

```jsonc
"routes": [{ "pattern": "queue.korakod.dev", "custom_domain": true }]
```

The `korakod.dev` zone must be in the same Cloudflare account. On deploy, Wrangler creates the DNS record and certificate for the subdomain. To use another name, change `pattern` and deploy again. The `*.workers.dev` URL also stays enabled (`workers_dev: true`) as a fallback.

### Cloudflare plan

Durable Objects work on the **Workers Free** plan, but only with the SQLite storage backend (hence `new_sqlite_classes` in the migration). Free limits: 100,000 requests/day, 13,000 GB-s/day duration, 100,000 row writes/day, and 5 GB storage. Incoming WebSocket messages are billed 20:1. One game with 80 phones uses roughly 10k incoming messages (≈500 billed requests) and a few hundred row writes.
Sources: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## How it works (short)

- **Server-authoritative state machine:** `LOBBY → TAP_COUNTDOWN → TAP_RACE → TAP_RESULT → WAITING_ROOM → REVEAL → END`. Timed phases advance on their own: the countdown runs `countdownSeconds`, the race `tapRaceSeconds`, and the waiting room `waitingRoom.durationSec`. Every phase change sends a full per-client snapshot.
- **Race winner:** the first `taps` message the DO processes with `startAt ≤ now < endAt`. Arrival order decides; client timestamps are never trusted. The winner stays hidden until `TAP_RESULT` so everyone keeps tapping.
- **Counters are cumulative:** `taps`/`pops` carry running totals and the server keeps the max per player. Resends after a reconnect are therefore idempotent. The server also caps them at a plausible human rate.
- **Clock sync:** clients measure their offset to the server clock with `time` requests and keep the sample with the lowest RTT. The countdown, timers and breathing circle are drawn from server time.
- **Heartbeat:** clients send the literal `ping` and the runtime answers `pong` without waking the DO. Sockets with no ping for 45 s are closed. A client that gets no traffic for 35 s reconnects (exponential backoff with jitter, plus an immediate retry on tab-visible or `online`).
- **Persistence:** hibernation wipes memory, so the game state is also written to the DO's own storage. Important events are written at once; counters at most once per second. `Reset` deletes everything. After 6 h without activity an alarm wipes the data. Only nickname, emoji, ticket number and counters are stored.
- **Big screen throttling:** live counters go only to the host, at most every 100 ms (≈10/s) and only when something changed.

## Load test

The test **resets the room**. Never run it against production while a class is playing.

```bash
npm run loadtest
```

```bash
HOST_KEY=<prod key> node scripts/loadtest.mjs https://queue.korakod.dev
```

Options: `--players 80` (default 80). Without a `HOST_KEY` env var it reads `.dev.vars`.

It runs one host and N players through a full game. The waiting room runs its real 90 s, so a run takes about 2.5 min. During the run:

- players tap ~10/s with 500 ms batching;
- one "early bird" taps before `startAt`;
- ~10 % of players drop and reconnect mid-race and mid-waiting-room;
- the host triggers one manual draw.

It asserts:

- exactly one winner, and the early tap was ignored;
- tickets are unique and in range;
- draws never pick the winner and never repeat;
- claim codes are unique;
- every client ends in END with the same winners list;
- server totals equal the per-player sums;
- `roomsNeeded` is correct.

It also prints broadcast latency (avg/p50/p95/max). The process exits non-zero if any assertion fails.

## Configuration

All numbers live in `src/config.ts` and reach the clients inside each snapshot. Examples are the race length, the ticket range, waiting-room timing and draw times, and the statistics with their source label. Thai UI text is in `public/js/strings.js`.

The reveal statistic (`psychiatristsPer100k: 1.28`; the source label still says Department of Mental Health, Dec 2022, and must match the figure) **must be re-verified by the presenter before the event.**
