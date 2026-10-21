/**
 * Stocktake: start a count scoped to a location, a category, or
 * everything; work through the sheet by typing or scanning; review the
 * variance; commit in one pass. The session persists under its own key,
 * so a count survives a lunch break, a reload, or a dead battery.
 */

import { el, clear, CODE_FIELD } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  buildStocktakeRows, stocktakeProgress, stocktakeRowByCode,
  stocktakeVariances, varianceTotals, sortStocktakeRows, hasBinCodes,
  STOCKTAKE_SORTS, stocktakeHistory, countVarianceTotals,
} from '../lib/stocktake.js';
import { NO_LOCATION, UNASSIGNED, UNASSIGNED_LABEL } from '../lib/stock.js';
import { categoriesOf } from '../lib/inventory.js';
import { isCountUnit, formatQtyIn, unitLabel } from '../lib/units.js';
import { formatMoney, formatQty, timeAgo, debounce, downloadFile, dateStamp } from '../lib/util.js';
import { toCSV, escapeFormula, numCell } from '../lib/csv.js';
import { openScanner, listenForScans } from '../ui/scanner.js';
import { printSheet, printTable } from '../ui/print.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

export function stocktakeView() {
  const root = el('div.main-inner');

  /* Sheet-local state that survives re-renders. */
  const ui = { query: '', filter: 'all', flashId: '' };

  /* The count sheet is built once and updated in place. Rebuilding it
     on every store change — and every change here is a count being
     entered — would destroy the field being typed into, so Tabbing
     down the sheet (the whole workflow) dropped focus to the body
     after each entry. */
  let sheet = null;
  let showing = '';
  /* Refreshes the start screen's scope preview without rebuilding it —
     a rebuild would throw away the scope the user just picked. */
  let refreshStart = null;

  const render = () => renderInto();
  store.addEventListener('change', render);

  /* A USB/Bluetooth scanner types anywhere on this view; every scan is
     one item counted. */
  const stopWedge = listenForScans((code) => { handleScan(code); });

  root.destroy = () => {
    store.removeEventListener('change', render);
    stopWedge();
  };

  function renderInto() {
    const next = store.stocktake ? 'sheet' : 'start';
    if (next !== showing) {
      showing = next;
      sheet = null;
      clear(root);
      if (next === 'sheet') buildSheet();
      else renderStart();
      return;
    }
    // Same screen, new data: update it rather than replacing it.
    if (next === 'sheet') refreshSheet();
    else refreshStart?.();
  }

  /* ---------- Start screen ---------- */

  function renderStart() {
    let locationId = null; // null = everywhere, '' = unassigned bucket
    let category = '';
    let blind = false;
    let sortBy = 'name';

    const locSelect = el('select.select', {
      'aria-label': 'Location to count',
      onchange: () => { locationId = locSelect.value === '*' ? null : (locSelect.value === NO_LOCATION ? UNASSIGNED : locSelect.value); syncPreview(); },
    },
      el('option', { value: '*' }, 'Everywhere'),
      store.locations.map((l) => el('option', { value: l.id }, l.name)),
      el('option', { value: NO_LOCATION }, UNASSIGNED_LABEL)
    );

    const catSelect = el('select.select', {
      'aria-label': 'Category to count',
      onchange: () => { category = catSelect.value; syncPreview(); },
    },
      el('option', { value: '' }, 'All categories'),
      categoriesOf(store.products).map((c) => el('option', { value: c }, c))
    );

    const blindCheck = el('input', { type: 'checkbox', id: 'st-blind', onchange: () => { blind = blindCheck.checked; } });
    const binCheck = el('input', { type: 'checkbox', id: 'st-bin', onchange: () => { sortBy = binCheck.checked ? 'bin' : 'name'; } });

    const preview = el('p.hint', { 'aria-live': 'polite' });
    const start = el('button.btn.btn-primary', { html: icon('clipboard', 16, 2) }, ' Start counting');
    function syncPreview() {
      const n = buildStocktakeRows(store.products, { locationId, category }).length;
      preview.textContent = n
        ? `${formatQty(n)} product${n === 1 ? '' : 's'} to count in this scope.`
        : 'Nothing to count in this scope.';
      start.disabled = !n;
    }

    root.append(
      el('div.view-head', {},
        el('div', {},
          el('h1.view-title', {}, 'Stocktake'),
          el('p.view-sub', {}, 'Count a shelf, a category, or the whole store in one pass')
        )
      ),
      el('div.card', {},
        el('div.field-grid', {},
          el('div.field', {},
            el('label', { htmlFor: 'st-loc' }, 'Where'),
            el('div.select-wrap', {}, Object.assign(locSelect, { id: 'st-loc' }))
          ),
          el('div.field', {},
            el('label', { htmlFor: 'st-cat' }, 'Category'),
            el('div.select-wrap', {}, Object.assign(catSelect, { id: 'st-cat' }))
          )
        ),
        el('div.field', {}, el('label.check-row', { htmlFor: 'st-blind' },
          blindCheck,
          el('span', {}, 'Blind count: hide expected quantities while counting')
        ),
        el('label.check-row', { htmlFor: 'st-bin' },
          binCheck,
          el('span', {}, 'Walk the room: order the sheet by bin code instead of by name')
        )),
        el('p.small.muted', {},
          'The list and its expected quantities freeze when you start. Count by scanning or typing; pause anytime. The session keeps itself saved. Products you skip are left untouched.'),
        el('div.row', { style: { marginTop: '12px' } }, preview, el('div.grow'), start)
      )
    );

    start.onclick = async () => {
      start.disabled = true;
      try {
        await store.startStocktake({ locationId, category, blind, sortBy });
      } catch (err) {
        console.error(err);
        start.disabled = false;
        toast('Couldn’t start the count. Check your connection', { icon: 'wifiOff' });
      }
    };

    root.append(pastCounts());

    refreshStart = syncPreview;
    syncPreview();
  }

  /* ---------- Past counts ---------- */

  /**
   * Every committed count, kept. A count is the only moment the app
   * learns what is genuinely missing, and until now everything the
   * review screen showed was computed for one screen and thrown away.
   */
  function pastCounts() {
    const records = stocktakeHistory(store.stocktakes);
    if (!records.length) return null;
    const totals = countVarianceTotals(records);
    const currency = store.settings.currency;
    return el('div', {},
      el('h2.section-title', {}, 'Past counts', el('span.badge', {}, String(records.length))),
      el('div.card', {},
        el('p.small.muted', { style: { marginBottom: '10px' } }, [
          `${records.length} count${records.length === 1 ? '' : 's'} on record`,
          totals.short ? `${formatMoney(totals.short, currency)} short in total` : null,
          totals.over ? `${formatMoney(totals.over, currency)} found` : null,
        ].filter(Boolean).join(' · ')),
        el('div.item-list', {}, records.slice(0, 10).map((record) => el('button.item-row', {
          type: 'button',
          onclick: () => openRecord(record),
        },
          el('span.item-ic', {
            className: `item-ic${record.value < 0 ? ' warn' : (record.value > 0 ? ' ok' : '')}`,
            html: icon('clipboard', 17),
          }),
          el('div.grow', {},
            el('div.title', {}, record.scope?.label || 'Everything'),
            el('div.sub', {}, [
              new Date(record.committedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
              `${formatQty(record.counted)} counted`,
              record.skipped ? `${formatQty(record.skipped)} skipped` : null,
              record.varied ? `${formatQty(record.varied)} differed` : 'everything matched',
            ].filter(Boolean).join(' · '))
          ),
          el('strong', { style: { color: record.value < 0 ? 'var(--danger)' : (record.value > 0 ? 'var(--ok-text)' : null) } },
            record.value ? `${record.value > 0 ? '+' : ''}${formatMoney(record.value, currency)}` : '–'),
          el('span', { html: icon('chevR', 16), style: { color: 'var(--ink-3)' } })
        ))),
        records.length > 10
          ? el('p.small.muted', { style: { marginTop: '10px' } }, `Showing the 10 most recent of ${records.length}.`)
          : null
      )
    );
  }

  /** One kept count, as its own variance report. */
  function openRecord(record) {
    const currency = store.settings.currency;
    const lines = record.lines || [];
    const content = el('div', {},
      el('p.confirm-message', {}, [
        `${record.scope?.label || 'Everything'}, counted ${new Date(record.committedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
        `${formatQty(record.counted)} of ${formatQty(record.total)} counted`,
        record.skipped ? `${formatQty(record.skipped)} skipped` : null,
      ].filter(Boolean).join(' · ')),
      el('p.small.muted', {}, [
        record.varied
          ? `${formatQty(record.varied)} product${record.varied === 1 ? '' : 's'} differed: ${record.value >= 0 ? 'a gain of' : 'a loss of'} ${formatMoney(Math.abs(record.value), currency)} at cost`
          : 'Everything counted matched what the app expected',
        record.unitsShort ? `${formatQty(record.unitsShort)} ${unitLabel('each', record.unitsShort)} short` : null,
        record.unitsOver ? `${formatQty(record.unitsOver)} ${unitLabel('each', record.unitsOver)} over` : null,
      ].filter(Boolean).join(' · ')),
      lines.length
        ? el('div.table-wrap', { style: { margin: '10px 0' } }, el('table.table.compact', {},
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Product'),
            el('th.num', { scope: 'col' }, 'Expected'),
            el('th.num', { scope: 'col' }, 'Counted'),
            el('th.num', { scope: 'col' }, 'Change'),
            el('th.num', { scope: 'col' }, 'Value')
          )),
          el('tbody', {}, lines.map((l) => el('tr', {},
            el('td', {},
              el('div.cell-main', {}, l.name),
              l.sku ? el('div.cell-sub.mono', {}, l.sku) : null
            ),
            el('td.num', {}, formatQtyIn(l.expected, l.unit)),
            el('td.num', {}, formatQtyIn(l.counted, l.unit)),
            el('td.num', { style: { color: l.delta < 0 ? 'var(--danger)' : 'var(--ok-text)', fontWeight: 650 } },
              `${l.delta > 0 ? '+' : ''}${formatQtyIn(l.delta, l.unit)}`),
            el('td.num', {}, formatMoney(l.value, currency))
          )))
        ))
        : el('p.small.muted', { style: { margin: '10px 0' } }, record.rolled
          ? 'This count is old enough that only its totals are kept.'
          : 'No differences to list.'),
      el('div.row.row-end', { style: { marginTop: '12px' } },
        el('button.btn.btn-secondary', { type: 'button', html: icon('fileDown', 15, 2), onclick: () => exportRecord(record) }, ' CSV'),
        el('button.btn.btn-secondary', { type: 'button', html: icon('printer', 15, 2), onclick: () => printRecord(record) }, ' Print'),
        el('button.btn.btn-primary', { onclick: () => modal.close() }, 'Close')
      )
    );
    const modal = openModal({ title: 'Count report', content, wide: true });
  }

  function recordSubtitle(record) {
    return [
      new Date(record.committedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      `${formatQty(record.counted)} of ${formatQty(record.total)} counted`,
      record.skipped ? `${formatQty(record.skipped)} skipped` : null,
      `${record.value >= 0 ? '+' : ''}${formatMoney(record.value, store.settings.currency)} at cost`,
    ].filter(Boolean).join(' · ');
  }

  function printRecord(record) {
    const lines = record.lines || [];
    printSheet(
      lines.length
        ? printTable(
          [{ label: 'Product' }, { label: 'SKU' }, { label: 'Expected', num: true },
            { label: 'Counted', num: true }, { label: 'Change', num: true }, { label: 'Value', num: true }],
          lines.map((l) => [
            l.name, l.sku,
            formatQtyIn(l.expected, l.unit),
            formatQtyIn(l.counted, l.unit),
            `${l.delta > 0 ? '+' : ''}${formatQtyIn(l.delta, l.unit)}`,
            formatMoney(l.value, store.settings.currency),
          ])
        )
        : el('p', {}, 'Only the totals are kept for this count.'),
      {
        title: `Count report: ${record.scope?.label || 'Everything'}`,
        subtitle: recordSubtitle(record),
        foot: 'Variance is valued at what the stock cost when the count was applied.',
      }
    );
  }

  function exportRecord(record) {
    const rows = [
      ['Count report', record.scope?.label || 'Everything'],
      ['Counted', dateStamp(new Date(record.committedAt))],
      ['Rows counted', record.counted],
      ['Rows skipped', record.skipped],
      ['Products differing', record.varied],
      ['Units short', record.unitsShort],
      ['Units over', record.unitsOver],
      ['Variance at cost', numCell(record.value)],
      [],
      ['Product', 'SKU', 'Unit', 'Expected', 'Counted', 'Change', 'Value at cost'],
      ...(record.lines || []).map((l) => [
        escapeFormula(l.name), escapeFormula(l.sku), escapeFormula(l.unit),
        numCell(l.expected), numCell(l.counted), numCell(l.delta), numCell(l.value),
      ]),
    ];
    downloadFile(`stocktake-${dateStamp(new Date(record.committedAt))}.csv`, toCSV(rows));
    toast('Count report exported', { icon: 'fileDown' });
  }

  /* ---------- Count sheet ---------- */

  function visibleRows(session) {
    const q = ui.query.trim().toLowerCase();
    const rows = session.rows.filter((r) => {
      const counted = r.counted !== null && r.counted !== undefined;
      if (ui.filter === 'open' && counted) return false;
      if (ui.filter === 'done' && !counted) return false;
      if (q && !(`${r.name} ${r.sku} ${r.barcode} ${r.bin || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
    // The order the counter walks in, whichever they chose.
    return sortStocktakeRows(rows, session.sortBy);
  }

  /** Build the sheet's lasting chrome; contents follow in refreshSheet. */
  function buildSheet() {
    const search = el('input.input', {
      // The sheet is searched by SKU and barcode as much as by name.
      ...CODE_FIELD,
      type: 'search',
      value: ui.query,
      placeholder: 'Find a product to count',
      'aria-label': 'Search the count sheet',
      oninput: debounce(() => { ui.query = search.value; refreshRows(); }, 150),
    });

    const filterSeg = el('div.segmented', { role: 'group', 'aria-label': 'Show' },
      [
        { key: 'all', label: 'All' },
        { key: 'open', label: 'Uncounted' },
        { key: 'done', label: 'Counted' },
      ].map((o) => el('button', {
        type: 'button',
        dataset: { filter: o.key },
        'aria-pressed': String(ui.filter === o.key),
        onclick: (e) => {
          ui.filter = o.key;
          for (const b of filterSeg.querySelectorAll('button')) {
            b.setAttribute('aria-pressed', String(b.dataset.filter === o.key));
          }
          e.currentTarget.focus();
          refreshRows();
        },
      }, o.label))
    );

    const subLine = el('p.view-sub');
    const progressLine = el('p.small.muted', { 'aria-live': 'polite', style: { margin: 0 } });
    /* By name, or by the walk through the room. Only worth offering
       when the sheet knows where anything is. */
    const sortSeg = el('div.segmented', { role: 'group', 'aria-label': 'Sheet order' },
      STOCKTAKE_SORTS.map((o) => el('button', {
        type: 'button',
        dataset: { sort: o.key },
        'aria-pressed': String((store.stocktake.sortBy || 'name') === o.key),
        onclick: (e) => {
          for (const b of sortSeg.querySelectorAll('button')) {
            b.setAttribute('aria-pressed', String(b.dataset.sort === o.key));
          }
          e.currentTarget.focus();
          store.setStocktakeSort(o.key)
            .catch(() => toast('Couldn’t save the order. Check your connection', { icon: 'wifiOff' }));
        },
      }, o.label))
    );
    sortSeg.hidden = !hasBinCodes(store.stocktake);
    const reviewBtn = el('button.btn.btn-primary', {
      html: icon('check', 16, 2.2),
      onclick: () => openReview(store.stocktake),
    }, ' Review & apply');
    const listWrap = el('div');

    root.append(
      el('div.view-head', {},
        el('div', {},
          el('h1.view-title', {}, 'Stocktake'),
          subLine
        ),
        el('div.view-actions', {},
          el('button.btn.btn-secondary', { html: icon('printer', 16, 2), onclick: () => printCountSheet(store.stocktake) }, ' Print sheet'),
          el('button.btn.btn-secondary.scan-btn', { html: icon('barcode', 16, 2), onclick: startScanning }, ' Scan'),
          el('button.btn.btn-ghost', { onclick: cancelCount }, 'Discard'),
          reviewBtn
        )
      ),
      el('div.toolbar', {},
        el('div.searchbox', { html: icon('search', 16, 2) }, search),
        filterSeg,
        sortSeg,
        el('div.grow'),
        progressLine
      ),
      listWrap
    );

    sheet = { search, listWrap, subLine, progressLine, reviewBtn, sortSeg, rows: new Map(), key: null };
    refreshSheet();
  }

  function refreshSheet() {
    if (!sheet) return;
    const session = store.stocktake;
    const progress = stocktakeProgress(session);
    sheet.subLine.textContent = [
      session.scope.label,
      session.sortBy === 'bin' ? 'in bin order' : null,
      `started ${timeAgo(session.startedAt)}`,
    ].filter(Boolean).join(' · ');
    sheet.sortSeg.hidden = !hasBinCodes(session);
    for (const b of sheet.sortSeg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.sort === (session.sortBy || 'name')));
    }
    sheet.progressLine.textContent = `${formatQty(progress.counted)} of ${formatQty(progress.total)} counted`;
    sheet.reviewBtn.disabled = !progress.counted;
    refreshRows();
  }

  /**
   * Reconcile the visible rows. While the same products are on screen
   * — which is every count entered under the default filter — each row
   * is updated in place, so the field being typed into survives and
   * Tab reaches the next one.
   */
  function refreshRows() {
    const session = store.stocktake;
    if (!sheet || !session) return;
    const rows = visibleRows(session);
    const key = rows.map((r) => r.productId).join('\n');

    if (key === sheet.key) {
      for (const row of rows) syncRow(row, session);
      return;
    }

    // The set really changed (a filter, a search, or a counted row
    // leaving the "Uncounted" list). Hand focus to whatever takes the
    // place of the row that went, so counting doesn't stall.
    const leaving = document.activeElement?.closest?.('[data-product]')?.dataset.product;
    const leavingAt = leaving ? (sheet.key ? sheet.key.split('\n') : []).indexOf(leaving) : -1;
    sheet.key = key;
    sheet.rows.clear();
    clear(sheet.listWrap);

    if (!rows.length) {
      sheet.listWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('search', 26) }),
        el('h3', {}, 'No matching rows'),
        el('p', {}, 'Try a different search or filter.')
      )));
      return;
    }
    sheet.listWrap.append(el('div.item-list', {}, rows.map((r) => countRow(r, session))));

    if (leavingAt >= 0 && !rows.some((r) => r.productId === leaving)) {
      const inputs = sheet.listWrap.querySelectorAll('[data-product] input');
      inputs[Math.min(leavingAt, inputs.length - 1)]?.focus();
    }
  }

  /** Bring one already-rendered row up to date without replacing it. */
  function syncRow(row, session) {
    const parts = sheet.rows.get(row.productId);
    if (!parts) return;
    const { node, input, mark, unit } = parts;
    const counted = row.counted !== null && row.counted !== undefined;
    // Never overwrite what someone is in the middle of typing.
    if (document.activeElement !== input) input.value = counted ? String(row.counted) : '';
    input.placeholder = session.blind ? '–' : String(row.expected);
    mark.className = `item-ic${counted ? ' ok' : ''}`;
    mark.innerHTML = icon(counted ? 'check' : 'clipboard', 17);
    unit.textContent = unitLabel(row.unit, input.valueAsNumber || 2);
    if (ui.flashId === row.productId) {
      ui.flashId = '';
      // Restart the animation on a row that's already on screen.
      node.classList.remove('count-flash');
      void node.offsetWidth;
      node.classList.add('count-flash');
    }
  }

  function countRow(row, session) {
    const counted = row.counted !== null && row.counted !== undefined;
    const whole = isCountUnit(row.unit);
    const input = el('input.input.order-qty', {
      type: 'number', min: 0,
      step: whole ? 1 : 'any',
      inputmode: whole ? 'numeric' : 'decimal',
      value: counted ? String(row.counted) : '',
      placeholder: session.blind ? '–' : String(row.expected),
      'aria-label': `Counted quantity for ${row.name}`,
      onchange: () => {
        const v = input.value.trim();
        store.setStocktakeCount(row.productId, v === '' ? null : input.valueAsNumber)
          .catch(() => toast('Couldn’t save the count. Check your connection', { icon: 'wifiOff' }));
      },
    });
    const mark = el('span.item-ic', { className: `item-ic${counted ? ' ok' : ''}`, html: icon(counted ? 'check' : 'clipboard', 17) });
    const unit = el('span.small.muted', {}, unitLabel(row.unit, input.valueAsNumber || 2));

    const node = el('div.item-row.row-stacks', { dataset: { product: row.productId } },
      mark,
      el('div.grow', {},
        el('div.title', {}, row.name),
        el('div.sub', {}, [
          // Where to look for it, first: the sheet is read standing in
          // front of the shelf.
          row.bin ? `Bin ${row.bin}` : null,
          session.blind ? null : `${formatQtyIn(row.expected, row.unit)} ${unitLabel(row.unit, row.expected)} expected`,
          row.sku,
        ].filter(Boolean).join(' · '))
      ),
      el('div.order-qty-wrap', {}, input, unit)
    );
    sheet.rows.set(row.productId, { node, input, mark, unit });
    if (ui.flashId === row.productId) {
      node.classList.add('count-flash');
      ui.flashId = '';
    }
    return node;
  }

  /**
   * A scan is one item in hand: bump its row, or focus it for amounts.
   * Returns the row it landed on — callers need to tell a counted item
   * from a measured one — or null when the code isn't in this count.
   */
  async function handleScan(code) {
    const session = store.stocktake;
    if (!session) return null;
    const row = stocktakeRowByCode(session, code);
    if (!row) {
      toast(`No product with code ${code} in this count`, { icon: 'circleAlert' });
      return null;
    }
    ui.flashId = row.productId;
    if (isCountUnit(row.unit)) {
      await store.setStocktakeCount(row.productId, (Number(row.counted) || 0) + 1)
        .catch(() => toast('Couldn’t save the count. Check your connection', { icon: 'wifiOff' }));
    } else {
      // Measured stock (kg, m) isn't counted one scan at a time; jump
      // to the row so the amount can be read off the scale and typed.
      render();
    }
    requestAnimationFrame(() => {
      // Ids are generated, but a restored backup can hold anything; a
      // quote in one would make this selector throw instead of scroll.
      const node = root.querySelector(`[data-product="${CSS.escape(row.productId)}"]`);
      // The sheet travels to the row a scan just counted, so the jump
      // reads as a move rather than a redraw. Asked for less motion, it
      // arrives there without the travel — the stylesheet's blanket
      // rule can only reach animations and transitions, not a scroll
      // this asks for by name.
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      node?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      if (!isCountUnit(row.unit)) node?.querySelector('input')?.focus();
    });
    return row;
  }

  function startScanning() {
    const scanner = openScanner({
      title: 'Scan to count',
      hint: 'Each scan counts one item. The scanner stays open for the next.',
      continuous: true,
      onCode: async (code) => {
        const row = await handleScan(code);
        // A measured row (kg, m) has no count to bump — the amount comes
        // off a scale and has to be typed. Behind the scanner that row is
        // inert, so focusing it did nothing, while "Ready for the next
        // one" claimed a count that never happened. Step out of the way
        // instead, and land on the field the amount goes in.
        if (row && !isCountUnit(row.unit)) {
          scanner.close();
          toast(`${row.name} is measured. Type the amount`, { icon: 'info' });
        }
      },
    });
  }

  async function cancelCount() {
    const progress = stocktakeProgress(store.stocktake);
    const ok = await confirmDialog({
      title: 'Discard this count?',
      message: progress.counted
        ? `${progress.counted} counted row${progress.counted === 1 ? ' is' : 's are'} thrown away and nothing about stock changes.`
        : 'The session is discarded; nothing about stock changes.',
      confirmLabel: 'Discard count',
    });
    if (!ok) return;
    try {
      await store.cancelStocktake();
    } catch (err) {
      console.error(err);
      toast('Couldn’t discard. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* ---------- Review & apply ---------- */

  function openReview(session) {
    const progress = stocktakeProgress(session);
    const variances = stocktakeVariances(session, store.products);
    const totals = varianceTotals(variances);
    const currency = store.settings.currency;
    const matched = progress.counted - variances.length;
    const skipped = progress.total - progress.counted;

    const apply = el('button.btn.btn-primary', {
      onclick: async () => {
        apply.disabled = true;
        try {
          const n = await store.applyStocktake();
          modal.close();
          toast(n ? `Count applied: ${n} product${n === 1 ? '' : 's'} adjusted` : 'Count applied: everything matched', { icon: 'check' });
        } catch (err) {
          console.error(err);
          apply.disabled = false;
          toast('Couldn’t apply. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Apply count');

    const content = el('div', {},
      el('p.confirm-message', {},
        variances.length
          ? `${variances.length} product${variances.length === 1 ? ' differs' : 's differ'} from the expected count: ${totals.value >= 0 ? 'a gain of' : 'a loss of'} ${formatMoney(Math.abs(totals.value), currency)} at cost.`
          : 'Every counted product matched what the app expected.'),
      variances.length
        ? el('div.table-wrap', { style: { margin: '10px 0' } }, el('table.table.compact', {},
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Product'),
            el('th.num', { scope: 'col' }, 'Expected'),
            el('th.num', { scope: 'col' }, 'Counted'),
            el('th.num', { scope: 'col' }, 'Change'),
            el('th.num', { scope: 'col' }, 'Value')
          )),
          el('tbody', {}, variances.map((v) => el('tr', {},
            el('td', {}, el('div.cell-main', {}, v.name)),
            el('td.num', {}, formatQtyIn(v.expected, v.unit)),
            el('td.num', {}, formatQtyIn(v.counted, v.unit)),
            el('td.num', { style: { color: v.delta < 0 ? 'var(--danger)' : 'var(--ok-text)', fontWeight: 650 } },
              `${v.delta > 0 ? '+' : ''}${formatQtyIn(v.delta, v.unit)}`),
            el('td.num', {}, formatMoney(v.value, currency))
          )))
        ))
        : null,
      el('p.small.muted', {}, [
        matched ? `${matched} counted row${matched === 1 ? '' : 's'} matched` : null,
        skipped ? `${skipped} skipped row${skipped === 1 ? ' stays' : 's stay'} untouched` : null,
        'A snapshot is taken first, so this is recoverable.',
      ].filter(Boolean).join(' · ')),
      el('div.row.row-end', { style: { marginTop: '12px' } },
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Keep counting'),
        apply
      )
    );

    const modal = openModal({ title: 'Review the count', content, wide: true });
  }

  /* ---------- Paper ---------- */

  /** A clipboard sheet: the frozen list with a blank column to write in. */
  function printCountSheet(session) {
    const bins = hasBinCodes(session);
    printSheet(
      printTable(
        [...(bins ? [{ label: 'Bin' }] : []), { label: 'Product' }, { label: 'SKU' },
          ...(session.blind ? [] : [{ label: 'Expected', num: true }]),
          { label: 'Counted', num: true }],
        // On paper as on screen: the order the counter walks in.
        sortStocktakeRows(session.rows, session.sortBy).map((r) => [
          ...(bins ? [r.bin || ''] : []),
          r.name, r.sku,
          ...(session.blind ? [] : [`${formatQtyIn(r.expected, r.unit)} ${unitLabel(r.unit, r.expected)}`]),
          '',
        ])
      ),
      {
        title: `Count sheet: ${session.scope.label}`,
        subtitle: `${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
          + ` · ${session.rows.length} product${session.rows.length === 1 ? '' : 's'}`
          + (session.sortBy === 'bin' ? ' · in bin order' : ''),
        foot: 'Leave a row blank to skip it. Skipped products stay untouched when the count is applied.',
      }
    );
  }

  render();
  return root;
}
