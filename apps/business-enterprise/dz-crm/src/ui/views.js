/**
 * Saved views in the UI: the chip row above a list's filters, and the
 * small menu behind the one that is active.
 *
 * A chip applies a filter set; the menu renames, reorders, sets the
 * default the page opens with, or deletes. "Save this view" appears
 * whenever what is on screen isn't one of the saved sets already.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { CONTACT_STATUSES } from '../lib/statuses.js';
import { CLOSE_WINDOWS } from '../lib/forecast.js';
import {
  MAX_VIEWS, MAX_VIEW_NAME, applyFilters, isEmptyFilters, matchingView,
  reorderViews, withDefault, describeFilters, viewKind, viewById, defaultView,
  DEAL_SORT_COLUMNS, dealSortLabel,
} from '../lib/views.js';


/** What currently exists, so a stale condition can be dropped on apply. */
export function filterContext(kind) {
  const context = {
    tags: store.allTags(kind).map((t) => t.name),
    fields: store.customFields(kind).map((f) => f.id),
  };
  if (kind === 'deals') {
    context.stages = store.stages().map((s) => s.id);
    context.sortKeys = DEAL_SORT_COLUMNS.map((c) => c.key);
  }
  return context;
}

/**
 * The words a saved view is described in - the same ones the chips, the
 * selects, and the table headings show, so a view never explains itself in
 * vocabulary the user has never seen. `cold` is the Leads list's own
 * cross-cut rather than a stored status, and it lives here with the rest.
 */
function filterWords() {
  return {
    statusLabel: (value) => (value === 'cold' ? 'Going cold'
      : CONTACT_STATUSES.find((s) => s.value === value)?.label || value),
    stageLabel: (id) => store.stages().find((s) => s.id === id)?.label || id,
    windowLabel: (value) => CLOSE_WINDOWS.find((w) => w.value === value)?.label || value,
    sortLabel: dealSortLabel,
  };
}

/** One line naming every condition a filter set carries. */
function filterSummary(kind, filters) {
  return describeFilters(kind, filters, filterWords());
}

/**
 * Apply a saved view, reporting anything it had to leave out - a view is a
 * set of conditions, and one of them can outlive the thing it names.
 */
export function useView(kind, view) {
  const { filters, dropped } = applyFilters(kind, view.filters, filterContext(kind));
  if (dropped.length) {
    toast(`${view.name} · ignoring ${dropped.join(' and ')}`, { icon: 'alert', duration: 7000 });
  }
  return filters;
}

const fail = () => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });

/**
 * The filters a list should open with: the view named in the URL (the
 * palette links straight into one), else the list's default view, else
 * nothing. Null when the list opens unfiltered, which is most of the time.
 */
export function startingFilters(kind, params) {
  const id = params?.get?.('view');
  const view = id ? viewById(store.settings, kind, id) : defaultView(store.settings, kind);
  if (!view) return null;
  return { view, filters: useView(kind, view) };
}

/**
 * The chip row. `filters` is what is on screen right now; `onApply` gets a
 * filter set to adopt, and `onChanged` is called when the saved list
 * itself changes (so the row can be rebuilt).
 *
 * Returns null when there is nothing to show and nothing to save - an
 * unfiltered list with no saved views has no business growing a row.
 */
export function viewChips({ kind, filters, onApply, onChanged }) {
  const views = store.views(kind);
  const active = matchingView(store.settings, kind, filters);
  const savable = !isEmptyFilters(kind, filters) && !active;
  if (!views.length && !savable) return null;

  const row = el('div.view-chips', { role: 'group', 'aria-label': 'Saved views' });

  for (const view of views) {
    const on = active?.id === view.id;
    row.append(el('button.filter-chip.view-chip', {
      type: 'button',
      className: `filter-chip view-chip${on ? ' active' : ''}`,
      'aria-pressed': String(on),
      title: filterSummary(kind, view.filters),
      dataset: { focusKey: `view-chip-${view.id}` },
      onclick: () => onApply(useView(kind, view)),
    },
      view.default && el('span', { html: icon('check', 12, 2.6), 'aria-hidden': 'true' }),
      view.name
    ));
    if (!on) continue;
    row.append(el('button.icon-btn.view-menu', {
      type: 'button',
      html: icon('more', 15, 2),
      'aria-label': `Manage the ${view.name} view`,
      'aria-haspopup': 'dialog',
      dataset: { focusKey: `view-menu-${view.id}` },
      onclick: () => openViewMenu({ kind, view, onChanged }),
    }));
  }

  if (savable) {
    const atCap = views.length >= MAX_VIEWS;
    row.append(el('button.filter-chip.view-save', {
      type: 'button',
      disabled: atCap,
      title: atCap ? `${MAX_VIEWS} views is the limit for one list` : null,
      dataset: { focusKey: 'view-save' },
      onclick: () => openSaveView({ kind, filters, onChanged }),
    },
      el('span', { html: icon('plus', 12, 2.6), 'aria-hidden': 'true' }),
      'Save this view'
    ));
  }

  return row;
}

