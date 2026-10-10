/**
 * Host big screen + presenter controls. The big screen is the MC: it explains each phase,
 * plays the sound, and reads the twists out of the real game data.
 *
 * - Host key: read once from ?key=…, kept in sessionStorage, and removed from the address bar
 *   (the URL is visible on the projector). Sent to the server inside `hello`.
 * - Renders from `state` snapshots (phase changes, queue events) and from throttled `live`
 *   messages (joined / online / taps / top tappers / false starts / reactions / guesses).
 * - Timed effects (green light, call reveal, zoom timeline) are driven by the synced server
 *   clock, so a refresh lands on the same moment.
 * - Keyboard: Space or → = start / skip phase, P = pause / resume, M = sound on/off, R = reset (confirm),
 *   H = hide bar, F = fullscreen. Any key or click also unlocks audio.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const STR = window.STR;
  const SFX = window.SFX;

  document.querySelectorAll("[data-str]").forEach((el) => {
    el.textContent = STR[el.dataset.str] || "";
  });

  // ------------------------------------------------------------ host key
  const KEY_STORE = "mq.hostKey";
  let hostKey = null;
  const params = new URLSearchParams(location.search);
  if (params.has("key")) {
    hostKey = params.get("key");
    try {
      sessionStorage.setItem(KEY_STORE, hostKey);
    } catch (_) {}
    history.replaceState(null, "", location.pathname); // hide the key from the projector
  } else {
    try {
      hostKey = sessionStorage.getItem(KEY_STORE);
    } catch (_) {}
  }

  if (!hostKey) {
    $("boot-msg").textContent = STR.hostNoKey;
    $("ctl").hidden = true;
    return;
  }

  // ------------------------------------------------------------ state
  let snap = null;
  let live = { joined: 0, connected: 0, totalTaps: 0, top: [], guesses: null };
  let roster = [];
  let stage = "h-boot";
  let lastPhaseKey = null; // phase + phaseStartAt of the last rendered snapshot
  let seenEvents = 0;
  const once = new Set(); // one-shot effects already played, keyed by phase start

  /** Game clock: server time, frozen while the host has paused. */
  const clock = () => (snap && snap.pausedAt != null ? snap.pausedAt : net.now());

  const net = new Net({
    hello: () => ({ type: "hello", hostKey }),
    onMessage,
    onStatus: (up, code) => {
      $("offline").hidden = up;
      if (code === 4003) showBadKey();
    },
  });

  function showBadKey() {
    try {
      sessionStorage.removeItem(KEY_STORE);
    } catch (_) {}
    $("offline").hidden = true;
    $("boot-msg").textContent = STR.hostNoKey;
    show("h-boot");
  }

  function onMessage(msg) {
    if (msg.type === "state") {
      const prev = snap;
      snap = msg.snapshot;
      live.joined = snap.joined;
      live.totalTaps = snap.totalTaps;
      if (snap.roster) roster = snap.roster;
      onSnapshot(prev);
    } else if (msg.type === "live") {
      const delta = msg.totalTaps - live.totalTaps;
      live.joined = msg.joined;
      live.connected = msg.connected;
      live.totalTaps = msg.totalTaps;
      if (msg.roster) {
        roster = msg.roster;
        renderRoster();
      }
      if (msg.top) {
        live.top = msg.top;
        renderTop();
      }
      if (msg.fouls) msg.fouls.forEach(addFoul);
      if (msg.reacts) msg.reacts.forEach(floatReact);
      if (msg.guesses) {
        live.guesses = msg.guesses;
        if (stage === "h-guess") renderBars($("guess-bars"), live.guesses, null);
      }
      if (delta > 0 && snap && snap.phase === "RACE") playTaps(delta);
      renderLiveText();
    } else if (msg.type === "error" && msg.code === "bad_host_key") {
      showBadKey();
    }
  }

  // ------------------------------------------------------------ rendering
  function show(id) {
    if (stage === id) return;
    stage = id;
    document.querySelectorAll(".stage").forEach((el) => {
      el.hidden = el.id !== id;
    });
  }

  function stageFor(phase) {
    switch (phase) {
      case "LOBBY":
        return "h-lobby";
      case "INTRO":
        return "h-intro";
      case "RACE":
        return "h-race";
      case "LINEUP":
      case "EVENTS":
      case "CALL":
        return "h-queue";
      case "GUESS":
        return "h-guess";
      case "ZOOM":
        return "h-zoom";
      case "END":
        return "h-end";
    }
    return "h-boot";
  }

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  const who = (p) => `${p.emoji} ${p.nickname}`;
  const urgLabel = (u) => ({ icon: STR[`urgIcon${u}`], label: STR[`urg${u}`] });

  function onSnapshot(prev) {
    const s = snap;
    const key = `${s.phase}:${s.phaseStartAt}`;
    const entered = key !== lastPhaseKey;
    lastPhaseKey = key;

    if (s.phase === "LOBBY") {
      once.clear();
      seenEvents = 0;
      renderQR();
      renderRoster(true);
      resetRace();
    }
    show(stageFor(s.phase)); // before rendering: layout needs the stage visible
    if (s.phase === "INTRO") renderIntro();
    if (s.phase === "RACE" && entered) resetRace();
    if (stageFor(s.phase) === "h-queue") {
      renderHead();
      renderLine();
    }
    if (s.phase === "GUESS") renderGuess();
    if (s.phase === "ZOOM" && entered) buildZoom();
    if (s.phase === "END") renderEnd();

    // New queue events → sound + highlight.
    if (s.phase === "EVENTS" && s.events.length > seenEvents) {
      const ev = s.events[s.events.length - 1];
      if (prev) playEvent(ev);
      seenEvents = s.events.length;
    } else if (s.phase === "EVENTS" && prev && prev.events.length === s.events.length) {
      // Gamble resolved (same count, new data).
      const a = prev.events[prev.events.length - 1];
      const b = s.events[s.events.length - 1];
      if (a && b && a.kind === "gamble" && !a.resolved && b.resolved) SFX[b.lucky ? "fanfare" : "sad"]();
    }
    if (s.phase !== "EVENTS") seenEvents = s.events.length;

    if (entered && prev) onEnterPhase(s.phase);
    setMusicFor(s.phase);

    $("paused").hidden = s.pausedAt == null;
    $("ctl-pause").hidden = s.phaseEndAt == null;
    $("ctl-pause").textContent = s.pausedAt != null ? STR.ctlResume : STR.ctlPause;
    const next = $("ctl-next");
    next.textContent = s.phase === "LOBBY" ? STR.ctlStart : STR.ctlSkip;
    next.hidden = s.phase === "END";
    show(stageFor(s.phase));
    renderLiveText();
  }

  function onEnterPhase(phase) {
    if (phase === "INTRO" || phase === "LINEUP" || phase === "GUESS") SFX.whoosh();
    if (phase === "LINEUP") setTimeout(() => SFX.dingdong(), 300);
    if (phase === "CALL") SFX.drumroll(snap.config.timeline.callRevealMs - 200);
    if (phase === "END") SFX.fanfare();
  }

  function setMusicFor(phase) {
    const now = clock();
    let m = null;
    if (snap.pausedAt != null) {
      SFX.music(null);
      return;
    }
    if (phase === "LOBBY") m = "lobby";
    else if (phase === "INTRO" || phase === "LINEUP") m = "calm";
    else if (phase === "RACE") m = snap.goAt && now >= snap.goAt && now < snap.raceEndAt ? "frenzy" : "tension";
    else if (phase === "EVENTS" || phase === "GUESS") m = "tension";
    else if (phase === "CALL") m = now >= snap.phaseStartAt + snap.config.timeline.callRevealMs + 3000 ? "calm" : null;
    else if (phase === "ZOOM") m = now >= snap.phaseStartAt + 19000 ? "calm" : null;
    else if (phase === "END") m = "calm";
    SFX.music(m);
  }

  /** Text that depends on live counters. */
  function renderLiveText() {
    if (!snap) return;
    $("joined").textContent = fmt(STR.joinedCount, { x: num(live.joined), total: num(snap.config.expectedPlayers) });
    $("ctl-info").textContent = `${snap.phase} · ${fmt(STR.ctlOnline, { n: live.connected })} · ${num(live.joined)}`;
    $("ctl-sound").textContent = SFX.muted ? STR.ctlMuted : STR.ctlSound;
  }

  // --- lobby
  let qrFor = null;
  function renderQR() {
    const url = `${location.origin}/`;
    $("qr-url").textContent = location.host;
    if (qrFor === url || !window.QRCode) return;
    qrFor = url;
    $("qr").textContent = "";
    new QRCode($("qr"), {
      text: url,
      width: 512,
      height: 512,
      colorDark: "#1d4743",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  let rosterShown = 0;
  function renderRoster(force) {
    const wall = $("emoji-wall");
    if (force || roster.length < rosterShown) {
      wall.textContent = "";
      rosterShown = 0;
    }
    // Append only new players so each one gets its own drop-in animation.
    for (let i = rosterShown; i < roster.length; i++) {
      const sp = el("span", null, roster[i].emoji);
      sp.title = roster[i].nickname;
      wall.appendChild(sp);
    }
    if (roster.length > rosterShown && snap && snap.phase === "LOBBY" && rosterShown > 0) SFX.tick();
    rosterShown = roster.length;
  }

  // --- intro
  function renderIntro() {
    $("intro-sub").textContent = fmt(STR.introSub, { n: num(snap.joined) });
    const row = $("intro-urg");
    row.textContent = "";
    [3, 2, 1].forEach((u) => {
      const c = el("span", `urg-chip u${u}`, `${STR[`urgIcon${u}`]} ${STR[`urg${u}`]} ${num(snap.urgencyCounts[u - 1])}`);
      row.appendChild(c);
    });
  }

  // --- race
  let shownTaps = 0;
  function resetRace() {
    shownTaps = 0;
    live.top = [];
    $("top-list").textContent = "";
    $("fouls").textContent = "";
  }

  function renderTop() {
    const list = $("top-list");
    list.textContent = "";
    for (const p of live.top) {
      const li = el("li");
      li.append(el("span", "e", p.emoji), el("span", "n", p.nickname), el("span", "c num", num(p.taps)));
      list.appendChild(li);
    }
  }

  function addFoul(p) {
    const box = $("fouls");
    const chip = el("div", "foul-chip", `🚫 ${who(p)} ${STR.foulBig}`);
    box.prepend(chip);
    while (box.children.length > 6) box.lastChild.remove();
    SFX.sad();
  }

  let tapQueue = 0;
  function playTaps(delta) {
    // Up to ~12 clicks per live message (10/s), spread out so it sounds like a crowd.
    const n = Math.min(12, delta);
    tapQueue += n;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        tapQueue--;
        SFX.tap();
      }, Math.random() * 100);
    }
  }

  // --- queue line
  const tokens = new Map(); // player no → element
  let movedUntil = 0;
  let movedNos = new Set();

  function lineLayout(n, W, H) {
    let best = { cols: 1, size: 0 };
    for (let cols = 3; cols <= 40; cols++) {
      const rows = Math.ceil(n / cols);
      const size = Math.min(W / cols, H / rows);
      if (size > best.size) best = { cols, size };
    }
    return best;
  }

  function renderLine() {
    const q = snap.queue || [];
    const line = $("line");
    const W = line.clientWidth || window.innerWidth * 0.92;
    // Space left under the header, minus the bottom gutter.
    const H = Math.max(80, window.innerHeight * 0.95 - line.getBoundingClientRect().top);
    const { cols, size } = lineLayout(q.length + 1, W, H);
    const rows = Math.ceil((q.length + 1) / cols);
    const offX = (W - cols * size) / 2;
    const offY = (H - rows * size) / 2;
    const cell = (i) => {
      const r = Math.floor(i / cols);
      let c = i % cols;
      if (r % 2 === 1) c = cols - 1 - c; // serpentine, like a real waiting line
      return [offX + c * size, offY + r * size];
    };

    const door = line.querySelector(".door");
    const [dx, dy] = cell(0);
    Object.assign(door.style, { width: `${size}px`, height: `${size}px`, transform: `translate(${dx}px, ${dy}px)`, fontSize: `${size * 0.16}px` });
    door.querySelector("span").style.fontSize = `${size * 0.5}px`;

    const keep = new Set();
    const revealed = snap.phase === "CALL" && clock() >= snap.phaseStartAt + snap.config.timeline.callRevealMs;
    const winnerNo = revealed && snap.winner ? snap.winner.no : null;
    q.forEach((p, i) => {
      keep.add(p.no);
      let t = tokens.get(p.no);
      if (!t) {
        t = el("div", "tok");
        t.append(el("span", "e"), el("span", "pos num"));
        line.appendChild(t);
        tokens.set(p.no, t);
      }
      const [x, y] = cell(i + 1);
      t.style.width = `${size}px`;
      t.style.height = `${size}px`;
      t.style.transform = `translate(${x}px, ${y}px)`;
      t.querySelector(".e").textContent = p.emoji;
      t.querySelector(".e").style.fontSize = `${size * 0.56}px`;
      const posEl = t.querySelector(".pos");
      posEl.textContent = String(i + 1);
      posEl.style.fontSize = `${Math.max(11, size * 0.2)}px`;
      t.title = p.nickname;
      t.dataset.u = String(p.urgency);
      t.classList.toggle("foul", p.foul && snap.phase === "LINEUP");
      t.classList.toggle("moved", movedNos.has(p.no) && Date.now() < movedUntil);
      t.classList.toggle("first", i === 0);
      t.classList.toggle("winner", winnerNo === p.no);
    });
    for (const [no, t] of tokens) {
      if (!keep.has(no)) {
        t.remove();
        tokens.delete(no);
      }
    }
    line.classList.toggle("show-urg", revealed);
  }

  function renderHead() {
    const head = $("q-head");
    head.textContent = "";
    const s = snap;
    if (s.phase === "LINEUP") {
      head.append(el("h2", "q-title", STR.lineupTitle));
      const st = s.stats;
      const box = el("div", "irony");
      if (!st || st.tappers === 0) {
        box.append(el("p", null, STR.ironyNone));
      } else {
        if (st.fastest) box.append(el("p", null, fmt(STR.ironyFastest, { who: who(st.fastest), sec: secs(st.fastest.ms), pos: st.fastest.pos })));
        if (st.mostTaps) box.append(el("p", "big", fmt(STR.ironyMost, { who: who(st.mostTaps), taps: num(st.mostTaps.taps), pos: st.mostTaps.pos })));
        box.append(el("p", null, fmt(STR.ironyTotal, { total: num(st.totalTaps) })));
      }
      if (st && st.fouls > 0) box.append(el("p", "warn", fmt(STR.ironyFouls, { n: st.fouls })));
      head.append(box);
      return;
    }
    if (s.phase === "EVENTS") {
      const ev = s.events[s.events.length - 1];
      if (!ev) {
        head.append(el("h2", "q-title", STR.eventsTitle));
        return;
      }
      const card = el("div", `ev-card ev-${ev.kind}`);
      card.append(el("div", "ev-t", STR[`ev_${ev.kind}_t`]));
      let desc = STR[`ev_${ev.kind}_d`];
      if (ev.kind === "docs") desc = fmt(desc, { n: ev.moves.length || s.config.events.docsBack });
      if (ev.kind === "crash") desc = fmt(desc, { n: s.config.events.crashShuffle });
      card.append(el("div", "ev-d", desc));
      if (ev.kind === "gamble") {
        const g = el("div", "ev-g num");
        g.id = "gamble-line";
        if (ev.resolved) {
          g.textContent = ev.movers ? fmt(STR.ev_gamble_res, ev) : STR.ev_gamble_none;
        }
        card.append(g);
      }
      if (ev.moves.length) {
        const chips = el("div", "chips");
        for (const m of ev.moves.slice(0, 6)) {
          chips.append(el("span", `chip ${m.to < m.from ? "up" : "down"} num`, `${who(m)}  #${m.from} → #${m.to}`));
        }
        card.append(chips);
      }
      head.append(card);
      return;
    }
    if (s.phase === "CALL") {
      const revealed = clock() >= s.phaseStartAt + s.config.timeline.callRevealMs;
      if (!revealed || !s.winner) {
        head.append(el("h2", "q-title drum", s.winner || !revealed ? STR.callDrum : STR.callNoOne));
        return;
      }
      const w = s.winner;
      const u = urgLabel(w.urgency);
      const card = el("div", "call-card");
      card.append(el("div", "call-num num", fmt(STR.callBig, { n: w.pos })));
      const row = el("div", "call-row");
      row.append(el("span", "call-emoji", w.emoji));
      const info = el("div", "call-info");
      info.append(el("div", "call-name", w.nickname));
      info.append(el("div", `call-urg u${w.urgency}`, fmt(STR.callWinnerUrg, u)));
      row.append(info);
      if (w.claimCode) {
        const claim = el("div", "claim-box");
        claim.append(el("span", "label", STR.claimCodeLabel), el("span", "code num", w.claimCode));
        row.append(claim);
      }
      card.append(row);
      const sum = el("div", "call-sum num");
      sum.id = "call-sum";
      sum.textContent = fmt(STR.callSummary, { ...u, red: num(s.waiting ? s.waiting[2] : 0) });
      card.append(sum);
      head.append(card);
    }
  }

  function playEvent(ev) {
    movedNos = new Set(ev.moves.map((m) => m.no));
    movedUntil = Date.now() + 3000;
    SFX.whoosh();
    if (ev.kind === "docs") setTimeout(() => SFX.sad(), 250);
    if (ev.kind === "crash") setTimeout(() => SFX.glitch(), 200);
    if (ev.kind === "cancel") setTimeout(() => SFX.fanfare(), 250);
    if (ev.kind === "gamble") setTimeout(() => SFX.dingdong(), 250);
  }

  // --- guess
  function bucketLabels() {
    return snap.config.guessBuckets.map((_, i) => STR[`guessOpt${i}`]);
  }

  function renderBars(box, counts, correct) {
    const labels = bucketLabels();
    const c = counts || labels.map(() => 0);
    const max = Math.max(1, ...c);
    box.textContent = "";
    labels.forEach((label, i) => {
      const row = el("div", `bar${correct === i ? " correct" : ""}${correct != null && correct !== i ? " wrong" : ""}`);
      const fill = el("div", "fill");
      fill.style.width = `${(c[i] / max) * 100}%`;
      row.append(fill, el("span", "lbl", label), el("span", "cnt num", num(c[i])));
      box.appendChild(row);
    });
  }

  function renderGuess() {
    $("guess-q").textContent = fmt(STR.guessQ, { n: num(snap.joined) });
    renderBars($("guess-bars"), live.guesses, null);
  }

  // --- zoom
  let zoom = null;
  function buildZoom() {
    const s = snap;
    const rooms = s.roomsNeeded || 0;
    const cap = 2400;
    const k = rooms > cap ? Math.ceil(rooms / cap) : 1;
    const count = Math.max(1, Math.ceil(rooms / k));
    const tiles = $("tiles");
    tiles.textContent = "";
    const W = window.innerWidth * 0.9;
    const H = window.innerHeight * 0.5;
    const size = Math.max(4, Math.floor(Math.sqrt((W * H) / count)));
    const cols = Math.max(1, Math.floor(W / size));
    tiles.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
    tiles.style.gridAutoRows = `${size}px`;
    const frag = document.createDocumentFragment();
    const list = [];
    for (let i = 0; i < count; i++) {
      const t = el("div", i === 0 ? "tile ours on" : "tile");
      frag.appendChild(t);
      list.push(t);
    }
    tiles.appendChild(frag);
    // Reveal in random order so the rooms "multiply" across the screen instead of filling a bar.
    const order = list.slice(1);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    zoom = { list: [list[0], ...order], shown: 1, rooms, k };
    renderBars($("zoom-bars"), s.guess.counts, s.guess.correct);
    const right = s.guess.counts && s.guess.correct != null ? s.guess.counts[s.guess.correct] : 0;
    $("zoom-right").textContent = fmt(STR.zoomGuessRight, { n: num(right), total: num(s.guess.answered) });
    $("zt-1").textContent = fmt(STR.zoomLine1, { per100k: String(s.config.stats.psychiatristsPer100k) });
    $("zt-2").textContent = fmt(STR.zoomLine2, { people: num(s.peoplePerPsychiatrist), rooms: num(rooms) });
    $("zt-3").textContent = STR.zoomLine3;
    $("zoom-source").textContent = s.config.stats.sourceLabel + (k > 1 ? ` · ${fmt(STR.zoomScale, { k: num(k) })}` : "");
  }

  function tickZoom(now) {
    if (!zoom) buildZoom();
    const t = now - snap.phaseStartAt;
    const GUESS_UNTIL = 6500;
    const FILL_FROM = 9000;
    const FILL_TO = 18000;
    const TEXT_AT = 19000;
    $("zoom-guess").hidden = t >= GUESS_UNTIL;
    $("zoom-viz").hidden = t < GUESS_UNTIL;
    $("zoom-text").hidden = t < TEXT_AT;
    ["zt-1", "zt-2", "zt-3"].forEach((id, i) => $(id).classList.toggle("on", t >= TEXT_AT + i * 2500));
    $("zoom-viz").classList.toggle("dim", t >= TEXT_AT);

    if (t >= GUESS_UNTIL && !once.has(`zoomin:${snap.phaseStartAt}`)) {
      once.add(`zoomin:${snap.phaseStartAt}`);
      SFX.whoosh();
    }
    const p = Math.max(0, Math.min(1, (t - FILL_FROM) / (FILL_TO - FILL_FROM)));
    const eased = p * p; // slow start, then a flood
    const target = Math.max(1, Math.round(eased * zoom.list.length));
    while (zoom.shown < target) zoom.list[zoom.shown++].classList.add("on");
    const roomsShown = Math.max(1, Math.round(eased * zoom.rooms));
    $("zoom-count").textContent = t < FILL_FROM ? fmt(STR.zoomOurRoom, { n: num(snap.joined) }) : fmt(STR.zoomRooms, { n: num(roomsShown) });
    $("zoom-doc").classList.toggle("on", p >= 1);
    if (p > 0 && p < 1 && Math.random() < 0.3) SFX.tick();
    if (p >= 1 && !once.has(`boom:${snap.phaseStartAt}`)) {
      once.add(`boom:${snap.phaseStartAt}`);
      SFX.boom();
    }
    if (t >= TEXT_AT) setMusicFor("ZOOM");
  }

  // --- end
  function renderEnd() {
    const box = $("end-winner");
    box.textContent = "";
    const w = snap.winner;
    if (!w) return;
    box.append(el("span", "label", STR.endWinner), el("span", "e", w.emoji), el("span", "n", w.nickname));
    if (w.claimCode) box.append(el("span", "code num", w.claimCode));
  }

  // --- reactions
  function floatReact(emoji) {
    const layer = $("reacts-layer");
    if (layer.children.length > 60) return;
    const r = el("span", "react", emoji);
    r.style.left = `${4 + Math.random() * 92}%`;
    r.style.fontSize = `${36 + Math.random() * 30}px`;
    r.style.animationDuration = `${2.2 + Math.random() * 1.2}s`;
    r.addEventListener("animationend", () => r.remove());
    layer.appendChild(r);
  }

  // ------------------------------------------------------------ per-frame updates
  let lastHeartbeat = 0;
  let lastGuessTick = -1;
  function loop() {
    requestAnimationFrame(loop);
    if (!snap) return;
    const now = clock();
    const s = snap;

    // Phase progress bar (autopilot cue).
    const bar = $("phase-bar");
    if (s.phaseEndAt && s.phaseStartAt) {
      bar.hidden = false;
      const p = Math.min(1, Math.max(0, (now - s.phaseStartAt) / (s.phaseEndAt - s.phaseStartAt)));
      $("phase-fill").style.width = `${(p * 100).toFixed(2)}%`;
    } else {
      bar.hidden = true;
    }

    if (stage === "h-race" && s.goAt) {
      const light = $("race-light");
      const msg = $("race-msg");
      if (now < s.goAt) {
        light.className = "light red";
        if (msg.textContent !== STR.raceWait) msg.textContent = STR.raceWait;
        $("race-total").textContent = "";
        $("race-warn").hidden = false;
        if (now - lastHeartbeat > 600 && now >= s.phaseStartAt) {
          lastHeartbeat = now;
          SFX.beep(false);
        }
      } else {
        if (!once.has(`go:${s.goAt}`)) {
          once.add(`go:${s.goAt}`);
          SFX.go();
          setMusicFor("RACE");
        }
        const open = now < s.raceEndAt;
        light.className = open ? "light green" : "light off";
        const text = open ? STR.raceGo : STR.raceOver;
        if (msg.textContent !== text) msg.textContent = text;
        $("race-warn").hidden = true;
        shownTaps += (live.totalTaps - shownTaps) * 0.25;
        if (Math.abs(live.totalTaps - shownTaps) < 0.5) shownTaps = live.totalTaps;
        $("race-total").textContent = num(shownTaps);
        if (!open && !once.has(`end:${s.goAt}`)) {
          once.add(`end:${s.goAt}`);
          SFX.music(null);
          SFX.beep(true);
        }
      }
    }

    if (stage === "h-queue") {
      if (s.phase === "EVENTS") {
        const ev = s.events[s.events.length - 1];
        const g = $("gamble-line");
        if (ev && ev.kind === "gamble" && !ev.resolved && g) {
          const left = Math.max(0, Math.ceil((ev.decideUntil - now) / 1000));
          const t = fmt(STR.ev_gamble_wait, { s: left });
          if (g.textContent !== t) {
            g.textContent = t;
            SFX.tick();
          }
        }
      }
      if (s.phase === "CALL") {
        const revealAt = s.phaseStartAt + s.config.timeline.callRevealMs;
        const k = `call:${s.phaseStartAt}`;
        if (now >= revealAt && !once.has(k)) {
          once.add(k);
          renderHead();
          renderLine();
          if (s.winner) {
            SFX.dingdong();
            setTimeout(() => SFX.say(fmt(STR.callSay, { n: s.winner.pos })), 1300);
            setTimeout(() => SFX.fanfare(), 600);
            confetti($("confetti"), 3500);
          }
        }
        const sum = $("call-sum");
        if (sum) sum.classList.toggle("on", now >= revealAt + 4500);
        setMusicFor("CALL");
      }
      if (Date.now() > movedUntil && movedNos.size) {
        movedNos = new Set();
        renderLine();
      }
    }

    if (stage === "h-guess" && s.phaseEndAt) {
      const left = Math.ceil((s.phaseEndAt - now) / 1000);
      if (left <= 5 && left >= 1 && left !== lastGuessTick) {
        lastGuessTick = left;
        SFX.beep(left === 1);
      }
      $("guess-answered").textContent = fmt(STR.guessAnswered, { n: num((live.guesses || []).reduce((a, b) => a + b, 0)) });
    }

    if (stage === "h-zoom") tickZoom(now);
  }
  requestAnimationFrame(loop);

  window.addEventListener("resize", () => {
    if (snap && stage === "h-queue") renderLine();
  });

  // ------------------------------------------------------------ controls
  let lastNext = 0;
  function next() {
    const t = Date.now();
    if (t - lastNext < 500) return; // debounce accidental double presses
    lastNext = t;
    SFX.unlock();
    net.send({ type: "host:next" });
  }
  function pause() {
    SFX.unlock();
    net.send({ type: "host:pause" });
  }
  function reset() {
    if (confirm(STR.resetConfirm)) {
      zoom = null;
      net.send({ type: "host:reset" });
    }
  }
  function toggleSound() {
    SFX.unlock();
    SFX.setMuted(!SFX.muted);
    if (!SFX.muted && snap) setMusicFor(snap.phase);
    renderLiveText();
  }
  function toggleBar(force) {
    const hide = typeof force === "boolean" ? force : !$("ctl").hidden;
    $("ctl").hidden = hide;
    $("ctl-show").hidden = !hide;
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }

  $("ctl-next").addEventListener("click", next);
  $("ctl-sound").addEventListener("click", toggleSound);
  $("ctl-pause").addEventListener("click", pause);
  $("ctl-reset").addEventListener("click", reset);
  $("ctl-hide").addEventListener("click", () => toggleBar(true));
  $("ctl-show").addEventListener("click", () => toggleBar(false));
  $("ctl-fs").addEventListener("click", fullscreen);

  // Browsers need a gesture before audio can play; any click or key counts.
  document.addEventListener("pointerdown", () => {
    SFX.unlock();
    if (snap) setMusicFor(snap.phase);
  });

  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    SFX.unlock();
    if (snap) setMusicFor(snap.phase);
    switch (e.key) {
      case " ":
      case "ArrowRight":
      case "PageDown": // presentation clickers
        e.preventDefault();
        next();
        break;
      case "p":
      case "P":
        pause();
        break;
      case "m":
      case "M":
        toggleSound();
        break;
      case "r":
      case "R":
        reset();
        break;
      case "h":
      case "H":
        toggleBar();
        break;
      case "f":
      case "F":
        fullscreen();
        break;
    }
  });

  net.start();
})();
