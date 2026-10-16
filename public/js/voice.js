/**
 * Voice — recorded voice-over clips for the big screen (public/voice/V00–V11.m4a).
 *
 *   Voice.load(ids)  preload every clip; resolves true only if all of them can play
 *   Voice.play(id)   play one clip (stops the previous one); music is ducked while it plays
 *   Voice.stop() / pause() / resume() / setMuted(bool) / playing (getter)
 *
 * A clip that fails to play is skipped silently, so the game never waits on audio.
 */
(function () {
  const clips = {};
  let current = null;
  let muted = false;

  function duck(on) {
    if (window.SFX && SFX.duck) SFX.duck(on);
  }

  function load(ids) {
    return Promise.all(
      ids.map(
        (id) =>
          new Promise((res) => {
            const a = new Audio(`/voice/${id}.m4a`);
            a.preload = "auto";
            const done = (ok) => {
              a.oncanplaythrough = a.onerror = null;
              if (ok) clips[id] = a;
              res(ok);
            };
            a.oncanplaythrough = () => done(true);
            a.onerror = () => done(false);
            setTimeout(() => done(a.readyState >= 3), 15000);
            a.load();
          }),
      ),
    ).then((oks) => oks.every(Boolean));
  }

  function stop() {
    if (current) {
      current.pause();
      current.currentTime = 0;
      current = null;
    }
    duck(false);
  }

  function play(id) {
    const a = clips[id];
    if (!a) return false;
    stop();
    current = a;
    a.muted = muted;
    a.currentTime = 0;
    a.onended = () => {
      if (current === a) current = null;
      duck(false);
    };
    duck(true);
    const p = a.play();
    if (p && p.catch) {
      p.catch(() => {
        if (current === a) current = null;
        duck(false);
      });
    }
    return true;
  }

  window.Voice = {
    load,
    play,
    stop,
    pause() {
      if (current && !current.paused) current.pause();
    },
    resume() {
      if (current && current.paused) current.play().catch(() => {});
    },
    setMuted(m) {
      muted = m;
      if (current) current.muted = m;
    },
    get playing() {
      return !!current && !current.paused;
    },
  };
})();
