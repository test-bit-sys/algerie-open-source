/**
 * Import wizard: pick a CSV export from another tracker, confirm (or fix)
 * the column mapping, review what will land, then import. Re-importing
 * the same file is safe; identical rows are skipped.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, fieldError } from './fields.js';
import { store } from '../lib/store.js';
import { parseCSV } from '../lib/csv.js';
import { IMPORT_TARGETS, detectMapping, rowsToItems } from '../lib/importer.js';
import { fmtDuration, fmtDay } from '../lib/time.js';
import { sum } from '../lib/util.js';

export function openImporter() {
  const body = el('div');
  const modal = openModal({ title: 'Import time data', content: body });

  let headers = [];
  let dataRows = [];
  let mapping = {};
  let source = 'CSV';

  /* Step 1: pick a file */
  function renderPick() {
    clear(body);
    const fileInput = el('input', {
      type: 'file', accept: '.csv,text/csv', hidden: true,
      onchange: async () => {
        const file = fileInput.files?.[0];
        // Reset so picking the same file again (say, after fixing it in
        // place) still fires a change event.
        fileInput.value = '';
        if (!file) return;
        let rows;
        try {
          rows = parseCSV(await file.text());
        } catch {
          rows = [];
        }
        if (rows.length < 2) {
          toast('That file has no data rows', { icon: 'x' });
          return;
        }
        headers = rows[0];
        dataRows = rows.slice(1);
        ({ source, mapping } = detectMapping(headers));
        renderMapping();
      },
    });
    append(body, [
      el('div.onboard-hero', {},
        el('div.empty-icon', { html: icon('fileUp', 28) }),
        el('h3.onboard-title', {}, 'Bring your history with you'),
        el('p.onboard-sub', {}, 'Use the detailed CSV export from Toggl, Clockify, Harvest, or any tracker with date, duration, and project columns. Clients and projects are matched by name and created when missing.')
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: () => fileInput.click(),
      }, 'Choose a CSV file'),
      fileInput,
    ]);
  }

  /* Step 2: column mapping (prefilled by detection) */
  function renderMapping() {
    clear(body);
    const selects = {};
    /* A required column that was not picked is reported under the field
       that is missing it, the way every other form in the app does it: one
       summary line under the whole list named the fields but left the user
       to find them again, and told a screen reader nothing about which
       control was at fault. */
    const errors = {};
    const rows = IMPORT_TARGETS.map((t) => {
      const select = el('select.select', {},
        el('option', { value: -1, selected: mapping[t.key] === -1 }, t.required ? 'Choose a column' : 'Not in the file'),
        headers.map((h, i) => el('option', { value: i, selected: mapping[t.key] === i }, h || `Column ${i + 1}`))
      );
      selects[t.key] = select;
      const row = field(t.required ? `${t.label} (required)` : t.label, select);
      if (!t.required) return row;
      const err = fieldError(select);
      errors[t.key] = err;
      select.addEventListener('change', () => { if (select.value !== '-1') err.hide(); });
      return el('div', {}, row, err);
    });

    append(body, [
      el('p.onboard-p', {},
        source === 'CSV'
          ? 'Match the file columns to Hourly fields.'
          : `This looks like a ${source} export; the columns below are matched already.`),
      el('div.import-map', {}, rows),
      el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: () => {
          for (const t of IMPORT_TARGETS) mapping[t.key] = Number(selects[t.key].value);
          const missing = IMPORT_TARGETS.filter((t) => t.required && mapping[t.key] === -1);
          for (const err of Object.values(errors)) err.hide();
          if (missing.length) {
            for (const t of missing) errors[t.key].show(`Choose the column that holds the ${t.label.toLowerCase()}`);
            selects[missing[0].key].focus();
            return;
          }
          renderReview();
        },
      }, 'Review import'),
      backBtn(renderPick),
    ]);
  }

  /* Step 3: review, then import */
  function renderReview() {
    clear(body);
    const { items, invalid } = rowsToItems(dataRows, mapping);
    if (!items.length) {
      append(body, [
        el('p.onboard-p', {}, 'No importable rows were found; check the column mapping.'),
        invalid.length > 0 && invalidList(invalid),
        backBtn(renderMapping),
      ]);
      return;
    }

    const dates = items.map((i) => i.date).sort();
    const byClient = new Map();
    for (const i of items) {
      const name = i.client || 'Imported';
      byClient.set(name, (byClient.get(name) || 0) + i.seconds);
    }
    const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]);

    const importBtn = el('button.btn.btn-primary.btn-block', {
      type: 'button',
      onclick: async () => {
        importBtn.disabled = true;
        importBtn.textContent = 'Importing…';
        try {
          const result = await store.importEntries(items);
          modal.close();
          const parts = [`Imported ${result.added} entr${result.added === 1 ? 'y' : 'ies'}`];
          if (result.skipped) parts.push(`${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped`);
          toast(parts.join(', '), { icon: 'check', duration: 5000 });
        } catch (err) {
          console.error(err);
          importBtn.disabled = false;
          importBtn.textContent = `Import ${items.length} entries`;
          toast('Import failed, check your connection', { icon: 'wifiOff' });
        }
      },
    }, `Import ${items.length} entries`);

    append(body, [
      el('div.entry-summary', {},
        summaryRow('Entries', String(items.length)),
        summaryRow('Time', fmtDuration(sum(items, (i) => i.seconds))),
        summaryRow('From', fmtDay(dates[0], { year: true })),
        summaryRow('To', fmtDay(dates[dates.length - 1], { year: true })),
        topClients.slice(0, 5).map(([name, secs]) => summaryRow(name, fmtDuration(secs)))
      ),
      invalid.length > 0 && invalidList(invalid),
      el('p.small-note', {}, 'Rows identical to entries you already have are skipped, so importing twice never duplicates.'),
      importBtn,
      backBtn(renderMapping),
    ]);
  }

  function invalidList(invalid) {
    const shown = invalid.slice(0, 5);
    return el('div.import-invalid', {},
      el('p.import-invalid-title', {},
        el('span', { html: icon('alert', 14, 2.4), 'aria-hidden': 'true' }),
        ` ${invalid.length} row${invalid.length === 1 ? '' : 's'} cannot be imported`),
      el('ul.import-invalid-list', {},
        shown.map((r) => el('li', {}, `Line ${r.line}: ${r.reason}`)),
        invalid.length > shown.length && el('li', {}, `and ${invalid.length - shown.length} more`))
    );
  }

  function summaryRow(label, value) {
    return el('div.summary-row', {},
      el('span.summary-label', {}, label),
      el('span.summary-value', {}, value)
    );
  }

  function backBtn(to) {
    return el('button.btn.btn-ghost.btn-block', {
      type: 'button', style: { marginTop: '10px' },
      onclick: to,
    }, 'Back');
  }

  renderPick();
}
