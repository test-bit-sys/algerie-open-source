// Clip remix in sessions: analysing the music, planning remixes and making
// the derived (remixed) media that remixed clips play (see
// model/clip-remix.js for the clip model and remix-analysis.js for the DSP).
//
// It follows clip stretching (multitrack/stretch.js):
//  - The analysis of an original source (beats, tempo, per-beat features)
//    runs once in the background and is cached until that audio changes.
//    A session opened from a file analyses its remixed clips again on first
//    use (the analysis is not saved; the remixed audio and its plan are).
//  - With the analysis at hand a plan takes milliseconds, so the undo step
//    applies at once with the clip pointing at a derived pool source. Until
//    its render is done that source holds a preview: the segments spliced
//    with hard cuts (shared sample blocks, no copying).
//  - The render joins the segments with equal-power crossfades and replaces
//    the pool source's channels (not an undo step). Derived sources are
//    cached in the pool by remixKey, so undo, redo and split halves reuse
//    them. Saving, mixdowns, bounces and exports wait for pending renders.

import { Channel } from '../audio/channel.js';
import { UserError } from '../lib/errors.js';
import * as S from '../model/session-edits.js';
import { isStretched } from '../model/clip-stretch.js';
import { REMIX_DEFAULTS, REMIX_XFADE, isRemixed, remixOf, remixOrigin, remixKey, remixLength, remixClip, revertRemixes, splitRemix } from '../model/clip-remix.js';
// The analysis code is loaded the first time a clip is remixed.
let analysisModule = null;
export const loadRemixAnalysis = async () => (analysisModule ??= await import('./remix-analysis.js'));
const analyzeMusic = async (...args) => (await loadRemixAnalysis()).analyzeMusic(...args);
const renderRemix = async (...args) => (await loadRemixAnalysis()).renderRemix(...args);

/** Hard-cut splice of `channels` (Channel[]) along segments: the preview while the crossfaded render runs. */
export function spliceChannels(channels, segments) {
  return channels.map((ch) => {
    const parts = segments.map(([a, b]) => ch.slice(a, b));
    return parts.length ? parts[0].concat(...parts.slice(1)) : Channel.empty();
  });
}

/** Pads with silence or cuts to exactly `length` samples. */
function fit(a, length) {
  if (a.length === length) return a;
  const out = new Float32Array(length);
  out.set(a.subarray(0, Math.min(length, a.length)));
  return out;
}

export class Remixer {
  /**
   * @param {object} app
   * @param {import('../model/session.js').Session} doc
   * @param {{ analyze?: Function, render?: Function }} [o] analyze(channels: Float32Array[], rate, { signal, onProgress }),
   *   render(channels: Float32Array[], segments, xfade, { signal })
   */
  constructor(app, doc, { analyze = analyzeMusic, render = renderRemix } = {}) {
    this.app = app;
    this.doc = doc;
    this.analyze = analyze;
    this.render = render;
    /** sourceId -> { ref (the analysed channels), promise, result, error, progress } */
    this.analyses = new Map();
    this.queue = [];
    this.running = null;
    this.idle = Promise.resolve();
    this.resolveIdle = null;
    this.ctrl = new AbortController();
  }

  // ------------------------------------------------------------ analysis

  /** Where the analysis of `sourceId` stands: { state: 'none'|'running'|'done'|'error', progress, result, error }. */
  analysisStatus(sourceId) {
    const a = this.analyses.get(sourceId);
    const src = this.doc.pool.get(sourceId);
    if (!a || !src || a.ref !== src.channels) return { state: 'none', progress: 0 };
    if (a.error) return { state: 'error', error: a.error, progress: 0 };
    return a.result ? { state: 'done', result: a.result, progress: 1 } : { state: 'running', progress: a.progress };
  }

  /** The finished analysis of `sourceId`, or null. */
  analysisOf(sourceId) {
    const s = this.analysisStatus(sourceId);
    return s.state === 'done' ? s.result : null;
  }

