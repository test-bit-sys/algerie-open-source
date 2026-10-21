// Dialog views for Reverb: Full Reverb (settings and coloration tabs, room
// readout, output faders), Convolution Reverb and Surround Reverb (impulse
// choice with loading your own impulse response from an audio file, kept on
// this device across reloads).

import { h, announce } from '../../lib/dom.js';
import { registerEditor } from '../editors.js';
import { controlsFor, groupBox, tabPanels, vSlider, checkbox, readout } from '../layout.js';
import { responseEditor } from './common.js';
import { roomDimensions, decayForRoom, LOADED_IMPULSE } from '../defs/reverb.js';
import { setLoadedImpulse, loadedImpulse, loadedImpulseNames, MAX_LOADED_SECONDS } from '../defs/reverb-impulses.js';
import { saveImpulse } from '../../storage/impulses.js';
import { pickLocalFiles } from '../../storage/files.js';
import { decodeAudio } from '../../audio/decode.js';

// ------------------------------------------------------------- Full Reverb

const coloration = responseEditor({
  label: 'Reverb coloration curve',
  span: [-15, 15],
  step: 5,
  handles: (v) => [
    { label: 'Low shelf', freq: v.lowShelfFreq, gain: v.lowShelfGain, ids: { freq: 'lowShelfFreq', gain: 'lowShelfGain' } },
    { label: 'Mid band', freq: v.midFreq, gain: v.midGain, q: v.midQ, ids: { freq: 'midFreq', gain: 'midGain', q: 'midQ' } },
    { label: 'High shelf', freq: v.highShelfFreq, gain: v.highShelfGain, ids: { freq: 'highShelfFreq', gain: 'highShelfGain' } },
  ],
});

function fullReverbView(ctx) {
  const dims = readout(ctx, (v) => {
    const [w, d, hgt] = roomDimensions(v.roomSize, v.dimension);
    return `Room: ${w.toFixed(1)} x ${d.toFixed(1)} x ${hgt.toFixed(1)} m (width x depth x height)`;
  }, 'faint');
  const fromRoom = h('button.btn', {
    type: 'button',
    title: 'Set the decay time from the room size and perception',
    onclick: () => {
      const v = ctx.values;
      ctx.set('decay', decayForRoom(v.roomSize, v.dimension, v.perception));
      announce(`Decay ${ctx.values.decay} ms`);
    },
  }, 'Set Decay From Room Size');
  const settings = h(
    'div.fx-stack',
    groupBox('Reverberation', controlsFor(ctx, ['decay', 'preDelay', 'diffusion', 'perception'])),
    groupBox('Early Reflections', controlsFor(ctx, ['roomSize', 'dimension', 'location', 'hpCut']), h('div.nr-bar', dims, h('div.spacer'), fromRoom)),
  );
  const color = h(
    'div.fx-stack',
    coloration(ctx),
    controlsFor(ctx, ['lowShelfFreq', 'lowShelfGain', 'midFreq', 'midGain', 'midQ', 'highShelfFreq', 'highShelfGain']),
  );
  const tabs = tabPanels([
    { label: 'Reverb Settings', content: settings },
    { label: 'Coloration', content: color },
  ], { label: 'Full Reverb settings' });
  const output = groupBox(
    'Output Level',
    h('div.rv-faders', vSlider(ctx, 'dry', { label: 'Dry' }), vSlider(ctx, 'reverb', { label: 'Reverb' }), vSlider(ctx, 'early', { label: 'Early' })),
    h('div.fx-stack.rv-checks', checkbox(ctx, 'includeDirect'), checkbox(ctx, 'sumInputs')),
  );
  return h('div.fx-split.rv-split', groupBox('', tabs), output);
}
fullReverbView.hides = true;
fullReverbView.dialogClass = 'fx-wide';

// ------------------------------------------- Convolution, Surround Reverb

