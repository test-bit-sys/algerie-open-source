import { describe, it, expect } from 'vitest';
import { ops } from '../src/diagnostics/kernels.js';

describe('clip detection', () => {
  it('finds flat clipped plateaus but not the rounded peaks of a clean sine', () => {
    const n = 4410;
    const sine = Float32Array.from({ length: n }, (_, i) => 0.08 * Math.sin((2 * Math.PI * 440 * i) / 44100));
    const peak = Math.max(...sine.map(Math.abs));
    expect(ops.clips(null, { samples: sine, level: peak * 0.98, minRun: 3 }).length).toBe(0);
    const clipped = sine.map((v) => Math.max(-0.05, Math.min(0.05, v)));
    const runs = ops.clips(null, { samples: clipped, level: 0.05 * 0.99999, minRun: 3 });
    expect(runs.length).toBeGreaterThan(0);
  });
});

import { parseMarkerText } from '../src/storage/markers-io.js';

describe('marker import', () => {
  it('prefers exact sample columns and rescales them to the file rate', () => {
    const text = 'Name\tStart\tDuration\tTime Format\tType\tDescription\tStart Samples\tDuration Samples\tSample Rate\n"A"\t"0:04.535"\t"0:00.000"\t"decimal"\t"cue"\t""\t"199994"\t"0"\t"44100"\n';
    const [m] = parseMarkerText(text, 44100);
    expect(m.start).toBe(199994);
    const [m2] = parseMarkerText(text, 88200);
    expect(m2.start).toBe(399988);
  });
});
