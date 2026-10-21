// Transfer curves (input to output level in dB) of Dynamics Processing:
// straight segments, or a monotone spline with Spline Curves. No imports, so
// dialogs can use them without registering effects.

/**
 * Output level (dB) of a drawn transfer curve at input level `x`: linear
 * between points, the first point's gain below it and the last segment's
 * slope above it (as wasm/dsp/src/fx/dynamics/curve.rs evaluates it).
 */
export function curveOutput(points, x) {
  const pts = [...(points || [])].sort((a, b) => a.x - b.x);
  if (!pts.length) return x;
  if (pts.length === 1 || x <= pts[0].x) return x + pts[0].y - pts[0].x;
  for (let k = 1; k < pts.length; k++) {
    const b = pts[k];
    if (x <= b.x || k === pts.length - 1) {
      const a = pts[k - 1];
      const w = b.x - a.x;
      return w > 1e-6 ? a.y + ((b.y - a.y) * (x - a.x)) / w : b.y;
    }
  }
  return x;
}

/**
 * Output level (dB) of a transfer curve drawn with Spline Curves: a monotone
 * cubic through the points (Fritsch-Carlson), so the curve bends smoothly at
 * each point without overshooting between them. Outside the points it
 * continues as curveOutput does.
 */
export function splineOutput(points, x) {
  const pts = [...(points || [])].sort((a, b) => a.x - b.x).filter((p, i, a) => i === 0 || p.x - a[i - 1].x > 1e-6);
  const n = pts.length;
  if (n < 3 || x <= pts[0].x || x >= pts[n - 1].x) return curveOutput(pts, x);
  const d = [];
  for (let k = 0; k < n - 1; k++) d.push((pts[k + 1].y - pts[k].y) / (pts[k + 1].x - pts[k].x));
  const m = [d[0]];
  for (let k = 1; k < n - 1; k++) m.push(d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2);
  m.push(d[n - 2]);
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const r = a * a + b * b;
    if (r > 9) {
      const t = 3 / Math.sqrt(r);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  let k = 1;
  while (pts[k].x < x) k++;
  const p0 = pts[k - 1];
  const p1 = pts[k];
  const hgt = p1.x - p0.x;
  const t = (x - p0.x) / hgt;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0.y + (t3 - 2 * t2 + t) * hgt * m[k - 1] + (-2 * t3 + 3 * t2) * p1.y + (t3 - t2) * hgt * m[k];
}
