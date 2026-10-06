#!/usr/bin/env node
/**
 * Load test: one host + N simulated players play a full game against a running server.
 *
 *   HOST_KEY=... node scripts/loadtest.mjs [baseUrl] [--players 80]
 *
 *   baseUrl defaults to http://localhost:8790. HOST_KEY defaults to the value in .dev.vars.
 *   ⚠ The test RESETS the room first — never run it against production during class.
 *
 * What it does
 *  - joins N players, host drives every phase (WAITING_ROOM runs its real 90 s)
 *  - every player taps ~10/s during TAP_RACE, batching cumulative counts every 500 ms
 *    (first tap sent immediately), exactly like the real client
 *  - one "early bird" sends a tap before startAt and then stops (must be ignored)
 *  - ~10 % of players disconnect and reconnect (same playerId) mid-race / mid-waiting-room
 *  - pops bubbles during WAITING_ROOM; host also triggers one manual draw
 *
 * Asserts
 *  - exactly one tap-race winner; early tap ignored
 *  - every non-winner has a ticket, all tickets unique and in range
 *  - draws never pick the race winner and never repeat; claim codes unique
 *  - every client ends in END with the same winners list as the host
 *  - server tap/pop totals equal the sum of per-player acknowledged counts
 *  - roomsNeeded matches the formula
 * Prints broadcast latency (server send time → client receive, clock-offset corrected).
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ------------------------------------------------------------------ args
const args = process.argv.slice(2);
let baseUrl = "http://localhost:8790";
let N = 80;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--players") N = Number(args[++i]);
  else if (!args[i].startsWith("--")) baseUrl = args[i];
}
let HOST_KEY = process.env.HOST_KEY;
if (!HOST_KEY) {
  try {
    HOST_KEY = /HOST_KEY=(.*)/.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1]?.trim();
  } catch {
    /* no .dev.vars */
  }
}
if (!HOST_KEY) {
  console.error("HOST_KEY is required (env var or .dev.vars)");
  process.exit(2);
}
const wsUrl = baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...m);

