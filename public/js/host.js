/**
 * Host big screen + presenter controls.
 *
 * - Host key: read once from ?key=…, kept in sessionStorage, and removed from the address bar
 *   (the URL is visible on the projector). Sent to the server inside `hello`.
 * - Renders from `state` snapshots (phase changes, draws, "now calling" increments) and from
 *   throttled `live` messages (joined / online / tap & pop totals / roster).
 * - Keyboard: Space or → = next, D = cancellation draw, R = reset (confirm), H = hide bar,
 *   F = fullscreen.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const STR = window.STR;

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
  let live = { joined: 0, connected: 0, totalTaps: 0, totalPops: 0 };
  let roster = [];
  let stage = "h-boot";
  let seenDraws = null; // number of draw winners already announced (null = first snapshot)
  let celebratedRace = false;
  let announceTimer = null;
  let lastLed = null;

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
      live.totalPops = snap.totalPops;
      if (snap.roster) roster = snap.roster;
      onSnapshot(prev);
    } else if (msg.type === "live") {
      // Messages on one socket arrive in order, so the latest live values are authoritative.
      live.joined = msg.joined;
      live.connected = msg.connected;
      live.totalTaps = msg.totalTaps;
      live.totalPops = msg.totalPops;
      if (msg.roster) {
        roster = msg.roster;
        renderRoster();
      }
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
      case "TAP_COUNTDOWN":
      case "TAP_RACE":
        return "h-race";
      case "TAP_RESULT":
        return "h-result";
      case "WAITING_ROOM":
        return "h-waiting";
      case "REVEAL":
        return "h-reveal";
      case "END":
        return "h-end";
    }
    return "h-boot";
  }

  function onSnapshot(prev) {
    const s = snap;
    if (s.phase === "LOBBY") {
      celebratedRace = false;
      seenDraws = 0;
      renderQR();
      renderRoster(true);
    }
    if (s.phase === "TAP_RESULT") renderResult();
    if (s.phase === "WAITING_ROOM" || s.phase === "REVEAL" || s.phase === "END") renderWaiting();
    if (s.phase === "REVEAL") renderReveal(prev);

    // Cancellation draws: announce only draws that happen while we watch.
    const draws = s.winners.filter((w) => w.kind === "draw");
    if (seenDraws !== null && draws.length > seenDraws && s.phase === "WAITING_ROOM") {
      announce(draws[draws.length - 1]);
    }
    seenDraws = draws.length;

    $("ctl-draw").hidden = s.phase !== "WAITING_ROOM";
    show(stageFor(s.phase));
    renderLiveText();
  }

  /** Text that depends on live counters. */
  function renderLiveText() {
    if (!snap) return;
    $("joined").textContent = fmt(STR.joinedCount, { x: num(live.joined), total: num(snap.config.expectedPlayers) });
    $("wait-pops").textContent = fmt(STR.roomPops, { n: num(live.totalPops) });
    $("res-taps").textContent = fmt(STR.roomTaps, { total: num(live.totalTaps) });
    $("ctl-info").textContent = `${snap.phase} · ${fmt(STR.ctlOnline, { n: live.connected })} · ${num(live.joined)}`;
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
      const sp = document.createElement("span");
      sp.textContent = roster[i].emoji;
      sp.title = roster[i].nickname;
      wall.appendChild(sp);
    }
    rosterShown = roster.length;
  }

  // --- result
  function renderResult() {
    const w = snap.winners.find((x) => x.kind === "race");
    if (w) {
      $("res-emoji").textContent = w.emoji;
      $("res-name").textContent = w.nickname;
      $("res-code").textContent = w.claimCode || "";
      $("res-claim").hidden = false;
      if (!celebratedRace) {
        celebratedRace = true;
        confetti($("confetti"), 3500);
      }
    } else {
      $("res-emoji").textContent = "⏳";
      $("res-name").textContent = STR.noWinner;
      $("res-claim").hidden = true;
    }
  }

  // --- waiting room
  function renderWaiting() {
    const led = $("led");
    const called = snap.called == null ? "" : num(snap.called);
    if (led.textContent !== called) {
      led.textContent = called;
      if (lastLed !== null) {
        led.classList.remove("tick");
        void led.offsetWidth;
        led.classList.add("tick");
      }
      lastLed = called;
    }
    $("wait-ahead").textContent = snap.queueAhead == null ? "" : fmt(STR.queueAhead, { n: num(snap.queueAhead) });

    // Winners list (for the snack helper to check claim codes).
    const list = $("winners");
    list.textContent = "";
    for (const w of snap.winners) {
      const row = document.createElement("div");
      row.className = "w";
      const e = document.createElement("span");
      e.className = "e";
      e.textContent = w.emoji;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = w.ticket != null ? `${w.nickname} · #${num(w.ticket)}` : w.nickname;
      const c = document.createElement("span");
      c.className = "c num";
      c.textContent = w.claimCode || "";
      row.append(e, n, c);
      list.appendChild(row);
    }
  }

  function announce(w) {
    $("ann-text").textContent = fmt(STR.cancelDraw, { number: w.ticket != null ? num(w.ticket) : "" });
    $("ann-emoji").textContent = w.emoji;
    $("ann-name").textContent = w.nickname;
    $("ann-code").textContent = w.claimCode || "";
    $("announce").hidden = false;
    confetti($("confetti"), 2500);
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      $("announce").hidden = true;
    }, 10000);
  }

  // --- reveal
  function renderReveal(prev) {
    const s = snap;
    $("rv-called").textContent = s.called == null ? "" : num(s.called);
    $("rv-frozen").hidden = s.revealStep > 0;

    // Each line: template + the values that get highlighted inside it.
    const lines = [
      [STR.reveal1, { psychiatristsPer100k: String(s.config.stats.psychiatristsPer100k) }],
      [STR.reveal2, { peoplePerPsychiatrist: num(s.peoplePerPsychiatrist) }],
      [STR.reveal3, { joined: num(s.joined), roomsNeeded: s.roomsNeeded == null ? "—" : num(s.roomsNeeded) }],
    ];
    for (let i = 0; i < 3; i++) {
      const el = $(`rv-${i + 1}`);
      const visible = s.revealStep >= i + 1;
      el.hidden = !visible;
      if (!visible) continue;
      // Highlight the numbers inside the sentence (built with text nodes, no innerHTML).
      const [tpl, vars] = lines[i];
      el.textContent = "";
      tpl.split(/(\{\w+\})/).forEach((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m && m[1] in vars) {
          const hl = document.createElement("span");
          hl.className = "hl num";
          hl.textContent = vars[m[1]];
          el.append(hl);
        } else if (part) {
          el.append(part);
        }
      });
      const isCurrent = s.revealStep === i + 1;
      const wasCurrent = prev && prev.phase === "REVEAL" && prev.revealStep === i + 1;
      if (isCurrent && !wasCurrent) {
        el.classList.remove("current");
        void el.offsetWidth; // restart the entrance animation
      }
      el.classList.toggle("current", isCurrent);
    }
    $("rv-source").textContent = s.config.stats.sourceLabel;
    $("rv-source").hidden = s.revealStep === 0;
  }

  // ------------------------------------------------------------ per-frame updates
  let shownTaps = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (!snap) return;
    const now = net.now();

    if (stage === "h-race") {
      const big = $("race-big");
      if (now < snap.startAt) {
        const n = Math.min(snap.config.countdownSeconds, Math.ceil((snap.startAt - now) / 1000));
        big.textContent = String(n);
        $("race-bar").style.width = "0%";
        $("race-sub").textContent = STR.getReady;
        shownTaps = 0;
      } else {
        // Ease the displayed total toward the live total (animated counter).
        shownTaps += (live.totalTaps - shownTaps) * 0.25;
        if (Math.abs(live.totalTaps - shownTaps) < 0.5) shownTaps = live.totalTaps;
        big.textContent = num(shownTaps);
        const total = snap.endAt - snap.startAt;
        const p = Math.min(1, Math.max(0, (now - snap.startAt) / total));
        $("race-bar").style.width = `${(p * 100).toFixed(1)}%`;
        $("race-sub").textContent = fmt(STR.timeLeft, { s: Math.max(0, Math.ceil((snap.endAt - now) / 1000)) });
      }
    }

    if (stage === "h-waiting" && snap.waitEndAt != null) {
      const left = Math.max(0, Math.ceil((snap.waitEndAt - now) / 1000));
      const t = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      const el = $("wait-timer");
      if (el.textContent !== t) el.textContent = t;
    }
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------ controls
  let lastNext = 0;
  function next() {
    const t = Date.now();
    if (t - lastNext < 350) return; // debounce accidental double presses
    lastNext = t;
    net.send({ type: "host:next" });
  }
  function draw() {
    net.send({ type: "host:draw" });
  }
  function reset() {
    if (confirm(STR.resetConfirm)) net.send({ type: "host:reset" });
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
  $("ctl-draw").addEventListener("click", draw);
  $("ctl-reset").addEventListener("click", reset);
  $("ctl-hide").addEventListener("click", () => toggleBar(true));
  $("ctl-show").addEventListener("click", () => toggleBar(false));
  $("ctl-fs").addEventListener("click", fullscreen);

  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case " ":
      case "ArrowRight":
      case "PageDown": // presentation clickers
        e.preventDefault();
        next();
        break;
      case "d":
      case "D":
        draw();
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
