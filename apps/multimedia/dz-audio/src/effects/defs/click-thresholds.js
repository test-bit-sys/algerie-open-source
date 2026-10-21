// Click/Pop Eliminator thresholds, shared by the effect (worker), the
// diagnostics kernels and the dialog. No imports, so every worker can load it.
//
// Detection and repair thresholds depend on the level of the audio around a
// click: a click inside loud music needs more strength to count than one in a
// quiet passage. Each threshold is a curve through three points (at the
// minimum, average and maximum level, in dB), straight between them and flat
// beyond. A click's strength is its residual peak in multiples of the local
// residual level, shown on a 0..150 threshold scale (strengthOf). A click is
// detected at or above the Detect curve; with Second Level Verification on it
// is repaired only at or above the Reject curve as well.

/** Threshold scale value to a residual multiple (and back). */
export const thresholdMultiple = (t) => 2 + Math.max(0, t) * 0.2;
export const strengthOf = (multiple) => Math.max(0, (multiple - 2) / 0.2);

/** Lowest level the threshold graph shows (dB). */
export const LEVEL_FLOOR = -80;

const POINTS = [['Min', 'levelMin'], ['Avg', 'levelAvg'], ['Max', 'levelMax']];

/** A threshold curve ('detect' or 'reject') as [{ db, t, id, levelId }], sorted by level. */
export function thresholdPoints(v, which) {
  return POINTS.map(([k, levelId]) => ({ db: v[levelId], t: v[`${which}${k}`], id: `${which}${k}`, levelId })).sort((a, b) => a.db - b.db);
}

/** A curve's threshold at `db`: straight lines between its points, flat beyond. */
export function thresholdAt(points, db) {
  if (db <= points[0].db) return points[0].t;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (db <= b.db) {
      const a = points[i - 1];
      return a.t + ((b.t - a.t) * (db - a.db)) / (b.db - a.db || 1);
    }
  }
  return points[points.length - 1].t;
}

/** Residual multiple the detector must find everywhere: the lowest point of the Detect curve. */
export const detectionFloor = (v) => thresholdMultiple(Math.min(v.detectMin, v.detectAvg, v.detectMax));

/** Longest click repaired (samples): the run size, four times longer when big pops are detected. */
export const maxRunOf = (v) => Math.round(v.runSize * (v.bigPops ? 4 : 1));

/**
 * What the thresholds make of a click: 0 not detected, 1 detected but not
 * repaired (below the Reject curve), 2 repaired. `click` is { strength
 * (threshold scale), db (level around it), core (samples) }.
 */
export function clickVerdict(click, v) {
  const detect = thresholdAt(thresholdPoints(v, 'detect'), click.db);
  if (click.strength < detect) return 0;
  // Light crackle: short clicks that barely pass detection.
  if (v.crackle && click.core <= 4 && click.strength < detect * 2 + 10) return 0;
  if (v.verify && click.strength < thresholdAt(thresholdPoints(v, 'reject'), click.db)) return 1;
  return 2;
}

/** Click length without the oversampling around it (find_clicks pads both sides). */
export const coreLength = (len, oversample) => Math.max(1, Math.round((len - 2) / (1 + 2 * oversample)));

/**
 * Detect and Reject thresholds from Sensitivity and Discrimination (Scan For
 * All Levels): the detection level of the plain DeClicker at the average
 * level, eased to 80 % at the minimum and doubled at the maximum (loud
 * passages hide more false clicks); Reject asks for Discrimination % more.
 */
export function autoThresholds(v) {
  const base = (100 - v.sensitivity) * 0.75;
  const out = {};
  for (const [k, f] of [['Min', 0.8], ['Avg', 1], ['Max', 2]]) {
    const d = Math.min(150, base * f);
    out[`detect${k}`] = Math.round(d);
    out[`reject${k}`] = Math.round(Math.min(150, strengthOf(thresholdMultiple(d) * (1 + v.discrimination / 100))));
  }
  return out;
}

/**
 * Minimum, average and maximum level from window levels in dB (Scan For
 * Threshold Levels): the loudest window, the mean, and the 10th percentile of
 * the windows that are not silent.
 */
export function levelStats(dbs) {
  const live = [...dbs].filter((d) => Number.isFinite(d) && d > LEVEL_FLOOR).sort((a, b) => a - b);
  if (!live.length) return null;
  const r = (x) => Math.round(x * 10) / 10;
  const avg = live.reduce((s, d) => s + d, 0) / live.length;
  const max = live[live.length - 1];
  const min = live[Math.floor(live.length * 0.1)];
  // Keep the three points apart so the curves stay well defined.
  return { levelMax: r(max), levelAvg: r(Math.min(avg, max - 1)), levelMin: r(Math.min(min, avg - 2, max - 2)) };
}

/** RMS level in dB of x[a, b) and x[c, d) together (the audio around a click). */
export function aroundDb(x, a, b, c, d) {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++, n++) s += x[i] * x[i];
  for (let i = Math.max(0, c); i < Math.min(x.length, d); i++, n++) s += x[i] * x[i];
  return n && s > 0 ? Math.max(LEVEL_FLOOR - 20, 10 * Math.log10(s / n)) : LEVEL_FLOOR - 20;
}

/** Samples of audio either side of a click that set its level. */
export const LEVEL_WINDOW = 1024;
