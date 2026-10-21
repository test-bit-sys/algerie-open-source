// Clip stretching in sessions: making the derived (stretched) media that
// stretched clips play (see model/clip-stretch.js for the clip model).
//
// How Realtime and Rendered work here: true realtime stretching inside the
// mixer worklet is not practical, because the phase vocoder runs offline,
// streamed through the WASM time/pitch jobs in an effect worker. So both
// modes render in the background, and the edit itself is instant:
//  - The undo step applies at once with the clip pointing at a derived pool
//    source. Until its render is done that source holds a preview: the
//    other-quality render when one exists, otherwise a varispeed (resampled)
//    copy of the original, so the timing is already right (the pitch of the
//    preview follows the speed).
//  - Realtime renders with the fast, low-precision vocoder setting, and
//    re-renders whenever the stretch changes (each corner-handle drag).
//  - Rendered uses the high-precision setting: slower, cleaner, what a
//    bounce or export should hear.
// When a render finishes it replaces the pool source's channels (not an undo
// step), so playback, mixdown and the waveform pick it up. Derived sources
// are cached in the pool by stretchKey, so undo, redo, split halves and
// copies reuse them; renders that nothing refers to any more are skipped
// until an undo brings them back. Saving waits for pending renders.

import { Channel } from '../audio/channel.js';
import { UserError } from '../lib/errors.js';
import { normalizeValues } from '../effects/params.js';
import { getEffect } from '../effects/index.js';
import { stretchOf, stretchActive, stretchKey, stretchClips } from '../model/clip-stretch.js';
import { revertRemixes } from '../model/clip-remix.js';

/** Varispeed copy of `samples` that lasts `ratio` times as long (linear interpolation). */
export function varispeed(samples, ratio, outLength = Math.max(1, Math.round(samples.length * ratio))) {
  const out = new Float32Array(outLength);
  const n = samples.length;
  if (!n) return out;
  const step = n > 1 && outLength > 1 ? (n - 1) / (outLength - 1) : 0;
  for (let i = 0; i < outLength; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    const a = samples[j];
    out[i] = j + 1 < n ? a + (samples[j + 1] - a) * f : a;
  }
  return out;
}

/** Pads with silence or cuts to exactly `length` samples. */
function fit(a, length) {
  if (a.length === length) return a;
  const out = new Float32Array(length);
  out.set(a.subarray(0, Math.min(length, a.length)));
  return out;
}

/** Stretch and Pitch over whole channels: Realtime at low precision, Rendered at high. */
async function defaultRender({ channels, rate, settings, signal, onProgress }) {
  const def = getEffect('stretchPitch');
  const values = normalizeValues(def, {
    algorithm: 0,
    stretch: settings.ratio * 100,
    semitones: settings.semitones,
    cents: 0,
    precision: settings.mode === 'rendered' ? 2 : 0,
    lockChannels: true,
    formants: settings.formants,
  });
  const outs = await def.process({ channels, rate, values, signal, onProgress });
  return Array.isArray(outs) ? outs : outs.channels;
}

export class Stretcher {
  /**
   * @param {object} app
   * @param {import('../model/session.js').Session} doc
   * @param {{ render?: Function }} [o] render({ channels: Float32Array[], rate, settings, signal, onProgress }) => Float32Array[]
   */
  constructor(app, doc, { render = defaultRender } = {}) {
    this.app = app;
    this.doc = doc;
    this.render = render;
    this.queue = [];
    this.running = null;
    this.idle = Promise.resolve();
    this.resolveIdle = null;
  }

  /** Pool id of the derived source for `sourceId` with `settings`, adding a preview and queueing its render. */
  derived(sourceId, settings) {
    const doc = this.doc;
    const key = stretchKey(sourceId, settings);
    if (doc.pool.has(key)) return key;
    const orig = doc.pool.get(sourceId);
    if (!orig?.channels?.length) throw new UserError('This clip’s media is offline, so it cannot be stretched.');
    const length = Math.max(1, Math.round(orig.channels[0].length * settings.ratio));
    // Preview: the same stretch at the other quality when it exists, else varispeed.
    const other = doc.pool.get(stretchKey(sourceId, { ...settings, mode: settings.mode === 'rendered' ? 'realtime' : 'rendered' }));
    let channels;
    if (other?.channels?.length && other.channels[0].length === length) channels = other.channels;
    else if (Math.abs(settings.ratio - 1) < 1e-6) channels = orig.channels.slice();
    else channels = orig.channels.map((ch) => Channel.fromSamples(varispeed(ch.toArray(), settings.ratio, length)));
    const pct = Math.round(settings.ratio * 1000) / 10;
    const pitch = settings.semitones ? ` ${settings.semitones > 0 ? '+' : ''}${settings.semitones} st` : '';
    doc.addSource({ id: key, name: `${orig.name || 'Audio'} (${pct}%${pitch})`, channels, sampleRate: doc.sampleRate });
    Object.assign(doc.pool.get(key), { pending: true, derived: { from: sourceId, fromRef: orig.channels, ...settings } });
    this.#enqueue(key);
    return key;
  }

