import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { store } from '../lib/store.js';
import {
  openStages, isTerminalStage, MAX_OPEN_STAGES, DEFAULT_STALE_DAYS,
} from '../lib/forecast.js';
import { DEFAULT_COLD_DAYS } from '../lib/attention.js';
import { normalizeTouchTargets, touchTarget } from '../lib/activity.js';
import { aiAvailable } from '../lib/ai.js';
import { openOfflineSheet, kvLabel } from '../ui/offline.js';
import { ACTIVITY_TYPES } from '../lib/store.js';
import {
  CUSTOM_KINDS, FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_FIELD_NAME, MAX_FIELD_OPTIONS,
  MAX_OPTION_LENGTH, blankField, fieldTypeInfo, hasOptions, isBlankValue, retypeReport,
} from '../lib/fields.js';
import { notificationPermission, requestNotifications } from '../lib/reminders.js';
import { downloadOpenICS } from '../ui/calendar.js';
import { downloadFile, pickFile } from '../ui/download.js';
import { openCSVImport, openCSVExport } from '../ui/csv.js';
import { openDuplicatesReview } from '../ui/merge.js';
import { openTemplateForm } from '../ui/email.js';
import { openPlaybookForm } from '../ui/playbooks.js';
import { MAX_PLAYBOOKS, playbookSummary } from '../lib/playbooks.js';
import { deletedToast } from '../ui/bits.js';
import { listBackups, readBackup, writeBackup } from '../lib/backups.js';
import { formatBytes } from '../lib/files.js';
import { applyTheme } from '../ui/theme.js';
import { pageHead, section, stageBadge, stageRampStyle } from '../ui/bits.js';
import { sampleDataset } from '../lib/sample.js';
import { todayISO, clamp, formatMoney, timeAgo, formatDate } from '../lib/util.js';

export async function confirmSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'Your data stays safe in your Puter account and will be here when you sign back in.',
    confirmLabel: 'Sign out',
    danger: false,
  });
  if (!ok) return;
  // Let the SDK finish clearing the session before the reload re-runs the
  // auth check, or a raced reload can boot back into a half-signed-out state.
  try {
    await puter.auth.signOut();
  } catch {}
  location.reload();
}

