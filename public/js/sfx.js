/**
 * SFX — big-screen sound, synthesized with Web Audio (no audio files, no copyright issues).
 *
 * Browsers only allow audio after a user gesture, so call SFX.unlock() from a click/keydown
 * (the presenter's "start" press). Every call is a no-op until then, or while muted.
 *
 *   SFX.music(mode)   background loop: "lobby" | "tension" | "frenzy" | "calm" | null (stop)
 *   SFX.beep(hi)      countdown blip        SFX.go()        green-light chime
 *   SFX.tap()         one tap click         SFX.whoosh()    card swoosh
 *   SFX.dingdong()    hospital queue chime  SFX.drumroll(ms)
 *   SFX.fanfare()     win                   SFX.sad()       descending "wah wah"
 *   SFX.glitch()      system crash          SFX.boom()      low impact
 *   SFX.say(text)     Thai text-to-speech when the OS has a Thai voice (macOS: Kanya)
 */
(function () {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let noiseBuf = null;

  const MUTE_KEY = "mq.muted";
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch (_) {}

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.32;
      musicGain.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    // Warm up speech so the first announcement is not delayed.
    if (window.speechSynthesis) speechSynthesis.getVoices();
  }

  const ready = () => ctx && ctx.state === "running" && !muted;

  function setMuted(m) {
    muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch (_) {}
    if (master) master.gain.value = m ? 0 : 0.8;
    if (m && window.speechSynthesis) speechSynthesis.cancel();
  }

  /** One enveloped oscillator note. */
  function tone(freq, start, dur, { type = "sine", vol = 0.3, dest = master, slideTo = null } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  function noise(start, dur, { vol = 0.2, freq = 2000, q = 1, type = "bandpass", dest = master } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.05);
  }

  // ------------------------------------------------------------ one-shots
  const fx = {
    beep(hi) {
      if (!ready()) return;
      tone(hi ? 1320 : 880, ctx.currentTime, 0.18, { type: "square", vol: 0.12 });
    },
    go() {
      if (!ready()) return;
      const t = ctx.currentTime;
      [784, 1047, 1568].forEach((f, i) => tone(f, t + i * 0.06, 0.5, { type: "triangle", vol: 0.25 }));
    },
    tap() {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, 0.04, { vol: 0.08 + Math.random() * 0.06, freq: 2500 + Math.random() * 2500, q: 3 });
    },
    whoosh() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 2;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(4000, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.5);
    },
    dingdong() {
      if (!ready()) return;
      const t = ctx.currentTime;
      // Classic two-tone hospital/airport chime: E5 then C5, bell-like partials.
      [[659, 0], [523, 0.55]].forEach(([f, d]) => {
        tone(f, t + d, 1.6, { type: "sine", vol: 0.35 });
        tone(f * 2, t + d, 0.9, { type: "sine", vol: 0.08 });
        tone(f * 3.01, t + d, 0.5, { type: "sine", vol: 0.04 });
      });
    },
    drumroll(ms = 2400) {
      if (!ready()) return;
      const t = ctx.currentTime;
      const n = Math.floor(ms / 45);
      for (let i = 0; i < n; i++) {
        const p = i / n;
        noise(t + i * 0.045, 0.06, { vol: 0.08 + p * 0.22, freq: 900, q: 0.8 });
      }
      tone(110, t + ms / 1000, 0.5, { type: "sine", vol: 0.5, slideTo: 50 });
      noise(t + ms / 1000, 0.5, { vol: 0.35, freq: 5000, q: 0.5, type: "highpass" });
    },
    fanfare() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const notes = [523, 659, 784, 1047, 784, 1047];
      const times = [0, 0.12, 0.24, 0.36, 0.6, 0.72];
      notes.forEach((f, i) => {
        const dur = i === notes.length - 1 ? 1.0 : 0.2;
        tone(f, t + times[i], dur, { type: "sawtooth", vol: 0.1 });
        tone(f / 2, t + times[i], dur, { type: "triangle", vol: 0.12 });
      });
    },
    sad() {
      if (!ready()) return;
      const t = ctx.currentTime;
      [392, 370, 349].forEach((f, i) => tone(f, t + i * 0.35, 0.34, { type: "sawtooth", vol: 0.09 }));
      tone(330, t + 1.05, 0.9, { type: "sawtooth", vol: 0.09, slideTo: 300 });
    },
    glitch() {
      if (!ready()) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 10; i++) {
        tone(200 + Math.random() * 1800, t + i * 0.05, 0.05, { type: "square", vol: 0.08 });
      }
      noise(t, 0.5, { vol: 0.15, freq: 1200, q: 6 });
    },
    boom() {
      if (!ready()) return;
      const t = ctx.currentTime;
      tone(90, t, 0.9, { type: "sine", vol: 0.6, slideTo: 35 });
      noise(t, 0.4, { vol: 0.25, freq: 300, q: 0.7, type: "lowpass" });
    },
    tick() {
      if (!ready()) return;
      tone(1800, ctx.currentTime, 0.03, { type: "square", vol: 0.06 });
    },
    say(text) {
      if (muted || !window.speechSynthesis) return;
      const voices = speechSynthesis.getVoices();
      const th = voices.find((v) => /^th/i.test(v.lang));
      if (!th) return; // no Thai voice on this machine → the ding-dong alone
      const u = new SpeechSynthesisUtterance(text);
      u.voice = th;
      u.lang = th.lang;
      u.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
  };

  // ------------------------------------------------------------ background music
  // A tiny step sequencer: bass + chords + hats, scheduled slightly ahead of time.
  const MODES = {
    lobby: { bpm: 96, bass: [45, 45, 52, 50], hat: 0.04, chord: true, kick: false },
    calm: { bpm: 80, bass: [48, 43, 45, 41], hat: 0.0, chord: true, kick: false },
    tension: { bpm: 120, bass: [40, 40, 40, 41], hat: 0.06, chord: false, kick: true },
    frenzy: { bpm: 168, bass: [45, 45, 48, 50], hat: 0.09, chord: false, kick: true },
  };
  let mode = null;
  let step = 0;
  let nextAt = 0;
  let timer = null;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function schedule() {
    if (!ctx || !mode) return;
    const m = MODES[mode];
    const stepDur = 60 / m.bpm / 2; // 8th notes
    while (nextAt < ctx.currentTime + 0.15) {
      if (!muted && ctx.state === "running") {
        const bar = Math.floor(step / 8) % m.bass.length;
        const root = m.bass[bar];
        if (step % 2 === 0) tone(midi(root), nextAt, stepDur * 1.6, { type: "triangle", vol: 0.32, dest: musicGain });
        if (m.kick && step % 4 === 0) tone(120, nextAt, 0.18, { type: "sine", vol: 0.5, dest: musicGain, slideTo: 45 });
        if (m.hat && step % 2 === 1) noise(nextAt, 0.05, { vol: m.hat, freq: 8000, q: 1, type: "highpass", dest: musicGain });
        if (m.chord && step % 8 === 0) {
          [12, 16, 19].forEach((iv) => tone(midi(root + iv + 12), nextAt, stepDur * 7, { type: "sine", vol: 0.05, dest: musicGain }));
        }
        if (m.chord && step % 8 === 3) tone(midi(root + 24 + 7), nextAt, stepDur, { type: "sine", vol: 0.04, dest: musicGain });
      }
      nextAt += stepDur;
      step++;
    }
  }

  function music(next) {
    if (next === mode) return;
    mode = next && MODES[next] ? next : null;
    clearInterval(timer);
    timer = null;
    if (!mode || !ctx) return;
    step = 0;
    nextAt = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 50);
    schedule();
  }

  window.SFX = Object.assign(fx, {
    unlock,
    music(next) {
      if (!ctx) {
        mode = null;
        pendingMode = next;
        return;
      }
      music(next);
    },
    setMuted,
    get muted() {
      return muted;
    },
    get unlocked() {
      return !!ctx;
    },
  });

  // Music requested before unlock starts as soon as audio is unlocked.
  let pendingMode = null;
  const origUnlock = unlock;
  window.SFX.unlock = function () {
    const first = !ctx;
    origUnlock();
    if (first && pendingMode) music(pendingMode);
  };
})();
