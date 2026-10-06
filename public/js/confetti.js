/**
 * Tiny canvas confetti (no library): confetti(canvas, durationMs).
 * Paper rectangles in the page palette; pointer-events are off on the canvas.
 */
(function () {
  const COLORS = ["#2e8c80", "#f6b48c", "#f7d488", "#7fd6c9", "#e98aa2", "#9cc5f0"];

  window.confetti = function confetti(canvas, durationMs = 2800) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.hidden = false;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const parts = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 11 - 4,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    }));

    const start = performance.now();
    function frame(t) {
      const elapsed = t - start;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.max(0, 1 - elapsed / durationMs);
      for (const p of parts) {
        p.vy += 0.28; // gravity
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (elapsed < durationMs) requestAnimationFrame(frame);
      else canvas.hidden = true;
    }
    requestAnimationFrame(frame);
  };
})();
