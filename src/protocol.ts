/**
 * WebSocket protocol between clients (player phones, host big screen) and the GameRoom Durable Object.
 *
 * Transport notes:
 *  - All messages are JSON text frames, except the heartbeat: the client sends the literal
 *    text "ping" and the runtime auto-replies "pong" without waking the Durable Object
 *    (setWebSocketAutoResponse).
 *  - `taps` and `pops` carry CUMULATIVE counts; the server keeps the max per player, so
 *    resends after a reconnect are idempotent.
 */
import type { PublicConfig } from "./config";

export type Phase =
  | "LOBBY"
  | "TAP_COUNTDOWN"
  | "TAP_RACE"
  | "TAP_RESULT"
  | "WAITING_ROOM"
  | "REVEAL"
  | "END";

export type Role = "player" | "host";
export type WinKind = "race" | "draw";

// ---------------------------------------------------------------- client → server

export type ClientMsg =
  /** First message on every (re)connect. A valid hostKey makes the socket a host. */
  | { type: "hello"; playerId?: string; hostKey?: string }
  /** Clock sync request; t0 = client Date.now() when sent. */
  | { type: "time"; t0: number }
  | { type: "join"; nickname: string; emoji: string }
  /** Cumulative taps this race. */
  | { type: "taps"; count: number }
  /** Cumulative bubble pops. */
  | { type: "pops"; count: number }
  | { type: "host:next" }
  | { type: "host:draw" }
  | { type: "host:reset" };

// ---------------------------------------------------------------- server → client

export interface WinnerView {
  kind: WinKind;
  emoji: string;
  nickname: string;
  /** Draw winners keep the ticket number that was called. */
  ticket?: number;
  /** Only sent to the host (the big screen shows it; phones see their own code via `you`). */
  claimCode?: string;
}

export interface YouView {
  nickname: string;
  emoji: string;
  ticket?: number;
  claimCode?: string;
  won?: WinKind;
  /** Server-acknowledged cumulative counts → client resumes from these after a refresh. */
  taps: number;
  pops: number;
}

export interface Snapshot {
  phase: Phase;
  config: PublicConfig;
  /** Race start / end (server ms). Present from TAP_COUNTDOWN onwards. */
  startAt: number | null;
  endAt: number | null;
  /** WAITING_ROOM start (server ms); breathing + timers are derived from it. */
  waitStartAt: number | null;
  /** WAITING_ROOM end (server ms); may be earlier than planned if the host skipped ahead. */
  waitEndAt: number | null;
  joined: number;
  totalTaps: number;
  totalPops: number;
  /** "Now calling" number (WAITING_ROOM onwards). */
  called: number | null;
  /** Lowest unserved ticket in the room minus `called`. */
  queueAhead: number | null;
  /** Tap-race winner first, then cancellation draws in order. Empty until TAP_RESULT. */
  winners: WinnerView[];
  revealStep: number;
  peoplePerPsychiatrist: number;
  roomsNeeded: number | null;
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
  totalPops: number;
  /** Only included when the roster changed since the last live message. */
  roster?: { emoji: string; nickname: string }[];
}

export type ServerMsg =
  | { type: "time"; t0: number; serverNow: number }
  | { type: "state"; serverNow: number; role: Role; snapshot: Snapshot }
  | LiveMsg
  | { type: "error"; code: "bad_nickname" | "bad_emoji" | "not_joined" | "bad_host_key" };
