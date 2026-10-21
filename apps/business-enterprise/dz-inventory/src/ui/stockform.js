/**
 * Quick stock adjustment: receive, remove, recount, or move between
 * locations. Every change goes through the store so it lands in the
 * activity log.
 *
 * Counted products stay whole; measured ones (kg, L, m) take decimals.
 * Products bought in packs can be received by the case, with the
 * conversion spelled out in the preview line. Stock always belongs to
 * one location, defaulting to the product's own so the single-location
 * workflow stays one tap.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { round2, formatMoney } from '../lib/util.js';
import {
  isCountUnit, roundQty, formatQtyIn, qtyWithUnit, unitLabel,
  packSizeOf, packLabel, packsToUnits, packSummary,
} from '../lib/units.js';
import { UNASSIGNED, UNASSIGNED_LABEL, stockAt, stockEntries, defaultLocationId, binAt } from '../lib/stock.js';
import { REMOVAL_REASONS } from '../lib/activity.js';
import { onOrderQty } from '../lib/reorder.js';
import { lotsAt, lotDateLabel } from '../lib/lots.js';
import { kitMode, buildableQty, limitingComponent, recipeSummary, kitUnitCost } from '../lib/kits.js';

const MODES = [
  { key: 'add', label: 'Receive', hint: 'Add units to stock' },
  { key: 'remove', label: 'Remove', hint: 'Take units out of stock' },
  { key: 'set', label: 'Recount', hint: 'Set the exact count on hand' },
  { key: 'move', label: 'Move', hint: 'Shift stock between locations' },
];

export function openStockForm(productId, {
  mode: initialMode = 'add', reason: initialReason = 'sold',
  locationId: initialLocation, onSaved, onClose,
} = {}) {
  const product = store.productById(productId);
  if (!product) return;

  const unit = product.unit;
  const counted = isCountUnit(unit);
  const packSize = packSizeOf(product);
  /* Units still due on open orders — "3 on hand · 12 on order". */
  const onOrder = onOrderQty(store.orders).get(product.id) || 0;
  /* Moving needs somewhere to move to; with no locations at all, every
     adjustment just lands in the unassigned bucket. */
  const canMove = store.locations.length > 0;
  /* A sell-as-kit holds no stock of its own: there is nothing to
     receive into it, nothing to recount, and nothing to move. Removing
     is the one thing that means anything, and it takes its components
     out instead. */
  const kit = kitMode(product);
  const modes = MODES
    .filter((m) => m.key !== 'move' || canMove)
    .filter((m) => kit !== 'sell' || m.key === 'remove');

  /* Whatever was asked for, if it's on offer — else the first mode that
     is. A sell-as-kit only offers Remove, and a dialog opened on a mode
     it doesn't have would have nothing to describe. */
  let mode = modes.some((m) => m.key === initialMode) ? initialMode : (modes[0]?.key || 'add');
  /* Callers that already know which shelf they mean — the product page's
     per-location rows — open on it, so the dialog doesn't ask again. A
     bucket key is a string, and '' (unassigned) is a real answer. */
  let location = typeof initialLocation === 'string' ? initialLocation : defaultLocationId(product);
  let moveTo = firstOtherLocation(location);
  /* Why stock is leaving. 'sold' keeps the fast path one tap; the store
     writes it onto the log entry so shrinkage and demand reports can
     tell a sale from a write-off. Callers may preselect (the expiry
     alerts open Remove with 'expired' already picked). */
  let reason = REMOVAL_REASONS.some((r) => r.key === initialReason) ? initialReason : 'sold';
  /* For products tracking expiry: the lot a removal takes from
     (undefined = earliest first), and the date a receipt carries. */
  const tracked = !!product.trackExpiry;
  let fromLot;
  /* Whole packs, or single units? Only offered when a pack size is set,
     and never for a recount, which is always an absolute count. */
  let inPacks = false;

  function firstOtherLocation(from) {
    const other = store.locations.find((l) => l.id !== from);
    if (other) return other.id;
    return from === UNASSIGNED ? (store.locations[0]?.id ?? UNASSIGNED) : UNASSIGNED;
  }

  const qtyInput = el('input.input', {
    type: 'number', min: 0,
    step: counted ? 1 : 'any',
    inputmode: counted ? 'numeric' : 'decimal',
    'aria-label': 'Quantity',
    // The amount is what this dialog is for; the location and reason
    // pickers above it are usually already right.
    'data-autofocus': '',
  });
  const noteInput = el('input.input', { maxLength: 120, placeholder: 'e.g. PO #1042, cycle count' });
  const preview = el('p.hint', { 'aria-live': 'polite' });
  const hint = el('p.hint');

  // valueAsNumber understands everything the number input accepts
  // (including "1e2"), which string re-parsing would mangle.
  const readQty = () => {
    const n = qtyInput.valueAsNumber;
    if (!Number.isFinite(n) || n < 0) return NaN;
    // Packs are always whole; units follow the product's own precision.
    return inPacks ? Math.round(n) : roundQty(n, unit);
  };

  /** What the typed amount means in the product's own unit. */
  const enteredUnits = () => {
    const n = readQty();
    if (Number.isNaN(n)) return NaN;
    return inPacks ? packsToUnits(n, product) : n;
  };

  const here = () => stockAt(product, location);

  // Declared before the first update() call below, which toggles it.
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Apply');

  const seg = el('div.segmented', { role: 'group', 'aria-label': 'Adjustment type' },
    modes.map((m) => el('button', {
      type: 'button',
      'aria-pressed': String(m.key === mode),
      onclick: (e) => {
        mode = m.key;
        for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        if (mode === 'move') location = defaultMoveSource();
        if (mode === 'set') inPacks = false;
        fromLot = undefined;
        resetQty();
        renderReasons();
        renderCost();
        renderPrice();
        renderLotControls();
        renderLocations();
        renderUnitToggle();
        syncTitle();
        update();
      },
    }, m.label))
  );

  /** Move from wherever the stock actually is, if that's unambiguous. */
  function defaultMoveSource() {
    const entries = stockEntries(product);
    if (entries.length && !entries.some(([id]) => id === location)) return entries[0][0];
    return location;
  }

  /** Move and adjust are different jobs; the heading has to say which. */
  function syncTitle() {
    const text = titleFor(mode);
    const heading = modal.panel.querySelector('.modal-title');
    if (heading) heading.textContent = text;
    modal.panel.setAttribute('aria-label', text);
  }

  /* What the quantity field held after its last programmatic (re)seed;
     anything else in it is the user's own typing. */
  let qtyBaseline = '';

  function resetQty() {
    qtyInput.step = !inPacks && !counted ? 'any' : '1';
    if (mode === 'set') qtyInput.value = String(here());
    else if (mode === 'move') qtyInput.value = String(here() || 1);
    else qtyInput.value = '1';
    qtyBaseline = qtyInput.value;
  }

  /**
   * The seeded amount is a suggestion to type over, not a number to add
   * digits to. Focus alone parks the caret after it, so the first key
   * pressed turned a prefilled "1" into 15 and a recount of 42 into 427
   * — the one thing this dialog exists to type.
   */
  function selectQty() {
    if (document.activeElement === qtyInput) qtyInput.select();
  }

  /* --- Cost, Receive mode only ---
     What each unit (or case) cost this time, prefilled with the current
     cost so the nothing-changed case stays zero extra taps. Only an
     actual edit sends it: an untouched field keeps today's behavior
     bit-for-bit, no revaluation, nothing extra on the log entry. */
  const costInput = el('input.input', {
    type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
    oninput: () => { costEdited = true; update(); },
  });
  const costLabel = el('label', { htmlFor: 'stock-cost' }, 'Cost');
  const costHint = el('p.hint');
  const costRow = el('div.field', {}, costLabel, Object.assign(costInput, { id: 'stock-cost' }), costHint);
  let costEdited = false;

  /** The typed cost as per-unit money, or null when blank/unusable/untouched. */
  function enteredCost() {
    if (!costEdited || costInput.value.trim() === '') return null;
    const n = costInput.valueAsNumber;
    if (!Number.isFinite(n) || n < 0) return null;
    return round2(inPacks && packSize ? n / packSize : n);
  }

  function renderCost() {
    costRow.hidden = mode !== 'add';
    if (costRow.hidden) return;
    costLabel.textContent = `Cost per ${inPacks && packSize ? packLabel(product, 1) : unitLabel(unit, 1)}`;
    const current = Number(product.cost) || 0;
    costInput.placeholder = 'Optional';
    costInput.value = current ? String(inPacks && packSize ? round2(current * packSize) : current) : '';
    costEdited = false;
  }

  /* --- Sale price, Remove + "Sold" only ---
     What each unit (or case) actually went out for, prefilled from the
     product's selling price so the ordinary case costs no extra taps.
     Whatever stands in the field is what lands on the log entry; cleared,
     the removal is recorded exactly as it was before prices existed and
     the sales report counts it as unpriced rather than valuing it at
     list price. */
  const priceInput = el('input.input', {
    type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
    oninput: () => { priceEdited = true; update(); },
  });
  const priceLabel = el('label', { htmlFor: 'stock-price' }, 'Sale price');
  const priceHint = el('p.hint', { id: 'stock-price-hint' });
  const priceRow = el('div.field', { hidden: true }, priceLabel,
    Object.assign(priceInput, { id: 'stock-price', 'aria-describedby': 'stock-price-hint' }), priceHint);
  let priceEdited = false;
  /* What the field held after its last programmatic prefill; anything
     else in it is the user's own number (see the sheet's unsaved test). */
  let priceBaseline = '';

  /** Is a sale price on offer at all? Only a sale has one. */
  const pricing = () => mode === 'remove' && reason === 'sold';

  /** The typed price as per-unit money, or null when blank/unusable. */
  function enteredPrice() {
    if (!pricing() || priceInput.value.trim() === '') return null;
    const n = priceInput.valueAsNumber;
    if (!Number.isFinite(n) || n < 0) return null;
    return round2(inPacks && packSize ? n / packSize : n);
  }

  function renderPrice() {
    priceRow.hidden = !pricing();
    if (priceRow.hidden) return;
    priceLabel.textContent = `Sale price per ${inPacks && packSize ? packLabel(product, 1) : unitLabel(unit, 1)}`;
    const list = Number(product.price) || 0;
    priceInput.placeholder = 'Optional';
    priceInput.value = list ? String(inPacks && packSize ? round2(list * packSize) : list) : '';
    priceBaseline = priceInput.value;
    priceEdited = false;
  }

  /** "Takes in $36.00 — $14.10 gross profit" while the amount is typed. */
  function syncPriceHint() {
    if (priceRow.hidden) { priceHint.textContent = ''; return; }
    const paid = enteredPrice();
    const going = enteredUnits();
    if (paid === null) {
      priceHint.textContent = 'Leave it blank to record the removal without a price.';
      return;
    }
    if (Number.isNaN(going) || going <= 0) {
      priceHint.textContent = 'Recorded on this removal, for the sales report.';
      return;
    }
    const revenue = round2(paid * going);
    // A sell-as-kit's cost is what its components cost: it has no
    // moving average of its own, and calling that zero would report the
    // whole price as profit.
    const unitCost = kit === 'sell' ? kitUnitCost(product, store.products) : (Number(product.cost) || 0);
    const profit = round2(revenue - unitCost * going);
    const currency = store.settings.currency;
    priceHint.textContent = `Takes in ${formatMoney(revenue, currency)}`
      + `: ${formatMoney(profit, currency)} gross profit at today’s cost.`;
  }

  /** "Average cost becomes …" — the same maths the store will apply. */
  function syncCostHint() {
    costHint.textContent = '';
    if (mode !== 'add') return;
    const paid = enteredCost();
    const added = enteredUnits();
    if (paid === null || Number.isNaN(added) || added <= 0) return;
    const onHand = Number(product.quantity) || 0;
    const oldCost = Number(product.cost) || 0;
    const next = onHand > 0 ? round2((onHand * oldCost + added * paid) / (onHand + added)) : paid;
    if (next !== oldCost) {
      costHint.textContent = `Average cost becomes ${formatMoney(next, store.settings.currency)} per ${unitLabel(unit, 1)}.`;
    }
  }

  /* --- Dated lots (products tracking expiry) --- */
  // The hint is where the field says it may be left empty at all, so the
  // field points at it rather than leaving it as text alongside.
  const expiryInput = el('input.input', { type: 'date', 'aria-describedby': 'stock-expiry-hint' });
  const expiryRow = el('div.field', { hidden: true },
    el('label', { htmlFor: 'stock-expiry' }, 'Expiry date'),
    Object.assign(expiryInput, { id: 'stock-expiry' }),
    el('p.hint', { id: 'stock-expiry-hint' }, 'Optional. Leave blank when the stock carries no date.')
  );
  const lotRow = el('div.field');
  const lotsLine = el('p.hint');

  function renderLotControls() {
    expiryRow.hidden = !tracked || mode !== 'add';
    clear(lotRow);
    lotRow.hidden = !tracked || mode !== 'remove';
    const held = tracked ? lotsAt(product, location) : [];
    if (!lotRow.hidden && held.length) {
      const sel = el('select.select', {
        onchange: () => { fromLot = sel.value === '*' ? undefined : sel.value.slice(2); },
      },
        el('option', { value: '*' }, 'Earliest date first'),
        // 'd:' keeps a lot's real value apart from the default — a
        // no-date lot's date is '' and would collide otherwise.
        held.map((lot) => el('option', { value: `d:${lot.date}` },
          `${lotDateLabel(lot.date)}: ${formatQtyIn(lot.qty, unit)} ${unitLabel(unit, lot.qty)}`))
      );
      sel.value = fromLot === undefined ? '*' : `d:${fromLot}`;
      if (!sel.value) { sel.value = '*'; fromLot = undefined; }
      lotRow.append(labelled('Take from', sel));
    } else if (!lotRow.hidden) {
      lotRow.hidden = true;
    }
    // "5 × Sep 1 · 2 × No date" — where the dated stock at this
    // location stands, whatever the mode.
    lotsLine.hidden = !tracked || !held.length;
    lotsLine.textContent = lotsLine.hidden ? '' :
      `At ${store.locationName(location)}: ${held.map((l) => `${formatQtyIn(l.qty, unit)} × ${lotDateLabel(l.date)}`).join(' · ')}`;
  }

  /* Reason chips, Remove mode only. */
  const reasonRow = el('div.field');
  function renderReasons() {
    clear(reasonRow);
    reasonRow.hidden = mode !== 'remove';
    if (reasonRow.hidden) return;
    reasonRow.append(
      el('label', {}, 'Reason'),
      el('div.chips', { role: 'group', 'aria-label': 'Removal reason' },
        REMOVAL_REASONS.map((r) => el('button.chip', {
          type: 'button',
          'aria-pressed': String(reason === r.key),
          onclick: (e) => {
            reason = r.key;
            // In place — a rebuild would destroy the pressed chip
            // under the user's keyboard focus.
            for (const b of reasonRow.querySelectorAll('.chip')) {
              b.setAttribute('aria-pressed', String(b === e.currentTarget));
            }
            // Only a sale has a price; the field appears and disappears
            // with the reason, keeping its prefill in step.
            renderPrice();
            update();
          },
        }, r.label))
      )
    );
  }

  /* Location pickers: one for adjustments, from/to for a move. */
  const locationRow = el('div.field');
  /* Each render claims a pass. Building a picker can correct a selection
     its options don't contain — stock sitting in a location that isn't on
     file — and that correction re-renders this row from inside the
     callback. The outer pass has to stand down rather than append the
     select it was already holding, or the sheet shows two Location
     pickers for the same bucket. */
  let locationPass = 0;
  function renderLocations() {
    const pass = ++locationPass;
    // A sell-as-kit's components leave their own places; there is no
    // bucket for the kit itself to pick.
    if (!store.locations.length || kit === 'sell') { clear(locationRow); return; }
    const content = mode === 'move'
      ? el('div.field-grid', {},
        labelled('From', locationSelect(location, (v) => {
          location = v;
          if (moveTo === location) moveTo = firstOtherLocation(location);
          resetQty();
          // The dated-lots line describes the source; it has to
          // follow the switch or it reports the location just left.
          renderLotControls();
          renderLocations();
          update();
        }, { showQty: true })),
        labelled('To', locationSelect(moveTo, (v) => { moveTo = v; update(); }, { exclude: location }))
      )
      : labelled('Location', locationSelect(location, (v) => {
        location = v;
        // A recount states the count at that location, so it re-seeds;
        // a received or removed amount doesn't depend on where it lands,
        // so the number already typed survives the switch.
        if (mode === 'set') resetQty();
        // The lots on offer belong to the location just left.
        fromLot = undefined;
        renderLotControls();
        renderLocations();
        update();
      }, { showQty: true }));
    if (pass !== locationPass) return;
    clear(locationRow);
    locationRow.append(content);
  }

  function labelled(text, control) {
    // The visible label isn't wired to the control (no id to point at),
    // so it names it directly — otherwise From and To read as two
    // anonymous comboboxes and a screen reader can't tell them apart.
    control.setAttribute('aria-label', text);
    return el('div.field', {}, el('label', { 'aria-hidden': 'true' }, text), el('div.select-wrap', {}, control));
  }

  function locationSelect(value, onPick, { exclude = null, showQty = false } = {}) {
    const options = [
      ...store.locations.map((l) => ({ id: l.id, name: l.name })),
      { id: UNASSIGNED, name: UNASSIGNED_LABEL },
    ].filter((o) => o.id !== exclude);
    const sel = el('select.select', { onchange: () => onPick(sel.value) },
      options.map((o) => {
        const held = stockAt(product, o.id);
        const suffix = showQty && held ? `: ${formatQtyIn(held, unit)}` : '';
        // The shelf code, where there is one: it's what the person
        // holding the box is looking for.
        const bin = binAt(product, o.id);
        return el('option', { value: o.id, selected: o.id === value },
          `${o.name}${bin ? ` · ${bin}` : ''}${suffix}`);
      })
    );
    // A value that got excluded (both ends of a move) falls back rather
    // than silently keeping a stale selection.
    if (!options.some((o) => o.id === value)) {
      sel.value = options[0]?.id ?? UNASSIGNED;
      onPick(sel.value);
    }
    return sel;
  }

  /* Units / packs switch, e.g. "Units | Cases" */
  const unitToggle = el('div.qty-toggle');
  function renderUnitToggle() {
    clear(unitToggle);
    unitToggle.hidden = !packSize || mode === 'set';
    if (unitToggle.hidden) return;
    for (const opt of [
      { packs: false, label: cap(unitLabel(unit, 2)) },
      { packs: true, label: cap(packLabel(product, 2)) },
    ]) {
      unitToggle.append(el('button', {
        type: 'button',
        'aria-pressed': String(inPacks === opt.packs),
        onclick: () => {
          if (inPacks === opt.packs) return;
          inPacks = opt.packs;
          qtyInput.value = '1';
          qtyBaseline = '1';
          qtyInput.step = opt.packs || counted ? '1' : 'any';
          renderUnitToggle();
          // The cost and price fields' basis (per unit / per case) just
          // changed; re-prefill them in the new one.
          renderCost();
          renderPrice();
          update();
          qtyInput.focus();
          selectQty();
        },
      }, opt.label));
    }
  }

  function resulting() {
    const n = enteredUnits();
    if (Number.isNaN(n)) return null;
    if (mode === 'add') return roundQty(here() + n, unit);
    if (mode === 'remove' || mode === 'move') return roundQty(Math.max(0, here() - n), unit);
    return n;
  }

  function update() {
    hint.textContent = modes.find((m) => m.key === mode).hint;
    const after = resulting();
    const entered = enteredUnits();
    const at = store.locationName(location);
    const conversion = inPacks && !Number.isNaN(readQty()) ? `${packSummary(readQty(), product)}. ` : '';

    if (mode === 'move') {
      const moving = Number.isNaN(entered) ? 0 : Math.min(entered, here());
      submit.disabled = !moving || location === moveTo;
      preview.textContent = !here()
        ? `Nothing at ${at} to move.`
        : `${conversion}Moving ${qtyWithUnit(moving, unit)} from ${at} to ${store.locationName(moveTo)}. Total on hand stays ${formatQtyIn(product.quantity, unit)}.`;
      return;
    }

    // A sell-as-kit's own count never moves — its components do — so
    // "nothing to change" would refuse the only thing this dialog can do.
    if (kit === 'sell') {
      const going = Number.isNaN(entered) ? 0 : entered;
      const most = buildableQty(product, store.products);
      submit.disabled = going <= 0;
      preview.textContent = going <= 0
        ? (counted ? 'Enter a whole number of kits.' : `Enter an amount in ${unitLabel(unit, 2)}.`)
        : going > most
          ? `Only ${formatQtyIn(most, unit)} worth of components on hand; what is there will be taken out.`
          : `Takes out the components for ${qtyWithUnit(going, unit)}.`;
      syncCostHint();
      syncPriceHint();
      return;
    }

    const same = after === here();
    submit.disabled = after === null || same;
    preview.textContent = after === null
      ? (counted ? 'Enter a whole number of units.' : `Enter an amount in ${unitLabel(unit, 2)}.`)
      : same
        ? `${qtyWithUnit(here(), unit)} at ${at}; nothing to change yet.`
        : `${conversion}${qtyWithUnit(here(), unit)} at ${at} now, ${formatQtyIn(after, unit)} after this change.`;
    syncCostHint();
    syncPriceHint();
  }
  qtyInput.addEventListener('input', update);

  const stepBtn = (dir) => el('button', {
    type: 'button',
    'aria-label': dir > 0 ? 'Increase quantity' : 'Decrease quantity',
    html: icon(dir > 0 ? 'plus' : 'minus', 17, 2.2),
    onclick: () => {
      const n = readQty();
      qtyInput.value = String(Math.max(0, (Number.isNaN(n) ? 0 : n) + dir));
      update();
    },
  });

  /* Scanning a barcode, or opening a history row, can land here on a
     product that's been retired. Receiving stock into something hidden
     from every list is nearly always a mistake — the CSV importer warns
     about it, and so should this. */
  function archivedBanner() {
    if (!product.archived) return null;
    const banner = el('p.form-banner', { html: icon('archive', 15, 2) });
    banner.append(el('span', {},
      'Archived: hidden from the products list, totals, and alerts. ',
      el('button.link-btn', {
        type: 'button',
        onclick: async (e) => {
          // currentTarget is null once dispatch ends, i.e. after the
          // await — hold the button so the failure path can re-enable it.
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await store.setArchived(product.id, false);
            banner.replaceChildren(el('span', {}, 'Restored to the products list.'));
          } catch (err) {
            console.error(err);
            toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
            btn.disabled = false;
          }
        },
      }, 'Restore it')
    ));
    return banner;
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = enteredUnits();
      if (Number.isNaN(n)) { qtyInput.focus(); return; }
      const note = noteInput.value.trim();
      submit.disabled = true;
      try {
        if (mode === 'move') {
          await store.transferStock(product.id, { from: location, to: moveTo, qty: n, note });
          toast('Stock moved', { icon: 'move' });
        } else {
          if (mode === 'set') await store.adjustStock(product.id, { set: n, note, locationId: location });
          else {
            await store.adjustStock(product.id, {
              delta: mode === 'add' ? n : -n,
              note,
              locationId: location,
              reason: mode === 'remove' ? reason : '',
              cost: mode === 'add' ? enteredCost() : null,
              price: enteredPrice(),
              expiryDate: mode === 'add' && tracked ? expiryInput.value : '',
              lotDate: mode === 'remove' && tracked ? fromLot : undefined,
            });
          }
          toast('Stock updated');
        }
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        if (err.committed) {
          modal.close();
          onSaved?.();
        } else submit.disabled = false;
        toast(err.message || 'Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('p.confirm-message', { style: { marginBottom: '14px' } },
      el('strong', {}, product.name),
      product.sku ? el('span.muted.mono', {}, `  ${product.sku}`) : null,
      onOrder
        ? el('span.muted', {}, ` · ${formatQtyIn(onOrder, unit)} ${unitLabel(unit, onOrder)} on order`)
        : null
    ),
    archivedBanner(),
    // What a kit's removal actually does, before it's done.
    kit === 'sell'
      ? el('p.form-banner', { html: icon('boxes', 15, 2) },
        el('span', {}, `Sold as a kit: taking one out takes out ${recipeSummary(product, store.products)}. `
          + `Components on hand allow ${buildableQty(product, store.products)}`
          + `${limitingComponent(product, store.products)?.product ? `: ${limitingComponent(product, store.products).product.name} runs out first` : ''}.`))
      : null,
    el('div.field', {}, seg, hint),
    reasonRow,
    locationRow,
    lotsLine,
    lotRow,
    expiryRow,
    el('div.field', {},
      el('div.qty-head', {},
        el('label', { htmlFor: 'stock-qty' }, 'Quantity'),
        unitToggle
      ),
      el('div.stepper', {}, stepBtn(-1), Object.assign(qtyInput, { id: 'stock-qty' }), stepBtn(1)),
      preview
    ),
    costRow,
    priceRow,
    el('div.field', {},
      el('label', { htmlFor: 'stock-note' }, 'Note'),
      Object.assign(noteInput, { id: 'stock-note' })
    ),
    submit
  );

  resetQty();
  renderReasons();
  renderCost();
  renderPrice();
  renderLotControls();
  renderLocations();
  renderUnitToggle();
  update();

  const modal = openModal({
    title: titleFor(mode),
    content: form,
    onClose,
    // A typed amount, cost, expiry, or note is work; on mobile the
    // scrim fills most of the screen next to this sheet, and a mistap
    // must not silently cost it. Mode and location picks alone are one
    // tap to redo and don't count.
    unsaved: () => qtyInput.value !== qtyBaseline
      || noteInput.value.trim() !== ''
      || costEdited
      || (priceEdited && priceInput.value !== priceBaseline)
      || expiryInput.value !== '',
  });
  syncTitle();
  // openModal focuses the field marked data-autofocus (desktop only; a
  // phone keeps focus on the panel so the keyboard doesn't cover the
  // sheet). Where it did, the seeded amount is ready to be typed over.
  selectQty();
}

const titleFor = (mode) => (mode === 'move' ? 'Move stock' : 'Adjust stock');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
