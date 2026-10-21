/**
 * Barcode label sheets. Pick products (the products view's selection),
 * choose a layout — a few Avery-style grids plus a single-label size
 * for roll printers — choose what's on the label, set copies per
 * product, and print via the browser. Labels encode the product's
 * barcode, or its SKU (a scan of either finds the product); products
 * with neither get an internal code assigned when printing.
 */

import { el, clear } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { binAt, binEntries, defaultLocationId } from '../lib/stock.js';
import { printSheet } from './print.js';
import { barcodeSVG, codeForProduct, encodable } from '../lib/barcode.js';
import { formatMoney } from '../lib/util.js';
import { isCountUnit } from '../lib/units.js';

/**
 * Layout presets. Grids state the label size, gaps, and page margins of
 * the stock they mirror; the roll preset makes each label its own page.
 */
const LAYOUTS = [
  {
    key: '5160', name: 'Sheet of 30: Avery 5160 (Letter)',
    page: 'letter', margin: '0.5in 0.19in', cols: 3,
    w: '2.625in', h: '1in', colGap: '0.125in', rowGap: '0',
  },
  {
    key: 'l7160', name: 'Sheet of 21: Avery L7160 (A4)',
    page: 'A4', margin: '15.1mm 7.2mm', cols: 3,
    w: '63.5mm', h: '38.1mm', colGap: '2.5mm', rowGap: '0',
  },
  {
    key: '5163', name: 'Sheet of 10: Avery 5163 (Letter)',
    page: 'letter', margin: '0.5in 0.16in', cols: 2,
    w: '4in', h: '2in', colGap: '0.19in', rowGap: '0',
  },
  {
    key: 'roll', name: 'Roll labels: 2.25 × 1.25 in, one per label',
    page: '2.25in 1.25in', margin: '0', cols: 1,
    w: '2.25in', h: '1.25in', colGap: '0', rowGap: '0',
  },
];

const FIELDS = [
  { key: 'name', label: 'Name', default: true },
  { key: 'sku', label: 'SKU', default: true },
  { key: 'price', label: 'Price', default: false },
  // Where the thing goes — the one field a shelf label most needs and
  // the labels never had.
  { key: 'bin', label: 'Bin', default: false },
  { key: 'barcode', label: 'Barcode', default: true },
];

