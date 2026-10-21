/**
 * Sample dataset for "explore with sample data": three clients, five
 * projects, and about five weeks of realistic entries, shaped exactly like
 * an export so store.importAll() installs it, and wipes it, through the
 * normal, already-hardened path.
 */

import { uid } from './util.js';
import { monthKeyOf, addDays, todayISO } from './time.js';

export function sampleDataset(store) {
  const now = Date.now();
  const clients = [
    { id: uid(), name: 'Acme Studio', slot: 1, rate: 95, archived: false, createdAt: now },
    { id: uid(), name: 'Northwind Labs', slot: 3, rate: 120, archived: false, createdAt: now },
    { id: uid(), name: 'Internal', slot: 7, rate: null, archived: false, createdAt: now },
  ];
  const [acme, northwind, internal] = clients;

  const projects = [
    { id: uid(), clientId: acme.id, name: 'Website redesign', rate: null, billable: true, archived: false, createdAt: now },
    { id: uid(), clientId: acme.id, name: 'Brand guidelines', rate: 110, billable: true, archived: false, createdAt: now },
    { id: uid(), clientId: northwind.id, name: 'Mobile app', rate: null, billable: true, archived: false, createdAt: now },
    { id: uid(), clientId: northwind.id, name: 'API integration', rate: 140, billable: true, archived: false, createdAt: now },
    { id: uid(), clientId: internal.id, name: 'Admin and email', rate: null, billable: false, archived: false, createdAt: now },
  ];
  const [website, brand, mobile, api, admin] = projects;

  /* The gap between two blocks of a demo day, so the clock times of one
     day never overlap each other. */
  const BREAK_MINUTES = 15;

  /* A believable working week, repeated with variation over ~5 weeks.
     Weekdays only; hours land between 4.5h and 7.5h a day. */
  const patterns = [
    [ // Monday
      { p: website, task: 'Design review', h: 1.5 },
      { p: mobile, task: 'Sprint planning', h: 1 },
      { p: website, task: 'Homepage build', h: 3 },
      { p: admin, task: 'Email and invoicing', h: 0.75 },
    ],
    [ // Tuesday
      { p: mobile, task: 'Onboarding flow', h: 3.5 },
      { p: api, task: 'Webhook endpoints', h: 2 },
      { p: admin, task: 'Email and invoicing', h: 0.5 },
    ],
    [ // Wednesday
      { p: website, task: 'Homepage build', h: 2.5 },
      { p: brand, task: 'Logo refinements', h: 2 },
      { p: mobile, task: 'Client call', h: 1 },
    ],
    [ // Thursday
      { p: api, task: 'Webhook endpoints', h: 3 },
      { p: mobile, task: 'Onboarding flow', h: 2.5 },
      { p: admin, task: 'Bookkeeping', h: 1 },
    ],
    [ // Friday
      { p: website, task: 'QA and fixes', h: 2 },
      { p: brand, task: 'Typography specs', h: 1.5 },
      { p: mobile, task: 'Sprint review', h: 1 },
    ],
  ];

  const entries = {};
  const today = todayISO();
  const start = addDays(today, -34);
  for (let iso = start; iso <= today; iso = addDays(iso, 1)) {
    const d = new Date(iso + 'T12:00:00');
    const wd = d.getDay(); // 0 Sun .. 6 Sat
    if (wd === 0 || wd === 6) continue;
    const dayNum = Number(iso.slice(8, 10));
    const blocks = patterns[wd - 1];
    const dayEntries = [];
    /* Blocks run back to back from 9:00, with a short break between them.
       Slotting them at a fixed two hours apart made most demo days
       double-book themselves — a three-hour block starting at 13:00 with
       the next one at 15:00 — and the app warns about exactly that, so
       opening any sample entry met a "this overlaps..." caution about
       data the app had written itself. */
    let cursor = new Date(d);
    cursor.setHours(9, 0, 0, 0);
    for (let i = 0; i < blocks.length; i++) {
      // Skip one block on some days so weeks aren't identical.
      if ((dayNum + i) % 7 === 0) continue;
      const b = blocks[i];
      const minutes = Math.round(b.h * 60 + (((dayNum * 13 + i * 7) % 5) - 2) * 5);
      const ts = new Date(cursor);
      cursor = new Date(ts.getTime() + (minutes + BREAK_MINUTES) * 60000);
      // Older billable work has already been invoiced, so the demo shows
      // the invoiced/unbilled split with locked rates.
      const invoiced = b.p.billable && iso < addDays(today, -21);
      const clientRate = clients.find((c) => c.id === b.p.clientId)?.rate ?? 0;
      dayEntries.push({
        id: uid(),
        date: iso,
        projectId: b.p.id,
        task: b.task,
        notes: '',
        seconds: minutes * 60,
        // The demo shows clock times too, so the timer's fidelity and the
        // timesheet layouts that use it are visible without tracking a
        // day first.
        startedAt: ts.getTime(),
        endedAt: ts.getTime() + minutes * 60 * 1000,
        billable: b.p.billable,
        rate: null,
        invoicedAt: invoiced ? ts.getTime() + 7 * 86400000 : null,
        lockedRate: invoiced ? (b.p.rate ?? clientRate) : null,
        lockedRounding: invoiced ? (store.settings.rounding || 0) : null,
        // No sample client carries a minimum, so billed history froze none.
        lockedMinimum: invoiced ? 0 : null,
        // Freeze the currency like markInvoiced() would have: without it,
        // changing the global currency would rewrite "billed" history.
        lockedCurrency: invoiced ? (store.settings.currency || 'USD') : null,
        // createdAt is anchored to the entry's own day so the demo sorts
        // sensibly within a day; updatedAt is a WRITE time, which is now.
        // Anchoring it to the day too put today's later blocks ahead of the
        // clock, and newest-wins then refused every edit to them: marking
        // them invoiced or renaming them looked like it worked and quietly
        // did nothing. (importEntries already draws the same distinction.)
        createdAt: ts.getTime(),
        updatedAt: now,
      });
    }
    const key = monthKeyOf(iso);
    (entries[key] ||= []).push(...dayEntries);
  }

  return {
    app: 'hourly',
    version: 1,
    settings: { ...store.settings, sampleData: true, onboarded: true },
    clients,
    projects,
    entries,
  };
}

/** One-tap exit from sample mode: everything gone, wizard reopens. */
export async function wipeSampleData(store) {
  await store.importAll({
    app: 'hourly',
    version: 1,
    settings: { ...store.settings, sampleData: false, onboarded: false },
    clients: [],
    projects: [],
    entries: {},
  });
}