const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const CURRENCIES = ['DZD', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY', 'BRL', 'CHF', 'SEK'];

export function settingsView() {
  const root = el('div.view');

  /* ----- appearance ----- */
  const themeGroup = el('div.seg-group', { role: 'group', 'aria-label': 'Theme' });
  function renderThemes() {
    clear(themeGroup);
    const current = store.settings.theme || 'system';
    for (const t of THEMES) {
      themeGroup.append(el('button.seg', {
        type: 'button',
        'aria-pressed': String(current === t.value),
        className: `seg${current === t.value ? ' active' : ''}`,
        html: icon(t.icon, 16, 2),
        onclick: (e) => {
          applyTheme(t.value);
          store.updateSettings({ theme: t.value })
            .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));
          // Move the highlight in place instead of rebuilding the group -
          // a rebuild drops keyboard focus on the floor mid-interaction.
          for (const b of e.currentTarget.parentElement.children) {
            const on = b === e.currentTarget;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          }
        },
      }, ` ${t.label}`));
    }
  }
  renderThemes();

  const currencySelect = el('select.select', {
    'aria-label': 'Currency',
    onchange: async (e) => {
      const saved = store.updateSettings({ currency: e.target.value });
      // The goal field spells the currency out beside the number; it has to
      // follow, not wait for a reload.
      syncCurrencyLabels();
      try {
        await saved;
      } catch {
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        return;
      }
      toast('Currency updated');
    },
  }, CURRENCIES.map((c) => el('option', { value: c, selected: c === store.settings.currency }, c)));

  /* Controls that mirror a settings value, so a bulk replace (import,
     snapshot restore) can pull the whole page back in step. */
  const settingsFields = [];

  /* ----- pipeline stages (order, names, win probabilities) ----- */
  const stageRows = el('div.stage-edit-list');

  /** The editable part of the funnel as a fresh, mutable copy. */
  const currentOpen = () => openStages(store.stages()).map((s) => ({ ...s }));

  /** Readable, collision-free id for a new stage ("Demo booked" → demo-booked). */
  function makeStageId(label, taken) {
    const base = String(label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
    let id = base;
    for (let n = 2; isTerminalStage(id) || taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** Persist a structural change, then rebuild the editor (focus restored). */
  async function saveStages(list, { remap = {}, focus = null, message = null } = {}) {
    try {
      const moved = await store.setStages(list, remap);
      renderStageRows(focus);
      if (message) toast(typeof message === 'function' ? message(moved) : message);
    } catch {
      renderStageRows(focus);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    }
  }

  /** Removing a stage that holds deals: pick where those deals land. */
  function askReassign(stage, count, targets) {
    return new Promise((resolve) => {
      let picked = null;
      const modal = openModal({
        title: `Remove ${stage.label}?`,
        content: el('div', {},
          el('p.confirm-message', {},
            `${count} deal${count === 1 ? '' : 's'} sit${count === 1 ? 's' : ''} in this stage. Choose the stage to move ${count === 1 ? 'it' : 'them'} to.`),
          el('div.settings-list', {}, targets.map((t) => el('button.settings-row', {
            type: 'button',
            onclick: () => { picked = t.id; modal.close(); },
          },
            stageBadge(t.id),
            el('div.grow'),
            el('span.row-chev', { html: icon('chevR', 18) })
          )))
        ),
        onClose: () => resolve(picked),
      });
    });
  }

  function renderStageRows(focus = null) {
    clear(stageRows);
    const open = currentOpen();
    const probs = store.settings.stageProbabilities || {};

    open.forEach((s, i) => {
      const override = probs[s.id];
      const pct = Math.round((Number.isFinite(override) ? override : s.probability) * 100);

      const name = el('input.input.stage-name-input', {
        type: 'text', value: s.label, maxlength: 40, autocomplete: 'off',
        'aria-label': `Stage ${i + 1} name`,
        onchange: () => {
          const label = name.value.trim();
          if (!label || label === s.label) { name.value = s.label; return; }
          const list = currentOpen();
          list[i].label = label;
          saveStages(list, { focus: { id: s.id, control: '.stage-name-input' } });
        },
      });

      const prob = el('input.input.prob-input', {
        // Whole percents, not fives. A coarser step reads as a spinner
        // nicety and lands as validation: this field exists to be tuned to
        // the conversion rate that actually emerged, so "43" is the whole
        // point of typing in it - and the browser called it invalid ("the
        // two nearest valid values are 40 and 45") about a number the app
        // then stored exactly as typed. Same trade the deal form's
        // confidence percent already makes.
        type: 'number', min: '0', max: '100', step: '1', value: String(pct),
        'aria-label': `${s.label} win probability, percent`,
        onchange: async () => {
          const v = clamp(Math.round(Number(prob.value) || 0), 0, 100);
          prob.value = String(v);
          await store.updateSettings({
            stageProbabilities: { ...store.settings.stageProbabilities, [s.id]: v / 100 },
          }).catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));
        },
      });

      const move = (dir) => el(`button.icon-btn.stage-move.stage-move-${dir > 0 ? 'down' : 'up'}`, {
        type: 'button',
        html: icon(dir > 0 ? 'chevD' : 'chevU', 17, 2.2),
        'aria-label': `Move ${s.label} ${dir > 0 ? 'later' : 'earlier'}`,
        disabled: dir > 0 ? i === open.length - 1 : i === 0,
        onclick: () => {
          const list = currentOpen();
          [list[i], list[i + dir]] = [list[i + dir], list[i]];
          // A stage that has just arrived at an end of the funnel has this
          // arrow disabled in its rebuilt row, so the keyboard falls back
          // to the one still pointing somewhere.
          saveStages(list, {
            focus: {
              id: s.id,
              control: `.stage-move-${dir > 0 ? 'down' : 'up'}`,
              orElse: [`.stage-move-${dir > 0 ? 'up' : 'down'}`],
            },
          });
        },
      });

      const remove = el('button.icon-btn.stage-remove', {
        type: 'button',
        html: icon('trash', 16, 2),
        'aria-label': `Remove stage ${s.label}`,
        disabled: open.length <= 1,
        title: open.length <= 1 ? 'A pipeline needs at least one open stage' : null,
        onclick: async () => {
          const held = store.deals.filter((d) => d.stage === s.id);
          const targets = open.filter((o) => o.id !== s.id);
          let remap = {};
          if (held.length) {
            const to = await askReassign(s, held.length, targets);
            if (!to) return;
            remap = { [s.id]: to };
          } else {
            const ok = await confirmDialog({
              title: `Remove ${s.label}?`,
              message: 'No deals are in this stage, so nothing moves. You can add it back later.',
              confirmLabel: 'Remove stage',
            });
            if (!ok) return;
          }
          await saveStages(targets, {
            remap,
            message: (moved) => moved
              ? `${s.label} removed · ${moved} deal${moved === 1 ? '' : 's'} moved`
              : `${s.label} removed`,
          });
        },
      });

      stageRows.append(el('div.stage-edit-row', {
        dataset: { stageId: s.id },
        style: stageRampStyle(s.id),
      },
        el('span.stage-dot.stage-edit-dot', { 'aria-hidden': 'true' }),
        name,
        el('div.stage-edit-controls', {},
          el('span.stage-prob-field', {}, prob, el('span.prob-unit', { 'aria-hidden': 'true' }, '%')),
          move(-1),
          move(1),
          remove
        )
      ));
    });

    /* Won and Lost are the funnel's terminals: shown, never editable. */
    stageRows.append(el('div.stage-edit-row.static', {},
      stageBadge('won'), el('div.grow'), el('span.prob-unit', {}, '100%')
    ));
    stageRows.append(el('div.stage-edit-row.static', {},
      stageBadge('lost'), el('div.grow'), el('span.prob-unit', {}, '0%')
    ));

    const atCap = open.length >= MAX_OPEN_STAGES;
    stageRows.append(el('div.stage-edit-actions', {},
      el('button.btn.btn-ghost.btn-sm.btn-dashed', {
        type: 'button',
        html: icon('plus', 14, 2.2),
        disabled: atCap,
        title: atCap ? `A board holds at most ${MAX_OPEN_STAGES} open stages` : null,
        onclick: () => {
          const list = currentOpen();
          const label = 'New stage';
          const id = makeStageId(label, new Set(list.map((x) => x.id)));
          list.push({ id, label, probability: 0.5 });
          // Land the caret in the new name so it can be typed over at once.
          saveStages(list, { focus: { id, control: '.stage-name-input', select: true } });
        },
      }, ' Add stage'),
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        html: icon('reset', 14, 2),
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Reset stages?',
            message: 'The default funnel (New, Qualified, Proposal, Negotiation) and default win probabilities come back. Deals in stages that no longer exist move to the first stage.',
            confirmLabel: 'Reset stages',
            danger: false,
          });
          if (!ok) return;
          await store.updateSettings({ stageProbabilities: {} }).catch(() => {});
          await saveStages(null, { message: 'Stages reset to defaults' });
        },
      }, ' Reset to defaults')
    ));

    if (focus) {
      const row = stageRows.querySelector(`[data-stage-id="${CSS.escape(focus.id)}"]`);
      // First control that is actually there and actually takes focus:
      // handing the keyboard to a disabled button hands it to the body.
      const target = [focus.control, ...(focus.orElse || [])]
        .map((sel) => row?.querySelector(sel))
        .find((node) => node && !node.disabled);
      if (target) {
        target.focus();
        if (focus.select) target.select?.();
      }
    }
  }
  renderStageRows();

  /* ----- custom fields ----------
     Definitions live in settings, values on the records (lib/fields.js).
     One record type is edited at a time, because a founder adds a field
     while thinking about one kind of record. */
  let fieldKind = CUSTOM_KINDS[0].key;
  const fieldKindGroup = el('div.seg-group', { role: 'group', 'aria-label': 'Fields for' });
  const fieldRows = el('div.stage-edit-list.field-edit-list');

  /** The current definitions as a fresh, mutable copy. */
  const currentFields = () => store.customFields(fieldKind)
    .map((f) => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) }));

  /** Records of the kind being edited - what a type change has to convert. */
  const fieldRecords = () => store[fieldKind] || [];

  /** How many records hold a value for a field. */
  const valueCount = (field) =>
    fieldRecords().filter((r) => !isBlankValue(r.custom?.[field.id])).length;

  async function saveFields(list, { focus = null, message = null } = {}) {
    try {
      const result = await store.setCustomFields(fieldKind, list);
      renderFieldRows(focus);
      if (message) toast(typeof message === 'function' ? message(result) : message);
    } catch (err) {
      renderFieldRows(focus);
      // The store refuses a type change it can't make without losing a
      // value; anything else is the connection.
      toast(err.message === 'custom-field-type'
        ? 'Some records hold a value that can’t be read as that type'
        : 'Couldn’t save. Check your connection',
      { icon: err.message === 'custom-field-type' ? 'alert' : 'wifiOff' });
    }
  }

  function renderFieldKinds() {
    clear(fieldKindGroup);
    for (const kind of CUSTOM_KINDS) {
      const on = kind.key === fieldKind;
      fieldKindGroup.append(el('button.seg', {
        type: 'button',
        className: `seg${on ? ' active' : ''}`,
        'aria-pressed': String(on),
        dataset: { focusKey: `field-kind-${kind.key}` },
        onclick: () => {
          if (on) return;
          fieldKind = kind.key;
          renderFieldKinds();
          renderFieldRows();
        },
      }, kind.label));
    }
  }

  function renderFieldRows(focus = null) {
    clear(fieldRows);
    const fields = currentFields();
    const kind = CUSTOM_KINDS.find((k) => k.key === fieldKind);

    fields.forEach((field, i) => {
      const name = el('input.input.field-name-input', {
        type: 'text', value: field.name, maxlength: MAX_FIELD_NAME, autocomplete: 'off',
        'aria-label': `Field ${i + 1} name`,
        onchange: () => {
          const label = name.value.trim();
          if (!label || label === field.name) { name.value = field.name; return; }
          const list = currentFields();
          list[i].name = label;
          saveFields(list, { focus: { id: field.id, control: '.field-name-input' } });
        },
      });

      const type = el('select.select.field-type-select', {
        'aria-label': `${field.name} type`,
        onchange: async () => {
          const next = type.value;
          if (next === field.type) return;
          const report = retypeReport(fieldRecords(), field, next);
          if (report.blocked.length) {
            // Refuse rather than drop what people typed. The count is the
            // useful part: it says how much work fixing it would be.
            type.value = field.type;
            const n = report.blocked.length;
            await confirmDialog({
              title: `Can’t make ${field.name} a ${fieldTypeInfo(next).label} field`,
              message: `${n} ${n === 1 ? kind.one : kind.label.toLowerCase()} hold${n === 1 ? 's' : ''} a value that isn’t ${fieldTypeInfo(next).noun}, and changing the type would throw ${n === 1 ? 'it' : 'them'} away. Clear or fix those values first.`,
              confirmLabel: 'Got it',
              danger: false,
              cancelLabel: null,
            });
            return;
          }
          if (report.total) {
            const ok = await confirmDialog({
              title: `Change ${field.name} to ${fieldTypeInfo(next).label}?`,
              message: `${report.total} stored value${report.total === 1 ? '' : 's'} will be converted.`,
              confirmLabel: 'Change type',
              danger: false,
            });
            if (!ok) { type.value = field.type; return; }
          }
          const list = currentFields();
          list[i].type = next;
          if (hasOptions(next)) list[i].options = list[i].options || [];
          else delete list[i].options;
          saveFields(list, { focus: { id: field.id, control: '.field-type-select' } });
        },
      }, FIELD_TYPES.map((t) =>
        el('option', { value: t.value, selected: t.value === field.type }, t.label)));

      const move = (dir) => el(`button.icon-btn.stage-move.stage-move-${dir > 0 ? 'down' : 'up'}`, {
        type: 'button',
        html: icon(dir > 0 ? 'chevD' : 'chevU', 17, 2.2),
        'aria-label': `Move ${field.name} ${dir > 0 ? 'later' : 'earlier'}`,
        disabled: dir > 0 ? i === fields.length - 1 : i === 0,
        onclick: () => {
          const list = currentFields();
          [list[i], list[i + dir]] = [list[i + dir], list[i]];
          saveFields(list, {
            focus: {
              id: field.id,
              control: `.stage-move-${dir > 0 ? 'down' : 'up'}`,
              orElse: [`.stage-move-${dir > 0 ? 'up' : 'down'}`],
            },
          });
        },
      });

      const remove = el('button.icon-btn.stage-remove', {
        type: 'button',
        html: icon('trash', 16, 2),
        'aria-label': `Remove field ${field.name}`,
        onclick: async () => {
          const n = valueCount(field);
          const ok = await confirmDialog({
            title: `Remove ${field.name}?`,
            message: n
              ? `${n} ${n === 1 ? kind.one : kind.label.toLowerCase()} ${n === 1 ? 'has' : 'have'} a value in this field, and ${n === 1 ? 'it goes' : 'they go'} with it. This can’t be undone.`
              : 'No records have a value in this field, so nothing else changes. You can add it back later.',
            confirmLabel: 'Remove field',
          });
          if (!ok) return;
          await saveFields(fields.filter((f) => f.id !== field.id), {
            message: (result) => (result.removed
              ? `${field.name} removed · ${result.removed} value${result.removed === 1 ? '' : 's'} deleted`
              : `${field.name} removed`),
          });
        },
      });

      const optionsInput = hasOptions(field.type) && el('input.input.field-options-input', {
        type: 'text', value: (field.options || []).join(', '), autocomplete: 'off',
        placeholder: 'e.g. Strong, Medium, Weak',
        'aria-label': `${field.name} choices, comma separated`,
        onchange: () => {
          const list = currentFields();
          list[i].options = optionsInput.value.split(',')
            .map((o) => o.trim().slice(0, MAX_OPTION_LENGTH))
            .filter(Boolean)
            .slice(0, MAX_FIELD_OPTIONS);
          saveFields(list, { focus: { id: field.id, control: '.field-options-input' } });
        },
      });

      const n = valueCount(field);
      fieldRows.append(el('div.stage-edit-row.field-edit-row', { dataset: { fieldId: field.id } },
        el('div.field-edit-main', {},
          name,
          el('div.select-wrap.field-type-wrap', {}, type)
        ),
        el('div.stage-edit-controls', {}, move(-1), move(1), remove),
        optionsInput && el('div.field-edit-options', {},
          optionsInput,
          el('span.field-hint', {}, 'Choices, separated by commas.')
        ),
        n > 0 && el('span.field-edit-note', {},
          `${n} ${n === 1 ? kind.one : kind.label.toLowerCase()} with a value`)
      ));
    });

    if (!fields.length) {
      fieldRows.append(el('p.card-empty', {},
        `No extra fields on ${kind.label.toLowerCase()} yet. Add one for whatever this business tracks that the built-in fields don’t.`));
    }

    const atCap = fields.length >= MAX_CUSTOM_FIELDS;
    fieldRows.append(el('div.stage-edit-actions', {},
      el('button.btn.btn-ghost.btn-sm.btn-dashed', {
        type: 'button',
        html: icon('plus', 14, 2.2),
        disabled: atCap,
        title: atCap ? `At most ${MAX_CUSTOM_FIELDS} fields per record type` : null,
        onclick: () => {
          const field = blankField(new Set(fields.map((f) => f.id)));
          // Land the caret in the new name so it can be typed over at once.
          saveFields([...fields, field], {
            focus: { id: field.id, control: '.field-name-input', select: true },
          });
        },
      }, ' Add field')
    ));

    if (focus) {
      const row = fieldRows.querySelector(`[data-field-id="${CSS.escape(focus.id)}"]`);
      const target = [focus.control, ...(focus.orElse || [])]
        .map((sel) => row?.querySelector(sel))
        .find((node) => node && !node.disabled);
      if (target) {
        target.focus();
        if (focus.select) target.select?.();
      }
    }
  }
  renderFieldKinds();
  renderFieldRows();

  /* ----- reminders ----- */
  const notifyRow = el('div.switch-slot');
  function renderNotify() {
    // The row is rebuilt after every toggle; a keyboard user's focus has
    // to land back on the switch or Tab restarts from the top of the page.
    const hadFocus = notifyRow.contains(document.activeElement);
    clear(notifyRow);
    const permission = notificationPermission();
    const blocked = permission === 'denied';
    const unsupported = permission === 'unsupported';
    const on = !!store.settings.notifications && permission === 'granted';

    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'notify-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      disabled: blocked || unsupported,
      onclick: async () => {
        if (on) {
          try {
            await store.updateSettings({ notifications: false });
          } catch {
            toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          }
          renderNotify();
          return;
        }
        const result = await requestNotifications();
        if (result !== 'granted') {
          renderNotify();
          toast(result === 'denied'
            ? 'Your browser is blocking notifications for this site'
            : 'Notifications weren’t enabled', { icon: 'alert' });
          return;
        }
        // The success message is reserved for a save that actually
        // persisted - a failed write here would quietly re-flip the
        // toggle on the next visit.
        try {
          await store.updateSettings({ notifications: true });
        } catch {
          renderNotify();
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        renderNotify();
        toast('Reminders on. You’ll get a nudge while the app is open', { icon: 'check' });
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));

    notifyRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'notify-switch' }, 'Browser notifications'),
        el('div.sub', {}, unsupported
          ? 'This browser doesn’t support notifications.'
          : blocked
            ? 'Blocked for this site. Allow notifications in your browser settings first.'
            : 'A summary the first time you open the app each day, plus a nudge when a timed follow-up comes due.')
      ),
      toggle
    ));
    if (hadFocus && !toggle.disabled) toggle.focus();
  }
  renderNotify();

  /* ----- next-step nudges ----- */
  const nudgeRow = el('div.switch-slot');
  function renderNudges() {
    const hadFocus = nudgeRow.contains(document.activeElement);
    clear(nudgeRow);
    const on = store.settings.nextStepNudges !== false;
    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'nudge-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      onclick: async () => {
        try {
          await store.updateSettings({ nextStepNudges: !on });
        } catch {
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        }
        renderNudges();
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));
    nudgeRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'nudge-switch' }, 'Next-step nudges'),
        el('div.sub', {}, 'After you complete a follow-up, log an activity, or move a deal, offer to schedule the next one when nothing else is booked.')
      ),
      toggle
    ));
    if (hadFocus) toggle.focus();
  }
  renderNudges();

  /* ----- AI assist -----
     Opt-out, and only where the platform offers it. The copy says plainly
     what leaves the user's cloud, because "your data stays in your Puter
     cloud" is the promise this feature has to keep honest. */
  const aiRow = el('div.switch-slot');
  function renderAI() {
    const hadFocus = aiRow.contains(document.activeElement);
    clear(aiRow);
    const available = aiAvailable();
    const on = available && store.settings.aiAssist !== false;
    const toggle = el('button.switch', {
      type: 'button',
      role: 'switch',
      id: 'ai-switch',
      'aria-checked': String(on),
      className: `switch${on ? ' on' : ''}`,
      disabled: !available,
      onclick: async () => {
        try {
          await store.updateSettings({ aiAssist: !on });
        } catch {
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        }
        renderAI();
      },
    }, el('span.switch-knob', { 'aria-hidden': 'true' }));

    aiRow.append(el('div.switch-row', {},
      el('div.grow.min0', {},
        el('label.title', { for: 'ai-switch' }, 'AI assist'),
        el('div.sub', {}, available
          ? 'Adds three buttons: read pasted text into a new lead or company, draft an email, and catch up on a long history. Each one is a button you press, the result lands in a field you can edit, and nothing is saved on its own.'
          : 'This Puter session doesn’t offer AI, so the assist buttons stay hidden.')
      ),
      toggle
    ));
    if (available) {
      aiRow.append(el('p.settings-note.mt-sm', {},
        'When you press one, the record you pressed it on - and nothing else - is sent to Puter’s AI for that one request. Turn this off and the app never contacts a model.'));
    }
    if (hadFocus && !toggle.disabled) toggle.focus();
  }
  renderAI();

  /* ----- attention thresholds ----- */

  /** A days field that saves itself; 0 means "never flag". */
  function daysField(id, label, key, fallback, hint) {
    const input = el('input.input.prob-input', {
      id, type: 'number', min: '0', max: '365', step: '1',
      value: String(store.settings[key] ?? fallback),
      onchange: async () => {
        const v = clamp(Math.round(Number(input.value) || 0), 0, 365);
        input.value = String(v);
        await store.updateSettings({ [key]: v })
          .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));
      },
    });
    settingsFields.push(() => { input.value = String(store.settings[key] ?? fallback); });
    return el('div.threshold-field', {},
      el('label.field-label.grow', { for: id }, label),
      input,
      el('span.prob-unit', {}, 'days'),
      el('span.field-hint', {}, hint)
    );
  }

  /* ----- monthly revenue goal ----- */
  const goalCurrency = el('span.goal-currency', {}, store.settings.currency);
  const goalInput = el('input.input.goal-input', {
    // Whole currency units, for the same reason the stage percent above
    // takes them: a goal of 12,345 is saved as 12,345, and a step of 100
    // only made the control call it invalid.
    type: 'number', min: '0', step: '1', inputmode: 'decimal',
    value: store.settings.revenueGoal ? String(store.settings.revenueGoal) : '',
    placeholder: '0',
    'aria-label': `Monthly revenue goal in ${store.settings.currency}`,
    onchange: async () => {
      const v = Math.max(0, Math.round(Number(goalInput.value) || 0));
      goalInput.value = v ? String(v) : '';
      try {
        await store.updateSettings({ revenueGoal: v });
      } catch {
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        return;
      }
      toast(v ? `Goal set to ${formatMoney(v, store.settings.currency)}` : 'Goal cleared');
    },
  });

  /* ----- weekly touch target -----
     The leading number beside the lagging one: revenue is what happened,
     touches are what you can still do something about today. One overall
     figure, or per type for a founder who runs a specific cadence. */
  const touchInputs = [];

  /** A whole-count field that saves itself. `key` is 'all' or a type id. */
  function touchInput(key) {
    const id = `touch-${key}`;
    const input = el('input.input.prob-input.touch-input', {
      id, type: 'number', min: '0', max: '999', step: '1', inputmode: 'numeric',
      value: normalizeTouchTargets(store.settings.touchTargets)[key] || '',
      placeholder: '0',
      onchange: async () => {
        const next = normalizeTouchTargets(store.settings.touchTargets);
        next[key] = clamp(Math.round(Number(input.value) || 0), 0, 999);
        input.value = next[key] || '';
        try {
          await store.updateSettings({ touchTargets: next });
        } catch {
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        syncTouchHint();
      },
    });
    touchInputs.push(() => {
      input.value = normalizeTouchTargets(store.settings.touchTargets)[key] || '';
    });
    return { id, input };
  }

  /** The overall target: a threshold row like the attention ones. */
  function touchTotalField() {
    const { id, input } = touchInput('all');
    return el('div.threshold-field', {},
      el('label.field-label.grow', { for: id }, 'Touches of any kind'),
      input,
      el('span.prob-unit', {}, 'a week')
    );
  }

  /* Per type, side by side: four stacked rows of zeroes made an optional
     setting look like the main event. */
  function touchTypeFields() {
    return el('div.touch-types', {}, ACTIVITY_TYPES.map((t) => {
      const { id, input } = touchInput(t.value);
      return el('div.touch-type', {},
        el('label.field-label', { for: id }, `${t.label}s`),
        input
      );
    }));
  }

  const touchHint = el('p.settings-note.mt-sm');
  function syncTouchHint() {
    const total = touchTarget(store.settings.touchTargets);
    const targets = normalizeTouchTargets(store.settings.touchTargets);
    const perType = ACTIVITY_TYPES.filter((t) => targets[t.value] > 0)
      .map((t) => `${targets[t.value]} ${t.label.toLowerCase()}${targets[t.value] === 1 ? '' : 's'}`);
    touchHint.textContent = total
      ? `Aiming at ${total} touch${total === 1 ? '' : 'es'} a week`
        + (perType.length ? ` · ${perType.join(', ')}` : '')
        + (targets.all && perType.length ? ' (the overall figure is the one measured)' : '')
      : 'No target set. The dashboard and the activity log show one once you set a number here.';
  }
  syncTouchHint();
  touchInputs.push(syncTouchHint);

  function syncCurrencyLabels() {
    goalCurrency.textContent = store.settings.currency;
    goalInput.setAttribute('aria-label', `Monthly revenue goal in ${store.settings.currency}`);
  }

  settingsFields.push(() => {
    goalInput.value = store.settings.revenueGoal ? String(store.settings.revenueGoal) : '';
  });

  /**
   * Put every settings-backed control back in step. An import or a snapshot
   * restore swaps the whole settings object, so the page has to re-read it
   * or it shows the previous account's thresholds until the next reload.
   */
  function syncSettingsUI() {
    applyTheme(store.settings.theme || 'system');
    renderThemes();
    renderStageRows();
    renderFieldKinds();
    renderFieldRows();
    renderNotify();
    renderNudges();
    renderAI();
    currencySelect.value = store.settings.currency;
    syncCurrencyLabels();
    for (const sync of settingsFields) sync();
    for (const sync of touchInputs) sync();
    renderTemplates();
    renderPlaybooks();
    renderTags();
    renderTrash();
    renderBackup();
  }

  /**
   * Rebuild a list and hand the keyboard back, the way renderNotify and
   * renderTrash already do for theirs. Renaming a tag or deleting a
   * template throws the whole list away and builds it again, which left
   * focus on the body - so the next Tab restarted at the top of a page
   * this long.
   *
   * The control is found again by the accessible name it still carries.
   * A rename changes that name, so callers can pass the one it becomes;
   * when the row is gone for good the list's first control takes the
   * keyboard rather than nothing at all. Focus that had already left the
   * list is left where the user put it.
   */
  function refocusList(list, render, renamedTo = null) {
    const label = list.contains(document.activeElement)
      ? document.activeElement.getAttribute('aria-label')
      : null;
    render();
    if (label === null) return;
    const byLabel = (name) => (name ? list.querySelector(`[aria-label=${CSS.escape(name)}]`) : null);
    (byLabel(label) || byLabel(renamedTo) || list.querySelector('input, button'))?.focus();
  }

  /* ----- email templates ----- */
  const templatesList = el('div');
  const renderTemplates = () => refocusList(templatesList, buildTemplates);
  function buildTemplates() {
    clear(templatesList);
    if (!store.templates.length) {
      templatesList.append(el('p.card-empty', {},
        'The emails you send on repeat (cold intro, recap, check-in), written once and filled from the record you send them from.'));
      return;
    }
    templatesList.append(el('div.settings-list', {},
      [...store.templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) =>
        el('div.settings-row.static', {},
          el('span.row-ic', { html: icon('mail', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, t.name || 'Untitled'),
            t.subject && el('div.sub', {}, t.subject)
          ),
          el('button.icon-btn', {
            html: icon('pencil', 16, 2),
            'aria-label': `Edit template ${t.name}`,
            onclick: () => openTemplateForm(t, { onSaved: renderTemplates }),
          }),
          el('button.icon-btn', {
            html: icon('trash', 16, 2),
            'aria-label': `Delete template ${t.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Delete “${t.name}”?`,
                message: 'The template goes to Recently deleted for 30 days. Emails already logged stay.',
              });
              if (!ok) return;
              try {
                deletedToast('Template deleted', await store.deleteTemplate(t.id));
              } catch {
                toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
              }
              renderTemplates();
            },
          })
        ))));
  }
  renderTemplates();

  /* ----- playbooks -----
     The follow-up cadence a founder runs every time, saved once. */
  const playbooksList = el('div');
  const newPlaybookBtn = el('button.btn.btn-ghost.btn-sm', {
    html: icon('plus', 14, 2.2),
    onclick: () => openPlaybookForm(null, { onSaved: renderPlaybooks }),
  }, ' New');
  const renderPlaybooks = () => refocusList(playbooksList, buildPlaybooks);
  function buildPlaybooks() {
    clear(playbooksList);
    const books = store.playbooks();
    // The cap is reached by adding one, so the button has to answer for
    // itself on every render rather than at page build time.
    newPlaybookBtn.disabled = books.length >= MAX_PLAYBOOKS;
    newPlaybookBtn.title = newPlaybookBtn.disabled
      ? `At most ${MAX_PLAYBOOKS} playbooks` : null;
    if (!books.length) {
      playbooksList.append(el('p.card-empty', {},
        'No playbooks yet. Save the steps you run after a demo - recap the same day, nudge in three days, check in after two weeks - and apply them to a lead or deal in one click.'));
      return;
    }
    const stages = store.stages();
    playbooksList.append(el('div.settings-list', {}, books.map((book) => {
      const stage = book.trigger && stages.find((s) => s.id === book.trigger);
      return el('div.settings-row.static', {},
        el('span.row-ic', { html: icon('listChecks', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, book.name),
          el('div.sub', {}, playbookSummary(book)
            + (stage ? ` · offered on ${stage.label}` : ''))
        ),
        el('button.icon-btn', {
          html: icon('pencil', 16, 2),
          'aria-label': `Edit playbook ${book.name}`,
          onclick: () => openPlaybookForm(book, { onSaved: renderPlaybooks }),
        })
      );
    })));
  }
  renderPlaybooks();

  /* ----- tags ----- */
  const tagsList = el('div');
  const renderTags = (renamedTo = null) =>
    refocusList(tagsList, buildTags, renamedTo && `Rename tag ${renamedTo}`);
  function buildTags() {
    clear(tagsList);
    const all = store.allTags();
    if (!all.length) {
      tagsList.append(el('p.card-empty', {},
        'No tags yet. Add them on a lead, company, or deal to slice your book any way a fixed field can’t.'));
      return;
    }
    tagsList.append(el('div.settings-list', {}, all.map((t) => {
      const name = el('input.input.tag-name-input', {
        type: 'text', value: t.name, maxlength: 40, autocomplete: 'off',
        'aria-label': `Rename tag ${t.name}`,
        onchange: async () => {
          const next = name.value.trim();
          if (!next || next === t.name) { name.value = t.name; return; }
          try {
            const n = await store.renameTag(t.name, next);
            toast(`Tag renamed on ${n} record${n === 1 ? '' : 's'}`);
          } catch {
            toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          }
          renderTags(next);
        },
      });
      return el('div.settings-row.static.tag-manage-row', {},
        el('span.row-ic', { html: icon('tag', 18, 2) }),
        el('div.grow.min0', {},
          name,
          el('div.sub', {}, `${t.count} record${t.count === 1 ? '' : 's'}`)
        ),
        el('button.icon-btn', {
          html: icon('trash', 16, 2),
          'aria-label': `Delete tag ${t.name}`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: `Delete the tag “${t.name}”?`,
              message: `It comes off ${t.count} record${t.count === 1 ? '' : 's'}. The records themselves stay exactly as they are.`,
              confirmLabel: 'Delete tag',
            });
            if (!ok) return;
            try {
              await store.deleteTag(t.name);
              toast('Tag deleted', { icon: 'trash' });
            } catch {
              toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
            }
            renderTags();
          },
        })
      );
    })));
  }
  renderTags();

  /* ----- data ----- */

  /** Undo the last bulk replace by swapping the snapshot back in. */
  async function undoBulk() {
    try {
      await store.restoreBackup();
      syncSettingsUI();
      toast('Previous data restored', { icon: 'undo' });
    } catch {
      toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
    }
  }

  function exportData() {
    downloadFile(`crm-export-${todayISO()}.json`,
      JSON.stringify(store.exportAll(), null, 2), 'application/json');
    toast('Export downloaded', { icon: 'fileDown' });
  }

  function importData() {
    pickFile('application/json,.json', async (file) => {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast('That file isn’t valid JSON', { icon: 'alert' });
        return;
      }
      const ok = await confirmDialog({
        title: 'Replace everything?',
        message: 'Importing replaces all current leads, companies, deals, follow-ups, and history with the file’s contents. A snapshot of what you have now is kept, so this is reversible.',
        confirmLabel: 'Import and replace',
      });
      if (!ok) return;
      const hadData = store.hasData();
      try {
        await store.importAll(data);
        // The file's settings replace the current ones; reflect them in
        // the app and this view now rather than on the next full reload.
        syncSettingsUI();
        // The snapshot taken inside importAll makes this reversible.
        toast('Import complete', {
          icon: 'fileUp',
          action: hadData && { label: 'Undo', onClick: undoBulk },
        });
      } catch (err) {
        console.error(err);
        toast(err.message === 'Not a CRM export file'
          ? 'That file isn’t a CRM export' : 'Import failed. Check your connection', { icon: 'alert' });
      }
    });
  }

  async function loadSample() {
    const ok = await confirmDialog({
      title: 'Load sample data?',
      message: 'Your current data is replaced with a demo pipeline you can explore. A snapshot is kept first, so you can bring your data back.',
      confirmLabel: 'Load sample data',
      danger: store.contacts.length > 0 || store.deals.length > 0,
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll(sampleDataset(store), { reason: 'sample' });
      syncSettingsUI();
      toast('Sample data loaded', {
        icon: 'sparkle',
        action: hadData && { label: 'Undo', onClick: undoBulk },
      });
    } catch {
      toast('Couldn’t load sample data. Check your connection', { icon: 'wifiOff' });
    }
  }

  async function eraseAll() {
    const ok = await confirmDialog({
      title: 'Erase all data?',
      message: 'Every lead, company, deal, follow-up, and activity is removed from your Puter account. A one-slot snapshot is kept so you can undo it from here - nothing else is.',
      confirmLabel: 'Erase everything',
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll({
        app: 'crm', version: 1,
        settings: { ...store.settings, onboarded: false, sampleData: false },
        companies: [], contacts: [], deals: [], activities: [], tasks: [],
      }, { reason: 'erase' });
      await store.emptyTrash();
      syncSettingsUI();
      toast('All data erased', {
        icon: 'trash',
        action: hadData && { label: 'Undo', onClick: undoBulk },
      });
      location.hash = '#/';
    } catch {
      toast('Couldn’t erase. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* ----- what hasn't reached the cloud yet -----
     The outbox keeps offline writes; this says whether it is holding any,
     because "saved" should never be a guess. */
  const syncRow = el('div');
  /* One settle of the outbox emits more than once - a failed write marks
     the connection down and then reports the new queue length - so two of
     these can be in flight at a time. Reading the queue is a round trip to
     IndexedDB, and clearing before that await let both renders clear an
     empty row and then both append, listing every pending write twice.
     Clear after the read instead, and let the newest render win. */
  let syncRenderId = 0;
  async function renderSync() {
    const id = ++syncRenderId;
    const pending = await store.pendingWrites().catch(() => []);
    if (id !== syncRenderId) return;
    clear(syncRow);
    const conflicts = pending.filter((row) => row.conflict);
    if (!pending.length) {
      syncRow.append(el('p.card-empty', {},
        store.offline.offline
          ? 'Working offline. Everything you have changed is already in your cloud; anything you change now is kept here and sent when it answers.'
          : 'Everything is in your Puter cloud. Changes made offline wait here until it answers.'));
      return;
    }
    syncRow.append(el('div.settings-list', {},
      pending.map((row) => el('div.settings-row.static', {},
        el('span.row-ic', { html: icon(row.conflict ? 'alert' : 'wifiOff', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, kvLabel(row.key)),
          el('div.sub', {}, row.conflict
            ? 'Also changed somewhere else - needs a decision'
            : `Saved on this device ${timeAgo(row.at)}`)
        )
      ))
    ),
    el('div.settings-body', {},
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        html: icon(conflicts.length ? 'alert' : 'upload', 14, 2),
        onclick: openOfflineSheet,
      }, conflicts.length ? ' Review' : ' Try again now')
    ));
  }
  renderSync();
  const onOffline = () => { renderSync(); };
  store.addEventListener('offline', onOffline);

  /* ----- automatic cloud backups ----- */
  const cloudBackups = el('div');

  async function restoreCloudBackup(b) {
    let data;
    try {
      data = await readBackup(b.path);
    } catch {
      toast('Couldn’t read that backup. Check your connection', { icon: 'wifiOff' });
      return;
    }
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `Everything is replaced with the backup from ${formatDate(todayISO(new Date(b.at)), { year: 'always' })}. A snapshot of what you have now is kept first, so the restore itself is reversible.`,
      confirmLabel: 'Restore backup',
    });
    if (!ok) return;
    const hadData = store.hasData();
    try {
      await store.importAll(data, { reason: 'cloud-backup' });
      syncSettingsUI();
      toast('Backup restored', {
        icon: 'undo',
        action: hadData && { label: 'Undo', onClick: undoBulk },
      });
    } catch (err) {
      console.error(err);
      toast(err.message === 'Not a CRM export file'
        ? 'That file isn’t a CRM backup' : 'Restore failed. Check your connection', { icon: 'alert' });
    }
  }

  async function backupNow(btn) {
    btn.disabled = true;
    try {
      await writeBackup(store);
      toast('Backed up to your Puter cloud', { icon: 'check' });
    } catch {
      toast('Backup failed. Check your connection', { icon: 'wifiOff' });
    }
    btn.disabled = false;
    renderCloudBackups();
  }

  async function renderCloudBackups() {
    // Reading the folder is a round trip to the user's cloud. This section
    // had an error state and an empty state but nothing for the wait, so on
    // a slow connection it stood blank and read as "no backups" - the one
    // wrong answer to give about the copies that exist to be relied on.
    clear(cloudBackups);
    cloudBackups.append(el('p.card-empty', {}, 'Checking your backups folder…'));
    let backups;
    try {
      backups = await listBackups();
    } catch {
      backups = null;
    }
    clear(cloudBackups);
    if (backups === null) {
      cloudBackups.append(el('p.card-empty', {},
        'Couldn’t reach your backups folder. Check your connection.'));
      return;
    }
    if (!backups.length) {
      cloudBackups.append(el('p.card-empty', {},
        'No backups yet. One is written automatically when you open the app, or make one now.'));
      return;
    }
    cloudBackups.append(
      el('div.settings-body', {},
        el('p.settings-note', {}, `Last automatic backup: ${timeAgo(backups[0].at)}.`)
      ),
      el('div.settings-list', {}, backups.map((b) => el('div.settings-row.static', {},
        el('span.row-ic', { html: icon('fileDown', 20, 1.8) }),
        el('div.grow.min0', {},
          el('div.title', {}, formatDate(todayISO(new Date(b.at)), { year: 'always' })),
          el('div.sub', {}, `${timeAgo(b.at)}${b.size ? ` · ${formatBytes(b.size)}` : ''}`)
        ),
        el('button.icon-btn', {
          html: icon('download', 16, 2),
          'aria-label': `Download backup from ${timeAgo(b.at)}`,
          onclick: async () => {
            try {
              const data = await readBackup(b.path);
              downloadFile(b.name, JSON.stringify(data, null, 2), 'application/json');
              toast('Backup downloaded', { icon: 'fileDown' });
            } catch {
              toast('Couldn’t read that backup. Check your connection', { icon: 'wifiOff' });
            }
          },
        }),
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('undo', 14, 2),
          onclick: () => restoreCloudBackup(b),
        }, ' Restore')
      )))
    );
  }
  renderCloudBackups();

  /* ----- recently deleted ----- */
  const TRASH_KINDS = {
    company: { icon: 'company', label: 'Company' },
    contact: { icon: 'user', label: 'Lead' },
    deal: { icon: 'deal', label: 'Deal' },
    activity: { icon: 'video', label: 'Activity' },
    task: { icon: 'followups', label: 'Follow-up' },
    template: { icon: 'mail', label: 'Email template' },
    attachment: { icon: 'paperclip', label: 'File' },
  };

  const trashSection = el('div');
  function renderTrash() {
    // Restoring an entry rebuilds this list under the keyboard user's
    // focus; hand it to the next actionable control rather than the body.
    const hadFocus = trashSection.contains(document.activeElement);
    clear(trashSection);
    if (!store.trash.length) {
      trashSection.append(el('p.card-empty', {},
        'Nothing deleted recently. Deleted records wait here for 30 days before they go for good.'));
      return;
    }
    trashSection.append(
      el('div.settings-list', {}, store.trash.map((entry) => {
        const kind = TRASH_KINDS[entry.kind] || { icon: 'inbox', label: 'Record' };
        return el('div.settings-row.static', {},
          el('span.row-ic', { html: icon(kind.icon, 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, entry.name || 'Untitled'),
            el('div.sub', {}, `${kind.label} · deleted ${timeAgo(entry.at)}`)
          ),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            html: icon('undo', 14, 2),
            onclick: async () => {
              try {
                await store.restoreTrash(entry.id);
                toast(`${kind.label} restored`, { icon: 'undo' });
              } catch {
                toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
              }
              renderTrash();
            },
          }, ' Restore')
        );
      })),
      el('div.settings-body', {},
        el('button.btn.btn-ghost.btn-sm.btn-danger-ghost', {
          type: 'button',
          html: icon('trash', 14, 2),
          onclick: async () => {
            const n = store.trash.length;
            const ok = await confirmDialog({
              title: 'Empty the trash?',
              message: `${n} deleted record${n === 1 ? '' : 's'} will be gone for good. This cannot be undone.`,
              confirmLabel: 'Empty trash',
            });
            if (!ok) return;
            try {
              await store.emptyTrash();
              toast('Trash emptied', { icon: 'trash' });
            } catch {
              toast('Couldn’t empty. Check your connection', { icon: 'wifiOff' });
            }
            renderTrash();
          },
        }, ' Empty trash')
      )
    );
    if (hadFocus) trashSection.querySelector('button')?.focus();
  }
  renderTrash();

  /* ----- safety snapshot ----- */
  const backupRow = el('div');
  function renderBackup() {
    clear(backupRow);
    if (!store.backup) return;
    const when = timeAgo(store.backup.at);
    const why = {
      sample: 'loading sample data',
      erase: 'erasing everything',
      restore: 'the last restore',
      wipe: 'clearing the sample data',
      'cloud-backup': 'restoring a cloud backup',
    }[store.backup.reason] || 'the last import';
    backupRow.append(dataRow('undo', 'Restore previous data',
      `Snapshot taken ${when}, before ${why}`, async () => {
        const ok = await confirmDialog({
          title: 'Restore the snapshot?',
          message: `Everything goes back to how it was ${when}. Your current data is snapshotted first, so you can swap back.`,
          confirmLabel: 'Restore',
          danger: false,
        });
        if (!ok) return;
        try {
          await store.restoreBackup();
          syncSettingsUI();
          toast('Previous data restored', { icon: 'undo' });
        } catch {
          toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
        }
      }));
  }

  const dataRow = (name, title, sub, onclick, danger = false) =>
    el(`button.settings-row${danger ? '.danger' : ''}`, { type: 'button', onclick },
      el('span.row-ic', { html: icon(name, 20, 1.8) }),
      el('div.grow', {},
        el('div.title', {}, title),
        el('div.sub', {}, sub)
      ),
      el('span.row-chev', { html: icon('chevR', 18) })
    );

  /* ----- account ----- */
  const username = store.user?.username || 'Puter user';
  const accountRows = el('div.settings-list', {},
    el('div.settings-row.static', {},
      el('span.avatar', {}, username.charAt(0).toUpperCase()),
      el('div.grow', {},
        el('div.title', {}, username),
        el('div.sub', {}, 'Signed in with Puter')
      )
    ),
    // Inside Puter's desktop the platform owns the session - no sign-out.
    puter.env !== 'app' && dataRow('logout', 'Sign out', 'Your data stays in your Puter account', confirmSignOut)
  );

  renderBackup();

  /* Trash and the snapshot row change from outside this page's own buttons
     - a CSV import writes a new snapshot, a toast Undo restores a trash
     entry - so they follow the store. Only these two: re-rendering the
     input-bearing sections on every save would steal focus mid-edit. */
  const syncPassive = () => {
    renderTrash();
    renderBackup();
    // No inputs in the templates list, so following the store is safe -
    // and a template restored from the trash reappears without a reload.
    renderTemplates();
  };
  store.addEventListener('change', syncPassive);
  root.destroy = () => {
    store.removeEventListener('change', syncPassive);
    store.removeEventListener('offline', onOffline);
  };

  root.append(
    pageHead('Settings'),
    section('Appearance', null,
      el('div.settings-body', {},
        el('div.field', {},
          el('label.field-label', {}, 'Theme'),
          themeGroup
        ),
        el('div.field', {},
          el('label.field-label', { for: 'currency-select' }, 'Currency'),
          el('div.select-wrap', {}, Object.assign(currencySelect, { id: 'currency-select' }))
        )
      )
    ),
    section('Pipeline stages', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Your funnel, in order. Rename, reorder, add, or remove stages to match how you actually sell. The percentage is how likely a deal in that stage is to close; the forecast multiplies deal values by it.'),
        stageRows
      )
    ),
    section('Custom fields', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Whatever this business tracks that the built-in fields don’t: seats, trial end date, ICP fit, who referred them. Fields appear on the add and edit forms and on detail pages, and choice and yes/no fields can filter the lists.'),
        fieldKindGroup,
        fieldRows
      )
    ),
    section('Reminders', null,
      el('div.settings-body', {},
        notifyRow,
        nudgeRow,
        el('p.settings-note.mt-sm', {}, 'Notifications only fire while the app is open in a tab. For reminders that survive a closed laptop, send your follow-ups to your calendar.')
      ),
      el('div.settings-list', {},
        dataRow('calendar', 'Export open follow-ups (.ics)',
          'Every open follow-up and open deal close date, for any calendar app',
          downloadOpenICS)
      )
    ),
    section('AI assist', null,
      el('div.settings-body', {}, aiRow)
    ),
    section('What needs attention', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'When the board and the dashboard should start nudging you. Set either to 0 to turn that flag off.'),
        daysField('stale-days', 'A deal has stalled after', 'staleDays', DEFAULT_STALE_DAYS,
          'Marks board cards and lists the worst on the dashboard.'),
        daysField('cold-days', 'A lead is going cold after', 'coldDays', DEFAULT_COLD_DAYS,
          'Drives the Going cold filter on Leads and the dashboard card.')
      )
    ),
    section('Monthly revenue goal', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'The number you sell against. The dashboard shows won revenue as progress against it (with pace for the day of the month), and the forecast draws it across the months ahead.'),
        el('div.goal-field', {},
          goalCurrency,
          Object.assign(goalInput, { id: 'revenue-goal' }),
          el('label.field-hint', { for: 'revenue-goal' }, 'per month · leave empty for no goal')
        )
      )
    ),
    section('Weekly activity target', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Revenue is what already happened; touches are what you can still do something about today. Set how many meetings, calls, emails, and notes a week you mean to log, and the dashboard and the activity log track this week against it - with pace for the day of the week.'),
        touchTotalField(),
        el('p.field-hint.mt-sm', {}, 'Or set them per type - a cadence of so many calls and so many meetings.'),
        touchTypeFields(),
        touchHint
      )
    ),
    section('Email templates',
      el('button.btn.btn-ghost.btn-sm', {
        html: icon('plus', 14, 2.2),
        onclick: () => openTemplateForm(null, { onSaved: renderTemplates }),
      }, ' New'),
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Use them from the Email button on a lead or deal page. Merge fields like {{firstName}} and {{dealValue}} fill from the record.')
      ),
      templatesList
    ),
    section('Follow-up playbooks',
      newPlaybookBtn,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'The steps you run every time, saved once: apply one to a lead or deal and it books the whole cadence, dated from today. A playbook can also offer itself when a deal reaches a stage - it always asks first.')
      ),
      playbooksList
    ),
    section('Tags', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Every tag in use across leads, companies, and deals. Renaming updates every record wearing it; deleting only removes the label.')
      ),
      tagsList
    ),
    section('Your data', null,
      el('div.settings-list', {},
        dataRow('merge', 'Review possible duplicates', 'Contacts and companies that look like the same record twice', openDuplicatesReview),
        dataRow('fileUp', 'Import from CSV', 'Bring leads, companies, or deals in from a spreadsheet', openCSVImport),
        dataRow('fileDown', 'Export as CSV', 'One file per record type, for spreadsheets and other tools', openCSVExport),
        dataRow('fileDown', 'Export everything', 'Download a JSON file of all your data', exportData),
        dataRow('fileUp', 'Import from export', 'Replace your data with a previously exported file', importData),
        dataRow('sparkle', 'Load sample data', 'Explore the app with a demo pipeline', loadSample),
        dataRow('trash', 'Erase all data', 'Clear everything from this account', eraseAll, true)
      ),
      backupRow
    ),
    section('Waiting to sync', null,
      el('div.settings-body', {},
        el('p.settings-note', {}, 'Changes are saved on this device first, so nothing is lost when the connection is - then they go to your Puter cloud. Anything still on its way shows here.')
      ),
      syncRow
    ),
    section('Cloud backups',
      (() => {
        const btn = el('button.btn.btn-ghost.btn-sm', {
          html: icon('upload', 14, 2),
        }, ' Back up now');
        btn.addEventListener('click', () => backupNow(btn));
        return btn;
      })(),
      el('div.settings-body', {},
        el('p.settings-note', {}, 'A rolling copy of everything, kept in a backups folder in your own Puter cloud: insurance against a bad bulk edit or a corrupt write that the 30-day trash can’t cover. The oldest copies prune themselves.'),
        daysField('backup-days', 'Back up automatically every', 'autoBackupDays', 7,
          'Checked when you open the app. 0 turns automatic backups off.')
      ),
      cloudBackups
    ),
    section('Recently deleted', null, trashSection),
    section('Account', null, accountRows)
  );

  return root;
}
