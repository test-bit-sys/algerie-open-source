/**
 * Weekly grid entry: projects down, days across.
 *
 * A large share of the people this app is for do not run a timer, they
 * reconstruct the week on Friday afternoon. Doing that through the entry
 * sheet costs one modal per cell, fifteen to twenty times over. The data
 * is two-dimensional, so the fastest way to enter it is a grid, which is
 * where every timesheet product ends up for exactly this reason.
 *
 * A cell is one project on one day. It edits the single entry behind it,
 * or creates one, with the same duration parsing the sheets use. A cell
 * covering more than one entry, or any invoiced entry, is read-only and
 * sends the user to that day's section instead of pretending one number
 * can stand in for several, which is the rule the bulk bar already
 * enforces.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { parseDuration, fmtClock, fmtTimer, fmtDuration, fmtWeekday, todayISO } from '../lib/time.js';

const DURATION_HINT = 'Enter a duration like 1:30, 90m, or 1.5h';

/** A cell's stored value as text ("1:30", or "" for nothing yet). */
function cellText(seconds) {
  if (!seconds) return '';
  // Sub-minute seconds (a timer entry) would be shaved off silently by a
  // value that only shows minutes, so the cell shows them.
  return seconds % 60 ? fmtTimer(seconds) : fmtClock(seconds);
}

/**
 * What is in this project's cell on this day: the entries behind it, their
 * total, and whether one number can honestly stand for them.
 */
function cellState(dayEntries, projectId) {
  const mine = dayEntries.filter((e) => e.projectId === projectId);
  const seconds = mine.reduce((a, e) => a + e.seconds, 0);
  const locked = mine.length > 1 || mine.some((e) => e.invoicedAt);
  return { entries: mine, seconds, locked };
}

/**
 * Focus, and any half-typed value, of the grid cell that holds it. A write
 * re-renders the whole view, and without this the cell the user tabbed
 * into would lose focus, and its text, the moment the previous one saved.
 *
 * Read-only cells count too: Enter and Tab step onto them like any other
 * cell, and a save that lands while one holds focus used to drop the
 * keyboard on the document body, with nothing to do but tab back in from
 * the top of the page.
 */
export function captureGridFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.dataset.cell) {
    return {
      cell: active.dataset.cell,
      value: active.value,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  }
  if (active instanceof HTMLElement && active.classList.contains('grid-locked') && active.dataset.pos) {
    return { pos: active.dataset.pos };
  }
  return null;
}

export function restoreGridFocus(state) {
  if (!state) return;
  if (state.pos) {
    document.querySelector(`.grid-locked[data-pos="${state.pos}"]`)?.focus({ preventScroll: true });
    return;
  }
  const next = document.querySelector(`input[data-cell="${state.cell}"]`);
  if (!next) return;
  // The value carried over is whatever was typed; once it has landed it
  // reads back the way the grid writes it ("1:00" for a typed "60m"). A
  // half-typed or unsaved value is kept as it was.
  const typed = parseDuration(state.value);
  const saved = parseDuration(next.dataset.saved);
  next.value = Number.isFinite(typed) && typed === saved ? next.dataset.saved : state.value;
  next.focus({ preventScroll: true });
  try {
    next.setSelectionRange(state.start, state.end);
  } catch {
    // A control that does not support selection ranges: focus is enough.
  }
}

/**
 * weekGrid({ days, entries, extra, onAddRow, onJump })
 *  - `days` the seven ISO dates, `entries` everything tracked in them
 *  - `extra` project ids to show a row for even with no time yet
 *  - `onAddRow(projectId)` records one of those, `onJump(date)` scrolls to
 *    a day section, where a locked cell has to be edited.
 */
