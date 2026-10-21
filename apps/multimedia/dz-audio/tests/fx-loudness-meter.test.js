// Loudness Meter: a pass-through realtime effect (kind 94) that measures
// loudness while audio plays, shown live in its dialog from the readout.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, defaults, slotSpec } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { readLoudness, meterRange, loudnessText } from '../src/effects/meter-view.js';
import { LOUDNESS_STANDARDS } from '../src/effects/defs/loudness-standards.js';
import { fakeApp, filled } from './fx-helpers.js';

const RATE = 48000;
const def = getEffect('loudnessMeter');

function sine(n, amp) {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / RATE));
}

describe('Loudness Meter', () => {
  it('is a realtime, measure-only Special effect with readouts', () => {
    expect(def.group).toBe('Special');
    expect(def.kind).toBe(94);
    expect(def.realtime).toBe(true);
    expect(def.measureOnly).toBe(true);
    expect(slotSpec(def, defaults(def)).readout).toBe(true);
  });

  it('passes audio unchanged and reads -20 LUFS for a -20 dBFS stereo sine', () => {
    const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
    const chain = host.sync([slotSpec(def, defaults(def), { key: 'trk:t1:s9' })]);
    const x = sine(RATE * 4, 0.1);
    for (let at = 0; at < x.length; at += 128) {
      const l = x.slice(at, at + 128);
      const r = x.slice(at, at + 128);
      host.run(chain, [l, r], 128);
      expect(l).toEqual(x.subarray(at, at + 128));
    }
    const [[key, v]] = host.readouts();
    expect(key).toBe('trk:t1:s9');
    const m = readLoudness(v);
    expect(m.momentary).toBeCloseTo(-20, 0);
    expect(m.shortTerm).toBeCloseTo(-20, 0);
    expect(m.integrated).toBeCloseTo(-20, 0);
    expect(m.truePeakDb).toBeCloseTo(-20, 0);
    expect(m.seconds).toBeCloseTo(4, 2);
    host.reset();
    expect(readLoudness(host.readouts()[0][1]).integrated).toBe(-Infinity);
  });

  it('scales its bars around the target', () => {
    expect(meterRange({ target: -23, scale: 0 })).toEqual({ lo: -41, hi: -14 });
    expect(meterRange({ target: -16, scale: 1 })).toEqual({ lo: -52, hi: 2 });
  });

  it('shows readouts live in its Levels tab, and has nothing to apply', async () => {
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: [Channel.fromSamples(filled(4800, 0.1))] });
    app.active = doc;
    const p = openEffectDialog(app, def, { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect([...dlg.querySelectorAll('.dialog-foot .btn')].map((b) => b.textContent)).toEqual(['Close']);
    expect([...dlg.querySelectorAll('.fx-tab')].map((b) => b.textContent)).toEqual(['Levels', 'Settings']);
    expect([...dlg.querySelectorAll('.lm-row .lm-label')].map((e) => e.textContent)).toEqual(['Input', 'Short-Term', 'Integrated', 'Momentary']);
    // Settings live on their own tab, not under the meters.
    expect(dlg.querySelector('.fx-dialog-body > .fx-controls')?.children.length || 0).toBe(0);
    const v = Float32Array.of(-18, -19.5, -21.25, 4.2, 1, 0.25, -12, -15, 75, 0.5, 0.25);
    app.engine.emit('fx-readout', new Map([['preview:loudnessMeter', v], ['rack:other', Float32Array.of(0)]]));
    const values = [...dlg.querySelectorAll('.lm-value')].map((e) => e.textContent);
    expect(values).toEqual(['-6.0', '-19.5', '-21.3', '-18.0']);
    const head = [...dlg.querySelectorAll('.lm-big-value')].map((e) => e.textContent);
    expect(head).toEqual(['-19.5', '-21.3', '4.2', '0.0']);
    // 0 dBTP is over the default -1 dBTP ceiling.
    expect(dlg.querySelector('.lm-big.tp').classList.contains('over')).toBe(true);
    expect([...dlg.querySelectorAll('.lm-stat-value')].map((e) => e.textContent)).toEqual(['-12.0 LUFS', '-15.0 LUFS', '1:15']);
    expect(dlg.querySelector('.lm-hint').textContent).toMatch(/1\.8 LU above the target/);
    // Reset clears the readings.
    dlg.querySelector('.lm-reset').click();
    expect(dlg.querySelector('.lm-big-value').textContent).toBe('--');
    dlg.querySelector('.dialog-head .icon-btn').click();
    expect(await p).toBeNull();
  });

  it('follows a loudness standard and shows LU relative to the target', async () => {
    const app = fakeApp();
    const p = openEffectDialog(app, def, { doc: null, values: defaults(def) });
    const dlg = [...document.querySelectorAll('.fx-dialog')].at(-1);
    const [standard, units] = [...dlg.querySelectorAll('.lm-settings select')];
    standard.value = '3'; // Podcast
    standard.dispatchEvent(new Event('change'));
    const hot = (label) => [...dlg.querySelectorAll('.lm-settings .hot')].find((e) => e.getAttribute('aria-label') === label);
    expect(hot('Target').textContent).toMatch(/-16/);
    // Moving the target by hand switches to Custom.
    hot('Target').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(standard.value).toBe(String(LOUDNESS_STANDARDS.length - 1));
    units.value = '1';
    units.dispatchEvent(new Event('change'));
    app.engine.emit('fx-readout', new Map([['preview:loudnessMeter', Float32Array.of(-18, -14.5, -16.5, 3, 0.1, 0.1, -12, -15, 10, 0.1, 0.1)]]));
    expect(dlg.querySelectorAll('.lm-big-value')[0].textContent).toBe('+1.0');
    expect(dlg.querySelectorAll('.lm-big .lm-unit')[0].textContent).toBe('LU');
    expect(loudnessText(-Infinity, { units: 1, target: -23 })).toBe('--');
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });

  it('only listens to its own slot when edited from a rack', async () => {
    const app = fakeApp();
    const p = openEffectDialog(app, def, { mode: 'edit', slotId: 's7', doc: null });
    const dlg = [...document.querySelectorAll('.fx-dialog')].at(-1);
    app.engine.emit('fx-readout', new Map([['rack:s8', Float32Array.of(-30, -30, -30, 0, 0, 0, -30, -30, 1)]]));
    expect(dlg.querySelectorAll('.lm-value')[1].textContent).toBe('-∞');
    app.engine.emit('fx-readout', new Map([['trk:abc:s7', Float32Array.of(-30, -30, -30, 0, 0, 0, -30, -30, 1)]]));
    expect(dlg.querySelectorAll('.lm-value')[1].textContent).toBe('-30.0');
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});
