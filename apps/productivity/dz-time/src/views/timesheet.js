/**
 * Timesheet: day-by-day entries with an at-a-glance overview. Three units:
 * a week (bar strip, all seven days listed), a grid of the same week for
 * filling one in (projects down, days across), and a month (calendar grid,
 * only days with entries listed). The title doubles as a jump-to-date
 * picker; invoicing and review happen monthly, so every unit matters.
 */

import { el, clear, append, keepFocus, scrollIntoView } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { field, fieldError, nativeError, projectSelect } from '../ui/fields.js';
import { entryRow } from '../ui/entryrow.js';
import { openEntryForm } from '../ui/entryform.js';
import { targetStatTile, moneyValue } from '../ui/stats.js';
import { weekGrid, captureGridFocus, restoreGridFocus } from '../ui/weekgrid.js';
import { store } from '../lib/store.js';
import {
  todayISO, weekStartOf, weekDays, addDays, dateOf,
  monthKeyOf, monthDays, shiftMonth,
  fmtDuration, fmtClock, fmtWeekRange, fmtWeekday, fmtDayHeading, fmtMonth,
} from '../lib/time.js';
import { debounce } from '../lib/util.js';

const UNITS = [
  { key: 'week', label: 'Week' },
  { key: 'grid', label: 'Grid' },
  { key: 'month', label: 'Month' },
];

/* Week and grid are two views of the same seven days, so they navigate
   and label identically; only the month is a different period. */
const isWeekly = (unit) => unit !== 'month';

