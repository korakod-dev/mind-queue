/**
 * GameRoom — one Durable Object that holds the entire classroom game ("คิวเดียว 3 นาที").
 *
 * Design notes
 * ------------
 * - Server-authoritative state machine:
 *     LOBBY → INTRO → RACE → LINEUP → EVENTS → CALL → GUESS → ZOOM → END
 *   The host starts the game once; every later phase runs on `config.timeline`. `host:next`
 *   skips the current timed phase.
 * - RACE: a red light, then green at `goAt` (random, known to clients so every phone turns
 *   green at the same server time). A tap that arrives before `goAt − foulGraceMs` is a false
 *   start (sent to the back of the queue). Queue order = arrival order of the first tap after
 *   `goAt`; extra taps only feed the counters. Client timestamps are never used.
 * - EVENTS: four timed queue events (one is a 50/50 gamble players opt into).
 * - CALL: queue #1 (first connected player in the queue) sees the doctor — the only prize.
 * - WebSocket Hibernation API: sockets are accepted with `ctx.acceptWebSocket`, the heartbeat
 *   "ping" → "pong" is answered by the runtime without waking the object, and each socket's
 *   role/playerId lives in its serialized attachment.
 * - Hibernation wipes in-memory state, so the game state is also written to the object's own
 *   SQLite-backed storage (single key "state"): immediately on important events and at most
 *   once per `config.server.persistMs` for counters. "Reset" and a 6-hour idle alarm delete
 *   everything.
 * - Time-based transitions are applied lazily by `tick(now)` at the start of every event
 *   (message or alarm), using each phase's scheduled end as the next phase's start, so the
 *   timeline stays exact even if an alarm fires late.
 */
import { DurableObject } from "cloudflare:workers";
import { config, publicConfig } from "./config";
import type { Env } from "./index";
import type {
  ClientMsg,
  EventKind,
  EventView,
  LineupStats,
  LiveMsg,
  Phase,
  PlayerTag,
  Role,
  ServerMsg,
  Snapshot,
  Urgency,
  YouView,
} from "./protocol";

// ------------------------------------------------------------------ persisted state

interface PlayerRec {
  id: string;
  no: number;
  nickname: string;
  emoji: string;
  joinedAt: number;
  urgency: Urgency;
  taps: number;
  /** Server time + order of the first valid tap after the green light. */
  firstAt: number | null;
  firstSeq: number | null;
  foul: boolean;
  gamble: "move" | "stay" | null;
  guess: number | null;
  claimCode?: string;
}

interface EventRec {
  kind: EventKind;
  at: number;
  decideUntil?: number;
  resolved?: boolean;
  movers?: number;
  lucky?: number;
  unlucky?: number;
  moves: { pid: string; from: number; to: number }[];
}

interface GameState {
  v: 2;
  phase: Phase;
  phaseStartAt: number | null;
  phaseEndAt: number | null;
  goAt: number | null;
  raceEndAt: number | null;
  players: Record<string, PlayerRec>;
  nextNo: number;
  /** playerIds in queue order (LINEUP onwards). */
  queue: string[] | null;
  tapSeq: number;
  eventOrder: EventKind[];
  events: EventRec[];
  winnerId: string | null;
  totalTaps: number;
  lastActivity: number;
}

/** Per-socket data that survives hibernation (serializeAttachment). */
interface Attachment {
  role: "pending" | Role;
  pid?: string;
  /** Last time (ms) this socket sent a message (throttled) — liveness alongside the heartbeat. */
  at: number;
}

const STATE_KEY = "state";
const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MSG_CHARS = 1024;
const IDLE_WIPE_MS = config.server.idleWipeHours * 3600_000;
const PHASES: Phase[] = ["LOBBY", "INTRO", "RACE", "LINEUP", "EVENTS", "CALL", "GUESS", "ZOOM", "END"];

function phaseIndex(p: Phase): number {
  return PHASES.indexOf(p);
}

