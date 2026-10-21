import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { store, priorityInfo } from '../lib/store.js';
import { todayISO, relativeDue, fmtTime, isOverdue } from '../lib/dates.js';
import { describeRule } from '../lib/recur.js';
import { describeReminder } from '../lib/reminders.js';
import { openTaskForm } from './taskform.js';
import { openRowMenu } from './rowmenu.js';
import { quickRescheduleActions } from './quickactions.js';

/* Which rows have their subtask strip open; survives view re-renders. */
const expanded = new Set();

/**
 * One task row (+ optional subtask strip). Views re-render on store change,
 * so rows are plain snapshots.
 * opts: { showList: label the source list, readonly: shared viewer,
 *         actions: per-row menu entries — array or (task) => array,
 *         tagLinks: tag chips navigate to #/tag — defaults to !readonly;
 *         the Logbook is read-only yet shows the user's own tasks, so it
 *         turns links back on }
 */
export function taskRow(task, { showList = false, readonly = false, actions = null, tagLinks = !readonly } = {}) {
  const today = todayISO();
  const pr = priorityInfo(task.priority);
  const hasSubs = task.subtasks.length > 0;
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  const list = showList ? store.listById(task.listId) : null;

  const check = el(`button.task-check${task.priority ? '.' + pr.class : ''}`, {
    role: 'checkbox',
    'aria-checked': String(!!task.done),
    'aria-label': `${task.done ? 'Reopen' : 'Complete'}: ${task.title}`,
    html: icon('check', 13, 3.5),
    disabled: readonly,
    onclick: async (e) => {
      e.stopPropagation();
      // Rows hosted in modals (search, calendar day sheet) survive the view
      // re-render, so reflect the new state on the node itself too.
      const reflect = (done) => {
        if (!check.isConnected) return;
        check.setAttribute('aria-checked', String(done));
        row.classList.toggle('done', done);
      };
      if (task.done) {
        await store.uncompleteTask(task.id);
        reflect(false);
        return;
      }
      const res = await store.completeTask(task.id);
      if (res.recurred) {
        // Undo removes the logged occurrence and rolls the task back —
        // a mis-tap here is otherwise harder to reverse than on a plain
        // task (the roll-forward has already moved the due date).
        toast(`Done. Next: ${relativeDue(res.next)}`, {
          icon: 'repeat',
          action: { label: 'Undo', onClick: () => store.uncompleteTask(res.undoId) },
        });
      } else {
        reflect(true);
        toast('Completed', {
          icon: 'checkBig',
          action: { label: 'Undo', onClick: () => store.uncompleteTask(task.id) },
        });
      }
    },
  });

  const meta = [];
  if (task.due && !task.done) {
    const cls = isOverdue(task, today) ? '.overdue' : task.due === today ? '.today' : '';
    meta.push(el(`span.m${cls}`, { html: icon('calendarClock', 12, 2.2) },
      ` ${relativeDue(task.due, today)}${task.dueTime ? ' · ' + fmtTime(task.dueTime) : ''}`));
  }
  if (Number.isFinite(task.reminder) && !task.done) {
    meta.push(el('span.m', {
      html: icon('bell', 12, 2.2),
      title: `Reminder: ${describeReminder(task.reminder)}`,
      'aria-label': `Reminder ${describeReminder(task.reminder)}`,
    }));
  }
  if (task.repeat) {
    meta.push(el('span.m', { html: icon('repeat', 12, 2.2), title: describeRule(task.repeat) },
      ` ${describeRule(task.repeat)}`));
  }
  if (hasSubs) {
    meta.push(el('span.m', { html: icon('listChecks', 12, 2.2) }, ` ${doneSubs}/${task.subtasks.length}`));
  }
  if (task.notes) {
    meta.push(el('span.m', { html: icon('notes', 12, 2.2), 'aria-label': 'Has notes' }));
  }
  if (list) {
    meta.push(el('span.m.list-tag', {},
      el('span.nav-dot', { style: { background: `var(--slot-${list.slot})` }, 'aria-hidden': 'true' }),
      list.name));
  }

  // Open rows always offer the quick reschedules; callers prepend their own
  // context actions (e.g. Move up/down in list detail).
  const extra = (typeof actions === 'function' ? actions(task) : actions) || [];
  const rowActions = readonly || task.done ? null : [...extra, ...quickRescheduleActions(task)];

  // Tag chips live beside the main button, not inside it: a button cannot
  // nest interactive children, and each chip navigates to its tag view.
  const tagStrip = task.tags?.length ? el('div.tag-strip', {},
    task.tags.map((tag) => !tagLinks
      ? el('span.tag-chip', {}, `#${tag}`)
      : el('button.tag-chip', {
        'aria-label': `Show tasks tagged ${tag}`,
        onclick: (e) => {
          e.stopPropagation();
          location.hash = `#/tag/${encodeURIComponent(tag)}`;
        },
      }, `#${tag}`))
  ) : null;

  const row = el('div.task-row' + (task.done ? '.done' : ''), { dataset: { taskId: task.id } },
    check,
    el('div.task-body', {},
      // Read-only rows (shared viewer, archives) render static content, not
      // a button that does nothing.
      el(readonly ? 'div.task-main' : 'button.task-main', {
        'aria-label': readonly ? null : `Open task: ${task.title}`,
        onclick: readonly ? null : () => openTaskForm({ task }),
      },
        el('div.row', { style: { gap: '6px', alignItems: 'baseline' } },
          task.priority > 0 && el('span.priority-flag.' + pr.class, {
            html: icon('flag', 12, 2.6), title: `${pr.label} priority`, 'aria-label': `${pr.label} priority`,
          }),
          el('span.task-title', {}, task.title)
        ),
        meta.length ? el('div.task-meta', {}, meta) : null
      ),
      tagStrip
    ),
    rowActions?.length ? el('button.icon-btn.row-menu', {
      html: icon('more', 17),
      'aria-label': `Actions for ${task.title}`,
      'aria-haspopup': 'dialog',
      onclick: (e) => {
        e.stopPropagation();
        openRowMenu(task, rowActions);
      },
    }) : null,
    hasSubs && el('button.icon-btn', {
      html: icon(expanded.has(task.id) ? 'chevUp' : 'chevDown', 17),
      'aria-expanded': String(expanded.has(task.id)),
      'aria-label': `${expanded.has(task.id) ? 'Hide' : 'Show'} ${task.subtasks.length} subtasks`,
      onclick: (e) => {
        e.stopPropagation();
        if (expanded.has(task.id)) expanded.delete(task.id);
        else expanded.add(task.id);
        // Swap in place without a full view re-render.
        const fresh = taskRow(task, { showList, readonly, actions, tagLinks });
        const strip = row.nextElementSibling?.classList?.contains('subtask-strip') ? row.nextElementSibling : null;
        if (strip) strip.remove();
        row.replaceWith(fresh);
      },
    })
  );

  // Done rows swipe too: right reopens (the checkbox's toggle), matching
  // the "swipe right toggles complete" promise; left has no menu there.
  if (!readonly) attachSwipe(row, task, check, rowActions);

  if (!hasSubs || !expanded.has(task.id)) return row;

  // The line itself is the checkbox; the visual circle is decoration.
  // (A checkbox role nested inside a button is invalid ARIA.)
  const strip = el('div.subtask-strip', { role: 'group', 'aria-label': `Subtasks of ${task.title}` },
    task.subtasks.map((s) => el('button.subtask-line' + (s.done ? '.done' : ''), {
      role: 'checkbox',
      'aria-checked': String(!!s.done),
      disabled: readonly,
      onclick: async (e) => {
        const line = e.currentTarget;
        const subtasks = task.subtasks.map((x) => x.id === s.id ? { ...x, done: !x.done } : x);
        await store.updateTask(task.id, { subtasks });
        // Keep modal-hosted rows visually in sync (see check button above).
        if (line.isConnected) {
          const done = !!store.taskById(task.id)?.subtasks.find((x) => x.id === s.id)?.done;
          line.setAttribute('aria-checked', String(done));
          line.classList.toggle('done', done);
        }
      },
    },
      el('span.task-check', { 'aria-hidden': 'true', html: icon('check', 10, 3.5) }),
      el('span', {}, s.title)
    ))
  );

  const frag = document.createDocumentFragment();
  frag.append(row, strip);
  return frag;
}

