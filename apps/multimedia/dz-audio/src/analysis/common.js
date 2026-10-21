// Helpers shared by the analysis panels.

/** Sizes a canvas to its parent at device resolution; returns { ctx, W, H } in CSS px or null. */
export function fitCanvas(canvas, host = canvas.parentElement) {
  const W = host.clientWidth;
  const H = host.clientHeight;
  if (!W || !H) return null;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

/**
 * Subscribes to the engine's master output tap while `active()` is true.
 * Returns { start(), stop() }; onTap receives { L, R, frame, rate }.
 */
export function masterTap(app, onTap) {
  let off = null;
  return {
    start() {
      if (off) return;
      app.engine.tap(true);
      off = app.engine.on('tap', onTap);
    },
    stop() {
      if (!off) return;
      off();
      off = null;
      app.engine.tap(false);
    },
  };
}

/** "-12.3" style dB text; -Infinity becomes the minus infinity sign. */
export function fmtDb(v, digits = 2) {
  if (v === undefined || v === null || Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v < 0 ? '-∞' : '∞';
  return v.toFixed(digits);
}

export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
