// Automatic speech alignment: FFT, DTW path, time map and WSOLA on synthetic signals.
import { describe, it, expect, beforeAll } from 'vitest';
import { Session } from '../src/model/session.js';
import { Channel } from '../src/audio/channel.js';
import * as S from '../src/model/session-edits.js';
import { fft, dtw, pathToMap, mapAt, wsola, alignSpeech, speechFeatures } from '../src/multitrack/align.js';

const RATE = 16000;

describe('fft', () => {
  it('matches a direct DFT', () => {
    const n = 16;
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + 0.25 * Math.cos(i * 0.7));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0;
      let q = 0;
      for (let t = 0; t < n; t++) {
        r += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
        q += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 4);
      expect(im[k]).toBeCloseTo(q, 4);
    }
  });
});

const scalar = (a, b) => Math.abs(a[0] - b[0]);
const seq = (values) => values.map((v) => [v]);

describe('dtw', () => {
  it('pairs equal symbols of two sequences with different timing, start to end', async () => {
    const A = seq([0, 0, 1, 1, 2, 2, 3, 3]);
    const B = seq([0, 1, 1, 1, 1, 2, 3]);
    const path = await dtw(A, B, { distance: scalar });
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([7, 6]);
    for (let k = 1; k < path.length; k++) {
      const [i0, j0] = path[k - 1];
      const [i1, j1] = path[k];
      expect(i1 - i0 >= 0 && i1 - i0 <= 1 && j1 - j0 >= 0 && j1 - j0 <= 1 && i1 + j1 > i0 + j0).toBe(true);
    }
    for (const [i, j] of path) expect(A[i][0]).toBe(B[j][0]);
  });

  it('finds the same path inside a band as without one when timing stays near the diagonal', async () => {
    const A = seq(Array.from({ length: 60 }, (_, i) => Math.floor(i / 6)));
    const B = seq(Array.from({ length: 66 }, (_, i) => Math.floor(i / 6.6)));
    const full = await dtw(A, B, { distance: scalar });
    const banded = await dtw(A, B, { distance: scalar, band: 8 });
    expect(banded).toEqual(full);
  });

  it('turns a path into an increasing, smoothed time map pinned at the ends', () => {
    const path = [[0, 0], [1, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5]];
    const map = pathToMap(path, 5, 3);
    expect(map[0]).toBe(0);
    expect(map[4]).toBe(5);
    for (let i = 1; i < map.length; i++) expect(map[i]).toBeGreaterThanOrEqual(map[i - 1]);
    expect(pathToMap(path, 5)[1]).toBe(2);
    expect(mapAt(map, 6)).toBe(7);
  });
});

/** A buzzy vowel-like tone (harmonics of f0 shaped by two resonances). */
function voiced(f0, seconds, f1, f2, phase0 = 0) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let h = 1; h * f0 < RATE / 2.2; h++) {
    const f = h * f0;
    const amp = 1 / (1 + ((f - f1) / 150) ** 2) + 0.6 / (1 + ((f - f2) / 250) ** 2);
    for (let i = 0; i < n; i++) out[i] += 0.2 * amp * Math.sin((2 * Math.PI * f * i) / RATE + phase0 * h);
  }
  // Short ramps so segments join without clicks.
  const r = Math.min(n / 2, 80);
  for (let i = 0; i < r; i++) {
    out[i] *= i / r;
    out[n - 1 - i] *= i / r;
  }
  return out;
}

function noiseBurst(seconds, seed) {
  let x = seed;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return (x / 4294967296 - 0.5) * 0.2;
  });
}

const SEGMENTS = [
  (d) => voiced(120, d, 700, 1200),
  (d) => noiseBurst(d, 7),
  (d) => voiced(140, d, 300, 2300),
  (d) => new Float32Array(Math.round(d * RATE)),
  (d) => voiced(110, d, 500, 900),
  (d) => voiced(160, d, 400, 2000),
];

function utterance(durations) {
  const parts = SEGMENTS.map((make, i) => make(durations[i]));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  const bounds = [0];
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    bounds.push(at);
  }
  return { x: out, bounds };
}

