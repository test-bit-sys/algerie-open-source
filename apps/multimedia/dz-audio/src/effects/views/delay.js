// Dialog views for Delay and Echo: Delay, Echo and Analog Delay show their
// delay times in the chosen Delay Time Units (milliseconds, beats or
// samples, time-units.js); the Flanger shows its sweep in beats.

import { h } from '../../lib/dom.js';
import { registerEditor } from '../editors.js';
import { controlsFor, groupBox, checkbox, sectionControls } from '../layout.js';
import { timeUnits, beatsField } from '../time-units.js';

function delayView(ctx) {
  const t = timeUnits(ctx);
  const channel = (name, prefix) => groupBox(`${name} Channel`, t.rows([`${prefix}Delay`]), controlsFor(ctx, [`${prefix}Mix`, `${prefix}Invert`]));
  return h('div.fx-stack', channel('Left', 'left'), channel('Right', 'right'), t.select);
}
delayView.hides = true;

function echoView(ctx) {
  const t = timeUnits(ctx);
  const channel = (name, prefix) => groupBox(`${name} Channel`, t.rows([`${prefix}Delay`]), controlsFor(ctx, [`${prefix}Feedback`, `${prefix}Level`]));
  return h(
    'div.fx-stack',
    h('div.fx-split.echo-split', h('div.fx-stack', channel('Left', 'left'), channel('Right', 'right')), sectionControls(ctx, ['Successive Echo Equalizer'])),
    h('div.fx-units-bar', t.select, checkbox(ctx, 'lock', { label: 'Lock Left & Right' }), checkbox(ctx, 'bounce')),
    controlsFor(ctx, ['dry']),
  );
}
echoView.hides = true;
echoView.dialogClass = 'fx-wide';

function analogDelayView(ctx) {
  const t = timeUnits(ctx);
  return h('div.fx-stack', controlsFor(ctx, ['mode', 'dry', 'wet']), t.rows(['delay']), controlsFor(ctx, ['feedback', 'trash', 'spread', 'lowCut', 'highCut']), t.select);
}
analogDelayView.hides = true;

// Flanger: the modulation rate can also be read and set as beats per sweep.
function flangerView(ctx) {
  return h(
    'div.fx-stack',
    groupBox('Characteristics', controlsFor(ctx, ['initialDelay', 'finalDelay', 'phasing', 'feedback', 'rate']), beatsField(ctx, 'rate')),
    groupBox('Mode', controlsFor(ctx, ['inverted', 'special', 'sinusoidal'])),
    controlsFor(ctx, ['mix', 'gain']),
  );
}
flangerView.hides = true;

registerEditor('delay', delayView);
registerEditor('flanger', flangerView);
registerEditor('echo', echoView);
registerEditor('analogDelay', analogDelayView);