const BILLING_FILTERS = [
  { value: 'all', label: 'Everything' },
  { value: 'billable', label: 'Billable' },
  { value: 'nonbillable', label: 'Non-billable' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
];

export function timesheetView() {
  const root = el('div.view');
  let unit = 'week';
  let weekStart = weekStartOf(todayISO(), store.settings.weekStart);
  let monthKey = monthKeyOf(todayISO());

  /* Search mode: replaces the range content with filterable results over
     a growing month window (newest first, "load older" extends it). */
  let searching = false;
  let windowMonths = 3;
  const filters = { query: '', clientId: '', billing: 'all' };

  /* Bulk-edit selection over search results. Invoiced entries are locked
     billing records: they can't be selected and the store skips them
     defensively too. Changing the query or filters clears the selection
     so an action never touches rows the user can no longer see. */
  let selecting = false;
  const selected = new Map(); // entry id -> entry

  /* Project rows the user asked the grid to show that have no time yet.
     They belong to the week on screen: carrying them into the next one
     would quietly suggest work that was never done there. */
  let gridRows = new Set();
  let gridRowsWeek = weekStart;

  /* Title = current range + a native date picker to jump anywhere. The
     input stays rendered (showPicker requires it) but invisible. */
  const rangeText = el('span', {});
  const jumpInput = el('input.jump-input', {
    type: 'date', tabindex: -1, 'aria-hidden': 'true',
    onchange: () => {
      if (!jumpInput.value) return;
      weekStart = weekStartOf(jumpInput.value, store.settings.weekStart);
      monthKey = monthKeyOf(jumpInput.value);
      render().catch(console.error);
    },
  });
  const jumpBtn = el('button.title-jump', {
    type: 'button',
    title: 'Jump to a date',
    onclick: () => {
      jumpInput.value = isWeekly(unit) ? weekStart : `${monthKey}-01`;
      try { jumpInput.showPicker(); } catch { jumpInput.focus(); }
    },
  },
    rangeText,
    el('span.title-jump-ic', { html: icon('chevD', 17, 2.2), 'aria-hidden': 'true' }),
    jumpInput
  );
  const rangeLabel = el('h1.page-title.page-title-range', { 'aria-live': 'polite' }, jumpBtn);

  const unitSeg = el('div.segmented', { role: 'group', 'aria-label': 'Timesheet unit' });
  function renderUnitSeg() {
    clear(unitSeg);
    for (const u of UNITS) {
      unitSeg.append(el('button', {
        type: 'button',
        className: unit === u.key ? 'active' : '',
        'aria-pressed': unit === u.key ? 'true' : 'false',
        onclick: () => {
          if (unit === u.key) return;
          const wasWeekly = isWeekly(unit);
          unit = u.key;
          // Switching granularity stays on the period being viewed: the
          // month containing the shown week, or the shown month's first
          // week (anchored to today whenever the view includes it).
          // Week and grid share a period, so switching between them keeps
          // the very same seven days.
          const today = todayISO();
          if (unit === 'month') {
            const inWeek = today >= weekStart && today <= addDays(weekStart, 6);
            monthKey = monthKeyOf(inWeek ? today : weekStart);
          } else if (!wasWeekly) {
            const inMonth = monthKeyOf(today) === monthKey;
            weekStart = weekStartOf(inMonth ? today : `${monthKey}-01`, store.settings.weekStart);
          }
          keepFocus(unitSeg, renderUnitSeg);
          render().catch(console.error);
        },
      }, u.label));
    }
  }
  renderUnitSeg();

  const body = el('div');
  const prevBtn = el('button.icon-btn.bordered', {
    html: icon('chevL', 18, 2), 'aria-label': 'Previous week',
    onclick: () => go(-1),
  });
  const nextBtn = el('button.icon-btn.bordered', {
    html: icon('chevR', 18, 2), 'aria-label': 'Next week',
    onclick: () => go(1),
  });
  const todayBtn = el('button.btn.btn-ghost.btn-slim', {
    onclick: () => {
      weekStart = weekStartOf(todayISO(), store.settings.weekStart);
      monthKey = monthKeyOf(todayISO());
      render().catch(console.error);
    },
  }, 'Today');
  const searchBtn = el('button.icon-btn.bordered', {
    html: icon('search', 18, 2),
    'aria-label': 'Search entries',
    'aria-pressed': 'false',
    onclick: () => (searching ? exitSearch() : enterSearch()),
  });
  const pageSub = el('p.page-sub', {}, 'Timesheet');
  /* Previous / Today / Next read as one control, so they wrap as one:
     loose in the header they overflow a phone by a couple of pixels and
     Next lands alone on the next line, an arrow away from its pair. */
  const dateNav = el('div.date-nav', {}, prevBtn, todayBtn, nextBtn);

  root.append(
    el('div.page-head.page-head-split', {},
      el('div', {},
        rangeLabel,
        pageSub
      ),
      el('div.week-nav', { role: 'group', 'aria-label': 'Timesheet navigation' },
        searchBtn,
        unitSeg,
        dateNav
      )
    ),
    body
  );

  function go(dir) {
    if (isWeekly(unit)) weekStart = addDays(weekStart, dir * 7);
    else monthKey = shiftMonth(monthKey, dir);
    render().catch(console.error);
  }

  /* ---------- search mode ---------- */

  let searchInput = null;
  const searchResults = el('div');

  function enterSearch() {
    searching = true;
    windowMonths = 3;
    filters.query = '';
    filters.clientId = '';
    filters.billing = 'all';
    selecting = false;
    selected.clear();
    searchBtn.setAttribute('aria-pressed', 'true');
    searchBtn.classList.add('active-toggle');
    // The buttons are hidden alongside their group: the keyboard shortcuts
    // read `hidden` off the buttons themselves to stay out of search mode.
    for (const n of [unitSeg, dateNav, prevBtn, todayBtn, nextBtn]) n.hidden = true;
    jumpBtn.disabled = true; // the title is not a date range in search mode
    rangeText.textContent = 'Search';
    pageSub.textContent = 'Every entry, filter by text, client, or billing';

    searchInput = el('input.input.search-input', {
      type: 'search', autocomplete: 'off',
      placeholder: 'Task, notes, project, or client',
      'aria-label': 'Search entries',
      oninput: debounce(() => {
        filters.query = searchInput.value.trim();
        selected.clear();
        renderResults().catch(console.error);
      }, 250),
    });
    const selectBtn = el('button.btn.btn-ghost.btn-slim', {
      type: 'button',
      html: icon('listChecks', 15, 2),
      'aria-pressed': 'false',
      title: 'Select entries to edit them in bulk',
      onclick: () => {
        selecting = !selecting;
        selected.clear();
        selectBtn.setAttribute('aria-pressed', selecting ? 'true' : 'false');
        selectBtn.classList.toggle('active-toggle', selecting);
        renderResults().catch(console.error);
      },
    }, ' Select');
    const clientSel = el('select.select', {
      'aria-label': 'Filter by client',
      onchange: () => {
        filters.clientId = clientSel.value;
        selected.clear();
        renderResults().catch(console.error);
      },
    },
      el('option', { value: '' }, 'All clients'),
      store.clients.map((c) => el('option', { value: c.id }, c.name + (c.archived ? ' (archived)' : '')))
    );
    const billingSel = el('select.select', {
      'aria-label': 'Filter by billing state',
      onchange: () => {
        filters.billing = billingSel.value;
        selected.clear();
        renderResults().catch(console.error);
      },
    }, BILLING_FILTERS.map((b) => el('option', { value: b.value }, b.label)));

    clear(body);
    body.append(
      el('div.search-panel', {},
        el('div.search-row', {}, searchInput, selectBtn),
        el('div.search-filters', {},
          el('div.select-wrap', {}, clientSel),
          el('div.select-wrap', {}, billingSel)
        )
      ),
      searchResults
    );
    searchInput.focus();
    renderResults().catch(console.error);
  }

  function exitSearch() {
    searching = false;
    selecting = false;
    selected.clear();
    searchBtn.setAttribute('aria-pressed', 'false');
    searchBtn.classList.remove('active-toggle');
    for (const n of [unitSeg, dateNav, prevBtn, todayBtn, nextBtn]) n.hidden = false;
    jumpBtn.disabled = false;
    pageSub.textContent = 'Timesheet';
    render().catch(console.error);
  }

  let resultsSeq = 0;

  async function renderResults() {
    const seq = ++resultsSeq;
    const today = todayISO();
    const startKey = shiftMonth(monthKeyOf(today), -(windowMonths - 1));
    // The window bounds how far BACK the search reaches; entries dated
    // ahead of today (planned work) must always be findable.
    const entries = await store.entriesBetween(`${startKey}-01`, '9999-12-31');
    if (seq !== resultsSeq || !searching) return;

    const matches = store.filterEntries(entries, filters);
    const totals = store.totals(matches);
    const hasOlder = store.months.length > 0 && store.months[0] < startKey;

    clear(searchResults);
    searchResults.append(el('div.stat-row', {},
      stat('Matched', fmtDuration(totals.seconds)),
      stat('Billable', fmtDuration(totals.billableSeconds)),
      stat('Amount', moneyValue(store.amountsByCurrency(matches), store.settings.currency))
    ));

    /* Bulk-edit bar: selection summary and actions, sticky over long
       result lists. Individual toggles only refresh the bar; select-all
       and store writes rebuild the whole result list. */
    let barNode = null;
    const renderBar = () => {
      if (!barNode) return;
      const sel = [...selected.values()];
      const none = sel.length === 0;
      const lockedCount = matches.filter((m) => m.invoicedAt).length;
      const selectable = matches.filter((m) => !m.invoicedAt);
      clear(barNode);
      // Native append stringifies false, so the conditional note below has
      // to go through the helper that drops it.
      append(barNode, [
        el('span.bulk-count', {},
          `${sel.length} selected · ${fmtDuration(store.totals(sel).seconds)}`),
        el('button.btn.btn-ghost.btn-slim', {
          disabled: !selectable.length || selectable.every((m) => selected.has(m.id)),
          onclick: () => {
            for (const m of selectable) selected.set(m.id, m);
            renderResults().catch(console.error);
          },
        }, 'Select all'),
        el('button.btn.btn-ghost.btn-slim', {
          disabled: none,
          onclick: () => {
            selected.clear();
            renderResults().catch(console.error);
          },
        }, 'Clear'),
        lockedCount > 0 && el('span.bulk-note', {}, `${lockedCount} invoiced locked`),
        el('div.bulk-actions', {},
          el('button.btn.btn-ghost.btn-slim', { disabled: none, onclick: moveSelected }, 'Move to project'),
          el('button.btn.btn-ghost.btn-slim', { disabled: none, onclick: setTaskOnSelected }, 'Set task'),
          el('button.btn.btn-ghost.btn-slim', { disabled: none, onclick: () => setBillableOnSelected(true) }, 'Billable'),
          el('button.btn.btn-ghost.btn-slim', { disabled: none, onclick: () => setBillableOnSelected(false) }, 'Non-billable'),
          el('button.btn.btn-ghost.btn-slim.btn-danger-ghost', { disabled: none, style: { marginTop: 0 }, onclick: deleteSelected }, 'Delete')
        ),
      ]);
    };
    if (selecting) {
      barNode = el('div.card.bulk-bar');
      renderBar();
      searchResults.append(barNode);
    }

    if (!matches.length) {
      searchResults.append(el('div.empty.empty-slim', { style: { marginTop: '14px' } },
        el('p', {}, `Nothing matches since ${fmtMonth(startKey)}.`)
      ));
    } else {
      // Newest first, grouped by day (entries already arrive sorted).
      let currentDay = null;
      let listNode = null;
      for (const e of matches) {
        if (e.date !== currentDay) {
          currentDay = e.date;
          const dayMatches = matches.filter((m) => m.date === e.date);
          searchResults.append(el('div.day-head', {},
            el('h2.section-title', {}, fmtDayHeading(e.date)),
            el('span.day-total', {}, fmtDuration(store.totals(dayMatches).seconds))
          ));
          listNode = el('div.card.list-card');
          searchResults.append(listNode);
        }
        listNode.append(entryRow(e, selecting ? {
          select: {
            checked: selected.has(e.id),
            disabled: !!e.invoicedAt,
            onToggle: (on) => {
              if (on) selected.set(e.id, e);
              else selected.delete(e.id);
              renderBar();
            },
          },
        } : {}));
      }
    }

    searchResults.append(el('p.search-note', {},
      `Searching entries since ${fmtMonth(startKey)}.`,
      hasOlder && el('button.btn.btn-ghost.btn-slim.load-older', {
        onclick: () => { windowMonths += 6; renderResults().catch(console.error); },
      }, 'Search older entries')
    ));
  }

  /* ---------- bulk actions on the selection ---------- */

  const noun = (n) => (n === 1 ? 'entry' : 'entries');

  function selItems(patch) {
    return [...selected.values()].map((e) => ({ id: e.id, date: e.date, patch }));
  }

  /* Apply a patch to the whole selection with an undo toast. The store
     batches per month file and skips anything invoiced defensively;
     the resulting change event rebuilds the list with a clean slate. */
  async function applyBulk(items, message) {
    try {
      const res = await store.bulkPatch(items);
      selected.clear();
      toast(`${message(res.changed)}${res.skipped ? `, ${res.skipped} invoiced skipped` : ''}`, {
        icon: 'checkCheck',
        action: res.changed ? {
          label: 'Undo',
          onClick: () => store.bulkPatch(res.inverse)
            .catch(() => toast('Could not undo, check your connection', { icon: 'wifiOff' })),
        } : null,
      });
    } catch (err) {
      console.error(err);
      toast('Could not update, check your connection', { icon: 'wifiOff' });
    }
  }

  function moveSelected() {
    const n = selected.size;
    const project = projectSelect(store, null);
    const projectErr = fieldError(project);
    nativeError(project, projectErr, 'Pick a project to move these entries to');
    const form = el('form.form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!project.value) return;
        modal.close();
        const name = store.project(project.value)?.name || 'that project';
        await applyBulk(selItems({ projectId: project.value }), (c) => `Moved ${c} ${noun(c)} to ${name}`);
      },
    },
      el('div', {}, field('Project', project, { hint: 'Every selected entry moves to this project. Rates and billing follow it.' }), projectErr),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, `Move ${n} ${noun(n)}`)
    );
    const modal = openModal({ title: 'Move to project', content: form });
  }

  function setTaskOnSelected() {
    const n = selected.size;
    const task = el('input.input', {
      type: 'text', maxLength: 120, autocomplete: 'off',
      placeholder: 'e.g. Design review', list: 'bulk-task-suggestions',
    });
    const taskList = el('datalist', { id: 'bulk-task-suggestions' });
    store.taskSuggestions()
      .then((tasks) => taskList.replaceChildren(...tasks.map((t) => el('option', { value: t }))))
      .catch(() => {});
    const form = el('form.form', {
      onsubmit: async (e) => {
        e.preventDefault();
        modal.close();
        const value = task.value.trim();
        await applyBulk(selItems({ task: value }),
          (c) => (value ? `Task set on ${c} ${noun(c)}` : `Task cleared on ${c} ${noun(c)}`));
      },
    },
      field('Task', task, { hint: 'One spelling, one report group: replaces the task on every selected entry. Leave empty to clear it.' }),
      taskList,
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, `Set task on ${n} ${noun(n)}`)
    );
    const modal = openModal({ title: 'Set task', content: form });
  }

  async function setBillableOnSelected(billable) {
    const sel = [...selected.values()];
    const n = sel.length;
    const ok = await confirmDialog({
      title: billable ? `Mark ${n} ${noun(n)} billable?` : `Mark ${n} ${noun(n)} non-billable?`,
      message: `${fmtDuration(store.totals(sel).seconds)} of selected time ${billable ? 'starts' : 'stops'} counting toward client bills.`,
      confirmLabel: billable ? 'Mark billable' : 'Mark non-billable',
      danger: false,
    });
    if (!ok) return;
    await applyBulk(selItems({ billable }),
      (c) => `Marked ${c} ${noun(c)} ${billable ? 'billable' : 'non-billable'}`);
  }

  async function deleteSelected() {
    const sel = [...selected.values()];
    const n = sel.length;
    const ok = await confirmDialog({
      title: `Delete ${n} ${noun(n)}?`,
      message: `${fmtDuration(store.totals(sel).seconds)} of tracked time is removed from your timesheet.`,
      confirmLabel: `Delete ${n} ${noun(n)}`,
    });
    if (!ok) return;
    try {
      const res = await store.bulkDelete(sel.map((e) => ({ id: e.id, date: e.date })));
      selected.clear();
      toast(`Deleted ${res.deleted} ${noun(res.deleted)}${res.skipped ? `, ${res.skipped} invoiced skipped` : ''}`, {
        icon: 'trash',
        action: res.removed.length ? {
          label: 'Undo',
          onClick: () => store.restoreEntries(res.removed)
            .catch(() => toast('Could not restore, check your connection', { icon: 'wifiOff' })),
        } : null,
      });
    } catch (err) {
      console.error(err);
      toast('Could not delete, check your connection', { icon: 'wifiOff' });
    }
  }

  /* ---------- range mode ---------- */

  /* Fast flipping (or a store change mid-load) can finish an older render
     after a newer one; only the newest may write the DOM. */
  let renderSeq = 0;

  async function render() {
    if (searching) return renderResults();
    const seq = ++renderSeq;
    if (weekStart !== gridRowsWeek) {
      gridRows = new Set();
      gridRowsWeek = weekStart;
    }
    const days = isWeekly(unit) ? weekDays(weekStart) : monthDays(monthKey);
    rangeText.textContent = isWeekly(unit) ? fmtWeekRange(weekStart) : fmtMonth(monthKey);
    // "Previous week" for the grid too: it is a week, shown differently.
    const periodName = unit === 'month' ? 'month' : 'week';
    prevBtn.setAttribute('aria-label', `Previous ${periodName}`);
    nextBtn.setAttribute('aria-label', `Next ${periodName}`);

    const entries = await store.entriesBetween(days[0], days[days.length - 1]);
    // Search may have taken over the body while this render awaited;
    // writing range content now would wipe out the search panel.
    if (seq !== renderSeq || searching) return;
    /* A cell commit writes, which re-renders: the cell the user has
       already tabbed into keeps its focus and whatever is half-typed in
       it. */
    const gridFocus = unit === 'grid' ? captureGridFocus() : null;

    const byDay = new Map(days.map((d) => [d, []]));
    for (const e of entries) byDay.get(e.date)?.push(e);
    const totals = store.totals(entries);
    const daySeconds = days.map((d) => store.totals(byDay.get(d)).seconds);
    const max = Math.max(...daySeconds, 1);
    const today = todayISO();

    clear(body);

    /* Range summary. A weekly target replaces the tile it counts
       (tracked or billable) with quiet progress, on week ranges only. */
    const targetHours = isWeekly(unit) ? Number(store.settings.weeklyTargetHours) || 0 : 0;
    const countsTracked = store.settings.weeklyTargetKind === 'tracked';
    body.append(el('div.stat-row', {},
      targetHours > 0 && countsTracked
        ? targetStatTile('Tracked', totals.seconds, targetHours)
        : stat('Tracked', fmtDuration(totals.seconds)),
      targetHours > 0 && !countsTracked
        ? targetStatTile('Billable', totals.billableSeconds, targetHours)
        : stat('Billable', fmtDuration(totals.billableSeconds)),
      // Per-currency subtotals, side by side; never converted or summed.
      stat('Amount', moneyValue(store.amountsByCurrency(entries), store.settings.currency))
    ));

    if (unit === 'grid') {
      body.append(weekGrid({
        days,
        entries,
        extra: [...gridRows],
        onAddRow: (projectId) => {
          gridRows.add(projectId);
          // The row was asked for so it could be typed into: land in its
          // first cell rather than leaving the keyboard on the body after
          // the picker rebuilds.
          render()
            .then(() => document.querySelector(`input[data-cell="${projectId}|${days[0]}"]`)?.focus({ preventScroll: true }))
            .catch(console.error);
        },
        // A locked cell (several entries, or invoiced time) belongs to the
        // day section, where every entry behind it can be seen.
        onJump: (date) => {
          const section = document.getElementById(`day-${date}`);
          if (section) scrollIntoView(section);
        },
      }));
      // The same day sections as the week view, so a locked cell has
      // somewhere to send the user and the grid keeps its context.
      for (const d of days) body.append(daySection(d, byDay.get(d), today));
      restoreGridFocus(gridFocus);
    } else if (unit === 'week') {
      body.append(weekStrip(days, daySeconds, max, today));
      // A week lists all seven days, empty ones included, for quick add.
      for (const d of days) body.append(daySection(d, byDay.get(d), today));
    } else {
      body.append(monthGrid(days, daySeconds, max, today));
      // A month only lists days that have entries.
      const withTime = days.filter((d) => byDay.get(d).length);
      if (!withTime.length) {
        body.append(el('div.empty', {},
          el('div.empty-icon', { html: icon('calendar', 26) }),
          el('p', {}, 'No time logged this month. Tap a day above to add an entry.')
        ));
      }
      for (const d of withTime) body.append(daySection(d, byDay.get(d), today));
    }
  }

  /* Week overview: one bar per day, hours encoded by height (single hue).
     Buttons, not links: a followed #day-... href would be routed as a
     view change. The strip reads as one image to AT; scrolling reaches
     the same sections. */
  function weekStrip(days, daySeconds, max, today) {
    return el('div.day-strip', { role: 'img', 'aria-label': overviewLabel(days, daySeconds) },
      days.map((d, i) => el('button.day-col', {
        type: 'button',
        className: `day-col${d === today ? ' today' : ''}`,
        'aria-hidden': 'true', tabindex: -1,
        onclick: () => {
          const section = document.getElementById(`day-${d}`);
          if (section) scrollIntoView(section);
        },
      },
        el('span.day-col-hours', {}, daySeconds[i] ? fmtClock(daySeconds[i]) : ''),
        el('span.day-col-bar-track', {},
          el('span.day-col-bar', { style: { height: `${Math.max(daySeconds[i] ? 8 : 2, Math.round((daySeconds[i] / max) * 100))}%` } })),
        el('span.day-col-name', {}, fmtWeekday(d))
      ))
    );
  }

  /* Month overview: calendar grid, hours per day encoded as a single-hue
     intensity (sequential = magnitude). Tapping a day scrolls to its
     entries, or starts one on an empty day. */
  function monthGrid(days, daySeconds, max, today) {
    const ws = store.settings.weekStart;
    const lead = (dateOf(days[0]).getDay() - ws + 7) % 7;
    const cells = [...Array(lead).fill(null), ...days.map((d, i) => ({ d, secs: daySeconds[i] }))];
    while (cells.length % 7) cells.push(null);
    const headNames = weekDays(weekStartOf(days[0], ws)).map(fmtWeekday);

    return el('div.month-grid', { role: 'img', 'aria-label': overviewLabel(days, daySeconds) },
      headNames.map((n) => el('span.month-grid-head', { 'aria-hidden': 'true' }, n)),
      cells.map((c) => {
        if (!c) return el('span.month-cell.blank', { 'aria-hidden': 'true' });
        const share = c.secs / max;
        return el('button.month-cell', {
          type: 'button',
          className: `month-cell${c.secs ? ' has-time' : ''}${c.d === today ? ' today' : ''}`,
          'aria-hidden': 'true', tabindex: -1,
          style: c.secs ? { background: `color-mix(in srgb, var(--accent) ${Math.round(10 + share * 30)}%, var(--surface))` } : null,
          onclick: () => {
            const section = document.getElementById(`day-${c.d}`);
            if (section) scrollIntoView(section);
            else openEntryForm({ date: c.d });
          },
        },
          el('span.month-cell-day', {}, String(Number(c.d.slice(8)))),
          c.secs > 0 && el('span.month-cell-hours', {}, fmtClock(c.secs))
        );
      })
    );
  }

  function daySection(d, dayEntries, today) {
    const secs = store.totals(dayEntries).seconds;
    const section = el('section.day-section', { id: `day-${d}` },
      el('div.day-head', {},
        el('h2.section-title', { className: `section-title${d === today ? ' accent' : ''}` }, fmtDayHeading(d)),
        el('div.day-head-side', {},
          secs > 0 && el('span.day-total', {}, fmtDuration(secs)),
          el('button.icon-btn', {
            html: icon('plus', 17, 2.2),
            'aria-label': `Log time on ${fmtDayHeading(d)}`,
            onclick: () => openEntryForm({ date: d }),
          })
        )
      )
    );
    if (dayEntries.length) {
      section.append(el('div.card.list-card', {}, dayEntries.map((e) => entryRow(e))));
    } else {
      section.append(el('p.day-empty', {}, 'No time logged'));
    }
    return section;
  }

  function stat(label, value) {
    return el('div.stat-tile', {},
      el('div.stat-label', {}, label),
      el('div.stat-value', {}, value)
    );
  }

  function overviewLabel(days, secs) {
    const total = secs.reduce((a, b) => a + b, 0);
    const active = secs.filter(Boolean).length;
    const range = unit === 'week' ? fmtWeekRange(days[0]) : fmtMonth(monthKeyOf(days[0]));
    return `${range}: ${fmtDuration(total)} across ${active} day${active === 1 ? '' : 's'}`;
  }

  const onChange = () => render().catch(console.error);
  store.addEventListener('change', onChange);
  render().catch(console.error);

  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
