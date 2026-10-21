/**
 * Global search — a command-palette-style overlay that finds events by title,
 * location, or description and tasks by title or notes across the whole
 * calendar and jumps to them.
 *
 * The searchable index (one entry per stored event, with a representative
 * occurrence resolved for recurring series, plus one entry per task) is
 * snapshotted when the overlay opens, so filtering on every keystroke is a
 * cheap in-memory scan. Picking a result hands the resolved event/occurrence
 * or task back through `onPick`.
 */
import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { colorHex, colorFg } from './colors.js';
import { describeRecurrence, occurrenceNear } from './recurrence.js';
import { formatFullDate, formatTime, formatTimeRange, MS_PER_DAY } from './date-utils.js';

const MAX_RESULTS = 40;
const OCC_WINDOW_DAYS = 400; // how far to look for a recurring series' representative

export function createSearch({ store, onPick }) {
  let scrim = null;
  let input = null;
  let listEl = null;
  let index = []; // snapshot of searchable entries, built on open
  let results = [];
  let activeIndex = -1;
  let lastFocused = null;

  function isOpen() {
    return Boolean(scrim);
  }

  /** The occurrence a recurring series should represent in results: the current
   *  or next occurrence (the earliest-starting one in the forward window, so an
   *  in-progress occurrence wins), else the most recent past one, else — for a
   *  series with no occurrence in the ±window — the nearest occurrence to now.
   *  `fwd`/`back` are this series' occurrences in the forward/backward window.
   *  We pick by start rather than array position: getEventsInRange sorts all-day
   *  events first GLOBALLY, so a per-occurrence all-day override would otherwise
   *  pull a distant occurrence to fwd[0]/back[last] and mis-date the series. */
  function representative(ev, fwd, back, now) {
    if (!ev.recurrence) return ev;
    if (fwd && fwd.length) return fwd.reduce((a, b) => (b.start < a.start ? b : a));
    if (back && back.length) return back.reduce((a, b) => (b.start > a.start ? b : a));
    // No occurrence within the ±window (e.g. a count/until series that ended
    // long ago, one starting far in the future, or a long-interval series like
    // every-4-years whose neighbours straddle the window). Resolve the nearest
    // occurrence rather than the series' FIRST one, so it is dated and bucketed
    // by its real closest occurrence. Materializing (vs. the raw master) also
    // keeps a seriesId, so picking it still routes through the recurring-edit
    // scope dialog instead of the plain-event editor.
    return occurrenceNear(ev, now) || ev;
  }

  /** Bucket expanded occurrences by their series id, preserving order. */
  function groupBySeries(occurrences) {
    const map = new Map();
    for (const o of occurrences) {
      if (!o.seriesId) continue;
      let arr = map.get(o.seriesId);
      if (!arr) map.set(o.seriesId, (arr = []));
      arr.push(o);
    }
    return map;
  }

  function buildIndex() {
    // Expand each window ONCE and bucket occurrences by series, so resolving a
    // representative is a map lookup per event. Previously representative()
    // re-expanded the whole 400-day range (twice) for every recurring master —
    // O(recurring² × window) — which could freeze the palette on open for a
    // calendar with many recurring series. Equivalent result: same
    // getEventsInRange calls, same per-series order, same first/last selection.
    const now = Date.now();
    const win = OCC_WINDOW_DAYS * MS_PER_DAY;
    const fwd = groupBySeries(store.getEventsInRange(now, now + win, { includeHidden: true }));
    const back = groupBySeries(store.getEventsInRange(now - win, now, { includeHidden: true }));
    index = store.getAllEvents().map((ev) => ({
      event: ev,
      rep: representative(ev, fwd.get(ev.id), back.get(ev.id), now),
      title: ev.title || '',
      hay: `${ev.title || ''}\n${ev.location || ''}\n${ev.description || ''}`.toLowerCase(),
    }));
    // A "this event" edit can retitle / relocate / re-describe a single
    // occurrence. The calendar renders that override text, so search must find
    // it too — the master's entry above only carries the series' own text. Add
    // one entry per occurrence whose override changes searchable text, dated at
    // that exact occurrence (no repeat badge: it is a one-off exception).
    for (const ev of store.getAllEvents()) {
      if (!ev.recurrence) continue;
      const exdates = new Set((ev.exdates || []).map(Number));
      for (const [rid, o] of Object.entries(ev.overrides || {})) {
        if (!o) continue;
        // Imported/foreign data can carry an override AND an exdate for the
        // same slot; the calendar never renders it (expandOccurrences skips
        // exdates), so search must not surface a phantom the user could
        // "edit" — updateOccurrence would strip the exdate and resurrect a
        // cancelled occurrence.
        if (exdates.has(Number(rid))) continue;
        const textChanged = ['title', 'location', 'description'].some(
          (k) => o[k] != null && o[k] !== ev[k],
        );
        if (!textChanged) continue;
        const occ = store.getEvent(`${ev.id}::${rid}`);
        if (!occ) continue;
        index.push({
          event: occ,
          rep: occ,
          title: occ.title || '',
          hay: `${occ.title || ''}\n${occ.location || ''}\n${occ.description || ''}`.toLowerCase(),
        });
      }
    }
    // Tasks live in their own store map, so they never came through
    // getAllEvents — a task was visible on the calendar but "No events match"
    // in search. Index each one by title + notes. A task has a single `due`
    // instant rather than start/end; the row builder and the ranking sort
    // read `start`/`end` off `rep`, so give it both (a zero-length span) and
    // keep the task itself as `event` so picking it opens the task card.
    for (const t of store.getAllTasks()) {
      index.push({
        event: t,
        rep: { ...t, start: t.due, end: t.due },
        title: t.title || '',
        hay: `${t.title || ''}\n${t.notes || ''}`.toLowerCase(),
      });
    }
  }

  function open() {
    if (scrim) {
      input.focus();
      input.select();
      return;
    }
    lastFocused = document.activeElement;
    buildIndex();
    build();
    document.body.append(scrim);
    document.addEventListener('keydown', onKeydown, true);
    // Guard against the overlay being closed before this frame fires (close()
    // nulls `input`), which would otherwise throw on the deferred focus.
    requestAnimationFrame(() => input && input.focus());
    runQuery('');
  }

  function close() {
    if (!scrim) return;
    document.removeEventListener('keydown', onKeydown, true);
    scrim.remove();
    scrim = null;
    input = null;
    listEl = null;
    index = [];
    results = [];
    activeIndex = -1;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    lastFocused = null;
  }

  function build() {
    input = el('input', {
      class: 'search__input',
      type: 'text',
      placeholder: 'Search events and tasks…',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-label': 'Search events and tasks',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'search-results',
      'aria-autocomplete': 'list',
      on: { input: () => runQuery(input.value) },
    });
    // Set imperatively: the `el` helper skips any prop whose value is `false`,
    // and spellcheck defaults to on for text fields, so passing `spellcheck:
    // false` through `el` would be silently dropped and leave it enabled.
    input.spellcheck = false;
    listEl = el('div', {
      class: 'search__results',
      id: 'search-results',
      role: 'listbox',
      'aria-label': 'Search results',
    });

    const panel = el(
      'div',
      { class: 'search__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search events and tasks' },
      [
        el('div', { class: 'search__bar' }, [
          el('span', { class: 'search__icon', html: icon('search', { size: 'sm' }) }),
          input,
          el('kbd', { class: 'search__esc', text: 'Esc' }),
        ]),
        listEl,
      ],
    );

    scrim = el('div', { class: 'search-scrim' }, [panel]);
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) close();
    });
  }

  function matchRank(title, q) {
    const t = title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    return 2; // matched via location/description, or title substring past start
  }

  function runQuery(raw) {
    const q = raw.trim().toLowerCase();
    const now = Date.now();
    const pool = q ? index.filter((x) => x.hay.includes(q)) : index.slice();

    pool.sort((a, b) => {
      const ra = q ? matchRank(a.title, q) : 0;
      const rb = q ? matchRank(b.title, q) : 0;
      if (ra !== rb) return ra - rb;
      // "Current or upcoming" = hasn't ended yet. Using the end (not the start)
      // keeps an event that is happening right now — e.g. an in-progress
      // recurring occurrence, whose representative starts before `now` — in the
      // upcoming bucket instead of demoting it below every future event.
      const au = a.rep.end > now;
      const bu = b.rep.end > now;
      if (au !== bu) return au ? -1 : 1; // current/upcoming before past
      return au ? a.rep.start - b.rep.start : b.rep.start - a.rep.start;
    });

    results = pool.slice(0, MAX_RESULTS);
    // `q` is lowercased for matching/highlighting; pass the trimmed original-case
    // query for display so the empty-state echoes what the user actually typed.
    renderResults(q, raw.trim());
  }

  function renderResults(q, display = q) {
    clear(listEl);
    if (results.length === 0) {
      const msg = index.length === 0 ? 'Nothing to search yet' : q ? `No events or tasks match “${display}”` : 'No events or tasks';
      listEl.append(el('div', { class: 'search__empty' }, [el('p', { text: msg })]));
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    const hour12 = store.getSettings().hour12;
    results.forEach((r, i) => listEl.append(buildRow(r, i, q, hour12)));
    setActive(0, false);
  }

  function buildRow(r, i, q, hour12) {
    const ev = r.event;
    const rep = r.rep;
    const start = new Date(rep.start);
    const end = new Date(rep.end);
    const isTask = Boolean(ev.isTask);
    let timeText;
    if (isTask) {
      // Mirror the agenda: an all-day task is a plain "To-do"; a timed one
      // shows its due time (a task has an instant, not a range).
      timeText = rep.allDay ? 'To-do' : formatTime(start, { hour12 });
    } else {
      timeText = rep.allDay ? 'All day' : formatTimeRange(start, end, { hour12 });
    }
    let meta = ev.recurrence
      ? `${describeRecurrence(ev.recurrence, ev.start)} · ${timeText}`
      : `${formatFullDate(start)} · ${timeText}`;
    if (ev.location) meta += ` · ${ev.location}`;
    if (isTask && ev.done) meta += ' · Done';

    const fallbackTitle = isTask ? '(Untitled task)' : '(Untitled)';
    const titleEl = el('span', { class: 'search__title' });
    titleEl.append(highlight(ev.title || fallbackTitle, q));

    // Tasks get the same ring-with-check marker the calendar chips use, so a
    // result reads as a task at a glance (and as done when it is).
    const marker = isTask
      ? el('span', {
          class: `search__check${ev.done ? ' is-checked' : ''}`,
          style: { '--chip-color': colorHex(ev.color), '--ev-fg': colorFg(ev.color) },
          html: ev.done ? icon('check', { size: 'sm' }) : '',
          'aria-hidden': 'true',
        })
      : el('span', { class: 'search__dot', style: { '--chip-color': colorHex(ev.color) } });

    const row = el(
      'div',
      {
        class: `search__result${isTask ? ' search__result--task' : ''}${isTask && ev.done ? ' is-done' : ''}`,
        role: 'option',
        id: `search-opt-${i}`,
        'aria-selected': 'false',
        title: ev.title || fallbackTitle,
      },
      [
        marker,
        el('span', { class: 'search__text' }, [
          titleEl,
          el('span', { class: 'search__meta', text: meta }),
        ]),
        ev.recurrence
          ? el('span', { class: 'search__badge', html: icon('repeat', { size: 'sm' }), title: 'Repeats' })
          : null,
      ],
    );
    row.addEventListener('click', () => pick(i));
    row.addEventListener('pointermove', () => {
      if (activeIndex !== i) setActive(i, false);
    });
    return row;
  }

  function setActive(i, scroll = true) {
    if (!results.length) return;
    activeIndex = Math.max(0, Math.min(i, results.length - 1));
    const rows = listEl.querySelectorAll('.search__result');
    rows.forEach((row, idx) => {
      const on = idx === activeIndex;
      row.setAttribute('aria-selected', String(on));
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `search-opt-${activeIndex}`);
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    // For a task the rep is a display shim (due mirrored into start/end); hand
    // back the stored task so the card and editor see the real record.
    const target = r.event.isTask ? r.event : r.rep;
    close();
    onPick(target);
  }

  function onKeydown(e) {
    // During IME composition, Enter commits the composed text, Escape cancels
    // the composition, and the arrows navigate the candidate list — none of
    // them are palette commands. Without this guard, committing e.g. Japanese
    // input picked a result and closed the overlay mid-word. (keyCode 229
    // covers engines that don't set isComposing on the final Enter.)
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex - 1);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        pick(activeIndex);
      }
    } else if (e.key === 'Tab') {
      // The input is the only focusable element in this aria-modal overlay, so
      // trap Tab here rather than letting focus escape to the header controls
      // hidden behind the scrim. Results are navigated with the arrow keys.
      e.preventDefault();
    }
  }

  return { open, close, isOpen };
}

/** Wrap case-insensitive matches of `q` in the title with <mark>. */
function highlight(title, q) {
  const frag = document.createDocumentFragment();
  if (!q) {
    frag.append(document.createTextNode(title));
    return frag;
  }
  const lower = title.toLowerCase();
  // toLowerCase() can change length (e.g. 'İ' U+0130 → 'i̇', two code units), which
  // desyncs offsets found in `lower` from slices of the original-case `title` —
  // yielding an empty or wrong <mark>. `q` is already matched case-insensitively
  // against `hay` for filtering, so here just emit the title unhighlighted rather
  // than slice the wrong span. Ordinary titles (1:1 lowercasing) are unaffected.
  if (lower.length !== title.length) {
    frag.append(document.createTextNode(title));
    return frag;
  }
  let i = 0;
  let idx;
  while ((idx = lower.indexOf(q, i)) !== -1) {
    if (idx > i) frag.append(document.createTextNode(title.slice(i, idx)));
    frag.append(el('mark', { text: title.slice(idx, idx + q.length) }));
    i = idx + q.length;
  }
  if (i < title.length) frag.append(document.createTextNode(title.slice(i)));
  return frag;
}
