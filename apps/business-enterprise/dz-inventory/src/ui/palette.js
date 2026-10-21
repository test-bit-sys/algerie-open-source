/**
 * Global quick search / command palette. Ctrl/Cmd+K (or "/" outside a
 * field) from anywhere; one box that reaches products (adjust stock or
 * edit), suppliers, locations, the views, and the common actions — so
 * "I have a product name in my head and want to act on it now" costs
 * zero navigation.
 *
 * A hardware barcode scanner works here too: it types into the open
 * palette and presses Enter, which resolves the code to its product.
 */

import { el, clear, CODE_FIELD } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { searchRank } from '../lib/search.js';
import { formatQtyIn, unitLabel } from '../lib/units.js';
import { openProductForm } from './productform.js';
import { openStockForm } from './stockform.js';
import { openSupplierForm } from './supplierform.js';
import { openImporter } from './importer.js';
import { openScanner } from './scanner.js';
import { productsToCSV } from '../lib/csv.js';
import { downloadFile, dateStamp, debounce } from '../lib/util.js';
import { sortProducts } from '../lib/inventory.js';
import { productHref } from '../views/product.js';
import { toast } from './toast.js';

/** Static entries: the views, and the verbs users reach for daily. */
function commandEntries() {
  const go = (hash) => () => { location.hash = hash; };
  return [
    { kind: 'action', icon: 'plus', label: 'Add product', run: () => openProductForm() },
    {
      kind: 'action', icon: 'barcode', label: 'Scan a barcode',
      run: () => openScanner({
        title: 'Scan to adjust stock',
        hint: 'Scan an item to open its stock dialog.',
        onCode: (code) => {
          const hit = store.productByCode(code);
          if (!hit) { toast(`No product with code ${code}`, { icon: 'circleAlert' }); return false; }
          openStockForm(hit.id);
        },
      }),
    },
    { kind: 'action', icon: 'fileUp', label: 'Import CSV', run: () => openImporter() },
    {
      kind: 'action', icon: 'fileDown', label: 'Export products CSV',
      run: () => {
        if (!store.products.length) { toast('Nothing to export yet', { icon: 'info' }); return; }
        downloadFile(`inventory-${dateStamp()}.csv`, productsToCSV(sortProducts(store.products, 'name', 1), {
          locations: store.locations, suppliers: store.suppliers,
        }));
        const n = store.products.length;
        toast(`Exported ${n} product${n === 1 ? '' : 's'}`, { icon: 'fileDown' });
      },
    },
    { kind: 'action', icon: 'packageMinus', label: store.takeout ? 'Resume taking stock out' : 'Take stock out', run: go('#/takeout') },
    { kind: 'action', icon: 'clipboard', label: store.stocktake ? 'Resume the stocktake' : 'Start a stocktake', run: go('#/stocktake') },
    { kind: 'view', icon: 'dashboard', label: 'Overview', run: go('#/') },
    { kind: 'view', icon: 'package', label: 'Products', run: go('#/products') },
    { kind: 'view', icon: 'cart', label: 'Reorder', run: go('#/reorder') },
    { kind: 'view', icon: 'history', label: 'History', run: go('#/history') },
    { kind: 'view', icon: 'chart', label: 'Reports', run: go('#/reports') },
    { kind: 'view', icon: 'pin', label: 'Locations', run: go('#/locations') },
    { kind: 'view', icon: 'truck', label: 'Suppliers', run: go('#/suppliers') },
    { kind: 'view', icon: 'gear', label: 'Settings', run: go('#/settings') },
  ];
}

let paletteOpen = false;

/** Apple keyboards write the Alt key as ⌥; everyone else spells it. */
const isApple = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform || '');

