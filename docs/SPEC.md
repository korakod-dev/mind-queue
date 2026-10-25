# Spec: "คิวหน้าห้องจิตแพทย์" — "One Queue, 3 Minutes"

Current specification of the game as built (last aligned with the code on 2026-10-25). It is detailed enough to rebuild the game, and every number below lives in `src/config.ts` (the single source of truth); UI text lives in `public/js/strings.js`.

> This replaces the original build prompt, which described an earlier 5-minute version (tap race, 90 s waiting room with bubbles, three prizes). That version no longer exists.

## 1. Purpose

A self-running ice-breaker (≈2 min 40 s, plus a closing message) played before a presentation about Thailand's shortage of psychiatrists. About 67 students play on their phones while a presenter shows a big screen.

**Core message:** long waits for care → obstacles on the way → too few psychiatrists. Concretely:

1. Waiting for a slot is long, and trying harder (tapping more) does not help.
2. Even when you queue, access hits barriers: missing documents, far-away slots, appointment systems failing, and luck decides who is seen, not who needs it most.
3. One psychiatrist serves the population of over a thousand rooms like ours, because few graduate, workloads are heavy and many leave the public system. Closing question: "Is it time we looked after psychiatrists and kept them in the system?"

While the system is short of doctors, the game ends with players looking after each other (snacks / a "heart snack" card, "how have you been lately?") and the hotline 1323.

