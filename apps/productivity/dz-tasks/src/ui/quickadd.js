import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { parseQuickAdd } from '../lib/quickparse.js';
import { relativeDue, fmtTime } from '../lib/dates.js';
import { describeRule } from '../lib/recur.js';
import { openTaskForm } from './taskform.js';

/**
 * Inline capture bar: one line, parsed as you type ("pay rent friday 9am
 * every month !high #home"). Parsed pieces show as removable chips below —
 * dismissing one returns its text to the title. Enter adds and keeps focus
 * for the next task; "More options" hands the parsed draft to the full form.
 */
export function quickAddBar({ listId = null, defaultDue = null } = {}) {
  const ignore = new Set();
  let parsed = null;

  // Dismissed chips live on the node, not just in this closure: a
  // same-route re-render replaces the bar and restores the draft, and a
  // chip the user explicitly dismissed must not come back with it.
  const input = el('input.input', {
    id: 'quick-add-input',
    placeholder: 'Add a task… try “pay rent tomorrow 9am !high”',
    'aria-label': 'Add a task',
    maxlength: 300,
    oninput: renderChips,
    onkeydown: (e) => {
      // isComposing: an IME's confirm-candidate Enter must not add the task
      // with the half-composed text.
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); }
      if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; renderChips(); }
    },
  });

  // Chips are interactive, so they must not live inside a live region — a
  // region rebuilt on every keystroke would re-announce every chip each
  // character. A hidden status node announces the parse summary instead,
  // and only when it actually changes.
  const chipRow = el('div.quick-add-chips');
  const announcer = el('span.visually-hidden', { role: 'status' });
  let lastAnnounced = '';
  const moreBtn = el('button.icon-btn', {
    html: icon('pencil', 16), 'aria-label': 'More options',
    title: 'Open in the full form',
    onclick: () => {
      const d = current();
      openTaskForm({
        listId: d.listId,
        prefill: {
          title: d.title, due: d.due, dueTime: d.dueTime,
          priority: d.priority, repeat: d.repeat, tags: d.tags, listId: d.listId,
        },
      });
      input.value = '';
      renderChips();
    },
  });

  input.dismissedChips = ignore;

  function current() {
    parsed = parseQuickAdd(input.value, {
      lists: store.lists,
      ignore,
      startMonday: store.settings.startMonday !== false,
    });
    return {
      ...parsed,
      listId: parsed.listId || listId || undefined,
      due: parsed.due || (parsed.tokens.some((t) => t.type === 'due') ? parsed.due : defaultDue),
    };
  }

  function chipLabel(t, d) {
    if (t.type === 'due') return `${relativeDue(d.due)}${d.dueTime ? ' · ' + fmtTime(d.dueTime) : ''}`;
    if (t.type === 'time' && !d.tokens.some((x) => x.type === 'due')) {
      return `${relativeDue(d.due)} · ${fmtTime(d.dueTime)}`;
    }
    if (t.type === 'time') return null; // folded into the due chip
    if (t.type === 'repeat') return describeRule(d.repeat);
    if (t.type === 'priority') return `${t.label} priority`;
    if (t.type === 'list') return `List: ${t.label}`;
    return t.label;
  }

  function renderChips() {
    const d = current();
    clear(chipRow);
    if (!input.value.trim()) {
      ignore.clear();
      announcer.textContent = lastAnnounced = '';
      return;
    }
    // No date typed but the view supplies one (e.g. Today): say so.
    if (defaultDue && !d.tokens.some((t) => t.type === 'due' || t.type === 'time')) {
      chipRow.append(el('span.chip', {}, relativeDue(defaultDue)));
    }
    const labels = [];
    for (const t of d.tokens) {
      const label = chipLabel(t, d);
      if (!label) continue;
      labels.push(label);
      // The due chip displays date and time together, so dismissing it
      // must release both tokens — removing only the date would silently
      // re-anchor the parsed time to today.
      const timeToo = t.type === 'due' && d.tokens.some((x) => x.type === 'time');
      const keys = timeToo ? ['due', 'time'] : [t.key || t.type];
      const text = timeToo
        ? d.tokens.filter((x) => x.type === 'due' || x.type === 'time').map((x) => x.text).join(' ')
        : t.text;
      chipRow.append(el('span.chip.on', {},
        label,
        el('button.chip-x', {
          type: 'button', html: icon('x', 11, 3),
          'aria-label': `Remove ${label} and keep "${text}" as text`,
          onclick: () => {
            for (const k of keys) ignore.add(k);
            renderChips();
            // The dismissed chip took the focus with it; typing continues.
            input.focus();
          },
        })
      ));
    }
    const summary = labels.join(', ');
    if (summary !== lastAnnounced) {
      announcer.textContent = summary;
      lastAnnounced = summary;
    }
  }

  async function add() {
    const d = current();
    if (!d.title.trim()) {
      input.focus();
      return;
    }
    // Clear before the awaited save: the store emits its change (and the
    // shell re-renders, restoring any non-empty draft into the fresh bar)
    // before the network write resolves. Clearing afterwards resurrects
    // the text, and the next Enter would file the same task twice.
    const typed = input.value;
    input.value = '';
    renderChips();
    try {
      await store.addTask(d);
    } catch (err) {
      console.error(err);
      // A full cloud is the one failure the store reports while still
      // keeping (and queueing) the task: handing the text back here would
      // file it a second time.
      if (err?.quota) {
        toast(err.message, { icon: 'cloud', duration: 5000 });
      } else {
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
        // Nothing was saved; give the typed text back unless the user has
        // already started the next task in the meantime.
        const cur = document.getElementById('quick-add-input') || input;
        if (!cur.value) {
          cur.value = typed;
          cur.dispatchEvent(new Event('input'));
          cur.focus();
        }
        return;
      }
    }
    // The view re-renders (and replaces this bar) on the store change; put
    // the cursor back so several tasks can be typed in a row.
    setTimeout(() => document.getElementById('quick-add-input')?.focus(), 90);
  }

  return el('div.quick-add', {},
    el('div.quick-add-row', {},
      el('span.qa-icon', { html: icon('plus', 17, 2.4), 'aria-hidden': 'true' }),
      input,
      moreBtn
    ),
    chipRow,
    announcer
  );
}