async function waitFor(pred, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

// ------------------------------------------------------------------ latency stats
const latency = { state: [], live: [] };

// ------------------------------------------------------------------ simulated client
class SimClient {
  constructor(name, { host = false } = {}) {
    this.name = name;
    this.host = host;
    this.pid = randomUUID();
    this.ws = null;
    this.snap = null;
    this.live = null;
    this.offset = 0;
    this.samples = [];
    this.closedByUs = false;
    this.unexpectedCloses = 0;
    this.reconnects = 0;
    // game-side counters (cumulative, like the real client)
    this.localTaps = 0;
    this.sentTaps = 0;
    this.localPops = 0;
    this.sentPops = 0;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      this.closedByUs = false;
      let gotState = false;
      const timer = setTimeout(() => reject(new Error(`${this.name}: no snapshot within 15s`)), 15000);

      ws.on("open", () => {
        this.send(this.host ? { type: "hello", hostKey: HOST_KEY } : { type: "hello", playerId: this.pid });
        for (const d of [0, 100, 200, 400, 700]) setTimeout(() => this.send({ type: "time", t0: Date.now() }), d);
        this.pingTimer = setInterval(() => this.sendRaw("ping"), 15000);
      });

      ws.on("message", (data) => {
        const recv = Date.now();
        const text = data.toString();
        if (text === "pong") return;
        const msg = JSON.parse(text);
        if (msg.type === "time") {
          const rtt = recv - msg.t0;
          this.samples.push({ rtt, offset: msg.serverNow - (msg.t0 + rtt / 2) });
          this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
          return;
        }
        if (msg.type === "state") {
          if (this.samples.length >= 3) latency.state.push(recv + this.offset - msg.serverNow);
          this.snap = msg.snapshot;
          const you = this.snap.you;
          if (you) {
            // reconcile with the server's acknowledged counts (same logic as player.js)
            this.localTaps = Math.max(this.localTaps, you.taps);
            this.sentTaps = Math.max(Math.min(this.sentTaps, this.localTaps), you.taps);
            this.localPops = Math.max(this.localPops, you.pops);
            this.sentPops = Math.max(Math.min(this.sentPops, this.localPops), you.pops);
          }
          if (!gotState) {
            gotState = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (msg.type === "live") {
          if (this.samples.length >= 3) latency.live.push(recv + this.offset - msg.serverNow);
          this.live = msg;
        } else if (msg.type === "error") {
          log(`${this.name} got error`, msg.code);
        }
      });

      ws.on("close", () => {
        clearInterval(this.pingTimer);
        if (!this.closedByUs) {
          this.unexpectedCloses++;
          // behave like the real client: reconnect with backoff
          setTimeout(() => this.connect().catch(() => {}), rand(300, 1500));
        }
      });
      ws.on("error", () => {});
    });
  }

  sendRaw(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
      return true;
    }
    return false;
  }

  send(obj) {
    return this.sendRaw(JSON.stringify(obj));
  }

  /** Simulate a network drop + page refresh: kill the socket, come back with the same playerId. */
  async dropAndReconnect(downMs) {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    this.ws.terminate();
    await sleep(downMs);
    this.reconnects++;
    await this.connect();
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  // ---- gameplay

  sendTaps() {
    if (this.localTaps > this.sentTaps && this.send({ type: "taps", count: this.localTaps })) this.sentTaps = this.localTaps;
  }

  /** ~10 taps/s between startAt and endAt; batch every 500 ms; first tap immediately. */
  async race(startAt, endAt) {
    while (this.serverNow() < startAt) await sleep(5);
    await sleep(rand(0, 300)); // human reaction time
    let first = true;
    let lastBatch = Date.now();
    while (this.serverNow() < endAt) {
      this.localTaps++;
      if (first) {
        first = false;
        this.sendTaps();
        lastBatch = Date.now();
      } else if (Date.now() - lastBatch >= 500) {
        this.sendTaps();
        lastBatch = Date.now();
      }
      await sleep(rand(70, 130));
    }
    this.sendTaps(); // final batch (server accepts a short grace period)
    await sleep(600);
    this.sendTaps();
  }

  /** Pop ~2 bubbles/s, send cumulative count every 2 s, until `until()` is true. */
  async popBubbles(until) {
    let lastSend = Date.now();
    while (!until()) {
      if (Math.random() < 0.6) this.localPops++;
      if (Date.now() - lastSend >= 2000) {
        if (this.localPops > this.sentPops && this.send({ type: "pops", count: this.localPops })) this.sentPops = this.localPops;
        lastSend = Date.now();
      }
      await sleep(rand(250, 400));
    }
    if (this.localPops > this.sentPops && this.send({ type: "pops", count: this.localPops })) this.sentPops = this.localPops;
  }
}

// ------------------------------------------------------------------ assertions
const failures = [];
function check(cond, label) {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    console.log(`  ✘ ${label}`);
    failures.push(label);
  }
}

function stats(arr) {
  if (!arr.length) return "n/a";
  const s = [...arr].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `n=${s.length}  avg=${avg.toFixed(1)}ms  p50=${p(0.5).toFixed(1)}ms  p95=${p(0.95).toFixed(1)}ms  max=${s[s.length - 1].toFixed(1)}ms`;
}

