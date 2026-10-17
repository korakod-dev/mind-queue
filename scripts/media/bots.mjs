// Bot players for captures:  join, tap on green, answer gamble + guess. Never reset or advance.
import WebSocket from "ws";
import { WS_URL } from "./paths.mjs";
import { randomUUID } from "node:crypto";
const N = Number(process.argv[2] || 30);
const emojis = ["🐱","🐶","🐼","🦊","🐨","🐯","🐸","🐵","🐧","🐰","🐻","🐹","🦄","🐙","🐢","🦋","🌻","🌈","⭐","🍀","🌸","🍩","🎈","🎧"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(WS_URL);
  let snap = null, off = 0, taps = 0, raced = null, gambled = null, guessed = null;
  ws.on("open", () => { ws.send(JSON.stringify({ type: "hello", playerId: randomUUID() })); ws.send(JSON.stringify({ type: "time", t0: Date.now() })); });
  ws.on("message", async (d) => {
    const t = d.toString(); if (t === "pong") return;
    const m = JSON.parse(t);
    if (m.type === "time") { off = m.serverNow - (m.t0 + (Date.now() - m.t0) / 2); return; }
    if (m.type !== "state") return;
    snap = m.snapshot;
    if (!snap.you) { await sleep(Math.random() * 2000); ws.send(JSON.stringify({ type: "join", nickname: "บอท" + i, emoji: emojis[i % emojis.length] })); return; }
    const now = () => Date.now() + off;
    if (snap.phase === "RACE" && raced !== snap.goAt && snap.pausedAt == null) {
      raced = snap.goAt;
      while (now() < snap.goAt) await sleep(5);
      await sleep(150 + Math.random() * 800);
      while (now() < snap.raceEndAt) { ws.send(JSON.stringify({ type: "taps", count: ++taps })); await sleep(100 + Math.random() * 100); }
    }
    const g = snap.events.find((e) => e.kind === "gamble" && !e.resolved);
    if (g && gambled !== g.at) { gambled = g.at; await sleep(1000 + Math.random() * 3000); ws.send(JSON.stringify({ type: "gamble", choice: Math.random() < 0.45 ? "move" : "stay" })); }
    if (snap.phase === "GUESS" && guessed !== snap.phaseStartAt) { guessed = snap.phaseStartAt; await sleep(1000 + Math.random() * 6000); ws.send(JSON.stringify({ type: "guess", choice: Math.floor(Math.random() * 4) })); }
  });
  setInterval(() => ws.readyState === 1 && ws.send("ping"), 15000);
  setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "time", t0: Date.now() })), 30000);
}
