/** Reports: totals over a range, grouped by client, project, or task. */

import { el, clear, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import {
  openCreateInvoice, openInvoiceView, openPaymentSheet, openNewInvoice, openInvoiceForClient,
  invoiceNumber, STATE_LABEL, dueText,
} from '../ui/invoice.js';
import { openTimesheetSheet } from '../ui/timesheetprint.js';
import { moneyValue } from '../ui/stats.js';
import { store, invoiceState, paidAmount, outstandingAmount, invoiceLocksOf } from '../lib/store.js';
import { entriesToCSV } from '../lib/csv.js';
import {
  todayISO, weekStartOf, addDays, monthKeyOf, monthDays, shiftMonth, dateOf, isoOf, daysApart,
  fmtDuration, fmtDay, fmtMonth,
} from '../lib/time.js';
import { fmtMoney, fmtMoneyList, downloadFile, round2 } from '../lib/util.js';

const MODES = [
  { key: 'report', label: 'Report' },
  { key: 'insights', label: 'Insights' },
  { key: 'invoices', label: 'Invoices' },
];

const RANGES = [
  { key: 'week', label: 'This week' },
  { key: 'lastweek', label: 'Last week' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

const GROUPS = [
  { key: 'client', label: 'Client' },
  { key: 'project', label: 'Project' },
  { key: 'task', label: 'Task' },
];

const BILLING = [
  { key: 'all', label: 'All' },
  { key: 'unbilled', label: 'Unbilled' },
  { key: 'invoiced', label: 'Invoiced' },
];

/* Invoice list filters. "Open" is everything not settled, overdue
   included, because that is the whole of what is owed; "Overdue" narrows
   it to the part that is late. */
const INVOICE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];

/* The tab can be addressed from outside the view (#/reports?view=invoices),
   so a reminder about unbilled time can land on the list that shows it. */
function initialMode() {
  const [route, query] = location.hash.split('?');
  if (!query) return 'report';
  const want = new URLSearchParams(query).get('view');
  /* Consumed once and cleared, like the URL actions are: a reload should
     land where the tabs were left, not back on a tab a month-old toast
     asked for. replaceState fires no hashchange, so the view being built
     right now is not torn down by the cleanup. */
  history.replaceState(null, '', route || '#/reports');
  return MODES.some((m) => m.key === want) ? want : 'report';
}

export function reportsView() {
  const root = el('div.view');
  let mode = initialMode();
  let range = 'week';
  let groupBy = 'client';
  let billing = 'all';
  let customFrom = addDays(todayISO(), -29);
  let customTo = todayISO();
  let invoiceFilter = 'all';
  let invoicesSeq = 0;
  let lastEntries = [];
  let lastRange = null; // the range lastEntries were fetched for

  const modeSeg = el('div.segmented.report-mode', { role: 'group', 'aria-label': 'Reports view' });
  const rangeSeg = el('div.segmented.seg-scroll', { role: 'group', 'aria-label': 'Date range' });
  const customRow = el('div.custom-range', { hidden: true });
  const groupSeg = el('div.segmented', { role: 'group', 'aria-label': 'Group by' });
  const billingSeg = el('div.segmented', { role: 'group', 'aria-label': 'Billing state' });
  const summary = el('div.stat-row.stat-row-4');
  const rangeNote = el('p.page-sub');
  const list = el('div');
  const insightsBody = el('div', { hidden: true });
  const invoicesBody = el('div', { hidden: true });

  const exportBtn = el('button.btn.btn-ghost.btn-slim', {
    html: icon('fileDown', 16, 2),
    onclick: () => {
      if (!lastEntries.length) {
        toast('Nothing to export in this range', { icon: 'fileDown' });
        return;
      }
      // Name the file for the range the rows actually came from: with a
      // render still in flight, currentRange() is already the new range
      // while lastEntries still holds the old one's rows.
      const { from, to } = lastRange;
      // BOM: Excel needs it to read UTF-8 CSVs correctly.
      downloadFile('\ufeff' + entriesToCSV(lastEntries, store), `hourly-${from}-to-${to}.csv`, 'text/csv;charset=utf-8');
    },
  }, ' Export CSV');

  const printBtn = el('button.btn.btn-ghost.btn-slim', {
    html: icon('printer', 16, 2),
    onclick: () => window.print(),
    title: 'Print an invoice-ready summary of this report',
  }, ' Print');

  /* The client-facing document for a range: days, tasks, and durations,
     rather than this screen's grouped summary of them. */
  const timesheetBtn = el('button.btn.btn-ghost.btn-slim', {
    html: icon('calendar', 16, 2),
    title: 'A printable timesheet for this range',
    onclick: () => {
      if (!lastEntries.length) {
        toast('Nothing in this range to put on a timesheet', { icon: 'calendar' });
        return;
      }
      const { from, to } = lastRange;
      openTimesheetSheet({ entries: lastEntries, from, to }).catch(console.error);
    },
  }, ' Timesheet');

  /* The Invoices tab has its own action: an invoice that is not made of
     unbilled time (a fixed fee, an expense) has no client row in Report to
     start from. */
  const newInvoiceBtn = el('button.btn.btn-primary.btn-slim', {
    html: icon('plus', 16, 2.2),
    onclick: () => openNewInvoice(),
  }, ' New invoice');

  const headActions = el('div.row.head-actions', {}, timesheetBtn, printBtn, exportBtn);
  const invoiceActions = el('div.row', { hidden: true }, newInvoiceBtn);
  const controls = el('div.report-controls', {},
    rangeSeg,
    customRow,
    // Each label and the control it names wrap as one unit: loose in the
    // row, "Billing" was left stranded at the end of the first line with
    // its own control alone on the next, reading as part of "Group by".
    el('div.group-row', {},
      el('div.group-pair', {},
        el('span.group-label', { id: 'group-by-label' }, 'Group by'),
        groupSeg
      ),
      el('div.group-pair', {},
        el('span.group-label', { id: 'billing-label' }, 'Billing'),
        billingSeg
      )
    )
  );

  root.append(
    el('div.page-head.page-head-split', {},
      el('div', {},
        el('h1.page-title', {}, 'Reports'),
        rangeNote
      ),
      headActions,
      invoiceActions
    ),
    modeSeg,
    controls,
    summary,
    list,
    insightsBody,
    invoicesBody
  );

  /* ---------- report / insights mode ---------- */

  function renderModeSeg() {
    clear(modeSeg);
    for (const m of MODES) {
      modeSeg.append(el('button', {
        type: 'button',
        className: mode === m.key ? 'active' : '',
        'aria-pressed': mode === m.key ? 'true' : 'false',
        onclick: () => {
          if (mode === m.key) return;
          mode = m.key;
          keepFocus(modeSeg, renderModeSeg);
          applyMode();
        },
      }, m.label));
    }
  }

  function applyMode() {
    const report = mode === 'report';
    controls.hidden = !report;
    summary.hidden = !report;
    list.hidden = !report;
    headActions.hidden = !report; // print and CSV act on the report range
    insightsBody.hidden = mode !== 'insights';
    invoicesBody.hidden = mode !== 'invoices';
    invoiceActions.hidden = mode !== 'invoices';
    rerender();
  }

  /* ---------- range handling ---------- */

  function currentRange() {
    const today = todayISO();
    const ws = store.settings.weekStart;
    if (range === 'week') return { from: weekStartOf(today, ws), to: addDays(weekStartOf(today, ws), 6) };
    if (range === 'lastweek') {
      const start = addDays(weekStartOf(today, ws), -7);
      return { from: start, to: addDays(start, 6) };
    }
    if (range === 'month') {
      // The whole calendar month, like "This week" is the whole week;
      // ending at today would hide entries dated later in the month.
      const key = monthKeyOf(today);
      return { from: `${key}-01`, to: monthDays(key).at(-1) };
    }
    if (range === 'lastmonth') {
      const d = dateOf(`${monthKeyOf(today)}-01`);
      d.setMonth(d.getMonth() - 1);
      const from = isoOf(d);
      const end = dateOf(`${monthKeyOf(today)}-01`);
      end.setDate(0);
      return { from, to: isoOf(end) };
    }
    return { from: customFrom, to: customTo };
  }

  function renderControls() {
    clear(rangeSeg);
    for (const r of RANGES) {
      rangeSeg.append(el('button', {
        type: 'button',
        className: range === r.key ? 'active' : '',
        'aria-pressed': range === r.key ? 'true' : 'false',
        onclick: () => { range = r.key; keepFocus(rangeSeg, renderControls); rerender(); },
      }, r.label));
    }
    customRow.hidden = range !== 'custom';

    clear(groupSeg);
    groupSeg.setAttribute('aria-labelledby', 'group-by-label');
    for (const g of GROUPS) {
      groupSeg.append(el('button', {
        type: 'button',
        className: groupBy === g.key ? 'active' : '',
        'aria-pressed': groupBy === g.key ? 'true' : 'false',
        onclick: () => { groupBy = g.key; keepFocus(groupSeg, renderControls); rerender(); },
      }, g.label));
    }

    clear(billingSeg);
    billingSeg.setAttribute('aria-labelledby', 'billing-label');
    for (const b of BILLING) {
      billingSeg.append(el('button', {
        type: 'button',
        className: billing === b.key ? 'active' : '',
        'aria-pressed': billing === b.key ? 'true' : 'false',
        onclick: () => { billing = b.key; keepFocus(billingSeg, renderControls); rerender(); },
      }, b.label));
    }
  }

  const fromInput = el('input.input', {
    type: 'date', value: customFrom, 'aria-label': 'From date',
    onchange: () => { customFrom = fromInput.value || customFrom; rerender(); },
  });
  const toInput = el('input.input', {
    type: 'date', value: customTo, 'aria-label': 'To date',
    onchange: () => { customTo = toInput.value || customTo; rerender(); },
  });
  customRow.append(fromInput, el('span.range-sep', { 'aria-hidden': 'true' }, 'to'), toInput);

  /* ---------- report body ---------- */

  /* Rapid range/group clicks can finish an older render after a newer
     one; only the newest may write the DOM (or lastEntries, which the
     CSV export reads). */
  let renderSeq = 0;
  const rerender = () => (mode === 'report' ? render()
    : mode === 'insights' ? renderInsights()
      : renderInvoices()).catch(console.error);

  /**
   * The period right before the current preset range, for the quiet
   * comparison line on the stat tiles. Custom ranges have no natural
   * "previous", so they get none.
   *
   * A range that has not finished yet only holds the days elapsed so far,
   * so measuring it against a whole earlier period would report a loss
   * every Monday morning and only stop by Sunday. Cut the earlier period
   * at the same day instead, and name it "to date" so the line says what
   * it compared. Finished ranges (last week, last month) compare in full.
   */
  function previousRange() {
    const cur = currentRange();
    const today = todayISO();
    const partial = today < cur.to;
    if (range === 'week' || range === 'lastweek') {
      return {
        from: addDays(cur.from, -7),
        to: addDays(partial ? today : cur.to, -7),
        label: range === 'week' ? (partial ? 'last week to date' : 'last week') : 'the week before',
      };
    }
    if (range === 'month' || range === 'lastmonth') {
      const prevKey = shiftMonth(cur.from.slice(0, 7), -1);
      const prevDays = monthDays(prevKey);
      // The same day of the earlier month, or its last day when it is the
      // shorter one (March 31 against February).
      const sameDay = prevDays[Math.min(Number(today.slice(8, 10)), prevDays.length) - 1];
      return {
        from: `${prevKey}-01`,
        to: partial ? sameDay : prevDays.at(-1),
        label: range === 'month' ? (partial ? 'last month to date' : 'last month') : 'the month before',
      };
    }
    return null;
  }

  function comparison(delta, prevLabel, currency = null) {
    if (delta === 0) return `Same as ${prevLabel}`;
    const sign = delta > 0 ? '+' : '−';
    const abs = Math.abs(delta);
    const text = currency ? fmtMoney(abs, currency) : fmtDuration(abs);
    return `${sign}${text} vs ${prevLabel}`;
  }

  /**
   * A money delta is only honest inside one currency: compare when both
   * periods bill in (at most) the same single currency, stay quiet when
   * either mixes currencies or they differ.
   */
  function moneyComparison(amounts, prevAmounts, prevLabel) {
    if (amounts.length > 1 || prevAmounts.length > 1) return null;
    const a = amounts[0];
    const b = prevAmounts[0];
    if (!a && !b) return null;
    if (a && b && a.currency !== b.currency) return null;
    const currency = (a || b).currency;
    return comparison(round2((a?.amount || 0) - (b?.amount || 0)), prevLabel, currency);
  }

  async function render() {
    const seq = ++renderSeq;
    let { from, to } = currentRange();
    if (from > to) [from, to] = [to, from];
    rangeNote.textContent = `${fmtDay(from, { year: true })} to ${fmtDay(to, { year: true })}`;

    const prev = previousRange();
    const [fetched, prevFetched] = await Promise.all([
      store.entriesBetween(from, to),
      prev ? store.entriesBetween(prev.from, prev.to) : null,
    ]);
    if (seq !== renderSeq) return;
    // Unbilled means billable work not yet invoiced; non-billable entries
    // only appear under All.
    const filterBilling = (all) => (billing === 'all' ? all
      : billing === 'invoiced' ? all.filter((e) => !!e.invoicedAt)
        : all.filter((e) => e.billable && !e.invoicedAt));
    const entries = filterBilling(fetched);
    lastEntries = entries;
    lastRange = { from, to };
    const totals = store.totals(entries);
    const amounts = store.amountsByCurrency(entries);
    // The comparison only speaks when there is something to compare:
    // two empty periods say nothing worth a line of ink.
    const prevEntries = prevFetched ? filterBilling(prevFetched) : null;
    const prevTotals = prevEntries ? store.totals(prevEntries) : null;
    const compare = prevTotals && (prevTotals.seconds > 0 || totals.seconds > 0);

    clear(summary);
    summary.append(
      stat('Tracked', fmtDuration(totals.seconds),
        compare && comparison(totals.seconds - prevTotals.seconds, prev.label)),
      stat('Billable', fmtDuration(totals.billableSeconds),
        compare && comparison(totals.billableSeconds - prevTotals.billableSeconds, prev.label)),
      // The share compares tracked time with tracked time: billable
      // seconds carry billing rounding, which can push them past the
      // tracked total and the ratio past 100%.
      stat('Utilization', totals.seconds > 0 ? `${Math.round((totals.trackedBillableSeconds / totals.seconds) * 100)}%` : '—',
        totals.seconds > 0 && 'billable share of tracked'),
      stat('Amount', moneyValue(amounts, store.settings.currency),
        compare && moneyComparison(amounts, store.amountsByCurrency(prevEntries), prev.label))
    );

    clear(list);
    if (!entries.length) {
      list.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('chart', 26) }),
        el('p', {}, 'No time tracked in this range.')
      ));
      return;
    }

    const groups = store.groupEntries(entries, groupBy);
    const maxSeconds = Math.max(...groups.map((g) => g.seconds), 1);

    list.append(el('div.card.report-list', { role: 'list' },
      groups.map((g) => el('div.report-row', { role: 'listitem' },
        el('div.report-row-top', {},
          el('span.color-dot', {
            style: { background: groupBy === 'task' ? 'var(--accent)' : `var(--series-${g.slot || 8})` },
            'aria-hidden': 'true',
          }),
          el('div.report-row-text', {},
            el('span.report-row-label', {}, g.label),
            g.sublabel && el('span.report-row-sub', {}, g.sublabel)
          ),
          // The amount column keeps its width when a group earns nothing
          // (an internal client, non-billable work): dropping the cell
          // let that row's hours slide right, out of line with every
          // other row's.
          el('div.report-row-nums', {},
            el('span.report-row-hours', {}, fmtDuration(g.seconds)),
            el('span.report-row-amount', {}, g.amounts.length > 0 ? fmtMoneyList(g.amounts) : '')
          ),
          // The billing workflow: with a client grouping and unbilled
          // time shown, each client row can become a real invoice...
          groupBy === 'client' && billing === 'unbilled' && g.key !== 'none' && g.entries.length > 0 && el('button.icon-btn.report-mark', {
            html: icon('receipt', 17, 2),
            'aria-label': `Create an invoice for ${g.label}`,
            title: 'Create an invoice from this time',
            onclick: () => openCreateInvoice({ client: store.client(g.key), entries: g.entries }),
          }),
          // ...or plainly flip its shown entries (the pre-invoice flow).
          groupBy === 'client' && billing !== 'all' && g.entries.length > 0 && el('button.icon-btn.report-mark', {
            html: icon(billing === 'unbilled' ? 'checkCheck' : 'reset', 17, 2),
            'aria-label': billing === 'unbilled'
              ? `Mark shown time for ${g.label} as invoiced`
              : `Mark shown time for ${g.label} as not invoiced`,
            title: billing === 'unbilled' ? 'Mark as invoiced (locks rates)' : 'Mark as not invoiced (unlocks rates)',
            onclick: () => markGroup(g),
          })
        ),
        el('div.report-bar-track', { 'aria-hidden': 'true' },
          el('div.report-bar', {
            style: {
              width: `${Math.max(2, Math.round((g.seconds / maxSeconds) * 100))}%`,
              background: groupBy === 'task' ? 'var(--accent)' : `var(--series-${g.slot || 8})`,
            },
          }))
      ))
    ));
  }

  async function markGroup(g) {
    const invoicing = billing === 'unbilled';
    // Entries an issued invoice covers only reopen by voiding it:
    // unlocking them behind the document's back would corrupt it and
    // put the time back in "unbilled", where it could be billed twice.
    const targets = invoicing ? g.entries : g.entries.filter((e) => !store.invoiceFor(e.id));
    const onInvoices = g.entries.length - targets.length;
    if (!targets.length) {
      toast('These entries are on issued invoices. Void the invoice to reopen them.', { icon: 'receipt' });
      return;
    }
    const n = targets.length;
    const noun = n === 1 ? 'entry' : 'entries';
    const ok = await confirmDialog({
      title: invoicing ? `Invoice ${g.label}?` : `Reopen ${g.label}?`,
      message: invoicing
        ? `${n} ${noun} (${fmtDuration(g.seconds)}, ${fmtMoneyList(g.amounts, store.settings.currency)}) are marked as invoiced. Their rates and currency are locked so later changes never rewrite this bill.`
        : `${n} ${noun} are marked as not invoiced. Their rates unlock and follow your current rates again.${onInvoices ? ` ${onInvoices} on issued invoices stay locked; void the invoice to reopen those.` : ''}`,
      confirmLabel: invoicing ? 'Mark invoiced' : 'Mark not invoiced',
      danger: false,
    });
    if (!ok) return;
    try {
      const changed = await store.markInvoiced(targets, invoicing);
      /* Undoing a reopen restores what each entry actually held, not a
         fresh markInvoiced: re-marking would re-freeze at today's
         resolution and quietly reprice billed history. Leaving out one of
         the locks does the same damage on its own, so the set comes from
         the store rather than being spelled out again here. */
      const undo = invoicing
        ? () => store.markInvoiced(targets, false)
        : () => store.bulkPatch(targets.map((e) => ({
          id: e.id,
          date: e.date,
          patch: invoiceLocksOf(e),
        })));
      toast(invoicing ? `Invoiced ${changed} ${noun}` : `Reopened ${changed} ${noun}`, {
        icon: 'checkCheck',
        action: {
          label: 'Undo',
          onClick: () => undo()
            .catch(() => toast('Could not undo, check your connection', { icon: 'wifiOff' })),
        },
      });
    } catch (err) {
      console.error(err);
      toast('Could not update, check your connection', { icon: 'wifiOff' });
    }
  }

  /* ---------- insights ---------- */

  /* Hand-rolled like every visual in the app: one column per month, the
     tracked total as a light tint of the accent, billable time overlaid
     in the full accent (billable is a subset of tracked, so the overlay
     reads as "how much of the bar earns"). Identity never rides on color
     alone: a legend names the two series and the whole chart carries a
     text summary. */

  const MONTH_SHORT = new Intl.DateTimeFormat(undefined, { month: 'short' });
  let insightsSeq = 0;

  async function renderInsights() {
    const seq = ++insightsSeq;
    const today = todayISO();
    const curKey = monthKeyOf(today);
    const monthKeys = Array.from({ length: 12 }, (_, i) => shiftMonth(curKey, i - 11));
    // One fetch covers both the 12-month strip and the year to date:
    // January 1 is never earlier than the strip's first month.
    const entries = await store.entriesBetween(`${monthKeys[0]}-01`, monthDays(curKey).at(-1));
    if (seq !== insightsSeq || mode !== 'insights') return;

    rangeNote.textContent = `${fmtMonth(monthKeys[0])} to ${fmtMonth(curKey)}`;

    const cur = store.settings.currency;
    const perMonth = new Map(monthKeys.map((k) => [k, { seconds: 0, billableSeconds: 0, entries: [] }]));
    for (const e of entries) {
      const m = perMonth.get(monthKeyOf(e.date));
      if (!m) continue;
      m.seconds += e.seconds;
      m.billableSeconds += store.billedSeconds(e);
      m.entries.push(e);
    }
    const maxSeconds = Math.max(...[...perMonth.values()].map((m) => m.seconds), 1);
    const twelve = store.totals(entries);

    const year = today.slice(0, 4);
    const ytdEntries = entries.filter((e) => e.date >= `${year}-01-01` && e.date <= today);
    const ytd = store.totals(ytdEntries);
    const ytdAmounts = store.amountsByCurrency(ytdEntries);
    const shares = store.groupEntries(ytdEntries, 'client').filter((g) => g.amount > 0);
    // Share bars and percentages are only honest inside one currency;
    // with several, the split falls back to billable time instead.
    const oneCurrency = new Set(shares.flatMap((g) => g.amounts.map((a) => a.currency))).size <= 1;
    const shareOf = (g) => (oneCurrency ? g.amount : g.billableSeconds);
    // Rank by the same measure the bars and percentages use, or a mixed-
    // currency split would list the rows in one order and draw them in
    // another (a long bar sitting under a short one).
    shares.sort((a, b) => shareOf(b) - shareOf(a));
    const shareTotal = shares.reduce((a, g) => a + shareOf(g), 0) || 1;
    const shareMax = Math.max(...shares.map(shareOf), 1);

    clear(insightsBody);
    insightsBody.append(
      el('h2.section-title', {}, 'Last 12 months'),
      el('div.insight-chart', {
        role: 'img',
        'aria-label': `Tracked and billable hours by month, ${fmtMonth(monthKeys[0])} to ${fmtMonth(curKey)}: `
          + `${fmtDuration(twelve.seconds)} tracked, ${fmtDuration(twelve.billableSeconds)} billable, `
          + `${fmtMoneyList(store.amountsByCurrency(entries), cur)} earned in total`,
      },
        monthKeys.map((k) => {
          const m = perMonth.get(k);
          return el('div.insight-col', {
            title: `${fmtMonth(k)}: ${fmtDuration(m.seconds)} tracked · ${fmtDuration(m.billableSeconds)} billable · ${fmtMoneyList(store.amountsByCurrency(m.entries), cur)}`,
          },
            el('span.insight-col-track', {},
              el('span.insight-bar.tracked', {
                style: { height: `${Math.max(m.seconds ? 4 : 2, Math.round((m.seconds / maxSeconds) * 100))}%` },
              }),
              m.billableSeconds > 0 && el('span.insight-bar.billable', {
                style: { height: `${Math.max(3, Math.round((m.billableSeconds / maxSeconds) * 100))}%` },
              })
            ),
            el('span.insight-col-name', {}, MONTH_SHORT.format(dateOf(`${k}-01`)))
          );
        })
      ),
      el('div.insight-legend', { 'aria-hidden': 'true' },
        el('span.insight-legend-item', {}, el('span.legend-dot.tracked', {}), 'Tracked'),
        el('span.insight-legend-item', {}, el('span.legend-dot.billable', {}), 'Billable')
      )
    );

    insightsBody.append(
      el('h2.section-title', {}, `${year} so far`),
      el('div.stat-row.stat-row-4', {},
        stat('Tracked', fmtDuration(ytd.seconds)),
        stat('Billable', fmtDuration(ytd.billableSeconds)),
        stat('Utilization', ytd.seconds > 0 ? `${Math.round((ytd.trackedBillableSeconds / ytd.seconds) * 100)}%` : '—',
          ytd.seconds > 0 && 'billable share of tracked'),
        stat('Earned', moneyValue(ytdAmounts, cur))
      )
    );

    insightsBody.append(el('h2.section-title', {}, `Earnings by client, ${year}`));
    if (!shares.length) {
      insightsBody.append(el('div.empty.empty-slim', {},
        el('p', {}, `Nothing earned in ${year} yet.`)));
    } else {
      // Native append stringifies false; only real nodes may be passed.
      if (!oneCurrency) {
        insightsBody.append(el('p.search-note', {},
          'Clients bill in different currencies, so the split below compares billable time; amounts stay per currency.'));
      }
      insightsBody.append(
        el('div.card.report-list', { role: 'list' },
          shares.map((g) => el('div.report-row', { role: 'listitem' },
            el('div.report-row-top', {},
              el('span.color-dot', { style: { background: `var(--series-${g.slot || 8})` }, 'aria-hidden': 'true' }),
              el('div.report-row-text', {},
                el('span.report-row-label', {}, g.label)
              ),
              el('div.report-row-nums', {},
                el('span.report-row-hours', {}, fmtMoneyList(g.amounts)),
                el('span.report-row-amount', {}, `${Math.round((shareOf(g) / shareTotal) * 100)}%`)
              )
            ),
            el('div.report-bar-track', { 'aria-hidden': 'true' },
              el('div.report-bar', {
                style: {
                  width: `${Math.max(2, Math.round((shareOf(g) / shareMax) * 100))}%`,
                  background: `var(--series-${g.slot || 8})`,
                },
              }))
          ))
        ));
    }
  }

  /* ---------- invoice list ---------- */

  /* Everything owed to you, in one place: what is open, what is late, and
     how late the oldest of it is, per currency (nothing here is ever
     converted or added across currencies). */
  function outstandingSummary(today) {
    const buckets = store.outstandingByCurrency(today);
    if (!buckets.length) return null;
    const openAmounts = buckets.map((b) => ({ currency: b.currency, amount: b.open }));
    const overdue = buckets.filter((b) => b.overdue > 0);
    const overdueAmounts = overdue.map((b) => ({ currency: b.currency, amount: b.overdue }));
    const oldest = buckets.map((b) => b.oldestOverdue).filter(Boolean).sort()[0] || null;
    const openCount = buckets.reduce((n, b) => n + b.count, 0);
    const overdueCount = buckets.reduce((n, b) => n + b.overdueCount, 0);
    const age = oldest ? Math.abs(daysApart(today, oldest)) : 0;
    return el('div.stat-row', {},
      stat('Open', moneyValue(openAmounts, store.settings.currency),
        `${openCount} invoice${openCount === 1 ? '' : 's'} unpaid`),
      stat('Overdue', overdueCount ? moneyValue(overdueAmounts, store.settings.currency) : '—',
        overdueCount ? `${overdueCount} past due` : 'nothing past due'),
      stat('Oldest overdue', oldest ? `${age} day${age === 1 ? '' : 's'}` : '—',
        oldest ? `due ${fmtDay(oldest, { year: true })}` : 'nothing late')
    );
  }

  /* The unbilled side of what is owed: clients holding tracked time that
     was never invoiced, oldest first, because age is what turns billable
     work into work nobody ends up paying for. */
  function readyToInvoiceSection(ready, today) {
    if (!ready.length) return null;
    const threshold = Number(store.settings.unbilledAgeDays) || 30;
    const wrap = el('div', {},
      el('h2.section-title', {}, 'Ready to invoice'),
      el('div.card.list-card', {}, ready.map((r) => {
        const stale = r.ageDays >= threshold;
        return el('div.entry-row', {},
          el('button.entry-main', {
            type: 'button',
            'aria-label': `Invoice ${r.client.name}: ${fmtDuration(r.seconds)} unbilled, oldest ${r.ageDays} days`,
            onclick: () => openInvoiceForClient(r.client),
          },
            el('span.color-dot', { style: { background: `var(--series-${r.client.slot || 8})` }, 'aria-hidden': 'true' }),
            el('div.entry-text', {},
              el('div.entry-title', {},
                r.client.name,
                // Age is the signal, so it is said in words, not colour.
                stale && el('span.chip.chip-plain.chip-partial', {}, `${r.ageDays} days old`)
              ),
              el('div.entry-sub', {},
                `${fmtDuration(r.seconds)} unbilled · oldest ${fmtDay(r.oldest, { year: true })}`
                + (r.count > 1 ? ` · newest ${fmtDay(r.newest, { year: true })}` : ''))
            ),
            el('div.entry-nums', {},
              el('div.entry-duration', {}, fmtMoney(r.amount, r.currency)),
              // How much work is waiting, which the age chip and the
              // subtitle do not say anywhere else.
              el('div.entry-amount', {}, `${r.count} ${r.count === 1 ? 'entry' : 'entries'}`)
            )
          ),
          el('button.icon-btn.entry-resume', {
            html: icon('receipt', 17, 2),
            'aria-label': `Create an invoice for ${r.client.name}`,
            title: 'Create an invoice from this time',
            onclick: () => openInvoiceForClient(r.client),
          })
        );
      }))
    );
    return wrap;
  }

  async function renderInvoices() {
    const seq = ++invoicesSeq;
    const today = todayISO();
    // Unbilled aging reads month files, so it lands when it lands; the
    // invoices themselves are already in memory and render immediately.
    const ready = await store.readyToInvoice({ now: today }).catch(() => []);
    if (seq !== invoicesSeq || mode !== 'invoices') return;
    clear(invoicesBody);
    const all = [...store.invoices].reverse();
    if (!all.length && !ready.length) {
      rangeNote.textContent = 'Issued invoices, newest first';
      invoicesBody.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('receipt', 26) }),
        el('h3', {}, 'No invoices yet'),
        el('p', {}, 'Bill unbilled time from the Report tab (group by client, set Billing to Unbilled), or start one here for a fixed fee or an expense.'),
        el('button.btn.btn-primary', { onclick: () => openNewInvoice() }, 'New invoice')
      ));
      return;
    }

    /* The line names what is actually on the screen and nothing else.
       One sentence covered three different states, so a client holding
       unbilled time and no invoice at all was told about "invoices
       waiting to be paid" directly above "No invoices issued yet" — and
       a screen about money is the last place to describe things that are
       not there. */
    const summary = outstandingSummary(today);
    const owed = [
      ready.length > 0 && 'work waiting to be billed',
      summary && 'invoices waiting to be paid',
    ].filter(Boolean);
    rangeNote.textContent = owed.length
      ? `Everything owed to you: ${owed.join(', and ')}`
      : 'Every invoice is paid';
    if (summary) invoicesBody.append(summary);
    const readySection = readyToInvoiceSection(ready, today);
    if (readySection) invoicesBody.append(readySection);
    if (!all.length) {
      invoicesBody.append(el('div.empty.empty-slim', { style: { marginTop: '14px' } },
        el('p', {}, 'No invoices issued yet. Tap a client above to bill their time.')));
      return;
    }
    invoicesBody.append(el('h2.section-title', {}, 'Invoices'));

    /* The filter row only earns its space once there is something to
       filter: one invoice needs no segmented control. */
    if (all.length > 1) {
      const seg = el('div.segmented.seg-scroll', { role: 'group', 'aria-label': 'Invoice state' });
      const renderSeg = () => {
        clear(seg);
        for (const f of INVOICE_FILTERS) {
          const count = all.filter((inv) => matchesFilter(inv, f.key, today)).length;
          seg.append(el('button', {
            type: 'button',
            className: invoiceFilter === f.key ? 'active' : '',
            'aria-pressed': invoiceFilter === f.key ? 'true' : 'false',
            disabled: count === 0 && invoiceFilter !== f.key,
            onclick: () => {
              if (invoiceFilter === f.key) return;
              invoiceFilter = f.key;
              renderInvoices().catch(console.error);
            },
          }, f.key === 'all' ? f.label : `${f.label} (${count})`));
        }
      };
      renderSeg();
      invoicesBody.append(el('div.invoice-filter-row', {}, seg));
    }

    const shown = all.filter((inv) => matchesFilter(inv, invoiceFilter, today));
    if (!shown.length) {
      invoicesBody.append(el('div.empty.empty-slim', {},
        el('p', {}, invoiceFilter === 'overdue' ? 'Nothing is past due.' : 'No invoices in this state.')));
      return;
    }

    invoicesBody.append(el('div.card.list-card', {},
      shown.map((inv) => invoiceRow(inv, today))
    ));
  }

  /* What the invoice is made of: hours, or how many manual lines when it
     bills a fixed fee or an expense instead of tracked time. */
  function invoiceSize(inv) {
    if (inv.seconds > 0) return fmtDuration(inv.seconds);
    const n = (inv.lines || []).length;
    return n ? `${n} ${n === 1 ? 'line' : 'lines'}` : '—';
  }

  function matchesFilter(inv, filter, today) {
    const state = invoiceState(inv, today);
    if (filter === 'all') return true;
    if (filter === 'paid') return state === 'paid';
    if (filter === 'overdue') return state === 'overdue';
    return state !== 'paid'; // open: everything still owed
  }

  function invoiceRow(inv, today) {
    const client = store.client(inv.clientId);
    const state = invoiceState(inv, today);
    const left = outstandingAmount(inv);
    const paid = paidAmount(inv);
    const due = dueText(inv, today);
    // The sub line answers "when" and "how much is left", in that order,
    // because that is the order the question gets asked.
    const sub = [
      `Issued ${fmtDay(inv.issueDate, { year: true })}`,
      state === 'paid' ? 'paid in full' : due,
      state === 'partial' ? `${fmtMoney(left, inv.currency)} of ${fmtMoney(inv.total, inv.currency)} left` : null,
    ].filter(Boolean).join(' · ');

    return el('div.entry-row', {},
      el('button.entry-main', {
        type: 'button',
        'aria-label': `Open invoice ${invoiceNumber(inv.number)} for ${inv.billTo.name}, ${STATE_LABEL[state].toLowerCase()}`,
        onclick: () => openInvoiceView(inv),
      },
        el('span.color-dot', { style: { background: `var(--series-${client?.slot || 8})` }, 'aria-hidden': 'true' }),
        el('div.entry-text', {},
          el('div.entry-title', {},
            `${invoiceNumber(inv.number)} · ${inv.billTo.name}`,
            // The state is spelled out, never color alone.
            state !== 'open' && el('span', {
              className: `chip chip-plain chip-${state}`,
            }, STATE_LABEL[state])
          ),
          el('div.entry-sub', {}, sub)
        ),
        el('div.entry-nums', {},
          el('div.entry-duration', {}, fmtMoney(inv.total, inv.currency)),
          el('div.entry-amount', {},
            paid > 0 && state !== 'paid' ? `${fmtMoney(left, inv.currency)} due`
              : state !== 'paid' && inv.taxRate > 0 ? `incl. ${inv.taxRate}% tax`
                : invoiceSize(inv))
        )
      ),
      // Money in is the action this list exists for, so it sits on the row
      // itself; a settled invoice offers the print it is more likely to
      // need instead.
      state === 'paid'
        ? el('button.icon-btn.entry-resume', {
          html: icon('printer', 17, 2),
          'aria-label': `Print invoice ${invoiceNumber(inv.number)}`,
          title: 'Open and print',
          onclick: () => openInvoiceView(inv),
        })
        : el('button.icon-btn.entry-resume', {
          html: icon('banknote', 17, 2),
          'aria-label': `Record a payment for invoice ${invoiceNumber(inv.number)}`,
          title: 'Record a payment',
          onclick: () => openPaymentSheet(inv),
        })
    );
  }

  function stat(label, value, sub = null) {
    return el('div.stat-tile', {},
      el('div.stat-label', {}, label),
      el('div.stat-value', {}, value),
      sub && el('div.stat-sub', {}, sub)
    );
  }

  renderModeSeg();
  renderControls();
  store.addEventListener('change', rerender);
  // applyMode rather than rerender: the view can open on any tab, and the
  // panels' hidden flags have to match the one it opened on.
  applyMode();

  root.destroy = () => store.removeEventListener('change', rerender);
  return root;
}