/** Loads an audio file as the impulse response and selects it. */
async function loadImpulse(ctx) {
  const [file] = await pickLocalFiles({ multiple: false });
  if (!file) return;
  try {
    const r = await decodeAudio(await file.arrayBuffer(), file.name);
    const n = Math.min(r.channels[0].length, Math.round(MAX_LOADED_SECONDS * r.sampleRate));
    const impulse = { rate: r.sampleRate, channels: r.channels.slice(0, 2).map((c) => c.slice(0, n)) };
    setLoadedImpulse(file.name, impulse);
    // Kept on this device, so reloads and saved settings find it again.
    saveImpulse(file.name, impulse);
    ctx.set('impulseName', file.name);
    ctx.set('impulse', LOADED_IMPULSE);
    announce(`Impulse ${file.name} loaded`);
  } catch (err) {
    ctx.app?.notify(err?.message || 'That file could not be used as an impulse.', { error: true });
  }
}

function impulseRow(ctx) {
  const load = h('button.btn', { type: 'button', title: `Use an audio file as the impulse response (up to ${MAX_LOADED_SECONDS} s)`, onclick: () => loadImpulse(ctx) }, 'Load...');
  const status = readout(ctx, (v) => {
    if (v.impulse !== LOADED_IMPULSE) return '';
    if (!v.impulseName) return 'Load an audio file to use as the impulse.';
    return loadedImpulse(v.impulseName) ? '' : `${v.impulseName} is not on this device; using Large Hall until you load it again.`;
  }, 'faint');
  // The impulses kept on this device, to switch between them.
  const files = h('select.select.rv-impulse-files', { 'aria-label': 'Loaded impulse file', onchange: () => ctx.set('impulseName', files.value) });
  const showFiles = (v) => {
    const names = loadedImpulseNames();
    if (v.impulseName && !names.includes(v.impulseName)) names.unshift(v.impulseName);
    files.replaceChildren(...names.map((n) => h('option', { value: n }, n)));
    files.value = v.impulseName;
    files.hidden = v.impulse !== LOADED_IMPULSE || !names.length;
  };
  showFiles(ctx.values);
  ctx.subscribe(showFiles);
  return h('div.fx-stack', h('div.rv-impulse', controlsFor(ctx, ['impulse']), load), h('div.rv-impulse-file', files, status));
}

function convolutionView(ctx) {
  return h('div.fx-stack', impulseRow(ctx), controlsFor(ctx, ['mix', 'roomSize', 'dampLF', 'dampHF', 'preDelay', 'width', 'gain']));
}
convolutionView.hides = true;

function surroundView(ctx) {
  const input = groupBox('Input', h('div.rv-faders', vSlider(ctx, 'centerSend', { label: 'Center' }), vSlider(ctx, 'lfeSend', { label: 'LFE' })));
  const settings = groupBox('Reverb Settings', impulseRow(ctx), controlsFor(ctx, ['roomSize', 'dampLF', 'dampHF', 'preDelay', 'width', 'surroundWidth']));
  const output = groupBox(
    'Output',
    h(
      'div.rv-faders',
      vSlider(ctx, 'centerWet', { label: 'C Wet' }),
      vSlider(ctx, 'balance', { label: 'L/R Bal' }),
      vSlider(ctx, 'fbBalance', { label: 'F/B Bal' }),
      vSlider(ctx, 'mix', { label: 'Mix' }),
      vSlider(ctx, 'gain', { label: 'Gain' }),
    ),
  );
  // On stereo there is no LFE or rear pair: the LFE send waits for 5.1, and the rear folds into the front as F/B moves back.
  const note = h('div.faint.rv-note', 'On 5.1 tracks and a 5.1 master the reverb fills all six speakers. On stereo, moving F/B toward the back blends in the delayed rear reverb; the LFE send needs 5.1.');
  return h('div.fx-stack', h('div.rv-surround', input, settings, output), note);
}
surroundView.hides = true;
surroundView.dialogClass = 'fx-wide';

registerEditor('fullReverb', fullReverbView);
registerEditor('convolutionReverb', convolutionView);
registerEditor('surroundReverb', surroundView);
