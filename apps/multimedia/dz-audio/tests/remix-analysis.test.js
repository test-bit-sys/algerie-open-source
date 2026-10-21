// Clip remix DSP on synthetic music: tempo, beats and per-beat features,
// the jump candidates and path search, and the crossfaded splice.
import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { analyzeMusic, estimateTempo, onsetEnvelope, frameFeatures, jumpCandidates, planRemix, renderRemix, editShape, segmentsLength } from '../src/multitrack/remix-analysis.js';
import { spliceChannels } from '../src/multitrack/remix.js';
import { song, songAnalysis as cachedSong, MUSIC_RATE as RATE } from './helpers/music.js';

const songAnalysis = () => cachedSong(analyzeMusic);

describe('remix analysis', () => {
  it('finds the tempo and a beat every half second at 120 BPM', async () => {
    const { an } = await songAnalysis();
    expect(an.bpm).toBeGreaterThan(118);
    expect(an.bpm).toBeLessThan(122);
    expect(an.period / RATE).toBeCloseTo(0.5, 1);
    const beats = Array.from(an.beats, (b) => b / RATE);
    expect(beats.length).toBeGreaterThanOrEqual(60);
    // Each cut sits shortly before an onset (on the half-second grid).
    for (const b of beats) {
      const next = Math.ceil(b / 0.5 - 1e-9) * 0.5;
      expect(next - b).toBeGreaterThanOrEqual(0);
      expect(next - b).toBeLessThan(0.06);
    }
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeCloseTo(0.5, 1);
  });

  it('estimates other tempos from the onset curve', async () => {
    for (const bpm of [90, 140]) {
      const x = song({ bpm, bars: 10 });
      const fr = await frameFeatures(x, RATE);
      const t = estimateTempo(onsetEnvelope(fr.flux), RATE, fr.hop);
      expect(Math.abs(t.bpm - bpm)).toBeLessThan(2.5);
    }
  });

  it('describes each beat by its harmony: the chord root leads the pitch-class profile', async () => {
    const { an } = await songAnalysis();
    // Pitch classes from A: A = 0, C = 3, E = 7, G = 10.
    const expected = [0, 3, 7, 10];
    let right = 0;
    an.beats.forEach((b, k) => {
      const mid = b / RATE + 0.1;
      const bar = Math.floor(Math.floor(mid / 0.5) / 4);
      const c = an.chroma[k];
      const top = c.indexOf(Math.max(...c));
      if (top === expected[bar % 4]) right++;
    });
    expect(right / an.beats.length).toBeGreaterThan(0.9);
    expect(an.timbre[0].length).toBe(13);
  });

  it('prefers jumps to the same place in the chord cycle, bar-aligned', async () => {
    const { an } = await songAnalysis();
    const cands = jumpCandidates(an, { balance: 0.5 });
    // From a beat in the middle, the cheapest jumps continue a whole cycle (16 beats) away.
    for (const i of [10, 20, 33]) {
      const best = cands[i].slice(0, 2);
      for (const j of best) expect(Math.abs(j.to - (i + 1)) % 16).toBe(0);
      expect(best[0].cost).toBeLessThan(cands[i][cands[i].length - 1].cost);
    }
    // Limits: no jump farther than maxJump, none shorter than two beats, none before `first`.
    const near = jumpCandidates(an, { maxJump: 8, first: 6 });
    for (let i = 0; i < near.length; i++) {
      for (const c of near[i]) {
        expect(Math.abs(c.to - (i + 1))).toBeLessThanOrEqual(8);
        expect(Math.abs(c.to - (i + 1))).toBeGreaterThanOrEqual(2);
        expect(c.to).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

describe('remix path search', () => {
  const beatSet = (an) => new Set(Array.from(an.beats));
  const check = (an, plan, start) => {
    expect(plan.segments[0][0]).toBe(start);
    expect(plan.segments[plan.segments.length - 1][1]).toBe(an.length);
    expect(plan.length).toBe(segmentsLength(plan.segments));
    expect(plan.jumps).toBe(plan.segments.length - 1);
    const beats = beatSet(an);
    // Every cut and every landing is on a beat.
    plan.segments.forEach(([a, b], i) => {
      if (i > 0) expect(beats.has(a)).toBe(true);
      if (i < plan.segments.length - 1) expect(beats.has(b)).toBe(true);
      expect(b).toBeGreaterThan(a);
    });
  };

  it('keeps the song whole when the target is its natural length', async () => {
    const { an } = await songAnalysis();
    const plan = planRemix(an, { start: 0, target: an.length });
    expect(plan.segments).toEqual([[0, an.length]]);
    expect(plan.fits).toBe(true);
  });

  it('shortens and lengthens to within a beat of the target, from the start to the natural end', async () => {
    const { an } = await songAnalysis();
    for (const seconds of [20, 48]) {
      const plan = planRemix(an, { start: 0, target: seconds * RATE });
      check(an, plan, 0);
      expect(plan.fits).toBe(true);
      expect(Math.abs(plan.length - seconds * RATE)).toBeLessThanOrEqual(plan.tolerance);
      expect(plan.tolerance).toBeLessThanOrEqual(0.55 * RATE);
      expect(plan.jumps).toBeGreaterThan(0);
    }
  });

  it('starts where the clip starts, and keeps segments at least the minimum edit length', async () => {
    const { an } = await songAnalysis();
    const start = Math.round(4.2 * RATE);
    for (const edit of [0, 1]) {
      const plan = planRemix(an, { start, target: 18 * RATE, edit });
      check(an, plan, start);
      const { minRun } = editShape(edit);
      // Inner segments last at least `minRun` beats (+1 for the beat before each jump).
      for (const [a, b] of plan.segments.slice(1, -1)) expect((b - a) / an.period).toBeGreaterThan(minRun - 0.5);
    }
    expect(editShape(0).minRun).toBeLessThan(editShape(1).minRun);
  });

  it('honours the longest jump and reports the closest result when the target cannot be met', async () => {
    const { an } = await songAnalysis();
    const plan = planRemix(an, { start: 0, target: 40 * RATE, maxJump: 20 });
    for (let i = 1; i < plan.segments.length; i++) {
      const cut = plan.segments[i - 1][1];
      const land = plan.segments[i][0];
      expect(Math.abs(cut - land) / an.period).toBeLessThanOrEqual(21.5);
    }
    // Far shorter than the shortest route to the end.
    const tiny = planRemix(an, { start: 0, target: 2 * RATE });
    expect(tiny.fits).toBe(false);
    check(an, tiny, 0);
    expect(() => planRemix({ ...an, beats: an.beats.slice(0, 3) }, { target: RATE })).toThrow(/too few beats/);
  });
});

describe('remix render', () => {
  it('joins segments back to back with equal-power crossfades centred on each cut', async () => {
    const x = new Float32Array(4000).fill(1);
    const segs = [
      [0, 1000],
      [2000, 3000],
      [500, 4000],
    ];
    const [out] = await renderRemix([x], segs, 100);
    expect(out.length).toBe(1000 + 1000 + 3500);
    // Away from the joins the source plays as is.
    expect(out[500]).toBeCloseTo(1, 6);
    expect(out[1500]).toBeCloseTo(1, 6);
    // In the middle of a join both sides play at -3 dB: the sum of two equal signals is sqrt(2).
    expect(out[1000]).toBeCloseTo(Math.SQRT2, 1);
    expect(out[2000]).toBeCloseTo(Math.SQRT2, 1);
    // Equal power at every point of the crossfade (sin^2 + cos^2 = 1).
    for (let i = 950; i < 1050; i++) {
      const p = i - 950 + 0.5;
      const gin = Math.sin((Math.PI / 2) * (p / 100));
      const gout = Math.cos((Math.PI / 2) * (p / 100));
      expect(out[i]).toBeCloseTo(gin + gout, 4);
    }
  });

  it('previews with a hard-cut splice sharing the source blocks', () => {
    const ch = Channel.fromSamples(Float32Array.from({ length: 100 }, (_, i) => i));
    const [p] = spliceChannels([ch], [
      [10, 20],
      [50, 55],
    ]);
    expect(Array.from(p.toArray())).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 50, 51, 52, 53, 54]);
  });
});