export function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;

  // Where focus goes back to on close, and what Tab must not reach
  // while the palette owns the screen — same contract as openModal.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const appEl = document.getElementById('app');

  /* Combobox semantics: focus stays in the box while the arrows walk
     the list, so the active row has to be named by id — otherwise
     arrowing through results announces nothing at all. */
  const LIST_ID = 'palette-results';
  const optionId = (i) => `palette-opt-${i}`;

  const input = el('input.palette-input', {
    // A hardware scanner types its code straight in here, so this box
    // holds codes as often as words.
    ...CODE_FIELD,
    type: 'text',
    placeholder: 'Search products, suppliers, actions…',
    'aria-label': 'Quick search',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': LIST_ID,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
  });
  const list = el('div.palette-list', { id: LIST_ID, role: 'listbox', 'aria-label': 'Results' });
  /* Only shown while the active row has a second action, so the
     shortcut is discoverable instead of hidden knowledge. */
  const editHint = el('span.palette-hint', { hidden: true }, `${isApple ? '⌥' : 'Alt'} ↵ edit`);
  const panel = el('div.palette-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick search' },
    el('div.palette-head', { html: icon('search', 17, 2) }, input, editHint, el('span.palette-hint', {}, 'esc')),
    list
  );
  const rootNode = el('div.palette-root', {},
    el('div.modal-scrim', { onclick: close }),
    panel
  );

  /** One more of this product into the basket in progress, then to it. */
  function addToBasket(p) {
    store.addToTakeout(p.id)
      .then(() => { location.hash = '#/takeout'; })
      .catch(() => toast('Couldn’t add that. Check your connection', { icon: 'wifiOff' }));
  }

  /** Flat, renderable result rows; `active` walks this list. */
  let rows = [];
  let active = 0;
  /** The query `rows` was computed for — see flushPending(). */
  let renderedFor = null;

  function resultRows(query) {
    const q = query.trim();
    const out = [];

    if (q) {
      const products = searchRank(
        store.products.filter((p) => !p.archived),
        q,
        (p) => [p.name, p.sku, p.barcode],
        { limit: 8 }
      );
      for (const p of products) {
        out.push({
          section: 'Products',
          icon: 'package',
          label: p.name,
          sub: [
            `${formatQtyIn(p.quantity, p.unit)} ${unitLabel(p.unit, p.quantity)} on hand`,
            p.sku,
          ].filter(Boolean).join(' · '),
          // The product's own page: everything about it, and every
          // action on it, one step from a search box.
          run: () => { location.hash = productHref(p.id); },
          edit: () => openProductForm(p),
          // A basket in progress is what the user is doing right now;
          // finding a product while one is open means adding it.
          ...(store.takeout ? {
            run: () => addToBasket(p),
            sub: `Add to the basket · ${formatQtyIn(p.quantity, p.unit)} ${unitLabel(p.unit, p.quantity)} on hand`,
          } : {}),
        });
      }
      for (const s of searchRank(store.suppliers, q, (x) => [x.name, x.contact], { limit: 4 })) {
        out.push({
          section: 'Suppliers', icon: 'truck', label: s.name,
          sub: s.email || s.phone || '',
          run: () => openSupplierForm(s),
        });
      }
      for (const l of searchRank(store.locations, q, (x) => [x.name], { limit: 4 })) {
        out.push({
          section: 'Locations', icon: 'pin', label: l.name,
          sub: 'Products at this location',
          run: () => { location.hash = `#/products?location=${encodeURIComponent(l.id)}`; },
        });
      }
      for (const c of searchRank(commandEntries(), q, (x) => [x.label], { limit: 6 })) {
        out.push({ section: c.kind === 'view' ? 'Go to' : 'Actions', icon: c.icon, label: c.label, run: c.run });
      }
    } else {
      // An empty box is keyboard navigation: the verbs, then the views.
      for (const c of commandEntries()) {
        out.push({ section: c.kind === 'view' ? 'Go to' : 'Actions', icon: c.icon, label: c.label, run: c.run });
      }
    }
    return out;
  }

  /* The re-render behind typing is debounced, and a hardware scanner
     (the header's own use case) fires its whole code plus Enter inside
     the 80ms window — a fast typist's Enter or first arrow can land
     there too. Acting on the previous query's rows then opens the
     wrong thing entirely: an unknown scanned code would run the stale
     first row, a blank "Add product". Navigation and Enter first bring
     the list up to date with what's actually in the box. */
  function flushPending() {
    if (input.value === renderedFor) return;
    active = 0;
    renderList();
  }

  function renderList() {
    renderedFor = input.value;
    rows = resultRows(input.value);
    // Floor at 0 even when the list is empty: an index that went to -1
    // would survive into the next query's results, leaving no row
    // highlighted and Enter doing nothing.
    active = Math.max(0, Math.min(active, rows.length - 1));
    clear(list);
    if (!rows.length) {
      list.append(el('p.palette-empty', {}, `Nothing matches “${input.value.trim()}”.`));
      syncActive();
      return;
    }
    let lastSection = '';
    rows.forEach((row, i) => {
      if (row.section !== lastSection) {
        lastSection = row.section;
        list.append(el('div.palette-section', {}, row.section));
      }
      /* A div, not a button: the row owns a second control, and a
         button inside a button is neither valid nor operable. Focus
         never comes here — the combobox input keeps it and points at
         the active row by id — so nothing in the row is a tab stop. */
      const node = el('div.palette-row', {
        id: optionId(i),
        role: 'option',
        tabindex: -1,
        'aria-selected': String(i === active),
        onclick: () => pick(row),
        onpointermove: () => { if (active !== i) { active = i; syncActive(); } },
      },
        el('span.item-ic', { html: icon(row.icon, 16) }),
        el('div.grow', {},
          el('div.title', {}, row.label),
          row.sub ? el('div.sub', {}, row.sub) : null
        ),
        row.edit ? el('button.icon-btn.palette-edit', {
          type: 'button',
          tabindex: -1,
          html: icon('pencil', 15),
          'aria-label': `Edit ${row.label}`,
          title: 'Edit',
          onclick: (e) => { e.stopPropagation(); pick({ ...row, run: row.edit }); },
        }) : null
      );
      node.dataset.index = i;
      list.append(node);
    });
    syncActive();
  }

  function syncActive() {
    for (const node of list.querySelectorAll('.palette-row')) {
      const on = Number(node.dataset.index) === active;
      node.setAttribute('aria-selected', String(on));
      if (on) node.scrollIntoView({ block: 'nearest' });
    }
    // What the input says it's pointing at — the only way a screen
    // reader learns that the arrows moved.
    if (rows.length) input.setAttribute('aria-activedescendant', optionId(active));
    else input.removeAttribute('aria-activedescendant');
    editHint.hidden = !rows[active]?.edit;
  }

  function pick(row) {
    close();
    // Run after the palette is gone so a dialog the row opens doesn't
    // fight it for focus.
    setTimeout(() => row.run(), 0);
  }

  function onKey(e) {
    // Escape closes the topmost layer only — without stopPropagation a
    // dialog underneath would hear the same keydown and close too.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); flushPending(); active = Math.max(0, Math.min(active + 1, rows.length - 1)); syncActive(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); flushPending(); active = Math.max(active - 1, 0); syncActive(); return; }
    // Home and End jump the list only while the box is empty — the
    // menu-of-actions mode, where there is no text for them to move
    // through. With a query typed they belong to the caret, as they do
    // in every other text field: claiming them there left someone who
    // fat-fingered the front of "cabel" unable to get back to it.
    if ((e.key === 'Home' || e.key === 'End') && !input.value) {
      flushPending();
      if (!rows.length) return;
      e.preventDefault();
      active = e.key === 'Home' ? 0 : rows.length - 1;
      syncActive();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      flushPending();
      // Alt+Enter takes the row's second action (edit the product
      // rather than adjust its stock) — the keyboard route to the
      // pencil, which is a pointer affordance only.
      if (e.altKey) {
        if (rows[active]?.edit) pick({ ...rows[active], run: rows[active].edit });
        return;
      }
      // A scanned (or pasted) code resolves straight to its product,
      // even when ranking put something else first. With a basket in
      // progress that means the same thing the product's own row says
      // — one more into the basket — not a stock dialog opened over it:
      // scanning into the palette is the hardware-scanner path this box
      // exists for, and the row and the scan must not disagree.
      const exact = store.productByCode(input.value);
      if (exact) {
        pick({ run: store.takeout && !exact.archived ? () => addToBasket(exact) : () => openStockForm(exact.id) });
        return;
      }
      if (rows[active]) pick(rows[active]);
    }
  }

  function close() {
    if (!paletteOpen) return;
    paletteOpen = false;
    document.removeEventListener('keydown', onKey, true);
    rootNode.remove();
    // A dialog can be open underneath (a row's action just opened one);
    // its scroll lock and inert are its own to release.
    if (!document.querySelector('.modal-root:not(.closing)')) {
      document.body.classList.remove('modal-open');
      appEl?.removeAttribute('inert');
    }
    if (opener?.isConnected) opener.focus();
  }

  input.addEventListener('input', debounce(() => {
    // A flush may have rendered this query already; re-rendering would
    // throw away the row the user has arrowed to since.
    if (input.value === renderedFor) return;
    active = 0;
    renderList();
  }, 80));
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('modal-open');
  appEl?.setAttribute('inert', '');
  document.body.append(rootNode);
  renderList();
  input.focus();
}

/**
 * Global shortcuts: Ctrl/Cmd+K anywhere, "/" when no field is focused.
 * Returns a teardown function.
 */
export function initPalette() {
  /* A dialog owns the screen: a palette over a half-filled product
     sheet stacks two Escape targets on one key, and picking a result
     would open a third layer behind the one being filled in. */
  const dialogOpen = () => !!document.querySelector('.modal-root:not(.closing)');

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      if (paletteOpen || dialogOpen()) return;
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || paletteOpen) return;
    const node = document.activeElement;
    const editable = node instanceof HTMLElement
      && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
    // "/" inside a field is someone typing, not a shortcut.
    if (editable || dialogOpen()) return;
    e.preventDefault();
    openPalette();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
