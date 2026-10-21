/**
 * Add/edit product sheet. On create, the quantity field seeds opening
 * stock; on edit, quantity is adjusted via the stock dialog instead so
 * every change lands in the activity log.
 *
 * `prefill` seeds a brand-new product from an existing one (Duplicate).
 */

import { el, clear, append, CODE_FIELD } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog, confirmDiscard } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { openStockForm } from './stockform.js';
import { openMakeFamilyForm, openFamilyForm, openVariantForm } from './familyform.js';
import { openScanner } from './scanner.js';
import {
  UNIT_SUGGESTIONS, normalizeUnit, isCountUnit, unitLabel, packSizeOf, packLabel, roundQty, formatQtyIn, qtyWithUnit,
} from '../lib/units.js';
import { demandRates, suggestedThreshold, restockDays, rateLabel, coverDays, coverLabel } from '../lib/demand.js';
import { sourcesOf } from '../lib/sources.js';
import { variantLabel, normalizeValues } from '../lib/variants.js';
import {
  KIT_MODES, kitMode, componentList, buildableQty, kitUnitCost,
  limitingComponent, kitsUsing, isKit,
} from '../lib/kits.js';
import {
  stockEntries, stockAt, minMap, minAt, shortfallAt, binMap, binAt,
  UNASSIGNED, UNASSIGNED_LABEL,
} from '../lib/stock.js';
import { photosSupported, downscale, savePhoto, photoURL, deletePhoto } from '../lib/photos.js';
import { formatMoney, round2 } from '../lib/util.js';

/**
 * The sheet can replace itself (Duplicate, "Restore it instead") while the
 * old one is still animating out, so ids are per-instance: two elements
 * sharing an id would point the new sheet's labels and datalists at the
 * dying one, which then takes them with it.
 */
let formSeq = 0;