function freshState(now: number): GameState {
  return {
    v: 2,
    phase: "LOBBY",
    phaseStartAt: null,
    phaseEndAt: null,
    goAt: null,
    raceEndAt: null,
    players: {},
    nextNo: 1,
    queue: null,
    tapSeq: 0,
    eventOrder: [],
    events: [],
    winnerId: null,
    totalTaps: 0,
    lastActivity: now,
  };
}

/** Unbiased random integer in [min, max] using crypto. */
function randInt(min: number, max: number): number {
  const span = max - min + 1;
  const limit = Math.floor(0x1_0000_0000 / span) * span;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % span);
}

/** Fisher–Yates shuffle (in place). */
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Count user-perceived characters (Thai vowel/tone marks belong to their base letter). */
function graphemeCount(s: string): number {
  try {
    let n = 0;
    for (const _ of new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s)) n++;
    return n;
  } catch {
    return Array.from(s).length;
  }
}

function sameSecret(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

function tag(p: PlayerRec): PlayerTag {
  return { no: p.no, emoji: p.emoji, nickname: p.nickname };
}

/** Which guess bucket the real answer falls in. */
function correctBucket(rooms: number): number {
  const b = config.guessBuckets;
  let idx = 0;
  // Each bucket covers "about this many": pick the closest on a log scale.
  let best = Infinity;
  for (let i = 0; i < b.length; i++) {
    const d = Math.abs(Math.log(rooms) - Math.log(b[i]));
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  if (rooms >= b[b.length - 1]) idx = b.length - 1;
  return idx;
}

// ------------------------------------------------------------------ Durable Object

export class GameRoom extends DurableObject<Env> {
  private state!: GameState;

  // In-memory helpers only (safe to lose on hibernation).
  private liveDirty = false;
  private rosterVersion = 0;
  private rosterSentVersion = -1;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDirty = false;
  private lastPersistAt = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set during an event when every socket needs a fresh snapshot. */
  private stateChanged = false;
  /** Cached alarm time; `undefined` = unknown (read from storage). */
  private alarmAt: number | null | undefined = undefined;
  private lastPruneAt = 0;
  private pendingFouls: PlayerTag[] = [];
  private pendingReacts: string[] = [];
  private lastReactAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>(STATE_KEY);
      this.state = saved && saved.v === 2 ? saved : freshState(Date.now());
    });
  }

  // ---------------------------------------------------------------- entry points

  /** WebSocket upgrade (routed here from the Worker). */
  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { role: "pending", at: Date.now() };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MSG_CHARS) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;

    const now = Date.now();
    this.state.lastActivity = now;
    this.tick(now);

    const att = ws.deserializeAttachment() as Attachment;
    // Any message proves the socket is alive (clients resync time every 30 s), so liveness does
    // not depend on the heartbeat timestamp alone. Throttled to keep attachment writes rare.
    if (now - att.at > 10_000) {
      att.at = now;
      ws.serializeAttachment(att);
    }

    if (msg.type === "time") {
      if (typeof msg.t0 === "number") this.send(ws, { type: "time", t0: msg.t0, serverNow: now });
    } else if (msg.type === "hello") {
      this.onHello(ws, att, msg, now);
    } else if (att.role === "host") {
      await this.onHostMsg(msg, now);
    } else if (att.role === "player" && att.pid) {
      this.onPlayerMsg(ws, att.pid, msg, now);
    }

    await this.commit(now);
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try {
      // 1005/1006 are reserved and may not be sent back.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
    this.markLive();
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* ignore */
    }
    this.markLive();
  }

  async alarm(): Promise<void> {
    this.alarmAt = null; // the alarm that woke us is consumed
    const now = Date.now();
    this.tick(now);

    // Idle wipe: nothing timed is pending and nobody has done anything for a long time.
    if (this.nextGameEventAt() === null && now - this.state.lastActivity >= IDLE_WIPE_MS) {
      await this.wipe(now);
    }
    await this.commit(now);
  }

  // ---------------------------------------------------------------- message handlers

  private onHello(ws: WebSocket, att: Attachment, msg: Extract<ClientMsg, { type: "hello" }>, now: number) {
    if (typeof msg.hostKey === "string" && msg.hostKey.length > 0) {
      const key = this.env.HOST_KEY;
      if (!key || !sameSecret(msg.hostKey, key)) {
        this.send(ws, { type: "error", code: "bad_host_key" });
        ws.close(4003, "bad host key");
        return;
      }
      ws.serializeAttachment({ role: "host", at: now } satisfies Attachment);
      this.rosterSentVersion = -1; // make sure the new host gets the roster
      this.sendState(ws, "host", undefined, now);
      this.markLive();
      return;
    }

    if (typeof msg.playerId !== "string" || !PLAYER_ID_RE.test(msg.playerId)) {
      ws.close(4000, "bad player id");
      return;
    }
    ws.serializeAttachment({ role: "player", pid: msg.playerId, at: now } satisfies Attachment);
    this.sendState(ws, "player", msg.playerId, now);
    this.markLive();
  }

  private onPlayerMsg(ws: WebSocket, pid: string, msg: ClientMsg, now: number) {
    const s = this.state;
    const p = s.players[pid];
    switch (msg.type) {
      case "join": {
        const nickname = typeof msg.nickname === "string"
          ? msg.nickname.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
          : "";
        const n = graphemeCount(nickname);
        if (n < 1 || n > config.nicknameMaxChars) {
          this.send(ws, { type: "error", code: "bad_nickname" });
          return;
        }
        if (typeof msg.emoji !== "string" || !config.emojis.includes(msg.emoji)) {
          this.send(ws, { type: "error", code: "bad_emoji" });
          return;
        }
        if (p) {
          // Re-join with the same id: allow renaming only in the lobby.
          if (s.phase === "LOBBY") {
            p.nickname = nickname;
            p.emoji = msg.emoji;
            this.rosterVersion++;
          }
        } else {
          const rec: PlayerRec = {
            id: pid,
            no: s.nextNo++,
            nickname,
            emoji: msg.emoji,
            joinedAt: now,
            urgency: randInt(1, 3) as Urgency,
            taps: 0,
            firstAt: null,
            firstSeq: null,
            foul: false,
            gamble: null,
            guess: null,
          };
          s.players[pid] = rec;
          // Late joiner: "มาสาย ต่อท้ายคิว".
          if (s.queue) {
            s.queue.push(pid);
            this.stateChanged = true; // host queue view changes
          }
          this.rosterVersion++;
        }
        this.persistSoon(true);
        this.markLive();
        this.sendStateToPid(pid, now);
        return;
      }

      case "taps": {
        if (!p || s.phase !== "RACE" || s.goAt === null || s.raceEndAt === null || s.phaseStartAt === null) return;
        if (now < s.phaseStartAt) return;
        let count = Math.floor(Number(msg.count));
        if (!(count >= 1)) return;

        if (now < s.goAt - config.foulGraceMs) {
          // False start: straight to the back of the queue.
          if (!p.foul && p.firstSeq === null) {
            p.foul = true;
            this.pendingFouls.push(tag(p));
            this.persistSoon(true);
            this.markLive();
            this.sendStateToPid(pid, now);
          }
          return;
        }
        if (now < s.goAt) return; // inside the grace window: neither a foul nor a tap

        const elapsedSec = (Math.min(now, s.raceEndAt) - s.goAt) / 1000;
        count = Math.min(count, Math.ceil((elapsedSec + 1) * config.server.maxTapsPerSec));
        if (count > p.taps) {
          s.totalTaps += count - p.taps;
          p.taps = count;
          this.persistSoon(false);
          this.markLive();
        }
        if (p.firstSeq === null && !p.foul && now < s.raceEndAt) {
          p.firstAt = now;
          p.firstSeq = ++s.tapSeq;
          this.persistSoon(true);
        }
        return;
      }

      case "gamble": {
        if (!p || s.phase !== "EVENTS") return;
        if (msg.choice !== "move" && msg.choice !== "stay") return;
        const g = this.pendingGamble();
        if (!g || now >= (g.decideUntil ?? 0)) return;
        p.gamble = msg.choice;
        this.persistSoon(true);
        this.sendStateToPid(pid, now);
        return;
      }

      case "guess": {
        if (!p || s.phase !== "GUESS") return;
        const c = Math.floor(Number(msg.choice));
        if (!(c >= 0 && c < config.guessBuckets.length)) return;
        p.guess = c;
        this.persistSoon(false);
        this.markLive();
        this.sendStateToPid(pid, now);
        return;
      }

      case "react": {
        if (!p || s.phase === "LOBBY") return;
        const i = Math.floor(Number(msg.i));
        if (!(i >= 0 && i < config.reactions.length)) return;
        const last = this.lastReactAt.get(pid) ?? 0;
        if (now - last < config.server.reactEveryMs) return;
        this.lastReactAt.set(pid, now);
        if (this.pendingReacts.length < 80) this.pendingReacts.push(config.reactions[i]);
        this.markLive();
        return;
      }

      default:
        return; // host messages from players are ignored
    }
  }

  private async onHostMsg(msg: ClientMsg, now: number) {
    switch (msg.type) {
      case "host:next":
        // LOBBY → start; any timed phase → skip it. END is final.
        if (this.state.phase !== "END") this.advance(now);
        return;
      case "host:reset":
        await this.wipe(now);
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- state machine

  /** Apply every time-based transition that is due at `now`. */
  private tick(now: number) {
    for (let guard = 0; guard < PHASES.length + 1; guard++) {
      const s = this.state;
      if (s.phase === "EVENTS") this.fireDueEvents(Math.min(now, s.phaseEndAt ?? now));
      if (s.phaseEndAt === null || now < s.phaseEndAt) break;
      this.advance(s.phaseEndAt);
    }
  }

  /** Move to the next phase, starting it at `at`. */
  private advance(at: number) {
    const s = this.state;
    const next = PHASES[phaseIndex(s.phase) + 1];
    if (!next) return;
    if (s.phase === "EVENTS") {
      const g = this.pendingGamble();
      if (g) this.resolveGamble(g);
    }
    const T = config.timeline;
    s.phase = next;
    s.phaseStartAt = at;
    switch (next) {
      case "INTRO":
        s.phaseEndAt = at + T.introSec * 1000;
        break;
      case "RACE":
        s.goAt = at + T.leadMs + randInt(T.redLightMs[0], T.redLightMs[1]);
        s.raceEndAt = s.goAt + T.frenzySec * 1000;
        s.phaseEndAt = s.raceEndAt + T.raceTailMs;
        break;
      case "LINEUP":
        this.buildQueue();
        s.phaseEndAt = at + T.lineupSec * 1000;
        break;
      case "EVENTS": {
        const others = shuffle<EventKind>(["docs", "crash", "cancel"]);
        s.eventOrder = [others[0], "gamble", others[1], others[2]];
        s.events = [];
        s.phaseEndAt = at + T.eventsSec * 1000;
        break;
      }
      case "CALL":
        this.pickWinner();
        s.phaseEndAt = at + T.callSec * 1000;
        break;
      case "GUESS":
        s.phaseEndAt = at + T.guessSec * 1000;
        break;
      case "ZOOM":
        s.phaseEndAt = at + T.zoomSec * 1000;
        break;
      case "END":
        s.phaseEndAt = null;
        break;
    }
    this.phaseChanged();
  }

  private phaseChanged() {
    this.stateChanged = true;
    this.persistSoon(true);
  }

  /** Queue = valid tappers by arrival order, then players who never tapped, then false starts. */
  private buildQueue() {
    const s = this.state;
    const all = Object.values(s.players);
    const tappers = all.filter((p) => p.firstSeq !== null && !p.foul).sort((a, b) => a.firstSeq! - b.firstSeq!);
    const idle = shuffle(all.filter((p) => p.firstSeq === null && !p.foul));
    const fouls = shuffle(all.filter((p) => p.foul));
    s.queue = [...tappers, ...idle, ...fouls].map((p) => p.id);
  }

  private pendingGamble(): EventRec | null {
    for (const e of this.state.events) if (e.kind === "gamble" && !e.resolved) return e;
    return null;
  }

  /** Fire events and resolve the gamble in time order, up to time t. */
  private fireDueEvents(t: number) {
    const s = this.state;
    if (s.phaseStartAt === null || !s.queue) return;
    const times = config.events.times;
    for (let guard = 0; guard < times.length * 2; guard++) {
      const i = s.events.length;
      const nextAt = i < times.length ? s.phaseStartAt + times[i] * 1000 : Infinity;
      const g = this.pendingGamble();
      const gAt = g ? g.decideUntil! : Infinity;
      if (Math.min(nextAt, gAt) > t) break;
      if (g && gAt <= nextAt) this.resolveGamble(g);
      else this.fireEvent(s.eventOrder[i], nextAt);
    }
  }

  /** Replace the queue and record the moves of the affected players. */
  private reorder(newQueue: string[], affected: Iterable<string>): EventRec["moves"] {
    const s = this.state;
    const before = new Map(s.queue!.map((id, i) => [id, i + 1]));
    const after = new Map(newQueue.map((id, i) => [id, i + 1]));
    s.queue = newQueue;
    const moves: EventRec["moves"] = [];
    for (const pid of affected) {
      const from = before.get(pid);
      const to = after.get(pid);
      if (from !== undefined && to !== undefined && from !== to) moves.push({ pid, from, to });
    }
    return moves.sort((a, b) => a.from - b.from);
  }

  private fireEvent(kind: EventKind, at: number) {
    const s = this.state;
    const q = s.queue!;
    const ev: EventRec = { kind, at, moves: [] };

    if (kind === "docs") {
      // 📄 Documents incomplete: the front of the queue goes to the back.
      const n = Math.min(config.events.docsBack, Math.floor(q.length / 2));
      if (n >= 1) ev.moves = this.reorder([...q.slice(n), ...q.slice(0, n)], q.slice(0, n));
    } else if (kind === "crash") {
      // 🔀 Queue system crashed: random people swap places.
      const k = Math.min(config.events.crashShuffle, q.length);
      const idx = shuffle(q.map((_, i) => i)).slice(0, k).sort((a, b) => a - b);
      const people = idx.map((i) => q[i]);
      let mixed = shuffle([...people]);
      // Make sure the crash visibly changes something.
      for (let tries = 0; tries < 5 && k > 1 && mixed.every((id, j) => id === people[j]); tries++) mixed = shuffle([...people]);
      const nq = [...q];
      idx.forEach((i, j) => (nq[i] = mixed[j]));
      ev.moves = this.reorder(nq, people);
    } else if (kind === "cancel") {
      // 📞 Someone cancelled: a player from the back half jumps to queue #1 (prefer connected).
      if (q.length >= 2) {
        const back = q.slice(Math.floor(q.length / 2));
        const online = this.onlinePlayerIds(Date.now());
        const pool = back.filter((id) => online.has(id));
        const pick = (pool.length ? pool : back)[randInt(0, (pool.length ? pool : back).length - 1)];
        ev.moves = this.reorder([pick, ...q.filter((id) => id !== pick)], [pick]);
      }
    } else {
      // 🏥 Gamble: a free slot at a far-away hospital. Players opt in on their phones.
      ev.decideUntil = at + config.events.gambleDecideSec * 1000;
      ev.resolved = false;
      for (const p of Object.values(s.players)) p.gamble = null;
    }

    s.events.push(ev);
    this.phaseChanged();
  }

  /** Each player who chose "move" flips a coin: heads → front of the queue, tails → back. */
  private resolveGamble(ev: EventRec) {
    const s = this.state;
    const q = s.queue!;
    const movers = shuffle(q.filter((id) => s.players[id]?.gamble === "move"));
    const lucky: string[] = [];
    const unlucky: string[] = [];
    for (const id of movers) (randInt(0, 1) === 1 ? lucky : unlucky).push(id);
    const set = new Set(movers);
    ev.moves = this.reorder([...lucky, ...q.filter((id) => !set.has(id)), ...unlucky], movers);
    ev.resolved = true;
    ev.movers = movers.length;
    ev.lucky = lucky.length;
    ev.unlucky = unlucky.length;
    this.phaseChanged();
  }

  /** Queue #1 sees the doctor. Skip players with no live connection (they could not claim it). */
  private pickWinner() {
    const s = this.state;
    const q = s.queue ?? [];
    if (q.length === 0) return;
    const online = this.onlinePlayerIds(Date.now());
    const id = q.find((x) => online.has(x)) ?? q[0];
    s.winnerId = id;
    const [min, max] = config.claimCodeRange;
    s.players[id].claimCode = String(randInt(min, max));
  }

  /** Next time-based event (ms) the alarm must wake us for, or null. */
  private nextGameEventAt(): number | null {
    const s = this.state;
    if (s.phaseEndAt === null) return null;
    const cands = [s.phaseEndAt];
    if (s.phase === "EVENTS" && s.phaseStartAt !== null) {
      const times = config.events.times;
      if (s.events.length < times.length) cands.push(s.phaseStartAt + times[s.events.length] * 1000);
      const g = this.pendingGamble();
      if (g) cands.push(g.decideUntil!);
    }
    return Math.min(...cands);
  }

  private async wipe(now: number) {
    this.state = freshState(now);
    this.rosterVersion++;
    this.pendingFouls = [];
    this.pendingReacts = [];
    this.lastReactAt.clear();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.alarmAt = null;
    this.persistDirty = false;
    this.stateChanged = true;
    this.markLive();
  }

  // ---------------------------------------------------------------- end-of-event commit

  /** Broadcast pending snapshots, persist important changes, and re-arm the alarm. */
  private async commit(now: number) {
    if (this.stateChanged) {
      this.stateChanged = false;
      this.broadcastState(now);
    }
    await this.scheduleAlarm(now);
  }

  /**
   * Keep exactly one alarm armed:
   *  - a timed game event is pending → alarm at that exact time;
   *  - otherwise → the idle-wipe deadline. An already-armed earlier alarm is left alone:
   *    when it fires, `alarm()` sees recent activity and re-arms for the new deadline.
   */
  private async scheduleAlarm(now: number) {
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    const gameAt = this.nextGameEventAt();
    let want: number | null = null;
    if (gameAt !== null) {
      if (this.alarmAt !== gameAt) want = gameAt;
    } else if (this.alarmAt === null) {
      want = this.state.lastActivity + IDLE_WIPE_MS;
    }
    if (want === null) return;
    want = Math.max(want, now + 10);
    await this.ctx.storage.setAlarm(want);
    this.alarmAt = want;
  }

  /**
   * Persist the state. `important` writes right away; counters are throttled to one write per
   * `persistMs`. Unawaited writes are fine: the output gate holds outgoing messages until the
   * write is durable.
   */
  private persistSoon(important: boolean) {
    this.persistDirty = true;
    const now = Date.now();
    if (important || now - this.lastPersistAt >= config.server.persistMs) {
      this.persistNow();
    } else if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        if (this.persistDirty) this.persistNow();
      }, config.server.persistMs - (now - this.lastPersistAt));
    }
  }

  private persistNow() {
    this.persistDirty = false;
    this.lastPersistAt = Date.now();
    void this.ctx.storage.put(STATE_KEY, this.state);
  }

  // ---------------------------------------------------------------- outgoing messages

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }

  private sockets(): { ws: WebSocket; att: Attachment }[] {
    const out: { ws: WebSocket; att: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) out.push({ ws, att });
    }
    return out;
  }

  private broadcastState(now: number) {
    for (const { ws, att } of this.sockets()) {
      if (att.role === "host") this.sendState(ws, "host", undefined, now);
      else if (att.role === "player") this.sendState(ws, "player", att.pid, now);
    }
  }

  private sendStateToPid(pid: string, now: number) {
    for (const { ws, att } of this.sockets()) {
      if (att.role === "player" && att.pid === pid) this.sendState(ws, "player", pid, now);
    }
  }

  private sendState(ws: WebSocket, role: Role, pid: string | undefined, now: number) {
    this.send(ws, { type: "state", serverNow: now, role, snapshot: this.snapshot(role, pid) });
  }

  private guessCounts(): number[] {
    const counts = config.guessBuckets.map(() => 0);
    for (const p of Object.values(this.state.players)) if (p.guess !== null) counts[p.guess]++;
    return counts;
  }

  /** Build the snapshot for one recipient. */
  private snapshot(role: Role, pid: string | undefined): Snapshot {
    const s = this.state;
    const players = Object.values(s.players);
    const idx = phaseIndex(s.phase);
    const pos = new Map<string, number>();
    if (s.queue) s.queue.forEach((id, i) => pos.set(id, i + 1));

    const urgencyCounts: [number, number, number] = [0, 0, 0];
    for (const p of players) urgencyCounts[p.urgency - 1]++;

    let stats: LineupStats | null = null;
    if (idx >= phaseIndex("LINEUP") && s.goAt !== null) {
      const tappers = players.filter((p) => p.firstSeq !== null && !p.foul).sort((a, b) => a.firstSeq! - b.firstSeq!);
      const f = tappers[0];
      let most: PlayerRec | null = null;
      for (const p of players) if (p.taps > 0 && (!most || p.taps > most.taps)) most = p;
      stats = {
        fastest: f ? { ...tag(f), ms: f.firstAt! - s.goAt, pos: pos.get(f.id) ?? 0 } : null,
        mostTaps: most ? { ...tag(most), taps: most.taps, pos: pos.get(most.id) ?? 0 } : null,
        totalTaps: s.totalTaps,
        tappers: tappers.length,
        fouls: players.filter((p) => p.foul).length,
      };
    }

    const winRec = idx >= phaseIndex("CALL") && s.winnerId ? s.players[s.winnerId] : undefined;
    let waiting: [number, number, number] | null = null;
    if (idx >= phaseIndex("CALL")) {
      waiting = [0, 0, 0];
      for (const p of players) if (p.id !== s.winnerId) waiting[p.urgency - 1]++;
    }

    const events: EventView[] = s.events.map((e) => ({
      kind: e.kind,
      at: e.at,
      decideUntil: e.decideUntil,
      resolved: e.resolved,
      movers: e.movers,
      lucky: e.lucky,
      unlucky: e.unlucky,
      moves: role === "host"
        ? e.moves.slice(0, 10).flatMap((m) => {
          const p = s.players[m.pid];
          return p ? [{ ...tag(p), from: m.from, to: m.to }] : [];
        })
        : [],
    }));

    const peoplePerPsychiatrist = 100000 / config.stats.psychiatristsPer100k;
    const joined = players.length;
    const roomsNeeded = joined > 0 ? Math.round(peoplePerPsychiatrist / joined) : null;
    const showGuess = idx >= phaseIndex("ZOOM");

    const snap: Snapshot = {
      phase: s.phase,
      config: publicConfig,
      phaseStartAt: s.phaseStartAt,
      phaseEndAt: s.phaseEndAt,
      goAt: s.goAt,
      raceEndAt: s.raceEndAt,
      joined,
      totalTaps: s.totalTaps,
      urgencyCounts,
      events,
      stats,
      winner: winRec
        ? {
          ...tag(winRec),
          pos: pos.get(winRec.id) ?? 1,
          urgency: winRec.urgency,
          claimCode: role === "host" ? winRec.claimCode : undefined,
        }
        : null,
      waiting,
      guess: {
        answered: players.filter((p) => p.guess !== null).length,
        counts: showGuess ? this.guessCounts() : null,
        correct: showGuess && roomsNeeded !== null ? correctBucket(roomsNeeded) : null,
      },
      peoplePerPsychiatrist,
      roomsNeeded,
    };

    if (role === "host") {
      snap.roster = players
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ emoji: p.emoji, nickname: p.nickname }));
      if (s.queue) {
        snap.queue = s.queue.flatMap((id) => {
          const p = s.players[id];
          return p ? [{ ...tag(p), urgency: p.urgency, foul: p.foul }] : [];
        });
      }
    } else {
      const p = pid ? s.players[pid] : undefined;
      if (!p) {
        snap.you = null;
      } else {
        const moves: YouView["moves"] = [];
        s.events.forEach((e, slot) => {
          for (const m of e.moves) if (m.pid === p.id) moves.push({ slot, from: m.from, to: m.to });
        });
        const won = !!winRec && winRec.id === p.id;
        snap.you = {
          nickname: p.nickname,
          emoji: p.emoji,
          urgency: p.urgency,
          taps: p.taps,
          foul: p.foul,
          reactionMs: p.firstAt !== null && s.goAt !== null ? p.firstAt - s.goAt : null,
          pos: pos.get(p.id) ?? null,
          gamble: p.gamble,
          guess: p.guess,
          moves,
          won,
          claimCode: won ? p.claimCode : undefined,
        };
      }
    }
    return snap;
  }

  /** Mark live counters dirty; the big screen gets at most one update per `liveBroadcastMs`. */
  private markLive() {
    this.liveDirty = true;
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      if (this.liveDirty) this.broadcastLive();
    }, config.server.liveBroadcastMs);
  }

  private broadcastLive() {
    this.liveDirty = false;
    const now = Date.now();
    const s = this.state;
    const hosts = this.sockets().filter((x) => x.att.role === "host");
    const fouls = this.pendingFouls;
    const reacts = this.pendingReacts;
    this.pendingFouls = [];
    this.pendingReacts = [];
    if (hosts.length === 0) return;
    const msg: LiveMsg = {
      type: "live",
      serverNow: now,
      joined: Object.keys(s.players).length,
      connected: this.onlinePlayerIds(now).size,
      totalTaps: s.totalTaps,
    };
    if (this.rosterSentVersion !== this.rosterVersion) {
      this.rosterSentVersion = this.rosterVersion;
      msg.roster = Object.values(s.players)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ emoji: p.emoji, nickname: p.nickname }));
    }
    if (s.phase === "RACE") {
      msg.top = Object.values(s.players)
        .filter((p) => p.taps > 0)
        .sort((a, b) => b.taps - a.taps)
        .slice(0, 5)
        .map((p) => ({ ...tag(p), taps: p.taps }));
    }
    if (fouls.length) msg.fouls = fouls;
    if (reacts.length) msg.reacts = reacts;
    if (s.phase === "GUESS") msg.guesses = this.guessCounts();
    const text = JSON.stringify(msg);
    for (const { ws } of hosts) {
      try {
        ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * playerIds with at least one live socket. Sockets whose last heartbeat is older than
   * `staleSocketMs` are closed here (dead-socket pruning).
   */
  private onlinePlayerIds(now: number): Set<string> {
    const ids = new Set<string>();
    const prune = now - this.lastPruneAt > 5000;
    if (prune) this.lastPruneAt = now;
    for (const { ws, att } of this.sockets()) {
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const lastSeen = Math.max(lastPing, att.at);
      if (now - lastSeen > config.server.staleSocketMs) {
        if (prune) {
          try {
            ws.close(4008, "heartbeat timeout");
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      if (att.role === "player" && att.pid && this.state.players[att.pid]) ids.add(att.pid);
    }
    return ids;
  }
}
