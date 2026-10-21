import { describe, it, expect } from 'vitest';
import { Prefs } from '../src/lib/prefs.js';
import { clipsSpan, fitZoom } from '../src/commands/view-extra.js';
import { statusParts, statusFieldsOn, recordingSeconds } from '../src/ui/status-fields.js';
import { meterZones, scaleSteps } from '../src/panels/levels.js';

const memoryPrefs = () => new Prefs({ getItem: () => null, setItem: () => {} });

describe('view zoom helpers', () => {
  it('spans selected clips with padding', () => {
    expect(clipsSpan([])).toBe(null);
    expect(clipsSpan([{ start: 100, length: 100 }, { start: 400, length: 100 }])).toEqual([92, 508]);
  });

  it('fits track heights into the editor within limits', () => {
    expect(fitZoom([100, 100], 400)).toBe(2);
    expect(fitZoom([100, 100], 10)).toBe(0.25);
    expect(fitZoom([], 400)).toBe(1);
  });
});

describe('status bar fields', () => {
  const app = {
    prefs: memoryPrefs(),
    formatTime: (f, rate) => `${(f / rate).toFixed(1)}s`,
    recording: false,
  };
  const doc = { kind: 'audio', sampleRate: 48000, channelCount: 2, length: 48000 * 10, info: { bitDepth: 24 }, dirty: true, source: { type: 'local' } };

  it('lists the default fields', () => {
    expect(statusParts(app, doc, { cursor: null, freeBytes: null })).toEqual(['48000 Hz • 24-bit • Stereo', '2.75 MB', '10.0s']);
  });

  it('adds the enabled optional fields', () => {
    app.prefs.set('statusFields', { fileStatus: true, freeSpace: true, freeTime: true, dropped: true, size: false });
    const parts = statusParts(app, doc, { cursor: { frame: 24000, rate: 48000, channel: 'L', db: -6.02 }, freeBytes: 48000 * 2 * 4 * 120, dropped: 3 });
    expect(parts[0]).toBe('L: -6.0 dB @ 0.5s');
    expect(parts).toContain('Modified');
    expect(parts).toContain('2 min free');
    expect(parts).toContain('3 dropped');
    expect(parts).not.toContain('2.75 MB');
    expect(statusFieldsOn(app.prefs).cursor).toBe(true);
  });

  it('converts free bytes to recording time', () => {
    expect(recordingSeconds(48000 * 4, 48000, 1)).toBe(1);
  });
});

describe('meter zones', () => {
  it('reads caution and warning levels and keeps them ordered', () => {
    const prefs = memoryPrefs();
    expect(meterZones(prefs)).toEqual({ caution: -12, warning: -3 });
    prefs.set('meterCaution', -2);
    prefs.set('meterWarning', -6);
    expect(meterZones(prefs)).toEqual({ caution: -6, warning: -6 });
  });

  it('spaces scale labels so they never collide', () => {
    expect(scaleSteps(60, 1000)).toEqual({ step: 3, labelEvery: 3 });
    const tight = scaleSteps(120, 200);
    expect((tight.labelEvery / 120) * 200).toBeGreaterThanOrEqual(22);
  });
});
