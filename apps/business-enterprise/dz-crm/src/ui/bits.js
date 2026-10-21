/** Small shared view pieces: page headers, empty states, stat tiles, badges, rows. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { maybeNudgeNextStep } from './nudge.js';
import { store, activityTypeInfo, repeatLabel } from '../lib/store.js';
import { stageInfo, openStages, isTerminalStage } from '../lib/forecast.js';
import {
  initials, dueLabel, formatDate, formatMoney, formatClock, todayISO, addDays,
} from '../lib/util.js';

/**
 * Page title plus its actions. The search button rides along on every page
 * (mobile only - the sidebar carries it on desktop) and asks for the
 * palette by event, so this module never has to import it.
 */
export function pageHead(title, ...actions) {
  return el('header.page-head', {},
    el('h1.page-title', {}, title),
    el('div.page-actions', {},
      el('button.icon-btn.page-search', {
        type: 'button',
        html: icon('search', 20, 2),
        'aria-label': 'Search everything',
        'aria-haspopup': 'dialog',
        onclick: () => document.dispatchEvent(new Event('crm:search')),
      }),
      actions)
  );
}

/**
 * Marks a label whose control a form won't submit without. Which one or two
 * of a dozen fields those are is worth knowing before the browser refuses,
 * and the CSV import wizard already said so with this asterisk while every
 * entity form left it to be discovered on submit.
 *
 * Hidden from assistive tech: the control's own `required` already
 * announces it, and "Name star" is not the name of a field.
 */
export function requiredMark() {
  return el('span.field-required', { 'aria-hidden': 'true', title: 'Required' }, ' *');
}

export function emptyState({ icon: name = 'inbox', title, message, action = null }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(name, 28) }),
    el('h3', {}, title),
    message && el('p', {}, message),
    action
  );
}

/**
 * Stat tile per the dataviz contract: label, compact value, optional
 * delta/sub line. Delta color = direction x whether up is good.
 * `progress` ({ pct, tone, label }) adds a meter under the value - the
 * tile becomes "how far along", not just "how much".
 */
export function statTile({ label, value, sub = null, delta = null, progress = null }) {
  return el('div.stat-tile', {},
    el('div.stat-label', {}, label),
    el('div.stat-value', {}, value),
    progress && el('div.stat-meter', {
      role: 'img', 'aria-label': progress.label || `${Math.round(progress.pct * 100)}%`,
    },
      el('div.stat-meter-fill', {
        className: `stat-meter-fill${progress.tone ? ` ${progress.tone}` : ''}`,
        style: { width: `${Math.min(100, Math.max(0, progress.pct * 100))}%` },
      })),
    delta
      ? el('div', { className: `stat-delta ${delta.good ? 'good' : 'bad'}` },
          el('span', { html: icon(delta.good ? 'trendUp' : 'trendDown', 14, 2.2) }),
          el('span', {}, delta.text))
      : sub && el('div.stat-sub', {}, sub)
  );
}

export function avatar(name, size = '') {
  return el(`span.avatar${size ? `.${size}` : ''}`, { 'aria-hidden': 'true' }, initials(name));
}

/**
 * Position of a stage along the open-stage ramp, as the mix percentage the
 * dot's color-mix reads. Terminal stages carry their own status color, so
 * they get no mix at all. Works for any number of configured stages.
 */
export function stageRampStyle(stageId, stages = store.stages()) {
  if (isTerminalStage(stageId)) return null;
  const open = openStages(stages);
  const i = open.findIndex((s) => s.id === stageId);
  if (i < 0) return null;
  const pct = open.length > 1 ? 100 - (i / (open.length - 1)) * 100 : 100;
  return { '--stage-mix': `${Math.round(pct)}%` };
}

