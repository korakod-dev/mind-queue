/**
 * GameRoom — one Durable Object that holds the entire classroom game.
 *
 * Design notes
 * ------------
 * - Server-authoritative state machine:
 *     LOBBY → TAP_COUNTDOWN → TAP_RACE → TAP_RESULT → WAITING_ROOM → REVEAL → END
 *   The host advances manually; timed phases (countdown, race, waiting room) end on their own.
 * - WebSocket Hibernation API: sockets are accepted with `ctx.acceptWebSocket`, the heartbeat
 *   "ping" → "pong" is answered by the runtime without waking the object, and each socket's
 *   role/playerId lives in its serialized attachment.
 * - Hibernation wipes in-memory state, so the game state is also written to the object's own
 *   SQLite-backed storage (single key "state"): immediately on important events (phase change,
 *   join, draw, reset) and at most once per `config.server.persistMs` for counters.
 *   "Reset" and a 6-hour idle alarm delete everything. No other persistence exists.
 * - Time-based transitions are applied lazily by `tick(now)` at the start of every event
 *   (message or alarm). The alarm is only a wake-up call; correctness never depends on it
 *   firing at an exact millisecond.
 * - Tap-race winner = the first `taps` message (count ≥ 1) that the server processes with
 *   `startAt ≤ now < endAt`. Durable Objects process events one at a time, so arrival order
 *   decides. Client timestamps are never used.
 */
import { DurableObject } from "cloudflare:workers";
import { config, publicConfig } from "./config";
import type { Env } from "./index";
import type {
  ClientMsg,
  LiveMsg,
  Phase,
  Role,
  ServerMsg,
  Snapshot,
  WinKind,
  WinnerView,
  YouView,
} from "./protocol";

// ------------------------------------------------------------------ persisted state

interface PlayerRec {
  id: string;
  nickname: string;
  emoji: string;
  joinedAt: number;
  taps: number;
  pops: number;
  ticket?: number;
  claimCode?: string;
  won?: WinKind;
}

interface GameState {
  v: 1;
  phase: Phase;
  startAt: number | null;
  endAt: number | null;
  waitStartAt: number | null;
  waitEndAt: number | null;
  players: Record<string, PlayerRec>;
  raceWinnerId: string | null;
  /** playerIds picked by cancellation draws, in order. */
  drawIds: string[];
  /** How many of `config.waitingRoom.drawTimes` have fired. */
  drawsFired: number;
  revealStep: number;
  totalTaps: number;
  totalPops: number;
  lastActivity: number;
}

/** Per-socket data that survives hibernation (serializeAttachment). */
interface Attachment {
  role: "pending" | Role;
  pid?: string;
  /** Connect time (ms) — fallback liveness timestamp before the first heartbeat. */
  at: number;
}

const STATE_KEY = "state";
const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_MSG_CHARS = 1024;
const IDLE_WIPE_MS = config.server.idleWipeHours * 3600_000;

