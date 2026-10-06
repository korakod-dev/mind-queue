/**
 * Single source of truth for every number in the game.
 *
 * Everything except `server` is sent to clients inside each state snapshot
 * (`publicConfig`), so the frontend never hard-codes a number shown on screen.
 */
export const config = {
  expectedPlayers: 67,

  /** 3-2-1 countdown before the tap race. */
  countdownSeconds: 3,
  tapRaceSeconds: 10,

  /** Queue ticket numbers are unique random integers in this inclusive range. */
  queueNumberRange: [1000, 2999] as [number, number],
  /** 3-digit claim codes (no leading zero) shown on winner phones + big screen. */
  claimCodeRange: [100, 999] as [number, number],

  waitingRoom: {
    durationSec: 90,
    startCalled: 3,
    incrementEverySec: 30,
    /** Seconds after WAITING_ROOM starts when a cancellation draw happens. */
    drawTimes: [30, 60],
  },

  /** Breathing circle: synced to server time so the whole room breathes together. */
  breathing: { inSec: 4, outSec: 4 },

  stats: {
    // Updated by the presenter from 0.7 to 1.28. The original 0.7 came from the Department of
    // Mental Health survey, Dec 2022 (B.E. 2565), via Thai PBS Policy Watch; confirm that
    // sourceLabel below matches the source of 1.28 before the event.
    psychiatristsPer100k: 1.28,
    sourceLabel: "ที่มา: กรมสุขภาพจิต (ข้อมูล ธ.ค. 2565)",
  },

  nicknameMaxChars: 12,

  /** Emoji choices for players (no medical / pill motifs). Server validates against this list. */
  emojis: [
    "🐱", "🐶", "🐼", "🦊", "🐨", "🐯", "🐸", "🐵",
    "🐧", "🐰", "🐻", "🐹", "🦄", "🐙", "🐢", "🦋",
    "🌻", "🌈", "⭐", "🍀", "🌸", "🍩", "🎈", "🎧",
  ],

  /** Client timing (sent to clients). */
  client: {
    tapBatchMs: 500,
    popBatchMs: 2000,
    pingIntervalMs: 15000,
    /** No message (incl. pong) for this long → client assumes the socket is dead and reconnects. */
    deadSocketMs: 35000,
    reconnectBaseMs: 500,
    reconnectMaxMs: 10000,
    timeResyncMs: 30000,
  },

  /** Server-only tuning (not sent to clients). */
  server: {
    /** Live counters to the big screen: at most one broadcast per this many ms (≈10/s). */
    liveBroadcastMs: 100,
    /** Non-critical state (tap/pop counters) is persisted at most this often. */
    persistMs: 1000,
    /** A socket that has not pinged for this long is considered dead and is closed. */
    staleSocketMs: 45000,
    /** Anti-script caps; real humans stay well below these. */
    maxTapsPerSec: 25,
    maxPopsPerSec: 20,
    /** Late tap batches (sent just before endAt) still count toward the total for this long. */
    tapGraceMs: 1000,
    /** Wipe all game data after this many hours without any activity. */
    idleWipeHours: 6,
  },
};

export type Config = typeof config;

/** The subset of config that clients receive. */
export const publicConfig = {
  expectedPlayers: config.expectedPlayers,
  countdownSeconds: config.countdownSeconds,
  tapRaceSeconds: config.tapRaceSeconds,
  queueNumberRange: config.queueNumberRange,
  waitingRoom: config.waitingRoom,
  breathing: config.breathing,
  stats: config.stats,
  nicknameMaxChars: config.nicknameMaxChars,
  emojis: config.emojis,
  client: config.client,
};

export type PublicConfig = typeof publicConfig;
