#!/usr/bin/env node
/**
 * Load test: one host + N simulated players play a full game against a running server.
 *
 *   HOST_KEY=... node scripts/loadtest.mjs [baseUrl] [--players 80]
 *
 *   baseUrl defaults to http://localhost:8790. HOST_KEY defaults to the value in .dev.vars.
 *   ⚠ The test RESETS the room first — never run it against production during class.
 *
 * What it does (the whole timeline runs for real, ~2:15)
 *  - joins N players; the host presses start once
 *  - RACE: most players start tapping 150–900 ms after the green light at ~10/s, batching
 *    cumulative counts every 500 ms (first press after green sent immediately, like the real
 *    client); 2 "early birds" press before the green light (false start); ~10 % never tap
 *  - ~10 % of players disconnect and reconnect (same playerId) during RACE and EVENTS
 *  - EVENTS: about half the players answer "move" to the gamble
 *  - GUESS: every player picks a random answer; players send a few reactions
 *
 * Asserts
 *  - LINEUP queue is a permutation of all players; false starters are at the very back,
 *    non-tappers right before them
 *  - all four events fire; the gamble resolves with lucky + unlucky = movers = players who chose move
 *  - exactly one winner: the host's winner, the only phone with won=true, and queue #1
 *  - every client ends in END
 *  - server tap total equals the sum of per-player acknowledged taps
 *  - ZOOM guess counts equal the answers sent; roomsNeeded matches the formula
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
    this.localTaps = 0;
    this.sentTaps = 0;
    /** Snapshots seen per phase (last one kept). */
    this.byPhase = {};
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
          this.byPhase[this.snap.phase] = this.snap;
          const you = this.snap.you;
          if (you) {
            this.localTaps = Math.max(this.localTaps, you.taps);
            this.sentTaps = Math.max(Math.min(this.sentTaps, this.localTaps), you.taps);
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

  sendTaps() {
    if (this.localTaps > this.sentTaps && this.send({ type: "taps", count: this.localTaps })) this.sentTaps = this.localTaps;
  }

  /** Taps ~10/s from goAt + reaction until raceEndAt; first press sent at once, then 500 ms batches. */
  async race(goAt, raceEndAt) {
    while (this.serverNow() < goAt) await sleep(5);
    await sleep(rand(150, 900));
    let first = true;
    let lastBatch = Date.now();
    while (this.serverNow() < raceEndAt) {
      this.localTaps++;
      if (first) {
        this.sendTaps();
        first = false;
      } else if (Date.now() - lastBatch >= 500) {
        this.sendTaps();
        lastBatch = Date.now();
      }
      await sleep(rand(70, 130));
    }
    await sleep(100);
    this.sendTaps();
  }

  /** False start: one press 1 s before the green light. */
  async earlyBird(goAt) {
    while (this.serverNow() < goAt - 1000) await sleep(5);
    this.localTaps++;
    this.sendTaps();
  }
}