export function weekGrid({ days, entries, extra = [], onAddRow, onJump }) {
  const byDay = new Map(days.map((d) => [d, []]));
  for (const e of entries) byDay.get(e.date)?.push(e);

  /* Rows: every project with time this week, then any the user asked for,
     in a stable order (client, then project) so a week does not reshuffle
     as it is filled in. Entries whose project is gone keep a read-only row
     of their own, so the columns still add up to what the days hold. */
  const withTime = [...new Set(entries.map((e) => e.projectId))];
  const ids = [...new Set([...withTime, ...extra])];
  const rows = ids.map((id) => {
    const project = store.project(id);
    const client = store.client(project?.clientId);
    return {
      id,
      project,
      label: project?.name || 'No project',
      sublabel: client?.name || (project ? '' : 'project removed'),
      slot: client?.slot || 8,
      missing: !project,
      sortKey: `${client?.name || 'zzz'} ${project?.name || 'zzz'}`,
    };
  }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const today = todayISO();
  const table = el('table.grid-table');
  const head = el('thead');
  const bodyRows = el('tbody');
  const foot = el('tfoot');

  head.append(el('tr', {},
    el('th.grid-project-head', { scope: 'col' }, 'Project'),
    days.map((d) => el('th', {
      scope: 'col',
      className: `grid-day-head${d === today ? ' today' : ''}`,
    },
      el('span.grid-day-name', {}, fmtWeekday(d)),
      el('span.grid-day-num', {}, String(Number(d.slice(8))))
    )),
    el('th.grid-total-head', { scope: 'col' }, 'Total')
  ));

  /**
   * Write one cell. The store change event re-renders the view.
   *
   * `state` is brought up to date with what landed, so a second call for
   * the same cell (Enter committing in place, then the blur that follows
   * when focus moves on) finds nothing left to write instead of adding the
   * same time twice.
   */
  async function commit(input, row, date, state) {
    const raw = input.value.trim();
    const previous = cellText(state.seconds);
    if (raw === previous) return;

    if (!raw) {
      // A cleared cell removes exactly what it stood for, with a way back.
      const entry = state.entries[0];
      if (!entry) return;
      try {
        const removed = await store.deleteEntry(entry.id, entry.date);
        state.entries = [];
        state.seconds = 0;
        toast(`Cleared ${fmtDuration(entry.seconds)} on ${row.label}`, {
          icon: 'trash',
          action: removed && {
            label: 'Undo',
            onClick: () => store.restoreEntries([removed])
              .catch(() => toast('Could not restore, check your connection', { icon: 'wifiOff' })),
          },
        });
      } catch (err) {
        console.error(err);
        input.value = previous;
        toast('Could not clear, check your connection', { icon: 'wifiOff' });
      }
      return;
    }

    const seconds = parseDuration(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      input.value = previous;
      toast(DURATION_HINT, { icon: 'alert' });
      return;
    }
    if (seconds === state.seconds) return;

    try {
      if (state.entries.length === 1) {
        const entry = state.entries[0];
        // Through the store's own rule, so an entry that carries clock
        // times keeps them agreeing with its duration: a cell edit used to
        // leave them behind, printing three hours of work inside a
        // seventy-minute window on the entry row and on the timesheet.
        state.entries = [await store.updateEntry(entry.id, entry.date, store.durationPatch(entry, seconds))];
      } else {
        state.entries = [await store.addEntry({
          date,
          projectId: row.id,
          seconds,
          // A cell is project by day, so it takes the project's own
          // default for whether that time is billable.
          billable: row.project ? !!row.project.billable : true,
        })];
      }
      state.seconds = seconds;
    } catch (err) {
      console.error(err);
      input.value = previous;
      toast('Could not save, check your connection', { icon: 'wifiOff' });
    }
  }

  /* Keyboard-first: up and down always move between rows, left and right
     move between days once the caret has nowhere left to go inside the
     cell, Enter commits and steps down, Escape puts the cell back. Tab is
     the browser's own and is left alone. `save` writes the cell without
     leaving it, for the row with nothing below. */
  function onCellKey(e, node, save = null) {
    /* Every cell carries its position, editable or not, so navigation runs
       straight through a read-only one instead of stopping dead at it: a
       day with several entries, or invoiced time, cannot be typed into
       here but must not wall off the cells beyond it. */
    const isInput = node instanceof HTMLInputElement;
    const step = (dRow, dCol) => {
      const [r0, c0] = node.dataset.pos.split(',').map(Number);
      let r = r0 + dRow;
      let c = c0 + dCol;
      while (r >= 0 && c >= 0 && r < rows.length && c < days.length) {
        const next = table.querySelector(`[data-pos="${r},${c}"]`);
        if (next) {
          e.preventDefault();
          next.focus();
          return;
        }
        r += dRow;
        c += dCol;
      }
      // At the grid's edge the key does nothing, as in a spreadsheet. On a
      // read-only cell it must also not fall through to the page's own
      // Left and Right shortcuts, which page the timesheet: a keyboard
      // user on Monday's cell would have had the whole week swapped out
      // from under them for moving one cell too far.
      if (!isInput) e.preventDefault();
    };
    // Left and right only leave an input once the caret has nowhere else
    // to go inside it; on a read-only cell they always move.
    const atStart = !isInput || (node.selectionStart === 0 && node.selectionEnd === 0);
    const atEnd = !isInput || (node.selectionStart === node.value.length
      && node.selectionEnd === node.value.length);
    if (e.key === 'ArrowDown') step(1, 0);
    else if (e.key === 'ArrowUp') step(-1, 0);
    else if (e.key === 'ArrowRight' && atEnd) step(0, 1);
    else if (e.key === 'ArrowLeft' && atStart) step(0, -1);
    else if (!isInput) {
      // Enter and Space on a read-only cell are the button's own: they
      // open the day it belongs to.
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Moving away commits; the cell below is where filling a column
      // carries on, and the last row commits in place. In place means the
      // cell keeps focus: blurring it instead dropped the keyboard on the
      // document body, where the save's re-render could not find it.
      const before = document.activeElement;
      step(1, 0);
      if (document.activeElement === before) save?.();
    } else if (e.key === 'Escape') {
      // Back to what the cell held, still in the cell, like a spreadsheet:
      // the user gave up on a value, not on the grid.
      node.value = node.dataset.saved;
      node.select();
    }
  }

  rows.forEach((row, r) => {
    const rowSeconds = days.reduce((a, d) => a + cellState(byDay.get(d), row.id).seconds, 0);
    bodyRows.append(el('tr', {},
      el('th.grid-project', { scope: 'row' },
        el('span.color-dot', { style: { background: `var(--series-${row.slot})` }, 'aria-hidden': 'true' }),
        el('span.grid-project-text', {},
          el('span.grid-project-name', {}, row.label),
          row.sublabel && el('span.grid-project-client', {}, row.sublabel)
        )
      ),
      days.map((d, c) => {
        const state = cellState(byDay.get(d), row.id);
        const label = `${row.label}, ${fmtWeekday(d)} ${Number(d.slice(8))}`;
        if (state.locked || row.missing) {
          const locked = el('button.grid-locked', {
            type: 'button',
            'aria-label': `${label}: ${fmtDuration(state.seconds)}, ${row.missing
              ? 'project removed'
              : 'more than one entry or already invoiced'}. Open the day.`,
            title: row.missing
              ? 'This time belongs to a project that no longer exists'
              : 'More than one entry, or already invoiced: open the day to edit it',
            dataset: { pos: `${r},${c}` },
            onkeydown: (ev) => onCellKey(ev, locked),
            onclick: () => onJump(d),
          }, cellText(state.seconds) || '-');
          return el('td', { className: `grid-cell${d === today ? ' today' : ''}` }, locked);
        }
        const input = el('input.grid-input', {
          type: 'text',
          inputmode: 'text',
          autocomplete: 'off',
          value: cellText(state.seconds),
          'aria-label': label,
          dataset: { cell: `${row.id}|${d}`, pos: `${r},${c}`, saved: cellText(state.seconds) },
          onfocus: () => input.select(),
          onkeydown: (ev) => onCellKey(ev, input, () => commit(input, row, d, state).catch(console.error)),
          /* A blur is also what a browser fires when the focused cell is
             removed, which is exactly what a save's re-render does to it,
             and it fires before the cell is detached. Committing on that
             blur wrote whatever the cell held at the moment the view
             rebuilt: a half-typed "1:" drew an error toast mid-keystroke,
             and a value committed in place was written a second time from
             the cell's stale state. A microtask later the cell is either
             still in the document (the user left it: save) or gone (the
             view rebuilt around it: its text was carried into the new cell,
             which saves when the user leaves that one). */
          onblur: () => {
            queueMicrotask(() => {
              if (input.isConnected) commit(input, row, d, state).catch(console.error);
            });
          },
        });
        return el('td', { className: `grid-cell${d === today ? ' today' : ''}` }, input);
      }),
      el('td.grid-row-total', {}, rowSeconds ? fmtDuration(rowSeconds) : '')
    ));
  });

  const dayTotals = days.map((d) => byDay.get(d).reduce((a, e) => a + e.seconds, 0));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  foot.append(el('tr', {},
    el('th.grid-project', { scope: 'row' }, 'Total'),
    days.map((d, i) => el('td', {
      className: `grid-col-total${d === today ? ' today' : ''}`,
    }, dayTotals[i] ? fmtDuration(dayTotals[i]) : '')),
    el('td.grid-week-total', {}, weekTotal ? fmtDuration(weekTotal) : '')
  ));

  table.append(head, bodyRows, foot);

  /* Add a row for a project with no time this week yet. Projects already
     in the grid are not offered again; archived ones are not offered at
     all, though their existing time still gets a row. */
  const taken = new Set(ids);
  const available = store.activeProjects().filter((p) => !taken.has(p.id));
  const picker = el('select.select', { 'aria-label': 'Add a project row' },
    el('option', { value: '' }, available.length ? 'Add a project row' : 'Every project is already listed'),
    store.activeClients().map((client) => {
      const own = available.filter((p) => p.clientId === client.id);
      if (!own.length) return null;
      return el('optgroup', { label: client.name },
        own.map((p) => el('option', { value: p.id }, p.name)));
    }).filter(Boolean)
  );
  picker.disabled = !available.length;
  picker.addEventListener('change', () => {
    if (picker.value) onAddRow(picker.value);
  });

  const wrap = el('div.grid-wrap', {},
    // The grid is wider than a phone whatever the type size, so it scrolls
    // on its own rather than dragging the whole page sideways.
    el('div.grid-scroll', {}, table),
    el('div.grid-foot', {},
      el('div.select-wrap.grid-picker', {}, picker),
      el('p.grid-hint', {}, rows.length
        ? 'Type a duration in any cell. Arrows and Tab move around; a cell holding several entries, or invoiced time, opens that day instead.'
        : 'Pick a project to start filling in the week.')
    )
  );

  if (!rows.length) {
    wrap.prepend(el('div.empty.empty-slim', {},
      el('div.empty-icon', { html: icon('calendar', 22) }),
      el('p', {}, 'Nothing tracked this week yet. Add a project row and type the hours.')
    ));
  }

  return wrap;
}
