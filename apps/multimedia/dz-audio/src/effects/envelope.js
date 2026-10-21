// Breakpoint envelope model for envelope effects (fade, gain envelope, pitch
// bend). Points are { t, v } with t in [0, 1] across the processed range and v
// in the parameter's unit. The first and last points stay pinned to t = 0 and
// t = 1; points keep their order (a dragged point cannot pass a neighbour).

export const MIN_GAP = 0.001;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function sortPoints(points) {
  return points.slice().sort((a, b) => a.t - b.t);
}

/** Valid envelope: sorted, at least two points, ends pinned, values in range. */
export function normalizeEnvelope(points, { min = -Infinity, max = Infinity } = {}) {
  let p = sortPoints((points || []).map((q) => ({ t: clamp(Number(q.t) || 0, 0, 1), v: clamp(Number(q.v) || 0, min, max) })));
  if (!p.length) p = [{ t: 0, v: clamp(0, min, max) }, { t: 1, v: clamp(0, min, max) }];
  if (p.length === 1) p = [{ t: 0, v: p[0].v }, { t: 1, v: p[0].v }];
  p[0] = { ...p[0], t: 0 };
  p[p.length - 1] = { ...p[p.length - 1], t: 1 };
  return p;
}

/** Linear (or smooth, cosine-eased) value at position t. */
export function valueAt(points, t, smooth = false) {
  if (!points.length) return 0;
  if (t <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (i < points.length && points[i].t < t) i++;
  const a = points[i - 1];
  const b = points[i];
  let x = (t - a.t) / (b.t - a.t || 1);
  if (smooth) x = 0.5 - 0.5 * Math.cos(Math.PI * x);
  return a.v + (b.v - a.v) * x;
}

/** Inserts a point at t with value v (or the curve's value there); returns { points, index }. */
export function addPoint(points, t, v = valueAt(points, t)) {
  t = clamp(t, MIN_GAP, 1 - MIN_GAP);
  const next = points.slice();
  let i = next.findIndex((p) => p.t > t);
  if (i < 0) i = next.length - 1;
  if (i === 0) i = 1;
  const prev = next[i - 1];
  if (t - prev.t < MIN_GAP || next[i].t - t < MIN_GAP) return { points, index: -1 };
  next.splice(i, 0, { t, v });
  return { points: next, index: i };
}

/** Moves point i, keeping order and pinned ends; returns the new list. */
export function movePoint(points, i, t, v, { min = -Infinity, max = Infinity } = {}) {
  const next = points.slice();
  const last = next.length - 1;
  let nt = t;
  if (i === 0) nt = 0;
  else if (i === last) nt = 1;
  else nt = clamp(t, next[i - 1].t + MIN_GAP, next[i + 1].t - MIN_GAP);
  next[i] = { t: nt, v: clamp(v, min, max) };
  return next;
}

/** Removes point i unless it is an end point. */
export function removePoint(points, i) {
  if (i <= 0 || i >= points.length - 1) return points;
  return points.filter((_, k) => k !== i);
}

/** Samples the envelope for n frames into a Float32Array (optionally mapping v through fn). */
export function renderEnvelope(points, n, { smooth = false, map = (v) => v } = {}) {
  const out = new Float32Array(n);
  if (!n) return out;
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    while (seg < points.length - 1 && points[seg].t < t) seg++;
    const a = points[seg - 1] || points[0];
    const b = points[seg] || a;
    let x = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    x = clamp(x, 0, 1);
    if (smooth) x = 0.5 - 0.5 * Math.cos(Math.PI * x);
    out[k] = map(a.v + (b.v - a.v) * x);
  }
  return out;
}
