import { describe, it, expect } from 'vitest';
import { makeScale, frequencyTicks, formatHz, noteName, zoomRange, LOG_FLOOR_HZ } from '../src/spectral/freq-scale.js';
import { COLORMAPS, buildLut, sampleMap, luminance } from '../src/spectral/colormaps.js';

describe('frequency scale', () => {
  it('maps linearly and back', () => {
    const s = makeScale({ log: false, lo: 0, hi: 22050 });
    expect(s.toHz(0)).toBe(0);
    expect(s.toHz(1)).toBe(22050);
    expect(s.toFrac(11025)).toBeCloseTo(0.5);
    for (const f of [10, 440, 9000]) expect(s.toHz(s.toFrac(f))).toBeCloseTo(f);
  });
  it('maps logarithmically with equal space per octave', () => {
    const s = makeScale({ log: true, lo: 0, hi: 20480 });
    expect(s.lo).toBe(LOG_FLOOR_HZ);
    const a = s.toFrac(100);
    const b = s.toFrac(200);
    const c = s.toFrac(400);
    expect(b - a).toBeCloseTo(c - b);
    expect(s.toHz(s.toFrac(1234))).toBeCloseTo(1234);
    expect(s.toFrac(20480)).toBeCloseTo(1);
  });
  it('labels ticks without crowding', () => {
    for (const log of [true, false]) {
      const s = makeScale({ log, lo: 0, hi: 24000 });
      const ticks = frequencyTicks(s, 300, 18);
      expect(ticks.length).toBeGreaterThan(3);
      const ys = ticks.map((t) => t.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(17.9);
      for (const t of ticks) expect(t.y).toBeCloseTo((1 - s.toFrac(t.f)) * 300);
    }
    const log = frequencyTicks(makeScale({ log: true, lo: 0, hi: 24000 }), 400);
    expect(log.map((t) => t.label)).toContain('1k');
    expect(log.map((t) => t.label)).toContain('100');
  });
  it('formats frequencies and notes', () => {
    expect(formatHz(950)).toBe('950');
    expect(formatHz(1000)).toBe('1k');
    expect(formatHz(1500)).toBe('1.5k');
    expect(formatHz(12000)).toBe('12k');
    expect(noteName(440)).toMatchObject({ name: 'A4', cents: 0 });
    expect(noteName(261.63).name).toBe('C4');
    expect(noteName(450).cents).toBe(39);
    expect(noteName(0)).toBe(null);
  });
  it('zooms the visible band around a centre', () => {
    const r = zoomRange({ lo: 0, hi: 24000 }, 0.5, 24000, false);
    expect(r.lo).toBeCloseTo(6000);
    expect(r.hi).toBeCloseTo(18000);
    const back = zoomRange(r, 2, 24000, false);
    expect(back.lo).toBeCloseTo(0);
    expect(back.hi).toBeCloseTo(24000);
    const lg = zoomRange({ lo: 0, hi: 20480 }, 0.5, 24000, true, 640);
    expect(lg.lo).toBeGreaterThan(20);
    expect(lg.hi).toBeLessThan(20480);
    expect(Math.log(640 / lg.lo)).toBeCloseTo(Math.log(lg.hi / 640) * (Math.log(640 / 20) / Math.log(20480 / 640)), 1);
  });
});

describe('colour maps', () => {
  it('rise in lightness and reverse on the light theme', () => {
    for (const id of Object.keys(COLORMAPS)) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const l = luminance(sampleMap(id, i / 20));
        expect(l).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = l;
      }
      const dark = buildLut(id, false);
      const light = buildLut(id, true);
      // Light: quiet is paper white, loud is the dark end of the map.
      expect(Array.from(light.slice(0, 3))).toEqual([251, 251, 251]);
      expect(Array.from(light.slice(255 * 4, 255 * 4 + 3))).toEqual(Array.from(dark.slice(0, 3)));
      const lum = (lut, i) => luminance([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]);
      for (let i = 8; i < 256; i += 8) expect(lum(light, i)).toBeLessThanOrEqual(lum(light, i - 8) + 1e-9);
      expect(dark[3]).toBe(255);
    }
  });
});
