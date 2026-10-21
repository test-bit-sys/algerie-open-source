/**
 * History: the full activity log, filterable by product, kind, and date
 * range, grouped by day, and exportable as CSV. Older entries live in
 * month buckets the store loads on demand ("Load older").
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  ACTIVITY_KINDS, REMOVAL_REASONS, activityLabel, kindIcon, kindLabel, reasonLabel,
  filterActivity, groupByDay, dayLabel, monthLabel, mergeEntries,
} from '../lib/activity.js';
import { activityToCSV } from '../lib/csv.js';
import { formatQty, formatMoney, round2, downloadFile, dateStamp, debounce } from '../lib/util.js';
import { formatQtyIn, unitLabel } from '../lib/units.js';
import { openStockForm } from '../ui/stockform.js';
import { toast } from '../ui/toast.js';

const KIND_CHIPS = [{ key: '', label: 'All' }, ...ACTIVITY_KINDS];
const REASON_KEYS = ['unspecified', ...REMOVAL_REASONS.map((r) => r.key)];

export function historyView() {
  const root = el('div.main-inner');

  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = {
    query: '',
    kind: ACTIVITY_KINDS.some((k) => k.key === params.get('kind')) ? params.get('kind') : '',
    productId: params.get('product') || '',
    reason: REASON_KEYS.includes(params.get('reason')) ? params.get('reason') : '',
    from: '',
    to: '',
  };
  // A reason only means anything on removals; a shared URL saying
  // otherwise would filter everything out with no chip showing why.
  if (state.kind !== 'remove') state.reason = '';

  /** Archived months pulled in so far, oldest-loadable first. */
  const loaded = [];
  let loading = false;

  const listWrap = el('div');
  const countLine = el('p.small.muted', { 'aria-live': 'polite', style: { margin: '0 0 10px' } });

  const search = el('input.input', {
    type: 'search',
    placeholder: 'Search product or note',
    'aria-label': 'Search history',
    oninput: debounce(() => { state.query = search.value; render(); }, 150),
  });

  const productSelect = el('select.select', {
    'aria-label': 'Filter by product',
    onchange: () => { state.productId = productSelect.value; syncUrl(); render(); },
  });
  function fillProducts() {
    const v = state.productId;
    clear(productSelect);
    productSelect.append(el('option', { value: '' }, 'All products'));
    for (const p of [...store.products].sort((a, b) => a.name.localeCompare(b.name))) {
      productSelect.append(el('option', { value: p.id }, p.name));
    }
    // A filtered product that has since been deleted still deserves a
    // label — its entries are exactly what the audit trail is for.
    if (v && !store.productById(v)) {
      const name = allEntries().find((a) => a.productId === v)?.name;
      productSelect.append(el('option', { value: v }, name ? `${name} (deleted)` : 'Deleted product'));
    }
    productSelect.value = v;
  }

  const fromInput = dateInput('From', () => { state.from = fromInput.value; syncRange(); render(); });
  const toInput = dateInput('To', () => { state.to = toInput.value; syncRange(); render(); });

  function dateInput(label, onChange) {
    return el('input.input.date-input', { type: 'date', 'aria-label': `${label} date`, onchange: onChange });
  }

  /* Each end bounds the other, and neither reaches past today: a range
     that can't hold anything isn't worth offering in the picker. */
  function syncRange() {
    const today = dateStamp();
    fromInput.max = state.to || today;
    toInput.min = state.from || '';
    toInput.max = today;
  }

  const chips = el('div.chips', { role: 'group', 'aria-label': 'Activity type filter' });
  function renderChips() {
    clear(chips);
    for (const c of KIND_CHIPS) {
      chips.append(el('button.chip', {
        type: 'button',
        dataset: { key: c.key },
        'aria-pressed': String(state.kind === c.key),
        onclick: () => {
          state.kind = c.key;
          // The reason sub-filter belongs to Removed; leaving it armed
          // under another chip would silently empty the list.
          if (c.key !== 'remove') state.reason = '';
          syncUrl();
          // Press states move in place: a rebuild would destroy the
          // chip under the user's keyboard focus.
          for (const b of chips.querySelectorAll('.chip')) {
            b.setAttribute('aria-pressed', String(b.dataset.key === c.key));
          }
          renderReasonChips();
          render();
        },
      }, c.label));
    }
  }

  /* Reason sub-filter, shown while the Removed chip is active. */
  const reasonChips = el('div.chips', { role: 'group', 'aria-label': 'Removal reason filter' });
  const reasonBar = el('div.toolbar', { hidden: true }, reasonChips);
  function renderReasonChips() {
    reasonBar.hidden = state.kind !== 'remove';
    clear(reasonChips);
    if (reasonBar.hidden) return;
    const options = [
      { key: '', label: 'All reasons' },
      ...REMOVAL_REASONS,
      // Entries from before reasons existed; only worth offering if any.
      ...(state.reason === 'unspecified' || allEntries().some((a) => a.kind === 'remove' && !a.reason)
        ? [{ key: 'unspecified', label: 'Unspecified' }]
        : []),
    ];
    for (const r of options) {
      reasonChips.append(el('button.chip', {
        type: 'button',
        dataset: { key: r.key },
        'aria-pressed': String(state.reason === r.key),
        onclick: () => {
          state.reason = r.key;
          syncUrl();
          for (const b of reasonChips.querySelectorAll('.chip')) {
            b.setAttribute('aria-pressed', String(b.dataset.key === r.key));
          }
          render();
        },
      }, r.label));
    }
  }

  /* Keep the URL truthful so refresh and share preserve the filter.
     replaceState does not fire hashchange, so the view stays put. */
  function syncUrl() {
    const q = new URLSearchParams();
    if (state.productId) q.set('product', state.productId);
    if (state.kind) q.set('kind', state.kind);
    if (state.reason) q.set('reason', state.reason);
    const qs = q.toString();
    history.replaceState(null, '', qs ? `#/history?${qs}` : '#/history');
  }

  const clearBtn = el('button.btn.btn-ghost', {
    type: 'button',
    onclick: () => {
      Object.assign(state, { query: '', kind: '', productId: '', reason: '', from: '', to: '' });
      search.value = '';
      fromInput.value = '';
      toInput.value = '';
      productSelect.value = '';
      syncRange();
      syncUrl();
      renderChips();
      renderReasonChips();
      render();
      // This button hides itself once the filters are gone; focus
      // moves to the search box rather than falling to <body>.
      search.focus();
    },
  }, 'Clear filters');

  root.append(
    el('div.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'History'),
        el('p.view-sub', {}, 'Every stock change, in order')
      ),
      el('div.view-actions', {},
        el('button.btn.btn-secondary', { html: icon('fileDown', 16, 2), onclick: exportCSV }, ' Export')
      )
    ),
    el('div.toolbar', {},
      el('div.searchbox', { html: icon('search', 16, 2) }, search),
      el('div.select-wrap', { style: { minWidth: '170px' } }, productSelect),
      el('div.date-range', {},
        el('span.date-end', {}, el('span.small.muted', {}, 'From'), fromInput),
        el('span.date-end', {}, el('span.small.muted', {}, 'to'), toInput)
      ),
      clearBtn
    ),
    el('div.toolbar', {}, chips),
    reasonBar,
    countLine,
    listWrap
  );

  const allEntries = () => mergeEntries(store.activity, ...loaded.map((l) => l.entries));

  async function exportCSV() {
    // The export is the whole log the filters describe, not just the
    // months scrolled in so far — bookkeeping shouldn't depend on how
    // many times "Load older" was pressed.
    let archived = {};
    try {
      archived = await store.loadAllArchives();
    } catch (err) {
      console.error(err);
      toast('Couldn’t load older history. Check your connection', { icon: 'wifiOff' });
      return;
    }
    const rows = filterActivity(mergeEntries(store.activity, ...Object.values(archived)), state);
    if (!rows.length) {
      toast('Nothing to export yet', { icon: 'info' });
      return;
    }
    downloadFile(`inventory-history-${dateStamp()}.csv`,
      activityToCSV(rows, {
        products: store.products,
        label: (a) => kindLabel(a.kind),
        reason: (a) => reasonLabel(a.reason),
      }));
    toast(`Exported ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`, { icon: 'fileDown' });
  }

  /** Months not pulled in yet, newest first. */
  const pendingMonths = () => store.archives.filter((a) => !loaded.some((l) => l.month === a.month));

  async function loadOlder() {
    const next = pendingMonths()[0];
    if (!next || loading) return;
    loading = true;
    render();
    try {
      loaded.push({ month: next.month, entries: await store.loadArchive(next.month) });
      fillProducts();
    } catch (err) {
      console.error(err);
      toast('Couldn’t load older history', { icon: 'wifiOff' });
    } finally {
      loading = false;
      render();
      // The button that was pressed left with the render it triggered.
      // Focus follows to its replacement — the next month's button, or
      // the note that took its place once the log runs out — rather than
      // dropping to <body> and making a keyboard user Tab back down from
      // the top of the page for every month they load.
      listWrap.querySelector('.older-footer button, .older-footer p')?.focus();
    }
  }

  /* Refreshed per render: entryRow only needs "does it still exist",
     and answering that with a per-row store.productById would put a
     linear scan of the products inside a loop over the log. */
  let liveIds = new Set();

  function render() {
    liveIds = new Set(store.products.map((p) => p.id));
    const entries = allEntries();
    const rows = filterActivity(entries, state);
    const filtered = rows.length !== entries.length;
    countLine.textContent = entries.length
      ? `${formatQty(rows.length)}${filtered ? ` of ${formatQty(entries.length)}` : ''} ${rows.length === 1 && !filtered ? 'entry' : 'entries'}`
      : '';
    clearBtn.hidden = !(state.query || state.kind || state.productId || state.reason || state.from || state.to);

    clear(listWrap);
    if (!rows.length) {
      listWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon(entries.length ? 'search' : 'history', 26) }),
        el('h3', {}, entries.length ? 'No matching activity' : 'No activity yet'),
        el('p', {}, entries.length
          ? 'Try a different search, type, or date range.'
          : 'Receiving, removing, and recounting stock all show up here.')
      )));
    } else {
      for (const day of groupByDay(rows)) listWrap.append(dayCard(day));
    }
    listWrap.append(olderFooter());
  }

  function dayCard(day) {
    return el('section.day-group', { 'aria-label': dayLabel(day.at) },
      el('header.day-head', {},
        el('h2.day-title', {}, dayLabel(day.at)),
        el('span.day-net', {},
          day.in ? el('span.activity-delta.pos', {}, `+${formatQty(day.in)}`) : null,
          day.out ? el('span.activity-delta.neg', {}, `-${formatQty(day.out)}`) : null
        )
      ),
      el('div.item-list', {}, day.entries.map(entryRow))
    );
  }

  function entryRow(a) {
    const live = a.productId && liveIds.has(a.productId);
    const time = new Date(a.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const money = (n) => formatMoney(n, store.settings.currency);
    // What a receipt cost, when it was recorded — the number owners go
    // hunting for at reorder time.
    const paid = a.kind === 'add' && a.cost !== null && a.cost !== undefined
      ? `paid ${money(a.cost)} per ${unitLabel(a.unit, 1)}`
      : null;
    // And the other side of it: what a sale took in. The log is the
    // whole record of the money, not just the money going out.
    const units = Math.abs(Number(a.delta) || 0);
    const sold = a.kind === 'remove' && a.price !== null && a.price !== undefined
      ? `sold at ${money(a.price)} per ${unitLabel(a.unit, 1)}`
        + (units > 1 ? ` · ${money(round2(Number(a.price) * units))} total` : '')
      : null;
    return el(live ? 'button.item-row' : 'div.item-row', {
      type: live ? 'button' : null,
      onclick: live ? () => openStockForm(a.productId) : null,
    },
      el('span.item-ic', { html: icon(kindIcon(a.kind), 17) }),
      el('div.grow', {},
        el('div.title', {}, a.name || kindLabel(a.kind)),
        el('div.sub', {}, [activityLabel(a), paid, sold, a.note].filter(Boolean).join(' · '))
      ),
      a.delta ? el('span.activity-delta', { className: `activity-delta ${a.delta > 0 ? 'pos' : 'neg'}` },
        `${a.delta > 0 ? '+' : ''}${formatQtyIn(a.delta, a.unit)}`) : null,
      el('span.small.muted', { style: { whiteSpace: 'nowrap' } }, time)
    );
  }

  /** "Load older" / retention note under the list. */
  function olderFooter() {
    const pending = pendingMonths();
    const wrap = el('div.older-footer', { style: { marginTop: '14px', textAlign: 'center' } });
    if (pending.length) {
      append(wrap, [
        el('button.btn.btn-secondary', { type: 'button', disabled: loading, onclick: loadOlder },
          loading
            ? 'Loading…'
            : `Load ${monthLabel(pending[0].month)} (${formatQty(pending[0].count)} entr${pending[0].count === 1 ? 'y' : 'ies'})`),
      ]);
    } else if (loaded.length) {
      // tabindex -1: nothing here is a control any more, but the last
      // press still has to hand focus somewhere — and landing on this
      // is what says the log ran out (see loadOlder).
      wrap.append(el('p.small.muted', { tabindex: -1 }, 'That’s the whole log.'));
    }
    return wrap;
  }

  const rerender = () => { fillProducts(); renderReasonChips(); render(); };
  store.addEventListener('change', rerender);
  root.destroy = () => store.removeEventListener('change', rerender);

  fillProducts();
  renderChips();
  renderReasonChips();
  syncRange();
  render();
  return root;
}
