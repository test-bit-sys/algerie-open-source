// Clip > Remix: Enable Remix, Remix Properties, Split Remixed Clip into
// Segments and Revert Remix (see multitrack/remix.js).

import { h, announce } from '../lib/dom.js';
import { openDialog } from '../ui/dialog.js';
import { hotNumber } from '../ui/controls.js';
import { parseTime } from '../lib/time.js';
import { withProgress } from '../effects/progress.js';
import * as S from '../model/session-edits.js';
import { isRemixed, remixOrigin, MIN_REMIX_SECONDS } from '../model/clip-remix.js';
import { remixerFor, remixBlocker } from './remix.js';

const session = (app) => (app.active?.kind === 'session' ? app.active : null);
const selected = (app) => session(app)?.clipSelection || [];

/** The one selected clip when it is remixed or could be. */
function remixTarget(app) {
  const clips = selected(app);
  if (clips.length !== 1) return null;
  const c = clips[0];
  return isRemixed(c) || !remixBlocker(session(app), c) ? c : null;
}

const cancelled = () => new DOMException('Cancelled', 'AbortError');

/** "8 segments, 1:00.512 (target 1:00.000)" for a plan. */
function planSummary(app, doc, plan) {
  const t = (f) => app.formatTime(f, doc.sampleRate);
  const n = plan.segments.length;
  return `${n} segment${n === 1 ? '' : 's'}, ${t(plan.length)} (target ${t(plan.target)})${plan.fits ? '' : ', the closest this music allows'}`;
}

/**
 * Remixes clip `id` with settings `patch`. A first analysis shows progress
 * (and can be cancelled); errors become notices. Returns the plan or null.
 */
export async function runRemix(app, doc, label, id, patch) {
  const remixer = remixerFor(app, doc);
  const c = S.findClip(doc.state, id);
  if (!c) return null;
  const sourceId = remixOrigin(c).sourceId;
  try {
    let plan;
    if (remixer.analysisOf(sourceId)) plan = await remixer.remix(label, id, patch);
    else {
      plan = await withProgress(app, 'Analysing Music', (signal, onProgress) => {
        const stop = new Promise((_, reject) => signal.addEventListener('abort', () => reject(cancelled()), { once: true }));
        // The analysis goes on in the background after a cancel; only the remix is dropped.
        return Promise.race([remixer.analysis(sourceId, { onProgress }).then(() => (signal.aborted ? null : remixer.remix(label, id, patch))), stop]);
      });
    }
    if (plan) {
      app.setStatus(`Remixed: ${planSummary(app, doc, plan)}`);
      announce(`Clip remixed: ${planSummary(app, doc, plan)}`);
    }
    return plan;
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    app.notify(err?.message || 'The clip could not be remixed.', { error: true });
    return null;
  }
}

