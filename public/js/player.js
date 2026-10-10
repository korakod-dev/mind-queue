/**
 * Player (phone) page.
 *
 * Renders purely from the latest server snapshot + the synced server clock (net.now()).
 * Local-only state: the tap counter (cumulative, reconciled with the server's acknowledged
 * count on every snapshot) and the join form inputs.
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
  let sentRedFor = null; // goAt of the race whose first pre-green press was sent
  let sentGreenFor = null; // goAt of the race whose first post-green press was sent
  let celebrated = null; // claim code we already threw confetti for
  let joinPending = false;
  let lastPos = null;

  const net = new Net({
    hello: () => ({ type: "hello", playerId }),
    onMessage,
    onStatus: (up) => {
      $("banner").hidden = up;
    },
  });

  function buzz(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }

  /** Full-screen color flash (iPhones cannot vibrate from the web). */
  function flash(color) {
    const f = $("flash");
    f.style.background = color;
    f.hidden = false;
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
    setTimeout(() => (f.hidden = true), 600);
  }

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

  /** Server-acknowledged count wins if higher (refresh/reconnect); a reset brings it back to 0. */
  function reconcileCounters() {
    const you = snap.you;
    if (!you || snap.phase === "LOBBY") {
      lastPos = null;
      localTaps = sentTaps = you ? you.taps : 0;
      sentRedFor = sentGreenFor = null;
      return;
    }
    localTaps = Math.max(localTaps, you.taps);
    sentTaps = Math.max(Math.min(sentTaps, localTaps), you.taps);
  }

  // ------------------------------------------------------------ rendering
  function show(id) {
    if (screen === id) return;
    screen = id;
    document.querySelectorAll(".screen").forEach((el) => {
      el.hidden = el.id !== id;
    });
    if (id === "s-intro") {
      const c = $("card-flip");
      c.classList.remove("flipped");
      setTimeout(() => c.classList.add("flipped"), 700);
    }
  }

  function callRevealed(now) {
    return snap.phase === "CALL" && now >= snap.phaseStartAt + snap.config.timeline.callRevealMs;
  }

  function pickScreen(now) {
    const you = snap.you;
    if (!you) return "s-join";
    switch (snap.phase) {
      case "LOBBY":
        return "s-wait";
      case "INTRO":
        return "s-intro";
      case "RACE":
        return "s-tap";
      case "LINEUP":
      case "EVENTS":
        return "s-queue";
      case "CALL":
        return you.won && callRevealed(now) ? "s-win" : "s-queue";
      case "GUESS":
        return "s-guess";
      case "ZOOM":
        return "s-reveal";
      case "END":
        return "s-end";
    }
    return "s-boot";
  }

  function render() {
    const you = snap.you;
    const now = net.now();
    const id = pickScreen(now);

    document.querySelectorAll("[data-you]").forEach((el) => {
      el.textContent = you ? you[el.dataset.you] : "";
    });

    if (id === "s-join") renderJoin();
    if (id === "s-intro") renderCard();
    if (id === "s-tap") {
      $("tap-count").textContent = fmt(STR.tapCount, { n: num(localTaps) });
      $("foul-msg").hidden = !you.foul;
    }
    if (id === "s-queue") renderQueue(now);
    if (id === "s-win" || (id === "s-end" && you.won)) {
      $("win-code").textContent = you.claimCode || "";
      $("end-code").textContent = you.claimCode || "";
      if (id === "s-win" && celebrated !== you.claimCode) {
        celebrated = you.claimCode;
        confetti($("confetti"));
        buzz([60, 80, 60, 80, 200]);
        flash("#ffd27d");
      }
    }
    $("end-claim").hidden = !(you && you.won);
    if (id === "s-guess") renderGuess();
    show(id);
  }

  function urgText(u) {
    return `${STR[`urgIcon${u}`]} ${STR[`urg${u}`]}`;
  }

  function renderCard() {
    const u = snap.you.urgency;
    $("card-back").dataset.u = String(u);
    $("card-icon").textContent = STR[`urgIcon${u}`];
    $("card-label").textContent = STR[`urg${u}`];
  }

  function renderQueue(now) {
    const you = snap.you;
    $("q-urg").textContent = urgText(you.urgency);
    $("q-urg").dataset.u = String(you.urgency);

    // Position, with a bounce + buzz when it changes.
    const posEl = $("q-pos");
    posEl.textContent = you.pos == null ? "—" : num(you.pos);
    if (lastPos !== null && you.pos !== lastPos) {
      const up = you.pos < lastPos;
      posEl.classList.remove("up", "down");
      void posEl.offsetWidth;
      posEl.classList.add(up ? "up" : "down");
      buzz(up ? [40, 40, 40] : 150);
      flash(up ? "rgba(53,179,79,.55)" : "rgba(224,54,42,.45)");
    }
    lastPos = you.pos;

    // Latest move caused by the latest event.
    const lastEv = snap.events.length - 1;
    const mv = you.moves.length ? you.moves[you.moves.length - 1] : null;
    const moveEl = $("q-move");
    if (mv && mv.slot === lastEv && snap.phase === "EVENTS") {
      moveEl.textContent = fmt(mv.to < mv.from ? STR.moveUp : STR.moveDown, mv);
      moveEl.className = `q-move ${mv.to < mv.from ? "up" : "down"}`;
    } else {
      moveEl.textContent = "";
      moveEl.className = "q-move";
    }

    // Info line.
    let info = "";
    if (snap.phase === "LINEUP") {
      if (you.foul) info = STR.youFoul;
      else {
        info = fmt(STR.youTaps, { n: num(you.taps) });
        if (you.reactionMs != null) info += ` · ${fmt(STR.youReaction, { sec: secs(you.reactionMs) })}`;
      }
    }
    $("q-info").textContent = info;

    // Event / call line.
    const evEl = $("q-event");
    const gamble = $("gamble");
    gamble.hidden = true;
    evEl.className = "q-event";
    if (snap.phase === "EVENTS") {
      const ev = snap.events[lastEv];
      if (!ev) evEl.textContent = STR.noEventYet;
      else {
        evEl.textContent = STR[`ev_${ev.kind}_t`];
        if (ev.kind === "gamble" && !ev.resolved) {
          if (you.gamble) {
            evEl.textContent += `\n${fmt(STR.gambleChosen, { c: you.gamble === "move" ? STR.gambleMove : STR.gambleStay })}`;
          } else if (now < ev.decideUntil) {
            evEl.textContent += `\n${STR.ev_gamble_d}`;
            gamble.hidden = false;
          }
        }
      }
    } else if (snap.phase === "CALL") {
      evEl.textContent = callRevealed(now) ? STR.youLose : STR.callDrum;
      evEl.classList.toggle("drum", !callRevealed(now));
    } else {
      evEl.textContent = "";
    }
  }

  function renderGuess() {
    $("guess-q").textContent = fmt(STR.guessQ, { n: num(snap.joined) });
    const box = $("guess-opts");
    const n = snap.config.guessBuckets.length;
    if (box.children.length !== n) {
      box.textContent = "";
      for (let i = 0; i < n; i++) {
        const b = document.createElement("button");
        b.className = "g-opt";
        b.textContent = STR[`guessOpt${i}`];
        b.addEventListener("click", () => {
          net.send({ type: "guess", choice: i });
          box.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", String(j === i)));
          $("guess-note").textContent = STR.guessPicked;
          buzz(15);
        });
        box.appendChild(b);
      }
    }
    const g = snap.you.guess;
    box.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", String(j === g)));
    $("guess-note").textContent = g == null ? "" : STR.guessPicked;
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

  // ------------------------------------------------------------ race
  const tapBtn = $("tap-btn");

  function sendTaps() {
    if (localTaps > sentTaps && net.send({ type: "taps", count: localTaps })) sentTaps = localTaps;
  }

  tapBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!snap || snap.phase !== "RACE" || !snap.goAt) return;
    const now = net.now();
    if (now >= snap.raceEndAt) return;
    localTaps++;
    $("tap-count").textContent = fmt(STR.tapCount, { n: num(localTaps) });
    tapBtn.classList.remove("hit");
    void tapBtn.offsetWidth; // restart the press animation
    tapBtn.classList.add("hit");
    buzz(10);
    // A press before green is a false start → tell the server right away (once).
    if (now < snap.goAt) {
      if (sentRedFor !== snap.goAt) {
        sentRedFor = snap.goAt;
        sendTaps();
      }
      return;
    }
    // The first press after green decides the queue order → send immediately.
    if (sentGreenFor !== snap.goAt) {
      sentGreenFor = snap.goAt;
      sendTaps();
    }
  });
  tapBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  setInterval(() => {
    if (!snap || snap.phase !== "RACE" || !snap.goAt) return;
    const now = net.now();
    // Keep sending a little past raceEndAt so the last batch is not lost.
    if (now >= snap.goAt && now < snap.raceEndAt + 600) sendTaps();
  }, 500);

  // ------------------------------------------------------------ gamble + reactions
  $("g-move").addEventListener("click", () => {
    net.send({ type: "gamble", choice: "move" });
    buzz(20);
  });
  $("g-stay").addEventListener("click", () => {
    net.send({ type: "gamble", choice: "stay" });
    buzz(20);
  });

  let reactsBuilt = false;
  function buildReacts(list) {
    if (reactsBuilt) return;
    reactsBuilt = true;
    document.querySelectorAll(".reacts").forEach((bar) => {
      list.forEach((emo, i) => {
        const b = document.createElement("button");
        b.textContent = emo;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          net.send({ type: "react", i });
          b.classList.remove("hit");
          void b.offsetWidth;
          b.classList.add("hit");
        });
        bar.appendChild(b);
      });
    });
  }

  // ------------------------------------------------------------ per-frame updates
  let lastScreenCheck = 0;
  let wasGreen = null;

  function loop() {
    requestAnimationFrame(loop);
    if (!snap) return;
    const now = net.now();
    buildReacts(snap.config.reactions);

    if (screen === "s-tap" && snap.goAt) {
      const green = now >= snap.goAt && now < snap.raceEndAt;
      const over = now >= snap.raceEndAt;
      tapBtn.className = `tap-btn ${over ? "over" : green ? "green" : "red"}`;
      const label = over ? STR.raceOver : green ? STR.tapButtonGreen : STR.tapButtonRed;
      if (tapBtn.textContent !== label) tapBtn.textContent = label;
      const top = over ? "" : green ? fmt(STR.timeLeft, { s: Math.max(0, Math.ceil((snap.raceEndAt - now) / 1000)) }) : STR.raceWarn;
      if ($("tap-top").textContent !== top) $("tap-top").textContent = top;
      if (green && wasGreen === false) {
        flash("rgba(34,176,75,.6)");
        buzz(80);
      }
      wasGreen = green;
    } else {
      wasGreen = false;
    }

    if (screen === "s-guess" && snap.phaseEndAt) {
      const t = fmt(STR.timeLeft, { s: Math.max(0, Math.ceil((snap.phaseEndAt - now) / 1000)) });
      if ($("guess-left").textContent !== t) $("guess-left").textContent = t;
    }

    // Time-based screen changes (call reveal, gamble window closing) without a new snapshot.
    if (now - lastScreenCheck > 200) {
      lastScreenCheck = now;
      if (snap.phase === "CALL" || snap.phase === "EVENTS") render();
    }
  }
  requestAnimationFrame(loop);

  net.start();
})();