  /**
   * The analysis of an original source (started, or the cached one), as a
   * promise. `onProgress` follows a running analysis.
   */
  analysis(sourceId, { onProgress } = {}) {
    const src = this.doc.pool.get(sourceId);
    if (!src?.channels?.length) return Promise.reject(new UserError('This clip’s media is offline, so it cannot be remixed.'));
    let a = this.analyses.get(sourceId);
    if (!a || a.ref !== src.channels || a.error) {
      a = { ref: src.channels, result: null, error: null, progress: 0, listeners: new Set() };
      const entry = a;
      const name = src.name || 'audio';
      let last = -1;
      a.promise = this.analyze(
        src.channels.map((ch) => ch.toArray()),
        this.doc.sampleRate,
        {
          signal: this.ctrl.signal,
          onProgress: (p) => {
            entry.progress = p;
            for (const fn of entry.listeners) fn(p);
            const pct = Math.floor(p * 100);
            if (pct !== last && pct % 10 === 0) {
              last = pct;
              this.app.setStatus?.(`Analysing ${name} ${pct}%`);
            }
          },
        },
      ).then(
        (result) => {
          entry.result = result;
          entry.progress = 1;
          this.app.setStatus?.(`Analysed ${name}: ${result.beats.length} beats, ${Math.round(result.bpm * 10) / 10} BPM`);
          return result;
        },
        (err) => {
          entry.error = err;
          throw err;
        },
      );
      // Unobserved failures are reported where the analysis is awaited.
      a.promise.catch(() => {});
      this.analyses.set(sourceId, a);
    }
    if (onProgress) {
      a.listeners.add(onProgress);
      onProgress(a.progress);
      a.promise.finally(() => a.listeners.delete(onProgress)).catch(() => {});
    }
    return a.promise;
  }

  /** Starts analysing the originals of remixed clips (after a session opens), so retargeting is quick. */
  prepare() {
    const seen = new Set();
    for (const c of this.doc.state.clips) {
      if (!isRemixed(c) || seen.has(c.remix.sourceId)) continue;
      seen.add(c.remix.sourceId);
      if (this.doc.pool.get(c.remix.sourceId)?.channels?.length && this.analysisStatus(c.remix.sourceId).state === 'none') this.analysis(c.remix.sourceId);
    }
  }

  // ------------------------------------------------------------- planning

  /** Remix settings for a clip: its current ones (or defaults) with `patch` over them; the target defaults to its length. */
  settingsFor(clip, patch = {}) {
    const cur = remixOf(clip) || { ...REMIX_DEFAULTS };
    const s = { ...cur, ...patch };
    if (!(s.target > 0)) s.target = clip.length;
    s.target = Math.max(Math.round(this.doc.sampleRate * 0.25), Math.round(s.target));
    s.xfade = Math.round(REMIX_XFADE * this.doc.sampleRate);
    return s;
  }

  /** The plan for a clip with settings, from a finished analysis (rejects on music it cannot remix). */
  async planFor(clip, settings, analysis) {
    const origin = remixOrigin(clip);
    const { planRemix } = await loadRemixAnalysis();
    return planRemix(analysis, {
      start: origin.offset,
      target: settings.target,
      edit: settings.edit,
      balance: settings.balance,
      maxJump: settings.maxJump,
      beatsPerBar: this.doc.state.beatsPerBar || 4,
    });
  }

  /** Pool id of the derived source for `sourceId` and segments, adding a preview and queueing its render. */
  derived(sourceId, segments, xfade, key = remixKey(sourceId, segments, xfade)) {
    const doc = this.doc;
    if (doc.pool.has(key)) return key;
    const orig = doc.pool.get(sourceId);
    if (!orig?.channels?.length) throw new UserError('This clip’s media is offline, so it cannot be remixed.');
    doc.addSource({ id: key, name: `${orig.name || 'Audio'} (remix)`, channels: spliceChannels(orig.channels, segments), sampleRate: doc.sampleRate });
    Object.assign(doc.pool.get(key), { pending: true, derived: { from: sourceId, fromRef: orig.channels, remix: true, segments, xfade } });
    this.#enqueue(key);
    return key;
  }

  /**
   * Remixes one clip with settings `patch` (over its current ones) as one
   * undo step, analysing its music first when needed. Returns the plan, or
   * null when the clip went away meanwhile. A stretched clip loses its stretch.
   */
  async remix(label, id, patch = {}, { onProgress } = {}) {
    const doc = this.doc;
    const c0 = S.findClip(doc.state, id);
    if (!c0) return null;
    const origin = remixOrigin(c0);
    const analysis = await this.analysis(origin.sourceId, { onProgress });
    // The clip may have changed while the analysis ran; plan for it as it is now.
    const c = S.findClip(doc.state, id);
    if (!c || remixOrigin(c).sourceId !== origin.sourceId) return null;
    const settings = this.settingsFor(c, patch);
    const plan = await this.planFor(c, settings, analysis);
    if (S.findClip(doc.state, id) !== c) return null;
    const key = this.derived(origin.sourceId, plan.segments, settings.xfade);
    const wasStretched = isStretched(c);
    const next = { ...doc.state, clips: doc.state.clips.map((x) => (x.id === id ? remixClip(x, { ...settings, bpm: analysis.bpm }, plan.segments, key) : x)) };
    doc.apply(label, next, { clips: [id] });
    if (wasStretched) this.app.setStatus?.('Clip stretching turned off: a clip is either remixed or stretched');
    return plan;
  }