/**
 * Touch swipe on a row: right completes, left opens the action menu.
 * Axis-locked (vertical movement hands the gesture back to the scroller)
 * and threshold-gated, with a colored hint strip behind the moving row.
 */
const SWIPE_START = 14;
const SWIPE_COMMIT = 64;

function attachSwipe(row, task, check, rowActions) {
  let sw = null;

  function hintFor(dx) {
    const side = dx > 0 ? 'left' : 'right'; // the edge being revealed
    if (sw.hint?.dataset.side !== side) {
      sw.hint?.remove();
      sw.hint = el('span.swipe-hint' + (side === 'left' ? '.complete' : '.menu'), {
        dataset: { side },
        html: icon(side === 'left' ? 'check' : 'calendarClock', 18, 2.6),
        style: { top: `${row.offsetTop}px`, height: `${row.offsetHeight}px`, [side]: '0' },
      });
      row.parentElement.append(sw.hint);
    }
    return sw.hint;
  }

  function reset(animated) {
    sw?.hint?.remove();
    if (animated) {
      row.style.transition = 'transform 0.16s ease';
      setTimeout(() => { row.style.transition = ''; }, 200);
    }
    row.style.transform = '';
    row.classList.remove('swiping');
    sw = null;
  }

  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || sw) return;
    sw = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false, dx: 0, hint: null };
  });

  row.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    // A long-press lift (drag reorder) owns this pointer now; the same
    // horizontal move must not also swipe-complete or open the menu.
    if (document.body.classList.contains('sorting')) { reset(false); return; }
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (!sw.active) {
      if (Math.abs(dy) > 12) { sw = null; return; } // scrolling
      if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      sw.active = true;
      row.classList.add('swiping');
    }
    sw.dx = Math.max(-96, Math.min(96, dx));
    row.style.transform = `translateX(${sw.dx}px)`;
    const hint = hintFor(sw.dx);
    hint.style.width = `${Math.abs(sw.dx)}px`;
    hint.classList.toggle('armed', Math.abs(sw.dx) >= SWIPE_COMMIT);
  });

  const finish = (commit) => (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const { active, dx } = sw;
    reset(true);
    if (!active) return;
    // Trigger the action first (its synthetic click must not be swallowed)…
    if (commit && Math.abs(dx) >= SWIPE_COMMIT) {
      if (dx > 0) check.click();
      else if (rowActions?.length) openRowMenu(task, rowActions);
    }
    // …then eat the browser's trailing tap-click so the edit form stays shut.
    const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    row.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => row.removeEventListener('click', swallow, { capture: true }), 150);
  };

  row.addEventListener('pointerup', finish(true));
  row.addEventListener('pointercancel', finish(false));
  row.addEventListener('touchmove', (e) => {
    if (sw?.active) e.preventDefault();
  }, { passive: false });
}

/** A card full of task rows, or an empty-state node. */
export function taskCard(tasks, opts = {}) {
  if (!tasks.length) return null;
  return el('div.card', {}, tasks.map((t) => taskRow(t, opts)));
}
