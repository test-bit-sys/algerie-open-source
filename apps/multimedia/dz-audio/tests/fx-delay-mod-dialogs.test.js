import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, defaults, slotSpec, effectLatency } from '../src/effects/index.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { FxHost } from '../src/engine/fxhost.js';
import { fakeApp, filled } from './fx-helpers.js';

const RATE = 48000;

function open(id) {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: [Channel.fromSamples(filled(4800, 0.1)), Channel.fromSamples(filled(4800, 0.1))] });
  app.active = doc;
  const p = openEffectDialog(app, getEffect(id), { doc, routing: {} });
  const dlg = document.querySelector('.fx-dialog');
  const close = async () => {
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  };
  return { dlg, close };
}

/** Runs an effect over stereo input in a fresh FxHost; returns [L, R]. */
function render(id, values, L, R) {
  const def = getEffect(id);
  const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
  const chain = host.sync([slotSpec(def, { ...defaults(def), ...values }, { key: 'k' })]);
  const out = [new Float32Array(L.length), new Float32Array(R.length)];
  for (let at = 0; at < L.length; at += 128) {
    const n = Math.min(128, L.length - at);
    const buf = [L.slice(at, at + n), R.slice(at, at + n)];
    host.run(chain, buf, n);
    out[0].set(buf[0], at);
    out[1].set(buf[1], at);
  }
  return out;
}

const rms = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length - from));
};

describe('Delay and Echo dialogs', () => {
  it('Delay frames each channel, labels the mix ends and allows negative times', async () => {
    const def = getEffect('delay');
    expect(def.params.find((p) => p.id === 'leftDelay').min).toBe(-500);
    expect(effectLatency(def, { leftDelay: -20, rightDelay: 10 }, RATE)).toBe(960);
    expect(effectLatency(def, { leftDelay: 20, rightDelay: 10 }, RATE)).toBe(0);
    const { dlg, close } = open('delay');
    expect([...dlg.querySelectorAll('.fx-group > legend')].map((l) => l.textContent)).toEqual(['Left Channel', 'Right Channel']);
    expect([...dlg.querySelectorAll('.fx-ends')][0].textContent).toBe('DryWet');
    await close();
  });

  it('a negative delay moves its channel earlier after latency compensation', () => {
    const n = 9600;
    const L = new Float32Array(n);
    L[4000] = 1;
    const out = render('delay', { leftDelay: -10, leftMix: 100, rightDelay: 0, rightMix: 100 }, L, L.slice());
    const lat = effectLatency(getEffect('delay'), { leftDelay: -10, rightDelay: 0 }, RATE);
    expect(out[0][4000 - 480 + lat]).toBeCloseTo(1, 4);
    expect(out[1][4000 + lat]).toBeCloseTo(1, 4);
  });

  it('Echo puts the channels beside a vertical equalizer and follows the lock', async () => {
    const { dlg, close } = open('echo');
    const cols = [...dlg.querySelectorAll('.fx-column')].map((c) => [...c.querySelectorAll('.fx-group')].map((g) => g.dataset.section));
    expect(cols).toEqual([['Left Channel', 'Right Channel'], ['Successive Echo Equalizer']]);
    expect(dlg.querySelectorAll('.fx-vslider')).toHaveLength(8);
    const right = dlg.querySelector('[data-section="Right Channel"] input[type=range]');
    expect(right.disabled).toBe(true);
    const lock = [...dlg.querySelectorAll('.fx-bool input')].find((b) => b.parentElement.textContent.includes('Lock'));
    lock.checked = false;
    lock.dispatchEvent(new Event('change'));
    expect(right.disabled).toBe(false);
    await close();
  });
});

describe('Modulation dialogs', () => {
  it('Chorus groups characteristics, stereo width and output level, with a voices menu', async () => {
    const { dlg, close } = open('chorus');
    const cols = [...dlg.querySelectorAll('.fx-column')].map((c) => [...c.querySelectorAll('.fx-group')].map((g) => g.dataset.section));
    expect(cols).toEqual([['Characteristics'], ['Stereo Width', 'Output Level']]);
    expect(dlg.querySelector('[data-section="Characteristics"] select').value).toBe('5');
    expect([...dlg.querySelectorAll('[data-section="Stereo Width"] .fx-bool')].map((b) => b.textContent)).toEqual(['Average Left and Right Input', 'Add Binaural Cues']);
    expect(getEffect('chorus').params.find((p) => p.id === 'wet').max).toBe(200);
    await close();
  });

  it('Chorus averages the inputs into every voice when asked', () => {
    const n = 24000;
    const L = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 700 * i) / RATE));
    const R = new Float32Array(n);
    const base = { voices: 2, width: 0, dry: 0, wet: 100 };
    expect(rms(render('chorus', base, L, R)[1], 12000)).toBeLessThan(1e-4);
    expect(rms(render('chorus', { ...base, average: true }, L, R)[1], 12000)).toBeGreaterThan(0.05);
  });

  it('Flanger frames its mode switches; Phaser takes negative feedback and a stages menu', async () => {
    let { dlg, close } = open('flanger');
    expect([...dlg.querySelectorAll('[data-section="Mode"] .fx-bool')].map((b) => b.textContent)).toEqual(['Inverted', 'Special Effects', 'Sinusoidal']);
    expect(getEffect('flanger').params.find((p) => p.id === 'phasing').max).toBe(360);
    await close();
    ({ dlg, close } = open('phaser'));
    const stages = dlg.querySelector('.fx-controls select');
    expect([...stages.options].map((o) => o.value)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(getEffect('phaser').params.find((p) => p.id === 'feedback').min).toBe(-90);
    await close();
  });

  it('Chorus/Flanger picks its mode with radio buttons', async () => {
    const { dlg, close } = open('chorusFlanger');
    expect([...dlg.querySelectorAll('.fx-radios label')].map((l) => l.textContent)).toEqual(['Chorus', 'Flanger']);
    await close();
  });
});