/** Name it, and it is saved with whatever is on screen. */
function openSaveView({ kind, filters, onChanged }) {
  const name = el('input.input', {
    type: 'text', id: 'view-name', required: true, maxlength: MAX_VIEW_NAME,
    autocomplete: 'off', placeholder: 'e.g. Cold leads in SaaS',
  });
  const asDefault = el('input', { type: 'checkbox', id: 'view-default' });

  const save = async (e) => {
    e.preventDefault();
    const label = name.value.trim();
    if (!label) { name.reportValidity(); return; }
    const view = { name: label, filters, default: asDefault.checked };
    const next = asDefault.checked
      ? [...withDefault(store.views(kind), null), { ...view, default: true }]
      : [...store.views(kind), view];
    try {
      await store.setViews(kind, next);
    } catch {
      fail();
      return;
    }
    modal.close();
    toast(`View “${label}” saved`, { icon: 'check' });
    onChanged?.();
  };

  const form = el('form.form', { onsubmit: save },
    el('p.settings-note.sheet-note', {},
      `Saved with the filters this list has on now: ${filterSummary(kind, filters)}. `
      + 'It re-runs every time you open it.'),
    el('div.settings-body', {},
      el('div.field', {},
        el('label.field-label', { for: 'view-name' }, 'View name'),
        name
      ),
      el('label.check-row', { for: 'view-default' },
        asDefault,
        el('span', {}, `Open ${viewKind(kind)?.label.toLowerCase() || 'this list'} with it`)
      )
    ),
    el('div.form-actions', {},
      el('div.grow'),
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Save view')
    )
  );

  const modal = openModal({ title: 'Save this view', content: form, focusFirst: true });
  return modal;
}

/** Rename, reorder, default, delete - the whole life of a saved view. */
function openViewMenu({ kind, view, onChanged }) {
  const views = store.views(kind);
  const at = views.findIndex((v) => v.id === view.id);

  const write = async (next, message) => {
    try {
      await store.setViews(kind, next);
    } catch {
      fail();
      return;
    }
    modal.close();
    if (message) toast(message, { icon: 'check' });
    onChanged?.();
  };

  const row = (iconName, title, sub, onclick) => el('button.settings-row', {
    type: 'button', onclick,
  },
    el('span.row-ic', { html: icon(iconName, 20, 1.8) }),
    el('div.grow.min0', {},
      el('div.title', {}, title),
      sub && el('div.sub', {}, sub)
    ),
    el('span.row-chev', { html: icon('chevR', 18) })
  );

  const modal = openModal({
    title: view.name,
    content: el('div', {},
      el('div.settings-list', {},
        row('pencil', 'Rename', null, () => {
          modal.close();
          setTimeout(() => openRenameView({ kind, view, onChanged }), 120);
        }),
        row(view.default ? 'circleX' : 'check',
          view.default ? 'Stop opening with this' : 'Open this list with it',
          view.default ? 'The list opens unfiltered again' : 'Applied whenever you arrive',
          () => write(withDefault(views, view.default ? null : view.id),
            view.default ? 'No longer the default' : `${view.name} is the default now`)),
        at > 0 && row('chevU', 'Move earlier', null,
          () => write(reorderViews(views, view.id, -1))),
        at < views.length - 1 && row('chevD', 'Move later', null,
          () => write(reorderViews(views, view.id, 1))),
        row('trash', 'Delete this view', 'The records it filtered are untouched', async () => {
          const ok = await confirmDialog({
            title: `Delete “${view.name}”?`,
            message: 'Only the saved filter set goes. Nothing it matched is affected.',
            confirmLabel: 'Delete view',
          });
          if (!ok) return;
          await write(views.filter((v) => v.id !== view.id), 'View deleted');
        })
      )
    ),
  });
  return modal;
}

function openRenameView({ kind, view, onChanged }) {
  const name = el('input.input', {
    type: 'text', id: 'view-rename', value: view.name, required: true,
    maxlength: MAX_VIEW_NAME, autocomplete: 'off',
  });
  const form = el('form.form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const label = name.value.trim();
      if (!label) { name.reportValidity(); return; }
      const next = store.views(kind).map((v) => (v.id === view.id ? { ...v, name: label } : v));
      try {
        await store.setViews(kind, next);
      } catch {
        fail();
        return;
      }
      modal.close();
      onChanged?.();
    },
  },
    el('div.settings-body', {},
      el('div.field', {},
        el('label.field-label', { for: 'view-rename' }, 'View name'),
        name
      )
    ),
    el('div.form-actions', {},
      el('div.grow'),
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Rename')
    )
  );
  const modal = openModal({ title: 'Rename view', content: form, focusFirst: true });
  return modal;
}
