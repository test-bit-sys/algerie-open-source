/**
 * Store tests run against a mock `puter` global backed by a Map, which is
 * also how a fresh account behaves: every key starts empty.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store, TRASH_TTL } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { probabilityOf } from '../src/lib/forecast.js';
import { todayISO, addDays } from '../src/lib/util.js';

let kvData;

function installPuterMock() {
  kvData = new Map();
  globalThis.puter = {
    env: 'web',
    kv: {
      get: vi.fn(async (k) => (kvData.has(k) ? kvData.get(k) : null)),
      set: vi.fn(async (k, v) => { kvData.set(k, v); return true; }),
    },
    fs: {
      write: vi.fn(async (path) => ({ path })),
      read: vi.fn(async () => 'bytes'),
      delete: vi.fn(async () => {}),
    },
    auth: {
      getUser: vi.fn(async () => ({ username: 'tester', uuid: 'u-1' })),
      isSignedIn: () => true,
    },
  };
}

async function freshStore() {
  const store = new Store();
  await store.init();
  return store;
}

beforeEach(installPuterMock);

describe('init', () => {
  it('seeds defaults on an empty account', async () => {
    const store = await freshStore();
    expect(store.settings.currency).toBe('USD');
    expect(store.settings.onboarded).toBe(false);
    expect(store.settings.nextStepNudges).toBe(true);
    expect(store.contacts).toEqual([]);
    expect(store.deals).toEqual([]);
    expect(store.user.username).toBe('tester');
  });

  it('reads back what a previous session wrote', async () => {
    const first = await freshStore();
    await first.addCompany({ name: 'Acme' });
    await first.updateSettings({ currency: 'EUR' });

    const second = await freshStore();
    expect(second.companies).toHaveLength(1);
    expect(second.companies[0].name).toBe('Acme');
    expect(second.settings.currency).toBe('EUR');
  });

  it('drops a corrupted collection instead of crashing every view', async () => {
    kvData.set('crm:contacts:v1', JSON.stringify({ oops: true }));
    kvData.set('crm:deals:v1', JSON.stringify('garbage'));
    kvData.set('crm:settings:v1', JSON.stringify(['not', 'an', 'object']));

    const store = await freshStore();
    expect(store.contacts).toEqual([]);
    expect(store.deals).toEqual([]);
    expect(store.settings.currency).toBe('USD');
  });

  it('survives a signed-out getUser', async () => {
    puter.auth.getUser = vi.fn(async () => { throw new Error('no session'); });
    const store = await freshStore();
    expect(store.user).toBeNull();
  });
});

describe('CRUD and lookups', () => {
  it('adds and updates a contact', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei', status: 'lead' });
    expect(store.contactById(c.id).name).toBe('Mei');
    await store.updateContact(c.id, { status: 'customer' });
    expect(store.contactById(c.id).status).toBe('customer');
  });

  it('updateContact on a missing id is a harmless null', async () => {
    const store = await freshStore();
    expect(await store.updateContact('nope', { name: 'x' })).toBeNull();
  });

  it('keeps the id and owner lookups in step with the data', async () => {
    const store = await freshStore();
    const co = await store.addCompany({ name: 'Atlas' });
    const other = await store.addCompany({ name: 'Quill' });
    const person = await store.addContact({ name: 'Dana', companyId: co.id });
    const deal = await store.addDeal({ name: 'Pilot', companyId: co.id, contactId: person.id });

    expect(store.contactsOf(co.id).map((c) => c.name)).toEqual(['Dana']);
    expect(store.dealsFor({ companyId: co.id }).map((d) => d.name)).toEqual(['Pilot']);
    expect(store.dealsFor({ contactId: person.id }).map((d) => d.name)).toEqual(['Pilot']);

    // Re-pointing, adding, and deleting all have to reach the lookups.
    await store.updateContact(person.id, { companyId: other.id });
    expect(store.contactsOf(co.id)).toEqual([]);
    expect(store.contactsOf(other.id).map((c) => c.name)).toEqual(['Dana']);

    await store.addDeal({ name: 'Second', companyId: co.id });
    expect(store.dealsFor({ companyId: co.id }).map((d) => d.name)).toEqual(['Pilot', 'Second']);

    await store.deleteDeal(deal.id);
    expect(store.dealsFor({ companyId: co.id }).map((d) => d.name)).toEqual(['Second']);
    expect(store.dealById(deal.id)).toBeNull();

    // What callers get back is theirs to sort - it must not be the index.
    const list = store.dealsFor({ companyId: co.id });
    list.push('scribble');
    expect(store.dealsFor({ companyId: co.id })).toHaveLength(1);

    // A missing or absent id is a miss, not the first record.
    expect(store.companyById(undefined)).toBeNull();
    expect(store.dealsFor({})).toEqual([]);
  });

  it('emits change on every mutation', async () => {
    const store = await freshStore();
    const seen = vi.fn();
    store.addEventListener('change', seen);
    await store.addCompany({ name: 'Acme' });
    await store.addTask({ title: 'call', due: '2026-08-10' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('deal stage lifecycle', () => {
  it('stamps closedAt when a deal moves to won and clears it on reopen', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', value: 100, stage: 'proposal' });
    expect(d.closedAt).toBeNull();

    await store.moveDeal(d.id, 'won');
    expect(store.dealById(d.id).closedAt).toBeTypeOf('number');

    await store.moveDeal(d.id, 'negotiation');
    expect(store.dealById(d.id).closedAt).toBeNull();
  });

  it('gives an old win its own close date back when a misclick is undone', async () => {
    const store = await freshStore();
    const june = Date.UTC(2026, 5, 12);
    const d = await store.addDeal({ name: 'Old win', value: 10000, stage: 'won' });
    // A deal won months ago: the reopen below clears the stamp, and moving
    // it back must restore that month rather than booking it into this one.
    Object.assign(store.dealById(d.id), { closedAt: june, stageHistory: [{ stage: 'won', at: june }] });

    await store.moveDeal(d.id, 'proposal');   // misclick on the stage stepper
    expect(store.dealById(d.id).closedAt).toBeNull();
    await store.moveDeal(d.id, 'won');        // corrected inside the undo window

    const after = store.dealById(d.id);
    expect(after.stageHistory.map((e) => e.stage)).toEqual(['won']);
    expect(after.closedAt).toBe(june);
  });

  it('stamps a genuine win with the moment it was won', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Fresh win', value: 100, stage: 'proposal' });
    const before = Date.now();
    await store.moveDeal(d.id, 'won');
    expect(store.dealById(d.id).closedAt).toBeGreaterThanOrEqual(before);
  });

  it('re-dates a win that is later corrected to a loss', async () => {
    const store = await freshStore();
    const june = Date.UTC(2026, 5, 5);
    const d = await store.addDeal({ name: 'Deal', value: 10000, stage: 'won' });
    Object.assign(store.dealById(d.id), { closedAt: june, stageHistory: [{ stage: 'won', at: june }] });

    const before = Date.now();
    await store.moveDeal(d.id, 'lost');

    const after = store.dealById(d.id);
    // The loss happened now, not in June: leaving June on it would rewrite
    // that month's win rate and hide the loss from the month it happened in.
    expect(after.closedAt).toBeGreaterThanOrEqual(before);
    expect(after.stageHistory.at(-1).stage).toBe('lost');
  });

  it('bulkMoveDeals re-dates a terminal-to-terminal correction too', async () => {
    const store = await freshStore();
    const june = Date.UTC(2026, 5, 5);
    const d = await store.addDeal({ name: 'Deal', stage: 'won' });
    Object.assign(store.dealById(d.id), { closedAt: june, stageHistory: [{ stage: 'won', at: june }] });

    const before = Date.now();
    await store.bulkMoveDeals([d.id], 'lost');
    expect(store.dealById(d.id).closedAt).toBeGreaterThanOrEqual(before);
  });

  it('keeps the original closedAt when editing an already-closed deal', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', value: 100, stage: 'won' });
    const stamp = store.dealById(d.id).closedAt;
    expect(stamp).toBeTypeOf('number');
    await store.updateDeal(d.id, { value: 200 });
    expect(store.dealById(d.id).closedAt).toBe(stamp);
  });

  it('drops the close reason when a deal is reopened', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', value: 100, stage: 'proposal' });
    await store.moveDeal(d.id, 'won');
    await store.updateDeal(d.id, { closeReason: 'Product fit', closeReasonNote: 'Trial numbers sold it' });

    await store.moveDeal(d.id, 'proposal');
    const open = store.dealById(d.id);
    expect(open.closeReason).toBe('');
    expect(open.closeReasonNote).toBe('');

    // The point of clearing it: this loss must not inherit a winning reason.
    await store.moveDeal(d.id, 'lost');
    expect(store.dealById(d.id).closeReason).toBe('');
  });

  it('keeps the close reason across an edit and a won-to-lost correction', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', value: 100, stage: 'won' });
    await store.updateDeal(d.id, { closeReason: 'Price', closeReasonNote: 'Undercut them' });

    await store.updateDeal(d.id, { value: 250 });
    expect(store.dealById(d.id).closeReason).toBe('Price');

    // Still closed, and the sheet reopens for the correction - so the
    // recorded answer stays put for the user to amend.
    await store.moveDeal(d.id, 'lost');
    expect(store.dealById(d.id).closeReason).toBe('Price');
  });

  it('bulkMoveDeals drops the close reason on reopen', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'lost' });
    await store.updateDeal(d.id, { closeReason: 'No budget' });

    await store.bulkMoveDeals([d.id], 'qualified');
    expect(store.dealById(d.id).closeReason).toBe('');
  });
});

describe('stage history', () => {
  it('starts at creation and appends every move', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'new' });
    expect(d.stageHistory).toEqual([{ stage: 'new', at: d.createdAt }]);

    // Past the undo window, so each move is its own hop.
    store.dealById(d.id).stageHistory[0].at = Date.now() - 600_000;
    await store.moveDeal(d.id, 'qualified');
    store.dealById(d.id).stageHistory[1].at -= 600_000;
    await store.moveDeal(d.id, 'won');

    expect(store.dealById(d.id).stageHistory.map((e) => e.stage))
      .toEqual(['new', 'qualified', 'won']);
  });

  it('does not log a hop for a no-op stage write', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'new' });
    await store.updateDeal(d.id, { stage: 'new', value: 10 });
    expect(store.dealById(d.id).stageHistory).toHaveLength(1);
  });

  it('rewrites the last hop when a move is undone right away', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'proposal' });
    store.dealById(d.id).stageHistory[0].at = Date.now() - 600_000;

    await store.moveDeal(d.id, 'won');
    await store.moveDeal(d.id, 'proposal');   // the Undo toast

    expect(store.dealById(d.id).stageHistory.map((e) => e.stage)).toEqual(['proposal']);
    expect(store.dealById(d.id).closedAt).toBeNull();
  });

  it('keeps every stage of a deal walked up the board in one sitting', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'new' });
    // No backdating: all three moves land inside the undo window, but none
    // of them reverses the one before it.
    await store.moveDeal(d.id, 'qualified');
    await store.moveDeal(d.id, 'proposal');
    await store.moveDeal(d.id, 'negotiation');

    expect(store.dealById(d.id).stageHistory.map((e) => e.stage))
      .toEqual(['new', 'qualified', 'proposal', 'negotiation']);
  });

  it('backfills history for deals that predate it', async () => {
    const store = await freshStore();
    const created = Date.UTC(2026, 0, 1);
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [],
      deals: [{ id: 'd1', stage: 'proposal', createdAt: created, updatedAt: created + 5 }],
      activities: [], tasks: [],
    });
    expect(store.dealById('d1').stageHistory).toEqual([{ stage: 'proposal', at: created }]);
  });

  it('repairs history that disagrees with the deal, and sorts it', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [],
      deals: [{
        id: 'd1', stage: 'negotiation', createdAt: 1000, updatedAt: 9000,
        stageHistory: [{ stage: 'qualified', at: 3000 }, null, { at: 5 }, { stage: 'new', at: 1000 }],
      }],
      activities: [], tasks: [],
    });
    expect(store.dealById('d1').stageHistory).toEqual([
      { stage: 'new', at: 1000 },
      { stage: 'qualified', at: 3000 },
      { stage: 'negotiation', at: 9000 },
    ]);
  });

  it('backfills a history-less stored deal with the stage it is leaving', async () => {
    // A deal written before the stage-history feature: present in KV with
    // no stageHistory at all. Moving it must backfill the stage it sat in
    // since creation, then record the hop - not seed the new stage at
    // createdAt, which would misdate closedAt to the day the deal was made.
    const created = Date.UTC(2026, 0, 10);
    kvData.set('crm:deals:v1', JSON.stringify([{
      id: 'd1', name: 'Legacy', value: 900, stage: 'proposal',
      createdAt: created, updatedAt: created,
    }]));
    const store = await freshStore();
    await store.moveDeal('d1', 'won');
    const after = store.dealById('d1');
    expect(after.stageHistory.map((e) => e.stage)).toEqual(['proposal', 'won']);
    expect(after.stageHistory[0].at).toBe(created);
    expect(after.closedAt).toBeGreaterThan(created);
    expect(after.closedAt).toBe(after.stageHistory.at(-1).at);
  });

  it('backfills the old stage on a bulk move of a history-less deal', async () => {
    const created = Date.UTC(2026, 0, 10);
    kvData.set('crm:deals:v1', JSON.stringify([{
      id: 'd1', name: 'Legacy', value: 900, stage: 'qualified',
      createdAt: created, updatedAt: created,
    }]));
    const store = await freshStore();
    await store.bulkMoveDeals(['d1'], 'proposal');
    expect(store.dealById('d1').stageHistory.map((e) => e.stage))
      .toEqual(['qualified', 'proposal']);
  });

  it('records the hop when removing a stage moves deals', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal', stage: 'proposal' });
    store.dealById(d.id).stageHistory[0].at = Date.now() - 600_000;
    await store.setStages(
      [{ id: 'new', label: 'New', probability: 0.1 }], { proposal: 'new' });
    expect(store.dealById(d.id).stageHistory.map((e) => e.stage)).toEqual(['proposal', 'new']);
  });
});

describe('configurable stages', () => {
  it('new deals land in the first configured stage', async () => {
    const store = await freshStore();
    expect((await store.addDeal({ name: 'A' })).stage).toBe('new');

    await store.setStages([{ id: 'scoping', label: 'Scoping', probability: 0.2 }]);
    expect(store.firstStage()).toBe('scoping');
    expect((await store.addDeal({ name: 'B' })).stage).toBe('scoping');
    expect(store.stages().map((s) => s.id)).toEqual(['scoping', 'won', 'lost']);
  });

  it('moves deals out of a removed stage, to the chosen target', async () => {
    const store = await freshStore();
    const keep = await store.addDeal({ name: 'Keep', stage: 'new' });
    const orphan = await store.addDeal({ name: 'Orphan', stage: 'proposal' });
    const closed = await store.addDeal({ name: 'Closed', stage: 'won' });

    const moved = await store.setStages(
      [{ id: 'new', label: 'New', probability: 0.1 }, { id: 'negotiation', label: 'Negotiation', probability: 0.75 }],
      { proposal: 'negotiation' });

    expect(moved).toBe(1);
    expect(store.dealById(orphan.id).stage).toBe('negotiation');
    expect(store.dealById(keep.id).stage).toBe('new');
    expect(store.dealById(closed.id).stage).toBe('won');   // terminals survive
  });

  it('falls back to the first stage when the remap target is gone too', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'D', stage: 'proposal' });
    await store.setStages([{ id: 'qualified', label: 'Qualified', probability: 0.25 }],
      { proposal: 'also-gone' });
    expect(store.dealById(d.id).stage).toBe('qualified');
  });

  it('persists the stage list and survives a reload', async () => {
    const store = await freshStore();
    await store.setStages([{ id: 'trial', label: 'Trial', probability: 0.6 }]);
    const reloaded = await freshStore();
    expect(reloaded.stages().map((s) => s.label)).toEqual(['Trial', 'Won', 'Lost']);
  });

  it('resets to the default funnel with a null list', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'D', stage: 'new' });
    await store.setStages([{ id: 'trial', label: 'Trial', probability: 0.6 }]);
    expect(store.dealById(d.id).stage).toBe('trial');      // 'new' was removed
    await store.setStages(null);
    expect(store.stages().map((s) => s.id))
      .toEqual(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
    expect(store.dealById(d.id).stage).toBe('new');
  });

  it('a removed stage takes its win-probability override with it', async () => {
    const store = await freshStore();
    const open = [
      { id: 'new', label: 'New', probability: 0.1 },
      { id: 'new-stage', label: 'Demo booked', probability: 0.5 },
    ];
    await store.setStages(open);
    await store.updateSettings({ stageProbabilities: { negotiation: 0.8, 'new-stage': 0.9 } });

    // Removing it drops the override; the surviving stage keeps its own.
    await store.setStages([open[0], { id: 'negotiation', label: 'Negotiation', probability: 0.75 }]);
    expect(store.settings.stageProbabilities).toEqual({ negotiation: 0.8 });

    // The Add button mints the same id every time, so a stage added later
    // must arrive on its own weight, not the removed one's.
    await store.setStages([open[0], { id: 'new-stage', label: 'New stage', probability: 0.5 }]);
    const deal = await store.addDeal({ name: 'D', stage: 'new-stage' });
    expect(probabilityOf(deal, store.settings.stageProbabilities, store.stages())).toBe(0.5);
  });

  it('imports map unknown stages to the first stage of the imported funnel', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1,
      settings: { stages: [{ id: 'scoping', label: 'Scoping', probability: 0.2 }] },
      companies: [], contacts: [],
      deals: [{ id: 'd1', stage: 'proposal' }, { id: 'd2', stage: 'scoping' }, { id: 'd3', stage: 'lost' }],
      activities: [], tasks: [],
    });
    expect(store.dealById('d1').stage).toBe('scoping');
    expect(store.dealById('d2').stage).toBe('scoping');
    expect(store.dealById('d3').stage).toBe('lost');
  });
});

describe('delete cascades', () => {
  it('deleting a company detaches contacts and deals but keeps them', async () => {
    const store = await freshStore();
    const co = await store.addCompany({ name: 'Acme' });
    const ct = await store.addContact({ name: 'Mei', companyId: co.id });
    const d = await store.addDeal({ name: 'Deal', companyId: co.id, contactId: ct.id });

    await store.deleteCompany(co.id);
    expect(store.companies).toHaveLength(0);
    expect(store.contactById(ct.id).companyId).toBeNull();
    expect(store.dealById(d.id).companyId).toBeNull();
    expect(store.dealById(d.id).contactId).toBe(ct.id);
  });

  it('deleting a contact detaches deals, activities, and tasks', async () => {
    const store = await freshStore();
    const ct = await store.addContact({ name: 'Mei' });
    const d = await store.addDeal({ name: 'Deal', contactId: ct.id });
    const a = await store.addActivity({ summary: 'Call', contactId: ct.id });
    const t = await store.addTask({ title: 'Follow up', contactId: ct.id });

    await store.deleteContact(ct.id);
    expect(store.contacts).toHaveLength(0);
    expect(store.dealById(d.id).contactId).toBeNull();
    expect(store.activities.find((x) => x.id === a.id).contactId).toBeNull();
    expect(store.tasks.find((x) => x.id === t.id).contactId).toBeNull();
  });

  it('deleting a deal detaches its activities and tasks', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addActivity({ summary: 'Demo', dealId: d.id });
    const t = await store.addTask({ title: 'Send docs', dealId: d.id });

    await store.deleteDeal(d.id);
    expect(store.deals).toHaveLength(0);
    expect(store.activities.find((x) => x.id === a.id).dealId).toBeNull();
    expect(store.tasks.find((x) => x.id === t.id).dealId).toBeNull();
  });
});

describe('trash and undo', () => {
  it('a deleted lead comes back with its links re-attached', async () => {
    const store = await freshStore();
    const co = await store.addCompany({ name: 'Acme' });
    const ct = await store.addContact({ name: 'Mei', companyId: co.id });
    const d = await store.addDeal({ name: 'Deal', contactId: ct.id });
    const t = await store.addTask({ title: 'Call', contactId: ct.id, due: '2026-08-10' });

    const entry = await store.deleteContact(ct.id);
    expect(entry).toMatchObject({ kind: 'contact', name: 'Mei' });
    expect(store.dealById(d.id).contactId).toBeNull();

    await store.restoreTrash(entry.id);
    expect(store.contactById(ct.id)).toMatchObject({ name: 'Mei', companyId: co.id });
    expect(store.dealById(d.id).contactId).toBe(ct.id);
    expect(store.tasks.find((x) => x.id === t.id).contactId).toBe(ct.id);
    expect(store.trash).toHaveLength(0);
  });

  it('restoring a company re-links only what is still unassigned', async () => {
    const store = await freshStore();
    const co = await store.addCompany({ name: 'Acme' });
    const other = await store.addCompany({ name: 'Other' });
    const kept = await store.addContact({ name: 'Kept', companyId: co.id });
    const moved = await store.addContact({ name: 'Moved', companyId: co.id });

    const entry = await store.deleteCompany(co.id);
    // The user re-homed one contact before hitting Undo.
    await store.updateContact(moved.id, { companyId: other.id });
    await store.restoreTrash(entry.id);

    expect(store.contactById(kept.id).companyId).toBe(co.id);
    expect(store.contactById(moved.id).companyId).toBe(other.id);
  });

  it('trashes deals, activities and follow-ups too', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addActivity({ summary: 'Call', dealId: d.id });
    const t = await store.addTask({ title: 'Ping', dealId: d.id, due: '2026-08-10' });

    const dealEntry = await store.deleteDeal(d.id);
    expect(store.deals).toHaveLength(0);
    await store.restoreTrash(dealEntry.id);
    expect(store.dealById(d.id)).toBeTruthy();
    expect(store.activities.find((x) => x.id === a.id).dealId).toBe(d.id);

    const actEntry = await store.deleteActivity(a.id);
    await store.restoreTrash(actEntry.id);
    expect(store.activities).toHaveLength(1);

    const taskEntry = await store.deleteTask(t.id);
    await store.restoreTrash(taskEntry.id);
    expect(store.tasks).toHaveLength(1);
  });

  it('deleting a missing record is a harmless null', async () => {
    const store = await freshStore();
    expect(await store.deleteDeal('nope')).toBeNull();
    expect(await store.restoreTrash('nope')).toBeNull();
    expect(store.trash).toHaveLength(0);
  });

  it('re-homes a restored deal whose stage was removed meanwhile', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Stranded', stage: 'proposal' });
    const entry = await store.deleteDeal(d.id);

    await store.setStages([
      { id: 'scoping', label: 'Scoping', probability: 0.2 },
      { id: 'closing', label: 'Closing', probability: 0.8 },
    ]);
    await store.restoreTrash(entry.id);

    const restored = store.dealById(d.id);
    expect(restored.stage).toBe('scoping');
    expect(restored.stageHistory.map((e) => e.stage)).toEqual(['proposal', 'scoping']);
    // A closed deal restores untouched - the terminals always exist.
    const won = await store.addDeal({ name: 'Won deal', stage: 'won' });
    const wonEntry = await store.deleteDeal(won.id);
    await store.restoreTrash(wonEntry.id);
    expect(store.dealById(won.id).stage).toBe('won');
  });

  it('drops entries older than the retention window on load', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei' });
    await store.deleteContact(c.id);
    const stored = JSON.parse(kvData.get('crm:trash:v1'));
    stored[0].at = Date.now() - TRASH_TTL - 1000;
    kvData.set('crm:trash:v1', JSON.stringify(stored));

    const reloaded = await freshStore();
    expect(reloaded.trash).toEqual([]);
  });

  it('empties on request', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei' });
    await store.deleteContact(c.id);
    await store.emptyTrash();
    expect(store.trash).toEqual([]);
    expect(JSON.parse(kvData.get('crm:trash:v1'))).toEqual([]);
  });
});

describe('CSV merge', () => {
  it('adds leads, links companies, and creates the ones that are new', async () => {
    const store = await freshStore();
    const acme = await store.addCompany({ name: 'Acme' });

    const result = await store.importRecords('contacts', [
      { name: 'Mei', email: 'MEI@x.example', company: 'acme', status: 'Customer' },
      { name: 'Sam', email: 'sam@x.example', company: 'Northwind' },
      { name: '', email: 'ghost@x.example' },
    ]);

    expect(result).toMatchObject({ added: 2, updated: 0, skipped: 1, companiesCreated: 1 });
    expect(store.contacts.find((c) => c.name === 'Mei').companyId).toBe(acme.id);
    expect(store.contacts.find((c) => c.name === 'Mei').status).toBe('customer');
    expect(store.companies.map((c) => c.name).sort()).toEqual(['Acme', 'Northwind']);
  });

  it('updates a lead matched by email without wiping filled fields', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei', email: 'mei@x.example', phone: '555', notes: 'Keep me' });

    const result = await store.importRecords('contacts', [
      { name: 'Mei Tanaka', email: 'Mei@X.example', phone: '', title: 'VP Ops' },
    ]);

    expect(result).toMatchObject({ added: 0, updated: 1 });
    const mei = store.contacts[0];
    expect(mei).toMatchObject({ name: 'Mei Tanaka', title: 'VP Ops', phone: '555', notes: 'Keep me' });
    expect(store.contacts).toHaveLength(1);
  });

  it('adds duplicates instead of merging when update is off', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei', email: 'mei@x.example' });
    await store.importRecords('contacts', [{ name: 'Mei', email: 'mei@x.example' }], { update: false });
    expect(store.contacts).toHaveLength(2);
  });

  it('imports deals with loose values, dates, and stage names', async () => {
    const store = await freshStore();
    const mei = await store.addContact({ name: 'Mei Tanaka' });

    await store.importRecords('deals', [
      { name: 'Acme rollout', value: '$12,500', stage: 'Proposal', company: 'Acme',
        contact: 'mei tanaka', expectedClose: '9/30/2026' },
      { name: 'No stage', value: 'tbd', stage: 'Nurture' },
    ]);

    const rollout = store.deals.find((d) => d.name === 'Acme rollout');
    expect(rollout).toMatchObject({
      value: 12500, stage: 'proposal', expectedClose: '2026-09-30', contactId: mei.id,
    });
    expect(store.companyById(rollout.companyId).name).toBe('Acme');
    expect(rollout.stageHistory).toHaveLength(1);
    // An unknown stage lands at the top of the funnel, not nowhere.
    expect(store.deals.find((d) => d.name === 'No stage')).toMatchObject({ stage: 'new', value: 0 });
  });

  it('leaves a matched deal’s stage alone when the row carries none', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', value: 1000, stage: 'won' });

    // A deals file with no Stage column mapped (and one with a blank cell).
    await store.importRecords('deals', [{ name: 'Acme rollout', value: '2000' }]);
    await store.importRecords('deals', [{ name: 'Acme rollout', stage: '' }]);

    const after = store.dealById(deal.id);
    expect(after).toMatchObject({ stage: 'won', value: 2000 });
    expect(after.closedAt).toBeGreaterThan(0);
    expect(after.stageHistory.map((e) => e.stage)).toEqual(['won']);
  });

  it('still lands a stageless new row on the first open stage', async () => {
    const store = await freshStore();
    await store.importRecords('deals', [{ name: 'Fresh' }]);
    expect(store.deals[0].stage).toBe('new');
    expect(store.deals[0].stageHistory).toEqual([{ stage: 'new', at: expect.any(Number) }]);
  });

  it('records the stage change when a re-import moves a deal', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', value: 1000, stage: 'proposal' });
    expect(deal.stageHistory).toHaveLength(1);

    await store.importRecords('deals', [{ name: 'Acme rollout', stage: 'Won' }]);
    const moved = store.dealById(deal.id);
    expect(moved.stage).toBe('won');
    expect(moved.stageHistory.map((e) => e.stage)).toEqual(['proposal', 'won']);
    // A deal closed through a spreadsheet still knows when it closed.
    expect(moved.closedAt).toBeGreaterThan(0);

    await store.importRecords('deals', [{ name: 'Acme rollout', stage: 'Negotiation' }]);
    const reopened = store.dealById(deal.id);
    expect(reopened.stage).toBe('negotiation');
    expect(reopened.closedAt).toBeNull();
  });

  it('drops the close reason when a re-import reopens a deal', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', stage: 'won' });
    await store.updateDeal(deal.id, { closeReason: 'Product fit' });

    await store.importRecords('deals', [{ name: 'Acme rollout', stage: 'Negotiation' }]);
    expect(store.dealById(deal.id).closeReason).toBe('');
  });

  it('clears the confidence override when a re-import closes a deal', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', stage: 'proposal', confidence: 0.9 });

    await store.importRecords('deals', [{ name: 'Acme rollout', stage: 'Won' }]);
    // Same invariant updateDeal and bulkMoveDeals keep: won is 1 and lost
    // is 0 forever, so a closed deal carries no override.
    expect(store.dealById(deal.id).confidence).toBeNull();
  });

  it('keeps a matched deal’s stage when the row names one it doesn’t recognize', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', value: 1000, stage: 'won' });

    // A third-party export whose stage labels don't exist in this funnel.
    await store.importRecords('deals', [{ name: 'Acme rollout', stage: 'Contract Sent', value: '2000' }]);

    const after = store.dealById(deal.id);
    expect(after).toMatchObject({ stage: 'won', value: 2000 });
    expect(after.closedAt).toBeGreaterThan(0);
    expect(after.stageHistory.map((e) => e.stage)).toEqual(['won']);
  });

  it('keeps a matched deal’s value when the money cell isn’t a number', async () => {
    const store = await freshStore();
    const deal = await store.addDeal({ name: 'Acme rollout', value: 42000 });

    // A spreadsheet with "TBD" in the Value column must not zero the deal.
    await store.importRecords('deals', [
      { name: 'Acme rollout', value: 'TBD', notes: 'Chasing budget approval' },
    ]);

    const after = store.dealById(deal.id);
    expect(after.value).toBe(42000);
    expect(after.notes).toBe('Chasing budget approval');

    // An explicit zero is a real value, not a blank.
    await store.importRecords('deals', [{ name: 'Acme rollout', value: '0' }]);
    expect(store.dealById(deal.id).value).toBe(0);
  });

  it('keeps a matched lead’s status when the row’s status is unrecognized', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Dana', email: 'dana@x.example', status: 'customer' });

    await store.importRecords('contacts', [
      { name: 'Dana', email: 'dana@x.example', status: 'VIP', title: 'CFO' },
    ]);

    expect(store.contacts[0]).toMatchObject({ status: 'customer', title: 'CFO' });
  });

  it('leaves an ambiguous contact name unlinked', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei Tanaka' });
    await store.addContact({ name: 'Mei Tanaka' });
    await store.importRecords('deals', [{ name: 'Deal', contact: 'Mei Tanaka' }]);
    expect(store.deals[0].contactId).toBeNull();
  });

  it('merges companies by name', async () => {
    const store = await freshStore();
    await store.addCompany({ name: 'Acme', industry: 'Retail' });
    const result = await store.importRecords('companies', [
      { name: 'acme', website: 'acme.example' },
      { name: 'Quill', industry: 'Software' },
    ]);
    expect(result).toMatchObject({ added: 1, updated: 1 });
    expect(store.companies[0]).toMatchObject({ industry: 'Retail', website: 'acme.example' });
  });

  it('persists what it changed and nothing else', async () => {
    const store = await freshStore();
    await store.importRecords('contacts', [{ name: 'Mei', company: 'Acme' }]);
    const reloaded = await freshStore();
    expect(reloaded.contacts).toHaveLength(1);
    expect(reloaded.companies).toHaveLength(1);
    expect(reloaded.deals).toEqual([]);
  });
});

describe('refresh', () => {
  it('picks up what another session wrote', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei' });
    // A second session appends to the same collection behind this one's back.
    const other = await freshStore();
    await other.addContact({ name: 'Sam' });

    expect(await store.refresh()).toBe(true);
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei', 'Sam']);
  });

  it('reports no change, and does not emit, when nothing moved', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei' });
    let emits = 0;
    store.addEventListener('change', () => emits++);
    expect(await store.refresh()).toBe(false);
    expect(emits).toBe(0);
  });

  it('never swaps while a write is still in flight', async () => {
    const store = await freshStore();
    // The gate exists before the write starts: the store stages the change
    // locally before it asks KV, so kv.set may not have been reached yet by
    // the time refresh is called - which is the case under test.
    let release;
    const gate = new Promise((res) => { release = res; });
    puter.kv.set = vi.fn(() => gate);
    const write = store.addContact({ name: 'Mei' });

    expect(await store.refresh()).toBe(false);
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei']);
    release(true);
    await write;
  });

  it('reclaims the file of a trash entry that aged out while the tab was open', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });
    await store.deleteAttachment(a.id);
    // The 30 days run out on a session that booted before they did.
    const stored = JSON.parse(kvData.get('crm:trash:v1'));
    stored[0].at = Date.now() - TRASH_TTL - 1000;
    kvData.set('crm:trash:v1', JSON.stringify(stored));

    expect(await store.refresh()).toBe(true);
    expect(store.trash).toEqual([]);
    // Without this the next mutation writes the shortened trash to KV and
    // the only record of the path goes with it, stranding the bytes.
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/x-a.pdf');
  });

  it('spares an aged-out entry’s file when the live manifest names it again', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });
    await store.deleteAttachment(a.id);
    const stored = JSON.parse(kvData.get('crm:trash:v1'));
    stored[0].at = Date.now() - TRASH_TTL - 1000;
    kvData.set('crm:trash:v1', JSON.stringify(stored));
    // Another session re-attached the same file to a live record.
    kvData.set('crm:attachments:v1', JSON.stringify([
      { id: 'live', name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id, uploadedAt: 1 },
    ]));

    await store.refresh();
    expect(puter.fs.delete).not.toHaveBeenCalled();
  });

  it('discards reads that raced a local mutation', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei' });
    // Reads stall until after a local mutation lands mid-refresh.
    let release;
    const gate = new Promise((res) => { release = res; });
    puter.kv.get = vi.fn(async (k) => {
      await gate;
      return kvData.has(k) ? kvData.get(k) : null;
    });
    const refreshing = store.refresh();
    await store.addTask({ title: 'Call Mei' });
    release();

    expect(await refreshing).toBe(false);
    expect(store.tasks.map((t) => t.title)).toEqual(['Call Mei']);
  });
});

describe('safety snapshot', () => {
  it('snapshots before a destructive import and restores it', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei' });
    await store.addDeal({ name: 'Real deal', value: 1000 });

    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [], contacts: [{ id: 'x', name: 'Imported' }], deals: [],
      activities: [], tasks: [],
    });
    expect(store.contacts.map((c) => c.name)).toEqual(['Imported']);
    expect(store.backup.data.contacts.map((c) => c.name)).toEqual(['Mei']);

    expect(await store.restoreBackup()).toBe(true);
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei']);
    expect(store.deals.map((d) => d.name)).toEqual(['Real deal']);
    // The restore is itself undoable.
    expect(store.backup.data.contacts.map((c) => c.name)).toEqual(['Imported']);
  });

  it('does not snapshot an empty account, and survives a reload', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [], contacts: [{ id: 'x', name: 'First' }], deals: [],
      activities: [], tasks: [],
    });
    expect(store.backup).toBeNull();
    expect(await store.restoreBackup()).toBe(false);

    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [], contacts: [], deals: [], activities: [], tasks: [],
    });
    const reloaded = await freshStore();
    expect(reloaded.backup.data.contacts.map((c) => c.name)).toEqual(['First']);
  });

  it('snapshots an account that holds nothing but templates', async () => {
    const store = await freshStore();
    await store.addTemplate({ name: 'Intro', subject: 'Hello', body: 'Hi there' });

    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [], contacts: [], deals: [], activities: [], tasks: [],
    });
    // Templates are authored work too - replacing them must be undoable.
    expect(store.templates).toEqual([]);
    expect(store.backup.data.templates.map((t) => t.name)).toEqual(['Intro']);
    expect(await store.restoreBackup()).toBe(true);
    expect(store.templates.map((t) => t.name)).toEqual(['Intro']);
  });

  it('undoes a CSV merge, which edits the live collections in place', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei Tanaka', email: 'mei@acme.test', phone: '555' });

    await store.saveSnapshot('csv');
    await store.importRecords('contacts', [
      { name: 'Mei Tanaka', email: 'mei@acme.test', phone: '999' },
      { name: 'Sam Okafor', email: 'sam@quill.test' },
    ]);
    expect(store.contacts).toHaveLength(2);

    expect(await store.restoreBackup()).toBe(true);
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei Tanaka']);
    // The in-place update to the matched row is rolled back too.
    expect(store.contacts[0].phone).toBe('555');
  });
});

describe('queries', () => {
  it('activitiesFor filters by link and sorts newest first', async () => {
    const store = await freshStore();
    const ct = await store.addContact({ name: 'Mei' });
    await store.addActivity({ summary: 'Old', contactId: ct.id, date: '2026-07-01' });
    await store.addActivity({ summary: 'New', contactId: ct.id, date: '2026-08-01' });
    await store.addActivity({ summary: 'Other person', contactId: 'someone-else', date: '2026-09-01' });

    const rows = store.activitiesFor({ contactId: ct.id });
    expect(rows.map((r) => r.summary)).toEqual(['New', 'Old']);
  });

  it('openTasks excludes done and sorts by due date', async () => {
    const store = await freshStore();
    await store.addTask({ title: 'B', due: '2026-08-20' });
    await store.addTask({ title: 'A', due: '2026-08-05' });
    const done = await store.addTask({ title: 'C', due: '2026-08-01' });
    await store.toggleTask(done.id, true);

    expect(store.openTasks().map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('sorts timed follow-ups ahead of untimed ones on the same day', async () => {
    const store = await freshStore();
    await store.addTask({ title: 'Sometime', due: '2026-08-10' });
    await store.addTask({ title: 'Afternoon', due: '2026-08-10', dueTime: '14:00' });
    await store.addTask({ title: 'Morning', due: '2026-08-10', dueTime: '09:00' });
    await store.addTask({ title: 'Tomorrow', due: '2026-08-11', dueTime: '08:00' });

    expect(store.openTasks().map((t) => t.title))
      .toEqual(['Morning', 'Afternoon', 'Sometime', 'Tomorrow']);
  });

  it('keeps only real clock times on import', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [], deals: [],
      activities: [],
      tasks: [
        { id: 'a', due: '2026-08-10', dueTime: '09:30' },
        { id: 'b', due: '2026-08-10', dueTime: '25:00' },
        { id: 'c', due: '2026-08-10', dueTime: 'lunchtime' },
      ],
    });
    expect(store.tasks.map((t) => t.dueTime)).toEqual(['09:30', '', '']);
  });

  it('toggleTask stamps and clears doneAt', async () => {
    const store = await freshStore();
    const t = await store.addTask({ title: 'X', due: '2026-08-05' });
    await store.toggleTask(t.id, true);
    expect(store.tasks[0].done).toBe(true);
    expect(store.tasks[0].doneAt).toBeTypeOf('number');
    await store.toggleTask(t.id, false);
    expect(store.tasks[0].doneAt).toBeNull();
  });

  it('completing a repeating follow-up mints the next occurrence from today', async () => {
    const store = await freshStore();
    const t = await store.addTask({
      title: 'Monthly check-in', due: '2020-01-15', dueTime: '10:00',
      contactId: 'ct-1', repeat: { every: 2, unit: 'week' },
    });
    await store.toggleTask(t.id, true);

    expect(store.tasks).toHaveLength(2);
    const done = store.tasks.find((x) => x.id === t.id);
    const next = store.tasks.find((x) => x.id !== t.id);
    expect(done.done).toBe(true);
    expect(done.spawnedId).toBe(next.id);
    // Due counts from the completion day, not the (long overdue) due date.
    expect(next.due).toBe(addDays(todayISO(), 14));
    expect(next.done).toBe(false);
    expect(next.dueTime).toBe('10:00');
    expect(next.contactId).toBe('ct-1');
    expect(next.repeat).toEqual({ every: 2, unit: 'week' });
  });

  it('carries the email a repeating step stands for into the next occurrence', async () => {
    const store = await freshStore();
    const t = await store.addTask({
      title: 'Send the check-in', contactId: 'ct-1', templateId: 'tpl-1',
      repeat: { every: 1, unit: 'month' },
    });
    await store.toggleTask(t.id, true);
    const next = store.tasks.find((x) => x.id !== t.id);
    expect(next.templateId).toBe('tpl-1');
  });

  it('unchecking a repeating follow-up takes its untouched next occurrence back', async () => {
    const store = await freshStore();
    const t = await store.addTask({ title: 'Ping', repeat: { every: 1, unit: 'day' } });
    await store.toggleTask(t.id, true);
    expect(store.tasks).toHaveLength(2);

    await store.toggleTask(t.id, false);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].id).toBe(t.id);
    expect(store.tasks[0].spawnedId).toBeNull();
  });

  it('unchecking leaves a next occurrence alone once it was completed itself', async () => {
    const store = await freshStore();
    const t = await store.addTask({ title: 'Ping', repeat: { every: 1, unit: 'day' } });
    const done = await store.toggleTask(t.id, true);
    await store.toggleTask(done.spawnedId, true);

    await store.toggleTask(t.id, false);
    expect(store.tasks).toHaveLength(3);   // original + completed next + its own next
  });

  it('drops malformed repeat rules on import', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [], deals: [],
      activities: [],
      tasks: [
        { id: 'a', due: '2026-08-10', repeat: { every: 3, unit: 'month' } },
        { id: 'b', due: '2026-08-10', repeat: { every: 0, unit: 'week' } },
        { id: 'c', due: '2026-08-10', repeat: { every: 2, unit: 'fortnight' } },
        { id: 'd', due: '2026-08-10', repeat: 'weekly' },
      ],
    });
    expect(store.tasks.map((t) => t.repeat)).toEqual([
      { every: 3, unit: 'month' }, null, null, null,
    ]);
  });
});

describe('deal confidence', () => {
  it('clears the override when a deal closes, from any path', async () => {
    const store = await freshStore();
    const a = await store.addDeal({ name: 'A', stage: 'proposal', confidence: 0.9 });
    await store.moveDeal(a.id, 'won');
    expect(store.dealById(a.id).confidence).toBeNull();

    const b = await store.addDeal({ name: 'B', stage: 'proposal', confidence: 0.7 });
    await store.bulkMoveDeals([b.id], 'lost');
    expect(store.dealById(b.id).confidence).toBeNull();
  });

  it('creating a deal already closed carries no confidence', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Old win', stage: 'won', confidence: 0.9 });
    expect(d.confidence).toBeNull();
  });

  it('normalizes confidence on import: clamped, junk dropped, closed cleared', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [],
      activities: [], tasks: [],
      deals: [
        { id: 'a', name: 'A', stage: 'proposal', confidence: 0.7 },
        { id: 'b', name: 'B', stage: 'proposal', confidence: 9 },
        { id: 'c', name: 'C', stage: 'proposal', confidence: 'high' },
        { id: 'd', name: 'D', stage: 'won', confidence: 0.5 },
      ],
    });
    expect(store.deals.map((d) => d.confidence)).toEqual([0.7, 1, null, null]);
  });
});

describe('saved views', () => {
  const view = { id: 'v1', name: 'Cold leads', filters: { status: 'cold', tags: ['vip'] } };

  it('stores a filter set per list and reads it back', async () => {
    const store = await freshStore();
    expect(store.views('contacts')).toEqual([]);
    await store.setViews('contacts', [view]);
    expect(store.views('contacts')[0]).toMatchObject({ name: 'Cold leads' });
    expect(store.views('deals')).toEqual([]);

    const reread = await freshStore();
    expect(reread.views('contacts')[0].filters).toMatchObject({ status: 'cold', tags: ['vip'] });
  });

  it('ignores a list that has no views', async () => {
    const store = await freshStore();
    expect(await store.setViews('activities', [view])).toEqual([]);
    expect(store.settings.views?.activities).toBeUndefined();
  });

  it('caps a list, and keeps one default', async () => {
    const store = await freshStore();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...view, id: `v${i}`, default: true }));
    const saved = await store.setViews('contacts', many);
    expect(saved).toHaveLength(6);
    expect(saved.filter((v) => v.default)).toHaveLength(1);
  });

  it('carries views through export and import', async () => {
    const store = await freshStore();
    await store.setViews('deals', [{ id: 'd1', name: 'This quarter', filters: { closeWindow: 'quarter' } }]);
    const data = JSON.parse(JSON.stringify(store.exportAll()));
    const other = await freshStore();
    await other.importAll(data);
    expect(other.views('deals')[0].name).toBe('This quarter');
  });
});

describe('working offline', () => {
  /** A store whose outbox we can see, over storage we can keep. */
  async function offlineStore(storage = memoryStorage()) {
    const store = new Store();
    store.useOutbox(createOutbox({
      storage,
      kv: { get: (k) => puter.kv.get(k), set: (k, v) => puter.kv.set(k, v) },
    }));
    await store.init();
    return { store, storage };
  }

  const goOffline = () => {
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    puter.kv.get = vi.fn(async () => { throw new Error('offline'); });
  };

  it('queues a write KV refuses instead of losing it', async () => {
    const { store } = await offlineStore();
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });

    // The save resolves: the record is safe locally, which is the truth.
    const contact = await store.addContact({ name: 'Mei' });
    expect(contact.name).toBe('Mei');
    expect(store.contacts).toHaveLength(1);
    expect(store.offline).toMatchObject({ offline: true, queued: 1 });
    expect(await store.pendingWrites()).toEqual([
      { key: 'crm:contacts:v1', at: expect.any(Number), conflict: false },
    ]);
  });

  it('replays the queue when the connection returns', async () => {
    const { store } = await offlineStore();
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    await store.addContact({ name: 'Mei' });
    await store.addDeal({ name: 'Rollout' });

    puter.kv.set = vi.fn(async (k, v) => { kvData.set(k, v); return true; });
    const result = await store.syncNow();
    expect(result.synced.sort()).toEqual(['crm:contacts:v1', 'crm:deals:v1']);
    expect(store.offline).toMatchObject({ offline: false, queued: 0 });
    expect(JSON.parse(kvData.get('crm:contacts:v1'))[0].name).toBe('Mei');
  });

  it('reads back what was written offline, on a cold start', async () => {
    const storage = memoryStorage();
    const { store } = await offlineStore(storage);
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    await store.addActivity({ summary: 'Logged the call' });

    // A reload with the network still down: KV has nothing, the device does.
    goOffline();
    const { store: reloaded } = await offlineStore(storage);
    expect(reloaded.activities.map((a) => a.summary)).toEqual(['Logged the call']);
    expect(reloaded.offline.offline).toBe(true);
    expect(reloaded.outbox().hasPending()).toBe(true);
  });

  it('never swaps remote data in over a queued write', async () => {
    const { store } = await offlineStore();
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    await store.addContact({ name: 'Mei' });

    // KV is answering reads again, and knows nothing about Mei.
    puter.kv.set = vi.fn(async (k, v) => { kvData.set(k, v); return true; });
    expect(await store.refresh()).toBe(false);
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei']);
  });

  it('holds a write back rather than overwriting another device, and asks', async () => {
    const { store } = await offlineStore();
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    await store.addContact({ name: 'Mei' });

    // Another device wrote the same collection while this one was away.
    puter.kv.set = vi.fn(async (k, v) => { kvData.set(k, v); return true; });
    kvData.set('crm:contacts:v1', JSON.stringify([{ id: 'x', name: 'Sam' }]));

    const result = await store.syncNow();
    expect(result.conflicts).toEqual(['crm:contacts:v1']);
    expect(store.offline.conflicts).toBe(1);
    // KV answered - it just answered with something else. Saying "offline"
    // here would be the indicator's one job done wrong.
    expect(store.offline.offline).toBe(false);
    // Nothing was overwritten, and this device still shows its own work.
    expect(JSON.parse(kvData.get('crm:contacts:v1'))[0].name).toBe('Sam');
    expect(store.contacts.map((c) => c.name)).toEqual(['Mei']);

    expect(await store.resolveConflict('crm:contacts:v1', 'mine')).toBe(true);
    expect(JSON.parse(kvData.get('crm:contacts:v1'))[0].name).toBe('Mei');
    expect(store.offline.conflicts).toBe(0);
  });

  it('can take the other version instead', async () => {
    const { store } = await offlineStore();
    puter.kv.set = vi.fn(async () => { throw new Error('offline'); });
    await store.addContact({ name: 'Mei' });
    puter.kv.set = vi.fn(async (k, v) => { kvData.set(k, v); return true; });
    kvData.set('crm:contacts:v1', JSON.stringify([{ id: 'x', name: 'Sam' }]));
    await store.syncNow();

    expect(await store.resolveConflict('crm:contacts:v1', 'theirs')).toBe(true);
    expect(store.contacts.map((c) => c.name)).toEqual(['Sam']);
    expect(store.offline.queued).toBe(0);
  });
});

