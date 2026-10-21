import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../src/js/app.js';
import { createStore } from '../src/js/store.js';
import { createInvites } from '../src/js/invites.js';
import { makeKv } from './helpers/worker-harness.js';

// Exercise the controller actions that the real month/timegrid gestures call,
// keeping the actual renderer, store, invitation tracking and dialog in play.
const view = vi.hoisted(() => ({ actions: null }));
vi.mock('../src/js/views/month.js', async (load) => {
  const original = await load();
  return { ...original, renderMonth(ctx) {
    view.actions = ctx.actions;
    return original.renderMonth(ctx);
  } };
});

const HOUR = 3_600_000;
const HOST = { email: 'host@example.com' };
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const dialog = () => document.querySelector('form.invite-ask');
const submit = () => dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
let app;

beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  app?.destroy();
  app = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mount({ series = false, guests = true, booking = false, otherGuest = false } = {}) {
  const kv = makeKv();
  const store = createStore(kv);
  await store.load();
  await store.saveSettings({ defaultView: 'month' });
  const start = Date.now() + HOUR;
  const master = await store.saveEvent({
    title: 'Standup', start, end: start + HOUR, organizer: HOST,
    guests: guests ? [{ email: 'ada@example.com' }, ...(otherGuest ? [{ email: 'bob@example.com' }] : [])] : [],
    recurrence: series ? { freq: 'daily', interval: 1 } : null,
    booking: booking ? { id: 'ab12cd34ef', pageId: 'ab12cd34ef', email: 'ada@example.com' } : null,
  });
  const exec = vi.fn(async (_, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({
      ok: true, sent: body.recipients.length,
      results: body.recipients.map((r) => ({ email: r.email, status: 'sent', at: Date.now() })),
    }) };
  });
  const listeners = new Set();
  const rsvp = {
    isHosted: (ev) => ev.organizer?.email === HOST.email,
    linkableGuests: (ev) => ev.guests.filter((g) => g.email !== HOST.email),
    linksFor: () => ({
      'ada@example.com': 'https://cal-rsvp-test.puter.work/rsvp/' + 'a'.repeat(40),
      'bob@example.com': 'https://cal-rsvp-test.puter.work/rsvp/' + 'b'.repeat(40),
    }),
    onUpdate: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  const invites = createInvites({ kv, store, rsvp, user: HOST, getPuter: () => ({ workers: { exec } }), blocked: () => false });
  await invites.start();
  await invites.send(master);
  exec.mockClear();
  const root = document.createElement('div');
  document.body.append(root);
  app = createApp(root, { store, invites, user: HOST });
  const item = series ? store.getEvent(`${master.id}::${start + 24 * HOUR}`) : master;
  return { store, invites, exec, item, kv, rsvp, mint: (id) => { for (const cb of [...listeners]) cb(id); } };
}