// ------------------------------------------------------------------ assertions
const failures = [];
function check(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`);
    failures.push(label);
  }
}

function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ------------------------------------------------------------------ main
async function main() {
  log(`target ${wsUrl} · ${N} players`);
  const host = new SimClient("host", { host: true });
  await host.connect();
  host.send({ type: "host:reset" });
  await waitFor(() => host.snap?.phase === "LOBBY" && host.snap.joined === 0, 5000, "reset to empty LOBBY");

  const players = Array.from({ length: N }, (_, i) => new SimClient(`p${i}`));
  await Promise.all(players.map((p) => p.connect()));
  players.forEach((p, i) => p.send({ type: "join", nickname: `ผู้เล่น${i}`, emoji: "🐱" }));
  await waitFor(() => players.every((p) => p.snap?.you), 10000, "all players joined");
  log(`joined ${host.live?.joined ?? host.snap.joined}`);

  const early = players.slice(0, 2);
  const idle = players.slice(2, 2 + Math.round(N * 0.1));
  const tappers = players.slice(2 + idle.length);
  const droppers = tappers.filter((_, i) => i % 10 === 3);

  host.send({ type: "host:next" });
  await waitFor(() => host.snap.phase === "INTRO", 5000, "INTRO");
  log("INTRO");
  await waitFor(() => host.snap.phase === "RACE", 15000, "RACE");
  const { goAt, raceEndAt } = host.snap;
  log(`RACE · green in ${goAt - host.serverNow()} ms`);

  const raceJobs = [
    ...early.map((p) => p.earlyBird(goAt)),
    ...tappers.map((p) => p.race(goAt, raceEndAt)),
    ...droppers.map(async (p) => {
      await sleep(goAt - p.serverNow() + 2500);
      await p.dropAndReconnect(rand(200, 800));
    }),
  ];
  await Promise.all(raceJobs);
  await waitFor(() => host.snap.phase === "LINEUP", 5000, "LINEUP");
  log("LINEUP");
  const lineup = host.snap;

  await waitFor(() => host.snap.phase === "EVENTS", 20000, "EVENTS");
  log("EVENTS");
  const movers = new Set();
  // Wait for the gamble, answer, and drop some sockets meanwhile.
  await waitFor(() => host.snap.events.some((e) => e.kind === "gamble"), 15000, "gamble event");
  players.forEach((p, i) => {
    const choice = i % 2 === 0 ? "move" : "stay";
    if (choice === "move") movers.add(p);
    setTimeout(() => p.send({ type: "gamble", choice }), rand(200, 4000));
    if (i % 7 === 0) setTimeout(() => p.send({ type: "react", i: i % 4 }), rand(0, 3000));
  });
  await Promise.all(droppers.map((p) => sleep(rand(0, 2000)).then(() => p.dropAndReconnect(rand(200, 800)))));

  await waitFor(() => host.snap.phase === "CALL", 45000, "CALL");
  log("CALL");
  const call = host.snap;

  await waitFor(() => host.snap.phase === "GUESS", 20000, "GUESS");
  log("GUESS");
  const guesses = [0, 0, 0, 0];
  players.forEach((p) => {
    const c = Math.floor(Math.random() * 4);
    guesses[c]++;
    setTimeout(() => p.send({ type: "guess", choice: c }), rand(100, 5000));
  });

  await waitFor(() => host.snap.phase === "ZOOM", 20000, "ZOOM");
  log("ZOOM");
  const zoom = host.snap;
  await waitFor(() => host.snap.phase === "END", 40000, "END");
  await waitFor(() => players.every((p) => p.snap.phase === "END"), 10000, "all players in END");
  log("END");
  await sleep(500);
  const end = host.snap;

  // ---------------------------------------------------------------- checks
  console.log("\nassertions");
  const q = lineup.queue;
  check(q.length === N && new Set(q.map((e) => e.no)).size === N, "LINEUP queue is a permutation of all players");
  const back = q.slice(-early.length);
  check(back.every((e) => e.foul) && q.filter((e) => e.foul).length === early.length, "false starters (and only they) are at the very back");
  check(lineup.stats.fouls === early.length, "stats.fouls counts the false starters");
  const idleNames = new Set(idle.map((p) => p.snap.you.nickname));
  const idleBlock = q.slice(-(early.length + idle.length), -early.length);
  check(idleBlock.every((e) => idleNames.has(e.nickname)), "non-tappers sit right before the false starters");
  check(lineup.stats.tappers === tappers.length, `every tapper got a valid first tap (${lineup.stats.tappers}/${tappers.length})`);

  check(call.events.length === 4, "all four events fired");
  const g = call.events.find((e) => e.kind === "gamble");
  check(g && g.resolved, "gamble resolved");
  check(g && g.lucky + g.unlucky === g.movers && g.movers === movers.size, `gamble movers = players who chose move (${g?.movers}/${movers.size})`);

  const winners = players.filter((p) => p.snap.you?.won);
  check(winners.length === 1, "exactly one phone has won=true");
  check(!!call.winner && call.queue[0].no === call.winner.no, "winner is queue #1");
  check(winners.length === 1 && winners[0].snap.you.nickname === call.winner.nickname, "phone winner matches the big screen");
  check(!!call.winner?.claimCode && /^\d{3}$/.test(call.winner.claimCode), "host sees a 3-digit claim code");
  check(winners.length === 1 && winners[0].snap.you.claimCode === call.winner.claimCode, "winner phone shows the same claim code");

  const sumTaps = players.reduce((a, p) => a + p.snap.you.taps, 0);
  check(end.totalTaps === sumTaps, `server tap total = sum of player taps (${end.totalTaps} vs ${sumTaps})`);

  check(JSON.stringify(zoom.guess.counts) === JSON.stringify(guesses), `guess counts match (${zoom.guess.counts} vs ${guesses})`);
  check(zoom.guess.correct !== null, "correct guess bucket revealed in ZOOM");
  const expectedRooms = Math.round(100000 / end.config.stats.psychiatristsPer100k / N);
  check(end.roomsNeeded === expectedRooms, `roomsNeeded = ${expectedRooms}`);
  check(players.every((p) => p.snap.phase === "END"), "every player ended in END");

  console.log("\nbroadcast latency (ms)");
  for (const [k, arr] of Object.entries(latency)) {
    const avg = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    console.log(`  ${k.padEnd(6)} n=${arr.length} avg=${avg.toFixed(1)} p50=${pct(arr, 50)} p95=${pct(arr, 95)} max=${pct(arr, 100)}`);
  }
  const unexpected = players.reduce((a, p) => a + p.unexpectedCloses, 0);
  console.log(`  reconnects (planned): ${players.reduce((a, p) => a + p.reconnects, 0)} · unexpected closes: ${unexpected}`);

  host.close();
  players.forEach((p) => p.close());
  if (failures.length) {
    console.log(`\n${failures.length} ASSERTION(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL ASSERTIONS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
