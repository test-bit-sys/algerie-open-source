import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { activeProducts, subsetTotals } from '../lib/inventory.js';
import { supplierPriceList, sourceFor } from '../lib/sources.js';
import { EACH, formatQtyIn, unitLabel } from '../lib/units.js';
import { formatMoney, formatQty } from '../lib/util.js';
import { openSupplierForm } from '../ui/supplierform.js';
import { productHref } from './product.js';

export function suppliersView() {
  const root = el('div.main-inner');
  /* Which price lists are open, by supplier id. The view is rebuilt on
     every store change, so a disclosure the user opened has to be found
     open afterwards — and it decides which ones are worth building. */
  const openPrices = new Set();
  const render = () => renderInto(root, openPrices);
  store.addEventListener('change', render);
  render();
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}

function renderInto(root, openPrices) {
  clear(root);

  root.append(el('div.view-head', {},
    el('div', {},
      el('h1.view-title', {}, 'Suppliers'),
      el('p.view-sub', {}, 'Who you buy from, and what they stock')
    ),
    el('div.view-actions', {},
      el('button.btn.btn-primary', { html: icon('plus', 16, 2.2), onclick: () => openSupplierForm() }, ' Add supplier')
    )
  ));

  if (!store.suppliers.length) {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('truck', 26) }),
      el('h3', {}, 'No suppliers yet'),
      el('p', {}, 'Add the companies you order from. Assign them to products to see what each one supplies.'),
      el('button.btn.btn-primary', { onclick: () => openSupplierForm() }, 'Add supplier')
    )));
    return;
  }

  const sorted = [...store.suppliers].sort((a, b) => a.name.localeCompare(b.name));
  root.append(el('div.entity-grid', {}, sorted.map((s) => {
    // What they supply: anything naming them as a source, not only the
    // products they happen to be the default for. Archived ones count
    // here on purpose — the price list below leaves them out, and the
    // difference between the two numbers is what says so.
    const supplies = store.products.filter((p) => !!sourceFor(p, s.id));
    const products = activeProducts(store.products).filter((p) => p.supplierId === s.id);
    const totals = subsetTotals(products);
    const priceList = supplierPriceList(store.products, s.id);
    return el('div.card.entity-card', {},
      el('div.head', {},
        el('span.item-ic.accent', { html: icon('truck', 18) }),
        el('div.grow', {},
          el('h3', {}, s.name),
          s.contact ? el('div.small.muted', {}, s.contact) : null
        ),
        el('div.actions', {},
          el('button.icon-btn', {
            html: icon('pencil', 16),
            'aria-label': `Edit ${s.name}`,
            onclick: () => openSupplierForm(s),
          })
        )
      ),
      (s.email || s.phone || s.website || s.leadTimeDays || s.minOrder) && el('div.entity-meta', {},
        // Encoded like the reorder view's mailto: an address holding
        // '?' or '&' must not smuggle extra headers into the compose.
        s.email && meta('mail', el('a', { href: `mailto:${encodeURIComponent(s.email)}` }, s.email)),
        s.phone && meta('phone', el('a', { href: `tel:${s.phone.replace(/[^\d+]/g, '')}` }, s.phone)),
        s.website && meta('globe', el('a', {
          href: websiteHref(s.website),
          target: '_blank', rel: 'noopener',
        }, s.website)),
        s.leadTimeDays && meta('truck', `Usually ~${formatQty(s.leadTimeDays)} day${s.leadTimeDays === 1 ? '' : 's'} to arrive`),
        s.minOrder && meta('cart', `${formatMoney(s.minOrder, store.settings.currency)} minimum order`)
      ),
      s.notes && el('p.small.muted', {}, s.notes),
      el('div.entity-stats', {},
        el('span', {}, el('strong', {}, formatQty(products.length)), ` product${products.length === 1 ? '' : 's'}`),
        el('span', {}, el('strong', {}, formatQty(totals.units)), ` ${unitLabel(EACH, totals.units)}`),
        totals.measured ? el('span', {}, el('strong', {}, formatQty(totals.measured)), ' measured') : null,
        el('span', {}, el('strong', {}, formatMoney(totals.value, store.settings.currency)), ' at cost')
      ),
      // A table of dashes says less than the stats above it: the price
      // list appears once someone has written a code or a price down.
      priceList.some((r) => r.source.price !== null || r.source.code)
        ? priceListBlock(priceList, supplies.length, s.id, openPrices)
        : null
    );
  })));
}

/**
 * What this supplier charges for what they supply: their code, their
 * price, and — where another source is cheaper — by how much. The
 * comparison is shown, never acted on.
 *
 * The table is built the first time the disclosure is opened, not up
 * front. A catalogue of a couple of thousand products across twenty
 * suppliers is thousands of rows per supplier, and building them all
 * meant tens of thousands of table cells nobody had asked to see —
 * rebuilt from scratch on every stock change, which is the one thing
 * this page does while the user is working.
 */
function priceListBlock(rows, supplies, supplierId, openPrices) {
  const currency = store.settings.currency;
  const priced = rows.filter((r) => r.source.price !== null);
  const body = el('div');

  const fill = () => {
    if (body.firstChild) return;
    append(body, [
      el('div.table-wrap', {}, el('table.table.compact', {},
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Product'),
          el('th', { scope: 'col' }, 'Their code'),
          el('th.num', { scope: 'col' }, 'Their price'),
          el('th.num', { scope: 'col' }, 'On hand')
        )),
        el('tbody', {}, rows.map((r) => el('tr', {},
          el('td', {},
            el('a.cell-link', { href: productHref(r.product.id) }, el('div.cell-main', {}, r.product.name)),
            el('div.cell-sub', {}, [
              r.preferred ? 'default' : null,
              r.cheapest ? 'cheapest on file' : null,
              r.undercutBy ? `${formatMoney(r.undercutBy, currency)} more than the cheapest` : null,
            ].filter(Boolean).join(' · '))
          ),
          el('td.mono', {}, r.source.code || el('span.muted', {}, '-')),
          el('td.num', {}, r.source.price === null
            ? el('span.muted', {}, '-')
            : formatMoney(r.source.price, currency)),
          el('td.num', {}, `${formatQtyIn(r.product.quantity, r.product.unit)} ${unitLabel(r.product.unit, r.product.quantity)}`)
        )))
      )),
      supplies > rows.length
        ? el('p.small.muted', { style: { marginTop: '8px' } }, 'Archived products are left out.')
        : null,
    ]);
  };

  const details = el('details.disclosure.supplier-prices', {
    open: openPrices.has(supplierId),
    ontoggle: () => {
      if (details.open) { openPrices.add(supplierId); fill(); }
      else openPrices.delete(supplierId);
    },
  },
    el('summary', {}, `Price list: ${formatQty(rows.length)} product${rows.length === 1 ? '' : 's'}`
      + (priced.length < rows.length ? `, ${rows.length - priced.length} without a price` : '')),
    body
  );
  // An open one is rebuilt with its contents, so a store change doesn't
  // empty the list the user is reading.
  if (details.open) fill();
  return details;
}

function meta(ic, valueNode) {
  return el('div', { html: icon(ic, 14, 2) }, el('span.val', {}, valueNode));
}

/**
 * An outbound link for a website typed by hand. Only a real http(s) URL
 * is used as given — case and all — and everything else has the scheme
 * added rather than trusted, which is also what keeps a pasted
 * "javascript:" out of an href.
 */
function websiteHref(value) {
  const url = String(value).trim().replace(/^\/+/, '');
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