// ------------------------------------------------------------------ scenario
async function main() {
  log(`target ${wsUrl}  players=${N}`);

  // 1. host connects and resets the room
  const host = new SimClient("host", { host: true });
  await host.connect();
  host.send({ type: "host:reset" });
  await waitFor(() => host.snap?.phase === "LOBBY" && host.snap.joined === 0, 5000, "reset → LOBBY");
  log("room reset");

  // 2. players connect + join (staggered like a class scanning a QR code)
  const players = Array.from({ length: N }, (_, i) => new SimClient(`p${i}`));
  await Promise.all(
    players.map(async (p, i) => {
      await sleep(i * 15);
      await p.connect();
      const emojis = p.snap.config.emojis;
      p.send({ type: "join", nickname: `บอท${i}`, emoji: emojis[i % emojis.length] });
    }),
  );
  await waitFor(() => (host.live?.joined ?? host.snap.joined) === N, 15000, `${N} joined`);
  await waitFor(() => players.every((p) => p.snap?.you), 10000, "all players have `you`");
  log(`${N} players joined`);

  // early bird: sends a tap before startAt, then never taps again
  const early = players[N - 1];

  // 10% flaky players
  const flakyCount = Math.max(1, Math.round(N * 0.1));
  const flaky = [...players.slice(0, N - 1)].sort(() => Math.random() - 0.5).slice(0, flakyCount);
  const raceFlaky = flaky.slice(0, Math.ceil(flakyCount / 2));
  const waitFlaky = flaky.slice(Math.ceil(flakyCount / 2));

  // 3. countdown + race
  host.send({ type: "host:next" });
  await waitFor(() => players.every((p) => p.snap.phase === "TAP_COUNTDOWN" || p.snap.phase === "TAP_RACE"), 5000, "countdown");
  const { startAt, endAt } = host.snap;
  log(`countdown started (race in ${((startAt - host.serverNow()) / 1000).toFixed(1)}s)`);

  const earlyDone = (async () => {
    while (early.serverNow() < startAt - 400) await sleep(5);
    early.send({ type: "taps", count: 1 }); // must be ignored (too early)
  })();
  const racing = players.filter((p) => p !== early).map((p) => p.race(startAt, endAt));
  const raceDrops = raceFlaky.map(async (p) => {
    while (p.serverNow() < startAt + rand(1500, 6000)) await sleep(20);
    await p.dropAndReconnect(rand(400, 2000));
  });
  await Promise.all([earlyDone, ...racing, ...raceDrops]);
  await waitFor(() => host.snap.phase === "TAP_RESULT", 5000, "TAP_RESULT");
  log(`race over — host total taps ${host.live?.totalTaps ?? host.snap.totalTaps}`);
  await sleep(1500);

  // 4. waiting room (real 90 s) with pops, drops and one manual draw
  host.send({ type: "host:next" });
  await waitFor(() => host.snap.phase === "WAITING_ROOM", 5000, "WAITING_ROOM");
  log("waiting room started (90 s)");
  const inWaiting = () => host.snap.phase !== "WAITING_ROOM";
  const popping = players.map((p) => p.popBubbles(inWaiting));
  const waitDrops = waitFlaky.map(async (p) => {
    await sleep(rand(5000, 75000));
    await p.dropAndReconnect(rand(1000, 3000));
  });
  const manualDraw = (async () => {
    await sleep(45000);
    host.send({ type: "host:draw" });
    log("host triggered a manual draw");
  })();
  let lastDraws = 0;
  const drawWatch = (async () => {
    while (!inWaiting()) {
      const d = host.snap.winners.filter((w) => w.kind === "draw");
      if (d.length > lastDraws) {
        lastDraws = d.length;
        log(`draw → ticket ${d.at(-1).ticket} (${d.at(-1).nickname}) code ${d.at(-1).claimCode}`);
      }
      await sleep(100);
    }
  })();
  await waitFor(() => host.snap.phase === "REVEAL", 100000, "REVEAL (auto)");
  await Promise.all([...popping, ...waitDrops, manualDraw, drawWatch]);
  log("waiting room ended automatically → REVEAL");

  // 5. reveal lines + end
  for (let i = 1; i <= 3; i++) {
    await sleep(700);
    host.send({ type: "host:next" });
    await waitFor(() => host.snap.revealStep === i, 5000, `reveal step ${i}`);
  }
  await sleep(700);
  host.send({ type: "host:next" });
  await waitFor(() => players.every((p) => p.snap.phase === "END") && host.snap.phase === "END", 15000, "everyone END");
  await sleep(1500); // let final live/state settle
  log("everyone is in END");

  // ---------------------------------------------------------------- assertions
  console.log("\nAssertions");
  const hs = host.snap;
  const yous = players.map((p) => p.snap.you);

  check(hs.joined === N, `host sees ${N} joined (got ${hs.joined})`);
  check(players.every((p) => p.snap.phase === "END"), "every client ends in END");

  const raceWinners = players.filter((p) => p.snap.you.won === "race");
  check(raceWinners.length === 1, `exactly one tap-race winner (got ${raceWinners.length})`);
  check(hs.winners.filter((w) => w.kind === "race").length === 1, "host shows exactly one race winner");
  // The early bird still holds a ticket, so it may legitimately win a cancellation draw;
  // what matters is that its pre-start tap neither won the race nor counted.
  check(early.snap.you.won !== "race" && early.snap.you.taps === 0, "early tap before startAt was ignored (not race winner, 0 taps counted)");

  const nonWinners = yous.filter((y) => y.won !== "race");
  const tickets = nonWinners.map((y) => y.ticket);
  const [tmin, tmax] = hs.config.queueNumberRange;
  check(tickets.every((t) => Number.isInteger(t)), "every non-winner has a ticket");
  check(new Set(tickets).size === tickets.length, `all ${tickets.length} tickets unique`);
  check(tickets.every((t) => t >= tmin && t <= tmax), `tickets within ${tmin}–${tmax}`);
  check(raceWinners.every((p) => p.snap.you.ticket === undefined), "race winner has no queue ticket");

  const drawPlayers = players.filter((p) => p.snap.you.won === "draw");
  const hostDraws = hs.winners.filter((w) => w.kind === "draw");
  check(hostDraws.length === 3, `3 draws happened (2 scheduled + 1 manual) (got ${hostDraws.length})`);
  check(drawPlayers.length === hostDraws.length, "each host-side draw matches exactly one player phone");
  check(!drawPlayers.some((p) => raceWinners.includes(p)), "draws never picked the race winner");
  check(new Set(hostDraws.map((w) => w.ticket)).size === hostDraws.length, "draws never repeat");
  check(
    hostDraws.every((w) => drawPlayers.some((p) => p.snap.you.ticket === w.ticket && p.snap.you.nickname === w.nickname)),
    "draw tickets/nicknames on host match the winners' phones",
  );

  const codes = hs.winners.map((w) => w.claimCode);
  check(codes.every((c) => /^\d{3}$/.test(c)), "claim codes are 3 digits");
  check(new Set(codes).size === codes.length, "claim codes unique");
  const phoneCodes = [...raceWinners, ...drawPlayers].map((p) => p.snap.you.claimCode);
  check(phoneCodes.every((c) => codes.includes(c)), "winner phones show the same claim codes as the big screen");

  const strip = (ws) => JSON.stringify(ws.map(({ kind, emoji, nickname, ticket }) => ({ kind, emoji, nickname, ticket })));
  check(players.every((p) => strip(p.snap.winners) === strip(hs.winners)), "every phone has the same winners list as the host");
  check(players.every((p) => p.snap.winners.every((w) => w.claimCode === undefined)), "phones never receive other players' claim codes");

  const sumTaps = yous.reduce((a, y) => a + y.taps, 0);
  const sumSent = players.reduce((a, p) => a + p.sentTaps, 0);
  check(hs.totalTaps === sumTaps, `server total taps (${hs.totalTaps}) = sum of per-player taps (${sumTaps}); client-sent ${sumSent}`);
  const sumPops = yous.reduce((a, y) => a + y.pops, 0);
  check(hs.totalPops === sumPops, `server total pops (${hs.totalPops}) = sum of per-player pops (${sumPops})`);

  const expectRooms = Math.round(100000 / hs.config.stats.psychiatristsPer100k / N);
  check(hs.roomsNeeded === expectRooms, `roomsNeeded = ${hs.roomsNeeded} (expected ${expectRooms})`);

  const unexpected = players.reduce((a, p) => a + p.unexpectedCloses, 0) + host.unexpectedCloses;
  const reconnects = players.reduce((a, p) => a + p.reconnects, 0);
  console.log(`\nInfo: ${reconnects} deliberate reconnects, ${unexpected} unexpected socket closes`);
  console.log(`Race winner: ${raceWinners[0]?.snap.you.nickname} (code ${raceWinners[0]?.snap.you.claimCode}); total taps ${hs.totalTaps}`);

  console.log("\nBroadcast latency (server send → client receive)");
  console.log(`  state (full snapshot to every client): ${stats(latency.state)}`);
  console.log(`  live  (throttled counters to host):    ${stats(latency.live)}`);
  console.log("  (clock offsets estimated per client from min-RTT ping; accuracy ±RTT/2)");

  host.close();
  players.forEach((p) => p.close());

  console.log(failures.length ? `\nFAILED: ${failures.length} assertion(s)` : "\nALL ASSERTIONS PASSED");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nLOAD TEST ERROR:", e.message);
  process.exit(1);
});