async function remixDialog(app, doc, clip) {
  const remixer = remixerFor(app, doc);
  const rate = doc.sampleRate;
  const cur = remixer.settingsFor(clip);
  const sourceId = remixOrigin(clip).sourceId;
  const format = app.prefs.get('timeFormat');
  const seconds = (text) => {
    const f = parseTime(text, rate, format, app.timeOptions?.() || {});
    return Number.isFinite(f) ? f / rate : parseTime(text, rate) / rate;
  };
  const summary = h('span.remix-summary', { 'aria-live': 'polite' }, '');
  const update = () => refresh();
  const target = hotNumber({ value: Math.round((cur.target / rate) * 1000) / 1000, min: MIN_REMIX_SECONDS, max: 3600, step: 0.1, format: (v) => app.formatTime(Math.round(v * rate), rate), parse: seconds, label: 'Target duration', onInput: update, onChange: update });
  const slider = (value, label) => h('input.slider', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(value * 100), 'aria-label': label });
  const edit = slider(cur.edit, 'Edit length');
  const balance = slider(cur.balance, 'Features balance');
  const maxJump = h('input.input.num', { type: 'number', min: 0, max: 9999, step: 1, value: cur.maxJump || 0, 'aria-label': 'Longest jump in beats' });
  const status = h('span.remix-status', { 'aria-live': 'polite' }, 'Waiting to analyse');
  for (const el of [edit, balance, maxJump]) el.addEventListener('input', update);
  const settings = () => ({
    target: Math.round(target.getValue() * rate),
    edit: Number(edit.value) / 100,
    balance: Number(balance.value) / 100,
    maxJump: Math.max(0, Math.round(Number(maxJump.value) || 0)),
  });
  async function refresh() {
    const an = remixer.analysisOf(sourceId);
    if (!an) return;
    try {
      const plan = await remixer.planFor(clip, remixer.settingsFor(clip, settings()), an);
      summary.textContent = planSummary(app, doc, plan);
      summary.classList.toggle('warn', !plan.fits);
    } catch (err) {
      summary.textContent = err?.message || 'No remix fits these settings.';
      summary.classList.add('warn');
    }
  }
  let open = true;
  remixer
    .analysis(sourceId, { onProgress: (p) => open && p < 1 && (status.textContent = `Analysing ${Math.round(p * 100)}%`) })
    .then((an) => {
      if (!open) return;
      status.textContent = `${an.beats.length} beats, ${Math.round(an.bpm * 10) / 10} BPM`;
      refresh();
    })
    .catch((err) => {
      if (open) status.textContent = err?.message || 'The music could not be analysed.';
    });
  const ends = (control, a, b) => h('div.remix-range', h('span.muted', a), control, h('span.muted', b));
  const r = await openDialog({
    title: 'Remix Properties',
    className: 'remix-dialog',
    body: h(
      'div',
      h('p.muted', { style: { margin: '0 0 10px', maxWidth: '400px' } }, 'Rearranges the music at its beats to fit the target duration, from the clip’s start to the natural end of the song. Drag the clip’s right edge with the Move tool to change the duration later.'),
      h(
        'div.form-grid',
        h('label', 'Target Duration:'),
        h('div.row', target, h('span.muted', `now ${app.formatTime(clip.length, rate)}`)),
        h('label', 'Edit Length:'),
        ends(edit, 'Shorter', 'Longer'),
        h('label', 'Features:'),
        ends(balance, 'Timbre', 'Harmony'),
        h('label', 'Allow Jumps:'),
        h('div.row', h('span.muted', 'up to'), maxJump, h('span.muted', 'beats (0 = any distance)')),
        h('label', 'Analysis:'),
        status,
        h('label', 'Result:'),
        summary,
      ),
    ),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', value: 'ok', primary: true },
    ],
  });
  open = false;
  if (r !== 'ok') return null;
  return runRemix(app, doc, 'Remix Properties', clip.id, settings());
}

/** The Remix commands (registered with the Clip commands). */
export function remixCommands(app) {
  return [
    {
      id: 'clip.remixEnable',
      label: 'Enable Remix',
      enabled: (a) => Boolean(remixTarget(a)),
      checked: (a) => isRemixed(selected(a)[0]),
      run: async () => {
        const doc = session(app);
        const c = doc.clipSelection[0];
        if (isRemixed(c)) {
          remixerFor(app, doc).revert('Disable Remix', [c.id]);
          announce('Remix off');
          return;
        }
        const why = remixBlocker(doc, c);
        if (why) {
          app.notify(why, { error: true });
          return;
        }
        // The first remix aims at the clip's current length.
        await runRemix(app, doc, 'Enable Remix', c.id, { target: c.length });
      },
    },
    { id: 'clip.remixProperties', label: 'Remix Properties...', enabled: (a) => Boolean(remixTarget(a)), run: () => remixDialog(app, session(app), remixTarget(app)) },
    {
      id: 'clip.remixSplit',
      label: 'Split Remixed Clip into Segments',
      enabled: (a) => selected(a).some(isRemixed),
      run: () => {
        const doc = session(app);
        const made = remixerFor(app, doc).split('Split Remix into Segments', doc.clipSelection.filter(isRemixed).map((c) => c.id));
        if (made.length) announce(`Remix split into ${made.length} clips`);
      },
    },
    {
      id: 'clip.remixRevert',
      label: 'Revert Remix',
      enabled: (a) => selected(a).some(isRemixed),
      run: () => {
        const doc = session(app);
        if (remixerFor(app, doc).revert('Revert Remix', doc.clipSelection.filter(isRemixed).map((c) => c.id))) announce('Remix reverted');
      },
    },
  ];
}
