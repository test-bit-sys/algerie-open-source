/**
 * The printable timesheet: the detail a client asks for behind an hourly
 * invoice, which days, which tasks, how long.
 *
 * The invoice itself groups by project, task, and rate with no dates on
 * it, and a CSV is not a document anyone sends a client, so this is the
 * attachment that used to be assembled in a spreadsheet. It renders from
 * an invoice (the entries it froze, reconciling to its total) or from any
 * Reports range, on the same overlay and the same print CSS the invoice
 * page uses.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { logoURL } from './logo.js';
import { openPrintOverlay, toolbarToggle } from './printsheet.js';
import { store } from '../lib/store.js';
import { fmtDuration, fmtDay, fmtWeekday, toHours, fmtTimeRange } from '../lib/time.js';
import { fmtMoney, fmtMoneyList, round2, sum } from '../lib/util.js';

const invoiceNo = (n) => `#${String(n).padStart(4, '0')}`;

/**
 * openTimesheetSheet({ invoice }) — the detail behind one invoice.
 * openTimesheetSheet({ entries, from, to }) — the detail of a date range.
 *
 * Amounts and notes are toggles rather than settings: some clients get
 * hours only, and notes are often written for oneself.
 */
export async function openTimesheetSheet({ invoice = null, entries = null, from = null, to = null } = {}) {
  let rows = entries;
  if (invoice) {
    try {
      rows = await store.invoiceEntries(invoice);
    } catch (err) {
      console.error(err);
      toast('Could not read the entries for this invoice', { icon: 'wifiOff' });
      return;
    }
  }
  rows = (rows || []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  if (!rows.length) {
    toast('No time to put on a timesheet', { icon: 'calendar' });
    return;
  }

  /* Hours: billed time for billable work, so an invoice's timesheet adds
     up to the invoice, and tracked time for non-billable work, which has
     no billed time at all but did happen. */
  const hoursOf = (e) => (e.billable ? store.billedSeconds(e) : e.seconds);

  const periodFrom = invoice?.periodFrom || from || rows[0].date;
  const periodTo = invoice?.periodTo || to || rows[rows.length - 1].date;

  /* One client is the normal case (an invoice always is), and then the
     sheet can name who it was prepared for; a range covering several
     names them per line instead. */
  const clientIds = [...new Set(rows.map((e) => store.project(e.projectId)?.clientId || 'none'))];
  const onlyClient = clientIds.length === 1 ? store.client(clientIds[0]) : null;
  const billTo = invoice?.billTo || (onlyClient ? {
    name: onlyClient.name,
    address: onlyClient.billingAddress || '',
    email: onlyClient.billingEmail || '',
    taxId: onlyClient.taxId || '',
  } : null);
  const business = invoice?.business || {
    name: store.settings.businessName || '',
    address: store.settings.businessAddress || '',
    taxId: store.settings.businessTaxId || '',
    logo: store.settings.businessLogo || '',
  };
  const logoSrc = await logoURL(business.logo).catch(() => null);

  /* Money is only honest inside one currency, and nothing here converts:
     a range that mixes them shows hours only and says why. */
  const buckets = store.amountsByCurrency(rows);
  const mixed = buckets.length > 1;
  const currency = invoice?.currency || buckets[0]?.currency || store.settings.currency;

  let showAmounts = !mixed;
  let showNotes = false;

  const totalSeconds = sum(rows, hoursOf);
  const totalAmount = round2(sum(rows, (e) => store.entryAmount(e)));

  const byDay = new Map();
  for (const e of rows) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }

  /* Hours print at the precision the amounts were computed with, so a
     client can multiply a row out and land on the amount printed beside
     it. Two decimals read tidier and did not reconcile: 55 minutes comes
     out as 0.92 h, and 0.92 x $120 is $110.40 against an amount column
     saying $110.00 — on the one document that exists to be checked
     against the invoice. The invoice page prints four decimals for the
     same reason; a clean duration still reads clean ("5.25", "3.5", "2"). */
  const HOURS_DP = 4;
  const HOURS_STEP = 10 ** HOURS_DP;
  const rowHours = (e) => toHours(hoursOf(e), HOURS_DP);
  /* Footings add the printed row values rather than re-rounding the raw
     seconds, so the Hours column adds up to its own subtotal and total. */
  const sumHours = (list) => Math.round(sum(list, rowHours) * HOURS_STEP) / HOURS_STEP;
  const hours = (value) => String(value);
  const money = (v) => fmtMoney(v, currency);

  /* Amounts stay inside their own currency: a range can mix them, and
     nothing here ever converts or adds across them. */
  const entryMoney = (e) => (mixed
    ? fmtMoney(store.entryAmount(e), store.resolveCurrency(e))
    : money(store.entryAmount(e)));
  const groupMoney = (list) => (mixed
    ? fmtMoneyList(store.amountsByCurrency(list))
    : money(round2(sum(list, (x) => store.entryAmount(x)))));

  function buildSheet() {
    const dayRows = [];
    for (const [date, dayEntries] of byDay) {
      dayRows.push(el('tr.ts-day', {},
        el('td.desc', {}, `${fmtWeekday(date)}, ${fmtDay(date, { year: true })}`),
        el('td.num', {}, hours(sumHours(dayEntries))),
        showAmounts && el('td.num', {}, groupMoney(dayEntries))
      ));
      for (const e of dayEntries) {
        const project = store.project(e.projectId);
        const client = store.client(project?.clientId);
        const label = [
          // A range covering several clients names the client per line;
          // one client is already in the header.
          !onlyClient && !invoice ? client?.name : null,
          project?.name || 'No project',
          e.task,
        ].filter(Boolean).join(' · ');
        // Clients that require times on a timesheet (legal, public
        // sector, agency subcontracting) get them when the entry has
        // them; a duration-only entry reads exactly as it did before.
        const span = fmtTimeRange(e.startedAt, e.endedAt);
        dayRows.push(el('tr.ts-entry', {},
          el('td.desc', {},
            span && el('span.ts-time', {}, `${span} · `),
            el('span.ts-label', {}, label),
            !e.billable && el('span.ts-flag', {}, ' (non-billable)'),
            showNotes && e.notes && el('span.ts-note', {}, e.notes)
          ),
          el('td.num', {}, hours(rowHours(e))),
          showAmounts && el('td.num', {}, e.billable ? entryMoney(e) : '')
        ));
      }
    }

    const reconciles = invoice
      ? round2(totalAmount) !== round2(invoice.total)
      : false;

    return el('div.invoice-sheet.timesheet-sheet', {},
      el('header.invoice-head', {},
        el('div.grow', {},
          logoSrc && el('img.invoice-logo', { src: logoSrc, alt: '' }),
          el('div.invoice-business-name', {}, business.name || store.user?.username || 'Timesheet'),
          business.address && el('p.invoice-address', {}, business.address),
          business.taxId && el('p.invoice-meta-line', {}, `Tax ID: ${business.taxId}`)
        ),
        el('div.invoice-title-block', {},
          el('div.invoice-doc-title', {}, 'TIMESHEET'),
          invoice && el('div.invoice-number', {}, invoiceNo(invoice.number)),
          el('p.invoice-meta-line', {},
            `${fmtDay(periodFrom, { year: true })} – ${fmtDay(periodTo, { year: true })}`),
          invoice && el('p.invoice-meta-line', {},
            `Supporting invoice ${invoiceNo(invoice.number)}`)
        )
      ),
      billTo && el('section.invoice-billto', {},
        el('div.invoice-label', {}, 'Prepared for'),
        el('div.invoice-billto-name', {}, billTo.name),
        billTo.address && el('p.invoice-address', {}, billTo.address),
        billTo.taxId && el('p.invoice-meta-line', {}, `Tax ID: ${billTo.taxId}`)
      ),
      el('div.invoice-table-wrap', {},
        el('table.invoice-table.timesheet-table', {},
          el('thead', {}, el('tr', {},
            el('th.desc', {}, 'Day and work'),
            el('th.num', {}, 'Hours'),
            showAmounts && el('th.num', {}, 'Amount')
          )),
          el('tbody', {}, dayRows),
          el('tfoot', {}, el('tr.ts-total', {},
            el('td.desc', {}, `Total · ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'} · ${fmtDuration(totalSeconds)}`),
            el('td.num', {}, hours(sumHours(rows))),
            showAmounts && el('td.num', {}, groupMoney(rows))
          ))
        )
      ),
      // What the numbers mean against the bill: the same total, or the
      // part of it this time accounts for.
      (invoice || mixed) && el('footer.invoice-foot', {},
        invoice && el('p', {}, reconciles
          ? `Time on this timesheet totals ${money(totalAmount)}. Invoice ${invoiceNo(invoice.number)} totals ${money(invoice.total)}, including any fees, expenses, discounts, and tax.`
          : `This is the ${fmtDuration(totalSeconds)} billed on invoice ${invoiceNo(invoice.number)}, ${money(invoice.total)}.`),
        mixed && el('p', {}, 'Work in this range bills in more than one currency, so amounts are shown per currency and not added together.')
      )
    );
  }

  const render = () => {
    clear(overlay.body);
    overlay.body.append(buildSheet());
  };

  const label = invoice
    ? `Timesheet for invoice ${invoiceNo(invoice.number)}`
    : `Timesheet, ${fmtDay(periodFrom, { year: true })} to ${fmtDay(periodTo, { year: true })}`;

  const overlay = openPrintOverlay({
    label,
    actions: () => [
      toolbarToggle('Amounts', showAmounts, (on) => {
        if (mixed && on) {
          toast('Amounts in this range are in different currencies', { icon: 'banknote' });
        }
        showAmounts = on;
        render();
      }),
      toolbarToggle('Notes', showNotes, (on) => { showNotes = on; render(); }),
      el('button.btn.btn-primary.btn-slim', {
        html: icon('printer', 15, 2),
        onclick: () => window.print(),
      }, ' Print or save as PDF'),
    ],
  });
  render();
}