describe('invitation offers after dragging or resizing', () => {
  it('also offers an update after editing just one occurrence in the editor', async () => {
    const w = await mount({ series: true });
    view.actions.openEvent(w.item);
    document.querySelector('[aria-label="Edit event"]').click();
    const title = document.querySelector('[aria-label="Event title"]');
    title.value = 'Changed occurrence';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form.modal--editor').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const scope = document.querySelector('form.rr-scope');
    scope.querySelector('input[value="one"]').checked = true;
    scope.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(dialog().textContent).toContain('Send updated invitations?');
    submit();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    const body = JSON.parse(w.exec.mock.calls[0][1].body);
    expect(body.ics).toContain('SUMMARY:Changed occurrence');
    expect(body.ics).toContain('RECURRENCE-ID');
  });

  it.each([
    ['moveEvent', false], ['resizeEvent', false], ['moveEvent', true], ['resizeEvent', true],
  ])('%s offers and sends an update (series=%s)', async (action, series) => {
    const w = await mount({ series });
    const start = action === 'moveEvent' ? w.item.start + HOUR : w.item.start;
    const end = w.item.end + HOUR;
    view.actions[action](w.item, start, end);
    await flush();
    expect(w.store.getEvent(w.item.id)).toMatchObject({ start, end });
    expect(dialog().textContent).toContain('Send updated invitations?');
    expect(w.exec).not.toHaveBeenCalled();
    submit();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    const body = JSON.parse(w.exec.mock.calls[0][1].body);
    expect(body.kind).toBe('update');
    expect(body.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(body.ics).toContain('METHOD:REQUEST');
    if (series) expect(body.ics).toContain('RECURRENCE-ID');
  });

  it.each([false, true])('Undo before Send prevents email, including with an older pending change (series=%s)', async (series) => {
    const w = await mount({ series });
    // Undoing the drag does not clear this separate pending title change.
    const masterId = w.item.seriesId || w.item.id;
    await w.store.saveEvent({ ...w.store.getEvent(masterId), title: 'Earlier edit' });
    const item = w.store.getEvent(w.item.id);
    view.actions.moveEvent(item, item.start + HOUR, item.end + HOUR);
    await flush();
    expect(dialog()).toBeTruthy();
    document.querySelector('.toast__action').click();
    await flush();
    expect(w.store.getEvent(item.id).start).toBe(item.start);
    expect(w.invites.planFor(item).pending).toHaveLength(1);
    submit();
    await flush();
    expect(w.exec).not.toHaveBeenCalled();
  });

  it.each(["Don't send", 'Escape', 'backdrop'])('%s dismisses without sending', async (choice) => {
    const w = await mount();
    view.actions.resizeEvent(w.item, w.item.start, w.item.end + HOUR);
    await flush();
    if (choice === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (choice === 'backdrop') dialog().parentElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    else [...dialog().querySelectorAll('button')].find((b) => b.textContent === choice).click();
    await flush();
    expect(dialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id).end).toBe(w.item.end + HOUR);
  });

  it.each([false, true])('a refused save produces no invitation offer (series=%s)', async (series) => {
    const w = await mount({ series });
    vi.spyOn(w.kv, 'set').mockRejectedValueOnce(new Error('kv unavailable'));
    view.actions.moveEvent(w.item, w.item.start + HOUR, w.item.end + HOUR);
    await flush();
    expect(dialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id).start).toBe(w.item.start);
  });

  it.each(['no guests', 'booked appointment', 'no time change'])('does not offer an update for %s', async (kind) => {
    const w = await mount({ guests: kind !== 'no guests', booking: kind === 'booked appointment' });
    const delta = kind === 'no time change' ? 0 : HOUR;
    view.actions.moveEvent(w.item, w.item.start + delta, w.item.end + delta);
    await flush();
    expect(dialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
    if (kind === 'booked appointment') expect(document.body.textContent).toContain("won't be notified");
  });

  it('does not send if the event was deleted while the question was open', async () => {
    const w = await mount();
    view.actions.moveEvent(w.item, w.item.start + HOUR, w.item.end + HOUR);
    await flush();
    await w.store.deleteEvent(w.item.id);
    submit();
    await flush();
    expect(w.exec).not.toHaveBeenCalled();
  });
});

describe('removing previously invited guests in the editor', () => {
  const cancelDialog = () => document.querySelector('form.cancel-ask');
  const answer = (form, label) => [...form.querySelectorAll('button')].find((b) => b.textContent === label).click();
  async function removeAda(w, scope, { changeTitle = false } = {}) {
    view.actions.openEvent(w.item);
    document.querySelector('[aria-label="Edit event"]').click();
    document.querySelector('[aria-label="Remove ada@example.com"]').click();
    if (changeTitle) document.querySelector('[aria-label="Event title"]').value = 'Updated standup';
    document.querySelector('form.modal--editor').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    if (scope) {
      const form = document.querySelector('form.rr-scope');
      form.querySelector(`input[value="${scope}"]`).checked = true;
      form.querySelector(`input[value="${scope}"]`).dispatchEvent(new Event('change', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    }
  }

  it.each([null, 'all', 'future'])('offers a targeted cancellation after a successful save (scope=%s)', async (scope) => {
    const w = await mount({ series: Boolean(scope), otherGuest: true });
    await removeAda(w, scope);
    expect(cancelDialog().textContent).toContain('Notify removed guests?');
    expect(cancelDialog().textContent).toContain('1 guest will get an email');
    expect(w.exec).not.toHaveBeenCalled();
    answer(cancelDialog(), 'Send');
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    const [url, opts] = w.exec.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(url).toContain('/cancellations');
    expect(body.recipients.map((r) => r.email)).toEqual(['ada@example.com']);
    expect(body.ics).not.toContain('STATUS:');
    expect(body.ics).not.toContain('mailto:bob@example.com');
    expect(w.store.getEvent(w.item.seriesId || w.item.id)).toBeTruthy();
    if (scope === 'future') expect(body.ics).toContain('RANGE=THISANDFUTURE');
  });

  it.each(["Don't send", 'Escape', 'backdrop'])('%s sends no cancellation and still offers updates to remaining guests', async (choice) => {
    const w = await mount({ otherGuest: true });
    await removeAda(w, null, { changeTitle: true });
    expect(dialog()).toBeNull(); // never stack both questions
    if (choice === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (choice === 'backdrop') cancelDialog().parentElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    else answer(cancelDialog(), choice);
    await flush();
    expect(cancelDialog()).toBeNull();
    expect(dialog().textContent).toContain('Send updated invitations?');
    expect(w.exec).not.toHaveBeenCalled();
    submit();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    const body = JSON.parse(w.exec.mock.calls[0][1].body);
    expect(body.kind).toBe('update');
    expect(body.recipients.map((r) => r.email)).toEqual(['bob@example.com']);
  });

  it('does not offer or send cancellation after a failed save', async () => {
    const w = await mount();
    vi.spyOn(w.kv, 'set').mockRejectedValueOnce(new Error('kv unavailable'));
    await removeAda(w);
    expect(cancelDialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id).guests.some((g) => g.email === 'ada@example.com')).toBe(true);
  });

  it('does not send when the removed guest was added back before Send', async () => {
    const w = await mount();
    await removeAda(w);
    await w.store.saveEvent(w.item);
    answer(cancelDialog(), 'Send');
    await flush();
    expect(w.exec).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('guests were added back');
  });
});


describe('notifications for this and following events', () => {
  async function chooseFuture() {
    const scope = document.querySelector('form.rr-scope');
    scope.querySelector('input[value="future"]').checked = true;
    scope.querySelector('input[value="future"]').dispatchEvent(new Event('change', { bubbles: true }));
    scope.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  }
  async function editFuture(w) {
    view.actions.openEvent(w.item);
    document.querySelector('[aria-label="Edit event"]').click();
    document.querySelector('[aria-label="Event title"]').value = 'Future standup';
    document.querySelector('form.modal--editor').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    await chooseFuture();
  }
  async function deleteFuture(w, entry) {
    if (entry === 'card') {
      view.actions.openEvent(w.item);
      document.querySelector('[aria-label="Delete event"]').click();
    } else {
      view.actions.eventContextMenu(new MouseEvent('contextmenu', { clientX: 50, clientY: 50 }), w.item);
      [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === 'Delete').click();
    }
    await chooseFuture();
  }
  const cancelDialog = () => document.querySelector('form.cancel-ask');
  const sendCancel = () => cancelDialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  it.each(['card', 'context menu'])('offers a range cancellation from the %s while preserving earlier events', async (entry) => {
    const w = await mount({ series: true });
    await deleteFuture(w, entry);
    expect(cancelDialog().textContent).toContain('this and all following occurrences');
    expect(cancelDialog().textContent).toContain('Earlier occurrences');
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id)).toBeNull();
    expect(w.store.getEvent(w.item.seriesId)).toBeTruthy();
    sendCancel();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    const body = JSON.parse(w.exec.mock.calls[0][1].body);
    expect(body.ics).toContain('METHOD:CANCEL');
    expect(body.ics).toContain('STATUS:CANCELLED');
    expect(body.ics).toContain('RANGE=THISANDFUTURE');
    expect(body.ics).toContain(`UID:${w.item.seriesId}@calendar.puter.com`);
  });

  it.each(['card', 'context menu'])('Undo before confirming a trim from the %s sends nothing', async (entry) => {
    const w = await mount({ series: true });
    await deleteFuture(w, entry);
    document.querySelector('.toast__action').click();
    await flush();
    sendCancel();
    await flush();
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id)).toBeTruthy();
  });

  it.each(['card', 'context menu'])('a failed trim from the %s never offers cancellation', async (entry) => {
    const w = await mount({ series: true });
    vi.spyOn(w.kv, 'set').mockRejectedValueOnce(new Error('write refused'));
    await deleteFuture(w, entry);
    expect(cancelDialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
    expect(w.store.getEvent(w.item.id)).toBeTruthy();
  });

  it.each(["Don't send", 'Escape', 'backdrop'])('%s dismisses the trim offer without mail', async (choice) => {
    const w = await mount({ series: true });
    await deleteFuture(w, 'card');
    if (choice === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (choice === 'backdrop') cancelDialog().parentElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    else [...cancelDialog().querySelectorAll('button')].find((b) => b.textContent === choice).click();
    await flush();
    expect(cancelDialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
  });

  it('one confirmation sends the shortened original and the new future series', async () => {
    const w = await mount({ series: true });
    await editFuture(w);
    expect(dialog().textContent).toContain('ending the original series');
    expect(dialog().textContent).toContain('new schedule and RSVP links');
    expect(w.exec).not.toHaveBeenCalled();
    submit();
    await flush();
    const bodies = w.exec.mock.calls.map(([, opts]) => JSON.parse(opts.body));
    expect(bodies).toHaveLength(2);
    const old = bodies.find((b) => b.event.id === w.item.seriesId);
    const tail = bodies.find((b) => b.event.id !== w.item.seriesId);
    expect(old.kind).toBe('update');
    expect(old.ics).toContain('UNTIL=');
    expect(old.ics).toContain('SUMMARY:Standup');
    expect(tail.kind).toBe('invite');
    expect(tail.ics).toContain('SUMMARY:Future standup');
    expect(tail.ics).toContain(`UID:${tail.event.id}@calendar.puter.com`);
    expect(w.store.getEvent(tail.event.id).start).toBe(w.item.recurrenceId);
    expect(w.invites.planFor({ id: tail.event.id }).pending).toHaveLength(0);
  });

  it('editing from the first occurrence sends just the updated original series', async () => {
    const w = await mount({ series: true });
    const master = w.store.getEvent(w.item.seriesId);
    w.item = w.store.getEvent(`${master.id}::${master.start}`);
    await editFuture(w);
    submit();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1);
    expect(JSON.parse(w.exec.mock.calls[0][1].body)).toMatchObject({ kind: 'update', event: { id: master.id, title: 'Future standup' } });
  });

  it.each(["Don't send", 'Undo'])('%s sends neither half of an edited split', async (choice) => {
    const w = await mount({ series: true });
    await editFuture(w);
    if (choice === 'Undo') {
      document.querySelector('.toast__action').click();
      await flush();
      submit();
    } else [...dialog().querySelectorAll('button')].find((b) => b.textContent === choice).click();
    await flush();
    expect(w.exec).not.toHaveBeenCalled();
  });

  it('a failed split save offers neither notification', async () => {
    const w = await mount({ series: true });
    vi.spyOn(w.kv, 'set').mockRejectedValueOnce(new Error('write refused'));
    await editFuture(w);
    expect(dialog()).toBeNull();
    expect(w.exec).not.toHaveBeenCalled();
  });

  it.each([false, true])('waits for new series RSVP links and respects Undo (undo=%s)', async (undo) => {
    const w = await mount({ series: true });
    const links = w.rsvp.linksFor();
    let ready = false;
    w.rsvp.linksFor = (id) => id === w.item.seriesId || ready ? links : {};
    await editFuture(w);
    const tail = w.store.getEventsInRange(w.item.start, w.item.end).find((ev) => ev.title === 'Future standup');
    submit();
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(1); // only the original series is ready
    if (undo) {
      document.querySelector('.toast__action').click();
      await flush();
    }
    ready = true;
    w.mint(tail.seriesId);
    await flush();
    expect(w.exec).toHaveBeenCalledTimes(undo ? 1 : 2);
    if (undo) expect(w.store.getEvent(tail.seriesId)).toBeNull();
    else expect(JSON.parse(w.exec.mock.calls[1][1].body).event.id).toBe(tail.seriesId);
  });
});