describe('playbooks', () => {
  const book = {
    id: 'pb1', name: 'Proposal chase', trigger: 'proposal',
    steps: [
      { title: 'Recap', offset: 0, templateId: 't1' },
      { title: 'Nudge', offset: 3 },
    ],
  };

  it('stores and reads back the saved cadences', async () => {
    const store = await freshStore();
    expect(store.playbooks()).toEqual([]);
    await store.setPlaybooks([book]);
    expect(store.playbooks()).toHaveLength(1);

    const reread = await freshStore();
    expect(reread.playbooks()[0].name).toBe('Proposal chase');
  });

  it('applies one as plain follow-ups, in one write', async () => {
    const store = await freshStore();
    const contact = await store.addContact({ name: 'Mei' });
    const deal = await store.addDeal({ name: 'Rollout', contactId: contact.id });

    const created = await store.applyPlaybook(book, {
      contactId: contact.id, dealId: deal.id, from: '2026-08-20',
    });
    expect(created.map((t) => [t.title, t.due])).toEqual([
      ['Recap', '2026-08-20'], ['Nudge', '2026-08-23'],
    ]);
    expect(created[0].templateId).toBe('t1');
    expect(created[1].templateId).toBeNull();
    // Plain follow-ups: linked, editable, and nothing pointing back at the
    // playbook that made them.
    expect(store.tasksFor({ dealId: deal.id })).toHaveLength(2);
    expect(created[0].dealId).toBe(deal.id);
    expect(created[0].contactId).toBe(contact.id);
  });

  it('takes the whole application back in one undo, without filling the trash', async () => {
    const store = await freshStore();
    const created = await store.applyPlaybook(book, { from: '2026-08-20' });
    const removed = await store.undoAddedTasks(created.map((t) => t.id));
    expect(removed).toBe(2);
    expect(store.tasks).toEqual([]);
    expect(store.trash).toEqual([]);
  });

  it('does nothing for a playbook with no steps', async () => {
    const store = await freshStore();
    expect(await store.applyPlaybook({ ...book, steps: [] })).toEqual([]);
    expect(store.tasks).toEqual([]);
    expect(await store.undoAddedTasks(['nope'])).toBe(0);
  });

  it('carries playbooks and a follow-up’s template through export/import', async () => {
    const store = await freshStore();
    await store.setPlaybooks([book]);
    await store.applyPlaybook(book, { from: '2026-08-20' });
    const data = JSON.parse(JSON.stringify(store.exportAll()));

    const other = await freshStore();
    await other.importAll(data);
    expect(other.playbooks()).toHaveLength(1);
    expect(other.tasks.find((t) => t.title === 'Recap').templateId).toBe('t1');
  });
});

