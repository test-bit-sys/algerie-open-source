import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { todayISO, formatDate, formatMonth, formatClock } from '../lib/util.js';
import { isOpen } from '../lib/forecast.js';
import {
  WEEKDAYS, monthCells, weekCells, shiftPeriod, periodAnchor, byDay, cellRange, inRange,
} from '../lib/calendar-grid.js';
import { pageHead, emptyState, taskRow, openRescheduleSheet } from '../ui/bits.js';
import { openTaskForm } from '../ui/forms.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

/** How many chips a day cell shows before it says "+2 more". */
const PER_DAY = 3;

/** A month grid needs room; below this the calendar is a week at a time. */
const WIDE = '(min-width: 720px)';

/**
 * Follow-ups, three ways: grouped by urgency (the default - it answers
 * "what now"), or as a month or a week, which answers the question a list
 * can't - what does my week look like, and which day is already full.
 */
export function followupsView({ params } = {}) {
  const root = el('div.view');
  const body = el('div');
  const controls = el('div');

  // Deep link from a reminder notification: open that follow-up directly.
  const focusId = params?.get('task');
  if (focusId) {
    const task = store.tasks.find((t) => t.id === focusId);
    if (task) setTimeout(() => openTaskForm(task), 60);
  }

  const stored = store.settings.followupView;
  let mode = stored === 'month' || stored === 'week' ? stored : 'list';

  /* A month grid at 390px is a week strip, not a shrunk month - so a narrow
     window reads a saved month preference as a week, and the toggle drops
     the option rather than offering something that doesn't fit. */
  const wide = () => matchMedia(WIDE).matches;
  const effectiveMode = () => (mode === 'month' && !wide() ? 'week' : mode);
  /** The mode currently drawn, so a resize can tell a real change from none. */
  let shownMode = effectiveMode();

  /* The period the calendar opens on has to be the one the mode on screen
     can read: a month is anchored by a month key, a week by a day. Taken
     from the saved preference rather than the mode actually drawn, a
     laptop's saved Month opened on a phone handed the week strip
     "2026-08" as its starting day - and every date derived from it came
     out NaN, so the whole week read "undefined NaN" and held nothing. */
  let anchor = periodAnchor(shownMode === 'month' ? 'month' : 'week');

  /* Compared against the mode on screen, not the stored one. A phone
     showing a saved month preference as a week marks Week active, and
     tapping the chip that is already active must not quietly rewrite the
     preference the laptop opens with. */
  function setMode(next) {
    if (effectiveMode() === next) return;
    mode = next;
    anchor = periodAnchor(effectiveMode() === 'month' ? 'month' : 'week');
    store.updateSettings({ followupView: next }).catch(() => {});
    renderControls();
    render();
  }

  /* ----- what the calendar shows: follow-ups, and the other dated
     commitment a founder keeps - the close date of an open deal. The same
     pairing the .ics export makes. ----- */

  function entries() {
    const rows = store.openTasks().map((task) => ({
      kind: 'task', date: task.due, id: task.id, task,
    }));
    for (const deal of store.deals) {
      if (!isOpen(deal) || !deal.expectedClose) continue;
      rows.push({ kind: 'deal', date: deal.expectedClose, id: deal.id, deal });
    }
    return rows;
  }

  /** Move a follow-up to a day, with one Undo behind it. */
  async function moveTask(task, iso) {
    if (!task || task.due === iso) return;
    const prev = { due: task.due, dueTime: task.dueTime };
    try {
      await store.updateTask(task.id, { due: iso });
    } catch {
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      return;
    }
    toast(`Moved to ${formatDate(iso)}`, {
      icon: 'calendar',
      action: {
        label: 'Undo',
        onClick: () => store.updateTask(task.id, prev)
          .catch(() => toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' })),
      },
    });
  }

  /**
   * Everything on one day, when a cell can't show it all.
   *
   * The sheet follows the data while it is open, the way the duplicates
   * review does. Its rows carry the same checkbox the list does, and
   * ticking one wrote the follow-up done and re-drew the calendar behind
   * the sheet - while the sheet itself, built once from the rows it was
   * handed, kept showing the box empty. Nothing on screen said the tap had
   * landed, and a second tap to make sure quietly undid it.
   */
  function openDaySheet(iso, rows) {
    // What the sheet opened on stays in it: a follow-up ticked off here is
    // shown done rather than vanishing under the finger that ticked it, so
    // the tap has something to answer for and the box can be unticked.
    const opened = new Set(rows.filter((r) => r.kind === 'task').map((r) => r.id));
    const body = el('div');
    const modal = openModal({
      title: formatDate(iso, { year: 'always' }),
      content: body,
      onClose: () => store.removeEventListener('change', render),
    });

    function render() {
      // The rebuild tears the ticked box out from under the keyboard; find
      // its twin afterwards and hand focus back, or the panel when the row
      // has left the day.
      const focusKey = body.contains(document.activeElement)
        ? document.activeElement.dataset?.focusKey : null;
      clear(body);
      const tasks = store.tasks
        .filter((t) => t.due === iso && (!t.done || opened.has(t.id)))
        .sort((a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99'));
      const deals = store.deals.filter((d) => isOpen(d) && d.expectedClose === iso);
      // Moved, deleted, or closed away: a sheet about a day with nothing
      // left on it has nothing left to say.
      if (!tasks.length && !deals.length) { modal.close(); return; }
      // Each list only when it holds something: both carry their own
      // padding, so an empty one left a stripe of nothing where a day of
      // only close dates - or only follow-ups - had nothing to put.
      append(body, [
        tasks.length > 0 && el('div.task-list', {}, tasks.map((task) =>
          taskRow(task, { onEdit: (t) => { modal.close(); openTaskForm(t); } }))),
        deals.length > 0 && el('div.settings-list', {}, deals.map((deal) =>
          el('a.settings-row', { href: `#/pipeline?id=${deal.id}`, onclick: () => modal.close() },
            el('span.row-ic', { html: icon('deal', 20, 1.8) }),
            el('div.grow.min0', {},
              el('div.title', {}, deal.name),
              el('div.sub', {}, 'Expected close')
            ),
            el('span.row-chev', { html: icon('chevR', 18) })
          ))),
      ]);
      if (focusKey) {
        (body.querySelector(`[data-focus-key=${CSS.escape(focusKey)}]`) || modal.panel)
          .focus({ preventScroll: true });
      }
    }

    render();
    store.addEventListener('change', render);
    return modal;
  }

  /** One item in a day cell: a follow-up you can drag, or a close date. */
  function chip(entry) {
    if (entry.kind === 'deal') {
      return el('a.cal-chip.cal-deal', {
        href: `#/pipeline?id=${entry.deal.id}`,
        title: `${entry.deal.name} · expected close`,
      },
        el('span.cal-chip-ic', { html: icon('deal', 11, 2.4), 'aria-hidden': 'true' }),
        el('span.cal-chip-text', {}, entry.deal.name)
      );
    }
    const { task } = entry;
    const node = el('div.cal-chip.cal-task', {
      draggable: 'true',
      className: `cal-chip cal-task${task.due < todayISO() ? ' overdue' : ''}`,
    },
      el('button.cal-chip-main', {
        type: 'button',
        title: `${task.title} · move or edit`,
        'aria-label': `${task.title}${task.dueTime ? ` at ${formatClock(task.dueTime)}` : ''}, ${formatDate(task.due)}`,
        'aria-haspopup': 'dialog',
        dataset: { focusKey: `cal-task-${task.id}` },
        // Tap, click, or Enter: the keyboard-and-touch path to the same
        // move that dragging does, plus the way into the full form.
        onclick: () => openChipSheet(task),
      },
        task.dueTime && el('span.cal-chip-time', {}, formatClock(task.dueTime)),
        el('span.cal-chip-text', {}, task.title)
      )
    );
    node.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/task-id', task.id);
      e.dataTransfer.effectAllowed = 'move';
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
    return node;
  }

  /** What a tap on a follow-up offers: move it, or open it. */
  function openChipSheet(task) {
    const modal = openModal({
      title: task.title,
      content: el('div.settings-list', {},
        el('button.settings-row', {
          type: 'button',
          onclick: () => { modal.close(); setTimeout(() => openRescheduleSheet(task), 120); },
        },
          el('span.row-ic', { html: icon('calendar', 20, 1.8) }),
          el('div.grow', {},
            el('div.title', {}, 'Move to another day'),
            el('div.sub', {}, `Now ${formatDate(task.due, { year: 'always' })}`)
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        ),
        el('button.settings-row', {
          type: 'button',
          onclick: () => { modal.close(); setTimeout(() => openTaskForm(task), 120); },
        },
          el('span.row-ic', { html: icon('pencil', 20, 1.8) }),
          el('div.grow', {},
            el('div.title', {}, 'Edit the follow-up'),
            el('div.sub', {}, 'Title, time, repeat, links')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        )
      ),
    });
  }

  function calendar() {
    const view = effectiveMode();
    const today = todayISO();
    const cells = view === 'month' ? monthCells(anchor, today) : weekCells(anchor, today);
    const range = cellRange(cells);
    const rows = byDay(inRange(entries(), range));

    const grid = el('div.cal-grid', { className: `cal-grid ${view}` });

    /* A list of days, not an ARIA grid. `role="grid"` promises arrow-key
       cell navigation this widget doesn't implement (its chips are ordinary
       tab stops), and the cells were gridcells with no row between them and
       the rowgroup - a malformed grid, which assistive tech is free to
       report as nothing at all. Every cell already names its own full date,
       so the weekday strip over the month is decoration and says so.

       The header earns its row only where there are several weeks under it;
       a week strip names its own days. */
    if (view === 'month') {
      grid.append(el('div.cal-head', { 'aria-hidden': 'true' },
        WEEKDAYS.map((day) => el('div.cal-weekday', {}, day))));
    }

    const cellsWrap = el('div.cal-cells', {
      role: 'list',
      'aria-label': view === 'month' ? `${formatMonth(anchor)} follow-ups` : 'Week of follow-ups',
    });
    for (const cell of cells) {
      const dayRows = rows[cell.iso] || [];
      const shown = dayRows.slice(0, PER_DAY);
      const extra = dayRows.length - shown.length;

      const node = el('div.cal-cell', {
        role: 'listitem',
        className: `cal-cell${cell.today ? ' today' : ''}${cell.past ? ' past' : ''}`
          + `${cell.inMonth ? '' : ' outside'}${cell.weekend ? ' weekend' : ''}`,
        'aria-label': `${formatDate(cell.iso, { year: 'always' })}: `
          + `${dayRows.length} item${dayRows.length === 1 ? '' : 's'}`,
      },
        el('div.cal-cell-head', {},
          el('span.cal-day', {}, view === 'week'
            ? `${WEEKDAYS[cell.weekday]} ${cell.day}`
            : String(cell.day)),
          // The count is the point of a grid: an overloaded day is visible
          // before it arrives, not on the morning it does.
          dayRows.length > 1 && el('span.cal-count', {
            title: `${dayRows.length} on this day`,
          }, String(dayRows.length))
        ),
        el('div.cal-items', {}, shown.map(chip)),
        extra > 0 && el('button.cal-more', {
          type: 'button',
          onclick: () => openDaySheet(cell.iso, dayRows),
        }, `+${extra} more`)
      );

      /* Dropzone: a follow-up dragged here is due here. */
      node.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('text/task-id')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        node.classList.add('drop-target');
      });
      node.addEventListener('dragleave', (e) => {
        if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
      });
      node.addEventListener('drop', async (e) => {
        e.preventDefault();
        node.classList.remove('drop-target');
        const task = store.tasks.find((t) => t.id === e.dataTransfer.getData('text/task-id'));
        await moveTask(task, cell.iso);
      });

      cellsWrap.append(node);
    }
    grid.append(cellsWrap);

    const anyItems = Object.keys(rows).length > 0;
    return el('section.card.cal-card', {},
      el('div.cal-bar', {},
        el('button.icon-btn', {
          type: 'button',
          html: icon('chevL', 18, 2.2),
          'aria-label': view === 'month' ? 'Previous month' : 'Previous week',
          dataset: { focusKey: 'cal-prev' },
          onclick: keepingFocus(() => { anchor = shiftPeriod(view, anchor, -1); render(); }),
        }),
        el('h2.cal-title', {}, view === 'month'
          ? formatMonth(anchor)
          : `${formatDate(cells[0].iso)} – ${formatDate(cells[6].iso, { year: 'always' })}`),
        el('button.icon-btn', {
          type: 'button',
          html: icon('chevR', 18, 2.2),
          'aria-label': view === 'month' ? 'Next month' : 'Next week',
          dataset: { focusKey: 'cal-next' },
          onclick: keepingFocus(() => { anchor = shiftPeriod(view, anchor, 1); render(); }),
        }),
        el('div.grow'),
        anchor !== periodAnchor(view) && el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: keepingFocus(() => { anchor = periodAnchor(view); render(); }),
        }, view === 'month' ? 'This month' : 'This week')
      ),
      grid,
      !anyItems && el('p.card-empty', {}, view === 'month'
        ? 'Nothing due this month.'
        : 'Nothing due this week.'),
      el('p.settings-note.cal-note', {},
        'Drag a follow-up to another day, or tap it to move it. Deal close dates ride along and stay where they are.')
    );
  }

  /* ----- the list: grouped by urgency, and still the default ----- */

  function list() {
    const today = todayISO();
    const open = store.openTasks();
    const overdue = open.filter((t) => t.due < today);
    const dueToday = open.filter((t) => t.due === today);
    const upcoming = open.filter((t) => t.due > today);
    const doneAll = store.tasks.filter((t) => t.done);
    const done = [...doneAll]
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
      .slice(0, 10);

    // The pill counts the whole bucket even when the list below is capped
    // - four pills side by side read as totals, and one quietly meaning
    // "rows shown" would make the Done count a lie.
    const group = (title, tasks, { tone = null, total = tasks.length } = {}) => tasks.length
      ? el('section.card', {},
          el('div.card-head', {},
            el('h2.card-title', {}, title),
            el(`span.count-pill${tone ? `.${tone}` : ''}`, {}, String(total))
          ),
          el('div.task-list', {}, tasks.map((t) => taskRow(t, { onEdit: (task) => openTaskForm(task) }))),
          total > tasks.length && el('div.list-more-note', {},
            `Showing the ${tasks.length} most recent`)
        )
      : null;

    return [
      /* Nothing open is the answer this page exists to give, so it goes
         first - it sat under the Done archive, which meant scrolling past
         everything already finished to reach the good news. In a card like
         every other block here: loose on the page it was a stray green line
         with a card's padding and no card, and the dashboard shows this same
         all-clear inside one. */
      !open.length && el('section.card', {},
        el('div.all-clear', { html: icon('check', 18, 2.4) },
          el('span', {}, 'All caught up. Nothing due.'))),
      group('Overdue', overdue, { tone: 'critical' }),
      group('Today', dueToday),
      group('Upcoming', upcoming),
      group('Done', done, { total: doneAll.length }),
    ];
  }

  function renderControls() {
    clear(controls);
    if (!store.tasks.length) return;
    const options = [
      ['list', 'List', 'listChecks'],
      ['week', 'Week', 'calendar'],
      ...(wide() ? [['month', 'Month', 'calendar']] : []),
    ];
    // Not .view-toggle: that class trades its labels for icons on a narrow
    // screen because it shares the pipeline header with a primary action.
    // This one has a row to itself, where the words fit and read better.
    controls.append(el('div.seg-group.cal-toggle', {
      role: 'group', 'aria-label': 'Follow-up layout',
    }, options.map(([value, label, ic]) => el('button.seg', {
      type: 'button',
      className: `seg${effectiveMode() === value ? ' active' : ''}`,
      'aria-pressed': String(effectiveMode() === value),
      html: icon(ic, 15, 2),
      dataset: { focusKey: `followup-mode-${value}` },
      onclick: () => setMode(value),
    }, ` ${label}`))));
  }

  function render() {
    shownMode = effectiveMode();
    clear(body);
    if (!store.tasks.length) {
      body.append(emptyState({
        icon: 'followups',
        title: 'Nothing to chase yet',
        message: 'Follow-ups are dated reminders tied to a lead or deal, so no conversation goes quiet by accident.',
        action: el('button.btn.btn-primary', { onclick: () => openTaskForm() }, 'Add a follow-up'),
      }));
      return;
    }
    if (effectiveMode() === 'list') append(body, list());
    else body.append(calendar());
  }

  const renderOnChange = keepingFocus(() => {
    renderControls();
    render();
  });
  store.addEventListener('change', renderOnChange);

  /* A window crossing the month-grid breakpoint changes what this page can
     offer, so the toggle always rebuilds rather than be left offering
     something that doesn't fit. The calendar only starts over when the
     shape it draws really changed - a week strip is a week strip either
     side of the line, and resetting the anchor there threw away the week
     the user had paged to for a resize that changed nothing about it. */
  const media = matchMedia(WIDE);
  const onResize = () => {
    const next = effectiveMode();
    renderControls();
    if (next === shownMode) return;
    anchor = periodAnchor(next === 'month' ? 'month' : 'week');
    render();
  };
  media.addEventListener('change', onResize);

  renderControls();
  render();

  root.append(
    pageHead('Follow-ups',
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 2.2),
        onclick: () => openTaskForm(),
      }, ' New follow-up')),
    controls,
    body
  );
  root.destroy = () => {
    store.removeEventListener('change', renderOnChange);
    media.removeEventListener('change', onResize);
  };
  return root;
}
