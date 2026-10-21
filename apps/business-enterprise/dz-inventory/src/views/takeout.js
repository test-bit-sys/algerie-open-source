/**
 * Take out: a basket of stock leaving in one pass. Scan or search items
 * in, adjust the odd line, commit once — instead of one dialog per
 * product, which is the same work five times over at the busiest moment
 * of the day.
 *
 * Shaped like the count sheet on purpose: the same wedge scanning, the
 * same in-place row updates so typing survives a re-render, the same
 * resumable session behind it. Nothing new to learn, nothing new to
 * maintain.
 */

import { el, clear, append, CODE_FIELD } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  takeoutTotals, takeoutRef, lineReason, lineLocation, linePrice, lineAvailable,
} from '../lib/takeout.js';
import { REMOVAL_REASONS, reasonLabel } from '../lib/activity.js';
import { UNASSIGNED, UNASSIGNED_LABEL, stockAt } from '../lib/stock.js';
import { activeProducts } from '../lib/inventory.js';
import { kitMode, recipeSummary } from '../lib/kits.js';
import { searchRank } from '../lib/search.js';
import { isCountUnit, formatQtyIn, unitLabel, qtyWithUnit } from '../lib/units.js';
import { formatMoney, formatQty, timeAgo, debounce } from '../lib/util.js';
import { openScanner, listenForScans } from '../ui/scanner.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { openProductForm } from '../ui/productform.js';
import { toast } from '../ui/toast.js';

