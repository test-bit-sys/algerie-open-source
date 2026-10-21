// The effect catalog: every definition is well formed, matches the Effects
// menu, its presets are valid, and its WASM processor exists, runs with each
// preset, reports the same latency the definition declares, and is fast
// enough for the AudioWorklet.
import { describe, it, expect } from 'vitest';
import { instance, testSignal } from './fx-wasm.js';
import { EFFECTS, defaults, slotSpec, effectLatency } from '../src/effects/index.js';
import { EFFECT_GROUPS, MENUS } from '../src/ui/menus.js';

const RATE = 48000;
const menuIds = new Map(EFFECT_GROUPS.flatMap((g) => g.ids.map((id) => [id, g.label])));
const DATA_TYPES = new Set(['curve', 'envelope', 'transfer']);

function validValue(p, v) {
  if (p.type === 'bool') return typeof v === 'boolean';
  if (p.type === 'text') return typeof v === 'string';
  if (p.type === 'choice') return p.options.some((o) => o.value === v);
  if (DATA_TYPES.has(p.type)) return Array.isArray(v);
  return typeof v === 'number' && v >= p.min && v <= p.max;
}

/** Runs a slot spec over stereo input in 128-frame blocks, like the worklet. */
function runRealtime(x, spec, input, block = 128) {
  const h = x.fx_new(spec.kind, RATE, 2);
  if (!h) throw new Error(`fx_new failed for kind ${spec.kind}`);
  for (const d of spec.data || []) {
    const ptr = x.mem_alloc(Math.max(4, d.values.length * 4));
    new Float32Array(x.memory.buffer, ptr, d.values.length).set(d.values);
    x.fx_data(h, d.slot, ptr, d.values.length);
    x.mem_free(ptr, Math.max(4, d.values.length * 4));
  }
  spec.params.forEach((v, i) => x.fx_set(h, i, v));
  const buf = x.mem_alloc(2 * block * 4);
  const n = input[0].length;
  const out = [new Float32Array(n), new Float32Array(n)];
  // CPU time rather than wall time: the test machine is often heavily loaded.
  const t0 = process.cpuUsage();
  for (let at = 0; at < n; at += block) {
    const m = Math.min(block, n - at);
    let v = new Float32Array(x.memory.buffer, buf, 2 * m);
    v.set(input[0].subarray(at, at + m), 0);
    v.set(input[1].subarray(at, at + m), m);
    x.fx_process(h, buf, m);
    v = new Float32Array(x.memory.buffer, buf, 2 * m);
    out[0].set(v.subarray(0, m), at);
    out[1].set(v.subarray(m, 2 * m), at);
  }
  const used = process.cpuUsage(t0);
  const ms = (used.user + used.system) / 1000;
  const latency = x.fx_latency(h);
  x.mem_free(buf, 2 * block * 4);
  x.fx_free(h);
  return { out, ms, latency };
}