describe('the people on a deal', () => {
  async function withPeople() {
    const store = await freshStore();
    const mei = await store.addContact({ name: 'Mei' });
    const tom = await store.addContact({ name: 'Tom' });
    const deal = await store.addDeal({
      name: 'Rollout', contactId: mei.id,
      contacts: [{ contactId: mei.id, role: 'champion' }, { contactId: tom.id, role: 'decision-maker' }],
    });
    return { store, mei, tom, deal };
  }

  it('keeps the primary contact as the first entry', async () => {
    const { store, mei, deal } = await withPeople();
    expect(store.dealById(deal.id).contactId).toBe(mei.id);
    expect(store.dealById(deal.id).contacts).toHaveLength(2);
  });

  it('gives an old single-contact deal a one-entry list', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Solo' });
    const d = await store.addDeal({ name: 'One', contactId: c.id });
    expect(d.contacts).toEqual([{ contactId: c.id, role: '' }]);

    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], activities: [], tasks: [],
      contacts: [{ id: 'c9', name: 'Old' }],
      deals: [{ id: 'd9', name: 'Legacy', stage: 'proposal', contactId: 'c9' }],
    });
    expect(store.deals[0].contacts).toEqual([{ contactId: 'c9', role: '' }]);
  });

  it('swapping the primary keeps the other people', async () => {
    const { store, tom, deal } = await withPeople();
    const other = await store.addContact({ name: 'Nia' });
    await store.updateDeal(deal.id, { contactId: other.id });
    const after = store.dealById(deal.id);
    expect(after.contactId).toBe(other.id);
    expect(after.contacts.map((e) => e.contactId)).toEqual([other.id, tom.id]);
  });

  it('deleting a contact takes them off the deal and promotes the next', async () => {
    const { store, mei, tom, deal } = await withPeople();
    const entry = await store.deleteContact(mei.id);
    const after = store.dealById(deal.id);
    expect(after.contacts.map((e) => e.contactId)).toEqual([tom.id]);
    expect(after.contactId).toBe(tom.id);

    // Restoring puts them back on the deal, without demoting the new primary.
    await store.restoreTrash(entry.id);
    const restored = store.dealById(deal.id);
    expect(restored.contactId).toBe(tom.id);
    expect(restored.contacts.map((e) => e.contactId).sort()).toEqual([mei.id, tom.id].sort());
  });

  it('a bulk contact delete detaches them from every deal', async () => {
    const { store, mei, tom, deal } = await withPeople();
    await store.bulkDelete('contacts', [mei.id, tom.id]);
    const after = store.dealById(deal.id);
    expect(after.contacts).toEqual([]);
    expect(after.contactId).toBeNull();
  });

  it('merging two contacts leaves one entry on the deal', async () => {
    const { store, mei, tom, deal } = await withPeople();
    await store.mergeContacts(mei.id, tom.id);
    const after = store.dealById(deal.id);
    expect(after.contacts).toEqual([{ contactId: mei.id, role: 'champion' }]);
    expect(after.contactId).toBe(mei.id);
  });

  it('lists a deal on every person who is on it', async () => {
    const { store, tom, deal } = await withPeople();
    expect(store.dealsFor({ contactId: tom.id }).map((d) => d.id)).toEqual([deal.id]);
  });

  it('reads the freshest touch across all of the deal’s people', async () => {
    const { store, mei, tom, deal } = await withPeople();
    await store.addActivity({ summary: 'Old', date: '2026-01-01', contactId: mei.id });
    await store.addActivity({ summary: 'New', date: '2026-06-01', contactId: tom.id });
    expect(store.lastTouchedDeal(store.dealById(deal.id))).toBe('2026-06-01');
  });

  it('shows unfiled activity from a person, but not another deal’s', async () => {
    const { store, tom, deal } = await withPeople();
    const other = await store.addDeal({ name: 'Different' });
    await store.addActivity({ summary: 'Own', date: '2026-05-01', dealId: deal.id });
    await store.addActivity({ summary: 'Via Tom', date: '2026-05-02', contactId: tom.id });
    await store.addActivity({ summary: 'Other deal', date: '2026-05-03', contactId: tom.id, dealId: other.id });

    expect(store.dealActivities(store.dealById(deal.id)).map((a) => a.summary))
      .toEqual(['Via Tom', 'Own']);
  });
});