describe('speech alignment', () => {
  const ref = utterance([0.3, 0.12, 0.25, 0.2, 0.35, 0.3]);
  const take = utterance([0.42, 0.08, 0.18, 0.32, 0.26, 0.4]);

  it('computes one normalized feature frame per hop', async () => {
    const f = await speechFeatures(ref.x, RATE, { hop: 0.01 });
    expect(f.length).toBe(Math.ceil(ref.x.length / 160));
    expect(f[0].length).toBe(13);
    const mean = f.reduce((s, v) => s + v[2], 0) / f.length;
    expect(Math.abs(mean)).toBeLessThan(1e-4);
  });

  it('maps each reference segment boundary to the matching point of the other take', async () => {
    const r = await alignSpeech([ref.x], [take.x], RATE, { precision: 'medium' });
    const hopN = RATE * r.hop;
    for (let k = 1; k < SEGMENTS.length; k++) {
      const mapped = mapAt(r.map, ref.bounds[k] / hopN) * hopN;
      expect(Math.abs(mapped - take.bounds[k]) / RATE).toBeLessThan(0.03);
    }
  });

  it('renders the take at the reference length with each segment where the reference has it', async () => {
    const r = await alignSpeech([ref.x, ref.x], [take.x, take.x], RATE, { precision: 'low' });
    expect(r.channels).toHaveLength(2);
    expect(r.channels[0].length).toBe(ref.x.length);
    // Energy in the silent gap of the reference stays low; the voiced parts are present.
    const rms = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += r.channels[0][i] ** 2;
      return Math.sqrt(s / (b - a));
    };
    const gap = rms(ref.bounds[3] + 400, ref.bounds[4] - 400);
    const vowel = rms(ref.bounds[4] + 400, ref.bounds[5] - 400);
    expect(gap).toBeLessThan(vowel * 0.1);
    expect(vowel).toBeGreaterThan(0.02);
  });

  it('stops when cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const long = new Float32Array(RATE * 30);
    await expect(alignSpeech([long], [long], RATE, { signal: ctrl.signal })).rejects.toThrow(/Cancelled/);
  });
});

describe('wsola', () => {
  it('stretches a tone to twice its length without changing its pitch', async () => {
    const n = RATE / 2;
    const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 300 * i) / RATE));
    const [y] = await wsola([tone], n * 2, (t) => t / 2, { win: 480, tol: 120 });
    expect(y.length).toBe(n * 2);
    const mid = y.subarray(n / 2, (3 * n) / 2);
    let crossings = 0;
    for (let i = 1; i < mid.length; i++) if (mid[i - 1] < 0 && mid[i] >= 0) crossings++;
    expect((crossings * RATE) / mid.length).toBeGreaterThan(290);
    expect((crossings * RATE) / mid.length).toBeLessThan(310);
  });
});

describe('Automatic Speech Alignment command', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    }
  });

  it('aligns the unaligned clip to the reference onto a new track as one undo step', async () => {
    localStorage.clear();
    const { App } = await import('../src/app.js');
    const { installCore } = await import('../src/features/core.js');
    const { installMultitrack } = await import('../src/features/multitrack.js');
    const app = new App();
    installCore(app);
    installMultitrack(app);
    app.syncGraph = () => {};
    const doc = new Session({ name: 'Dub.asesx', sampleRate: RATE, tracks: 2 });
    const ref = utterance([0.3, 0.12, 0.25, 0.2, 0.35, 0.3]);
    const take = utterance([0.42, 0.08, 0.18, 0.32, 0.26, 0.4]);
    const a = doc.addSource({ name: 'line.wav', channels: [Channel.fromSamples(ref.x)] });
    const b = doc.addSource({ name: 'dub.wav', channels: [Channel.fromSamples(take.x)] });
    const [t0, t1] = doc.state.tracks;
    const refClip = S.createClip({ trackId: t0.id, sourceId: a, name: 'Line', start: 4000, length: ref.x.length });
    const dubClip = S.createClip({ trackId: t1.id, sourceId: b, name: 'Dub', start: 9000, length: take.x.length });
    doc.apply('Insert', S.addClips(doc.state, [refClip, dubClip]));
    app.addDocument(doc);
    doc.selectClips([dubClip.id]);
    expect(app.commands.isEnabled('clip.speechAlign')).toBe(false);
    doc.selectClips([refClip.id, dubClip.id]);
    expect(app.commands.isEnabled('clip.speechAlign')).toBe(true);
    const steps = doc.history.entries.length;
    const run = app.commands.run('clip.speechAlign');
    await new Promise((r) => setTimeout(r, 0));
    const dlg = document.querySelector('.dialog');
    expect(dlg.textContent).toContain('Dub (Track 2)');
    dlg.querySelector('[aria-label="Alignment precision"]').value = 'low';
    dlg.querySelector('.btn.primary').click();
    await run;
    expect(doc.history.entries.length).toBe(steps + 1);
    expect(doc.history.undoLabel).toBe('Automatic Speech Alignment');
    const track = doc.state.tracks[2];
    expect(track.name).toBe('Track 2 Aligned');
    const aligned = doc.state.clips.find((c) => c.trackId === track.id);
    expect(aligned).toMatchObject({ start: 4000, length: ref.x.length });
    expect(S.findClip(doc.state, dubClip.id).mute).toBe(true);
    expect(app.documents.some((d) => d.name === 'Dub Aligned.wav')).toBe(true);
    doc.history.undo();
    expect(doc.state.tracks).toHaveLength(2);
    expect(S.findClip(doc.state, dubClip.id).mute).toBe(false);
  });
});
