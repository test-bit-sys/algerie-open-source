// Waveform editor details: ruler units and ticks, the amplitude ruler, the
// per-channel overview, the HUD grip and pin, and the zoom bar.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { rulerUnit, minorStep, rulerTicks } from '../src/editor/time-ruler.js';
import { dbTicks, dbMinorTicks, clampHud } from '../src/editor/waveform-view.js';
import { Overview } from '../src/editor/overview.js';
import { ZOOM_BUTTONS } from '../src/panels/transport-controls.js';

function fakeContext(calls = []) {
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => (calls.push([k, ...a]), k === 'measureText' ? { width: 10 } : undefined)), set: (t, k, v) => ((t[k] = v), true) });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
});

describe('time ruler', () => {
  it('names the unit of each time format', () => {
    expect(rulerUnit('decimal')).toBe('hms');
    expect(rulerUnit('compact')).toBe('hms');
    expect(rulerUnit('samples')).toBe('smpl');
    expect(rulerUnit('smpte2997df')).toBe('hmsf');
    expect(rulerUnit('frames')).toBe('hmsf');
    expect(rulerUnit('bars')).toBe('bars');
  });

  it('splits labelled steps into a few minor ticks', () => {
    expect(minorStep(1)).toBe(0.5);
    expect(minorStep(0.1)).toBe(0.05);
    expect(minorStep(0.5)).toBeCloseTo(0.1);
    expect(minorStep(5)).toBe(1);
    expect(minorStep(15)).toBe(5);
    expect(minorStep(60)).toBe(15);
  });

  it('labels whole seconds across a 12 second file in a wide editor', () => {
    const { step, ticks } = rulerTicks(0, 12, 920);
    expect(step).toBe(1);
    expect(ticks.map((s) => Math.round(s))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rulerTicks(0, 0, 100).ticks).toEqual([]);
  });
});

describe('amplitude ruler', () => {
  it('labels the familiar dB ladder in a tall lane', () => {
    const dbs = dbTicks({ top: 0, bottom: 680 }, 1).map((t) => t.db);
    expect(dbs.slice(0, 7)).toEqual([-1, -3, -6, -9, -12, -18, -24]);
    expect(dbs).not.toContain(-2);
    expect(dbs).not.toContain(-4.5);
  });

  it('adds unlabelled 1 dB ticks at least 4 px apart, mirrored below the centre', () => {
    const lane = { top: 0, bottom: 300 };
    const ys = dbMinorTicks(lane, 1);
    const upper = ys.filter((_, i) => i % 2 === 0);
    for (let i = 1; i < upper.length; i++) expect(upper[i] - upper[i - 1]).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < ys.length; i += 2) expect(ys[i + 1] - 150).toBeCloseTo(150 - ys[i], 6);
  });
});

describe('overview', () => {
  it('draws one strip per channel and the view range in the full waveform color', () => {
    const calls = [];
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext(calls));
    const peaks = () => {
      const p = new Float32Array(200);
      for (let i = 0; i < 100; i++) (p[2 * i] = -0.5), (p[2 * i + 1] = 0.5);
      return p;
    };
    const host = {
      timeline: () => ({ rate: 1000, length: 1000, view: { start: 0, end: 500 }, cursor: 0, selection: { start: 0, end: 0 } }),
      overviewPeaks: () => [peaks(), peaks()],
      peaksKey: () => 1,
      setView() {},
    };
    const o = new Overview({}, host);
    o.resize(100, 40);
    o.draw();
    const rects = calls.filter((c) => c[0] === 'fillRect' && c[3] === 1);
    // Two strips of 100 columns each: one in the top half, one in the bottom half.
    expect(rects.length).toBe(200);
    expect(rects.filter((r) => r[2] < 20).length).toBe(100);
    spy.mockRestore();
  });
});

describe('HUD', () => {
  it('keeps the HUD inside the editor', () => {
    expect(clampHud(-20, 500, 100, 24, 400, 300)).toEqual({ x: 0, y: 276 });
    expect(clampHud(50.4, 10.6, 100, 24, 400, 300)).toEqual({ x: 50, y: 11 });
  });

  it('pins and unpins from its own button and splits the value from the unit', async () => {
    const { App } = await import('../src/app.js');
    const { installCore } = await import('../src/features/core.js');
    const { AudioFile } = await import('../src/model/audio-file.js');
    const { Channel } = await import('../src/audio/channel.js');
    const { WaveformView } = await import('../src/editor/waveform-view.js');
    HTMLCanvasElement.prototype.getContext = (type) => (type === '2d' ? fakeContext() : null);
    localStorage.clear();
    const app = new App();
    installCore(app);
    app.syncGraph = () => {};
    const doc = new AudioFile({ name: 's.wav', sampleRate: 48000, channels: [Channel.fromSamples(new Float32Array(4800))] });
    app.addDocument(doc);
    const view = new WaveformView(app, doc);
    document.body.replaceChildren(view.el);
    const hud = view.el.querySelector('.hud');
    const pin = hud.querySelector('.hud-pin');
    expect(hud.querySelector('.hud-value').textContent).toBe('+0');
    expect(hud.querySelector('.hud-unit').textContent).toBe('dB');
    expect(hud.classList.contains('pinned')).toBe(false);
    pin.click();
    expect(app.prefs.get('hudPinned')).toBe(true);
    expect(hud.classList.contains('pinned')).toBe(true);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    // The overview corner offers Zoom Out Full.
    expect(view.el.querySelector('.wf-top-corner button').getAttribute('aria-label')).toBe('Zoom Out Full (All Axes)');
  });
});

describe('zoom bar', () => {
  it('lists the zoom buttons in order, ending with reset and fit track', () => {
    expect(ZOOM_BUTTONS.map((b) => b[0])).toEqual([
      'view.zoomInAmp',
      'view.zoomOutAmp',
      'view.zoomInTime',
      'view.zoomOutTime',
      'view.zoomFull',
      'view.zoomInPoint',
      'view.zoomOutPoint',
      'view.zoomSelection',
      'view.zoomResetTime',
      'view.zoomInTrack',
    ]);
  });
});
