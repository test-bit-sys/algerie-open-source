import { el, clear, CODE_FIELD } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { filterProducts, sortProducts, statusOf, STATUS_LABELS, categoriesOf, SORTS } from '../lib/inventory.js';
import { groupVariantRows, familyAsProduct, variantLabel } from '../lib/variants.js';
import { kitMode, buildableQty, limitingComponent, kitUnitCost } from '../lib/kits.js';
import { formatMoney, debounce, downloadFile, dateStamp } from '../lib/util.js';
import { formatQtyIn, unitLabel, isCountUnit, packSizeOf, packLabel } from '../lib/units.js';
import {
  stockEntries, NO_LOCATION, UNASSIGNED_LABEL, hasMinimums, minAt, shortfallAt, bucketKey,
  binAt,
} from '../lib/stock.js';
import { onOrderQty } from '../lib/reorder.js';
import { demandRates, coverDays, coverLabel, rateLabel, runningOut } from '../lib/demand.js';
import { productsToCSV } from '../lib/csv.js';
import { openProductForm } from '../ui/productform.js';
import { openStockForm } from '../ui/stockform.js';
import { openImporter } from '../ui/importer.js';
import { openBulkEditForm } from '../ui/bulkform.js';
import { openFamilyForm, openVariantForm } from '../ui/familyform.js';
import { openLabelForm } from '../ui/labelform.js';
import { printView } from '../ui/print.js';
import { confirmDialog } from '../ui/modal.js';
import { openScanner, listenForScans } from '../ui/scanner.js';
import { productThumb, resetLazyThumbs } from '../ui/photo.js';
import { productHref } from './product.js';
import { deletePhoto } from '../lib/photos.js';
import { toast } from '../ui/toast.js';

