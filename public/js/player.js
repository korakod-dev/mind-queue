/**
 * Player (phone) page.
 *
 * Renders purely from the latest server snapshot + the synced server clock (net.now()).
 * Local-only state: tap/pop counters (cumulative, reconciled with the server's acknowledged
 * counts on every snapshot), the selected mini-game tab, and the join form inputs.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const STR = window.STR;

  // ------------------------------------------------------------ static strings
  document.querySelectorAll("[data-str]").forEach((el) => {
    el.textContent = STR[el.dataset.str] || "";
  });

  // iOS Safari ignores user-scalable=no; block pinch-zoom (two-thumb tapping looks like a pinch).
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // ------------------------------------------------------------ identity
  const ID_KEY = "mq.playerId";
  let playerId = store.get(ID_KEY);
  if (!playerId || !/^[A-Za-z0-9-]{8,64}$/.test(playerId)) {
    playerId = uuid();
    store.set(ID_KEY, playerId);
  }

  // ------------------------------------------------------------ state
  let snap = null; // latest snapshot
  let screen = "s-boot";
  let localTaps = 0; // cumulative taps this race (local)
  let sentTaps = 0; // highest cumulative count successfully sent
  let firstTapSentFor = null; // startAt of the race whose first tap was sent immediately
  let localPops = 0;
  let sentPops = 0;
  let tab = "bubble";
  let celebrated = null; // claim code we already threw confetti for
  let joinPending = false;

  const net = new Net({
    hello: () => ({ type: "hello", playerId }),
    onMessage,
    onStatus: (up) => {
      $("banner").hidden = up;
    },
  });

  // ------------------------------------------------------------ messages
  function onMessage(msg) {
    if (msg.type === "state") {
      snap = msg.snapshot;
      joinPending = false;
      reconcileCounters();
      render();
    } else if (msg.type === "error") {
      joinPending = false;
      if (msg.code === "bad_nickname" || msg.code === "bad_emoji") {
        $("join-err").textContent = STR.errNickname;
        updateJoinButton();
      }
    }
  }

  /** Server-acknowledged counts win if higher (refresh/reconnect); a reset brings them back to 0. */
  function reconcileCounters() {
    const you = snap.you;
    if (!you) {
      localTaps = sentTaps = localPops = sentPops = 0;
      firstTapSentFor = null;
      return;
    }
    localTaps = Math.max(localTaps, you.taps);
    sentTaps = Math.max(Math.min(sentTaps, localTaps), you.taps);
    localPops = Math.max(localPops, you.pops);
    sentPops = Math.max(Math.min(sentPops, localPops), you.pops);
    if (snap.phase === "LOBBY") {
      localTaps = sentTaps = you.taps;
      localPops = sentPops = you.pops;
    }
  }

  // ------------------------------------------------------------ rendering
  function show(id) {
    if (screen === id) return;
    const leaving = screen;
    screen = id;
    document.querySelectorAll(".screen").forEach((el) => {
      el.hidden = el.id !== id;
    });
    if (leaving === "s-waiting") bubbles.stop();
    if (id === "s-waiting") applyTab();
  }

  function pickScreen() {
    const you = snap.you;
    if (!you) return "s-join";
    switch (snap.phase) {
      case "LOBBY":
        return "s-wait";
      case "TAP_COUNTDOWN":
      case "TAP_RACE":
        return "s-tap";
      case "TAP_RESULT":
      case "WAITING_ROOM":
        if (you.won) return "s-win";
        return snap.phase === "TAP_RESULT" ? "s-ticket" : "s-waiting";
      case "REVEAL":
        return "s-reveal";
      case "END":
        return "s-end";
    }
    return "s-boot";
  }

  function render() {
    const you = snap.you;
    const id = pickScreen();

    document.querySelectorAll("[data-you]").forEach((el) => {
      el.textContent = you ? you[el.dataset.you] : "";
    });

    if (id === "s-join") renderJoin();
    if (id === "s-tap") $("tap-count").textContent = fmt(STR.tapCount, { n: num(localTaps) });
    if (id === "s-win") {
      $("win-msg").textContent = you.won === "race" ? STR.tapWin : STR.drawWin;
      $("win-code").textContent = you.claimCode || "";
      if (celebrated !== you.claimCode) {
        celebrated = you.claimCode;
        confetti($("confetti"));
        if (navigator.vibrate) {
          try {
            navigator.vibrate([30, 60, 30]);
          } catch (_) {}
        }
      }
    }
    if (id === "s-ticket") renderTicket($("ticket-big"), you);
    if (id === "s-waiting") {
      renderTicket($("ticket-small"), you);
      $("calling-num").textContent = snap.called == null ? "" : num(snap.called);
      $("pop-count").textContent = `🫧 ${num(localPops)}`;
    }
    show(id);
  }

  /** Hospital-style queue slip. Built with textContent (nickname is user input). */
  function renderTicket(el, you) {
    el.textContent = "";
    const add = (cls, text) => {
      const d = document.createElement("div");
      d.className = cls;
      if (text != null) d.textContent = text;
      el.appendChild(d);
      return d;
    };
    add("t-head", STR.ticketLabel);
    add("t-num num", you.ticket != null ? num(you.ticket) : "—");
    add("t-who", `${you.emoji} ${you.nickname}`);
    add("t-foot", STR.ticketWait);
    add("t-bar");
  }

  // ------------------------------------------------------------ join form
  const nickInput = $("nick");
  let chosenEmoji = store.get("mq.emoji");
  let gridBuiltFor = null;

  function graphemes(s) {
    try {
      return Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s), (x) => x.segment);
    } catch (_) {
      return Array.from(s);
    }
  }

  function renderJoin() {
    const cfg = snap.config;
    if (gridBuiltFor !== cfg.emojis.join("")) {
      gridBuiltFor = cfg.emojis.join("");
      const grid = $("emoji-grid");
      grid.textContent = "";
      if (!cfg.emojis.includes(chosenEmoji)) chosenEmoji = null;
      for (const e of cfg.emojis) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = e;
        b.setAttribute("aria-pressed", String(e === chosenEmoji));
        b.addEventListener("click", () => {
          chosenEmoji = e;
          grid.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          updateJoinButton();
        });
        grid.appendChild(b);
      }
      if (!nickInput.value) nickInput.value = store.get("mq.nick") || "";
    }
    updateJoinButton();
  }

  function nickValid() {
    const n = graphemes(nickInput.value.trim()).length;
    return n >= 1 && snap && n <= snap.config.nicknameMaxChars;
  }

  function updateJoinButton() {
    $("join-btn").disabled = joinPending || !nickValid() || !chosenEmoji;
  }

  nickInput.addEventListener("input", () => {
    // Enforce the max length in user-perceived characters (Thai marks count with their letter).
    const max = snap ? snap.config.nicknameMaxChars : 12;
    const g = graphemes(nickInput.value);
    if (g.length > max) nickInput.value = g.slice(0, max).join("");
    $("join-err").textContent = "";
    updateJoinButton();
  });

  $("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!nickValid()) {
      $("join-err").textContent = STR.errNickname;
      return;
    }
    if (!chosenEmoji) return;
    const nickname = nickInput.value.trim();
    store.set("mq.nick", nickname);
    store.set("mq.emoji", chosenEmoji);
    if (net.send({ type: "join", nickname, emoji: chosenEmoji })) {
      joinPending = true;
      updateJoinButton();
      nickInput.blur();
    }
  });

  // ------------------------------------------------------------ tap race
  const tapBtn = $("tap-btn");

  function raceOpen(now) {
    return snap && snap.startAt != null && now >= snap.startAt && now < snap.endAt;
  }

  function sendTaps() {
    if (localTaps > sentTaps && net.send({ type: "taps", count: localTaps })) sentTaps = localTaps;
  }

  tapBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!raceOpen(net.now())) return;
    localTaps++;
    $("tap-count").textContent = fmt(STR.tapCount, { n: num(localTaps) });
    tapBtn.classList.remove("hit");
    void tapBtn.offsetWidth; // restart the press animation
    tapBtn.classList.add("hit");
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch (_) {}
    }
    // The very first tap decides the race → send immediately.
    if (firstTapSentFor !== snap.startAt) {
      firstTapSentFor = snap.startAt;
      sendTaps();
    }
  });
  tapBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  // ------------------------------------------------------------ waiting room mini-games
  const bubbles = createBubbles($("bubbles"), () => {
    localPops++;
    $("pop-count").textContent = `🫧 ${num(localPops)}`;
  });

  function applyTab() {
    $("tab-bubble").setAttribute("aria-selected", String(tab === "bubble"));
    $("tab-breathe").setAttribute("aria-selected", String(tab === "breathe"));
    $("breathe").hidden = tab !== "breathe";
    $("bubbles").hidden = tab !== "bubble";
    $("pop-count").hidden = tab !== "bubble";
    if (tab === "bubble" && screen === "s-waiting") bubbles.start();
    else bubbles.stop();
  }
  $("tab-bubble").addEventListener("click", () => {
    tab = "bubble";
    applyTab();
  });
  $("tab-breathe").addEventListener("click", () => {
    tab = "breathe";
    applyTab();
  });

  // ------------------------------------------------------------ batching timers
  setInterval(() => {
    if (!snap || snap.startAt == null) return;
    const now = net.now();
    // Keep sending a little past endAt so the last batch is not lost.
    if (now >= snap.startAt && now < snap.endAt + 800) sendTaps();
  }, 500);

  let popTimer = null;
  function armPopTimer() {
    clearInterval(popTimer);
    const ms = (snap && snap.config.client.popBatchMs) || 2000;
    popTimer = setInterval(() => {
      if (!snap || (snap.phase !== "WAITING_ROOM" && snap.phase !== "REVEAL")) return;
      if (localPops > sentPops && net.send({ type: "pops", count: localPops })) sentPops = localPops;
    }, ms);
  }
  armPopTimer();

  // ------------------------------------------------------------ per-frame updates
  let lastCountdown = null;
  const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);

  function loop() {
    requestAnimationFrame(loop);
    if (!snap) return;
    const now = net.now();

    if (screen === "s-tap" && snap.startAt != null) {
      const cd = $("countdown");
      if (now < snap.startAt) {
        const n = Math.min(snap.config.countdownSeconds, Math.ceil((snap.startAt - now) / 1000));
        if (n !== lastCountdown) {
          lastCountdown = n;
          cd.textContent = String(n);
          cd.classList.remove("pop");
          void cd.offsetWidth;
          cd.classList.add("pop");
        }
        cd.hidden = false;
        tapBtn.disabled = true;
        $("tap-top").textContent = STR.getReady;
      } else {
        lastCountdown = null;
        cd.hidden = true;
        const open = now < snap.endAt;
        tapBtn.disabled = !open;
        const s = Math.max(0, Math.ceil((snap.endAt - now) / 1000));
        $("tap-top").textContent = fmt(STR.timeLeft, { s });
      }
    }

    if (screen === "s-waiting" && tab === "breathe" && snap.waitStartAt != null) {
      const inMs = snap.config.breathing.inSec * 1000;
      const outMs = snap.config.breathing.outSec * 1000;
      const t = (((now - snap.waitStartAt) % (inMs + outMs)) + inMs + outMs) % (inMs + outMs);
      let scale;
      let word;
      if (t < inMs) {
        scale = 0.55 + 0.45 * ease(t / inMs);
        word = STR.breatheIn;
      } else {
        scale = 1 - 0.45 * ease((t - inMs) / outMs);
        word = STR.breatheOut;
      }
      $("breathe-circle").style.transform = `scale(${scale.toFixed(3)})`;
      const w = $("breathe-word");
      if (w.textContent !== word) w.textContent = word;
    }
  }
  requestAnimationFrame(loop);

  net.start();
})();
