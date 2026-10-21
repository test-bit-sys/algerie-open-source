/**
 * Import & export dialog: back up events to a file (iCalendar or JSON) and
 * bring events in from an .ics/.json file. Import is additive — every imported
 * event gets a fresh id, so nothing existing is overwritten.
 */
import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { mountDialog } from './recurrence-dialog.js';
import { toICS, parseICS } from './ics.js';
import { isOfflineError } from './offline.js';
import { track } from './analytics.js';

const JSON_VERSION = 1;

export function openDataDialog({ store, file = null }) {
  const status = el('div', { class: 'io__status', role: 'status', 'aria-live': 'polite', style: { display: 'none' } });

  // Import progress: a visual bar plus a plain-text counter. The counter is
  // deliberately NOT inside the live-region `status` element — updating it on
  // every progress tick would make screen readers announce each one; the
  // progressbar's aria-valuenow carries the state instead.
  const progressFill = el('div', { class: 'io-progress__fill' });
  const progressTrack = el(
    'div',
    {
      class: 'io-progress__track',
      role: 'progressbar',
      'aria-label': 'Import progress',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
    },
    [progressFill],
  );
  const progressText = el('span', { class: 'io-progress__text' });
  const progress = el('div', { class: 'io-progress', style: { display: 'none' } }, [progressTrack, progressText]);

  let importing = false;

  const fileInput = el('input', {
    type: 'file',
    accept: '.ics,.ical,.json,text/calendar,application/json',
    style: { display: 'none' },
    on: { change: onFile },
  });

  const importBtn = el('button', {
    class: 'btn',
    type: 'button',
    html: icon('upload', { size: 'sm' }) + '<span>Choose file…</span>',
    on: { click: () => fileInput.click() },
  });

  // Shown only after a partial failure. Import is additive, so re-importing
  // the whole file would duplicate the events that DID save — this retries
  // just the ones that didn't.
  let retryList = null;
  const retryBtn = el('button', {
    class: 'btn',
    type: 'button',
    style: { display: 'none' },
    html: icon('upload', { size: 'sm' }) + '<span>Retry failed</span>',
    on: {
      click: () => {
        if (retryList && !importing) runImport(retryList);
      },
    },
  });

  const dialog = el(
    'form',
    { class: 'modal io-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'io-title' },
    [
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title', id: 'io-title', text: 'Import & export' }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Close',
          html: icon('close'),
          on: { click: () => close() },
        }),
      ]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'io-section' }, [
          el('span', { class: 'field__label', text: 'Export' }),
          el('p', {
            class: 'io-hint',
            text: 'Download all your events to back them up or move them to another calendar app.',
          }),
          el('div', { class: 'io-actions' }, [
            el('button', {
              class: 'btn',
              type: 'button',
              html: icon('download', { size: 'sm' }) + '<span>iCalendar (.ics)</span>',
              on: { click: exportIcs },
            }),
            el('button', {
              class: 'btn',
              type: 'button',
              html: icon('download', { size: 'sm' }) + '<span>JSON backup</span>',
              on: { click: exportJson },
            }),
          ]),
        ]),
        el('div', { class: 'io-section' }, [
          el('span', { class: 'field__label', text: 'Import' }),
          el('p', {
            class: 'io-hint',
            text: 'Choose an .ics or .json file, or drop one onto the calendar. Imported events are added to your calendar; nothing is overwritten.',
          }),
          el('div', { class: 'io-actions' }, [importBtn, retryBtn]),
          fileInput,
          progress,
          status,
        ]),
      ]),
      el('div', { class: 'modal__foot' }, [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: 'Done' }),
      ]),
    ],
  );

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
  });

  function showStatus(msg, variant) {
    status.textContent = msg;
    status.dataset.variant = variant || '';
    status.style.display = msg ? 'block' : 'none';
  }

  function showProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = pct + '%';
    progressTrack.setAttribute('aria-valuenow', String(pct));
    progressText.textContent = total > 0 ? `Importing ${done} of ${total}…` : 'Importing…';
    progress.style.display = '';
  }

  function hideProgress() {
    progress.style.display = 'none';
    progressFill.style.width = '0%';
    progressTrack.setAttribute('aria-valuenow', '0');
    progressText.textContent = '';
  }

  function exportIcs() {
    const events = store.getAllEvents();
    if (!events.length) return showStatus('There are no events to export.', 'warn');
    download(`calendar-${dateStamp()}.ics`, toICS(events), 'text/calendar');
    toast(`Exported ${events.length} event${events.length === 1 ? '' : 's'}`, { variant: 'success' });
  }

  function exportJson() {
    const events = store.getAllEvents();
    if (!events.length) return showStatus('There are no events to export.', 'warn');
    const payload = { version: JSON_VERSION, exportedAt: new Date().toISOString(), events };
    download(`calendar-${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`Exported ${events.length} event${events.length === 1 ? '' : 's'}`, { variant: 'success' });
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    await importFile(file);
    fileInput.value = ''; // allow re-importing the same file
  }

  async function importFile(file) {
    if (!file || importing) return;
    importing = true;
    importBtn.disabled = true;
    retryBtn.disabled = true;
    showStatus('Reading file…');
    try {
      const text = await file.text();
      const events = parseFile(file.name, text);
      if (!events.length) {
        showStatus('No events found in that file.', 'warn');
        return;
      }
      await runImport(events);
    } catch (err) {
      console.error(err);
      showStatus('Could not read that file. Make sure it is a valid .ics or .json export.', 'danger');
    } finally {
      importing = false;
      importBtn.disabled = false;
      retryBtn.disabled = false;
    }
  }

  /** Import a list of parsed events with progress + partial-failure handling.
   *  Used by both the file picker and the "Retry failed" button. */
  async function runImport(list) {
    importing = true;
    importBtn.disabled = true;
    retryBtn.style.display = 'none';
    showStatus('Importing…');
    showProgress(0, list.length);
    const evts = (n) => `${n} event${n === 1 ? '' : 's'}`;
    // A retry consumes the pending list (its own failures re-enter below); a
    // NEW file's failures must ADD to what's pending, not replace it — the
    // replaced events are in neither the calendar nor the file-retry path
    // (re-importing their file would duplicate its successes), so overwriting
    // the list is the only copy of them gone.
    const isRetry = list === retryList;
    try {
      const { imported, failed, failedEvents } = await store.importEvents(list, { onProgress: showProgress });
      const pending = isRetry ? [] : retryList || [];
      if (failed > 0) {
        retryList = pending.length ? [...pending, ...failedEvents] : failedEvents;
        retryBtn.style.display = '';
        showStatus(
          `Imported ${evts(imported)}; ${retryList.length} couldn't be saved. Retry saves just the missing ones — no duplicates.`,
          'warn',
        );
        toast(`Imported ${evts(imported)} — ${failed} failed`, { variant: 'default' });
      } else {
        retryList = pending.length ? pending : null;
        if (retryList) retryBtn.style.display = '';
        showStatus(`Imported ${evts(imported)}.`, 'success');
        toast(`Imported ${evts(imported)}`, { variant: 'success' });
      }
      if (imported > 0) track('Calendar Imported');
    } catch (err) {
      // Nothing was imported, so any pending retry list is still valid — both
      // when this failed run WAS the retry and when a later file import failed
      // at the offline gate. Keep the recovery path visible.
      if (retryList) retryBtn.style.display = '';
      if (isOfflineError(err)) {
        showStatus("You're offline — reconnect to import events.", 'warn');
      } else {
        console.error(err);
        showStatus('Import failed. Please try again.', 'danger');
      }
    } finally {
      importing = false;
      importBtn.disabled = false;
      hideProgress();
    }
  }

  const close = mountDialog(dialog);
  requestAnimationFrame(() => dialog.querySelector('.btn').focus());
  if (file) void importFile(file);
}

/** Parse a chosen file into an array of event inputs, by extension then shape. */
function parseFile(name, text) {
  const lower = (name || '').toLowerCase();
  const trimmed = text.trimStart();
  const looksJson = lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJson && !lower.endsWith('.ics') && !lower.endsWith('.ical')) {
    const data = JSON.parse(text);
    // Guard `data` before reading `.events`: JSON.parse('null') returns null,
    // which would throw on property access.
    const list = Array.isArray(data) ? data : data && Array.isArray(data.events) ? data.events : [];
    // Only accept entries shaped like our own backup (numeric epoch `start`), so
    // foreign JSON with, say, ISO-string dates reports "0 events" instead of
    // silently importing a pile of untitled events stamped at the current time.
    return list.filter((e) => e && typeof e === 'object' && Number.isFinite(e.start));
  }
  return parseICS(text);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