export function openLabelForm(productIds, { onSaved } = {}) {
  /* Indexed rather than looked up per id: selecting the whole
     catalogue would otherwise walk the product list once per label. */
  const indexProducts = () => new Map(store.products.map((p) => [p.id, p]));
  const products = (() => {
    const byId = indexProducts();
    return productIds.map((id) => byId.get(id)).filter(Boolean);
  })();
  if (!products.length) return;

  let layout = LAYOUTS[0];
  const include = new Set(FIELDS.filter((f) => f.default).map((f) => f.key));
  /* 'product' — shelf-edge, one each; 'unit' — one per unit on hand. */
  let copiesMode = 'product';

  const uncoded = products.filter((p) => !codeForProduct(p));
  const unencodable = products.filter((p) => {
    const code = codeForProduct(p);
    return code && !encodable(code);
  });

  const layoutSelect = el('select.select', {
    'aria-label': 'Label layout',
    onchange: () => { layout = LAYOUTS.find((l) => l.key === layoutSelect.value) || LAYOUTS[0]; },
  }, LAYOUTS.map((l) => el('option', { value: l.key }, l.name)));

  const fieldChips = el('div.chips', { role: 'group', 'aria-label': 'What goes on the label' });
  function renderFieldChips() {
    clear(fieldChips);
    for (const f of FIELDS) {
      fieldChips.append(el('button.chip', {
        type: 'button',
        'aria-pressed': String(include.has(f.key)),
        onclick: (e) => {
          include.has(f.key) ? include.delete(f.key) : include.add(f.key);
          // The press state moves in place, the way the products and
          // history filters already do: rebuilding the group here
          // destroyed the chip the keyboard was on, dropping focus out
          // of the dialog entirely and announcing nothing.
          e.currentTarget.setAttribute('aria-pressed', String(include.has(f.key)));
          update();
        },
      }, f.label));
    }
  }

  const copiesSeg = el('div.segmented', { role: 'group', 'aria-label': 'Copies per product' },
    [
      { key: 'product', label: 'One per product' },
      { key: 'unit', label: 'One per unit on hand' },
    ].map((o) => el('button', {
      type: 'button',
      'aria-pressed': String(copiesMode === o.key),
      onclick: (e) => {
        copiesMode = o.key;
        for (const b of copiesSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        update();
      },
    }, o.label))
  );

  /** Copies for one product under the current mode. */
  function copiesFor(p) {
    if (copiesMode !== 'unit') return 1;
    // Item labels track what's on the shelf; measured stock (kg, m)
    // has no per-item count, so it gets one label.
    if (!isCountUnit(p.unit)) return 1;
    return Math.max(1, Math.round(Number(p.quantity) || 0) || 1);
  }

  const totalLine = el('p.hint', { 'aria-live': 'polite' });
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Print labels');

  function update() {
    const total = products.reduce((n, p) => n + copiesFor(p), 0);
    totalLine.textContent = `${total} label${total === 1 ? '' : 's'} across ${products.length} product${products.length === 1 ? '' : 's'}.`;
    submit.disabled = include.size === 0;
  }

  /**
   * The shelf code a label should carry: the one for the product's own
   * location, or its only code — a shelf label names one shelf.
   */
  function binFor(p) {
    const own = binAt(p, defaultLocationId(p));
    if (own) return own;
    const all = binEntries(p);
    return all.length === 1 ? all[0][1] : '';
  }

  function labelCell(p) {
    const code = codeForProduct(p);
    const svg = include.has('barcode') && code && encodable(code)
      ? barcodeSVG(code, { label: `Barcode for ${p.name}` })
      : null;
    const meta = [
      include.has('sku') && p.sku ? p.sku : null,
      include.has('bin') ? binFor(p) : null,
      include.has('price') && p.price !== null && p.price !== undefined
        ? formatMoney(p.price, store.settings.currency)
        : null,
    ].filter(Boolean).join('  ·  ');
    return el('div.label', {},
      include.has('name') ? el('div.label-name', {}, p.name) : null,
      meta ? el('div.label-meta', {}, meta) : null,
      svg ? el('div.label-barcode', { html: svg }) : null,
      include.has('barcode') && code ? el('div.label-code', {}, code) : null
    );
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        // Products with no code at all get one now, so the label that
        // comes off the printer actually scans back to the product.
        if (include.has('barcode') && uncoded.length) {
          await store.assignBarcodes(uncoded.map((p) => p.id));
        }
        // Re-indexed after assignBarcodes, so freshly assigned codes
        // are the ones that reach the printer.
        const byId = indexProducts();
        const cells = [];
        for (const id of productIds) {
          const p = byId.get(id);
          if (!p) continue;
          for (let i = 0; i < copiesFor(p); i++) cells.push(labelCell(p));
        }
        printSheet(
          [
            el('style', {},
              `@page { size: ${layout.page}; margin: ${layout.margin}; }`
              + `#print-sheet .label-grid { display: grid; grid-template-columns: repeat(${layout.cols}, ${layout.w}); `
              + `grid-auto-rows: ${layout.h}; column-gap: ${layout.colGap}; row-gap: ${layout.rowGap}; }`
              + `#print-sheet .label { width: ${layout.w}; height: ${layout.h}; }`
            ),
            el('div.label-grid', {}, cells),
          ],
          {}
        );
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t prepare the labels. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('div.field', {},
      el('label', { htmlFor: 'label-layout' }, 'Layout'),
      el('div.select-wrap', {}, Object.assign(layoutSelect, { id: 'label-layout' }))
    ),
    el('div.field', {},
      el('label', {}, 'On the label'),
      fieldChips
    ),
    el('div.field', {},
      el('label', {}, 'Copies'),
      copiesSeg,
      el('p.hint', {}, 'One per product for shelf edges; one per unit for labelling items.')
    ),
    uncoded.length
      ? el('p.form-banner', {},
        el('span', {}, `${uncoded.length} product${uncoded.length === 1 ? ' has' : 's have'} no barcode or SKU; printing assigns internal codes (INV-…) so the labels scan.`))
      : null,
    unencodable.length
      ? el('p.form-banner', {},
        el('span', {}, `${unencodable.length} product${unencodable.length === 1 ? '' : 's'} carr${unencodable.length === 1 ? 'ies' : 'y'} characters Code 128 can’t encode; those labels print without bars.`))
      : null,
    totalLine,
    submit
  );

  renderFieldChips();
  update();
  const modal = openModal({ title: 'Print barcode labels', content: form });
}
