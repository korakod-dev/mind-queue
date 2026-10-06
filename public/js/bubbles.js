/**
 * Bubble-pop mini-game (purely local, canvas).
 *
 *   const game = createBubbles(canvas, onPop);
 *   game.start(); game.stop();
 *
 * Bubbles drift upward with a gentle wobble; tapping one pops it (ring burst) and calls onPop().
 */
(function () {
  const MAX_BUBBLES = 12;
  const HUES = [168, 190, 25, 45, 330, 210];

  window.createBubbles = function createBubbles(canvas, onPop) {
    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let dpr = 1;
    let bubbles = [];
    let bursts = [];
    let raf = 0;
    let last = 0;
    let running = false;

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(initial) {
      const r = 22 + Math.random() * 22;
      bubbles.push({
        x: r + Math.random() * Math.max(1, w - 2 * r),
        y: initial ? Math.random() * h : h + r,
        r,
        speed: 18 + Math.random() * 26, // px/s
        phase: Math.random() * Math.PI * 2,
        hue: HUES[(Math.random() * HUES.length) | 0],
      });
    }

    function draw(b) {
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 80%, 96%, 0.95)`);
      g.addColorStop(0.7, `hsla(${b.hue}, 60%, 75%, 0.35)`);
      g.addColorStop(1, `hsla(${b.hue}, 60%, 55%, 0.55)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${b.hue}, 50%, 45%, 0.35)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000);
      last = t;
      ctx.clearRect(0, 0, w, h);

      while (bubbles.length < MAX_BUBBLES) spawn(false);
      for (const b of bubbles) {
        b.y -= b.speed * dt;
        b.phase += dt * 1.6;
        b.x += Math.sin(b.phase) * 0.4;
        draw(b);
      }
      bubbles = bubbles.filter((b) => b.y + b.r > -4);

      for (const k of bursts) {
        k.t += dt;
        const p = k.t / 0.35;
        ctx.strokeStyle = `hsla(${k.hue}, 60%, 50%, ${1 - p})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(k.x, k.y, k.r * (1 + p * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      }
      bursts = bursts.filter((k) => k.t < 0.35);

      raf = requestAnimationFrame(frame);
    }

    function onPointer(ev) {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      // Topmost bubble under the finger (slightly generous hit radius for fingers).
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if ((x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 8) ** 2) {
          bubbles.splice(i, 1);
          bursts.push({ x: b.x, y: b.y, r: b.r, hue: b.hue, t: 0 });
          if (navigator.vibrate) {
            try {
              navigator.vibrate(8);
            } catch (_) {}
          }
          onPop();
          return;
        }
      }
    }

    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", () => running && resize());

    return {
      start() {
        if (running) return;
        running = true;
        resize();
        bubbles = [];
        for (let i = 0; i < MAX_BUBBLES; i++) spawn(true);
        last = 0;
        raf = requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
      },
    };
  };
})();