  /** Reverts remixed clips to their original audio as one undo step. Returns false when none was remixed. */
  revert(label, ids) {
    const next = revertRemixes(this.doc.state, ids);
    if (next === this.doc.state) return false;
    this.doc.apply(label, next, { clips: ids });
    return true;
  }

  /** Replaces remixed clips by plain clips, one per segment, as one undo step. Returns the new clip ids. */
  split(label, ids) {
    const doc = this.doc;
    const set = new Set(ids);
    const made = [];
    const clips = [];
    for (const c of doc.state.clips) {
      if (!set.has(c.id) || !isRemixed(c)) {
        clips.push(c);
        continue;
      }
      const parts = splitRemix(c, () => S.uid('c'), doc.sourceLength(c.remix.sourceId) || Infinity);
      clips.push(...parts);
      made.push(...parts.map((p) => p.id));
    }
    if (!made.length) return [];
    doc.apply(label, { ...doc.state, clips }, { clips: made });
    return made;
  }

  // ------------------------------------------------------------ rendering

  /** Re-checks pending, stale and missing derived sources the current state uses (after undo, redo, opening or source edits). */
  sync() {
    const doc = this.doc;
    for (const c of doc.state.clips) {
      if (!isRemixed(c)) continue;
      // A session saved without its remixed media: make it again from the plan.
      if (!doc.pool.has(c.sourceId) && doc.pool.get(c.remix.sourceId)?.channels?.length) this.derived(c.remix.sourceId, c.remix.segments, c.remix.xfade || 0, c.sourceId);
      const src = doc.pool.get(c.sourceId);
      if (!src?.derived?.remix) continue;
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
    const spec = entry.derived;
    const orig = doc.pool.get(spec.from);
    const ctrl = new AbortController();
    this.running = { key, ctrl };
    const label = `Remixing ${orig?.name || 'clip'}`;
    try {
      if (!orig?.channels?.length) throw new Error('The original audio is offline.');
      const fromRef = orig.channels;
      const length = remixLength(spec.segments);
      this.app.setStatus?.(`${label}...`);
      const outs = await this.render(
        fromRef.map((ch) => ch.toArray()),
        spec.segments,
        spec.xfade,
        { signal: ctrl.signal },
      );
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
        this.app.notify?.(`Could not remix ${orig?.name || 'the clip'}: ${err?.message || err}`, { error: true });
      }
    } finally {
      this.running = null;
      this.#next();
    }
  }

  /** Cancels analyses, running and queued renders (the session closed). */
  cancel() {
    this.queue = [];
    this.running?.ctrl.abort();
    this.ctrl.abort();
    this.ctrl = new AbortController();
  }
}

/** The session's Remixer, created on first use. */
export function remixerFor(app, doc) {
  if (!doc.remixer) {
    doc.remixer = new Remixer(app, doc);
    doc.on?.('close', () => doc.remixer.cancel());
  }
  return doc.remixer;
}

/** Waits for a session's pending remix renders (before saving, rendering or copying audio). */
export async function remixIdle(doc) {
  if (doc?.remixer?.busy) await doc.remixer.whenIdle();
}

/**
 * Why a clip cannot be remixed, or null when it can: it needs online media,
 * must not be locked, and Sound Assistant must not call it something other
 * than music.
 */
export function remixBlocker(doc, clip) {
  if (!clip) return 'Select a clip to remix.';
  if (clip.locked) return 'This clip is locked in time.';
  const origin = remixOrigin(clip);
  if (!doc.pool.get(origin.sourceId)?.channels?.length) return 'This clip’s media is offline.';
  const type = clip.soundAssistant?.type;
  if (type && type !== 'music') return 'Remix works on music clips.';
  if (doc.sourceLength(origin.sourceId) - origin.offset < doc.sampleRate * 2) return 'This clip is too short to remix.';
  return null;
}