describe('custom fields', () => {
  const seats = { id: 'seats', name: 'Seats', type: 'number' };
  const plan = { id: 'plan', name: 'Plan', type: 'select', options: ['Pro', 'Team'] };

  it('starts with none, and stores definitions per record type', async () => {
    const store = await freshStore();
    expect(store.customFields('contacts')).toEqual([]);
    await store.setCustomFields('contacts', [seats, plan]);
    expect(store.customFields('contacts').map((f) => f.id)).toEqual(['seats', 'plan']);
    expect(store.customFields('deals')).toEqual([]);

    const reread = await freshStore();
    expect(reread.customFields('contacts')).toHaveLength(2);
  });

  it('ignores a record type that cannot carry fields', async () => {
    const store = await freshStore();
    expect(await store.setCustomFields('activities', [seats])).toEqual({ removed: 0, converted: 0 });
    expect(store.customFields('activities')).toEqual([]);
  });

  it('keeps values on the record, blanks dropped', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [seats, plan]);
    const c = await store.addContact({ name: 'Mei', custom: { seats: 40, plan: '', ghost: null } });
    expect(c.custom).toEqual({ seats: 40 });

    await store.updateContact(c.id, { custom: { seats: 45, plan: 'Pro' } });
    expect(store.contactById(c.id).custom).toEqual({ seats: 45, plan: 'Pro' });
  });

  it('drops the values of a removed field, and reports how many', async () => {
    const store = await freshStore();
    await store.setCustomFields('deals', [seats]);
    await store.addDeal({ name: 'A', custom: { seats: 10 } });
    await store.addDeal({ name: 'B', custom: { seats: 20 } });
    await store.addDeal({ name: 'C' });

    const result = await store.setCustomFields('deals', []);
    expect(result.removed).toBe(2);
    expect(store.deals.every((d) => !Object.keys(d.custom).length)).toBe(true);
  });

  it('converts stored values when a type changes', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [{ id: 'seats', name: 'Seats', type: 'text' }]);
    const c = await store.addContact({ name: 'Mei', custom: { seats: '40' } });

    const result = await store.setCustomFields('contacts', [seats]);
    expect(result.converted).toBe(1);
    expect(store.contactById(c.id).custom.seats).toBe(40);
  });

  it('refuses a type change that would throw a value away', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [{ id: 'seats', name: 'Seats', type: 'text' }]);
    const c = await store.addContact({ name: 'Mei', custom: { seats: 'a few' } });

    await expect(store.setCustomFields('contacts', [seats]))
      .rejects.toThrow('custom-field-type');
    // Nothing moved: the definition and the value both stand.
    expect(store.customFields('contacts')[0].type).toBe('text');
    expect(store.contactById(c.id).custom.seats).toBe('a few');
  });

  it('carries values through export and import', async () => {
    const store = await freshStore();
    await store.setCustomFields('companies', [plan]);
    await store.addCompany({ name: 'Acme', custom: { plan: 'Team' } });
    const data = JSON.parse(JSON.stringify(store.exportAll()));

    const other = await freshStore();
    await other.importAll(data);
    expect(other.customFields('companies').map((f) => f.id)).toEqual(['plan']);
    expect(other.companies[0].custom).toEqual({ plan: 'Team' });
  });

  it('drops junk values on import rather than storing them', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1,
      settings: { customFields: { contacts: [plan] } },
      companies: [], deals: [], activities: [], tasks: [],
      contacts: [{ id: 'c1', name: 'Mei', custom: { plan: 'Pro', bad: { deep: 1 }, blank: '' } }],
    });
    expect(store.contacts[0].custom).toEqual({ plan: 'Pro' });
  });

  it('brings a deleted record’s values back with it', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [plan]);
    const c = await store.addContact({ name: 'Mei', custom: { plan: 'Pro' } });
    const entry = await store.deleteContact(c.id);
    await store.restoreTrash(entry.id);
    expect(store.contacts[0].custom).toEqual({ plan: 'Pro' });
  });

  it('fills the survivor’s blanks from a merged-away record', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [plan, seats]);
    const keep = await store.addContact({ name: 'Mei', email: 'a@x.example', custom: { plan: 'Pro' } });
    const dupe = await store.addContact({ name: 'Mei T', email: 'b@x.example', custom: { plan: 'Team', seats: 12 } });

    await store.mergeContacts(keep.id, dupe.id);
    // Its own answer stands; the one only the duplicate had is kept.
    expect(store.contactById(keep.id).custom).toEqual({ plan: 'Pro', seats: 12 });
  });

  it('imports custom columns from a spreadsheet, by field name', async () => {
    const store = await freshStore();
    await store.setCustomFields('contacts', [
      plan, seats, { id: 'nl', name: 'Newsletter', type: 'checkbox' },
    ]);
    await store.importRecords('contacts', [
      { name: 'Mei', email: 'mei@x.example', 'custom:plan': 'Pro', 'custom:seats': '40', 'custom:nl': 'yes' },
      { name: 'Sam', email: 'sam@x.example', 'custom:plan': '', 'custom:seats': 'n/a' },
    ]);
    expect(store.contacts[0].custom).toEqual({ plan: 'Pro', seats: 40, nl: true });
    // A blank or unreadable cell stores nothing rather than a guess.
    expect(store.contacts[1].custom).toEqual({});

    // A re-import with no custom columns leaves the values alone.
    await store.importRecords('contacts', [{ name: 'Mei Tanaka', email: 'mei@x.example' }]);
    expect(store.contacts[0].custom).toEqual({ plan: 'Pro', seats: 40, nl: true });
  });
});

