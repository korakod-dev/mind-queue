/**
 * WebSocket protocol between clients (player phones, host big screen) and the GameRoom Durable Object.
 *
 * Transport notes:
 *  - All messages are JSON text frames, except the heartbeat: the client sends the literal
 *    text "ping" and the runtime auto-replies "pong" without waking the Durable Object
 *    (setWebSocketAutoResponse).
 *  - `taps` carries a CUMULATIVE count; the server keeps the max per player, so resends after
 *    a reconnect are idempotent.
 */
import type { PublicConfig } from "./config";

export type Phase =
  | "LOBBY"
  | "INTRO"
  | "RACE"
  | "LINEUP"
  | "EVENTS"
  | "CALL"
  | "GUESS"
  | "ZOOM"
  | "END";

export type Role = "player" | "host";
/** Fictional patient card, randomly assigned: 3 = very urgent 🔴, 2 = medium 🟡, 1 = not urgent 🟢. */
export type Urgency = 1 | 2 | 3;
export type EventKind = "docs" | "gamble" | "crash" | "cancel";

// ---------------------------------------------------------------- client → server

export type ClientMsg =
  /** First message on every (re)connect. A valid hostKey makes the socket a host. */
  | { type: "hello"; playerId?: string; hostKey?: string }
  /** Clock sync request; t0 = client Date.now() when sent. */
  | { type: "time"; t0: number }
  | { type: "join"; nickname: string; emoji: string }
  /** Cumulative taps this race (including presses before the green light). */
  | { type: "taps"; count: number }
  /** Answer to the gamble event. */
  | { type: "gamble"; choice: "move" | "stay" }
  /** Index into config.guessBuckets. */
  | { type: "guess"; choice: number }
  /** Index into config.reactions. */
  | { type: "react"; i: number }
  /** Start (LOBBY) or skip the current timed phase. */
  | { type: "host:next" }
  | { type: "host:reset" };

// ---------------------------------------------------------------- server → client

export interface PlayerTag {
  /** Stable per-player number (join order); used as an animation key, not secret. */
  no: number;
  emoji: string;
  nickname: string;
}

export interface QueueEntry extends PlayerTag {
  urgency: Urgency;
  foul: boolean;
}

export interface MoveView extends PlayerTag {
  from: number;
  to: number;
}

export interface EventView {
  kind: EventKind;
  at: number;
  /** Gamble only. */
  decideUntil?: number;
  resolved?: boolean;
  movers?: number;
  lucky?: number;
  unlucky?: number;
  /** Host only (players get their own moves in `you.moves`). 1-based positions. */
  moves: MoveView[];
}

export interface LineupStats {
  fastest: (PlayerTag & { ms: number; pos: number }) | null;
  mostTaps: (PlayerTag & { taps: number; pos: number }) | null;
  totalTaps: number;
  tappers: number;
  fouls: number;
}

export interface WinnerView extends PlayerTag {
  pos: number;
  urgency: Urgency;
  /** Host only (the big screen shows it; the winner's phone sees it via `you`). */
  claimCode?: string;
}

export interface YouView {
  nickname: string;
  emoji: string;
  urgency: Urgency;
  /** Server-acknowledged cumulative taps → client resumes from this after a refresh. */
  taps: number;
  foul: boolean;
  /** ms from green light to the first valid tap. */
  reactionMs: number | null;
  /** 1-based queue position (LINEUP onwards). */
  pos: number | null;
  gamble: "move" | "stay" | null;
  guess: number | null;
  /** Own moves caused by events: slot = index into `events`. */
  moves: { slot: number; from: number; to: number }[];
  won: boolean;
  claimCode?: string;
}

export interface Snapshot {
  phase: Phase;
  config: PublicConfig;
  /** Server ms. phaseEndAt is null for LOBBY and END. */
  phaseStartAt: number | null;
  phaseEndAt: number | null;
  /** RACE: green light + end of tapping (server ms). */
  goAt: number | null;
  raceEndAt: number | null;
  joined: number;
  totalTaps: number;
  /** [not urgent, medium, very urgent] counts among joined players. */
  urgencyCounts: [number, number, number];
  events: EventView[];
  /** LINEUP onwards. */
  stats: LineupStats | null;
  /** CALL onwards. */
  winner: WinnerView | null;
  /** CALL onwards: players still waiting, [not urgent, medium, very urgent]. */
  waiting: [number, number, number] | null;
  guess: {
    answered: number;
    /** ZOOM onwards. */
    counts: number[] | null;
    correct: number | null;
  };
  peoplePerPsychiatrist: number;
  roomsNeeded: number | null;
  /** Host only, LINEUP onwards: queue in order (index 0 = queue #1). */
  queue?: QueueEntry[];
  /** Host only. */
  roster?: { emoji: string; nickname: string }[];
  /** Player only; null when this playerId has not joined (yet / after reset). */
  you?: YouView | null;
}

export interface LiveMsg {
  type: "live";
  serverNow: number;
  joined: number;
  connected: number;
  totalTaps: number;
  /** Only included when the roster changed since the last live message. */
  roster?: { emoji: string; nickname: string }[];
  /** RACE: top tappers right now. */
  top?: (PlayerTag & { taps: number })[];
  /** New false starts since the last live message. */
  fouls?: PlayerTag[];
  /** New reactions since the last live message. */
  reacts?: string[];
  /** GUESS: live answer counts per bucket. */
  guesses?: number[];
}

export type ServerMsg =
  | { type: "time"; t0: number; serverNow: number }
  | { type: "state"; serverNow: number; role: Role; snapshot: Snapshot }
  | LiveMsg
  | { type: "error"; code: "bad_nickname" | "bad_emoji" | "not_joined" | "bad_host_key" };