  /**
   * Applies stretch settings (or a fn(clip) => settings) to clips as one undo
   * step. Returns false when nothing changed. A clip is either remixed or
   * stretched: stretching a remixed clip first reverts its remix (in the same
   * step), and mode Off leaves remixed clips alone.
   */
  apply(label, ids, patch, { clips } = {}) {
    const doc = this.doc;
    const remixed = new Set(doc.state.clips.filter((c) => c.remix && ids.includes(c.id)).map((c) => c.id));
    let base = doc.state;
    if (remixed.size && patch?.mode === 'off') ids = ids.filter((id) => !remixed.has(id));
    else if (remixed.size) base = revertRemixes(base, [...remixed]);
    const next = stretchClips(base, ids, patch, (sourceId, settings) => this.derived(sourceId, settings));
    if (next === doc.state) return false;
    doc.apply(label, next, clips ? { clips } : {});
    if (base !== doc.state) this.app.setStatus?.('Remix turned off: a clip is either remixed or stretched');
    return true;
  }

  /** Re-checks pending and stale derived sources the current state uses (after undo, redo or source edits). */
  sync() {
    const doc = this.doc;
    for (const c of doc.state.clips) {
      const src = doc.pool.get(c.sourceId);
      if (!src?.derived) continue;
      const orig = doc.pool.get(src.derived.from);
      // The original was edited in the Waveform editor: render again from the new audio.
      if (orig?.channels?.length && src.derived.fromRef !== orig.channels && !src.pending) {
        src.pending = true;
        src.derived.fromRef = orig.channels;
      }
      if (src.pending) this.#enqueue(c.sourceId);
    }
  }

  /** Resolves when no render is pending or running. */
  whenIdle() {
    return this.idle;
  }

  get busy() {
    return Boolean(this.running || this.queue.length);
  }

  #enqueue(key) {
    if (this.running?.key === key || this.queue.includes(key)) return;
    this.queue.push(key);
    if (!this.resolveIdle) this.idle = new Promise((r) => (this.resolveIdle = r));
    if (!this.running) queueMicrotask(() => this.#next());
  }

  async #next() {
    if (this.running) return;
    const doc = this.doc;
    const used = new Set(doc.state.clips.map((c) => c.sourceId));
    let key;
    while ((key = this.queue.shift())) {
      // Renders nothing refers to wait (pending) until an undo brings their clips back.
      if (used.has(key) && doc.pool.get(key)?.pending) break;
    }
    if (!key) {
      const done = this.resolveIdle;
      this.resolveIdle = null;
      done?.();
      return;
    }
    const entry = doc.pool.get(key);
    const settings = entry.derived;
    const orig = doc.pool.get(settings.from);
    const ctrl = new AbortController();
    this.running = { key, ctrl };
    const label = `Stretching ${orig?.name || 'clip'}`;
    let last = -1;
    try {
      if (!orig?.channels?.length) throw new Error('The original audio is offline.');
      const fromRef = orig.channels;
      const length = Math.max(1, Math.round(fromRef[0].length * settings.ratio));
      const outs = await this.render({
        channels: fromRef.map((ch) => ch.toArray()),
        rate: doc.sampleRate,
        settings,
        signal: ctrl.signal,
        onProgress: (p) => {
          const pct = Math.floor(p * 100);
          if (pct !== last && pct % 10 === 0) {
            last = pct;
            this.app.setStatus?.(`${label} ${pct}%`);
          }
        },
      });
      const current = doc.pool.get(key);
      // A newer edit of the original arrived while rendering: render again.
      if (current.derived.fromRef !== fromRef) this.queue.push(key);
      else {
        doc.updateSource(key, { channels: outs.slice(0, fromRef.length).map((o) => Channel.fromSamples(fit(o, length))), pending: false });
        this.app.setStatus?.(`${label} done`);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error(err);
        // Keep the preview so the clip still plays; do not retry in a loop.
        if (doc.pool.get(key)) doc.pool.get(key).pending = false;
        this.app.notify?.(`Could not stretch ${orig?.name || 'the clip'}: ${err?.message || err}`, { error: true });
      }
    } finally {
      this.running = null;
      this.#next();
    }
  }

  /** Cancels running and queued renders (the session closed). */
  cancel() {
    this.queue = [];
    this.running?.ctrl.abort();
  }
}

/** The session's Stretcher, created on first use. */
export function stretcherFor(app, doc) {
  if (!doc.stretcher) {
    doc.stretcher = new Stretcher(app, doc);
    doc.on?.('close', () => doc.stretcher.cancel());
  }
  return doc.stretcher;
}

/** Waits for a session's pending stretch renders (before saving or copying audio). */
export async function stretchIdle(doc) {
  if (doc?.stretcher?.busy) await doc.stretcher.whenIdle();
}

/** The current stretch settings of the first clip in `clips`, or defaults. */
export function firstStretch(clips) {
  return clips.length ? stretchOf(clips[0]) : { mode: 'off', ratio: 1, semitones: 0, formants: false };
}

/** Clips in a state whose stretch uses `mode` and changes the audio. */
export function stretchedClips(state, mode) {
  return state.clips.filter((c) => {
    const s = stretchOf(c);
    return stretchActive(s) && (!mode || s.mode === mode);
  });
}
