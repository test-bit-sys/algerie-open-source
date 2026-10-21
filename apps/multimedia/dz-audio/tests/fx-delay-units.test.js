// Delay Time Units: Delay, Echo and Analog Delay show delay times in
// milliseconds, beats (at the tempo) or samples; the values stay in ms.
import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect } from '../src/effects/index.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { toUnits, fromUnits, paramInUnits, timeScale } from '../src/effects/time-units.js';
import { fakeApp, filled } from './fx-helpers.js';
import '../src/effects/views/index.js';

const RATE = 44100;

function open(id, { tempo = 90, units = 'ms' } = {}) {
  const app = fakeApp();
  app.timeOptions = () => ({ tempo, beatNote: 4 });
  app.prefs.set('delayTimeUnits', units);
  const doc = new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: [Channel.fromSamples(filled(4800, 0.1)), Channel.fromSamples(filled(4800, 0.1))] });
  app.active = doc;
  let last = null;
  const p = openEffectDialog(app, getEffect(id), { doc, onChange: (v) => (last = v) });
  const dlg = [...document.querySelectorAll('.fx-dialog')].at(-1);
  const close = async () => {
    dlg.querySelector('.dialog-head .icon-btn').click();
    return p;
  };
  return { app, dlg, close, last: () => last };
}

const unitSelect = (dlg) => dlg.querySelector('.fx-units-row select');
const delayHot = (dlg, i = 0) => dlg.querySelectorAll('.fx-time-rows .hot')[i];

describe('delay time units', () => {
  it('converts between milliseconds, beats and samples', () => {
    const s = { beatMs: 500, rate: 48000 };
    expect(toUnits(250, 'beats', s)).toBe(0.5);
    expect(toUnits(250, 'samples', s)).toBe(12000);
    expect(fromUnits(12000, 'samples', s)).toBe(250);
    expect(fromUnits(0.5, 'beats', s)).toBe(250);
    const p = paramInUnits({ id: 'd', min: 1, max: 5000, default: 300, unit: 'ms', step: 1, scale: 'log' }, 'beats', s);
    expect(p).toMatchObject({ min: 0.002, max: 10, default: 0.6, unit: 'beats', scale: 'log' });
    // Session tempo first, then the Time Display tempo; a 6/8 beat note halves the beat.
    expect(timeScale({ doc: { state: { tempo: 60 }, sampleRate: 22050 }, app: { timeOptions: () => ({ tempo: 120 }) } })).toMatchObject({ beatMs: 1000, rate: 22050 });
    expect(timeScale({ app: { timeOptions: () => ({ tempo: 120, beatNote: 8 }) } }).beatMs).toBe(250);
  });

  it('shows Delay times in beats at the tempo and sets them back in ms', async () => {
    const { app, dlg, close, last } = open('delay', { tempo: 120 });
    expect(delayHot(dlg).textContent).toMatch(/250/);
    unitSelect(dlg).value = 'beats';
    unitSelect(dlg).dispatchEvent(new Event('change'));
    expect(app.prefs.get('delayTimeUnits')).toBe('beats');
    expect(delayHot(dlg).textContent).toMatch(/0\.5\d*\s*beats/);
    expect(dlg.querySelector('.fx-tempo-note').textContent).toBe('at 120 BPM');
    // Step up one unit step (0.001 beat = 0.5 ms at 120 BPM).
    delayHot(dlg).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(last().leftDelay).toBeCloseTo(250.5, 1);
    unitSelect(dlg).value = 'samples';
    unitSelect(dlg).dispatchEvent(new Event('change'));
    expect(delayHot(dlg).textContent).toMatch(/11047/);
    await close();
  });

  it('applies to Echo (both channels, lock still greys the right) and Analog Delay', async () => {
    const echo = open('echo', { tempo: 100, units: 'beats' });
    expect(echo.dlg.querySelectorAll('.fx-time-rows')).toHaveLength(2);
    expect(delayHot(echo.dlg).textContent).toMatch(/0\.5\d*\s*beats/);
    expect(delayHot(echo.dlg, 1).disabled).toBe(true);
    expect(echo.dlg.querySelector('.fx-vsliders')).toBeTruthy();
    await echo.close();
    const analog = open('analogDelay', { units: 'samples' });
    expect(delayHot(analog.dlg).textContent).toMatch(/15435\s*samples/);
    await analog.close();
  });
});

describe('flanger tempo sync', () => {
  it('reads the modulation rate as beats per sweep and sets it from beats', async () => {
    const { beatsPerCycle, rateForBeats } = await import('../src/effects/time-units.js');
    expect(beatsPerCycle(0.5, { beatMs: 500 })).toBe(4);
    expect(rateForBeats(4, { beatMs: 500 })).toBe(0.5);
    const { dlg, close, last } = open('flanger', { tempo: 120 });
    const hot = dlg.querySelector('.fx-beats-row .hot');
    // 0.3 Hz at 120 BPM: 6.667 beats per sweep.
    expect(hot.textContent).toMatch(/6\.667/);
    expect(dlg.querySelector('.fx-beats-row .fx-tempo-note').textContent).toMatch(/120 BPM/);
    hot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const input = dlg.querySelector('.fx-beats-row input');
    input.value = '8';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(last().rate).toBeCloseTo(0.25, 3);
    expect(dlg.querySelector('.fx-beats-row .hot').textContent).toMatch(/8\.000/);
    await close();
  });
});
