// Dialog views for Amplitude effects laid out by hand. Normalize: the target
// beside its switch and unit, the equal-channels option, and DC bias adjust
// with its amount, in three compact rows.

import { h } from '../../lib/dom.js';
import { registerEditor } from '../editors.js';
import { checkbox, numberField, radioChoice, enableWhen, showWhen } from '../layout.js';

function normalizeView(ctx) {
  const target = h(
    'span.nm-target',
    showWhen(ctx, h('span', numberField(ctx, 'targetPercent')), (v) => v.unit === 1),
    showWhen(ctx, h('span', numberField(ctx, 'targetDb')), (v) => v.unit === 0),
  );
  return h(
    'div.fx-stack.nm-view',
    h('div.nm-row', checkbox(ctx, 'normalizeTo', { label: 'Normalize To:' }), enableWhen(ctx, h('span.nm-row', target, radioChoice(ctx, 'unit', { label: null })), (v) => v.normalizeTo)),
    enableWhen(ctx, h('div.nm-row', checkbox(ctx, 'equal')), (v) => v.normalizeTo),
    h('div.nm-row', checkbox(ctx, 'removeDc', { label: 'DC Bias Adjust:' }), enableWhen(ctx, h('span', numberField(ctx, 'dcAmount')), (v) => v.removeDc)),
  );
}
normalizeView.hides = true;

registerEditor('normalize', normalizeView);