function freshState(now: number): GameState {
  return {
    v: 1,
    phase: "LOBBY",
    startAt: null,
    endAt: null,
    waitStartAt: null,
    waitEndAt: null,
    players: {},
    raceWinnerId: null,
    drawIds: [],
    drawsFired: 0,
    revealStep: 0,
    totalTaps: 0,
    totalPops: 0,
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

/** Pick a random unused integer from [min, max]; falls back to a linear scan if crowded. */
function pickUnique(min: number, max: number, used: Set<number>): number | null {
  for (let i = 0; i < 64; i++) {
    const n = randInt(min, max);
    if (!used.has(n)) return n;
  }
  for (let n = min; n <= max; n++) if (!used.has(n)) return n;
  return null;
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
  /** Last "now calling" number that was broadcast (to detect increments). */
  private lastCalledSent: number | null = null;
  /** Cached alarm time; `undefined` = unknown (read from storage). */
  private alarmAt: number | null | undefined = undefined;
  private lastPruneAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<GameState>(STATE_KEY);
      this.state = saved && saved.v === 1 ? saved : freshState(Date.now());
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
    if (this.nextGameEventAt(now) === null && now - this.state.lastActivity >= IDLE_WIPE_MS) {
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
      ws.serializeAttachment({ role: "host", at: att.at } satisfies Attachment);
      this.rosterSentVersion = -1; // make sure the new host gets the roster
      this.sendState(ws, "host", undefined, now);
      this.markLive();
      return;
    }

    if (typeof msg.playerId !== "string" || !PLAYER_ID_RE.test(msg.playerId)) {
      ws.close(4000, "bad player id");
      return;
    }
    ws.serializeAttachment({ role: "player", pid: msg.playerId, at: att.at } satisfies Attachment);
    this.sendState(ws, "player", msg.playerId, now);
    this.markLive();
  }

  private onPlayerMsg(ws: WebSocket, pid: string, msg: ClientMsg, now: number) {
    const s = this.state;
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
        const existing = s.players[pid];
        if (existing) {
          // Re-join with the same id: allow renaming only in the lobby.
          if (s.phase === "LOBBY") {
            existing.nickname = nickname;
            existing.emoji = msg.emoji;
            this.rosterVersion++;
          }
        } else {
          const p: PlayerRec = { id: pid, nickname, emoji: msg.emoji, joinedAt: now, taps: 0, pops: 0 };
          s.players[pid] = p;
          // Late joiner past the race gets a queue ticket right away.
          if (this.phaseIndex(s.phase) >= this.phaseIndex("TAP_RESULT")) this.assignTicket(p);
          this.rosterVersion++;
        }
        this.persistSoon(true);
        this.markLive();
        this.sendStateToPid(pid, now);
        return;
      }

      case "taps": {
        const p = s.players[pid];
        if (!p || s.startAt === null || s.endAt === null) return;
        if (now < s.startAt || now > s.endAt + config.server.tapGraceMs) return; // too early / too late
        let count = Math.floor(Number(msg.count));
        if (!(count >= 1)) return;
        // Anti-script cap based on elapsed race time.
        const elapsedSec = (Math.min(now, s.endAt) - s.startAt) / 1000;
        count = Math.min(count, Math.ceil((elapsedSec + 1) * config.server.maxTapsPerSec));
        if (count > p.taps) {
          s.totalTaps += count - p.taps;
          p.taps = count;
          this.persistSoon(false);
          this.markLive();
        }
        // First valid tap wins. Not announced until TAP_RESULT so everyone keeps tapping.
        if (s.raceWinnerId === null && now < s.endAt && !p.won) {
          s.raceWinnerId = pid;
          p.won = "race";
          p.claimCode = this.newClaimCode();
          this.persistSoon(true);
        }
        return;
      }

      case "pops": {
        const p = s.players[pid];
        if (!p || s.waitStartAt === null) return;
        if (s.phase !== "WAITING_ROOM" && s.phase !== "REVEAL") return;
        let count = Math.floor(Number(msg.count));
        if (!(count >= 0)) return;
        const until = s.waitEndAt !== null ? Math.min(now, s.waitEndAt) : now;
        const elapsedSec = Math.max(0, (until - s.waitStartAt) / 1000);
        count = Math.min(count, Math.ceil((elapsedSec + 2) * config.server.maxPopsPerSec));
        if (count > p.pops) {
          s.totalPops += count - p.pops;
          p.pops = count;
          this.persistSoon(false);
          this.markLive();
        }
        return;
      }

      default:
        return; // host messages from players are ignored
    }
  }

  private async onHostMsg(msg: ClientMsg, now: number) {
    const s = this.state;
    switch (msg.type) {
      case "host:next":
        switch (s.phase) {
          case "LOBBY":
            s.phase = "TAP_COUNTDOWN";
            // Small lead so the snapshot reaches phones before the 3-2-1 visibly starts.
            s.startAt = now + config.countdownSeconds * 1000 + 400;
            s.endAt = s.startAt + config.tapRaceSeconds * 1000;
            this.phaseChanged();
            break;
          case "TAP_RESULT":
            s.phase = "WAITING_ROOM";
            s.waitStartAt = now;
            s.waitEndAt = now + config.waitingRoom.durationSec * 1000;
            s.drawsFired = 0;
            this.phaseChanged();
            break;
          case "WAITING_ROOM":
            // Host may end the waiting room early.
            this.enterReveal(now);
            break;
          case "REVEAL":
            if (s.revealStep < 3) {
              s.revealStep++;
            } else {
              s.phase = "END";
            }
            this.phaseChanged();
            break;
          default:
            // TAP_COUNTDOWN / TAP_RACE are timed; END is final.
            break;
        }
        return;

      case "host:draw":
        if (s.phase === "WAITING_ROOM") this.doDraw(now);
        return;

      case "host:reset":
        await this.wipe(now);
        return;

      default:
        return;
    }
  }

  // ---------------------------------------------------------------- state machine

  private static readonly PHASES: Phase[] = [
    "LOBBY", "TAP_COUNTDOWN", "TAP_RACE", "TAP_RESULT", "WAITING_ROOM", "REVEAL", "END",
  ];

  private phaseIndex(p: Phase): number {
    return GameRoom.PHASES.indexOf(p);
  }

  /** Apply every time-based transition that is due at `now`. */
  private tick(now: number) {
    const s = this.state;

    if (s.phase === "TAP_COUNTDOWN" && s.startAt !== null && now >= s.startAt) {
      s.phase = "TAP_RACE";
      this.phaseChanged();
    }

    if (s.phase === "TAP_RACE" && s.endAt !== null && now >= s.endAt) {
      s.phase = "TAP_RESULT";
      // Everyone who did not win gets a queue ticket.
      for (const p of Object.values(s.players)) if (!p.won) this.assignTicket(p);
      this.phaseChanged();
    }

    if (s.phase === "WAITING_ROOM" && s.waitStartAt !== null && s.waitEndAt !== null) {
      const times = config.waitingRoom.drawTimes;
      while (s.drawsFired < times.length && now >= s.waitStartAt + times[s.drawsFired] * 1000) {
        s.drawsFired++;
        this.doDraw(now);
      }
      if (now >= s.waitEndAt) {
        this.enterReveal(s.waitEndAt);
      } else {
        const called = this.calledAt(now);
        if (called !== this.lastCalledSent) this.stateChanged = true;
      }
    }
  }

  private enterReveal(at: number) {
    const s = this.state;
    s.waitEndAt = Math.min(s.waitEndAt ?? at, at);
    s.phase = "REVEAL";
    s.revealStep = 0;
    this.phaseChanged();
  }

  private phaseChanged() {
    this.stateChanged = true;
    this.persistSoon(true);
  }

  /** Cancellation draw: random ticket holder who has not won yet, preferring connected players. */
  private doDraw(now: number) {
    const s = this.state;
    const candidates = Object.values(s.players).filter((p) => p.ticket !== undefined && !p.won);
    if (candidates.length === 0) return;
    const online = this.onlinePlayerIds(now);
    const connected = candidates.filter((p) => online.has(p.id));
    const pool = connected.length > 0 ? connected : candidates;
    const pick = pool[randInt(0, pool.length - 1)];
    pick.won = "draw";
    pick.claimCode = this.newClaimCode();
    s.drawIds.push(pick.id);
    this.stateChanged = true;
    this.persistSoon(true);
  }

  private assignTicket(p: PlayerRec) {
    if (p.ticket !== undefined) return;
    const used = new Set<number>();
    for (const q of Object.values(this.state.players)) if (q.ticket !== undefined) used.add(q.ticket);
    const [min, max] = config.queueNumberRange;
    const n = pickUnique(min, max, used);
    if (n !== null) p.ticket = n;
  }

  private newClaimCode(): string {
    const used = new Set<number>();
    for (const q of Object.values(this.state.players)) if (q.claimCode) used.add(Number(q.claimCode));
    const [min, max] = config.claimCodeRange;
    return String(pickUnique(min, max, used) ?? randInt(min, max));
  }

  /** "Now calling" number at time t (frozen once the waiting room ends). */
  private calledAt(t: number): number | null {
    const s = this.state;
    if (s.waitStartAt === null) return null;
    const until = s.waitEndAt !== null ? Math.min(t, s.waitEndAt) : t;
    const steps = Math.floor(Math.max(0, until - s.waitStartAt) / (config.waitingRoom.incrementEverySec * 1000));
    return config.waitingRoom.startCalled + steps;
  }

  /** Next time-based event (ms) the alarm must wake us for, or null. */
  private nextGameEventAt(now: number): number | null {
    const s = this.state;
    if (s.phase === "TAP_COUNTDOWN") return s.startAt;
    if (s.phase === "TAP_RACE") return s.endAt;
    if (s.phase === "WAITING_ROOM" && s.waitStartAt !== null && s.waitEndAt !== null) {
      const cands = [s.waitEndAt];
      const times = config.waitingRoom.drawTimes;
      if (s.drawsFired < times.length) cands.push(s.waitStartAt + times[s.drawsFired] * 1000);
      const inc = config.waitingRoom.incrementEverySec * 1000;
      const nextInc = s.waitStartAt + (Math.floor((now - s.waitStartAt) / inc) + 1) * inc;
      cands.push(nextInc);
      return Math.min(...cands);
    }
    return null;
  }

  private async wipe(now: number) {
    this.state = freshState(now);
    this.rosterVersion++;
    this.lastCalledSent = null;
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
    const gameAt = this.nextGameEventAt(now);
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
    this.lastCalledSent = this.calledAt(now);
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
    this.send(ws, { type: "state", serverNow: now, role, snapshot: this.snapshot(role, pid, now) });
  }

  /** Build the snapshot for one recipient. */
  private snapshot(role: Role, pid: string | undefined, now: number): Snapshot {
    const s = this.state;
    const players = Object.values(s.players);
    // The race winner stays secret until TAP_RESULT so everyone keeps tapping.
    const revealWinners = this.phaseIndex(s.phase) >= this.phaseIndex("TAP_RESULT");

    const winners: WinnerView[] = [];
    if (revealWinners) {
      const ids = s.raceWinnerId ? [s.raceWinnerId, ...s.drawIds] : [...s.drawIds];
      for (const id of ids) {
        const p = s.players[id];
        if (!p || !p.won) continue;
        winners.push({
          kind: p.won,
          emoji: p.emoji,
          nickname: p.nickname,
          ticket: p.ticket,
          claimCode: role === "host" ? p.claimCode : undefined,
        });
      }
    }

    const called = this.calledAt(now);
    let queueAhead: number | null = null;
    if (called !== null) {
      let minTicket = Infinity;
      for (const p of players) if (p.ticket !== undefined && !p.won && p.ticket < minTicket) minTicket = p.ticket;
      if (minTicket !== Infinity) queueAhead = Math.max(0, minTicket - called);
    }

    const peoplePerPsychiatrist = 100000 / config.stats.psychiatristsPer100k;
    const joined = players.length;

    const snap: Snapshot = {
      phase: s.phase,
      config: publicConfig,
      startAt: s.startAt,
      endAt: s.endAt,
      waitStartAt: s.waitStartAt,
      waitEndAt: s.waitEndAt,
      joined,
      totalTaps: s.totalTaps,
      totalPops: s.totalPops,
      called,
      queueAhead,
      winners,
      revealStep: s.revealStep,
      peoplePerPsychiatrist,
      roomsNeeded: joined > 0 ? Math.round(peoplePerPsychiatrist / joined) : null,
    };

    if (role === "host") {
      snap.roster = players
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ emoji: p.emoji, nickname: p.nickname }));
    } else {
      const p = pid ? s.players[pid] : undefined;
      if (!p) {
        snap.you = null;
      } else {
        const you: YouView = { nickname: p.nickname, emoji: p.emoji, ticket: p.ticket, taps: p.taps, pops: p.pops };
        if (revealWinners && p.won) {
          you.won = p.won;
          you.claimCode = p.claimCode;
        }
        snap.you = you;
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
    if (hosts.length === 0) return;
    const msg: LiveMsg = {
      type: "live",
      serverNow: now,
      joined: Object.keys(s.players).length,
      connected: this.onlinePlayerIds(now).size,
      totalTaps: s.totalTaps,
      totalPops: s.totalPops,
    };
    if (this.rosterSentVersion !== this.rosterVersion) {
      this.rosterSentVersion = this.rosterVersion;
      msg.roster = Object.values(s.players)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({ emoji: p.emoji, nickname: p.nickname }));
    }
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
