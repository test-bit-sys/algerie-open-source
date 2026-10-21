import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, registerEffect } from '../src/effects/registry.js';
import { openEffectDialog, paramControls } from '../src/effects/dialog.js';
import { fakeApp, filled } from './fx-helpers.js';

registerEffect({
  id: 'dlgEq',
  name: 'Dialog EQ',
  group: 'Filter and EQ',
  kind: 60,
  params: [
    { id: 'band1Freq', label: 'Frequency', min: 20, max: 20000, step: 1, default: 1000, unit: 'Hz', scale: 'log', section: 'Band 1' },
    { id: 'band1Gain', label: 'Gain', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB', section: 'Band 1' },
    { id: 'shape', label: 'Shape', type: 'choice', options: [{ value: 0, label: 'Bell' }, { value: 1, label: 'Notch' }], default: 0 },
    { id: 'env', label: 'Envelope', type: 'envelope', min: 0, max: 2, unit: '%', default: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
  ],
  presets: [{ name: 'Flat', values: { band1Gain: 0 } }],
});

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(4800, 0.1))] });
  app.active = doc;
  return { app, doc };
}

describe('effect dialog', () => {
  it('is titled "Effect - Name" and generates controls from the schema', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('amplify'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.querySelector('.dialog-title').textContent).toBe('Effect - Amplify');
    expect(dlg.querySelectorAll('input[type=range]')).toHaveLength(2);
    expect(dlg.querySelectorAll('.hot[role=spinbutton]')).toHaveLength(2);
    expect(dlg.querySelector('input[type=checkbox]').checked).toBe(true);
    expect(dlg.querySelector('.fx-preset-select').value).toBe('Default');
    dlg.querySelector('.dialog-head .icon-btn').click();
    expect(await p).toBeNull();
  });

  it('linked sliders move together and Apply resolves the values', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('amplify'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    const left = dlg.querySelector('input[type=range]');
    left.value = '4';
    left.dispatchEvent(new Event('input'));
    expect(dlg.querySelectorAll('input[type=range]')[1].value).toBe('4');
    expect(dlg.querySelector('.fx-preset-select').value).not.toBe('Default');
    dlg.querySelector('.btn.primary').click();
    expect(await p).toEqual({ left: 4, right: 4, linked: true });
  });

  it('picks presets and saves a user preset inline', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('amplify'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    const sel = dlg.querySelector('.fx-preset-select');
    sel.value = '+10 dB Boost';
    sel.dispatchEvent(new Event('change'));
    expect(dlg.querySelector('input[type=range]').value).toBe('10');
    dlg.querySelector('[aria-label="Save settings as a preset"]').click();
    const name = dlg.querySelector('.fx-namebar input');
    name.value = 'Loud';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.prefs.get('fxPresets').amplify[0].name).toBe('Loud');
    expect(document.querySelector('.fx-dialog')).not.toBeNull(); // Enter saved the preset, not Apply
    dlg.querySelector('.dialog-foot .btn:not(.primary)').click();
    expect(await p).toBeNull();
  });

  it('shows sections, choices, envelope and an EQ curve editor; drives app.previewFx', async () => {
    const { app, doc } = setup();
    let synced = 0;
    app.syncGraph = () => synced++;
    const p = openEffectDialog(app, getEffect('dlgEq'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect([...dlg.querySelectorAll('.fx-group > legend')].map((e) => e.textContent)).toEqual(['Band 1']);
    expect(dlg.querySelector('.fx-eq')).not.toBeNull();
    expect(dlg.querySelectorAll('.fx-eq .fx-handle')).toHaveLength(1);
    expect(dlg.querySelector('.fx-envelope')).not.toBeNull();
    expect(dlg.querySelectorAll('.fx-envelope .fx-point')).toHaveLength(2);
    const handle = dlg.querySelector('.fx-eq .fx-handle');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
    expect(dlg.querySelectorAll('input[type=range]')[1].value).toBe('2');
    dlg.querySelector('.fx-play').click();
    expect(app.previewFx).toHaveLength(1);
    expect(app.previewFx[0]).toMatchObject({ key: 'preview:dlgEq', kind: 60, enabled: true });
    dlg.querySelector('.fx-power').click();
    expect(app.previewFx[0].enabled).toBe(false);
    dlg.querySelector('.btn.primary').click();
    const v = await p;
    expect(v.band1Gain).toBe(2);
    expect(app.previewFx).toBeNull();
    expect(synced).toBeGreaterThan(0);
  });

  it('edit mode reports live changes and has no Apply', async () => {
    const { app, doc } = setup();
    const seen = [];
    const p = openEffectDialog(app, getEffect('amplify'), { doc, mode: 'edit', values: { left: 1, right: 1, linked: false }, onChange: (v) => seen.push(v) });
    const dlg = document.querySelector('.fx-dialog');
    expect([...dlg.querySelectorAll('.dialog-foot .btn')].map((b) => b.textContent)).toEqual(['Close']);
    const r = dlg.querySelectorAll('input[type=range]')[1];
    r.value = '-5';
    r.dispatchEvent(new Event('input'));
    expect(seen.at(-1)).toEqual({ left: 1, right: -5, linked: false });
    dlg.querySelector('.btn.primary').click();
    await p;
  });
});

describe('paramControls', () => {
  it('reflects external value changes', () => {
    const def = getEffect('amplify');
    let values = { left: 0, right: 0, linked: true };
    const c = paramControls(def, () => values, () => {});
    values = { left: -6, right: 3, linked: false };
    c.refresh(values);
    const ranges = c.el.querySelectorAll('input[type=range]');
    expect(ranges[0].value).toBe('-6');
    expect(c.el.querySelectorAll('.hot')[1].textContent).toBe('3.0 dB');
    expect(c.el.querySelector('input[type=checkbox]').checked).toBe(false);
  });
});