describe('deal billing', () => {
  it('defaults a new deal to one-time with no term', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'One and done', value: 5000 });
    expect(d.billing).toBe('one-time');
    expect(d.term).toBeNull();
  });

  it('gives a recurring deal a default term and keeps a named one', async () => {
    const store = await freshStore();
    const a = await store.addDeal({ name: 'Sub', value: 2000, billing: 'monthly' });
    expect(a.term).toBe(12);
    const b = await store.addDeal({ name: 'Pilot', value: 2000, billing: 'monthly', term: 6 });
    expect(b.term).toBe(6);
  });

  it('drops the term when a deal goes back to one-time', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Sub', value: 2000, billing: 'monthly', term: 24 });
    await store.updateDeal(d.id, { billing: 'one-time' });
    expect(store.dealById(d.id)).toMatchObject({ billing: 'one-time', term: null });
  });

  it('normalizes billing on import: junk reads as one-time, terms clamp', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [],
      activities: [], tasks: [],
      deals: [
        { id: 'a', name: 'A', stage: 'proposal', value: 100, billing: 'monthly', term: 6 },
        { id: 'b', name: 'B', stage: 'proposal', value: 100, billing: 'quarterly', term: 3 },
        { id: 'c', name: 'C', stage: 'proposal', value: 100, billing: 'annual', term: 999 },
        { id: 'd', name: 'D', stage: 'proposal', value: 100 },
      ],
    });
    expect(store.deals.map((d) => [d.billing, d.term])).toEqual([
      ['monthly', 6], ['one-time', null], ['annual', 120], ['one-time', null],
    ]);
  });

  it('imports billing and term from a spreadsheet, and keeps them on a re-import', async () => {
    const store = await freshStore();
    await store.importRecords('deals', [
      { name: 'Acme subscription', value: '$2,000', billing: 'per month', term: '18' },
      { name: 'Atlas licence', value: '12000', billing: 'Yearly', term: '2 years' },
      { name: 'One off', value: '500', billing: '', term: '' },
    ]);
    expect(store.deals.map((d) => [d.name, d.billing, d.term])).toEqual([
      ['Acme subscription', 'monthly', 18],
      ['Atlas licence', 'annual', 24],
      ['One off', 'one-time', null],
    ]);

    // A file with no Billing column must not turn subscriptions into
    // one-time sales.
    await store.importRecords('deals', [{ name: 'Acme subscription', value: '2500' }]);
    expect(store.deals[0]).toMatchObject({ billing: 'monthly', term: 18, value: 2500 });
  });

  it('gives a deal switched to monthly by a spreadsheet the default term', async () => {
    const store = await freshStore();
    await store.addDeal({ name: 'Acme', value: 1000 });
    await store.importRecords('deals', [{ name: 'Acme', billing: 'monthly' }]);
    expect(store.deals[0]).toMatchObject({ billing: 'monthly', term: 12 });
  });
});

