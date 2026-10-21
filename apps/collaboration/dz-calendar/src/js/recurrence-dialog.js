/**
 * Two small nested dialogs used by the event editor:
 *
 *  - `openCustomRecurrence` — the "Custom recurrence" builder (repeat every N
 *    days/weeks/months/years, weekday picker, end condition).
 *  - `openScopeDialog` — the "This / this-and-following / all" chooser shown
 *    when saving or deleting an occurrence of a recurring series.
 *
 * Both render above the event modal, trap focus, and close on Escape or a
 * backdrop click. They resolve through a callback rather than returning a
 * promise so the calling code stays synchronous and easy to follow.
 */
import { el } from './dom.js';
import { icon } from './icons.js';
import { ownsEscape } from './time-field.js';
import {
  toDateInputValue,
  fromDateTimeInputs,
  endOfDay,
  addWeeks,
  daysInMonth,
  orderedWeekdays,
  WEEKDAYS_NARROW,
  WEEKDAYS_LONG,
} from './date-utils.js';

const UNITS = [
  { unit: 'day', freq: 'daily', label: 'day' },
  { unit: 'week', freq: 'weekly', label: 'week' },
  { unit: 'month', freq: 'monthly', label: 'month' },
  { unit: 'year', freq: 'yearly', label: 'year' },
];

