// Dialog views for the equalizers. Parametric: master gain fader beside the
// curve (whose span follows Range), the band table, and Constant, Ultra-Quiet
// and Range along the bottom. Graphic: the response curve, a vertical
// slider per band whose span follows Range (6 to 48 dB, centred on 0), and
// Range, Accuracy and Master Gain underneath. Shrinking Range pulls bands
// that fall outside it back to its edge.

import { h } from '../../lib/dom.js';
import { registerEditor, eqEditor } from '../editors.js';
import { paramControls } from '../dialog.js';
import { controlsFor, groupBox, numberField, sectionControls, vSlider, radioChoice, checkbox } from '../layout.js';

/** Band params with their slider span set by Range. */
export function bandsInRange(def, range) {
  const half = Math.max(3, Math.min(24, range / 2));
  return def.params.filter((p) => p.section === 'Bands').map((p) => ({ ...p, min: -half, max: half }));
}

function graphicView(ctx) {
  const graph = eqEditor({ range: 24 })(ctx);
  const strip = h('div.geq-bands');
  let controls = null;
  let built = null;
  let from = null;
  const build = () => {
    built = ctx.values.range;
    controls = paramControls({ ...ctx.def, params: bandsInRange(ctx.def, built), layout: { vertical: ['Bands'] } }, () => ctx.values, (id, v) => {
      from = id;
      ctx.set(id, v);
      from = null;
    });
    strip.replaceChildren(controls.el);
  };
  build();
  ctx.subscribe((values) => {
    const half = values.range / 2;
    const over = bandsInRange(ctx.def, values.range).filter((p) => Math.abs(values[p.id]) > half + 1e-9);
    for (const p of over) ctx.set(p.id, Math.sign(values[p.id]) * half);
    if (over.length) return;
    if (values.range !== built) build();
    else controls.refresh(values, from);
  });
  const bottom = groupBox(
    '',
    h(
      'div.geq-settings',
      h('div.geq-range', h('span.fx-label', 'Range:'), numberField(ctx, 'range')),
      h('div.geq-accuracy', controlsFor(ctx, ['accuracy'])),
      h('div.geq-gain', controlsFor(ctx, ['gain'], { labels: { gain: 'Gain' } })),
    ),
  );
  return h('div.fx-stack', graph, strip, bottom);
}
graphicView.hides = true;

for (const id of ['graphicEq10', 'graphicEq20', 'graphicEq30']) registerEditor(id, Object.assign((ctx) => graphicView(ctx), { hides: true, dialogClass: id === 'graphicEq10' ? '' : 'fx-wide' }));

/** Graph span in dB either side of 0 for the Parametric Equalizer's Range. */
export const parametricSpan = (values) => (values.range === 1 ? 48 : 15);

function parametricView(ctx) {
  const graph = eqEditor({ range: parametricSpan })(ctx);
  const sections = [...new Set(ctx.def.params.map((p) => p.section).filter(Boolean))];
  return h(
    'div.fx-stack',
    h('div.peq-top', vSlider(ctx, 'gain', { label: 'Gain' }), graph),
    sectionControls(ctx, sections),
    h('div.peq-bottom', radioChoice(ctx, 'qMode'), checkbox(ctx, 'ultraQuiet'), radioChoice(ctx, 'range')),
  );
}
parametricView.hides = true;
parametricView.dialogClass = 'fx-wide';
registerEditor('parametricEq', parametricView);