describe('attachments', () => {
  it('stores metadata, lists per record newest first, and rides the export', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a1 = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', size: 100, dealId: d.id, uploadedAt: 1 });
    const a2 = await store.addAttachment({ name: 'b.pdf', path: 'attachments/x-b.pdf', size: 200, dealId: d.id, uploadedAt: 2 });
    await store.addAttachment({ name: 'other.pdf', path: 'attachments/x-o.pdf', contactId: 'someone' });

    expect(store.attachmentsFor({ dealId: d.id }).map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(store.exportAll().attachments).toHaveLength(3);
  });

  it('delete goes to the trash keeping the file; restore brings it back', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });

    const entry = await store.deleteAttachment(a.id);
    expect(store.attachments).toHaveLength(0);
    expect(entry.kind).toBe('attachment');
    expect(puter.fs.delete).not.toHaveBeenCalled();   // restorable = file stays

    await store.restoreTrash(entry.id);
    expect(store.attachments).toHaveLength(1);
  });

  it('emptying the trash reclaims the stored bytes of attachment entries', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });
    await store.deleteAttachment(a.id);

    await store.emptyTrash();
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/x-a.pdf');
  });

  it('spares a stored file the live manifest points at again', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });
    await store.saveSnapshot('csv');            // the snapshot holds the manifest
    await store.deleteAttachment(a.id);         // the trash entry holds the path
    await store.restoreBackup();                // and now the record is live again

    expect(store.attachments.map((x) => x.path)).toEqual(['attachments/x-a.pdf']);
    // Same file named twice: once live, once by the delete's trash entry.
    // Emptying the trash must not take the bytes out from under the live one.
    await store.emptyTrash();
    expect(puter.fs.delete).not.toHaveBeenCalled();

    // Once nothing else answers for it, it goes.
    const again = await store.deleteAttachment(store.attachments[0].id);
    expect(again).not.toBeNull();
    await store.emptyTrash();
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/x-a.pdf');
  });

  it('an expired attachment trash entry takes its file with it at boot', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    const a = await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-old.pdf', dealId: d.id });
    await store.deleteAttachment(a.id);
    // Age the entry past the TTL by editing what KV holds.
    const trash = JSON.parse(kvData.get('crm:trash:v1'));
    trash[0].at = Date.now() - TRASH_TTL - 1000;
    kvData.set('crm:trash:v1', JSON.stringify(trash));

    const second = await freshStore();
    expect(second.trash).toHaveLength(0);
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/x-old.pdf');
  });

  it('purges attachments whose owner is gone from both live data and trash', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'kept.pdf', path: 'attachments/kept.pdf', dealId: d.id });
    await store.addAttachment({ name: 'orphan.pdf', path: 'attachments/orphan.pdf', dealId: 'gone-forever' });

    const second = await freshStore();
    expect(second.attachments.map((a) => a.name)).toEqual(['kept.pdf']);
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/orphan.pdf');
  });

  it('the orphan purge spares a file the safety snapshot can still restore', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/x-a.pdf', dealId: d.id });
    await store.saveSnapshot('csv');       // the snapshot holds the deal and the file
    await store.deleteDeal(d.id);
    await store.emptyTrash();              // the owner is gone for good

    // Boot: the attachment is an orphan and leaves the live manifest - but
    // "Restore previous data" would bring it and its owner straight back,
    // so the bytes have to still be there when it does.
    const second = await freshStore();
    expect(second.attachments).toHaveLength(0);
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/x-a.pdf');

    await second.restoreBackup();
    expect(second.attachments.map((a) => a.path)).toEqual(['attachments/x-a.pdf']);
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/x-a.pdf');
  });

  it('an imported manifest cannot point the purge at a file outside attachments/', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, contacts: [], companies: [], deals: [],
      activities: [], tasks: [], templates: [],
      attachments: [
        // Owner ids are absent, so both are orphans the boot purge reclaims.
        { id: 'a1', name: 'Q3 proposal.pdf', path: 'backups/crm-backup-2026-08-01T00-00-00Z.json' },
        { id: 'a2', name: 'x', path: '../other-app/data.json' },
      ],
    });
    expect(store.attachments.map((a) => a.path)).toEqual(['', '']);

    const second = await freshStore();
    expect(second.attachments).toHaveLength(0);
    expect(puter.fs.delete).not.toHaveBeenCalled();
  });

  it('holds a deleted record’s attachments while it sits in the trash', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/a.pdf', dealId: d.id });
    await store.deleteDeal(d.id);

    const second = await freshStore();
    // Owner is in the trash, so the attachment (and its file) wait.
    expect(second.attachments).toHaveLength(1);
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/a.pdf');
  });

  it('an import keeps the replaced manifest’s files while the snapshot holds them', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/erased.pdf', dealId: d.id });

    // Erase-all: the snapshot now holds the manifest, so the file waits
    // for the undo the snapshot promises.
    await store.importAll({
      app: 'crm', version: 1, companies: [], contacts: [], deals: [],
      activities: [], tasks: [], templates: [],
    });
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/erased.pdf');
  });

  it('reclaims a snapshot’s files once the slot rotates away from them', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/erased.pdf', dealId: d.id });
    await store.importAll({
      app: 'crm', version: 1, companies: [], contacts: [], deals: [],
      activities: [], tasks: [], templates: [],
    });

    // Importing onto the erased (empty) account takes no snapshot, so the
    // erase's snapshot keeps the slot - and its file stays restorable.
    const payload = {
      app: 'crm', version: 1, companies: [{ id: 'c1', name: 'Acme' }], contacts: [],
      deals: [], activities: [], tasks: [], templates: [],
    };
    await store.importAll(JSON.parse(JSON.stringify(payload)));
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/erased.pdf');

    // The next import snapshots the non-empty data, rotating the erase's
    // snapshot out - now nothing references the file.
    await store.importAll(JSON.parse(JSON.stringify(payload)));
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/erased.pdf');
  });

  it('restoring the snapshot keeps the files it brings back to life', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/kept.pdf', dealId: d.id });
    await store.importAll({
      app: 'crm', version: 1, companies: [], contacts: [], deals: [],
      activities: [], tasks: [], templates: [],
    });

    await store.restoreBackup();
    expect(store.attachments.map((a) => a.path)).toEqual(['attachments/kept.pdf']);
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/kept.pdf');

    // And undoing the restore still holds the file - it lives in the
    // re-rotated snapshot now.
    await store.restoreBackup();
    expect(puter.fs.delete).not.toHaveBeenCalledWith('attachments/kept.pdf');
  });

  it('a CSV-guard snapshot rotation reclaims what the old snapshot alone held', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'Deal' });
    await store.addAttachment({ name: 'a.pdf', path: 'attachments/erased.pdf', dealId: d.id });
    await store.importAll({
      app: 'crm', version: 1, companies: [], contacts: [], deals: [],
      activities: [], tasks: [], templates: [],
    });

    await store.addContact({ name: 'Someone' });   // so hasData() guards apply
    await store.saveSnapshot('csv-import');
    expect(puter.fs.delete).toHaveBeenCalledWith('attachments/erased.pdf');
  });
});