/** "contract-sent" → "Contract sent", for stages history outlived. */
function prettyStageId(stageId) {
  const words = String(stageId || '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown stage';
}

/**
 * Stage identity: an ordinal-ramp dot beside the label - never color alone.
 * A stage the funnel no longer has (an old history entry) keeps its own
 * name in a muted badge rather than borrowing the first stage's.
 */
export function stageBadge(stageId, stages = store.stages()) {
  const known = stages.some((s) => s.id === stageId);
  if (!known) {
    return el('span.stage-badge.gone', {},
      el('span.stage-dot', { 'aria-hidden': 'true' }), prettyStageId(stageId));
  }
  const s = stageInfo(stageId, stages);
  return el('span.stage-badge', {
    dataset: { stage: s.id },
    style: stageRampStyle(s.id, stages),
  },
    el('span.stage-dot', { 'aria-hidden': 'true' }),
    s.label
  );
}

/**
 * Due date pill for a follow-up; carries urgency in text and tone. A due
 * time rides along, since "today" and "today at 2pm" are different jobs.
 */
export function duePill(iso, time = '') {
  const { text, status } = dueLabel(iso);
  return el('span.due-pill', { dataset: { status } },
    status === 'overdue' && el('span', { html: icon('alert', 13, 2.2), 'aria-hidden': 'true' }),
    time ? `${text} · ${formatClock(time)}` : text
  );
}

/** Small link chip to a contact/company/deal detail page. */
export function chip(href, iconName, label) {
  return el('a.chip', { href },
    el('span', { html: icon(iconName, 13, 2), 'aria-hidden': 'true' }),
    el('span.chip-label', {}, label)
  );
}

export function contactChip(contactId) {
  const c = store.contactById(contactId);
  return c ? chip(`#/leads?id=${c.id}`, 'user', c.name) : null;
}

export function companyChip(companyId) {
  const c = store.companyById(companyId);
  return c ? chip(`#/companies?id=${c.id}`, 'company', c.name) : null;
}

export function dealChip(dealId) {
  const d = store.dealById(dealId);
  return d ? chip(`#/pipeline?id=${d.id}`, 'deal', d.name) : null;
}

/**
 * One activity in a history timeline. `context` names the page it sits on
 * so its own chip is dropped (a deal page needn't link every row back to
 * itself).
 */
export function activityRow(activity, { context = {}, onEdit = null } = {}) {
  const type = activityTypeInfo(activity.type);
  return el('div.activity-row', {},
    el('div.activity-icon', { html: icon(type.icon, 16, 2), title: type.label }),
    el('div.activity-body', {},
      el('div.activity-head', {},
        el('span.activity-summary', {}, activity.summary),
        el('span.activity-date', {}, formatDate(activity.date))
      ),
      activity.notes && el('p.activity-notes', {}, activity.notes),
      el('div.chip-row', {},
        context.contactId !== activity.contactId && contactChip(activity.contactId),
        context.dealId !== activity.dealId && dealChip(activity.dealId),
        !activity.contactId && context.companyId !== activity.companyId && companyChip(activity.companyId)
      )
    ),
    onEdit && el('button.icon-btn.row-edit', {
      html: icon('pencil', 15, 2), 'aria-label': `Edit activity: ${activity.summary}`,
      dataset: { focusKey: `activity-edit-${activity.id}` },
      onclick: () => onEdit(activity),
    })
  );
}

/**
 * Move a follow-up's date without pretending the work happened or opening
 * the whole edit form.
 *
 * Two jobs, one sheet: snoozing something overdue (the default - it can
 * only go forwards, since making it *more* overdue is never what was
 * meant) and rescheduling anything at all from the calendar, where a
 * follow-up can legitimately be pulled forward as well as pushed back.
 */
export function openSnoozeSheet(task, {
  title = 'Snooze follow-up',
  verb = 'Snoozed',
  action = 'Snooze',
  earliest = todayISO(),
} = {}) {
  const today = todayISO();
  const prev = { due: task.due, dueTime: task.dueTime };

  const apply = async (due) => {
    modal.close();
    try {
      await store.updateTask(task.id, { due });
    } catch {
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      return;
    }
    toast(`${verb} to ${formatDate(due)}`, {
      icon: 'snooze',
      action: {
        label: 'Undo',
        onClick: () => store.updateTask(task.id, prev)
          .catch(() => toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' })),
      },
    });
  };

  const option = (label, due) => el('button.settings-row', {
    type: 'button',
    onclick: () => apply(due),
  },
    el('span.row-ic', { html: icon('snooze', 20, 1.8) }),
    el('div.grow', {},
      el('div.title', {}, label),
      el('div.sub', {}, formatDate(due))
    ),
    el('span.row-chev', { html: icon('chevR', 18) })
  );

  // `min` binds the date picker but not the keyboard: a typed 2026-07-01 is
  // still readable from .value. This sheet is not a <form>, so nothing was
  // checking it, and snoozing to a past date left the follow-up more overdue
  // than it started under a toast reading "Snoozed to Jul 1". `required`
  // covers a field cleared to empty. reportValidity() below says which.
  const dateInput = el('input.input', {
    type: 'date', value: addDays(today, 1), min: earliest || null, required: true,
    'aria-label': `${action} until`,
  });

  const modal = openModal({
    title,
    content: el('div', {},
      el('p.settings-note.sheet-note', {}, task.title),
      el('div.settings-list', {},
        option('Tomorrow', addDays(today, 1)),
        option('Next week', addDays(today, 7))
      ),
      el('div.settings-body', {},
        el('div.snooze-pick', {},
          dateInput,
          el('button.btn.btn-primary', {
            type: 'button',
            onclick: () => { if (dateInput.reportValidity()) apply(dateInput.value); },
          }, action)
        )
      )
    ),
  });
  return modal;
}

/** The calendar's move: any day, forwards or back, with one Undo. */
export function openRescheduleSheet(task) {
  return openSnoozeSheet(task, {
    title: 'Move follow-up',
    verb: 'Moved',
    action: 'Move',
    // No floor: on a calendar, pulling something forward is as ordinary as
    // pushing it back, and the day the user aimed at is the day they meant.
    earliest: '',
  });
}

/** One follow-up row: toggle, title, due pill, snooze, link chips. */
export function taskRow(task, { context = {}, onEdit = null } = {}) {
  const box = el('button.task-check', {
    role: 'checkbox',
    'aria-checked': String(task.done),
    'aria-label': `Done: ${task.title}`,
    // Keyed by the follow-up, not its title. Completing a repeating one
    // mints the next occurrence under the same title, and the rebuilt page
    // put the keyboard on the first match in document order - the new one,
    // sitting in Upcoming, a month out and unchecked. One more Space and
    // the founder ticked off a follow-up that wasn't due yet, minting
    // another. See focusSelector in ui/dom.js.
    dataset: { focusKey: `task-done-${task.id}` },
    html: task.done ? icon('check', 14, 3) : '',
    onclick: async () => {
      try {
        const saved = await store.toggleTask(task.id, !task.done);
        // A repeating follow-up just minted its next occurrence - say so,
        // or the cadence continues invisibly. A one-shot one leaves its
        // record with nothing booked, which is the moment to fix that.
        if (saved?.done && saved.spawnedId) {
          const next = store.tasks.find((t) => t.id === saved.spawnedId);
          if (next) toast(`Done · next one ${formatDate(next.due)}`, { icon: 'repeat' });
        } else if (saved?.done) {
          maybeNudgeNextStep({
            contactId: saved.contactId, dealId: saved.dealId,
            title: saved.title, lead: 'Done',
          });
        }
      } catch {
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  });
  const snoozable = !task.done && task.due <= todayISO();
  /* A playbook step that named an email: the row offers to write it, with
     that template already chosen. Loaded on demand - email.js imports its
     way back here. */
  const emailContact = task.templateId && !task.done
    ? store.contactById(task.contactId) || store.contactById(store.dealById(task.dealId)?.contactId)
    : null;
  const template = task.templateId ? store.templateById(task.templateId) : null;
  return el('div', { className: `task-row${task.done ? ' done' : ''}` },
    box,
    el('div.task-body', {},
      el('span.task-title', {}, task.title),
      el('div.chip-row', {},
        context.contactId !== task.contactId && contactChip(task.contactId),
        context.dealId !== task.dealId && dealChip(task.dealId)
      )
    ),
    task.repeat && el('span.repeat-pill', { title: repeatLabel(task.repeat) },
      el('span', { html: icon('repeat', 12, 2.2), 'aria-hidden': 'true' }),
      el('span.sr-only', {}, `Repeats: ${repeatLabel(task.repeat)}`)
    ),
    !task.done && duePill(task.due, task.dueTime),
    emailContact?.email && template && el('button.icon-btn.row-edit', {
      html: icon('mail', 15, 2),
      'aria-label': `Write “${template.name}” to ${emailContact.name}`,
      title: `Write “${template.name}”`,
      'aria-haspopup': 'dialog',
      dataset: { focusKey: `task-email-${task.id}` },
      onclick: async () => {
        const { openEmailFlow } = await import('./email.js');
        openEmailFlow({
          contact: emailContact,
          deal: store.dealById(task.dealId),
          template,
        });
      },
    }),
    snoozable && el('button.icon-btn.row-edit', {
      html: icon('snooze', 15, 2), 'aria-label': `Snooze: ${task.title}`,
      'aria-haspopup': 'dialog',
      dataset: { focusKey: `task-snooze-${task.id}` },
      onclick: () => openSnoozeSheet(task),
    }),
    onEdit && el('button.icon-btn.row-edit', {
      html: icon('pencil', 15, 2), 'aria-label': `Edit follow-up: ${task.title}`,
      dataset: { focusKey: `task-edit-${task.id}` },
      onclick: () => onEdit(task),
    })
  );
}

export function searchBox({ placeholder, oninput, value = '' }) {
  const input = el('input.input.search-input', {
    type: 'search', placeholder, value, 'aria-label': placeholder, oninput,
  });
  return el('div.search-box', { html: icon('search', 16, 2) }, input);
}

/** Section card with a title row and optional action. */
export function section(title, action, ...children) {
  return el('section.card', {},
    el('div.card-head', {},
      el('h2.card-title', {}, title),
      action
    ),
    ...children
  );
}

export function moneyText(amount) {
  return formatMoney(amount, store.settings.currency);
}

/**
 * Confirmation copy plus the Undo toast every delete now gets: the record
 * sits in the trash for 30 days, so "gone" is a decision the user can walk
 * back for the length of a toast - or a month, from Settings.
 */
export function deletedToast(message, entry) {
  toast(message, {
    icon: 'trash',
    action: entry && {
      label: 'Undo',
      onClick: () => store.restoreTrash(entry.id)
        .catch(() => toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' })),
    },
  });
}
