/**
 * Single source of truth for every number in the game.
 *
 * Everything except `server` is sent to clients inside each state snapshot
 * (`publicConfig`), so the frontend never hard-codes a number shown on screen.
 */
export const config = {
  expectedPlayers: 67,

  /** Every phase after LOBBY runs on these timers (~2:26 in total). The host can pause with P. */
  timeline: {
    introSec: 10,
    /** Lead so the RACE snapshot reaches every phone before the red light counts. */
    leadMs: 1200,
    /** The red light stays on for a random time in this range, then turns green. */
    redLightMs: [2500, 5000] as [number, number],
    /** Tapping window after the green light. */
    frenzySec: 6,
    /** Late tap batches still count toward the totals for this long after the race. */
    raceTailMs: 700,
    lineupSec: 18,
    eventsSec: 40,
    callSec: 20,
    /** CALL: drum roll first; the winner is revealed this long after CALL starts. */
    callRevealMs: 2600,
    guessSec: 12,
    zoomSec: 34,
    /** END: the warm close (friends, snacks, V11) shows first; the psychiatrist-retention message replaces it after this. */
    endSystemAtSec: 15,
  },

  /**
   * Recorded voice-over (public/voice/V00–V11.m4a, see VOICEOVER-SCRIPT.md), polished version "B"
   * (EQ + compression, chosen 2026-10-16). Lengths in ms of those files. When the host turns voice on, the three hold clips lengthen their phase by
   * their own length + holdPadMs, so nothing on screen moves on while they play.
   */
  voice: {
    clipMs: {
      V00: 9036, V01: 8497, V02: 5200, V03: 9685, V04: 4100, V05: 3700,
      V06: 5100, V07: 2670, V08: 8273, V09: 3700, V10: 8532, V11: 13721,
      // V12 (retention message at the end) is optional: it plays if public/voice/V12.m4a exists.
    } as Record<string, number>,
    holdPadMs: 300,
    /** V08 starts this long after the winner is revealed (after the summary line appears). */
    callSummaryDelayMs: 5000,
    /** Lobby prompt (V00) repeats this often. */
    lobbyEverySec: 30,
  },

  /** Taps arriving this close before the green light are ignored instead of counted as a false start. */
  foulGraceMs: 150,

  events: {
    /** Seconds after EVENTS starts. Slot 1 is always the gamble; the other kinds are shuffled. */
    times: [2, 9, 24, 32],
    gambleDecideSec: 7,
    /** 📄 "Documents incomplete": queue #1..docsBack go to the back. */
    docsBack: 5,
    /** 🔀 "Queue system crashed": this many random people swap places. */
    crashShuffle: 10,
  },

  /** Guess: "how many rooms like ours per psychiatrist?" Bucket lower bounds; the last is "1,000+". */
  guessBuckets: [10, 100, 500, 1000],

  /** 3-digit claim code (no leading zero) shown on the winner's phone + big screen. */
  claimCodeRange: [100, 999] as [number, number],

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

  /** Reaction buttons on phones; they float up on the big screen. */
  reactions: ["😱", "😂", "🙏", "💛"],

  /** Client timing (sent to clients). */
  client: {
    tapBatchMs: 500,
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
    /** Non-critical state (tap counters) is persisted at most this often. */
    persistMs: 1000,
    /** A socket that has not pinged for this long is considered dead and is closed. */
    staleSocketMs: 45000,
    /** Anti-script cap; real humans stay well below it. */
    maxTapsPerSec: 25,
    /** One reaction per player per this many ms. */
    reactEveryMs: 200,
    /** Wipe all game data after this many hours without any activity. */
    idleWipeHours: 6,
  },
};

export type Config = typeof config;

/** The subset of config that clients receive. */
export const publicConfig = {
  expectedPlayers: config.expectedPlayers,
  timeline: config.timeline,
  voice: config.voice,
  events: config.events,
  guessBuckets: config.guessBuckets,
  stats: config.stats,
  nicknameMaxChars: config.nicknameMaxChars,
  emojis: config.emojis,
  reactions: config.reactions,
  client: config.client,
};

export type PublicConfig = typeof publicConfig;