export function takeoutView() {
  const root = el('div.main-inner');

  /* Sheet-local state that survives re-renders. */
  const ui = { query: '', flashId: '' };

  /* Like the count sheet: the basket is built once and updated in place,
     because every change here is a quantity being typed into one of its
     rows — a rebuild would destroy the field under the cursor. */
  let sheet = null;
  let showing = '';

  const render = () => renderInto();
  store.addEventListener('change', render);

  /* A USB/Bluetooth scanner just types: while this view is open, a burst
     of keystrokes ending in Enter is an item joining the basket. */
  const stopWedge = listenForScans((code) => { handleScan(code); });

  root.destroy = () => {
    store.removeEventListener('change', render);
    stopWedge();
  };

  function renderInto() {
    const next = store.takeout ? 'basket' : 'start';
    if (next !== showing) {
      showing = next;
      sheet = null;
      clear(root);
      if (next === 'basket') buildSheet();
      else renderStart();
      return;
    }
    if (next === 'basket') refreshSheet();
  }

  /* ---------- Start screen ---------- */

  function renderStart() {
    let reason = 'sold';
    let locationId = null;

    const reasonChips = el('div.chips', { role: 'group', 'aria-label': 'Reason' },
      REMOVAL_REASONS.map((r) => el('button.chip', {
        type: 'button',
        dataset: { key: r.key },
        'aria-pressed': String(reason === r.key),
        onclick: () => {
          reason = r.key;
          for (const b of reasonChips.querySelectorAll('.chip')) {
            b.setAttribute('aria-pressed', String(b.dataset.key === r.key));
          }
        },
      }, r.label))
    );

    const locSelect = el('select.select', {
      id: 'to-loc',
      'aria-label': 'Where the stock leaves from',
      onchange: () => { locationId = locSelect.value === '*' ? null : locSelect.value; },
    },
      el('option', { value: '*' }, 'Each product’s own location'),
      store.locations.map((l) => el('option', { value: l.id }, l.name)),
      el('option', { value: UNASSIGNED }, UNASSIGNED_LABEL)
    );

    const noteInput = el('input.input', {
      id: 'to-note', maxLength: 120, placeholder: 'e.g. Saturday market, job #204',
    });

    const start = el('button.btn.btn-primary', { html: icon('packageMinus', 16, 2) }, ' Start a basket');
    start.onclick = async () => {
      start.disabled = true;
      try {
        await store.startTakeout({ reason, locationId, note: noteInput.value });
      } catch (err) {
        console.error(err);
        start.disabled = false;
        toast('Couldn’t start. Check your connection', { icon: 'wifiOff' });
      }
    };

    // append(), not root.append(): the last child is conditional, and a
    // raw append would print the word "null" where it isn't there.
    append(root, [
      el('div.view-head', {},
        el('div', {},
          el('h1.view-title', {}, 'Take out'),
          el('p.view-sub', {}, 'Scan a whole basket of stock out in one pass')
        )
      ),
      el('div.card', {},
        el('div.field', {}, el('label', {}, 'Reason'), reasonChips),
        el('div.field-grid', {},
          el('div.field', {},
            el('label', { htmlFor: 'to-loc' }, 'From'),
            el('div.select-wrap', {}, locSelect)
          ),
          el('div.field', {},
            el('label', { htmlFor: 'to-note' }, 'Note'),
            noteInput
          )
        ),
        el('p.small.muted', {},
          'These apply to the whole basket; any line can override them. '
          + 'Scan or search items in. A repeat scan counts one more of the same thing. '
          + 'The basket keeps itself saved, so a reload or a flat battery loses nothing, '
          + 'and nothing leaves stock until you commit it.'),
        el('div.row', { style: { marginTop: '12px' } }, el('div.grow'), start)
      ),
      !activeProducts(store.products).length
        ? el('div.card', {}, el('div.empty', {},
          el('div.empty-icon', { html: icon('package', 26) }),
          el('h3', {}, 'Nothing to take out yet'),
          el('p', {}, 'Add or import some products first.'),
          el('button.btn.btn-primary', { onclick: () => openProductForm() }, 'Add product')
        ))
        : null,
    ]);
  }

  /* ---------- Basket ---------- */

  /** Build the basket's lasting chrome; contents follow in refreshSheet. */
  function buildSheet() {
    const search = el('input.input', {
      // Codes are typed and scanned in here as often as names.
      ...CODE_FIELD,
      type: 'search',
      value: ui.query,
      placeholder: 'Scan, or search a product to add',
      'aria-label': 'Add a product to the basket',
      oninput: debounce(() => { ui.query = search.value; renderSuggestions(); }, 150),
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // A wedge scanner types its code and presses Enter; so does
        // someone who typed a code by hand. Either way the first match
        // joins the basket and the box clears for the next one.
        const code = search.value.trim();
        if (!code) return;
        const exact = store.productByCode(code);
        if (exact) { addProduct(exact.id); clearSearch(); return; }
        const first = suggestionsFor(code)[0];
        if (first) { addProduct(first.id); clearSearch(); return; }
        toast(`No product matches “${code}”`, { icon: 'circleAlert' });
      },
    });

    const suggestions = el('div.takeout-suggestions', { hidden: true });
    const subLine = el('p.view-sub');
    const totalsLine = el('p.small.muted', { 'aria-live': 'polite', style: { margin: 0 } });
    const commitBtn = el('button.btn.btn-primary', {
      html: icon('check', 16, 2.2),
      onclick: () => openReview(),
    }, ' Review & take out');
    const listWrap = el('div');
    const defaultsBar = el('div.toolbar');

    root.append(
      el('div.view-head', {},
        el('div', {},
          el('h1.view-title', {}, 'Take out'),
          subLine
        ),
        el('div.view-actions', {},
          el('button.btn.btn-secondary.scan-btn', { html: icon('barcode', 16, 2), onclick: startScanning }, ' Scan'),
          el('button.btn.btn-ghost', { onclick: cancelBasket }, 'Discard'),
          commitBtn
        )
      ),
      el('div.toolbar', {},
        el('div.searchbox', { html: icon('search', 16, 2) }, search),
        el('div.grow'),
        totalsLine
      ),
      suggestions,
      defaultsBar,
      listWrap
    );

    sheet = { search, suggestions, listWrap, subLine, totalsLine, commitBtn, defaultsBar, defaults: null, rows: new Map(), key: null };
    refreshSheet();
  }

  function clearSearch() {
    if (!sheet) return;
    sheet.search.value = '';
    ui.query = '';
    renderSuggestions();
    sheet.search.focus();
  }

  /** Products a typed query could mean, best first. */
  function suggestionsFor(query) {
    return searchRank(
      activeProducts(store.products),
      query,
      (p) => [p.name, p.sku, p.barcode],
      { limit: 6 }
    );
  }

  function renderSuggestions() {
    if (!sheet) return;
    const q = ui.query.trim();
    clear(sheet.suggestions);
    sheet.suggestions.hidden = !q;
    if (!q) return;
    const rows = suggestionsFor(q);
    if (!rows.length) {
      sheet.suggestions.append(el('p.small.muted', { style: { margin: '0 2px 8px' } },
        `Nothing matches “${q}”.`));
      return;
    }
    sheet.suggestions.append(el('div.item-list', {}, rows.map((p) => el('button.item-row', {
      type: 'button',
      onclick: () => { addProduct(p.id); clearSearch(); },
    },
      el('span.item-ic', { html: icon('package', 17) }),
      el('div.grow', {},
        el('div.title', {}, p.name),
        el('div.sub', {}, [
          `${qtyWithUnit(p.quantity, p.unit)} on hand`,
          p.sku,
          p.price ? formatMoney(p.price, store.settings.currency) : null,
        ].filter(Boolean).join(' · '))
      ),
      el('span.small.muted', { html: icon('plus', 16, 2.2) })
    ))));
  }

  async function addProduct(productId) {
    try {
      const line = await store.addToTakeout(productId);
      if (line) ui.flashId = line.id;
      render();
      scrollToLine(ui.flashId);
    } catch (err) {
      console.error(err);
      toast('Couldn’t add that. Check your connection', { icon: 'wifiOff' });
    }
  }

  function scrollToLine(lineId) {
    if (!lineId) return;
    requestAnimationFrame(() => {
      const node = root.querySelector(`[data-line="${CSS.escape(lineId)}"]`);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      node?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  function refreshSheet() {
    if (!sheet) return;
    const session = store.takeout;
    const totals = takeoutTotals(session, store.products);
    const currency = store.settings.currency;
    sheet.subLine.textContent = `${reasonLabel(session.reason)} · started ${timeAgo(session.startedAt)}`;
    sheet.totalsLine.textContent = totals.lines
      ? [
        `${formatQty(totals.lines)} line${totals.lines === 1 ? '' : 's'}`,
        totals.units ? `${formatQty(totals.units)} ${unitLabel('each', totals.units)}` : null,
        totals.revenue ? `${formatMoney(totals.revenue, currency)} in` : null,
      ].filter(Boolean).join(' · ')
      : 'Nothing in the basket yet';
    sheet.commitBtn.disabled = !totals.lines;
    renderDefaults(session);
    renderRows(session);
  }

  /**
   * What the whole basket leaves under — changeable mid-basket, and so
   * built once and synced after, like the lines below it. Changing one
   * of these saves, which re-renders the sheet: rebuilding the bar here
   * destroyed the very select the user had just used, dropping keyboard
   * focus to the page.
   *
   * The options are only rebuilt when the location list itself changes,
   * which is the one thing that can make them stale.
   */
  function renderDefaults(session) {
    const locKey = store.locations.map((l) => `${l.id}\u0000${l.name}`).join('\n');
    if (sheet.defaults?.locKey === locKey) {
      syncDefaults(session);
      return;
    }

    const save = (patch) => store.setTakeoutDefaults(patch)
      .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));

    const reasonSelect = el('select.select', {
      'aria-label': 'Reason for the whole basket',
      onchange: () => save({ reason: reasonSelect.value }),
    }, REMOVAL_REASONS.map((r) => el('option', { value: r.key }, r.label)));

    const locSelect = el('select.select', {
      'aria-label': 'Where the whole basket leaves from',
      onchange: () => save({ locationId: locSelect.value === '*' ? null : locSelect.value }),
    },
      el('option', { value: '*' }, 'Each product’s own location'),
      store.locations.map((l) => el('option', { value: l.id }, l.name)),
      el('option', { value: UNASSIGNED }, UNASSIGNED_LABEL)
    );

    const noteInput = el('input.input', {
      maxLength: 120,
      placeholder: 'Note for the whole basket',
      'aria-label': 'Note for the whole basket',
      onchange: () => save({ note: noteInput.value }),
    });

    sheet.defaults = { locKey, reasonSelect, locSelect, noteInput };
    clear(sheet.defaultsBar);
    sheet.defaultsBar.append(
      el('div.select-wrap', {}, reasonSelect),
      el('div.select-wrap', {}, locSelect),
      el('div.grow', { style: { minWidth: '160px' } }, noteInput)
    );
    syncDefaults(session);
  }

  /** Bring those controls up to date without replacing them. */
  function syncDefaults(session) {
    const { reasonSelect, locSelect, noteInput } = sheet.defaults;
    reasonSelect.value = session.reason;
    // A string — '' included — is a real bucket; null means "each
    // product's own", which the '*' option stands for.
    locSelect.value = typeof session.locationId === 'string' ? session.locationId : '*';
    // Never overwrite a note being typed: this runs on every keystroke
    // landing in a line's quantity.
    if (document.activeElement !== noteInput) noteInput.value = session.note || '';
  }

  /**
   * Reconcile the basket's rows. While the same lines are on screen —
   * which is every quantity typed — each row is updated in place, so the
   * field being typed into survives and Tab reaches the next one.
   */
  function renderRows(session) {
    const lines = session.lines;
    const key = lines.map((l) => l.id).join('\n');
    if (key === sheet.key) {
      for (const line of lines) syncRow(session, line);
      return;
    }
    sheet.key = key;
    sheet.rows.clear();
    clear(sheet.listWrap);

    if (!lines.length) {
      sheet.listWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('barcode', 26) }),
        el('h3', {}, 'Scan the first item'),
        el('p', {}, 'Point a scanner at it, or search for it above. Each scan of the same item counts one more.')
      )));
      return;
    }
    sheet.listWrap.append(el('div.item-list', {}, lines.map((l) => lineRow(session, l))));
  }

  function lineRow(session, line) {
    const product = store.productById(line.productId);
    const unit = product?.unit ?? line.unit;
    const whole = isCountUnit(unit);
    const currency = store.settings.currency;

    const qtyInput = el('input.input.order-qty', {
      type: 'number', min: 0,
      step: whole ? 1 : 'any',
      inputmode: whole ? 'numeric' : 'decimal',
      value: String(line.qty),
      'aria-label': `Quantity of ${line.name}`,
      onchange: () => {
        const v = qtyInput.valueAsNumber;
        if (!Number.isFinite(v) || v <= 0) {
          // A cleared or zero quantity is a line being taken out of the
          // basket, which is what the X does — say so rather than
          // committing a line that removes nothing.
          qtyInput.value = String(line.qty);
          toast('Use the ✕ to take a line out of the basket', { icon: 'info' });
          return;
        }
        store.setTakeoutLine(line.id, { qty: v })
          .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));
      },
    });

    const priceInput = el('input.input.order-qty', {
      type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
      value: line.price === null || line.price === undefined ? '' : String(line.price),
      placeholder: 'Unpriced',
      'aria-label': `Sale price per ${unitLabel(unit, 1)} of ${line.name}`,
      onchange: () => {
        store.setTakeoutLine(line.id, { price: priceInput.value.trim() === '' ? null : priceInput.valueAsNumber })
          .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' }));
      },
    });

    const sub = el('div.sub');
    const mark = el('span.item-ic', { html: icon('packageMinus', 17) });
    const unitTag = el('span.small.muted', {}, unitLabel(unit, line.qty));

    const node = el('div.item-row.row-stacks', { dataset: { line: line.id } },
      mark,
      el('div.grow', {},
        el('div.title', {}, line.name),
        sub
      ),
      el('div.order-qty-wrap', {}, qtyInput, unitTag),
      el('div.order-qty-wrap.takeout-price', {}, priceInput, el('span.small.muted', {}, currencySymbol(currency))),
      // One group, so a narrow row wraps both buttons together instead
      // of stranding the ✕ on a line of its own.
      el('div.takeout-line-actions', {},
        el('button.icon-btn', {
          type: 'button',
          html: icon('more', 16),
          'aria-label': `Options for ${line.name}`,
          title: 'Reason, location, note',
          onclick: () => openLineOptions(line.id),
        }),
        el('button.icon-btn', {
          type: 'button',
          html: icon('x', 16),
          'aria-label': `Take ${line.name} out of the basket`,
          title: 'Remove line',
          onclick: () => store.removeTakeoutLine(line.id)
            .catch(() => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' })),
        })
      )
    );
    sheet.rows.set(line.id, { node, qtyInput, priceInput, sub, mark, unitTag });
    syncRow(session, line);
    if (ui.flashId === line.id) {
      node.classList.add('count-flash');
      ui.flashId = '';
    }
    return node;
  }

  /** Bring one already-rendered row up to date without replacing it. */
  function syncRow(session, line) {
    const parts = sheet.rows.get(line.id);
    if (!parts) return;
    const { node, qtyInput, priceInput, sub, mark, unitTag } = parts;
    const product = store.productById(line.productId);
    const unit = product?.unit ?? line.unit;
    // "2 units", not "2 unit": the quantity is edited in place, so the
    // word beside it has to follow.
    unitTag.textContent = unitLabel(unit, line.qty);
    const available = lineAvailable(session, line, product, store.products);
    const short = product && line.qty > available;
    // A sell-as-kit's components leave their own shelves, so there is no
    // one place for this line to name.
    const sellKit = product && kitMode(product) === 'sell';
    const reason = lineReason(session, line);
    const price = linePrice(session, line);
    const own = [];
    if (line.reason) own.push(reasonLabel(line.reason));
    if (typeof line.locationId === 'string') own.push(store.locationName(line.locationId));

    if (document.activeElement !== qtyInput) qtyInput.value = String(line.qty);
    if (document.activeElement !== priceInput) {
      priceInput.value = line.price === null || line.price === undefined ? '' : String(line.price);
    }
    // Only a sale has a price; a write-off's field would be a number
    // with nowhere to go.
    priceInput.closest('.takeout-price').hidden = reason !== 'sold';

    sub.textContent = [
      !product
        ? 'No longer in the products list'
        : (sellKit
          ? `${formatQtyIn(available, unit)} available from ${recipeSummary(product, store.products)}`
          : `${formatQtyIn(available, unit)} at ${store.locationName(lineLocation(session, line, product))}`),
      own.length ? own.join(' · ') : null,
      line.note || null,
      price !== null && line.qty ? `${formatMoney(price * line.qty, store.settings.currency)} in` : null,
    ].filter(Boolean).join(' · ');

    node.classList.toggle('line-short', !!short || !product);
    mark.className = `item-ic${short || !product ? ' warn' : ''}`;
    mark.innerHTML = icon(short || !product ? 'alert' : 'packageMinus', 17);
    if (ui.flashId === line.id) {
      ui.flashId = '';
      node.classList.remove('count-flash');
      void node.offsetWidth;
      node.classList.add('count-flash');
    }
  }

  /* ---------- One line's own reason, location, and note ---------- */

  function openLineOptions(lineId) {
    const session = store.takeout;
    const line = session?.lines.find((l) => l.id === lineId);
    if (!line) return;
    const product = store.productById(line.productId);

    const reasonSelect = el('select.select', { id: 'tol-reason' },
      el('option', { value: '', selected: !line.reason }, `Same as the basket (${reasonLabel(session.reason)})`),
      REMOVAL_REASONS.map((r) => el('option', { value: r.key, selected: line.reason === r.key }, r.label))
    );

    // What "inherit" actually resolves to for this line, named: the
    // basket's location, or — when the basket says "each product's own"
    // — this product's own.
    const inherited = typeof session.locationId === 'string'
      ? `Same as the basket (${store.locationName(session.locationId)})`
      : `Its own location (${store.locationName(lineLocation(session, {}, product))})`;
    const locSelect = el('select.select', { id: 'tol-loc' },
      el('option', { value: '*', selected: typeof line.locationId !== 'string' }, inherited),
      store.locations.map((l) => el('option', {
        value: l.id, selected: line.locationId === l.id,
      }, `${l.name}${product ? `: ${formatQtyIn(stockAt(product, l.id), product.unit)}` : ''}`)),
      el('option', { value: UNASSIGNED, selected: line.locationId === UNASSIGNED }, UNASSIGNED_LABEL)
    );

    const noteInput = el('input.input', {
      id: 'tol-note', maxLength: 120, value: line.note || '',
      placeholder: session.note || 'Same as the basket',
    });

    const save = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Save line');
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
          await store.setTakeoutLine(line.id, {
            reason: reasonSelect.value,
            locationId: locSelect.value === '*' ? null : locSelect.value,
            note: noteInput.value,
          });
          modal.close();
        } catch (err) {
          console.error(err);
          save.disabled = false;
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        }
      },
    },
      el('p.confirm-message', { style: { marginBottom: '14px' } },
        el('strong', {}, line.name),
        line.sku ? el('span.muted.mono', {}, `  ${line.sku}`) : null),
      el('div.field', {}, el('label', { htmlFor: 'tol-reason' }, 'Reason'), el('div.select-wrap', {}, reasonSelect)),
      el('div.field', {}, el('label', { htmlFor: 'tol-loc' }, 'From'), el('div.select-wrap', {}, locSelect)),
      el('div.field', {}, el('label', { htmlFor: 'tol-note' }, 'Note'), noteInput),
      save
    );

    const modal = openModal({
      title: 'This line',
      content: form,
      unsaved: () => reasonSelect.value !== (line.reason || '')
        || locSelect.value !== (typeof line.locationId === 'string' ? line.locationId : '*')
        || noteInput.value.trim() !== (line.note || ''),
    });
  }

  /* ---------- Scanning ---------- */

  async function handleScan(code) {
    if (!store.takeout) {
      // A scan is a perfectly good way to start: the basket opens with
      // the defaults and the item is already in it.
      try {
        await store.startTakeout();
      } catch (err) {
        console.error(err);
        return null;
      }
    }
    let line = null;
    try {
      line = await store.scanIntoTakeout(code);
    } catch (err) {
      console.error(err);
      toast('Couldn’t add that. Check your connection', { icon: 'wifiOff' });
      return null;
    }
    if (!line) {
      toast(`No product with code ${code}`, {
        icon: 'circleAlert',
        action: { label: 'Add it', onClick: () => openProductForm(null, { prefill: { barcode: code } }) },
      });
      return null;
    }
    ui.flashId = line.id;
    render();
    scrollToLine(line.id);
    return line;
  }

  function startScanning() {
    openScanner({
      title: 'Scan into the basket',
      hint: 'Each scan adds one. The scanner stays open for the next item.',
      continuous: true,
      onCode: async (code) => {
        const line = await handleScan(code);
        return !!line;
      },
    });
  }

  async function cancelBasket() {
    const lines = store.takeout?.lines.length || 0;
    const ok = await confirmDialog({
      title: 'Discard this basket?',
      message: lines
        ? `${lines} line${lines === 1 ? ' is' : 's are'} thrown away and nothing about stock changes.`
        : 'The basket is discarded; nothing about stock changes.',
      confirmLabel: 'Discard basket',
    });
    if (!ok) return;
    try {
      await store.cancelTakeout();
    } catch (err) {
      console.error(err);
      toast('Couldn’t discard. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* ---------- Review & commit ---------- */

  function openReview() {
    const session = store.takeout;
    if (!session?.lines.length) return;
    const currency = store.settings.currency;
    const totals = takeoutTotals(session, store.products);

    const commit = el('button.btn.btn-primary', {
      onclick: async () => {
        commit.disabled = true;
        let token;
        try {
          token = await store.applyTakeout();
        } catch (err) {
          console.error(err);
          commit.disabled = false;
          toast(err?.message === 'Nothing in the basket could be taken out'
            ? 'Nothing left to take out. Every line’s stock is already gone'
            : 'Couldn’t take it out. Check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
        const n = token.count ?? token.lines.length;
        toast(`${n} line${n === 1 ? '' : 's'} taken out`, {
          icon: 'packageMinus',
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                await store.undoTakeout(token);
                toast('Take-out undone. The stock is back', { icon: 'rotateCcw' });
              } catch (err) {
                console.error(err);
                toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' });
              }
            },
          },
        });
      },
    }, 'Take it out');

    const content = el('div', {},
      el('p.confirm-message', {},
        `${totals.lines} line${totals.lines === 1 ? '' : 's'} leaving stock`,
        totals.units ? `, ${formatQty(totals.units)} ${unitLabel('each', totals.units)}` : '',
        totals.revenue ? `: ${formatMoney(totals.revenue, currency)} in, ${formatMoney(totals.profit, currency)} gross profit at today’s cost.` : '.'),
      el('div.table-wrap', { style: { margin: '10px 0' } }, el('table.table.compact', {},
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Product'),
          el('th', { scope: 'col' }, 'Reason'),
          el('th', { scope: 'col' }, 'From'),
          el('th.num', { scope: 'col' }, 'Qty'),
          el('th.num', { scope: 'col' }, 'Takes in')
        )),
        el('tbody', {}, session.lines.map((line) => {
          const product = store.productById(line.productId);
          const unit = product?.unit ?? line.unit;
          const available = lineAvailable(session, line, product, store.products);
          const short = product && line.qty > available;
          const sellKit = product && kitMode(product) === 'sell';
          const price = linePrice(session, line);
          return el('tr', {},
            el('td', {},
              el('div.cell-main', {}, line.name),
              !product
                ? el('div.cell-sub', { style: { color: 'var(--danger)' } }, 'Deleted. This line is skipped')
                : (short
                  ? el('div.cell-sub', { style: { color: 'var(--warn)' } }, `Only ${formatQtyIn(available, unit)} here; that much leaves`)
                  : null)
            ),
            el('td', {}, reasonLabel(lineReason(session, line))),
            el('td', {}, sellKit
              ? el('span.muted', {}, 'its components')
              : store.locationName(lineLocation(session, line, product))),
            el('td.num', {}, formatQtyIn(line.qty, unit)),
            el('td.num', {}, price === null ? el('span.muted', {}, '-') : formatMoney(price * line.qty, currency))
          );
        }))
      )),
      el('p.small.muted', {}, [
        `Recorded as one event: “${takeoutRef(session)}”`,
        totals.unpriced ? `${totals.unpriced} sold line${totals.unpriced === 1 ? '' : 's'} carry no price` : null,
        'A snapshot is taken first, and you can undo the whole basket afterwards.',
      ].filter(Boolean).join(' · ')),
      el('div.row.row-end', { style: { marginTop: '12px' } },
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Keep scanning'),
        commit
      )
    );

    const modal = openModal({ title: 'Review the basket', content, wide: true });
  }

  render();
  return root;
}

/** The currency's symbol alone, for the tight label beside a price box. */
function currencySymbol(currency) {
  const formatted = formatMoney(0, currency);
  const symbol = formatted.replace(/[\d\s.,]/g, '');
  return symbol || currency;
}