**Design constraints**
- Works without an MC hyping the room: the big screen explains, plays sound and reveals the twists from real data. The presenter presses start once.
- Tone: fun and light. Never name, point at or interpret anyone's mental state from the results. Patient cards are **fictional, randomly assigned** characters.
- No unsourced statistics on screen. The only figure is psychiatrists per 100,000 people, with a source label; the presenter must re-verify it before an event.
- One special prize (queue #1). Everyone else gets a snack passed along by friends (classroom) or a digital "ขนมใจ 💛" card (online).

## 2. Tech stack

- **Runtime:** Cloudflare Workers + one Durable Object `GameRoom` (SQLite-backed, WebSocket Hibernation API). Worker entry `src/index.ts`; `/ws` goes to the Durable Object (`idFromName("main")`), everything else is served from `public/` by Workers Static Assets (`run_worker_first: ["/ws"]`).
- **Frontend:** vanilla HTML/CSS/JS in `public/`, no build step. Font Prompt (Google Fonts). QR codes via `qrcodejs` from cdnjs.
- **Config:** `wrangler.jsonc` (name `mind-queue`, migration `new_sqlite_classes: ["GameRoom"]`, Free-plan compatible). Secret `HOST_KEY`. Local dev uses `.dev.vars`.
- **Dev:** `npm run dev` (wrangler on `0.0.0.0:8790`), `npm run typecheck`, `npm run loadtest`, `npm run deploy`.

## 3. Routes and roles

| Route | Who | Notes |
|---|---|---|
| `/` | players | join + play (`public/index.html`, `js/player.js`) |
| `/host?key=HOST_KEY` | presenter | big screen + controls; the key is moved to `sessionStorage` and removed from the address bar |
| `/ws` | both | WebSocket; becomes host only if `hello.hostKey` matches the secret (constant-time compare); without the secret nobody can be host |

Host keys: `Space`/`→`/`PageDown` start (lobby) or skip the current phase · `O` classroom/online mode (lobby) · `P` pause/resume · `M` sound · `R` reset (press twice within 3 s, also the Reset button; no native `confirm()` because some browsers block it) · `H` hide control bar · `F` fullscreen. Any key/click unlocks audio.

## 4. Game flow (server-authoritative state machine)

`LOBBY → INTRO → RACE → LINEUP → EVENTS → CALL → GUESS → ZOOM → END`

After the host starts, every phase runs on a timer. Each phase starts exactly when the previous one was scheduled to end (a late alarm never stretches the timeline). Skipping (`host:next`) jumps to the next phase. Total ≈ 2:40 after start; the END closing message appears 15 s into END.

| Phase | Duration | Big screen | Phone |
|---|---|---|---|
| LOBBY | until host starts | QR, "joined X / 67", emoji wall, mode button | join form → "waiting" |
| INTRO | 10 s | "หมอว่าง 1 คิว · ผู้ป่วย N คน" + counts of 🔴🟡🟢 | patient card flips: 🔴 very urgent / 🟡 medium / 🟢 not urgent (random) |
| RACE | lead 1.2 s + red light 2.5–5 s (random) + green 6 s + 0.7 s tail | red/green light, total taps, top 5 tappers, false starters | red button "รอไฟเขียว" → green "กด!!" |
| LINEUP | 18 s | every emoji lined up at the exam-room door + irony cards | 👆 "ดูจอใหญ่" + small queue number |
| EVENTS | ≈ 54 s | title (4 s), then 4 event cards | 👆 "ดูจอใหญ่"; the gamble is full-screen buttons |
| CALL | 20 s | drum roll → winner + claim code → line recoloured by urgency | winner: gold screen + code; others: summary line |
| GUESS | 12 s | live bar chart of 4 answers | 4 answer buttons |
| ZOOM | 34 s | answer reveal → "our room" tile multiplies into ~1,000+ tiles → statistics + source | 👆 + "1 psychiatrist : N rooms" |
| END | open | warm close (15 s), then the closing message | candy/heart card + closing question |

### 4.1 RACE rules
- `goAt` (green light, server ms) is in the snapshot, so all phones turn green at the same server time (clients sync their clock to the server, lowest-RTT sample).
- A `taps` message arriving earlier than `goAt − 150 ms` is a **false start** → the player goes to the back of the queue and the big screen shows "🚫 ลัดคิว!". Inside the 150 ms grace window a tap is ignored.
- Queue order = **server arrival order of each player's first tap after `goAt`** (and before `raceEndAt`). More taps only feed counters. Client timestamps are never used. Do not tell players that only the first tap counts (the reveal is the twist).
- Counters are cumulative (`taps` carries a running total; server keeps the max); capped at 25 taps/s.

### 4.2 LINEUP
Queue = valid tappers by arrival order, then players who never tapped (shuffled), then false starters (shuffled). Cards appear one by one: fastest player and reaction time → queue #; most taps → their queue # ("most taps did not mean first"); room total taps "but only the first tap of each counted"; number of false starters. Late joiners are appended to the back ("late, back of the queue").

### 4.3 EVENTS
Title "ห้องรอ — มาดูกันว่า กว่าจะได้เข้ารับการรักษาหรือพบจิตแพทย์ ต้องเจออุปสรรคอะไรบ้าง…" (4 s). Four cards; slot 2 is always the gamble, the other three (docs, cancel, crash) are shuffled around it. The server builds each round's timeline from per-kind lengths (`config.events`): docs 10 s, cancel 10 s, crash 8 s, gamble 14 s to choose + 8 s result. Each card also shows an "ในชีวิตจริง:…" line 1.5 s after the card, naming the access barrier it stands for (qualitative only):

| Event | Effect | "In real life" |
|---|---|---|
| 📄 เอกสารไม่ครบ | queue #1..5 (at most half the queue) go to the back | missing referral / rights documents → start over |
| 📞 มีคนยกเลิกนัด | someone from the back half (prefer connected players) jumps to #1 | getting seen earlier by luck, not need |
| 🔀 ระบบคิวล่ม | 10 random people swap places | appointment system fails or reschedules |
| 🏥 มีคิวว่างที่ รพ. ต่างจังหวัด | players opt in on their phones ("ย้าย" / "รอที่เดิม"); each mover flips a coin: heads → front, tails → back | a faster slot may be far away: time, travel cost, leave from work |

The big-screen gamble title adds "(ทุกคนมองที่มือถือ)" so the room looks down at the phones; phones show the plain title. Cards list the first moves (player, from → to); phones show a one-line move for the player. Choosing is accepted only until `decideUntil`.

### 4.4 CALL
Drum roll for 2.6 s, then **queue #1 sees the doctor** (skipping players with no live socket, who could not claim the prize); a 3-digit claim code (100–999) is generated for the winner. The big screen shows "ขอเชิญหมายเลข 1", emoji, nickname, the card colour, the code, and the line recolours by urgency. Summary: "ผู้ได้พบหมอ 🟢 ไม่รีบ · ยังรออยู่: 🔴 ด่วนมาก X คน" (waiting counts exclude the winner). Whatever colour the winner has, the point is the same: speed and luck, not need. The machine voice reads "ขอเชิญหมายเลข N ที่ห้องตรวจค่ะ" when the OS has a Thai voice.

### 4.5 GUESS and ZOOM
Question: "จิตแพทย์ 1 คน ต้องดูแลห้องแบบเรา (N คน) กี่ห้อง?" with buckets ~10 / ~100 / ~500 / 1,000+. Players may change their answer until time is up. The correct bucket is the nearest on a log scale to `roomsNeeded`.

`peoplePerPsychiatrist = 100000 / psychiatristsPer100k` (1.28 → 78,125); `roomsNeeded = round(peoplePerPsychiatrist / joined)` (67 players → 1,166). ZOOM shows the guess results ("N of M guessed right"), then one orange tile ("our room") multiplying into the full number of rooms (capped at ~2,400 tiles with a scale note), then three lines: the 1.28 figure, the 78,125 people = N rooms line, and "การได้พบหมอขึ้นกับความเร็วและโชค… ไม่ใช่ว่าใครต้องการที่สุด", with the source label. The figure is a national average, not a claim that everyone needs a psychiatrist.

### 4.6 END
- **0–15 s:** "ระหว่างรอหมอ… เพื่อนดูแลกันได้ 💛", "ask the person next to you how they've been", the winner's name and code, hotline 1323. Classroom: snacks are passed along each row and the helper gives the special prize after checking the code.
- **After 15 s:** "ทำไมจิตแพทย์ถึงมีน้อย?" with three facts (few new graduates each year; heavy workload pushes many out of the public service; so fewer remain while many people need care), then the question "ถึงเวลาแล้วหรือยัง… ที่เราจะช่วยกันดูแล และรักษาจิตแพทย์ไว้ในระบบต่อไป?", hotline 1323 kept on screen. Phones show the same question under the prize code.

## 5. Modes

### 5.1 Pause
`P` freezes everything on the big screen and phones (timeline, animations, music). The server stores `pausedAt`, ignores taps/gamble/guess meanwhile, arms no game alarm, and on resume shifts every future timestamp (`phaseStartAt/EndAt`, `goAt`, `raceEndAt`, open gamble deadline, first-tap times) by the paused duration. Clients render from `pausedAt` while paused. Skipping a phase also resumes.

### 5.2 Online mode (toggle in the lobby)
For players at home on a shared screen (video call).
- Phones play the key sounds themselves after one tap (green light, drum roll, ding-dong, fanfare).
- Phones reveal the call result and queue moves `online.revealDelayMs` (1.5 s) late so they land with the delayed shared screen. The green light stays on server time, so the race is as fair as in class.
- **Quick shouts** on phones ("ย้ายเลย!", "ไม่ยุติธรรม!", "😭 ถอยไปท้าย", "555+", "ลุ้นนน 🥁", "โห…") appear with the nickname on the big screen; one per player per 1.5 s (server rate limit); online mode only.
- The winner sees a tip to screenshot the code and send it by private chat. The end card is a shareable "ขนมใจ 💛" (Web Share or copy) instead of snacks; the END line on the big screen changes accordingly.
- Classroom mode is unchanged. The mode is a server flag set only in the lobby (`host:online`) and cleared by a reset.

### 5.3 Reactions
Four emoji buttons (😱😂🙏💛) on phones float up the big screen (one per player per 200 ms).

## 6. Players, ordering rules and reliability

- Join: nickname 1–12 user-perceived characters (Thai marks count with their base letter) + one of 24 emojis from the server-validated list (no medical or pill motifs). Rejoining with the same id restores the player; renaming is allowed only in the lobby. Players may join at any phase.
- Each player has a random patient urgency (1–3). It never affects the queue; it is only revealed after the call as the twist.
- **Heartbeat:** clients send literal `ping`, the runtime answers `pong` without waking the Durable Object. A socket with no ping/message for 45 s is treated as offline and closed. Clients reconnect with exponential backoff + jitter (and immediately on tab-visible/online), re-send `hello`, and get a full snapshot; a 30 s clock resync keeps timers honest.
- **Persistence:** state is written to Durable Object storage (immediately on important events, at most once per second for counters), so hibernation or a restart loses nothing. Reset wipes everything; an alarm wipes after 6 h of inactivity. Stored: nickname, emoji, patient card, queue, taps and answers only.
- **Time-based transitions** are applied lazily at the start of every event (message or alarm); the alarm is only a wake-up call.
- **Big-screen throttling:** live counters (joined, online, taps, top tappers, false starts, reactions, shouts, guess counts) go only to the host, at most every 100 ms.
- Capacity target: about 80 simultaneous phones (67 players plus latecomers).

## 7. WebSocket protocol (see `src/protocol.ts`)

JSON text frames. Client → server: `hello {playerId | hostKey}`, `time {t0}`, `join {nickname, emoji}`, `taps {count}`, `gamble {choice}`, `guess {choice}`, `react {i}`, `shout {i}`, and host-only `host:next`, `host:pause`, `host:online {on}`, `host:reset`. Server → client: `state {serverNow, role, snapshot}` (full per-recipient snapshot on every phase change and queue event), `live {…}` (host only, throttled), `time`, `error {code}`. Snapshots carry the public config, phase timing (`phaseStartAt/EndAt`, `goAt`, `raceEndAt`, `pausedAt`), the queue and moves (host) or the player's own `you` view, winner (claim code to the host and the winner only), guess results and the stats-derived numbers.

## 8. Config (`src/config.ts`)

All numbers in one file and sent to clients inside each snapshot (except `server`): `expectedPlayers` 67; `timeline` (introSec 10, leadMs 1200, redLightMs [2500, 5000], frenzySec 6, raceTailMs 700, lineupSec 18, callSec 20, callRevealMs 2600, guessSec 12, zoomSec 34, endSystemAtSec 15); `foulGraceMs` 150; `events` (titleSec 4, cardSec, gambleDecideSec 14, gambleResultSec 8, docsBack 5, crashShuffle 10); `guessBuckets` [10, 100, 500, 1000]; `claimCodeRange` [100, 999]; `stats` (`psychiatristsPer100k` 1.28, `sourceLabel` "ที่มา: กรมสุขภาพจิต (ข้อมูล ธ.ค. 2565)"; verify the figure and its source before use); `nicknameMaxChars` 12; `emojis` (24); `reactions` (4); `online` (revealDelayMs 1500, shouts); `client` (tap batch 500 ms, ping 15 s, dead socket 35 s, reconnect 0.5–10 s, time resync 30 s); server-only tuning (live broadcast 100 ms, persist 1 s, stale socket 45 s, max taps 25/s, reaction 200 ms, shout 1.5 s, idle wipe 6 h).

## 9. UI and design

- Calm, hospital-clean but warm palette (cream, teal, peach/sun accents); phones follow the OS theme, the host page is always light. Big-screen key text ≥ 48 px, readable from the back of a 67-seat room.
- Respect `prefers-reduced-motion`. Phones: large touch targets, no pinch-zoom, vibration where supported with a screen flash fallback (iOS cannot vibrate).
- Phones are **rich only when there is something to do** (join, patient card, race, gamble, guess). In watch phases (LINEUP, EVENTS, CALL, ZOOM) they show a bouncing "👆 ดูจอใหญ่" with a small personal line so eyes go to the big screen; summary one-liners after the call and in the zoom serve players who never look up. Small reaction (and, online, shout) buttons stay at the bottom.
- Big screen: a thin phase progress bar (the game runs by itself), a pause badge, floating reactions, shouts stacking bottom-left, a hideable presenter bar.
- Sound is synthesized with Web Audio (no audio files): background music per phase, tick/whoosh/chime/drum roll/ding-dong/fanfare/crash effects, and Thai text-to-speech for the call when the OS has a Thai voice. Browsers need one gesture before audio can play.
- All UI strings are Thai and live in `public/js/strings.js`; text is built with `textContent` (nicknames are user input).

## 10. Testing

`npm run loadtest` plays a full game with 80 simulated players against a running server (the test **resets the room**; never run it against a deployment in use). It runs the real timeline and asserts:

- the lineup is a permutation of all players, false starters at the very back and non-tappers right before them, and every valid tapper got a first tap;
- online mode on, shouts reach the host exactly once per shouting player (extras inside the rate limit are dropped);
- pause freezes the phase and events, and resume shifts the timeline by the paused time;
- all four events fire, the gamble resolves (lucky + unlucky = movers = players who chose "move");
- exactly one winner: queue #1, the only phone with `won`, with the same claim code as the big screen;
- every client ends in END; server tap total equals the per-player sum; guess counts match the answers; `roomsNeeded` matches the formula.

It also prints broadcast latency and the number of unexpected socket closes (not asserted). Disconnect/reconnect (~10 % of players) is simulated during the race and events.

Before a real session: test on a real iPhone (Safari) and Android (Chrome), check sound on the actual speakers (or the meeting app's shared audio), and re-verify the statistic and its source.

## 11. Deliverables in the repository

`src/` (Worker + Durable Object + protocol + config), `public/` (player page, big screen, JS/CSS), `scripts/loadtest.mjs`, `scripts/media/` (reproducible screenshots and videos from a live local game), `docs/screenshots/`, `media/` (how-to-play, classroom and online clips), `README.md` (setup, local dev, deploy, load test), `RUNSHEET.th.md` (presenter checklist and run sheet, Thai), `MC-SCRIPT.md` (optional MC lines, Thai), `helper-guide.html` (snack helper guide, Thai).
