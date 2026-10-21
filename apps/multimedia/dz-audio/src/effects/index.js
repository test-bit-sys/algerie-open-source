// Public entry for effects: the registry contract plus every registered
// definition. UI code (dialogs, Effects Rack, favorites) imports from here, so
// every definition has registered before commands and menus are built.

import { EFFECTS, defaults } from './registry.js';
import { setWorkerFactory } from './offline-fx.js';
import './catalog.js';

if (typeof Worker !== 'undefined') {
  setWorkerFactory(() => new Worker(new URL('./fx-worker.js', import.meta.url), { type: 'module' }));
}

export * from './registry.js';

/** Values with defaults filled in. */
export function withDefaults(def, values = {}) {
  return { ...defaults(def), ...values };
}

/** Processing delay of one effect in frames (0 when it has none). */
export function effectLatency(def, values = {}, rate = 48000) {
  return Math.max(0, Math.round(def?.latency?.(withDefaults(def, values), rate) || 0));
}

/** Frames an effect rings on after its input ends (reverb, echo). */
export function effectTail(def, values = {}, rate = 48000) {
  return Math.max(0, Math.round(def?.tail?.(withDefaults(def, values), rate) || 0));
}

/** Total latency and tail of a chain of { def, values, enabled } entries. */
export function chainTiming(entries, rate = 48000) {
  let latency = 0;
  let tail = 0;
  for (const e of entries) {
    if (e.enabled === false || !e.def) continue;
    latency += effectLatency(e.def, e.values, rate);
    tail += effectTail(e.def, e.values, rate);
  }
  return { latency, tail };
}

/** Definitions in menu order for a group label. */
export function effectsInGroup(group) {
  return [...EFFECTS.values()].filter((d) => d.group === group);
}