/** Mount a dialog node inside a focus-trapping scrim; returns a close fn. */
export function mountDialog(dialog, onClose) {
  const lastFocused = document.activeElement;
  const scrim = el('div', { class: 'modal-scrim dialog-scrim' }, [dialog]);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    onClose && onClose();
  }

  function onKey(e) {
    // Dialogs stack (the booking editor mounts its delete confirm above
    // itself), and every mount adds its own document-level listener —
    // stopPropagation can't silence a sibling listener on the same node, so
    // without this guard one Escape would close the entire stack. Scrims
    // append to <body> in mount order: only the last one may act.
    const scrims = document.querySelectorAll('.dialog-scrim');
    if (scrims[scrims.length - 1] !== scrim) return;
    // Mid-IME composition, Escape cancels the candidate being composed (a
    // category name, a booking page title), not the dialog around it.
    if (e.isComposing || e.keyCode === 229) return;
    // A combobox with its list open (the booking editor's time fields) owns
    // Escape: it closes the list, not the dialog. This runs in the capture
    // phase, ahead of the field's own handler, so it must step aside here.
    if (e.key === 'Escape' && ownsEscape(e.target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [
      ...dialog.querySelectorAll(
        'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    // A radio group is ONE tab stop, and the browser lands on its checked
    // member. The scope chooser opens with its radios first: with "This and
    // following" checked, the active element was not `first`, Shift+Tab was
    // let through, and native navigation walked out of the dialog to the
    // editor's Save button behind the scrim — where Enter submitted the editor
    // again and stacked a second chooser.
    const active = document.activeElement;
    const sameStop = (a, b) =>
      a === b || (a.type === 'radio' && b.type === 'radio' && Boolean(a.name) && a.name === b.name);
    const stopFor = (n) =>
      n.type === 'radio' ? items.find((m) => m.type === 'radio' && m.name === n.name && m.checked) || n : n;
    if (!dialog.contains(active)) {
      // Focus fell out of the dialog (a click on its padding blurs to <body>);
      // the next Tab would walk the page behind the scrim. Pull it back in.
      e.preventDefault();
      stopFor(e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && sameStop(active, first)) {
      e.preventDefault();
      stopFor(last).focus();
    } else if (!e.shiftKey && sameStop(active, last)) {
      e.preventDefault();
      stopFor(first).focus();
    }
  }

  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  return close;
}

/**
 * Open the custom-recurrence builder.
 * @param {object}   opts
 * @param {object|null} opts.rule       current rule (for editing) or null
 * @param {number}   opts.startMs        the event's start (anchors defaults)
 * @param {number}   [opts.anchorMs=startMs]  the SERIES anchor: the earliest
 *   instant "Ends on" may bound. For a plain/new event this is the start
 *   itself; when editing a series occurrence it must be the master's first
 *   occurrence — an "Ends on" before the *displayed* occurrence legitimately
 *   shortens the series, and clamping to it would silently keep months of
 *   occurrences the user asked to remove.
 * @param {number}   opts.weekStartsOn   0=Sun, 1=Mon (weekday order)
 * @param {(rule:object)=>void} opts.onDone   called with the built rule
 */
export function openCustomRecurrence({ rule, startMs, anchorMs = startMs, weekStartsOn = 0, onDone }) {
  const start = new Date(startMs);
  const anchor = new Date(anchorMs);
  let unit = UNITS.find((u) => u.freq === (rule && rule.freq))?.unit || 'week';
  const selectedDays = new Set(
    rule && Array.isArray(rule.byWeekday) && rule.byWeekday.length
      ? rule.byWeekday
      : [start.getDay()],
  );

  // ---- Repeat every N [unit] ----
  const intervalInput = el('input', {
    class: 'input rr-num',
    type: 'number',
    min: '1',
    max: '999',
    value: String(rule && rule.interval > 1 ? rule.interval : 1),
    'aria-label': 'Repeat interval',
  });
  const unitSelect = el('select', { class: 'select rr-unit', 'aria-label': 'Repeat unit' });
  UNITS.forEach((u) => {
    const opt = el('option', { value: u.unit, text: u.label });
    if (u.unit === unit) opt.selected = true;
    unitSelect.append(opt);
  });

  // ---- Repeat on (weekday circles) ----
  const dayRow = el('div', { class: 'rr-weekdays', role: 'group', 'aria-label': 'Repeat on' });
  orderedWeekdays(weekStartsOn).forEach((idx) => {
    const btn = el('button', {
      class: 'rr-weekday',
      type: 'button',
      text: WEEKDAYS_NARROW[idx],
      'aria-label': WEEKDAYS_LONG[idx],
      'aria-pressed': String(selectedDays.has(idx)),
      on: {
        click: () => {
          selectedDays.has(idx) ? selectedDays.delete(idx) : selectedDays.add(idx);
          if (selectedDays.size === 0) selectedDays.add(idx); // keep at least one
          btn.setAttribute('aria-pressed', String(selectedDays.has(idx)));
          syncDayStates();
        },
      },
    });
    btn.dataset.day = String(idx);
    dayRow.append(btn);
  });
  const dayField = el('div', { class: 'field rr-on' }, [
    el('span', { class: 'field__label', text: 'Repeat on' }),
    dayRow,
  ]);
  function syncDayStates() {
    dayRow.querySelectorAll('.rr-weekday').forEach((b) => {
      b.setAttribute('aria-pressed', String(selectedDays.has(Number(b.dataset.day))));
    });
  }

  // ---- Monthly mode (by date vs by weekday vs last weekday) ----
  // An incoming explicit ordinal (1..5) shows and round-trips as-is; -1 ("the
  // last …", e.g. an imported BYDAY=-1FR) selects the dedicated last option.
  const incomingNth =
    rule &&
    rule.monthlyMode === 'weekday' &&
    Number.isInteger(rule.monthlyNth) &&
    rule.monthlyNth >= 1 &&
    rule.monthlyNth <= 5
      ? rule.monthlyNth
      : null;
  const startIsLastOfWeekday = start.getDate() + 7 > daysInMonth(start.getFullYear(), start.getMonth());
  const monthlySelect = el('select', { class: 'select', 'aria-label': 'Monthly repeat mode' });
  monthlySelect.append(
    el('option', { value: 'date', text: `Monthly on day ${start.getDate()}` }),
  );
  monthlySelect.append(el('option', { value: 'weekday', text: monthlyWeekdayLabel(start, incomingNth) }));
  if (startIsLastOfWeekday || (rule && rule.monthlyNth === -1)) {
    monthlySelect.append(
      el('option', { value: 'weekday-last', text: `Monthly on the last ${WEEKDAYS_LONG[start.getDay()]}` }),
    );
  }
  if (rule && rule.monthlyMode === 'weekday') {
    monthlySelect.value = rule.monthlyNth === -1 ? 'weekday-last' : 'weekday';
  }
  const monthlyField = el('div', { class: 'field rr-monthly' }, [monthlySelect]);

  // ---- Ends ----
  const defaultUntil = rule && rule.until ? new Date(rule.until) : addWeeks(start, 13);
  const endsMode = rule && rule.count != null ? 'after' : rule && rule.until != null ? 'on' : 'never';

  const untilInput = el('input', {
    class: 'input',
    type: 'date',
    value: toDateInputValue(defaultUntil),
    // An "Ends on" date before the series' first occurrence would leave it
    // with zero occurrences — the event would vanish from every view. Keep
    // the picker from offering such dates (buildRule clamps typed ones).
    min: toDateInputValue(anchor),
    'aria-label': 'End date',
  });
  const countInput = el('input', {
    class: 'input rr-num',
    type: 'number',
    min: '1',
    max: '999',
    value: String(rule && rule.count != null ? rule.count : 13),
    'aria-label': 'Number of occurrences',
  });

  const radios = {};
  function endsRadio(value, labelNode) {
    const input = el('input', { type: 'radio', name: 'rr-ends', value });
    if (value === endsMode) input.checked = true;
    input.addEventListener('change', syncEnds);
    radios[value] = input;
    return el('label', { class: 'rr-ends-row' }, [input, labelNode]);
  }
  const endsField = el('div', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Ends' }),
    endsRadio('never', el('span', { text: 'Never' })),
    endsRadio('on', el('span', { class: 'rr-ends-line' }, [el('span', { text: 'On' }), untilInput])),
    endsRadio(
      'after',
      el('span', { class: 'rr-ends-line' }, [
        el('span', { text: 'After' }),
        countInput,
        el('span', { class: 'muted', text: 'occurrences' }),
      ]),
    ),
  ]);
  function syncEnds() {
    untilInput.disabled = !radios.on.checked;
    countInput.disabled = !radios.after.checked;
  }

  // ---- Show/hide per unit ----
  function syncUnit() {
    unit = unitSelect.value;
    dayField.style.display = unit === 'week' ? '' : 'none';
    monthlyField.style.display = unit === 'month' ? '' : 'none';
  }
  unitSelect.addEventListener('change', syncUnit);

  const dialog = el('form', {
    class: 'modal rr-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'rr-title',
  }, [
    el('div', { class: 'modal__head' }, [
      el('h2', { class: 'modal__title', id: 'rr-title', text: 'Custom recurrence' }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Close',
        html: icon('close'),
        on: { click: () => close() },
      }),
    ]),
    el('div', { class: 'modal__body' }, [
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Repeat every' }),
        el('div', { class: 'rr-every' }, [intervalInput, unitSelect]),
      ]),
      dayField,
      monthlyField,
      endsField,
    ]),
    el('div', { class: 'modal__foot' }, [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => close() } }),
      el('button', { class: 'btn btn--primary', type: 'submit', text: 'Done' }),
    ]),
  ]);

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    onDone(buildRule());
    close();
  });

  function buildRule() {
    const spec = UNITS.find((u) => u.unit === unitSelect.value);
    let interval = Math.round(Number(intervalInput.value));
    if (!Number.isFinite(interval) || interval < 1) interval = 1;

    const built = { freq: spec.freq, interval };
    if (spec.freq === 'weekly') {
      built.byWeekday = [...selectedDays].sort((a, b) => a - b);
      // Keep an imported week-start anchor so a no-op round-trip can't shift
      // the week parity of an every-N-weeks series.
      if (rule && rule.freq === 'weekly' && Number.isInteger(rule.wkst) && rule.wkst >= 1 && rule.wkst <= 6) {
        built.wkst = rule.wkst;
      }
    }
    if (spec.freq === 'monthly') {
      built.monthlyMode = monthlySelect.value === 'date' ? 'date' : 'weekday';
      if (monthlySelect.value === 'weekday-last') built.monthlyNth = -1;
      // Keep a foreign explicit ordinal so a no-op round-trip stays a no-op.
      else if (monthlySelect.value === 'weekday' && incomingNth != null) built.monthlyNth = incomingNth;
    }

    if (radios.on.checked) {
      // A blank/invalid "On" date would parse to NaN and be silently dropped,
      // turning a bounded series into a never-ending one. Fall back to the
      // default end date so "ends on a date" always stays bounded.
      const parsed = fromDateTimeInputs(untilInput.value, '00:00');
      const base = Number.isNaN(parsed.getTime()) ? addWeeks(start, 13) : parsed;
      let until = endOfDay(base).getTime();
      // A typed date before the series anchor (the picker's min blocks picking
      // one) would bound the series before its first occurrence — zero
      // occurrences, an event that vanishes from every view. Clamp to the
      // anchor's own day. Dates between the anchor and the occurrence being
      // edited pass through: they legitimately shorten the series.
      if (until < anchorMs) until = endOfDay(anchor).getTime();
      built.until = until;
    } else if (radios.after.checked) {
      let count = Math.round(Number(countInput.value));
      if (!Number.isFinite(count) || count < 1) count = 1;
      built.count = count;
    }
    return built;
  }

  const close = mountDialog(dialog);
  syncUnit();
  syncEnds();
  requestAnimationFrame(() => intervalInput.focus());
}

