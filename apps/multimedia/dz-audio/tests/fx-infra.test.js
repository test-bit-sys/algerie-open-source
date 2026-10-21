// Effect infrastructure: registry helpers, data slots, timing helpers, the
// parameter builders and the offline runner for realtime kinds.
import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import { dsp } from '../src/audio/dsp.js';
import { registerEffect, getEffect, slotSpec, paramArray, effectLatency, effectTail, chainTiming, EFFECTS } from '../src/effects/index.js';
import { num, hz, ms, choice, section, packCurve, envelopeValue, dataId } from '../src/effects/defs/util.js';

describe('effect registry helpers', () => {
  it('maps data params to 0 and builds data blocks with the document', () => {
    const def = registerEffect({
      id: '__test_data',
      name: 'Test',
      group: 'Test',
      kind: 1,
      params: [num('a', 'A', 0, 10, 2), { id: 'curve', label: 'Curve', type: 'curve', default: [{ f: 20, g: 0 }] }],
      data: (values, { doc, rate }) => [{ slot: 0, id: dataId([values.curve, rate, doc?.id]), values: packCurve(values.curve) }],
      latency: (v) => v.a * 10,
      tail: (v, rate) => rate,
    });
    try {
      expect(paramArray(def, { curve: [{ f: 1, g: 2 }] })).toEqual([2, 0]);
      const spec = slotSpec(def, { curve: [{ f: 1000, g: -3 }, { f: 100, g: 6 }] }, { doc: { id: 'd', sampleRate: 44100 } });
      expect(spec.params).toEqual([2, 0]);
      expect(Array.from(spec.data[0].values)).toEqual([100, 6, 1000, -3]);
      expect(spec.data[0].id).toBe(dataId([[{ f: 1000, g: -3 }, { f: 100, g: 6 }], 44100, 'd']));
      expect(effectLatency(def, { a: 3 })).toBe(30);
      expect(effectTail(def, {}, 1000)).toBe(1000);
      expect(chainTiming([{ def, values: { a: 1 } }, { def, values: {}, enabled: false }], 10)).toEqual({ latency: 10, tail: 10 });
    } finally {
      EFFECTS.delete('__test_data');
    }
  });

  it('builds parameters with sensible steps and scales', () => {
    expect(hz('f', 'F', 20, 20000, 1000).scale).toBe('log');
    expect(ms('t', 'T', 0.1, 1000, 10).scale).toBe('log');
    expect(ms('t', 'T', 0, 50, 10).scale).toBe('linear');
    expect(num('x', 'X', 0, 1, 0.5).step).toBe(0.001);
    expect(choice('c', 'C', ['a', 'b']).options).toEqual([{ value: 0, label: 'a' }, { value: 1, label: 'b' }]);
    const s = section('Band 1', 'b1', [num('gain', 'Gain', -1, 1, 0)]);
    expect(s[0].id).toBe('b1Gain');
    expect(s[0].section).toBe('Band 1');
    expect(envelopeValue([{ t: 0, v: 0 }, { t: 1, v: 2 }], 0.25)).toBe(0.5);
    expect(envelopeValue([], 0.5)).toBe(1);
  });
});

describe('Dsp.runEffect', () => {
  it('runs a realtime kind over whole channels', async () => {
    const d = await dsp();
    const x = new Float32Array(20000).map((_, i) => Math.sin(i / 10) * 0.25);
    const [y] = d.runEffect(getEffect('amplify').kind, 48000, [x], [20 * Math.log10(2), 0, 1], { tail: 100 });
    expect(y.length).toBe(20100);
    expect(y[1234]).toBeCloseTo(x[1234] * 2, 5);
    expect(y[20050]).toBe(0);
  });
});
