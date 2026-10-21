// Colour maps for the spectral display: level (0 = floor, 1 = loudest) to an
// RGBA lookup table the fragment shader samples. Stops are original, chosen
// to rise steadily in lightness so loudness reads correctly in any hue. On
// the light theme a map is reversed: quiet is pale, loud is dark.

export const COLORMAPS = {
  ember: {
    label: 'Ember',
    stops: [
      [0, '#05040c'],
      [0.18, '#24104a'],
      [0.38, '#5f1a78'],
      [0.56, '#a8306a'],
      [0.72, '#e2563f'],
      [0.87, '#f9a33a'],
      [1, '#fdf2b4'],
    ],
  },
  ocean: {
    label: 'Ocean',
    stops: [
      [0, '#03060c'],
      [0.2, '#0b2148'],
      [0.42, '#11507e'],
      [0.62, '#1b8a9c'],
      [0.8, '#4cc3b0'],
      [1, '#e8fbf0'],
    ],
  },
  aurora: {
    label: 'Aurora',
    stops: [
      [0, '#040806'],
      [0.22, '#0c2d22'],
      [0.45, '#1e6b3e'],
      [0.66, '#5fa83a'],
      [0.84, '#c8d84a'],
      [1, '#fbf8d8'],
    ],
  },
  mono: {
    label: 'Monochrome',
    stops: [
      [0, '#000000'],
      [1, '#ffffff'],
    ],
  },
};

export const DEFAULT_COLORMAP = 'ember';

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour of level t (0..1) in a map, as [r, g, b] bytes. */
export function sampleMap(id, t) {
  const stops = (COLORMAPS[id] || COLORMAPS[DEFAULT_COLORMAP]).stops;
  t = Math.max(0, Math.min(1, t));
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < t) i++;
  const [t0, c0] = stops[i - 1];
  const [t1, c1] = stops[i];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const a = hex(c0);
  const b = hex(c1);
  return a.map((v, k) => Math.round(v + (b[k] - v) * u));
}

const PAPER = [251, 251, 251];

/**
 * 256-entry RGBA table. `light` reverses the map for the light theme and
 * fades its quietest levels into the paper white of the editor background.
 */
const lutMemo = new Map();

export function buildLut(id, light = false) {
  const key = `${id}/${light}`;
  if (!lutMemo.has(key)) lutMemo.set(key, makeLut(id, light));
  return lutMemo.get(key);
}

function makeLut(id, light) {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let c = sampleMap(id, light ? 1 - t : t);
    if (light && t < 0.25) {
      const u = 1 - t / 0.25;
      c = c.map((v, k) => Math.round(v + (PAPER[k] - v) * u));
    }
    lut.set([c[0], c[1], c[2], 255], i * 4);
  }
  return lut;
}

/** Relative luminance (0..1) of an sRGB byte triple, for tests and contrast. */
export function luminance([r, g, b]) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
