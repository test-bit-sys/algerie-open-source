// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store, normalizeInvoiceLines, invoiceTotals } from '../src/lib/store.js';
import { openCreateInvoice } from '../src/ui/invoice.js';
import { fmtMoney } from '../src/lib/util.js';
import { createPuterMock } from './puter-mock.js';

let client;

beforeEach(async () => {
  vi.stubGlobal('puter', createPuterMock());
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<main id="app"></main>';
  await store.init();
  client = await store.addClient({ name: 'Acme' });
});

afterEach(() => {
  for (const close of document.querySelectorAll('.modal-root:not(.closing) [aria-label="Close"]')) close.click();
  // The invoice page a successful create opens; nothing here needs it.
  for (const page of document.querySelectorAll('.invoice-view')) page.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The topmost open dialog. */
const topModal = () => [...document.querySelectorAll('.modal-root:not(.closing)')].at(-1);

function control(modal, label) {
  const node = [...modal.querySelectorAll('label')].find((n) => n.textContent === label);
  return document.getElementById(node.htmlFor);
}

function addLine({ quantity, amount }) {
  [...topModal().querySelectorAll('button')].find((b) => b.textContent.includes('Add a fee')).click();
  const sheet = topModal();
  if (quantity !== undefined) control(sheet, 'Quantity').value = quantity;
  control(sheet, 'Unit amount (USD)').value = amount;
  sheet.querySelector('form').requestSubmit();
  return sheet;
}

function summaryValue(label) {
  const row = [...document.querySelectorAll('.entry-summary .summary-row')]
    .find((r) => r.querySelector('.summary-label').textContent === label);
  return row?.querySelector('.summary-value').textContent;
}

describe('create invoice sheet', () => {
  it('previews manual lines at the precision the record freezes them at', async () => {
    openCreateInvoice({ client, entries: [] });
    addLine({ quantity: '0.333', amount: '100' });

    // What the store will freeze for this line, computed the store's way.
    const frozen = normalizeInvoiceLines([{ kind: 'fee', quantity: 0.333, unitAmount: 100, taxable: true }]);
    const { total } = invoiceTotals(0, frozen, 0);
    const previewed = summaryValue('Total');
    expect(previewed).toBe(fmtMoney(total));
    expect(previewed).toBe(fmtMoney(33));
    // The listed line says the same thing the invoice will print.
    expect(document.querySelector('.modal-root .entry-sub').textContent).toContain('0.33 ×');

    document.querySelector('.modal-root form').requestSubmit();
    await vi.waitFor(() => expect(store.invoices.length).toBe(1));
    const issued = store.invoices[0];
    expect(issued.lines).toEqual([expect.objectContaining({ quantity: 0.33, unitAmount: 100, amount: 33 })]);
    // The number on the button is the number on the document.
    expect(fmtMoney(issued.total)).toBe(previewed);
  });

  it('refuses a quantity or amount that rounds away to nothing', () => {
    openCreateInvoice({ client, entries: [] });
    const sheet = addLine({ quantity: '0.004', amount: '100' });
    expect(sheet.isConnected).toBe(true);
    expect(control(sheet, 'Quantity').getAttribute('aria-invalid')).toBe('true');

    control(sheet, 'Quantity').value = '1';
    control(sheet, 'Unit amount (USD)').value = '0.004';
    sheet.querySelector('form').requestSubmit();
    expect(control(sheet, 'Unit amount (USD)').getAttribute('aria-invalid')).toBe('true');
    // Nothing reached the invoice.
    expect(document.querySelectorAll('.modal-root .entry-row').length).toBe(0);
  });
});