export function openProductForm(product = null, { onSaved, prefill = null } = {}) {
  const isEdit = !!product;
  const seed = product || prefill || {};
  const isArchived = !!product?.archived;
  const ns = `pf${++formSeq}`;
  const catListId = `${ns}-categories`;
  const unitListId = `${ns}-units`;
  let fieldN = 0;

  const f = {
    name: el('input.input', { required: true, maxLength: 120, value: seed.name || '', placeholder: 'e.g. Wireless Mouse M310' }),
    sku: el('input.input', { ...CODE_FIELD, maxLength: 60, value: seed.sku || '', placeholder: 'e.g. WM-M310' }),
    barcode: el('input.input', {
      ...CODE_FIELD,
      maxLength: 60, value: seed.barcode || '', placeholder: 'Scan or type',
      inputmode: 'numeric', autocomplete: 'off',
    }),
    category: el('input.input', { maxLength: 60, value: seed.category || '', placeholder: 'e.g. Peripherals', list: catListId }),
    unit: el('input.input', { ...CODE_FIELD, maxLength: 12, value: normalizeUnit(seed.unit), list: unitListId, placeholder: 'each' }),
    quantity: el('input.input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: product ? undefined : '0' }),
    cost: el('input.input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: seed.cost ?? '', placeholder: '0.00' }),
    price: el('input.input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: seed.price ?? '', placeholder: 'Optional' }),
    lowStock: el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: seed.lowStock ?? '', placeholder: `Default (${store.settings.defaultLowStock})`,
    }),
    reorderQty: el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: seed.reorderQty ?? '', placeholder: 'Suggested automatically',
    }),
    packSize: el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: packSizeOf(seed) || '', placeholder: 'e.g. 24',
    }),
    packName: el('input.input', { maxLength: 20, value: seed.packName || '', placeholder: 'case' }),
    // What ticking the box actually changes lives in the hint below it;
    // the label alone doesn't say, so the box points at the explanation.
    trackExpiry: el('input', {
      type: 'checkbox',
      checked: !!seed.trackExpiry,
      'aria-describedby': `${ns}-expiry-hint`,
    }),
    location: el('select.select', {}),
    supplier: el('select.select', {}),
    notes: el('textarea.textarea', { maxLength: 500, value: seed.notes || '', placeholder: 'Optional' }),
  };

  // Datalists so categories and units stay consistent without becoming
  // a hard taxonomy — anything else can still be typed.
  const cats = [...new Set(store.products.map((p) => p.category).filter(Boolean))].sort();
  const usedUnits = [...new Set(store.products.map((p) => normalizeUnit(p.unit)))];
  const unitKeys = [...new Set([...UNIT_SUGGESTIONS.map((u) => u.key), ...usedUnits])];
  const datalist = el('div', { style: { display: 'none' } },
    el('datalist', { id: catListId }, cats.map((c) => el('option', { value: c }))),
    el('datalist', { id: unitListId }, unitKeys.map((k) =>
      el('option', { value: k }, UNIT_SUGGESTIONS.find((u) => u.key === k)?.label || '')))
  );

  /* Decimals only make sense for measured units, and the pack fields
     only read right once a unit is chosen. */
  function syncUnit() {
    const unit = normalizeUnit(f.unit.value);
    const count = isCountUnit(unit);
    for (const input of [f.quantity, f.lowStock, f.reorderQty, f.packSize]) {
      input.step = count ? '1' : 'any';
      input.inputMode = count ? 'numeric' : 'decimal';
    }
    packHint.textContent = packSizeOf({ packSize: f.packSize.valueAsNumber, unit })
      ? `One ${f.packName.value.trim() || 'pack'} holds ${f.packSize.value} ${unitLabel(unit, f.packSize.valueAsNumber)}.`
      : `Optional. Set it to receive whole ${packLabel({ packName: f.packName.value }, 2)} instead of single ${unitLabel(unit, 2)}.`;
    // The suggestion is arithmetic over the unit and the pack size, so
    // it follows both as they're typed.
    syncSuggestion();
  }
  const packHint = el('p.hint');
  f.unit.addEventListener('input', syncUnit);
  f.packSize.addEventListener('input', syncUnit);
  f.packName.addEventListener('input', syncUnit);

  /* --- Threshold suggestion ---
     What the activity log implies the threshold should be: what sells
     while a restock is in flight. Offered, never written — the whole app
     treats a number the user typed as the truth, and that shouldn't
     change because we can do arithmetic. Silent when the log is too
     short, when nothing has sold, or when the field already holds it. */
  const lowSuggest = el('p.hint', { hidden: true });
  const demand = isEdit ? demandRates(store.activity) : null;

  function syncSuggestion() {
    if (!isEdit) return;
    clear(lowSuggest);
    const unit = normalizeUnit(f.unit.value);
    const perDay = demand.rates.get(product.id) || 0;
    const draft = {
      unit,
      packSize: f.packSize.value.trim() === '' ? 0 : f.packSize.valueAsNumber,
      quantity: product.quantity,
    };
    const leadTimeDays = store.supplierById(f.supplier.value)?.leadTimeDays;
    const safetyDays = store.settings.safetyDays;
    const suggestion = suggestedThreshold(draft, { perDay, leadTimeDays, safetyDays });
    lowSuggest.hidden = suggestion === null;
    if (suggestion === null) return;
    const restock = restockDays(leadTimeDays, safetyDays);
    const because = `${rateLabel(perDay, unit)} over the last ${demand.days} days`
      + `, ${restock} day${restock === 1 ? '' : 's'} to restock`
      + `${leadTimeDays ? ` (${leadTimeDays}-day lead time + ${safetyDays} safety)` : ' with no supplier lead time on file'}`;
    const shown = formatQtyIn(suggestion, unit);
    const held = f.lowStock.value.trim() === '' ? null : roundQty(f.lowStock.valueAsNumber, unit);
    if (held === suggestion) {
      append(lowSuggest, [`Matches demand: ${because}.`]);
      return;
    }
    append(lowSuggest, [
      el('button.link-btn', {
        type: 'button',
        title: because,
        onclick: () => {
          f.lowStock.value = String(suggestion);
          syncSuggestion();
          // The number landed in the field, not in the account: the
          // suggestion is accepted by saving, like anything else here.
          f.lowStock.focus();
        },
      }, `Suggest ${shown}`),
      `: ${because}.`,
    ]);
  }
  f.lowStock.addEventListener('input', syncSuggestion);
  f.supplier.addEventListener('change', syncSuggestion);

  /**
   * How fast this one actually leaves, and how long what's on hand
   * lasts at that rate. Read-only, and absent when the log can't say —
   * the same silence the suggestion keeps.
   */
  function demandNote() {
    const perDay = demand.rates.get(product.id) || 0;
    const rate = rateLabel(perDay, product.unit);
    if (!rate) return null;
    const cover = coverDays(product, perDay);
    return el('p.hint', { style: { marginTop: '-2px' } },
      `Sells ${rate}: ${coverLabel(cover)} at that rate.`);
  }

  fillSelect(f.location, store.locations, seed.locationId, 'No location');
  fillSelect(f.supplier, store.suppliers, seed.supplierId, 'No supplier');
  /* The picker above and the source list below say the same thing about
     one supplier; picking here re-points the default source. */
  f.supplier.addEventListener('change', () => {
    const id = f.supplier.value;
    const rows = sourceRows.filter((r) => r.supplier.value);
    const hit = rows.find((r) => r.supplier.value === id);
    if (hit) {
      hit.preferred.checked = true;
    } else if (rows.length <= 1) {
      const row = rows[0] || (id ? addSourceRow() : null);
      if (row) { row.supplier.value = id; row.preferred.checked = true; }
    }
    syncSources();
  });

  /* --- Variants ---
     A variant is an ordinary product; what it adds is the family it
     belongs to and the axis values that tell it from its siblings. The
     shared half is edited on the family, once, rather than here four
     times. */
  const family = isEdit ? store.familyOf(product) : null;
  const axisInputs = new Map();
  /* A variant's name is the family's plus what makes it different, and
     the save rebuilds it from those. Typing over it here did nothing at
     all — the field looked editable and the change vanished on Save —
     so it reads as what it is: a value set elsewhere. */
  if (family) f.name.readOnly = true;

  function variantField() {
    if (!isEdit) return null;
    if (!family) {
      // Standalone: offer the conversion, and say what it costs (nothing).
      return el('div.field', {},
        el('label', {}, 'Variants'),
        el('button.btn.btn-secondary.btn-block', {
          type: 'button',
          html: icon('boxes', 16, 2),
          onclick: () => leaveFor(() => openMakeFamilyForm(product, { onSaved })),
        }, ' Make this a family'),
        el('p.hint', {},
          'For a product you keep in sizes or colours: this one becomes the first variant, '
          + 'keeping its stock and history, and the details they share move to the family.')
      );
    }
    const rows = family.axes.map((axis) => {
      const input = el('input.input', {
        maxLength: 40,
        value: product.axes?.[axis] || '',
        'aria-label': axis,
        placeholder: axis === 'Size' ? 'e.g. M' : '',
      });
      axisInputs.set(axis, input);
      return el('div.field', {}, el('label', {}, axis), input);
    });
    const siblings = store.variantsOf(family.id).filter((p) => p.id !== product.id);
    return el('div.field', {},
      el('label', {}, `Variant of ${family.name}`),
      el('div.field-grid', {}, rows),
      el('p.hint', {},
        `Its category, unit, supplier, price and threshold come from the family`,
        siblings.length ? ` it shares with ${siblings.length} other variant${siblings.length === 1 ? '' : 's'}` : '',
        '.'),
      el('div.form-actions', {},
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('boxes', 16, 2),
          onclick: () => leaveFor(() => openFamilyForm(family, { onSaved })),
        }, ' Edit the family'),
        el('button.btn.btn-secondary', {
          type: 'button', html: icon('plus', 16, 2.2),
          onclick: () => leaveFor(() => openVariantForm(family, { onSaved })),
        }, ' Add variant')
      )
    );
  }

  /** The axis values this sheet is stating, when it's a variant's sheet. */
  function axesFromForm() {
    if (!family) return undefined;
    const values = {};
    for (const [axis, input] of axisInputs) values[axis] = input.value;
    return normalizeValues(values, family.axes);
  }

  /* --- Made of ---
     A kit is a product made of others: built ahead of time, or sold as
     one with no stock of its own. One level deep — a component can't
     itself be a kit — which keeps the maths one pass and the list flat. */
  const kitRows = [];
  const kitList = el('div.source-list');
  const kitHint = el('p.hint');
  /* From the seed, not from `product`: Duplicate copies the recipe rows
     into the sheet like it copies every other field, so the mode has to
     come with them — the copy opened saying "Not a kit" over a filled-in
     recipe, and saved as a plain product with the recipe thrown away. */
  let kitModeValue = kitMode(seed);
  const usedBy = isEdit ? kitsUsing(product.id, store.products) : [];

  /** Products that may be a component: real stock, and not kits. */
  const partOptions = () => store.products
    .filter((x) => x.id !== product?.id && !isKit(x) && !x.archived)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  function addKitRow(seedRow = null) {
    const row = {};
    row.product = el('select.select', {
      'aria-label': 'Component',
      onchange: syncKit,
    },
      el('option', { value: '' }, 'Pick a product'),
      partOptions().map((x) => el('option', {
        value: x.id, selected: seedRow?.productId === x.id,
      }, `${x.name}${x.sku ? `: ${x.sku}` : ''}`))
    );
    row.qty = el('input.input.kit-qty', {
      type: 'number', min: 0, step: 'any', inputmode: 'decimal',
      value: seedRow?.qty ?? 1,
      placeholder: 'How many',
      'aria-label': 'How many of this component one kit takes',
      oninput: syncKit,
    });
    row.node = el('div.source-row', {},
      el('div.source-row-top', {},
        el('div.select-wrap.grow', {}, row.product),
        row.qty,
        el('button.icon-btn', {
          type: 'button',
          html: icon('x', 16),
          'aria-label': 'Remove this component',
          onclick: () => {
            const at = kitRows.indexOf(row);
            if (at >= 0) kitRows.splice(at, 1);
            row.node.remove();
            syncKit();
          },
        })
      )
    );
    kitRows.push(row);
    kitList.append(row.node);
    return row;
  }

  /** The recipe the sheet is stating. */
  function componentsFromForm() {
    return kitRows
      .filter((r) => r.product.value)
      .map((r) => ({ productId: r.product.value, qty: r.qty.value.trim() === '' ? 0 : r.qty.valueAsNumber }));
  }

  const kitSeg = el('div.segmented', { role: 'group', 'aria-label': 'Kit' },
    [{ key: '', label: 'Not a kit' }, ...KIT_MODES].map((m) => el('button', {
      type: 'button',
      dataset: { mode: m.key },
      'aria-pressed': String(kitModeValue === m.key),
      onclick: (e) => {
        kitModeValue = m.key;
        for (const b of kitSeg.querySelectorAll('button')) {
          b.setAttribute('aria-pressed', String(b.dataset.mode === m.key));
        }
        if (m.key && !kitRows.length) addKitRow();
        syncKit();
        e.currentTarget.focus();
      },
    }, m.label))
  );

  const addPartBtn = el('button.btn.btn-secondary.btn-block', {
    type: 'button',
    html: icon('plus', 15, 2.2),
    style: { marginTop: '8px' },
    onclick: () => { addKitRow().product.focus(); syncKit(); },
  }, ' Add a component');

  /** What the recipe means: what it can make, and what it costs. */
  function syncKit() {
    const list = componentsFromForm().filter((c) => c.qty > 0);
    const on = !!kitModeValue;
    kitList.hidden = !on;
    addPartBtn.hidden = !on;
    if (!on) {
      kitHint.textContent = usedBy.length
        ? `A component of ${usedBy.map((x) => x.name).join(', ')}. Kits can only be one level deep, so this can’t be a kit itself.`
        : 'For a product made of others: a breakfast set, an assembled kit, a three-pack.';
      return;
    }
    const draft = { id: product?.id, unit: normalizeUnit(f.unit.value), kit: kitModeValue, components: list };
    const can = buildableQty(draft, store.products);
    const cost = kitUnitCost(draft, store.products);
    const limit = limitingComponent(draft, store.products);
    const leaving = stockLeavingAsKit();
    kitHint.textContent = !list.length
      ? 'Add at least one component to define what the kit is made of.'
      : [
        kitModeValue === 'build'
          ? `Components on hand allow ${can} to be built`
          : `Components on hand allow ${can} to be sold`,
        limit?.product ? `${limit.product.name} runs out first` : null,
        cost ? `${formatMoney(cost, store.settings.currency)} of components each` : null,
        kitModeValue === 'sell' ? 'It holds no stock of its own; selling one takes its components out' : null,
        // What saving does to the stock already here — said next to the
        // choice that does it, not discovered in the history afterwards.
        leaving ? `Its ${qtyWithUnit(leaving, product.unit)} on hand leave stock when you save` : null,
      ].filter(Boolean).join(' · ');
  }

  /**
   * Stock this save would take off the books: what a product holds when
   * it is about to become a sell-as-kit, which holds none of its own.
   * Zero for a new product, one already sold as a kit, or any other mode.
   */
  function stockLeavingAsKit() {
    if (!isEdit || kitModeValue !== 'sell' || kitMode(product) === 'sell') return 0;
    return Math.max(0, Number(product.quantity) || 0);
  }

  function kitField() {
    if (!store.products.length) return null;
    if (usedBy.length && !kitModeValue) {
      // One level deep: say why the option isn't here rather than
      // offering something that would be refused on save.
      return el('details.disclosure', {},
        el('summary', {}, 'Made of'),
        kitHint
      );
    }
    for (const row of componentList(seed)) addKitRow(row);
    return el('details.disclosure', { open: !!kitModeValue },
      el('summary', {}, 'Made of other products'),
      el('div.field', {}, kitSeg),
      kitList,
      addPartBtn,
      kitHint
    );
  }

  /* --- Where it's bought ---
     Anything staple comes from two or three places depending on price
     and who has it, each with its own order code, price and lead time.
     One row per source, one marked preferred — the app never re-sources
     anything on its own, so preferred is a plain flag, and the cheapest
     is shown rather than chosen. */
  const sourceRows = [];
  const sourceList = el('div.source-list');
  const sourceHint = el('p.hint');

  function addSourceRow(seedSource = null) {
    const row = { id: `${ns}-src${sourceRows.length}` };
    row.supplier = el('select.select', {
      'aria-label': 'Supplier',
      onchange: () => { syncSources(); syncSuggestion(); },
    },
      el('option', { value: '' }, 'Pick a supplier'),
      store.suppliers.map((sup) => el('option', {
        value: sup.id, selected: seedSource?.supplierId === sup.id,
      }, sup.name))
    );
    row.code = el('input.input', {
      ...CODE_FIELD, maxLength: 60, value: seedSource?.code || '',
      placeholder: 'Their code', 'aria-label': 'The supplier’s own code for this product',
    });
    row.price = el('input.input', {
      type: 'number', min: 0, step: '0.01', inputmode: 'decimal',
      value: seedSource?.price ?? '', placeholder: 'Price',
      'aria-label': 'Price per unit from this supplier',
      oninput: syncSources,
    });
    row.lead = el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: seedSource?.leadTimeDays ?? '', placeholder: 'Days',
      'aria-label': 'Lead time in days from this supplier',
    });
    row.pack = el('input.input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric',
      value: seedSource?.packSize || '', placeholder: 'Pack',
      'aria-label': 'Units per pack from this supplier',
    });
    row.preferred = el('input', {
      type: 'radio',
      name: `${ns}-preferred`,
      checked: !!seedSource?.preferred,
      'aria-label': 'Buy from this one by default',
      onchange: syncSources,
    });
    row.note = el('span.small.muted.source-note');
    row.node = el('div.source-row', {},
      el('div.source-row-top', {},
        el('div.select-wrap.grow', {}, row.supplier),
        el('label.check-row.source-preferred', { title: 'Buy from this one by default' },
          row.preferred, el('span.small', {}, 'Default')),
        el('button.icon-btn', {
          type: 'button',
          html: icon('x', 16),
          'aria-label': 'Remove this supplier',
          onclick: () => {
            const at = sourceRows.indexOf(row);
            if (at >= 0) sourceRows.splice(at, 1);
            row.node.remove();
            // The list can't be left with nothing marked default.
            if (!sourceRows.some((r) => r.preferred.checked) && sourceRows[0]) {
              sourceRows[0].preferred.checked = true;
            }
            syncSources();
            syncSuggestion();
          },
        })
      ),
      el('div.source-row-fields', {}, row.code, row.price, row.pack, row.lead),
      row.note
    );
    sourceRows.push(row);
    sourceList.append(row.node);
    if (!sourceRows.some((r) => r.preferred.checked)) row.preferred.checked = true;
    return row;
  }

  /** The sources the form is stating, in the order it shows them. */
  function sourcesFromForm() {
    return sourceRows
      .filter((r) => r.supplier.value)
      .map((r) => ({
        supplierId: r.supplier.value,
        code: r.code.value,
        price: r.price.value.trim() === '' ? null : r.price.valueAsNumber,
        packSize: r.pack.value.trim() === '' ? 0 : r.pack.valueAsNumber,
        leadTimeDays: r.lead.value.trim() === '' ? null : r.lead.valueAsNumber,
        preferred: r.preferred.checked,
      }));
  }

  /**
   * Which one is the default, what each costs, and who is cheapest —
   * said while the choice is being made rather than after.
   */
  function syncSources() {
    const stated = sourcesFromForm();
    const priced = stated.filter((x) => x.price !== null && Number.isFinite(x.price));
    const best = priced.length ? Math.min(...priced.map((x) => x.price)) : null;
    const currency = store.settings.currency;
    for (const row of sourceRows) {
      // Only a row naming a supplier, with a price that reads as one, is
      // in the comparison at all — and a price compares to nothing until
      // a second one is written down. Without that floor the only price
      // on file was told it was "$0.00 more than the cheapest", which is
      // itself.
      const typed = row.price.valueAsNumber;
      const value = row.supplier.value && row.price.value.trim() !== '' && Number.isFinite(typed)
        ? typed
        : null;
      const behind = value === null || best === null ? 0 : round2(value - best);
      row.note.textContent = value === null || priced.length < 2
        ? ''
        : (behind > 0 ? `${formatMoney(behind, currency)} more than the cheapest` : 'Cheapest on file');
    }
    sourceHint.textContent = stated.length > 1
      ? 'Reorder groups by the default; a line can be switched to another supplier before the sheet is made.'
      : 'Add the places you buy this from, with their codes, prices, and lead times.';
    // The single supplier picker and this list are the same fact; keep
    // the picker showing whichever source is the default.
    const preferred = stated.find((x) => x.preferred) || stated[0];
    if (preferred && f.supplier.value !== preferred.supplierId) f.supplier.value = preferred.supplierId;
  }

  const addSourceBtn = el('button.btn.btn-secondary.btn-block', {
    type: 'button',
    html: icon('plus', 15, 2.2),
    style: { marginTop: '8px' },
    onclick: () => {
      const row = addSourceRow();
      syncSources();
      row.supplier.focus();
    },
  }, ' Add a supplier');

  function sourcesField() {
    if (!store.suppliers.length) return null;
    const seeded = sourcesOf(seed).filter((x) => !x.derived || x.supplierId);
    for (const source of seeded) addSourceRow(source);
    return el('details.disclosure', { open: seeded.length > 1 },
      el('summary', {}, 'Suppliers and prices'),
      // The four boxes on each row are the same four every time, and
      // their placeholders disappear the moment they're filled in.
      el('div.source-row-fields.source-legend', { 'aria-hidden': 'true' },
        el('span', {}, 'Their code'),
        el('span', {}, `Price per ${unitLabel(normalizeUnit(seed.unit), 1)}`),
        el('span', {}, 'Units per pack'),
        el('span', {}, 'Lead days')
      ),
      sourceList,
      addSourceBtn,
      sourceHint
    );
  }

  /* --- Per location: where it sits, and what should be there ---
     A shelf code so a room of a few hundred products can be walked and
     counted, and a minimum so "the shelf is empty while forty sit in
     the back" becomes something the app can say. Both optional, both
     blank on every product until someone types one. */
  const minInputs = new Map();
  const binInputs = new Map();
  function minimumsField() {
    const held = minMap(seed);
    const bins = binMap(seed);
    /* Stock that isn't assigned anywhere still sits on a shelf, and a
       CSV can give it a code and a minimum there. Off this list, both
       were quietly dropped by the next save — the form writes the whole
       map from the rows it shows — so the bucket appears whenever the
       product actually uses it. */
    const places = [
      ...store.locations.map((l) => ({ id: l.id, name: l.name })),
      ...(stockAt(seed, UNASSIGNED) > 0 || minAt(seed, UNASSIGNED) > 0 || binAt(seed, UNASSIGNED)
        ? [{ id: UNASSIGNED, name: UNASSIGNED_LABEL }]
        : []),
    ];
    if (!places.length) return null;
    const rows = places.map((l) => {
      const bin = el('input.input', {
        ...CODE_FIELD,
        maxLength: 24,
        value: bins[l.id] ?? '',
        placeholder: 'e.g. A3-12',
        'aria-label': `Bin code at ${l.name}`,
      });
      binInputs.set(l.id, bin);
      const input = el('input.input', {
        type: 'number', min: 0, step: 1, inputmode: 'numeric',
        value: held[l.id] ?? '',
        placeholder: 'No minimum',
        'aria-label': `Minimum at ${l.name}`,
        oninput: syncMinHints,
      });
      minInputs.set(l.id, input);
      const hint = el('span.small.muted.min-row-note');
      minHints.set(l.id, hint);
      return el('div.min-row', {},
        el('span.grow', {}, l.name, product ? el('span.small.muted', {}, `: ${formatQtyIn(stockAt(product, l.id), product.unit)} here`) : null),
        hint,
        bin,
        input
      );
    });
    return el('details.disclosure', { open: Object.keys(held).length > 0 || Object.keys(bins).length > 0 },
      el('summary', {}, 'Shelf codes and minimums'),
      el('div.min-row.min-legend', { 'aria-hidden': 'true' },
        el('span.grow', {}, 'Location'),
        el('span', {}, 'Bin code'),
        el('span', {}, 'Minimum')
      ),
      el('div.min-list', {}, rows),
      el('p.hint', {},
        'A bin code says where it sits in that place. The count sheet can be ordered by it, and labels can print it. '
        + 'Below its minimum, a place shows up on the replenish list with a suggested transfer from wherever the stock actually sits.')
    );
  }
  const minHints = new Map();

  /** The bin codes the form is stating, by location. */
  function binsFromForm() {
    const out = {};
    for (const [locationId, input] of binInputs) {
      const code = input.value.trim();
      if (code) out[locationId] = code;
    }
    return out;
  }

  /** "4 short" next to a place that holds less than its number says. */
  function syncMinHints() {
    if (!product) return;
    const unit = normalizeUnit(f.unit.value);
    for (const [locationId, input] of minInputs) {
      const hint = minHints.get(locationId);
      if (!hint) continue;
      const wanted = input.value.trim() === '' ? 0 : Math.max(0, roundQty(input.valueAsNumber, unit));
      const held = stockAt(product, locationId);
      hint.textContent = wanted && held < wanted ? `${formatQtyIn(wanted - held, unit)} short` : '';
    }
  }

  /** The minimums map the form is stating, for the save. */
  function minimumsFromForm() {
    const unit = normalizeUnit(f.unit.value);
    const out = {};
    for (const [locationId, input] of minInputs) {
      if (input.value.trim() === '') continue;
      const n = roundQty(input.valueAsNumber, unit);
      if (n > 0) out[locationId] = n;
    }
    return out;
  }

  /* --- Photo ---
     The picture is only written once the product is saved (a new one
     has no id yet), so cancelling never leaves a file behind. */
  let photoBlob = null;      // a newly picked image, not yet uploaded
  let photoCleared = false;  // the existing one is on its way out
  let photoPending = null;   // the downscale still running for the latest pick
  let previewURL = null;

  const photoPreview = el('div.photo-preview', { html: icon('camera', 26) });
  // No `capture` attribute: with it, phones jump straight to the camera
  // and never offer the photo library — the OS picker already lists
  // "take photo" alongside it, so leaving it off supports both.
  const photoFile = el('input', {
    type: 'file',
    accept: 'image/*',
    style: { display: 'none' },
    onchange: () => {
      const file = photoFile.files?.[0];
      photoFile.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast('That file isn’t an image', { icon: 'circleAlert' });
        return;
      }
      // A phone photo can take a moment to re-encode; remember the run
      // so a submit racing it waits (savePhotoFor), and so a quick
      // second pick wins over a slow first one.
      const pending = downscale(file).then((blob) => {
        if (photoPending !== pending) return;
        photoPending = null;
        photoBlob = blob;
        photoCleared = false;
        showPreview(URL.createObjectURL(blob), { owned: true });
      });
      photoPending = pending;
    },
  });

  const photoRemove = el('button.btn.btn-ghost', {
    type: 'button',
    style: { color: 'var(--danger)' },
    onclick: () => {
      photoBlob = null;
      photoCleared = true;
      showPreview(null);
    },
  }, 'Remove');

  const photoPick = el('button.btn.btn-secondary', {
    type: 'button',
    html: icon('camera', 15, 2),
    onclick: () => photoFile.click(),
  }, ' Add photo');

  /* Only URLs this form created may be revoked on replace/close. The URL
     of an existing photo is photos.js's shared cache entry — every
     thumbnail of this product uses the same one, so revoking it here
     would break them all for the rest of the session. */
  function showPreview(url, { owned = false } = {}) {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = owned ? url : null;
    if (url) {
      photoPreview.replaceChildren(el('img', { src: url, alt: '' }));
      photoPreview.classList.add('has-photo');
    } else {
      photoPreview.innerHTML = icon('camera', 26);
      photoPreview.classList.remove('has-photo');
    }
    photoRemove.hidden = !url;
    photoPick.lastChild.textContent = url ? ' Replace' : ' Add photo';
  }
  showPreview(null);
  if (product?.imagePath) photoURL(product).then((url) => { if (!photoBlob && !photoCleared && url) showPreview(url); });

  const photoField = photosSupported() ? el('div.photo-field', {},
    photoPreview,
    el('div.grow', {},
      el('div.photo-actions', {}, photoPick, photoRemove),
      el('p.hint', {}, 'Shrunk to 800px and kept in your own Puter drive.')
    ),
    photoFile
  ) : null;

  const nameErr = el('p.field-error', { id: `${ns}-name-error`, hidden: true }, 'A product name is required.');
  const skuErr = el('p.field-error', { id: `${ns}-sku-error`, hidden: true });
  const barcodeErr = el('p.field-error', { id: `${ns}-barcode-error`, hidden: true });

  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, isEdit ? 'Save changes' : 'Add product');

  /* An archived product still owns its SKU, so point at it rather than
     reporting a clash with something the user can't find. */
  function showSkuClash(clash) {
    clear(skuErr);
    if (clash.archived) {
      append(skuErr, [
        `"${clash.name}" is archived and still uses this SKU. `,
        el('button.link-btn', {
          type: 'button',
          // Swaps this sheet for the archived product's, so it leaves
          // through leaveFor like History and Duplicate do: only a
          // filled-in form reached this error at all, and walking off
          // with it unasked is what leaveFor exists to prevent.
          onclick: () => leaveFor(() => openProductForm(clash, { onSaved })),
        }, 'Restore it instead'),
      ]);
    } else {
      skuErr.textContent = 'This SKU is already used by another product.';
    }
    skuErr.hidden = false;
  }

  const lower = (v) => String(v ?? '').trim().toLowerCase();

  /**
   * What this barcode would collide with: { owner, ownsAsBarcode }, or
   * null. A barcode has to point at one product, or scanning is a coin
   * flip — and scanning resolves a code against barcodes *and* SKUs
   * (see productByCode), so a barcode copied off another product's SKU
   * quietly makes that product unfindable by the code printed on it.
   * The generated INV- codes are checked against both namespaces for
   * exactly this reason; a typed or scanned one has to be too.
   *
   * Barcodes win over SKUs, the same order a scan resolves in.
   */
  function clashFor(code) {
    const k = lower(code);
    if (!k) return null;
    const byBarcode = store.products.find((p) => p.id !== product?.id && lower(p.barcode) === k);
    if (byBarcode) return { owner: byBarcode, ownsAsBarcode: true };
    // A SKU clash is refused only when this save is what introduces it.
    // One already on file — from an import, or a build before this
    // check — must not lock its product out of every later edit.
    if (k === lower(product?.barcode)) return null;
    const bySku = store.products.find((p) => p.id !== product?.id && lower(p.sku) === k);
    return bySku ? { owner: bySku, ownsAsBarcode: false } : null;
  }

  const clashMessage = ({ owner, ownsAsBarcode }) => (ownsAsBarcode
    ? `"${owner.name}" already uses this barcode.`
    : `"${owner.name}" uses this as its SKU, and a scan matches either. This would hide it.`);

  /** Show (or clear) the barcode field's clash state. */
  function showCodeClash(clash) {
    barcodeErr.hidden = !clash;
    if (clash) barcodeErr.textContent = clashMessage(clash);
    f.barcode.setAttribute('aria-invalid', String(!!clash));
  }

  /* Built before the form body so the suggestion line can sit under the
     field it talks about. */
  const lowStockField = field('Low stock alert at', f.lowStock);
  lowStockField.append(lowSuggest);

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      const sku = f.sku.value.trim();
      const barcode = f.barcode.value.trim();
      const badName = !name;
      const clash = store.productBySku(sku, product?.id);
      const codeClash = clashFor(barcode);
      nameErr.hidden = !badName;
      skuErr.hidden = !clash;
      if (clash) showSkuClash(clash);
      showCodeClash(codeClash);
      f.name.setAttribute('aria-invalid', badName);
      f.sku.setAttribute('aria-invalid', !!clash);
      if (badName) { f.name.focus(); return; }
      if (clash) { f.sku.focus(); return; }
      if (codeClash) { f.barcode.focus(); return; }

      // Becoming a sell-as-kit writes off whatever is on hand — the one
      // thing on this sheet that changes a stock figure — so it is
      // confirmed in as many words rather than done on the way past.
      const leaving = stockLeavingAsKit();
      if (leaving) {
        const ok = await confirmDialog({
          title: 'Take its stock off the books?',
          message: `"${product.name}" holds ${qtyWithUnit(leaving, product.unit)}. Sold as a kit, it holds no stock of its own. Instead, `
            + 'its availability comes from its components, so saving records a recount to zero in the history.',
          confirmLabel: 'Save and write off',
          danger: false,
        });
        if (!ok) return;
      }

      // valueAsNumber understands everything the number input accepts
      // (including "1e2"), which string re-parsing would mangle.
      const unit = normalizeUnit(f.unit.value);
      const data = {
        name,
        sku,
        barcode,
        category: f.category.value.trim(),
        unit,
        packSize: f.packSize.value.trim() === '' ? 0 : Math.max(0, roundQty(f.packSize.valueAsNumber, unit)),
        packName: f.packName.value.trim(),
        locationId: f.location.value || null,
        supplierId: f.supplier.value || null,
        cost: Math.max(0, numOr(f.cost.valueAsNumber, 0)),
        price: f.price.value.trim() === '' ? null : numOr(f.price.valueAsNumber, null),
        lowStock: f.lowStock.value.trim() === '' ? null : roundQty(numOr(f.lowStock.valueAsNumber, 0), unit),
        reorderQty: f.reorderQty.value.trim() === '' ? null : roundQty(numOr(f.reorderQty.valueAsNumber, 0), unit) || null,
        trackExpiry: f.trackExpiry.checked,
        notes: f.notes.value.trim(),
        min: minimumsFromForm(),
        bin: binsFromForm(),
        kit: kitModeValue,
        components: kitModeValue ? componentsFromForm() : [],
        sources: store.suppliers.length ? sourcesFromForm() : undefined,
      };

      // A variant's name is the family's plus what makes it different;
      // typing over it by hand would be undone by the next family edit.
      const axisValues = axesFromForm();
      if (family && axisValues) {
        data.axes = axisValues;
        data.name = variantNameFor(axisValues);
      }

      submit.disabled = true;
      try {
        let saved;
        if (isEdit) {
          // A unit change re-rounds the stock itself (the store owns that,
          // since the per-location buckets are the truth, not the total).
          saved = await store.updateProduct(product.id, data);
          toast('Product saved');
        } else {
          data.quantity = roundQty(numOr(f.quantity.valueAsNumber, 0), unit);
          saved = await store.addProduct(data);
          toast('Product added');
        }
        await savePhotoFor(saved);
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    datalist,
    photoField,
    field('Name', f.name, {
      error: nameErr,
      required: true,
      hint: family ? 'Named by its family and the axis values below; change those to change it.' : null,
    }),
    el('div.field-grid', {},
      field('SKU', f.sku, { error: skuErr, hint: 'Used to match rows on CSV import' }),
      field('Category', f.category)
    ),
    field('Barcode', el('div.input-with-action', {}, f.barcode, el('button.icon-btn', {
      type: 'button',
      html: icon('barcode', 18),
      'aria-label': 'Scan a barcode into this field',
      title: 'Scan',
      onclick: () => openScanner({
        title: 'Scan the barcode',
        hint: 'Point the camera at the barcode on the product.',
        onCode: (code) => {
          f.barcode.value = code;
          // The same rule the save applies, so a warning that appears
          // here can't quietly evaporate on submit — or, as it did,
          // report a SKU clash in the words of a barcode one.
          showCodeClash(clashFor(code));
        },
      }),
    })), { error: barcodeErr, hint: 'The code on the box. Scanning it finds this product instantly' }),
    el('div.field-grid', {},
      field('Unit of measure', f.unit, { hint: 'How you count it: each, kg, L, m…' }),
      !isEdit && field('Opening stock', f.quantity)
    ),
    el('details.disclosure', { open: !!packSizeOf(seed) },
      el('summary', {}, 'Pack size'),
      el('div.field-grid', {},
        field('Units per pack', f.packSize),
        field('What a pack is called', f.packName)
      ),
      packHint
    ),
    el('div.field', {},
      el('label.check-row', { htmlFor: `${ns}-expiry` },
        Object.assign(f.trackExpiry, { id: `${ns}-expiry` }),
        el('span', {}, 'Track expiry dates')
      ),
      el('p.hint', { id: `${ns}-expiry-hint` }, 'Receiving asks for a date; removals take the earliest-dated stock first. Existing stock starts with no date.')
    ),
    isEdit && demandNote(),
    el('div.field-grid', {},
      lowStockField,
      field('Reorder amount', f.reorderQty, { hint: 'When it runs low, order this many' })
    ),
    el('div.field-grid', {},
      field('Purchase cost per unit', f.cost),
      field('Selling price', f.price)
    ),
    el('div.field-grid', {},
      field('Location', el('div.select-wrap', {}, f.location)),
      field('Supplier', el('div.select-wrap', {}, f.supplier))
    ),
    variantField(),
    kitField(),
    sourcesField(),
    minimumsField(),
    field('Notes', f.notes),
    isEdit && stockBreakdown(),
    isArchived && el('p.form-banner', { html: icon('archive', 15, 2) },
      el('span', {}, 'Archived: hidden from the products list, totals, and alerts. Its SKU stays reserved.')),
    submit,
    isEdit && el('div.form-actions', {},
      el('button.btn.btn-secondary', {
        type: 'button',
        html: icon('history', 16, 2),
        onclick: () => leaveFor(() => {
          location.hash = `#/history?product=${encodeURIComponent(product.id)}`;
        }),
      }, ' History'),
      el('button.btn.btn-secondary', {
        type: 'button',
        html: icon('copy', 16, 2),
        onclick: () => leaveFor(() => {
          openProductForm(null, {
            onSaved,
            // SKU and barcode identify one product each, so the copy starts
            // without them rather than opening pre-filled with a clash.
            prefill: {
              ...product, name: `${product.name} copy`,
              sku: '', barcode: '', quantity: 0, archived: false,
            },
          });
        }),
      }, ' Duplicate'),
      el('button.btn.btn-secondary', {
        type: 'button',
        html: icon(isArchived ? 'archiveRestore' : 'archive', 16, 2),
        onclick: archiveOrRestore,
      }, isArchived ? ' Restore' : ' Archive')
    ),
    /* Hard delete stays behind archiving: reversible first, final only
       for products already retired. */
    isEdit && isArchived && el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { color: 'var(--danger)', marginTop: '8px' },
      onclick: deleteForever,
    }, 'Delete permanently')
  );

  /* A discard prompt from one of the buttons below is up; further
     presses wait for its answer rather than stacking prompts. */
  let leaving = false;

  /**
   * Go elsewhere, taking this sheet with you. History, Duplicate, and
   * Move stock don't act on what's in the fields — they just leave — so
   * anything typed goes with them. close() is the programmatic exit and
   * never asks, which is right after a save and wrong here: on a phone
   * these sit directly under Save, within the same thumb's reach, and a
   * mistap costing a filled-in form is exactly what `unsaved` exists to
   * prevent on every other way out of the sheet.
   */
  async function leaveFor(go) {
    if (leaving) return;
    if (unsaved()) {
      leaving = true;
      const ok = await confirmDiscard();
      leaving = false;
      if (!ok) return;
    }
    modal.close();
    go();
  }

  /**
   * Write (or clear) the picture once the product exists and has an id.
   * A photo that won't upload is worth a warning, never a failed save.
   */
  async function savePhotoFor(saved) {
    // A pick still downscaling counts: saving without it would quietly
    // drop the photo the user just chose.
    if (photoPending) await photoPending.catch(() => {});
    if (!saved || (!photoBlob && !photoCleared)) return;
    try {
      if (photoBlob) {
        const path = await savePhoto(saved.id, photoBlob);
        if (path) await store.updateProduct(saved.id, { imagePath: path });
        else toast('Product saved, but the photo didn’t upload', { icon: 'circleAlert' });
      } else {
        await deletePhoto(saved);
        await store.updateProduct(saved.id, { imagePath: null });
      }
    } catch (err) {
      console.error(err);
      toast('Product saved, but the photo didn’t upload', { icon: 'circleAlert' });
    }
  }

  /**
   * Where this product's stock sits, when it sits in more than one
   * place. Read-only: counts change through the stock dialog so every
   * movement lands in the activity log.
   */
  function stockBreakdown() {
    const entries = stockEntries(product);
    // Worth showing for a single bucket too once that bucket has a
    // minimum: "8 here, 10 wanted" is the whole point of the number.
    if (entries.length < 2 && !Object.keys(minMap(product)).length) return null;
    return el('div.field', {},
      el('label', {}, 'Stock by location'),
      el('div.stock-split', {},
        entries.map(([locationId, qty]) => {
          const short = shortfallAt(product, locationId);
          const min = minAt(product, locationId);
          const bin = binAt(product, locationId);
          return el('div', {},
            el('span.grow', {}, store.locationName(locationId),
              bin ? el('span.small.muted.mono', {}, ` · ${bin}`) : null,
              min ? el('span.small.muted', {}, ` · min ${formatQtyIn(min, product.unit)}`) : null,
              short ? el('span.small', { style: { color: 'var(--warn)' } }, ` · ${formatQtyIn(short, product.unit)} short`) : null),
            el('strong', {}, `${formatQtyIn(qty, product.unit)} ${unitLabel(product.unit, qty)}`)
          );
        }),
        // A place that should hold something and holds nothing at all has
        // no stock row to carry that news, so it gets its own.
        Object.entries(minMap(product))
          .filter(([locationId]) => !entries.some(([id]) => id === locationId))
          .map(([locationId, min]) => el('div', {},
            el('span.grow', {}, store.locationName(locationId),
              el('span.small.muted', {}, ` · min ${formatQtyIn(min, product.unit)}`),
              el('span.small', { style: { color: 'var(--warn)' } }, ` · ${formatQtyIn(min, product.unit)} short`)),
            el('strong', {}, `0 ${unitLabel(product.unit, 0)}`)
          )),
        el('div.stock-split-total', {},
          el('span.grow', {}, 'Total on hand'),
          el('strong', {}, formatQtyIn(product.quantity, product.unit))
        )
      ),
      el('button.btn.btn-secondary.btn-block', {
        type: 'button',
        style: { marginTop: '8px' },
        html: icon('move', 16, 2),
        onclick: () => leaveFor(() => openStockForm(product.id, { mode: 'move', onSaved })),
      }, ' Move stock')
    );
  }

  async function archiveOrRestore() {
    if (!isArchived) {
      const ok = await confirmDialog({
        title: 'Archive product?',
        message: `"${product.name}" leaves the products list, totals, and alerts, but keeps its details, threshold, SKU, and history. You can restore it anytime.`,
        confirmLabel: 'Archive',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await store.setArchived(product.id, !isArchived);
      toast(isArchived ? 'Product restored' : 'Product archived', {
        icon: isArchived ? 'archiveRestore' : 'archive',
        action: !isArchived && {
          label: 'Undo',
          onClick: () => store.setArchived(product.id, false).catch(() => {
            toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
          }),
        },
      });
      modal.close();
      onSaved?.();
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    }
  }

  async function deleteForever() {
    const ok = await confirmDialog({
      title: 'Delete permanently?',
      message: `"${product.name}" and its stock count are removed for good. You get a moment to undo it afterwards.`,
    });
    if (!ok) return;
    try {
      const undoToken = await store.deleteProduct(product.id);
      toast('Product deleted', {
        icon: 'trash',
        // The picture outlives the product for as long as undo does.
        onExpire: () => deletePhoto(product),
        action: undoToken && {
          label: 'Undo',
          onClick: async () => {
            try {
              await store.undoDelete(undoToken);
              toast('Product restored', { icon: 'rotateCcw' });
            } catch (err) {
              console.error(err);
              toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
            }
          },
        },
      });
      modal.close();
      onSaved?.();
    } catch (err) {
      console.error(err);
      toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
    }
  }

  /** This variant's full name, from the family and its axis values. */
  function variantNameFor(values) {
    const label = variantLabel(values, family.axes);
    return label ? `${family.name}: ${label}` : family.name;
  }

  /* What the sheet held when it opened; anything else is unsaved work
     the scrim, Escape, or the close button must not throw away silently. */
  const state = () => JSON.stringify([
    f.name.value, f.sku.value, f.barcode.value, f.category.value, f.unit.value,
    f.quantity.value, f.cost.value, f.price.value, f.lowStock.value, f.reorderQty.value,
    f.packSize.value, f.packName.value, f.trackExpiry.checked,
    f.location.value, f.supplier.value, f.notes.value,
    [...minInputs.values()].map((i) => i.value),
    [...binInputs.values()].map((i) => i.value),
    [...axisInputs.values()].map((i) => i.value),
    kitModeValue, kitRows.map((r) => [r.product.value, r.qty.value]),
    sourceRows.map((r) => [r.supplier.value, r.code.value, r.price.value, r.pack.value, r.lead.value, r.preferred.checked]),
  ]);
  const opened = state();
  const unsaved = () => state() !== opened || !!photoBlob || !!photoPending || photoCleared;

  const modal = openModal({
    title: isEdit ? 'Edit product' : (prefill ? 'Duplicate product' : 'New product'),
    content: form,
    unsaved,
    onClose: () => {
      if (previewURL) URL.revokeObjectURL(previewURL);
      // A downscale finishing after cancel creates one more preview URL;
      // this chained revoke runs after it and cleans that one up too.
      photoPending?.then(() => { if (previewURL) URL.revokeObjectURL(previewURL); }).catch(() => {});
    },
  });
  syncUnit();
  syncMinHints();
  syncSources();
  syncKit();

  function field(label, control, { error = null, hint = null, required = false } = {}) {
    // The label points at the real control, which may sit inside a
    // wrapper (a select's chevron, a field with a scan button).
    const input = control.matches?.('input, select, textarea')
      ? control
      : control.querySelector('input, select, textarea');
    const id = `${ns}-f${++fieldN}`;
    input.id = id;
    // A hint is instruction, not decoration — "How you count it: each,
    // kg, L, m…" is the only place the form says a unit may be anything
    // at all. Sitting next to the field left it unreachable to anyone
    // who never sees it, so the field points at it. The error comes
    // after: it's the newer thing to say, and it's ignored while hidden.
    const hintNode = hint ? el('p.hint', { id: `${id}-hint` }, hint) : null;
    const describedBy = [hintNode?.id, error?.id].filter(Boolean).join(' ');
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    if (required) input.setAttribute('aria-required', 'true');
    return el('div.field', {}, el('label', { htmlFor: id }, label,
      required ? el('span', { 'aria-hidden': 'true' }, ' *') : null
    ), control, hintNode, error);
  }
}

function fillSelect(select, items, selectedId, emptyLabel) {
  select.append(el('option', { value: '' }, emptyLabel));
  for (const item of items) {
    select.append(el('option', { value: item.id, selected: item.id === selectedId }, item.name));
  }
}

const numOr = (v, fallback) => (Number.isNaN(v) ? fallback : v);