describe('effect catalog', () => {
  const defs = [...EFFECTS.values()];

  it('registers effects for the Effects menu', () => {
    expect(defs.length).toBeGreaterThanOrEqual(1);
  });

  for (const def of defs) {
    describe(def.id, () => {
      it('is well formed and matches its menu group', () => {
        if (def.topLevel) {
          const top = MENUS.find((m) => m.label === 'Effects').submenu;
          expect(top, `fx.${def.id} is not in the Effects menu`).toContain(`fx.${def.id}`);
          expect(EFFECT_GROUPS.some((g) => g.label === def.group), `${def.id}: unknown group`).toBe(true);
        } else expect(menuIds.get(def.id), `${def.id} is not in EFFECT_GROUPS`).toBe(def.group);
        expect(typeof def.name).toBe('string');
        expect(def.kind != null || typeof def.process === 'function', 'needs a WASM kind or a process').toBe(true);
        const ids = new Set();
        for (const p of def.params) {
          expect(ids.has(p.id), `duplicate param ${p.id}`).toBe(false);
          ids.add(p.id);
          expect(typeof p.label).toBe('string');
          expect(validValue(p, p.default), `default of ${p.id}`).toBe(true);
          if (!p.type || p.type === 'number') {
            expect(p.min).toBeLessThan(p.max);
            expect(p.step).toBeGreaterThan(0);
            if (p.scale === 'log') expect(p.min).toBeGreaterThan(0);
          }
        }
      });

      it('has valid presets', () => {
        expect(def.presets.length).toBeGreaterThanOrEqual(def.params.length ? 2 : 0);
        const names = new Set();
        for (const preset of def.presets) {
          expect(names.has(preset.name), `duplicate preset ${preset.name}`).toBe(false);
          names.add(preset.name);
          for (const [k, v] of Object.entries(preset.values)) {
            const p = def.params.find((q) => q.id === k);
            expect(p, `${preset.name}: unknown param ${k}`).toBeTruthy();
            expect(validValue(p, v), `${preset.name}: ${k} = ${JSON.stringify(v)}`).toBe(true);
          }
        }
      });

      if (def.kind != null) {
        const x = instance();
        const input = testSignal(RATE, 1);

        it('processes 1 s of stereo quickly with finite output and matching latency', () => {
          const spec = slotSpec(def, defaults(def), { rate: RATE });
          runRealtime(x, spec, testSignal(RATE, 1)); // warm up the JIT tiers
          const { out, latency } = runRealtime(x, spec, input);
          // Best of three runs: the test machine is often heavily loaded.
          let ms = Infinity;
          for (let r = 0; r < 3; r++) ms = Math.min(ms, runRealtime(x, spec, input).ms);
          for (const ch of out) for (let i = 0; i < ch.length; i += 7) expect(Number.isFinite(ch[i])).toBe(true);
          expect(latency).toBe(effectLatency(def, {}, RATE));
          // The worklet budget is 1000 ms per second of audio; 20 ms is the
          // target (all effects measure 0.3 to 11 ms of CPU at defaults); the
          // bound leaves room for cache contention on a loaded machine.
          console.log(`fx timing ${def.id}: ${ms.toFixed(1)} ms per second of 48 kHz stereo`);
          expect(ms).toBeLessThan(60);
        });

        it('runs every preset', () => {
          for (const preset of def.presets) {
            const values = { ...defaults(def), ...preset.values };
            const spec = slotSpec(def, values, { rate: RATE });
            expect(spec.params.length).toBe(def.params.length);
            const { out, latency } = runRealtime(x, spec, testSignal(RATE, 0.25));
            for (const ch of out) for (let i = 0; i < ch.length; i += 5) expect(Number.isFinite(ch[i]), `${preset.name}`).toBe(true);
            expect(latency, `${preset.name} latency`).toBe(effectLatency(def, values, RATE));
          }
        });

        it('handles mono', () => {
          const spec = slotSpec(def, defaults(def), { rate: RATE });
          const h = x.fx_new(def.kind, RATE, 1);
          expect(h).not.toBe(0);
          spec.params.forEach((v, i) => x.fx_set(h, i, v));
          const buf = x.mem_alloc(4 * 128);
          const sig = testSignal(RATE, 0.1)[0];
          for (let at = 0; at + 128 <= sig.length; at += 128) {
            new Float32Array(x.memory.buffer, buf, 128).set(sig.subarray(at, at + 128));
            x.fx_process(h, buf, 128);
            const v = new Float32Array(x.memory.buffer, buf, 128);
            for (let i = 0; i < 128; i += 9) expect(Number.isFinite(v[i])).toBe(true);
          }
          x.mem_free(buf, 4 * 128);
          x.fx_free(h);
        });
      }
    });
  }
});

describe('seeded favorites', () => {
  it('only use parameter ids and values the effect definitions accept', async () => {
    const { seedFavorites } = await import('../src/effects/favorites.js');
    for (const fav of seedFavorites()) {
      if (fav.action.type !== 'effect') continue;
      const def = EFFECTS.get(fav.action.effect);
      if (!def) continue; // effect not implemented in this build
      for (const [k, v] of Object.entries(fav.action.values)) {
        const p = def.params.find((q) => q.id === k);
        expect(p, `${fav.name}: unknown param ${k}`).toBeTruthy();
        expect(validValue(p, v), `${fav.name}: ${k} = ${v}`).toBe(true);
      }
    }
  });
});