const STATUS_CHIPS = [
  { key: '', label: 'All' },
  { key: 'alerts', label: 'Needs attention' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
  // Only worth offering once the log knows something is emptying faster
  // than it can be restocked — the chip has nothing to show otherwise.
  { key: 'cover', label: 'Running out soon', when: (ctx) => ctx.demand.urgent.size > 0 },
  // "Below minimum" is a question about one place; with a location
  // filter on it names that place, and without one it means anywhere.
  {
    key: 'belowmin',
    label: (ctx) => (store.locationById(ctx.locationId) ? 'Below minimum here' : 'Below minimum'),
    when: () => store.products.some((p) => !p.archived && hasMinimums(p)),
  },
  // Only worth offering once a product tracks expiry dates.
  { key: 'expiring', label: 'Expiring soon', when: () => store.products.some((p) => p.trackExpiry && !p.archived) },
  // Only worth offering once something is archived.
  { key: 'archived', label: 'Archived', when: () => store.products.some((p) => p.archived) },
];

export function productsView() {
  const root = el('div.main-inner');

  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const state = {
    query: '',
    status: ['low', 'out', 'alerts', 'expiring', 'cover', 'belowmin', 'archived'].includes(params.get('status')) ? params.get('status') : '',
    locationId: params.get('location') || '',
    supplierId: params.get('supplier') || '',
    category: params.get('category') || '',
    sort: 'name',
    dir: 1,
  };

  const listWrap = el('div');
  const countLine = el('p.small.muted', { 'aria-live': 'polite', style: { margin: '0 0 10px' } });
  const bulkBar = el('div.bulk-bar', { hidden: true, role: 'region', 'aria-label': 'Bulk actions' });

  /* One layout at a time. The table and the cards show the same rows
     for different pointers, and CSS hides whichever doesn't apply — so
     building both meant every product cost twice the DOM, twice the
     listeners, and two thumbnail reads, with half of it invisible.
     The same query the stylesheet uses, so nothing falls between the
     two breakpoints. */
  const narrow = matchMedia('(max-width: 900px)');
  /* Paper always gets the table, at any width (see print.css). */
  let printing = false;
  const layout = () => (!printing && narrow.matches ? 'cards' : 'table');

  /* --- Selection ---
     Ids, not rows, so a selection survives filtering and re-rendering.
     On mobile there are no hover affordances, so checkboxes appear only
     once selection mode is on (a long press, or the Select button). */
  const selected = new Set();
  let selectMode = false;
  let lastPicked = -1;
  let lastRowsKey = '';
  /* Families opened out into their variants. Ids, so the state survives
     filtering, sorting, and every re-render. */
  const expanded = new Set();
  /* What each family row on screen stands for, by family id — the
     filtered variants, not all of them. Ticking one variant has to bring
     its family's own checkbox back in line, and that box is a row of its
     own that nothing else would update. */
  const familyOf = new Map();

  const toggle = (id, on) => (on ? selected.add(id) : selected.delete(id));

  /**
   * Put focus back on the checkbox a rebuild replaced. Selecting is the
   * one thing here that can rewrite the whole list under the control
   * being used — Shift+Space extends a selection, and a family's box
   * opens or closes rows — and without this the keyboard lands on
   * <body> and has to Tab down from the top of the page again.
   */
  function focusPick(id) {
    listWrap.querySelector(`[data-pick="${CSS.escape(id)}"]`)?.focus();
  }

  /**
   * Bring a family's checkbox back in line with its variants, in place.
   * Ticking a variant is one tap on one card, so it deliberately doesn't
   * rebuild the list — but the family row above it must not go on
   * claiming that nothing underneath it is picked.
   */
  function syncFamilyPick(familyId) {
    const box = listWrap.querySelector(`[data-pick="${CSS.escape(familyId)}"]`);
    const variants = familyOf.get(familyId);
    if (!box || !variants?.length) return;
    const all = variants.every((product) => selected.has(product.id));
    const some = !all && variants.some((product) => selected.has(product.id));
    box.checked = all;
    box.indeterminate = some;
    box.closest('.product-card, tr')?.classList.toggle('is-picked', all || some);
  }

  /** Shift-click: apply the clicked state across the whole span. */
  function extendSelection(rows, index, on) {
    if (lastPicked < 0 || lastPicked >= rows.length) return;
    const [from, to] = index < lastPicked ? [index, lastPicked] : [lastPicked, index];
    // A family row stands for its variants; the span covers what the
    // rows actually represent, not the rows themselves.
    for (let i = from; i <= to; i++) {
      for (const product of rowProducts(rows[i])) toggle(product.id, on);
    }
    renderList();
    focusPick(rows[index].id);
  }

  /* --- Toolbar --- */
  const search = el('input.input', {
    // SKUs and barcodes are typed and scanned in here as often as names.
    ...CODE_FIELD,
    type: 'search',
    placeholder: 'Search name, SKU, barcode, bin, or category',
    'aria-label': 'Search products',
    oninput: debounce(() => { state.query = search.value; renderList(); }, 150),
  });

  /* Keep the URL truthful so refresh and share preserve every filter the
     view reads back out of it — dropping one would reload a different
     list than the one on screen. replaceState does not fire hashchange,
     so the view stays put. */
  function syncUrl() {
    const q = new URLSearchParams();
    if (state.status) q.set('status', state.status);
    if (state.locationId) q.set('location', state.locationId);
    if (state.supplierId) q.set('supplier', state.supplierId);
    if (state.category) q.set('category', state.category);
    const qs = q.toString();
    history.replaceState(null, '', qs ? `#/products?${qs}` : '#/products');
  }

  /* Selection mode is entered here or by a long press, and left here or
     via the bulk bar's X — the label follows the mode either way, so the
     button never silently means "exit and drop the selection". */
  const selectToggle = el('button.btn.btn-ghost.select-toggle', {
    type: 'button',
    'aria-pressed': 'false',
    onclick: () => {
      selectMode = !selectMode;
      if (!selectMode) selected.clear();
      renderList();
    },
  }, 'Select');

  /* What the activity log knows about how fast things leave: a rate per
     product, the days of cover that implies, and which shelves will
     empty before a restock could land. Derived per render — it depends
     on the log, not on the products — and shared by the chip, the
     filter, the sort, and the rows. */
  function demandInfo() {
    const { rates, days, enough } = demandRates(store.activity);
    const safetyDays = store.settings.safetyDays;
    const cover = new Map();
    const urgent = new Set();
    for (const p of store.products) {
      if (p.archived) continue;
      const perDay = rates.get(p.id) || 0;
      const c = coverDays(p, perDay);
      if (c === null) continue;
      cover.set(p.id, c);
      const leadTimeDays = store.supplierById(p.supplierId)?.leadTimeDays;
      if (runningOut(p, { perDay, leadTimeDays, safetyDays })) urgent.add(p.id);
    }
    return { rates, days, enough, cover, urgent };
  }

  const chips = el('div.chips', { role: 'group', 'aria-label': 'Stock status filter' });
  function renderChips() {
    clear(chips);
    // What a chip needs to decide whether it applies, and what to call
    // itself: the log's view of demand, and the filter it sits next to.
    const ctx = { demand: demandInfo(), locationId: state.locationId };
    for (const c of STATUS_CHIPS) {
      // Keep the active chip even if its condition just stopped holding
      // (restoring the last archived product), or the filter would be on
      // with nothing to switch it off.
      if (c.when && !c.when(ctx) && state.status !== c.key) continue;
      chips.append(el('button.chip', {
        type: 'button',
        dataset: { key: c.key },
        'aria-pressed': String(state.status === c.key),
        onclick: () => {
          state.status = c.key;
          syncUrl();
          // Press states move in place: rebuilding the group would
          // destroy the chip under the user's keyboard focus.
          for (const b of chips.querySelectorAll('.chip')) {
            b.setAttribute('aria-pressed', String(b.dataset.key === c.key));
          }
          renderList();
        },
      }, typeof c.label === 'function' ? c.label(ctx) : c.label));
    }
  }

  const locSelect = filterSelect('Filter by location',
    () => [...store.locations, { id: NO_LOCATION, name: UNASSIGNED_LABEL }],
    // renderChips too: "Below minimum here" names the place the picker
    // holds, so it has to be rebuilt when that changes.
    (v) => { state.locationId = v; syncUrl(); renderChips(); renderList(); },
    'All locations');
  if (state.locationId) {
    locSelect.value = state.locationId;
    // A shared or stale URL can name a location that no longer exists;
    // filtering by it would empty the list while the select claims no
    // filter is on.
    if (locSelect.value !== state.locationId) { state.locationId = ''; syncUrl(); }
  }
  const supSelect = filterSelect('Filter by supplier', () => store.suppliers, (v) => { state.supplierId = v; syncUrl(); renderList(); }, 'All suppliers');
  if (state.supplierId) {
    supSelect.value = state.supplierId;
    if (supSelect.value !== state.supplierId) { state.supplierId = ''; syncUrl(); }
  }
  const catSelect = filterSelect('Filter by category',
    () => categoriesOf(store.products).map((c) => ({ id: c, name: c })),
    (v) => { state.category = v; syncUrl(); renderList(); }, 'All categories');
  if (state.category) {
    catSelect.value = state.category;
    if (catSelect.value !== state.category) { state.category = ''; syncUrl(); }
  }

  function filterSelect(label, items, onPick, allLabel) {
    const sel = el('select.select', {
      'aria-label': label,
      onchange: () => onPick(sel.value),
    });
    sel.refill = () => {
      const v = sel.value;
      clear(sel);
      sel.append(el('option', { value: '' }, allLabel));
      for (const it of items()) sel.append(el('option', { value: it.id }, it.name));
      const kept = [...sel.options].some((o) => o.value === v);
      sel.value = kept ? v : '';
      // The filtered-by thing was deleted out from under the filter
      // (a location or supplier removed, a category renamed away).
      // Clear the state too, or the list stays invisibly filtered by
      // something the select no longer shows.
      if (!kept && v) onPick('');
    };
    sel.refill();
    return sel;
  }

  /* --- Header --- */
  root.append(
    el('div.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Products'),
        el('p.view-sub', {}, 'Everything you stock, in one list')
      ),
      el('div.view-actions', {},
        el('button.btn.btn-secondary.scan-btn', { html: icon('barcode', 16, 2), onclick: () => startScanning() }, ' Scan'),
        el('button.btn.btn-secondary', { html: icon('fileUp', 16, 2), onclick: () => openImporter() }, ' Import'),
        el('button.btn.btn-secondary', { html: icon('fileDown', 16, 2), onclick: exportCSV }, ' Export'),
        el('button.btn.btn-secondary', {
          html: icon('printer', 16, 2),
          title: 'Print the list as filtered',
          onclick: () => printView(),
        }, ' Print'),
        el('button.btn.btn-primary', { html: icon('plus', 16, 2.2), onclick: () => openProductForm() }, ' Add product')
      )
    ),
    el('div.toolbar', {},
      el('div.searchbox', { html: icon('search', 16, 2) }, search),
      el('div.select-wrap', {}, locSelect),
      el('div.select-wrap', {}, supSelect),
      el('div.select-wrap', {}, catSelect)
    ),
    el('div.toolbar', {},
      chips,
      el('div.grow'),
      selectToggle
    ),
    countLine,
    listWrap,
    bulkBar
  );

  /* --- Bulk actions --- */

  /**
   * Publish the bar's height so a toast can sit above it instead of on
   * its buttons. offsetHeight, not a content box: the bar's padding
   * carries the safe-area inset the toast has to clear as well.
   */
  function measureBulkBar() {
    if (bulkBar.hidden) document.body.style.removeProperty('--bulk-bar-h');
    else document.body.style.setProperty('--bulk-bar-h', `${bulkBar.offsetHeight}px`);
  }

  function renderBulkBar() {
    // Products can vanish under a selection (deleted in another tab, or
    // by the last action); only count what still exists. Indexed once,
    // not looked up per selected id — this runs on every keystroke.
    const byId = selected.size ? new Map(store.products.map((p) => [p.id, p])) : null;
    if (byId) for (const id of selected) if (!byId.has(id)) selected.delete(id);
    const ids = [...selected];
    bulkBar.hidden = !ids.length;
    // The bar lands exactly where the mobile add button floats, so that
    // button stands down while the selection owns the corner.
    document.body.classList.toggle('has-bulk-bar', ids.length > 0);
    if (!ids.length) {
      measureBulkBar();
      return;
    }

    const picked = ids.map((id) => byId.get(id));
    const anyActive = picked.some((p) => !p.archived);
    clear(bulkBar);
    bulkBar.append(el('div.bulk-bar-inner', {},
      el('strong', {}, `${ids.length} selected`),
      el('div.grow'),
      el('button.btn.btn-secondary', {
        type: 'button', html: icon('edit', 15, 2),
        onclick: () => openBulkEditForm(ids, { onSaved: () => { selected.clear(); renderList(); } }),
      }, ' Edit'),
      el('button.btn.btn-secondary', {
        type: 'button', html: icon('fileDown', 15, 2), onclick: () => exportSelected(picked),
      }, ' Export'),
      el('button.btn.btn-secondary', {
        type: 'button', html: icon('barcode', 15, 2),
        onclick: () => openLabelForm(ids),
      }, ' Labels'),
      el('button.btn.btn-secondary', {
        type: 'button', html: icon(anyActive ? 'archive' : 'archiveRestore', 15, 2),
        onclick: () => bulkArchive(ids, anyActive),
      }, anyActive ? ' Archive' : ' Restore'),
      el('button.btn.btn-secondary.danger-text', {
        type: 'button', html: icon('trash', 15, 2), onclick: () => bulkDelete(ids),
      }, ' Delete'),
      el('button.icon-btn', {
        type: 'button', html: icon('x', 18), 'aria-label': 'Clear selection',
        onclick: () => { selected.clear(); selectMode = false; renderList(); },
      })
    ));
    measureBulkBar();
  }

  function exportSelected(picked) {
    downloadFile(`inventory-selection-${dateStamp()}.csv`,
      productsToCSV(sortProducts(picked, 'name', 1), { locations: store.locations, suppliers: store.suppliers }));
    toast(`Exported ${picked.length} product${picked.length === 1 ? '' : 's'}`, { icon: 'fileDown' });
  }

  async function bulkArchive(ids, archive) {
    // Only the products this action actually changes, so undo doesn't
    // restore something that was already archived before it.
    const byId = new Map(store.products.map((p) => [p.id, p]));
    const changing = ids.filter((id) => !!byId.get(id)?.archived !== archive);
    if (!changing.length) {
      toast(`Already ${archive ? 'archived' : 'restored'}`, { icon: 'info' });
      return;
    }
    try {
      const n = await store.bulkSetArchived(changing, archive);
      selected.clear();
      toast(`${n} product${n === 1 ? '' : 's'} ${archive ? 'archived' : 'restored'}`, {
        icon: archive ? 'archive' : 'archiveRestore',
        action: {
          label: 'Undo',
          onClick: () => store.bulkSetArchived(changing, !archive).catch(() => {
            toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' });
          }),
        },
      });
      renderList();
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    }
  }

  async function bulkDelete(ids) {
    const ok = await confirmDialog({
      title: `Delete ${ids.length} product${ids.length === 1 ? '' : 's'}?`,
      message: `${ids.length} product${ids.length === 1 ? ' and its' : 's and their'} stock counts are removed. You get a moment to undo it afterwards.`,
    });
    if (!ok) return;
    try {
      const undoToken = await store.bulkDeleteProducts(ids);
      selected.clear();
      renderList();
      toast(`${ids.length} product${ids.length === 1 ? '' : 's'} deleted`, {
        icon: 'trash',
        // The pictures outlive the products for as long as undo does, then
        // go with them — an emptied list shouldn't leave files behind.
        onExpire: () => {
          for (const { product } of undoToken?.products || []) {
            if (product.imagePath) deletePhoto(product);
          }
        },
        action: undoToken && {
          label: 'Undo',
          onClick: () => store.undoDelete(undoToken).catch(() => {
            toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
          }),
        },
      });
    } catch (err) {
      console.error(err);
      toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* --- Scanning ---
     One code, one job: find the product and open its stock dialog. An
     unknown code offers to become a new product carrying it. */
  function handleCode(code) {
    const hit = store.productByCode(code);
    if (hit) {
      openStockForm(hit.id, { mode: 'add' });
      return true;
    }
    toast(`No product with code ${code}`, {
      icon: 'circleAlert',
      action: {
        label: 'Add it',
        onClick: () => openProductForm(null, { prefill: { barcode: code } }),
      },
    });
    return false;
  }

  /**
   * Camera (or typed) scanning, staying open between items so a whole
   * delivery goes scan, receive, scan, receive.
   */
  function startScanning() {
    openScanner({
      title: 'Scan to adjust stock',
      hint: 'Scan an item to open its stock dialog. The scanner stays open for the next one.',
      continuous: true,
      // Resolving only once the stock dialog closes keeps the camera
      // paused while it's open, so the item on the counter isn't read
      // over and over behind the sheet.
      onCode: (code) => new Promise((resolve) => {
        const hit = store.productByCode(code);
        if (!hit) {
          handleCode(code);
          resolve(false);
          return;
        }
        openStockForm(hit.id, { mode: 'add', onClose: () => resolve(true) });
      }),
    });
  }

  function exportCSV() {
    if (!store.products.length) {
      toast('Nothing to export yet', { icon: 'info' });
      return;
    }
    const csv = productsToCSV(sortProducts(store.products, 'name', 1), {
      locations: store.locations,
      suppliers: store.suppliers,
    });
    downloadFile(`inventory-${dateStamp()}.csv`, csv);
    const n = store.products.length;
    toast(`Exported ${n} product${n === 1 ? '' : 's'}`, { icon: 'fileDown' });
  }

  /* --- List ---
     A family the owner thinks of as one thing reads as one row, opening
     out into the variants that actually sit on the shelf. Standalone
     products — which is every product until someone makes a family —
     are rows exactly as before. */

  /**
   * The rows the list shows: one per standalone product, one per family
   * (plus its variants when it's open). Sorted by whatever the header
   * says, with a family sorted on what it adds up to.
   */
  function displayRows(products, demand) {
    const low = store.settings.defaultLowStock;
    const grouped = groupVariantRows(products, store.families, low).map((row) => ({
      ...row,
      sortable: row.kind === 'family'
        ? familyAsProduct(row.family, row.variants, row.totals)
        : row.product,
    }));
    // Days of cover is the caller's map, not a field: a family is as
    // urgent as its emptiest variant.
    const coverOf = (row) => {
      const ids = row.kind === 'family' ? row.variants.map((p) => p.id) : [row.product.id];
      const values = ids.map((id) => demand.cover.get(id)).filter((v) => v !== null && v !== undefined);
      return values.length ? Math.min(...values) : Infinity;
    };
    /* The number the Qty column actually prints, worked out once per
       row rather than inside the comparator. A sell-as-kit shows what
       its components allow — it holds none, by design — and a family
       shows what its counted variants add up to, so sorting on the
       stored `quantity` ordered the list against figures nobody can
       see: a kit reading 70 sorted in among the zeros. Cost and value
       stay on real stock, since a kit holding none is worth none. */
    const shownQty = new Map();
    /* Likewise the Cost column: a sell-as-kit's cost is what its
       components cost, since it has no moving average of its own —
       the field it does carry is whatever was typed in, or what it
       averaged back when it still held stock. A family's is the average
       over what its variants hold. Sorting on the stored `cost` ordered
       the column against figures it doesn't print. */
    const shownCost = new Map();
    for (const row of grouped) {
      shownQty.set(row, row.kind === 'family'
        ? row.totals.units
        : (kitMode(row.product) === 'sell'
          ? buildableQty(row.product, store.products)
          : Number(row.product.quantity) || 0));
      shownCost.set(row, row.kind === 'family'
        ? (familyCost(row.variants, row.totals) ?? 0)
        : unitCostOf(row.product));
    }
    const cmp = state.sort === 'cover'
      ? (a, b) => coverOf(a) - coverOf(b)
      : state.sort === 'quantity'
        ? (a, b) => (shownQty.get(a) || 0) - (shownQty.get(b) || 0)
        : state.sort === 'cost'
          ? (a, b) => (shownCost.get(a) || 0) - (shownCost.get(b) || 0)
          : (a, b) => (SORTS[state.sort] || SORTS.name)(a.sortable, b.sortable);
    grouped.sort((a, b) => {
      const by = cmp(a, b);
      // Infinity − Infinity is NaN, which a comparator must never return.
      return (Number.isNaN(by) ? 0 : by) * state.dir || SORTS.name(a.sortable, b.sortable);
    });
    const out = [];
    for (const row of grouped) {
      out.push(row);
      if (row.kind !== 'family' || !expanded.has(row.family.id)) continue;
      for (const product of row.variants) {
        out.push({ kind: 'variant', id: product.id, product, family: row.family });
      }
    }
    return out;
  }

  /** Every product a display row stands for — a family stands for all of its. */
  const rowProducts = (row) => (row.kind === 'family' ? row.variants : [row.product]);

  function renderList() {
    // The rows about to be replaced take their pending thumbnails with them.
    resetLazyThumbs();
    const demand = demandInfo();
    const matched = filterProducts(store.products, { ...state, runningOut: demand.urgent }, store.settings.defaultLowStock);
    const rows = displayRows(matched, demand);
    familyOf.clear();
    for (const row of rows) {
      if (row.kind === 'family') familyOf.set(row.family.id, row.variants);
    }
    // The shift-click anchor is an index into these rows; once a filter
    // or sort reshuffles them, extending from it would span products the
    // user never touched.
    const rowsKey = rows.map((p) => p.id).join('\n');
    if (rowsKey !== lastRowsKey) {
      lastRowsKey = rowsKey;
      lastPicked = -1;
    }
    selectToggle.textContent = selectMode ? 'Done' : 'Select';
    selectToggle.setAttribute('aria-pressed', String(selectMode));
    renderBulkBar();
    const pool = state.status === 'archived'
      ? store.products.filter((p) => p.archived)
      : store.products.filter((p) => !p.archived);
    // The noun follows the total, not the number of matches: a shop with
    // one product read "1 of 1 products".
    const noun = `${state.status === 'archived' ? 'archived product' : 'product'}${pool.length === 1 ? '' : 's'}`;
    countLine.textContent = store.products.length
      ? `${matched.length} of ${pool.length} ${noun}`
      : '';
    clear(listWrap);

    if (!store.products.length) {
      listWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('package', 26) }),
        el('h3', {}, 'No products yet'),
        el('p', {}, 'Add your first product or import a CSV from your current spreadsheet.'),
        el('div.row', { style: { justifyContent: 'center' } },
          el('button.btn.btn-secondary', { onclick: () => openImporter() }, 'Import CSV'),
          el('button.btn.btn-primary', { onclick: () => openProductForm() }, 'Add product')
        )
      )));
      return;
    }
    if (!matched.length) {
      const emptyArchive = state.status === 'archived' && !pool.length;
      listWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon(emptyArchive ? 'archive' : 'search', 26) }),
        el('h3', {}, emptyArchive ? 'Nothing archived' : 'No matches'),
        el('p', {}, emptyArchive
          ? 'Archive a product to retire it without losing its details or history.'
          : 'Try a different search or clear the filters.')
      )));
      return;
    }

    listWrap.append(layout() === 'cards' ? renderCards(rows, demand) : renderTable(rows, demand));
  }

  function sortHeader(label, key, numeric = false) {
    const active = state.sort === key;
    return el(numeric ? 'th.num' : 'th', { scope: 'col', 'aria-sort': active ? (state.dir === 1 ? 'ascending' : 'descending') : null },
      el('button', {
        type: 'button',
        html: undefined,
        dataset: { sort: key },
        onclick: () => {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = 1; }
          renderList();
          // The rebuild took this button with it; keyboard focus
          // follows to its replacement instead of falling to <body>.
          listWrap.querySelector(`th button[data-sort="${key}"]`)?.focus();
        },
      }, label, el('span', { html: icon(active ? (state.dir === 1 ? 'sortAsc' : 'sortDesc') : 'sort', 12, 2.2) }))
    );
  }

  function renderTable(rows, demand) {
    const incoming = onOrderQty(store.orders);
    /* Selection is always over real products; a family row stands for
       the variants under it, open or not. */
    const shown = rows.flatMap(rowProducts);
    const allPicked = () => shown.length > 0 && shown.every((p) => selected.has(p.id));
    const headPick = el('input', {
      type: 'checkbox',
      onchange: (e) => {
        for (const p of shown) {
          if (e.currentTarget.checked) selected.add(p.id);
          else selected.delete(p.id);
        }
        renderList();
        // Space on the rebuilt checkbox should keep toggling; without
        // this the rebuild drops keyboard focus to <body>.
        listWrap.querySelector('thead .pick-cell input')?.focus();
      },
    });
    /* Part of the list picked reads as a dash, the way every list of
       checkboxes does — and it has to follow the rows, which change the
       selection without rebuilding the table. */
    const syncHeadPick = () => {
      const all = allPicked();
      headPick.checked = all;
      headPick.indeterminate = !all && shown.some((p) => selected.has(p.id));
      headPick.setAttribute('aria-label',
        all ? 'Clear selection' : `Select all ${shown.length} product${shown.length === 1 ? '' : 's'} shown`);
    };
    syncHeadPick();

    return el('div.table-wrap.products-table', {},
      el('table.table', {},
        el('thead', {}, el('tr', {},
          el('th.pick-cell', { scope: 'col' }, headPick),
          sortHeader('Product', 'name'),
          el('th', { scope: 'col' }, 'Category'),
          el('th', { scope: 'col' }, 'Location'),
          el('th', { scope: 'col' }, 'Supplier'),
          sortHeader('Cost', 'cost', true),
          sortHeader('Qty', 'quantity', true),
          sortHeader('Cover', 'cover', true),
          el('th', { scope: 'col' }, 'Status'),
          // Same class as the cells below it, so the column can be
          // dropped as one — print hides it (see print.css).
          el('th.actions-cell', { scope: 'col' }, el('span.sr-only', {}, 'Actions'))
        )),
        el('tbody', {}, rows.map((row, i) => {
          if (row.kind === 'family') return familyRow(row, i, rows, demand, syncHeadPick);
          const p = row.product;
          const status = p.archived ? 'archived' : rowStatus(p);
          const picked = selected.has(p.id);
          return el('tr', {
            className: `${p.archived ? 'is-archived' : ''}${picked ? ' is-picked' : ''}${row.kind === 'variant' ? ' is-variant' : ''}`.trim(),
          },
            el('td.pick-cell', {}, el('input', {
              type: 'checkbox',
              checked: picked,
              dataset: { pick: p.id },
              'aria-label': `Select ${p.name}`,
              // Shift-click extends from the last row touched, the way
              // every list of checkboxes is expected to behave.
              onclick: (e) => { if (e.shiftKey) extendSelection(rows, i, e.currentTarget.checked); },
              onchange: (e) => {
                toggle(p.id, e.currentTarget.checked);
                lastPicked = i;
                renderBulkBar();
                syncHeadPick();
                e.currentTarget.closest('tr')?.classList.toggle('is-picked', e.currentTarget.checked);
                if (row.kind === 'variant') syncFamilyPick(row.family.id);
              },
            })),
            el('td', {},
              el('div.cell-with-thumb', {},
                productThumb(p, { size: 34 }),
                el('div.grow', {},
                  // The row's own page, not its edit form: a drill-down
                  // shouldn't land on a screenful of inputs nobody came
                  // to change. Under an open family the row says what
                  // makes it different, not the family's name again.
                  el('a.cell-link', { href: productHref(p.id) },
                    el('div.cell-main', {}, row.kind === 'variant'
                      ? (variantLabel(p.axes, row.family.axes) || p.name)
                      : p.name)),
                  p.sku ? el('div.cell-sub.mono', {}, p.sku) : null
                )
              )
            ),
            el('td', {}, p.category || el('span.muted', {}, '-')),
            el('td', {}, locationCell(p)),
            el('td', {}, store.supplierById(p.supplierId)?.name || el('span.muted', {}, '-')),
            el('td.num', {}, kitMode(p) === 'sell'
              ? el('span', { title: 'What its components cost' }, formatMoney(unitCostOf(p), store.settings.currency))
              : formatMoney(p.cost, store.settings.currency)),
            el('td.num', {},
              // A sell-as-kit holds nothing by design; what it can do
              // comes from its components, so that's what the column says.
              kitMode(p) === 'sell'
                ? el('strong', { title: kitNote(p) || '' }, formatQtyIn(buildableQty(p, store.products), p.unit))
                : el('strong', {}, formatQtyIn(p.quantity, p.unit)),
              isCountUnit(p.unit) ? null : el('span.qty-unit', {}, ` ${unitLabel(p.unit)}`),
              kitNote(p) ? el('div.cell-sub', {}, kitNote(p)) : null,
              incoming.get(p.id)
                ? el('div.cell-sub', { title: 'Still due on an open order' }, `+${formatQtyIn(incoming.get(p.id), p.unit)} on order`)
                : null,
              shortNote(p)
                ? el('div.cell-sub', { style: { color: 'var(--warn)' } }, shortNote(p))
                : null
            ),
            coverCell(p, demand),
            el('td', {}, el('span.badge', { className: `badge ${status}` }, STATUS_LABELS[status])),
            el('td.actions-cell', {},
              p.archived
                ? el('button.icon-btn', {
                  html: icon('archiveRestore', 17),
                  'aria-label': `Restore ${p.name}`,
                  title: 'Restore',
                  onclick: () => restore(p),
                })
                : el('button.icon-btn', {
                  html: icon('packagePlus', 17),
                  'aria-label': `Adjust stock of ${p.name}`,
                  title: 'Adjust stock',
                  onclick: () => openStockForm(p.id),
                }),
              el('button.icon-btn', {
                html: icon('pencil', 16),
                'aria-label': `Edit ${p.name}`,
                title: 'Edit',
                onclick: () => openProductForm(p),
              })
            )
          );
        }))
      )
    );
  }

  /**
   * A family, collapsed: what it adds up to, and a chevron into the
   * variants that make it up. The whole row is one control per column
   * the products table already has, so nothing about the table's
   * selection, sorting or bulk actions has to know families exist.
   */
  function familyRow(row, index, rows, demand, syncHeadPick) {
    const { family, variants, totals } = row;
    const open = expanded.has(family.id);
    const picked = variants.every((p) => selected.has(p.id));
    const some = !picked && variants.some((p) => selected.has(p.id));
    const covers = variants.map((p) => demand.cover.get(p.id)).filter((v) => v !== null && v !== undefined);
    const unit = family.unit || variants[0]?.unit;
    const cost = familyCost(variants, totals);
    const pick = el('input', {
      type: 'checkbox',
      checked: picked,
      dataset: { pick: family.id },
      'aria-label': `Select all ${variants.length} variants of ${family.name}`,
      onclick: (e) => { if (e.shiftKey) extendSelection(rows, index, e.currentTarget.checked); },
      onchange: (e) => {
        for (const p of variants) toggle(p.id, e.currentTarget.checked);
        lastPicked = index;
        renderBulkBar();
        syncHeadPick();
        renderList();
        focusPick(family.id);
      },
    });
    pick.indeterminate = some;

    return el('tr.is-family', { className: `is-family${picked || some ? ' is-picked' : ''}` },
      el('td.pick-cell', {}, pick),
      el('td', {},
        el('div.cell-with-thumb', {},
          el('button.family-toggle', {
            type: 'button',
            'aria-expanded': String(open),
            'aria-label': `${open ? 'Collapse' : 'Expand'} ${family.name}`,
            html: icon(open ? 'sortDesc' : 'chevR', 16, 2.2),
            onclick: () => {
              if (open) expanded.delete(family.id);
              else expanded.add(family.id);
              renderList();
              listWrap.querySelector(`.family-toggle[data-family="${CSS.escape(family.id)}"]`)?.focus();
            },
            dataset: { family: family.id },
          }),
          el('div.grow', {},
            el('div.cell-main', {}, family.name),
            el('div.cell-sub', {}, [
              `${variants.length} variant${variants.length === 1 ? '' : 's'}`,
              family.axes.join(' · '),
            ].filter(Boolean).join(' · '))
          )
        )
      ),
      el('td', {}, family.category || el('span.muted', {}, '-')),
      el('td', {}, familyLocationCell(variants)),
      el('td', {}, store.supplierById(family.supplierId)?.name || el('span.muted', {}, '-')),
      // The same figure as every row under it — what one unit cost —
      // averaged over what the variants hold, which is also what the
      // column sorts on. The family's total value used to sit here,
      // reading as a cost thirty times any variant's.
      el('td.num', {},
        cost === null
          ? el('span.muted', { title: 'Nothing on hand to average' }, '-')
          : el('span', { title: `Average across the variants · ${formatMoney(totals.value, store.settings.currency)} in stock` },
            formatMoney(cost, store.settings.currency))
      ),
      el('td.num', {},
        el('strong', {}, formatQtyIn(totals.units, unit)),
        totals.measured ? el('div.cell-sub', {}, `${totals.measured} measured`) : null
      ),
      el('td.num', {}, covers.length
        ? el('span', { title: 'The emptiest variant' }, `${formatCover(Math.min(...covers))}d`)
        : el('span.muted', {}, '-')),
      el('td', {}, el('span.badge', { className: `badge ${totals.status}` }, STATUS_LABELS[totals.status])),
      el('td.actions-cell', {},
        el('button.icon-btn', {
          html: icon('plus', 17, 2.2),
          'aria-label': `Add a variant to ${family.name}`,
          title: 'Add a variant',
          onclick: () => openVariantForm(family),
        }),
        el('button.icon-btn', {
          html: icon('pencil', 16),
          'aria-label': `Edit ${family.name}`,
          title: 'Edit the family',
          onclick: () => openFamilyForm(family),
        })
      )
    );
  }

  /**
   * Days of stock left at the current rate of sale, from the activity
   * log. A dash where the log can't say — which is honest, and keeps the
   * column from reading as "plenty" for something nobody has bought yet.
   * The hover spells out the arithmetic behind the number.
   */
  function coverCell(p, demand) {
    const cover = demand.cover.get(p.id);
    if (cover === null || cover === undefined) {
      return el('td.num', {}, el('span.muted', { title: demand.enough ? 'Nothing sold in the last 30 days' : 'Not enough history yet' }, '-'));
    }
    const urgent = demand.urgent.has(p.id);
    const rate = rateLabel(demand.rates.get(p.id), p.unit);
    return el('td.num', { className: `num${urgent ? ' cover-urgent' : ''}` },
      el('span', { title: `${coverLabel(cover)}: ${rate}` }, `${formatCover(cover)}d`)
    );
  }

  /**
   * Where this product's stock actually sits. One place reads as its
   * name; several show the biggest with a count, and the full split in
   * the title so a hover answers "where exactly?".
   */
  /**
   * How far below its minimum the filtered location is, in the row's own
   * words. Only while a location filter is on: "4 short" means nothing
   * without a place to be short at.
   */
  function shortNote(p) {
    if (!state.locationId) return null;
    const here = bucketKey(state.locationId);
    const short = shortfallAt(p, here);
    if (short <= 0) return null;
    return `min ${formatQtyIn(minAt(p, here), p.unit)}: ${formatQtyIn(short, p.unit)} short`;
  }

  /**
   * The place a row is talking about: the one being filtered on, else
   * wherever most of the stock is, else the product's own. The shelf
   * code shown has to belong to the place named beside it.
   */
  function shownLocation(p) {
    if (state.locationId) return bucketKey(state.locationId);
    const entries = stockEntries(p);
    return entries.length ? entries[0][0] : (p.locationId || '');
  }

  /**
   * A row's status — the same answer the filter chips ask statusOf for,
   * so a row can never appear under "Out of stock" wearing an "In
   * stock" badge.
   */
  function rowStatus(p) {
    return statusOf(p, store.products, store.settings.defaultLowStock);
  }

  /**
   * What a kit's row says beyond its own count: how many it can make,
   * and what runs out first. Nothing for products that aren't kits.
   */
  function kitNote(p) {
    const mode = kitMode(p);
    if (!mode) return null;
    const can = buildableQty(p, store.products);
    const limit = limitingComponent(p, store.products);
    const verb = mode === 'build' ? 'can build' : 'can sell';
    return `${verb} ${formatQtyIn(can, p.unit)}${can <= 0 && limit?.product ? `: no ${limit.product.name}` : ''}`;
  }

  /** The shelf code a card should mention, when there's one to name. */
  function binNote(p) {
    const code = binAt(p, shownLocation(p));
    return code ? `bin ${code}` : null;
  }

  /**
   * What one unit of this product costs, as the list states it: the
   * moving average for anything that holds stock, and for a sell-as-kit
   * — which holds none — what its components cost right now, the same
   * figure its own page and the basket's totals use.
   */
  function unitCostOf(p) {
    return kitMode(p) === 'sell' ? kitUnitCost(p, store.products) : (Number(p.cost) || 0);
  }

  /**
   * What a family's stock cost per unit, averaged over what its variants
   * hold — the one cost a family can honestly claim, and the number its
   * Cost column sorts on. Null with nothing on hand to average.
   */
  function familyCost(variants, totals) {
    const units = variants.reduce((n, p) => n + (Number(p.quantity) || 0), 0);
    return units > 0 ? totals.value / units : null;
  }

  /** Where a family's stock sits: the one place, or the biggest with a count. */
  function familyPlaces(variants) {
    const held = new Map();
    for (const p of variants) {
      for (const [id, qty] of stockEntries(p)) held.set(id, (held.get(id) || 0) + qty);
    }
    return [...held.entries()].sort((a, b) => b[1] - a[1]);
  }

  function familyLocationCell(variants) {
    const places = familyPlaces(variants);
    if (!places.length) {
      // Nothing on hand anywhere: the shared home, if the family has one.
      const home = store.locationById(variants.find((p) => p.locationId)?.locationId)?.name;
      return home || el('span.muted', {}, '-');
    }
    const first = store.locationName(places[0][0]);
    if (places.length === 1) return first;
    const full = places.map(([id, qty]) => `${store.locationName(id)}: ${formatQtyIn(qty, variants[0]?.unit)}`).join('\n');
    return el('span', { title: full }, first, el('span.muted', {}, ` +${places.length - 1}`));
  }

  /** The same, as a card's word or two. */
  function familyWhere(variants) {
    const places = familyPlaces(variants);
    if (places.length > 1) return `${places.length} locations`;
    if (places.length === 1) return store.locationName(places[0][0]);
    return store.locationById(variants.find((p) => p.locationId)?.locationId)?.name || null;
  }

  function locationCell(p) {
    const entries = stockEntries(p);
    /* The shelf code for the place this cell names — the filtered one,
       or wherever the stock mostly is. Codes for other places live in
       the hover and on the product's own page. */
    const bin = binAt(p, shownLocation(p));
    const withBin = (node) => (bin
      ? el('span', {}, node, el('span.cell-bin.mono', {}, bin))
      : node);
    if (!entries.length) {
      const home = store.locationById(p.locationId)?.name;
      return home ? withBin(home) : (bin ? withBin('') : el('span.muted', {}, '-'));
    }
    const [firstId] = entries[0];
    const firstName = store.locationName(firstId);
    if (entries.length === 1) return withBin(firstName);
    const full = entries.map(([id, qty]) => {
      const code = binAt(p, id);
      return `${store.locationName(id)}${code ? ` (${code})` : ''}: ${formatQtyIn(qty, p.unit)}`;
    }).join('\n');
    return el('span', { title: full },
      firstName,
      el('span.muted', {}, ` +${entries.length - 1}`),
      bin ? el('span.cell-bin.mono', {}, bin) : null
    );
  }

  async function restore(p) {
    try {
      await store.setArchived(p.id, false);
      toast(`"${p.name}" restored`, { icon: 'archiveRestore' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
    }
  }

  function renderCards(rows, demand) {
    const incoming = onOrderQty(store.orders);
    return el('div.product-cards', {},
      rows.map((row) => {
        if (row.kind === 'family') return familyCard(row, demand);
        const p = row.product;
        const status = p.archived ? 'archived' : rowStatus(p);
        // A sell-as-kit holds nothing of its own; the number on the card
        // is what its components allow. Worked out once, so the count,
        // the word after it, and what a screen reader is told are the
        // same figure — the card read "12" and announced "0 units".
        const onHand = kitMode(p) === 'sell'
          ? buildableQty(p, store.products)
          : (Number(p.quantity) || 0);
        const spots = stockEntries(p);
        const where = spots.length > 1
          ? `${spots.length} locations`
          : (spots.length === 1 ? store.locationName(spots[0][0]) : store.locationById(p.locationId)?.name);
        const picked = selected.has(p.id);
        /* Selection taps update this card in place — flipping the
           checkbox, the highlight, and the bulk bar — the way the
           table rows already do. Rebuilding the whole list here made
           every tap of a rapid multi-select rebuild hundreds of cards,
           thumbnails, and listeners. */
        const syncPicked = (on) => {
          toggle(p.id, on);
          card.classList.toggle('is-picked', on);
          if (pickBox) pickBox.checked = on;
          hit.setAttribute('aria-label', `${on ? 'Deselect' : 'Select'} ${p.name}`);
          renderBulkBar();
          if (row.kind === 'variant') syncFamilyPick(row.family.id);
        };
        const pickBox = selectMode ? el('input.card-pick', {
          type: 'checkbox',
          checked: picked,
          dataset: { pick: p.id },
          'aria-label': `Select ${p.name}`,
          onchange: (e) => syncPicked(e.currentTarget.checked),
        }) : null;
        // Stretched button: the whole card opens the editor, while the
        // stock button stays a separate, real control layered above it.
        const hit = el('button.card-hit', {
          type: 'button',
          'aria-label': selectMode
            ? `${picked ? 'Deselect' : 'Select'} ${p.name}`
            : `${p.name}, ${formatQtyIn(onHand, p.unit)} ${unitLabel(p.unit, onHand)} in stock, ${STATUS_LABELS[status]}`,
          onclick: () => {
            if (selectMode) {
              syncPicked(!selected.has(p.id));
              return;
            }
            location.hash = productHref(p.id);
          },
        });
        const card = el('div.product-card', {
          className: `product-card${picked ? ' is-picked' : ''}`,
          // Long press is how a list of cards enters selection mode on
          // a touch screen; from then on a tap picks instead of opening.
          onpointerdown: (e) => {
            if (selectMode || e.pointerType === 'mouse') return;
            const card = e.currentTarget;
            const x0 = e.clientX;
            const y0 = e.clientY;
            const timer = setTimeout(() => {
              cleanup();
              selectMode = true;
              toggle(p.id, true);
              navigator.vibrate?.(20);
              renderList();
            }, 500);
            const cancel = () => { clearTimeout(timer); cleanup(); };
            // A resting fingertip still jitters by a pixel or two; only
            // real movement — a scroll, a drag — calls the press off.
            const onMove = (ev) => {
              if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel();
            };
            function cleanup() {
              card.removeEventListener('pointermove', onMove);
              card.removeEventListener('pointerup', cancel);
              card.removeEventListener('pointercancel', cancel);
            }
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerup', cancel);
            card.addEventListener('pointercancel', cancel);
          },
        },
          pickBox,
          productThumb(p, { size: 42 }),
          el('div.grow', {},
            // Under an open family, the card says what makes this one
            // different rather than repeating the family's name.
            el('div.cell-main', {}, row.kind === 'variant'
              ? (variantLabel(p.axes, row.family.axes) || p.name)
              : p.name),
            el('div.cell-sub', {}, [
              p.sku,
              where,
              packSizeOf(p) ? `${formatQtyIn(packSizeOf(p), p.unit)} per ${packLabel(p, 1)}` : null,
              incoming.get(p.id) ? `${formatQtyIn(incoming.get(p.id), p.unit)} on order` : null,
              coverLabel(demand.cover.get(p.id)),
              shortNote(p),
              binNote(p),
              kitNote(p),
              formatMoney(unitCostOf(p), store.settings.currency),
            ].filter(Boolean).join(' · ')),
            el('div.card-badges', {},
              el('span.badge', { className: `badge ${status}` }, STATUS_LABELS[status]),
              // Below its threshold or not, this is the shelf that
              // empties before anything ordered today could arrive.
              !p.archived && demand.urgent.has(p.id) && status === 'ok'
                ? el('span.badge.low', {}, 'Running out')
                : null
            )
          ),
          el('div.qty', {},
            el('div.n', {}, formatQtyIn(onHand, p.unit)),
            el('div.u', {}, unitLabel(p.unit, onHand))
          ),
          hit,
          p.archived
            ? el('button.icon-btn.card-action', {
              type: 'button',
              html: icon('archiveRestore', 18),
              'aria-label': `Restore ${p.name}`,
              onclick: () => restore(p),
            })
            : el('button.icon-btn.card-action', {
              type: 'button',
              html: icon('packagePlus', 18),
              'aria-label': `Adjust stock of ${p.name}`,
              onclick: () => openStockForm(p.id),
            })
        );
        if (row.kind === 'variant') card.classList.add('is-variant');
        return card;
      })
    );
  }

  /**
   * A family on a touch screen: the total, the worst status, and a tap
   * to open it out. The variants under it are ordinary product cards,
   * indented — the same rows, one step in.
   */
  function familyCard(row, demand) {
    const { family, variants, totals } = row;
    const open = expanded.has(family.id);
    const picked = variants.every((p) => selected.has(p.id));
    /* Part of the family picked — the variants have to be opened out to
       pick one, and closing them up again must not hide that it is
       selected. The table row already says so; so does this. */
    const some = !picked && variants.some((p) => selected.has(p.id));
    const unit = family.unit || variants[0]?.unit;
    const pick = selectMode ? el('input.card-pick', {
      type: 'checkbox',
      checked: picked,
      dataset: { pick: family.id },
      'aria-label': `Select all ${variants.length} variants of ${family.name}`,
      onchange: (e) => {
        for (const p of variants) toggle(p.id, e.currentTarget.checked);
        renderList();
        focusPick(family.id);
      },
    }) : null;
    if (pick) pick.indeterminate = some;
    const card = el('div.product-card.is-family', {
      className: `product-card is-family${picked || some ? ' is-picked' : ''}`,
    },
      pick,
      el('span.item-ic.accent', { html: icon('boxes', 18) }),
      el('div.grow', {},
        el('div.cell-main', {}, family.name),
        el('div.cell-sub', {}, [
          `${variants.length} variant${variants.length === 1 ? '' : 's'}`,
          family.axes.join(' · '),
          familyWhere(variants),
          // A product card ends in its unit cost; the family's line says
          // what its number is, since a bare total read as one too.
          `${formatMoney(totals.value, store.settings.currency)} in stock`,
        ].filter(Boolean).join(' · ')),
        el('div.card-badges', {},
          el('span.badge', { className: `badge ${totals.status}` }, STATUS_LABELS[totals.status]))
      ),
      el('div.qty', {},
        el('div.n', {}, formatQtyIn(totals.units, unit)),
        el('div.u', {}, unitLabel(unit, totals.units))
      ),
      el('button.card-hit', {
        type: 'button',
        dataset: { hit: family.id },
        // Only an expander while it expands: in selection mode a tap
        // picks the family's variants, so announcing "Expand" would name
        // the opposite of what pressing it does.
        'aria-expanded': selectMode ? null : String(open),
        'aria-label': selectMode
          ? `${picked ? 'Deselect' : 'Select'} all ${variants.length} variants of ${family.name}`
          : `${open ? 'Collapse' : 'Expand'} ${family.name}, ${variants.length} variants`,
        onclick: () => {
          if (selectMode) {
            for (const p of variants) toggle(p.id, !picked);
            renderList();
            focusPick(family.id);
            return;
          }
          if (open) expanded.delete(family.id);
          else expanded.add(family.id);
          renderList();
          // Opening a family rewrites the list; the table's own toggle
          // already hands focus to its replacement, and so does this.
          listWrap.querySelector(`.card-hit[data-hit="${CSS.escape(family.id)}"]`)?.focus();
        },
      }),
      el('button.icon-btn.card-action', {
        type: 'button',
        html: icon(open ? 'sortDesc' : 'chevR', 18),
        'aria-hidden': 'true',
        tabindex: -1,
      })
    );
    return card;
  }

  /* A USB or Bluetooth scanner just types: while this view is open,
     a burst of keystrokes ending in Enter is a scan, not a shortcut. */
  const stopWedge = listenForScans(handleCode);

  /* The bar wraps to two lines on a narrow screen, so a resize can
     change its height with no selection change to notice it. */
  const onResize = () => measureBulkBar();
  window.addEventListener('resize', onResize);

  /* Crossing the breakpoint swaps which layout is the visible one. */
  const onBreakpoint = () => renderList();
  narrow.addEventListener('change', onBreakpoint);

  /* A phone printing the list needs the table built first — the cards
     are a touch affordance, not a document. */
  const onBeforePrint = () => {
    if (layout() === 'table') return;
    printing = true;
    renderList();
  };
  const onAfterPrint = () => {
    if (!printing) return;
    printing = false;
    renderList();
  };
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);

  const rerender = () => {
    locSelect.refill();
    supSelect.refill();
    catSelect.refill();
    renderChips();
    renderList();
  };
  store.addEventListener('change', rerender);
  root.destroy = () => {
    store.removeEventListener('change', rerender);
    document.body.classList.remove('has-bulk-bar');
    document.body.style.removeProperty('--bulk-bar-h');
    window.removeEventListener('resize', onResize);
    narrow.removeEventListener('change', onBreakpoint);
    window.removeEventListener('beforeprint', onBeforePrint);
    window.removeEventListener('afterprint', onAfterPrint);
    // The rows leaving with this view take their pending thumbnails
    // with them; an observer that still holds them keeps them alive.
    resetLazyThumbs();
    stopWedge();
  };

  renderChips();
  renderList();
  return root;
}

/**
 * Days of cover as a column reads it: whole days once there are a few,
 * one decimal below that, so "0.5d" doesn't round away to "0d" — which
 * would read as an empty shelf next to a full one.
 */
function formatCover(days) {
  const n = Number(days) || 0;
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}
