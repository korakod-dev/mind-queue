/**
 * Net — reconnecting WebSocket client shared by the player and host pages.
 *
 * - Exponential backoff with jitter; immediate retry when the tab becomes visible or the
 *   device comes back online (mobile browsers kill sockets in the background).
 * - Heartbeat: sends the literal "ping" every pingIntervalMs; the Durable Object runtime
 *   answers "pong" without waking. No traffic for deadSocketMs → force reconnect.
 * - Clock sync: a burst of `time` requests on every connect, then one every timeResyncMs.
 *   offset = serverNow − (t0 + rtt/2), taken from the lowest-RTT sample of the recent window.
 * - Sends `hello` first on every (re)connect; the server answers with a full snapshot.
 *
 * Timings start from safe defaults and are replaced by `config.client` from the first snapshot.
 */
(function () {
  const DEFAULTS = {
    pingIntervalMs: 15000,
    deadSocketMs: 35000,
    reconnectBaseMs: 500,
    reconnectMaxMs: 10000,
    timeResyncMs: 30000,
  };

  class Net {
    /**
     * @param {object} opts
     * @param {() => object} opts.hello      builds the hello message for each connect
     * @param {(msg: object) => void} opts.onMessage
     * @param {(up: boolean) => void} opts.onStatus  connection up/down
     */
    constructor(opts) {
      this.opts = opts;
      this.t = { ...DEFAULTS };
      this.ws = null;
      this.attempt = 0;
      this.offset = 0; // serverTime − localTime
      this.samples = []; // {rtt, offset}
      this.lastRx = 0;
      this.timers = {};
      this.up = false;
      this.stopped = false;

      const kick = () => {
        if (!this.up && !this.stopped) this.connectNow();
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          kick();
          if (this.up) this.syncBurst(); // timers drift while backgrounded
        }
      });
      window.addEventListener("online", kick);
    }

    /** Apply config.client timings from a snapshot. */
    configure(clientCfg) {
      if (clientCfg) Object.assign(this.t, clientCfg);
    }

    /** Current server time estimate (ms). */
    now() {
      return Date.now() + this.offset;
    }

    start() {
      this.connect();
    }

    /** Stop for good (e.g. bad host key). */
    stop() {
      this.stopped = true;
      this.clearTimers();
      try {
        this.ws && this.ws.close();
      } catch (_) {}
    }

    connectNow() {
      clearTimeout(this.timers.retry);
      this.attempt = 0;
      this.connect();
    }

    connect() {
      if (this.stopped) return;
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let ws;
      try {
        ws = new WebSocket(`${proto}//${location.host}/ws`);
      } catch (_) {
        this.scheduleRetry();
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.attempt = 0;
        this.up = true;
        this.lastRx = Date.now();
        this.sendRaw(JSON.stringify(this.opts.hello()));
        this.startTimers(); // before syncBurst: startTimers clears any old burst timers
        this.syncBurst();
        this.opts.onStatus(true);
      };

      ws.onmessage = (ev) => {
        this.lastRx = Date.now();
        if (ev.data === "pong") return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (msg.type === "time") {
          this.onTime(msg);
          return;
        }
        if (msg.type === "state" && msg.snapshot && msg.snapshot.config) {
          this.configure(msg.snapshot.config.client);
        }
        this.opts.onMessage(msg);
      };

      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.up = false;
        this.clearTimers();
        this.opts.onStatus(false, ev.code);
        if (ev.code === 4003) {
          this.stopped = true; // bad host key → do not hammer the server
          return;
        }
        this.scheduleRetry();
      };

      ws.onerror = () => {
        /* onclose follows */
      };
    }

    scheduleRetry() {
      if (this.stopped) return;
      const base = Math.min(this.t.reconnectMaxMs, this.t.reconnectBaseMs * 2 ** this.attempt);
      const delay = base * (0.5 + Math.random() * 0.5); // jitter avoids 67 phones retrying in lockstep
      this.attempt++;
      clearTimeout(this.timers.retry);
      this.timers.retry = setTimeout(() => this.connect(), delay);
    }

    startTimers() {
      this.clearTimers();
      this.timers.ping = setInterval(() => {
        this.sendRaw("ping");
        if (Date.now() - this.lastRx > this.t.deadSocketMs) {
          // Half-open socket (common on flaky Wi-Fi): drop it and reconnect.
          try {
            this.ws && this.ws.close();
          } catch (_) {}
        }
      }, this.t.pingIntervalMs);
      this.timers.resync = setInterval(() => this.sendTime(), this.t.timeResyncMs);
    }

    clearTimers() {
      clearInterval(this.timers.ping);
      clearInterval(this.timers.resync);
      this.timers.burst && this.timers.burst.forEach(clearTimeout);
    }

    syncBurst() {
      this.timers.burst = [0, 150, 300, 600, 1000].map((d) => setTimeout(() => this.sendTime(), d));
    }

    sendTime() {
      this.send({ type: "time", t0: Date.now() });
    }

    onTime(msg) {
      const t1 = Date.now();
      const rtt = t1 - msg.t0;
      if (rtt < 0 || rtt > 10000) return;
      this.samples.push({ rtt, offset: msg.serverNow - (msg.t0 + rtt / 2) });
      if (this.samples.length > 8) this.samples.shift();
      let best = this.samples[0];
      for (const s of this.samples) if (s.rtt < best.rtt) best = s;
      this.offset = best.offset;
    }

    sendRaw(text) {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(text);
          return true;
        } catch (_) {}
      }
      return false;
    }

    send(obj) {
      return this.sendRaw(JSON.stringify(obj));
    }
  }

  window.Net = Net;

  /** localStorage wrapped in try/catch (private mode / blocked storage). */
  window.store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (_) {}
    },
  };

  /** UUID that also works on plain-http LAN dev (crypto.randomUUID needs a secure context). */
  window.uuid = function () {
    if (window.crypto && crypto.randomUUID) {
      try {
        return crypto.randomUUID();
      } catch (_) {}
    }
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
})();