function monthlyWeekdayLabel(start, explicitNth = null) {
  const nth = explicitNth != null ? explicitNth : Math.ceil(start.getDate() / 7);
  const ord = ['first', 'second', 'third', 'fourth', 'fifth'][nth - 1] || `${nth}th`;
  return `Monthly on the ${ord} ${WEEKDAYS_LONG[start.getDay()]}`;
}

const SCOPE_OPTIONS = [
  { value: 'one', label: 'This event' },
  { value: 'future', label: 'This and following events' },
  { value: 'all', label: 'All events' },
];

/**
 * Open the recurring edit/delete scope chooser.
 * @param {object} opts
 * @param {'edit'|'delete'} opts.mode
 * @param {boolean} [opts.allowOne=true]  offer the "This event" scope — pass
 *   false when the change can't apply to a single occurrence (a Repeat-rule
 *   change, which a per-occurrence override can't carry)
 * @param {(scope:'one'|'future'|'all')=>void} opts.onConfirm
 */
export function openScopeDialog({ mode = 'edit', allowOne = true, onConfirm }) {
  const options = allowOne ? SCOPE_OPTIONS : SCOPE_OPTIONS.filter((o) => o.value !== 'one');
  let selected = options[0].value;
  const title = mode === 'delete' ? 'Delete recurring event' : 'Edit recurring event';
  const confirmLabel = mode === 'delete' ? 'Delete' : 'OK';

  const list = el('div', { class: 'field', role: 'radiogroup', 'aria-label': title });
  options.forEach((opt, i) => {
    const input = el('input', { type: 'radio', name: 'rr-scope', value: opt.value });
    if (i === 0) input.checked = true;
    input.addEventListener('change', () => (selected = opt.value));
    list.append(el('label', { class: 'rr-ends-row' }, [input, el('span', { text: opt.label })]));
  });

  const dialog = el('form', {
    class: 'modal rr-modal rr-scope',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'rr-scope-title',
  }, [
    el('div', { class: 'modal__head' }, [
      el('h2', { class: 'modal__title', id: 'rr-scope-title', text: title }),
    ]),
    el('div', { class: 'modal__body' }, [list]),
    el('div', { class: 'modal__foot' }, [
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => close() } }),
      el('button', {
        class: `btn ${mode === 'delete' ? 'btn--danger' : 'btn--primary'}`,
        type: 'submit',
        text: confirmLabel,
      }),
    ]),
  ]);

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    const scope = selected;
    close();
    onConfirm(scope);
  });

  const close = mountDialog(dialog);
  requestAnimationFrame(() => dialog.querySelector('input[type="radio"]').focus());
}
