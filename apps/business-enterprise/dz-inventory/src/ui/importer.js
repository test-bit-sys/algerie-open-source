/**
 * CSV import wizard: pick a file, review the auto-detected column
 * mapping and what will change, then apply. Rows are matched to
 * existing products by SKU; the merge mode decides what a match does.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { parseCSV, looksLikeHeader, autoMapColumns, rowsToDrafts, PRODUCT_COLUMNS } from '../lib/csv.js';
import { mergeImport, archivedMatches, kitStockMatches } from '../lib/inventory.js';

/** Placeholder for a field the file has no column for. */
const unstated = () => el('span.muted', { title: 'Not in this file; left as it is' }, '–');

/** Per-dialog id prefix; see the mapping grid below. */
let seq = 0;

export function openImporter({ onDone } = {}) {
  const ns = `imp${++seq}`;
  const body = el('div');
  /* A parsed file plus corrected mappings is real work; the review
     step counts as unsaved so a scrim mistap or Escape asks first. */
  let reviewing = false;

  /* Step 1 — pick a file */
  function renderPicker() {
    reviewing = false;
    clear(body);
    const fileInput = el('input', {
      type: 'file',
      accept: '.csv,text/csv,text/plain',
      style: { display: 'none' },
      onchange: () => fileInput.files?.[0] && readFile(fileInput.files[0]),
    });
    const drop = el('button.import-drop', {
      type: 'button',
      html: icon('fileUp', 30),
      onclick: () => fileInput.click(),
    },
      el('span', {}, el('strong', {}, 'Choose a CSV file'), ' or drag it here'),
      el('span.small.muted', {}, 'Columns like Name, SKU, Quantity, Location, Supplier, Purchase cost are detected automatically.')
    );
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) readFile(file);
    });
    body.append(fileInput, drop);
  }

  async function readFile(file) {
    let rows;
    try {
      rows = parseCSV(await file.text());
    } catch (err) {
      console.error(err);
      toast('Couldn’t read that file', { icon: 'circleAlert' });
      return;
    }
    if (!rows.length) {
      toast('That file appears to be empty', { icon: 'circleAlert' });
      return;
    }
    const hasHeader = looksLikeHeader(rows[0]);
    const header = hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? rows.slice(1) : rows;
    if (!dataRows.length) {
      toast('No data rows found below the header', { icon: 'circleAlert' });
      return;
    }
    // With a header stripped, the first data row is spreadsheet row 2 —
    // warnings should name the row the user will actually look up.
    renderReview(header, dataRows, hasHeader ? autoMapColumns(rows[0]) : {}, hasHeader ? 2 : 1);
  }

  /* Step 2 — mapping, merge mode, preview, apply */
  function renderReview(header, dataRows, mapping, firstLine = 1) {
    reviewing = true;
    clear(body);
    let mode = 'update';

    const summary = el('div.import-summary', { 'aria-live': 'polite' });
    const archivedNote = el('p.import-note', { hidden: true });
    const kitNote = el('p.import-note', { hidden: true });
    const errorsBox = el('div.import-errors', { hidden: true });
    const previewWrap = el('div.import-review');
    const applyBtn = el('button.btn.btn-primary', {}, 'Import');
    const backBtn = el('button.btn.btn-ghost', { onclick: () => renderPicker() }, 'Back');

    /* One import at a time: while one is applying, every control that
       could start another — or re-enable the button through refresh()
       — is locked, or a mid-flight remap could fire a second
       applyImport against the same products and duplicate rows. */
    let applying = false;
    function setBusy(busy) {
      applying = busy;
      for (const s of mapGrid.querySelectorAll('select')) s.disabled = busy;
      for (const b of modeSeg.querySelectorAll('button')) b.disabled = busy;
      backBtn.disabled = busy;
      applyBtn.setAttribute('aria-busy', String(busy));
      if (busy) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Importing…';
      } else {
        refresh();
      }
    }

    /* Column mapping: one select per product field. The label points at
       its own select — nineteen field names sitting next to nineteen
       comboboxes, and clicking one did nothing, alone among the app's
       forms. Ids are per-dialog: a second importer opened while this one
       is still animating out would otherwise aim its labels at the
       dying one's selects. The richer aria-label stays the accessible
       name ("Name, combobox" says nothing about which side it is). */
    const mapGrid = el('div.field-grid', {},
      PRODUCT_COLUMNS.map((col) => {
        const id = `${ns}-map-${col.key}`;
        const select = el('select.select', {
          id,
          'aria-label': `CSV column for ${col.header}`,
          onchange: () => {
            const v = select.value === '' ? undefined : Number(select.value);
            if (v === undefined) delete mapping[col.key];
            else mapping[col.key] = v;
            refresh();
          },
        },
          el('option', { value: '' }, 'Not in file'),
          header.map((h, i) => el('option', { value: String(i), selected: mapping[col.key] === i }, h))
        );
        return el('div.field', {},
          el('label', { htmlFor: id }, col.header),
          el('div.select-wrap', {}, select));
      })
    );

    const modeSeg = el('div.segmented', { role: 'group', 'aria-label': 'When a SKU already exists' },
      [
        { key: 'update', label: 'Update product' },
        { key: 'add', label: 'Add to stock' },
        { key: 'skip', label: 'Skip row' },
      ].map((m) => el('button', {
        type: 'button',
        'aria-pressed': String(m.key === mode),
        onclick: (e) => {
          mode = m.key;
          for (const b of modeSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
          e.currentTarget.setAttribute('aria-pressed', 'true');
          refresh();
        },
      }, m.label))
    );

    const modeHint = el('p.hint');

    const MODE_HINTS = {
      update: 'Writes only the columns mapped above; every other field stays as it is.',
      add: 'Adds the row’s quantity to what’s already on hand, instead of replacing it.',
      skip: 'Matched rows are left alone entirely; only new SKUs are added.',
    };

    let current = { drafts: [], errors: [] };

    /**
     * SKU → the unit of the product it matches, indexed once per pass.
     * A receiving sheet often carries just SKU and Quantity, and the
     * matched product is what decides whether those numbers may be
     * decimal — but asking the store per row walked the whole catalogue
     * each time, so a two-thousand-row file against two thousand
     * products did that two thousand times over, and again on every
     * column re-mapped. First match wins, the same rule productBySku
     * and the merge itself follow.
     */
    function unitIndex() {
      const byKey = new Map();
      for (const p of store.products) {
        const key = String(p.sku ?? '').trim().toLowerCase();
        if (key && !byKey.has(key)) byKey.set(key, p.unit || '');
      }
      return (sku) => byKey.get(String(sku ?? '').trim().toLowerCase()) || '';
    }

    function refresh() {
      modeHint.textContent = MODE_HINTS[mode];
      current = rowsToDrafts(dataRows, mapping, {
        firstLine,
        unitOf: unitIndex(),
      });
      const merged = mergeImport(store.products, current.drafts, mode);

      clear(summary);
      append(summary, [
        el('span', {}, el('strong', {}, String(merged.created.length)), ' new'),
        el('span', {}, el('strong', {}, String(merged.updated.length)), ' updated'),
        merged.skipped ? el('span', {}, el('strong', {}, String(merged.skipped)), ' skipped') : null,
        current.errors.length ? el('span', { style: { color: 'var(--warn)' } },
          el('strong', {}, String(current.errors.length)), ' warning', current.errors.length === 1 ? '' : 's') : null,
      ]);

      /* Stock landing on a product nobody can see is nearly always a
         mistake, so say so before the import, not after. */
      const archivedHits = mode === 'skip' ? 0 : archivedMatches(store.products, current.drafts);
      archivedNote.hidden = !archivedHits;
      archivedNote.textContent = archivedHits
        ? `${archivedHits} row${archivedHits === 1 ? '' : 's'} match${archivedHits === 1 ? 'es' : ''} an archived product. ${
          mode === 'add'
            ? 'Their stock changes, but they stay archived and hidden. Restore them first if that isn’t what you want.'
            : 'They stay archived unless the file’s Archived column says otherwise.'}`
        : '';

      /* A quantity for a kit sold from components goes nowhere: the kit
         holds none of its own. Said here, where the number is still on
         screen, rather than left to be missed after the import. */
      const kitHits = mode === 'skip' ? 0 : kitStockMatches(store.products, current.drafts);
      kitNote.hidden = !kitHits;
      kitNote.textContent = kitHits
        ? `${kitHits} row${kitHits === 1 ? '' : 's'} give${kitHits === 1 ? 's' : ''} a quantity to a product sold as a kit. `
          + `A kit like that holds stock through its components, so ${kitHits === 1 ? 'that quantity is' : 'those quantities are'} left out; `
          + 'everything else on the row still imports.'
        : '';

      errorsBox.hidden = !current.errors.length;
      clear(errorsBox);
      for (const e of current.errors.slice(0, 40)) {
        errorsBox.append(el('div', {}, `Row ${e.line}: ${e.message}`));
      }
      if (current.errors.length > 40) errorsBox.append(el('div', {}, `and ${current.errors.length - 40} more`));

      /* Preview: first rows as they will be imported. */
      clear(previewWrap);
      const shown = current.drafts.slice(0, 8);
      previewWrap.append(el('table.table', {},
        el('thead', {}, el('tr', {},
          ['Name', 'SKU', 'Category', 'Qty', 'Location', 'Supplier', 'Cost'].map((h) =>
            el(h === 'Qty' || h === 'Cost' ? 'th.num' : 'th', { scope: 'col' }, h))
        )),
        el('tbody', {}, shown.map((dr) => el('tr', {},
          el('td', {}, el('div.cell-main', {}, dr.name)),
          el('td.mono', {}, dr.sku || ''),
          el('td', {}, dr.category || ''),
          // A column the file doesn't have shows as a dash: nothing is
          // being imported into it, and 0 would claim otherwise.
          el('td.num', {}, dr.quantity === undefined ? unstated() : String(dr.quantity)),
          el('td', {}, dr.locationName || ''),
          el('td', {}, dr.supplierName || ''),
          // A stated zero prints as 0.00, the way the quantity above it
          // prints 0: a mapped Cost column whose cell is blank or "0"
          // will write zero over whatever the matched product cost, and
          // an empty cell in the preview hid exactly that.
          el('td.num', {}, dr.cost === undefined ? unstated() : dr.cost.toFixed(2))
        )))
      ));
      if (current.drafts.length > shown.length) {
        previewWrap.append(el('p.small.muted', { style: { padding: '8px 12px' } },
          `and ${current.drafts.length - shown.length} more rows`));
      }

      applyBtn.disabled = applying || !current.drafts.length;
      applyBtn.textContent = current.drafts.length
        ? `Import ${current.drafts.length} row${current.drafts.length === 1 ? '' : 's'}`
        : 'Nothing to import';
    }

    append(body, [
      el('h3.section-title', {}, 'Columns'),
      mapGrid,
      el('h3.section-title', {}, 'If a SKU already exists'),
      el('div.field', {}, modeSeg, modeHint),
      el('h3.section-title', {}, 'Preview'),
      summary,
      archivedNote,
      kitNote,
      previewWrap,
      errorsBox,
      store.hasData && el('p.small.muted', { style: { margin: '12px 0 0', display: 'flex', gap: '7px' }, html: icon('shield', 15, 2) },
        el('span', {}, 'A snapshot of your current data is saved first. You can restore it from Settings.')),
      el('div.row.row-end', {},
        backBtn,
        applyBtn
      ),
    ]);

    applyBtn.addEventListener('click', async () => {
      if (applying) return;
      setBusy(true);
      try {
        const res = await store.applyImport(current.drafts, mode);
        toast(`Imported: ${res.created} new, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ''}`);
        modal.close();
        onDone?.();
      } catch (err) {
        console.error(err);
        setBusy(false);
        toast('Import failed. Check your connection', { icon: 'wifiOff' });
      }
    });

    refresh();
  }

  // Fill the body before the dialog opens, so its autofocus can find
  // the drop zone; an empty panel would only be focusable itself.
  renderPicker();
  const modal = openModal({
    title: 'Import products from CSV',
    content: body,
    wide: true,
    unsaved: () => reviewing,
  });
}
