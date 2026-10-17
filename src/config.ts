/**
 * Single source of truth for every number in the game.
 *
 * Everything except `server` is sent to clients inside each state snapshot
 * (`publicConfig`), so the frontend never hard-codes a number shown on screen.
 */
export const config = {
  expectedPlayers: 67,

  /** Every phase after LOBBY runs on these timers (~2:40 in total; EVENTS length comes from `events`). The host can pause with P. */
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
    callSec: 20,
    /** CALL: drum roll first; the winner is revealed this long after CALL starts. */
    callRevealMs: 2600,
    guessSec: 12,
    zoomSec: 34,
    /** END: the warm close (friends, snacks, V11) shows first; the psychiatrist-retention message replaces it after this. */
    endSystemAtSec: 15,
  },

  /** Taps arriving this close before the green light are ignored instead of counted as a false start. */
  foulGraceMs: 150,

  events: {
    /**
     * EVENTS timeline: the title, then 4 cards. Slot 1 is always the gamble; the other kinds are
     * shuffled, so the server builds each round's timeline from these per-kind lengths (≈54 s).
     */
    titleSec: 4,
    cardSec: { docs: 10, crash: 8, cancel: 10 } as Record<"docs" | "crash" | "cancel", number>,
    /** Read the card, look down at the phone, choose. */
    gambleDecideSec: 14,
    gambleResultSec: 8,
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

  /**
   * Online mode (presenter toggles it in the lobby): players are at home, watching a shared screen.
   * - Phones play the key sounds themselves and reveal results revealDelayMs late, so they land
   *   together with the (delayed) shared screen instead of spoiling it. The green light stays on
   *   server time, so the race is as fair as in class.
   * - Quick shouts replace the room's voice: tapped on the phone, shown with the nickname on screen.
   */
  online: {
    revealDelayMs: 1500,
    shouts: ["ย้ายเลย!", "ไม่ยุติธรรม!", "😭 ถอยไปท้าย", "555+", "ลุ้นนน 🥁", "โห…"],
  },

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
    /** One quick shout per player per this many ms (online mode). */
    shoutEveryMs: 1500,
    /** Wipe all game data after this many hours without any activity. */
    idleWipeHours: 6,
  },
};

export type Config = typeof config;

/** The subset of config that clients receive. */
export const publicConfig = {
  expectedPlayers: config.expectedPlayers,
  timeline: config.timeline,
  events: config.events,
  guessBuckets: config.guessBuckets,
  stats: config.stats,
  nicknameMaxChars: config.nicknameMaxChars,
  emojis: config.emojis,
  reactions: config.reactions,
  online: config.online,
  client: config.client,
};

export type PublicConfig = typeof publicConfig;