describe('email templates', () => {
  it('adds, updates, and round-trips templates through export/import', async () => {
    const store = await freshStore();
    const t = await store.addTemplate({ name: 'Check-in', subject: 'Hi {{firstName}}', body: 'Hello' });
    await store.updateTemplate(t.id, { body: 'Hello there' });

    const dump = store.exportAll();
    const other = await freshStore();
    await other.importAll(JSON.parse(JSON.stringify(dump)));
    expect(other.templates).toHaveLength(1);
    expect(other.templates[0].body).toBe('Hello there');
  });

  it('deleted templates land in the trash and restore from it', async () => {
    const store = await freshStore();
    const t = await store.addTemplate({ name: 'Recap', subject: 'S', body: 'B' });
    const entry = await store.deleteTemplate(t.id);
    expect(store.templates).toHaveLength(0);
    expect(entry.kind).toBe('template');

    await store.restoreTrash(entry.id);
    expect(store.templates).toHaveLength(1);
    expect(store.templateById(t.id).name).toBe('Recap');
  });

  it('drops malformed template shapes on import', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [], deals: [],
      activities: [], tasks: [],
      templates: [{ id: 'a', name: 42, subject: null, body: 'ok' }, 'junk', null],
    });
    expect(store.templates).toHaveLength(1);
    expect(store.templates[0]).toMatchObject({ id: 'a', name: '', subject: '', body: 'ok' });
  });
});

describe('bulk operations', () => {
  it('bulkUpdateContacts patches every listed record in one write', async () => {
    const store = await freshStore();
    const a = await store.addContact({ name: 'A', status: 'lead' });
    const b = await store.addContact({ name: 'B', status: 'lead' });
    const c = await store.addContact({ name: 'C', status: 'customer' });
    const sets = puter.kv.set.mock.calls.length;

    const n = await store.bulkUpdateContacts([a.id, b.id], { status: 'lost' });
    expect(n).toBe(2);
    expect(store.contactById(a.id).status).toBe('lost');
    expect(store.contactById(c.id).status).toBe('customer');
    expect(puter.kv.set.mock.calls.length - sets).toBe(1);
  });

  it('bulkMoveDeals stamps close dates and history like updateDeal', async () => {
    const store = await freshStore();
    const a = await store.addDeal({ name: 'A', stage: 'proposal' });
    const b = await store.addDeal({ name: 'B', stage: 'won' });

    await store.bulkMoveDeals([a.id, b.id], 'won');
    expect(store.dealById(a.id).closedAt).toBeTypeOf('number');
    expect(store.dealById(a.id).stageHistory.at(-1).stage).toBe('won');
    // B was already won: untouched, close date preserved.
    expect(store.dealById(b.id).closedAt).toBe(b.closedAt);

    await store.bulkMoveDeals([a.id], 'qualified');
    expect(store.dealById(a.id).closedAt).toBeNull();
  });

  it('bulkTag adds one tag without duplicating existing ones', async () => {
    const store = await freshStore();
    const a = await store.addContact({ name: 'A', tags: ['vip'] });
    const b = await store.addContact({ name: 'B' });
    const n = await store.bulkTag('contacts', [a.id, b.id], 'VIP');
    expect(n).toBe(2);
    expect(store.contactById(a.id).tags).toEqual(['vip']);
    expect(store.contactById(b.id).tags).toEqual(['VIP']);
  });

  it('bulkDelete trashes each record and detaches its links', async () => {
    const store = await freshStore();
    const a = await store.addContact({ name: 'A' });
    const b = await store.addContact({ name: 'B' });
    const keep = await store.addContact({ name: 'Keep' });
    const deal = await store.addDeal({ name: 'Deal', contactId: a.id });
    const task = await store.addTask({ title: 'Ping', contactId: b.id });

    const entries = await store.bulkDelete('contacts', [a.id, b.id]);
    expect(entries).toHaveLength(2);
    expect(store.contacts.map((c) => c.id)).toEqual([keep.id]);
    expect(store.dealById(deal.id).contactId).toBeNull();
    expect(store.tasks.find((t) => t.id === task.id).contactId).toBeNull();

    // Each entry restores independently, link intact where still free.
    const aEntry = entries.find((e) => e.record.id === a.id);
    await store.restoreTrash(aEntry.id);
    expect(store.contactById(a.id).name).toBe('A');
    expect(store.dealById(deal.id).contactId).toBe(a.id);
  });

  it('bulkDelete on deals detaches activities and follow-ups', async () => {
    const store = await freshStore();
    const d = await store.addDeal({ name: 'D' });
    const act = await store.addActivity({ summary: 'Call', dealId: d.id });
    await store.bulkDelete('deals', [d.id]);
    expect(store.deals).toHaveLength(0);
    expect(store.activities.find((a) => a.id === act.id).dealId).toBeNull();
  });
});

