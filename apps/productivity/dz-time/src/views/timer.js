/** Home: the running timer, today's entries, and quick resume. */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { field, projectSelect, switchField } from '../ui/fields.js';
import { entryRow } from '../ui/entryrow.js';
import { openEntryForm } from '../ui/entryform.js';
import { targetStatTile, moneyValue } from '../ui/stats.js';
import { openTimerEdit } from '../ui/timeredit.js';
import { store } from '../lib/store.js';
import { fmtTimer, fmtClock, fmtDuration, todayISO, weekStartOf, addDays } from '../lib/time.js';

export function timerView() {
  const root = el('div.view');
  const timerCard = el('section.timer-card', { 'aria-label': 'Timer' });
  const statsRow = el('div.stat-row');
  const todayList = el('div');
  let tick = null;

  // Re-read on every render, not just at mount: the app can sit open past
  // midnight, and a heading naming the wrong day sits right above a list
  // headed "Today".
  const dateSub = el('p.page-sub', {}, todayHeading());

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Timer'),
        dateSub
      )
    ),
    timerCard,
    statsRow,
    todayList
  );

  function todayHeading() {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  }

  /* ---------- timer card ---------- */

  /* What has been entered into the idle form but not started yet. Any
     store change rebuilds this card (logging an entry from the FAB, an
     automatic backup, an undo), and rebuilding from scratch would throw
     a half-picked project and a half-typed task away. */
  const draft = { projectId: null, task: '', billable: null };

  function renderTimer() {
    clearInterval(tick);
    tick = null;
    clear(timerCard);
    if (store.running) renderRunning();
    else renderIdle();
  }

  function renderIdle() {
    timerCard.classList.remove('running');
    const hasProjects = store.activeProjects().length > 0;

    if (!hasProjects) {
      timerCard.append(
        el('div.timer-empty', {},
          el('div.empty-icon', { html: icon('folders', 26) }),
          el('p', {}, 'Set up a client and a project, then start tracking.'),
          el('a.btn.btn-primary', { href: '#/projects' }, 'Add a client')
        )
      );
      return;
    }

    const project = projectSelect(store, draft.projectId || lastProjectId());
    project.removeAttribute('required');
    const task = el('input.input', {
      type: 'text', value: draft.task, placeholder: 'What are you working on?',
      autocomplete: 'off', maxLength: 120, 'aria-label': 'Task',
      oninput: () => { draft.task = task.value; },
    });
    const billable = switchField('Billable', draft.billable ?? defaultBillable(project.value));
    billable.input.addEventListener('change', () => {
      draft.billable = billable.input.checked;
    });
    project.addEventListener('change', () => {
      draft.projectId = project.value;
      // A new project brings its own billable default, dropping whatever
      // the switch was set to for the previous one.
      draft.billable = null;
      billable.input.checked = defaultBillable(project.value);
    });

    const start = el('button.btn.btn-primary.btn-start', {
      type: 'submit',
      html: icon('play', 20, 2.2),
    }, ' Start');

    // A real form, so Enter in the task field starts the timer.
    timerCard.append(el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!project.value) {
          toast('Pick a project first', { icon: 'folders' });
          project.focus();
          return;
        }
        start.disabled = true;
        try {
          await store.startTimer({
            projectId: project.value,
            task: task.value,
            billable: billable.input.checked,
          });
          // The draft became a running timer; the next idle form starts clean.
          draft.projectId = null;
          draft.task = '';
          draft.billable = null;
        } catch (err) {
          console.error(err);
          start.disabled = false;
          toast('Could not start, check your connection', { icon: 'wifiOff' });
        }
      },
    },
      el('div.timer-idle-grid', {},
        field('Project', project),
        field('Task', task)
      ),
      el('div.timer-idle-foot', {}, billable, start)
    ));
  }

  function renderRunning() {
    timerCard.classList.add('running');
    const t = store.timer;
    const project = store.project(t.projectId);
    const client = store.client(project?.clientId);

    const clock = el('div.timer-clock', {
      role: 'timer', 'aria-label': 'Elapsed time',
    }, fmtTimer(store.elapsedSeconds()));

    const update = () => {
      clock.textContent = fmtTimer(store.elapsedSeconds());
    };
    update();
    tick = setInterval(update, 1000);

    const stop = el('button.btn.btn-primary.btn-stop', {
      html: icon('stop', 18, 2.4),
      onclick: async () => {
        stop.disabled = true;
        try {
          const entry = await store.stopTimer();
          toast(`Logged ${fmtClock(entry.seconds)}`, { icon: 'check' });
        } catch (err) {
          console.error(err);
          stop.disabled = false;
          toast('Could not stop, check your connection', { icon: 'wifiOff' });
        }
      },
    }, ' Stop');

    timerCard.append(
      el('div.timer-running-head', {},
        el('div.timer-live-dot', { 'aria-hidden': 'true' }),
        el('div.grow', {},
          el('div.timer-running-title', {},
            project?.name || 'No project',
            t.task && el('span.entry-task', {}, ` · ${t.task}`)
          ),
          el('div.timer-running-sub', {},
            client?.name || '',
            !t.billable && el('span.chip.chip-plain', {}, 'Non-billable')
          )
        ),
        el('button.icon-btn', {
          html: icon('pencil', 17, 2),
          'aria-label': 'Edit timer',
          title: 'Edit project, task, or start time',
          onclick: openTimerEdit,
        })
      ),
      clock,
      el('div.timer-running-actions', {},
        el('button.btn.btn-ghost', {
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Discard timer?',
              message: 'The elapsed time is thrown away without logging an entry.',
              confirmLabel: 'Discard',
            });
            if (ok) await store.discardTimer().catch(() => toast('Could not discard, check your connection', { icon: 'wifiOff' }));
          },
        }, 'Discard'),
        stop
      )
    );
  }

  function lastProjectId() {
    const active = store.activeProjects();
    return active.length === 1 ? active[0].id : null;
  }

  function defaultBillable(projectId) {
    const p = store.project(projectId);
    return p ? !!p.billable : true;
  }

  /* ---------- stats + today's list ---------- */

  /* Store changes can arrive while a render is still awaiting data (a stop
     emits twice: entry added, then timer cleared). Only the newest render
     may touch the DOM, and only after everything it needs is loaded, or
     interleaved renders duplicate sections. */
  let dataSeq = 0;

  async function renderData() {
    const seq = ++dataSeq;
    const today = todayISO();
    const weekStart = weekStartOf(today, store.settings.weekStart);
    const [todayEntries, weekEntries] = await Promise.all([
      store.entriesBetween(today, today),
      store.entriesBetween(weekStart, addDays(weekStart, 6)),
    ]);
    const recent = store.running ? [] : await store.recentWork(6);
    if (seq !== dataSeq) return;

    dateSub.textContent = todayHeading();
    const dayTotals = store.totals(todayEntries);
    const weekTotals = store.totals(weekEntries);

    clear(statsRow);
    const targetHours = Number(store.settings.weeklyTargetHours) || 0;
    const weekDone = store.settings.weeklyTargetKind === 'tracked'
      ? weekTotals.seconds
      : weekTotals.billableSeconds;
    statsRow.append(
      stat('Today', fmtDuration(dayTotals.seconds)),
      targetHours > 0
        ? targetStatTile('This week', weekDone, targetHours)
        : stat('This week', fmtDuration(weekTotals.seconds)),
      // Per-currency subtotals, side by side; never converted or summed.
      // "Billable" is a duration everywhere else in the app, so the money
      // tile is "Amount" here too, with its period spelled out because the
      // tiles beside it cover two different ones.
      stat('Amount', moneyValue(store.amountsByCurrency(weekEntries), store.settings.currency),
        'billable this week')
    );

    clear(todayList);
    todayList.append(el('h2.section-title', {}, 'Today'));
    if (!todayEntries.length) {
      todayList.append(el('div.empty.empty-slim', {},
        el('p', {}, 'Nothing logged yet today.'),
        store.activeProjects().length > 0 && el('button.btn.btn-ghost', {
          onclick: () => openEntryForm(),
        }, 'Log time manually')
      ));
    } else {
      // No resume button while a timer runs: it can only answer with "a
      // timer is already running", the same reason the quick-resume chips
      // below stay away until the timer stops.
      todayList.append(el('div.card.list-card', {},
        todayEntries.map((e) => entryRow(e, store.running ? {} : { onResume: resume }))));
    }

    // Quick resume: recent distinct work, minus what is already on screen.
    // A restored backup may carry entries without a task field.
    const sig = (e) => `${e.projectId} ${(e.task || '').toLowerCase()}`;
    const todaySigs = new Set(todayEntries.map(sig));
    const chips = recent.filter((e) => !todaySigs.has(sig(e)));
    if (chips.length) {
      todayList.append(
        el('h2.section-title', {}, 'Pick up where you left off'),
        el('div.chip-row', {}, chips.map((e) => {
          const p = store.project(e.projectId);
          const c = store.client(p?.clientId);
          return el('button.chip.chip-action', {
            onclick: () => resume(e),
          },
            el('span.color-dot', { style: { background: `var(--series-${c?.slot || 8})` }, 'aria-hidden': 'true' }),
            [p?.name, e.task].filter(Boolean).join(' · ')
          );
        }))
      );
    }
  }

  async function resume(entry) {
    if (store.running) {
      toast('A timer is already running', { icon: 'timer' });
      return;
    }
    try {
      await store.startTimer({
        projectId: entry.projectId,
        task: entry.task,
        billable: entry.billable,
      });
    } catch (err) {
      console.error(err);
      toast('Could not start, check your connection', { icon: 'wifiOff' });
    }
  }

  function stat(label, value, sub = null) {
    return el('div.stat-tile', {},
      el('div.stat-label', {}, label),
      el('div.stat-value', {}, value),
      sub && el('div.stat-sub', {}, sub)
    );
  }

  /* ---------- lifecycle ---------- */

  const onChange = () => {
    renderTimer();
    renderData().catch(console.error);
  };
  store.addEventListener('change', onChange);
  onChange();

  root.destroy = () => {
    clearInterval(tick);
    store.removeEventListener('change', onChange);
  };
  return root;
}