describe('merge', () => {
  it('merges a contact: re-points links, unions tags, keeps the older createdAt', async () => {
    const store = await freshStore();
    const keep = await store.addContact({ name: 'Dana Fox', email: 'dana@x.com', tags: ['vip'] });
    const dupe = await store.addContact({ name: 'Dana FOX', phone: '555 0100', notes: 'met at expo', tags: ['warm'] });
    Object.assign(store.contactById(dupe.id), { createdAt: keep.createdAt - 5000 });
    const deal = await store.addDeal({ name: 'Deal', contactId: dupe.id });
    const act = await store.addActivity({ summary: 'Call', contactId: dupe.id });
    const task = await store.addTask({ title: 'Ping', contactId: dupe.id });

    const entry = await store.mergeContacts(keep.id, dupe.id, { phone: '555 0100' });

    expect(store.contacts).toHaveLength(1);
    const survivor = store.contactById(keep.id);
    expect(survivor.phone).toBe('555 0100');
    expect(survivor.tags).toEqual(['vip', 'warm']);
    expect(survivor.createdAt).toBe(dupe.createdAt);
    expect(store.dealById(deal.id).contactId).toBe(keep.id);
    expect(store.activities.find((a) => a.id === act.id).contactId).toBe(keep.id);
    expect(store.tasks.find((t) => t.id === task.id).contactId).toBe(keep.id);
    expect(entry.kind).toBe('contact');
    expect(store.trash[0].id).toBe(entry.id);
  });

  it('carries the merged record’s files over instead of orphaning them', async () => {
    const store = await freshStore();
    const keep = await store.addContact({ name: 'Dana Fox', email: 'dana@x.com' });
    const dupe = await store.addContact({ name: 'Dana FOX', email: 'dana@x.com' });
    const company = await store.addCompany({ name: 'Atlas' });
    const dupeCo = await store.addCompany({ name: 'Atlas Inc' });
    await store.addAttachment({ name: 'contract.pdf', path: 'attachments/contract.pdf', contactId: dupe.id });
    await store.addAttachment({ name: 'msa.pdf', path: 'attachments/msa.pdf', companyId: dupeCo.id });

    await store.mergeContacts(keep.id, dupe.id);
    await store.mergeCompanies(company.id, dupeCo.id);

    expect(store.attachmentsFor({ contactId: keep.id }).map((a) => a.name)).toEqual(['contract.pdf']);
    expect(store.attachmentsFor({ companyId: company.id }).map((a) => a.name)).toEqual(['msa.pdf']);

    // And they survive the trash entry ageing out, which is when the
    // orphan purge would otherwise have reclaimed the bytes for good.
    kvData.set('crm:trash:v1', JSON.stringify([]));
    const later = await freshStore();
    expect(later.attachments).toHaveLength(2);
    expect(puter.fs.delete).not.toHaveBeenCalled();
  });

  it('restoring a merged-away contact brings it back without stealing links', async () => {
    const store = await freshStore();
    const keep = await store.addContact({ name: 'Dana', email: 'dana@x.com' });
    const dupe = await store.addContact({ name: 'Dana F', email: 'dana@x.com' });
    const deal = await store.addDeal({ name: 'Deal', contactId: dupe.id });

    const entry = await store.mergeContacts(keep.id, dupe.id);
    await store.restoreTrash(entry.id);

    expect(store.contacts).toHaveLength(2);
    // The deal stayed with the survivor - restore never overwrites a
    // decision made after the delete.
    expect(store.dealById(deal.id).contactId).toBe(keep.id);
  });

  it('merges a company and re-points people, deals, and history', async () => {
    const store = await freshStore();
    const keep = await store.addCompany({ name: 'Acme', website: 'acme.com' });
    const dupe = await store.addCompany({ name: 'Acme Inc', industry: 'Robotics' });
    const ct = await store.addContact({ name: 'Mei', companyId: dupe.id });
    const deal = await store.addDeal({ name: 'Deal', companyId: dupe.id });

    await store.mergeCompanies(keep.id, dupe.id, { industry: 'Robotics' });

    expect(store.companies).toHaveLength(1);
    expect(store.companyById(keep.id).industry).toBe('Robotics');
    expect(store.contactById(ct.id).companyId).toBe(keep.id);
    expect(store.dealById(deal.id).companyId).toBe(keep.id);
  });

  it('refuses to merge a record into itself or a missing record', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei' });
    expect(await store.mergeContacts(c.id, c.id)).toBeNull();
    expect(await store.mergeContacts(c.id, 'nope')).toBeNull();
  });
});

describe('tags', () => {
  it('normalizes tags on records and drops junk on import', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], deals: [],
      activities: [], tasks: [],
      contacts: [
        { id: 'a', name: 'Mei', tags: [' vip ', 'VIP', '', 'champion'] },
        { id: 'b', name: 'Sam', tags: 'not-an-array' },
      ],
    });
    expect(store.contacts[0].tags).toEqual(['vip', 'champion']);
    expect(store.contacts[1].tags).toEqual([]);
  });

  it('allTags counts across contacts, companies, and deals, grouping case', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei', tags: ['VIP', 'champion'] });
    await store.addCompany({ name: 'Acme', tags: ['vip'] });
    await store.addDeal({ name: 'Deal', tags: ['vip', 'expansion'] });

    const all = store.allTags();
    expect(all[0]).toEqual({ name: 'VIP', count: 3 });
    expect(all.map((t) => t.name).sort()).toEqual(['VIP', 'champion', 'expansion']);
  });

  it('allTags narrows to one collection, so a list filter offers only live labels', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei', tags: ['VIP', 'champion'] });
    await store.addCompany({ name: 'Acme', tags: ['vip'] });
    await store.addDeal({ name: 'Deal', tags: ['vip', 'expansion'] });

    expect(store.allTags('contacts')).toEqual([
      { name: 'champion', count: 1 }, { name: 'VIP', count: 1 },
    ]);
    expect(store.allTags('companies')).toEqual([{ name: 'vip', count: 1 }]);
    expect(store.allTags('deals').map((t) => t.name).sort()).toEqual(['expansion', 'vip']);
    // An unknown kind narrows to nothing rather than falling back to all.
    expect(store.allTags('nope')).toEqual([]);
  });

  it('renameTag rewrites every record and merges into an existing tag', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei', tags: ['vip', 'Champion'] });
    const co = await store.addCompany({ name: 'Acme', tags: ['VIP'] });
    const touched = await store.renameTag('vip', 'champion');

    expect(touched).toBe(2);
    // Renaming vip → champion on a record already wearing Champion merges
    // to a single tag rather than duplicating it.
    expect(store.contactById(c.id).tags).toEqual(['champion']);
    expect(store.companyById(co.id).tags).toEqual(['champion']);
  });

  it('deleteTag strips the label but leaves the records', async () => {
    const store = await freshStore();
    const c = await store.addContact({ name: 'Mei', tags: ['vip', 'champion'] });
    const d = await store.addDeal({ name: 'Deal', tags: ['VIP'] });
    const touched = await store.deleteTag('vip');

    expect(touched).toBe(2);
    expect(store.contactById(c.id).tags).toEqual(['champion']);
    expect(store.dealById(d.id).tags).toEqual([]);
    expect(store.contacts).toHaveLength(1);
  });

  it('CSV import splits a tags cell and merges with a matched record', async () => {
    const store = await freshStore();
    await store.addContact({ name: 'Mei', email: 'mei@x.com', tags: ['vip'] });
    await store.importRecords('contacts', [
      { name: 'Mei Tanaka', email: 'mei@x.com', tags: 'champion; VIP' },
      { name: 'Sam', email: 'sam@x.com', tags: 'inbound, warm' },
    ]);
    expect(store.contacts[0].tags).toEqual(['vip', 'champion']);
    expect(store.contacts[1].tags).toEqual(['inbound', 'warm']);
  });
});

describe('export / import', () => {
  it('round-trips everything through export → import', async () => {
    const store = await freshStore();
    const co = await store.addCompany({ name: 'Acme' });
    const ct = await store.addContact({ name: 'Mei', companyId: co.id });
    await store.addDeal({ name: 'Deal', contactId: ct.id, value: 5000 });
    await store.updateSettings({ currency: 'EUR' });

    const dump = store.exportAll();
    const other = await freshStore();
    await other.importAll(JSON.parse(JSON.stringify(dump)));

    expect(other.companies).toEqual(store.companies);
    expect(other.contacts).toEqual(store.contacts);
    expect(other.deals).toEqual(store.deals);
    expect(other.settings.currency).toBe('EUR');
  });

  it('rejects payloads that are not CRM exports', async () => {
    const store = await freshStore();
    await expect(store.importAll({ app: 'other', version: 1 })).rejects.toThrow('Not a CRM export file');
    await expect(store.importAll(null)).rejects.toThrow();
    await expect(store.importAll({ app: 'crm' })).rejects.toThrow();
  });

  it('normalizes hand-edited records so views cannot crash on them', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [{ id: 'c1' }, 'not-an-object', null],
      contacts: [{ id: 'p1', status: 'bogus' }],
      deals: [{ id: 'd1', stage: 'bogus', value: 'lots' }, { id: 'd2', stage: 'won' }],
      activities: [{ id: 'a1', type: 'bogus', date: 'yesterday' }],
      tasks: [{ id: 't1' }, { id: 't2', done: true }],
    });

    expect(store.companies).toHaveLength(1);
    expect(store.companies[0].name).toBe('');
    expect(store.contacts[0].status).toBe('lead');
    expect(store.deals[0]).toMatchObject({ stage: 'new', value: 0, closedAt: null });
    expect(store.deals[1].closedAt).toBeTypeOf('number');
    expect(store.activities[0].type).toBe('note');
    expect(store.activities[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.tasks[0].due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.tasks[1].doneAt).toBeTypeOf('number');

    // The exact calls that crashed on malformed data:
    expect(() => store.openTasks()).not.toThrow();
    expect(() => [...store.contacts].sort((a, b) => a.name.localeCompare(b.name))).not.toThrow();
    expect(() => store.activitiesFor({ contactId: 'p1' })).not.toThrow();
  });

  it('strips a close reason from an imported deal that is still open', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [], contacts: [],
      deals: [
        { id: 'd1', name: 'Open', stage: 'proposal', closeReason: 'Price', closeReasonNote: 'n' },
        { id: 'd2', name: 'Lost', stage: 'lost', closeReason: 'Price' },
      ],
      activities: [], tasks: [],
    });
    expect(store.deals[0]).toMatchObject({ closeReason: '', closeReasonNote: '' });
    expect(store.deals[1].closeReason).toBe('Price');
  });

  it('dates a record with a null timestamp to now, not to 1970', async () => {
    const store = await freshStore();
    const before = Date.now();
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [],
      contacts: [{ id: 'c1', name: 'Nulled', createdAt: null }],
      deals: [{ id: 'd1', name: 'D', createdAt: '', updatedAt: true }],
      activities: [],
      tasks: [{ id: 't1', title: 'x', due: '2026-08-10', done: true, doneAt: null }],
    });
    // 0 is a finite timestamp, so a null that slipped through would read as
    // the epoch: a lead added "20,000 days ago", instantly the coldest.
    expect(store.contacts[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(store.deals[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(store.deals[0].updatedAt).toBeGreaterThanOrEqual(before);
    expect(store.tasks[0].doneAt).toBeGreaterThanOrEqual(before);
    // A real number, and a string spelling one, still come through.
    await store.importAll({
      app: 'crm', version: 1, settings: {}, companies: [{ id: 'x', createdAt: 1000 }],
      contacts: [{ id: 'y', createdAt: '2000' }], deals: [], activities: [], tasks: [],
    });
    expect(store.companies[0].createdAt).toBe(1000);
    expect(store.contacts[0].createdAt).toBe(2000);
  });

  it('assigns ids to imported records that lack them', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1, settings: {},
      companies: [{ name: 'No id inc' }], contacts: [], deals: [],
      activities: [], tasks: [],
    });
    expect(store.companies[0].id).toBeTruthy();
  });

  it('import persists to KV so a reload sees it', async () => {
    const store = await freshStore();
    await store.importAll({
      app: 'crm', version: 1,
      settings: { currency: 'GBP', onboarded: true },
      companies: [], contacts: [], deals: [],
      activities: [], tasks: [{ id: 't1', title: 'Hi', due: '2026-08-10', done: false }],
    });

    const reloaded = await freshStore();
    expect(reloaded.settings.currency).toBe('GBP');
    expect(reloaded.tasks).toHaveLength(1);
  });
});
