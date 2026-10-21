import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from '../src/js/store.js';
import { createMethods } from '../src/js/api/methods.js';
import { startApiServer } from '../src/js/api/server.js';
import {
  CHANNEL,
  ERRORS,
  PROTOCOL_VERSION,
  HAS_FIELDS,
  grantedMethods,
  grantedScope,
  readLaunchContext,
} from '../src/js/api/protocol.js';

/** In-memory stand-in matching the subset of puter.kv the store uses. */
function makeKv() {
  const map = new Map();
  const globToRe = (glob) =>
    new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return {
    map,
    set: vi.fn(async (k, v) => {
      const items = Array.isArray(k) ? k : [{ key: k, value: v }];
      for (const { key, value } of items) map.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    }),
    get: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    del: vi.fn(async (k) => {
      map.delete(k);
      return true;
    }),
    list: vi.fn(async (pattern, returnValues) => {
      let keys = [...map.keys()];
      if (typeof pattern === 'string') keys = keys.filter((k) => globToRe(pattern).test(k));
      return returnValues ? keys.map((k) => ({ key: k, value: map.get(k) })) : keys;
    }),
  };
}

/** A stand-in for the AppConnection the caller is on. */
function fakeConnection() {
  const handlers = new Map();
  const sent = [];
  return {
    sent,
    postMessage: (msg) => sent.push(msg),
    on: (event, fn) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    off: (event, fn) => handlers.get(event)?.delete(fn),
    /** Simulate the caller posting `msg` to us. */
    receive: (msg) => {
      for (const fn of handlers.get('message') || []) fn(msg);
    },
    listenerCount: (event) => (handlers.get(event) || new Set()).size,
  };
}

const HOUR = 3600_000;
const DAY = 86_400_000;
const at = (day, hour = 9) => new Date(2031, 4, day, hour, 0, 0, 0).getTime();

describe('api/protocol — access control', () => {
  it('grants Contacts what it uses and nothing else', () => {
    const granted = grantedMethods('contacts');
    expect(granted).toContain('search');
    expect(granted).toContain('create');
    // Contacts never reads the whole calendar, so it cannot.
    expect(granted).not.toContain('list');
    expect(granted).not.toContain('get');
  });

  it('gives an app with no entry nothing at all', () => {
    expect(grantedMethods('notes')).toEqual([]);
    expect(grantedMethods('')).toEqual([]);
    expect(grantedMethods(undefined)).toEqual([]);
  });

  it('honours a narrowed, per-app grant and drops unknown method names', () => {
    expect(grantedMethods('reader', { reader: ['search', 'nonexistent'] })).toEqual(['search']);
    expect(grantedMethods('all', { all: '*' })).toContain('delete');
  });

  it('reads the caller from the desktop-stamped launch parameter, not the message', () => {
    const win = {
      puter: { env: 'app', args: { service: 'calendar-api' } },
      location: { search: '?puter.source_app.name=Contacts&puter.app_instance_id=abc' },
    };
    expect(readLaunchContext(win)).toEqual({
      callerApp: 'contacts',
      serviceMode: true,
      inPuterApp: true,
    });
  });

  it('reports no caller outside the Puter desktop', () => {
    const win = {
      puter: { env: 'web', args: { service: 'calendar-api' } },
      location: { search: '?puter.source_app.name=contacts' },
    };
    expect(readLaunchContext(win)).toEqual({ callerApp: '', serviceMode: false, inPuterApp: false });
  });
});

describe('api/methods', () => {
  let store;
  let methods;
  let kv;

  beforeEach(async () => {
    kv = makeKv();
    store = createStore(kv);
    await store.load();
    methods = createMethods({ store });
    await store.saveEvent({
      title: 'Design review',
      location: 'Studio',
      start: at(4, 10),
      end: at(4, 11),
      guests: [{ email: 'ada@analytical.co', name: 'Ada Lovelace' }],
    });
    await store.saveEvent({
      title: 'Dentist',
      start: at(6, 15),
      end: at(6, 16),
    });
    await store.saveEvent({
      title: 'Standup',
      start: at(1, 9),
      end: at(1, 9) + 15 * 60_000,
      recurrence: { freq: 'daily' },
      guests: [{ email: 'grace@navy.mil', name: 'Grace Hopper' }],
    });
  });

  it('refuses a window a Date cannot hold, instead of walking every series for nothing', async () => {
    // A weekly series with no end: the recurrence engine jumps ahead to the
    // window, unless the window's start is an Invalid Date — then it walked
    // its whole cap, for every such series, per request.
    await store.saveEvent({
      title: 'Forever',
      start: at(1, 9),
      end: at(1, 10),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
    });
    for (const range of [{ from: 1e16 }, { from: 0, to: 9e15 }, { from: -9e15, to: 0 }]) {
      const err = await methods.list(range).catch((e) => e);
      expect(err.code).toBe(ERRORS.BAD_REQUEST);
    }
    // The last representable instant is still a legal bound.
    expect((await methods.list({ from: 8.64e15 - HOUR, to: 8.64e15 })).total).toBe(0);
  });

  it('lists a window as expanded occurrences, earliest first', async () => {
    const { events, total, from, to } = await methods.list({ from: at(4, 0), to: at(5, 0) });
    expect(from).toBe(at(4, 0));
    expect(to).toBe(at(5, 0));
    expect(total).toBe(2);
    expect(events.map((e) => e.title)).toEqual(['Standup', 'Design review']);
    // An occurrence carries a usable handle back to its series.
    expect(events[0].seriesId).toBeTruthy();
    expect(events[0].id).toBe(`${events[0].seriesId}::${events[0].recurrenceId}`);
    expect(events[0].recurring).toBe(true);
  });

  it('defaults to the month ahead and caps an over-wide window', async () => {
    const now = at(3, 0);
    const local = createMethods({ store, now: () => now });
    const soon = await local.list({});
    expect(soon.from).toBe(now);
    expect(soon.to).toBe(now + 31 * DAY);
    const wide = await local.list({ from: now, to: now + 5000 * DAY });
    expect(wide.to).toBe(now + 400 * DAY);
    await expect(local.list({ from: now, to: now })).rejects.toMatchObject({
      code: ERRORS.BAD_REQUEST,
    });
  });

  it('treats null/empty bounds as absent, not as epoch 0', async () => {
    const now = at(3, 0);
    const local = createMethods({ store, now: () => now });
    // The idiomatic JSON "no value" must default the same as omitting the key —
    // not coerce to 0 and answer with the 1970 window (or reject null/null).
    for (const bounds of [{ from: null }, { from: '' }, { from: null, to: null }]) {
      const res = await local.list(bounds);
      expect(res.from).toBe(now);
      expect(res.to).toBe(now + 31 * DAY);
    }
    // An explicit numeric 0 is still an honored bound (everything from epoch).
    expect((await local.list({ from: 0, to: now })).from).toBe(0);
    // Numeric strings keep working.
    expect((await local.list({ from: String(now), to: String(now + DAY) })).from).toBe(now);
  });

  it('paginates with `limit` while reporting the true total', async () => {
    const page = await methods.list({ from: at(1, 0), to: at(8, 0), limit: 2 });
    expect(page.events).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
  });

  it('searches text across title, location, description and people', async () => {
    const window = { from: at(1, 0), to: at(9, 0) };
    expect((await methods.search({ query: 'studio', ...window })).events.map((e) => e.title)).toEqual(
      ['Design review'],
    );
    expect((await methods.search({ query: 'ada lovelace', ...window })).total).toBe(1);
    expect((await methods.search({ query: 'nothing here', ...window })).total).toBe(0);
  });

  it('finds every occurrence involving a person, by address', async () => {
    const found = await methods.search({ guest: 'GRACE@navy.mil', from: at(1, 0), to: at(4, 0) });
    expect(found.total).toBe(3); // one standup a day
    expect(found.events.every((e) => e.title === 'Standup')).toBe(true);
    // Several addresses for one person are one query, not one query each.
    const either = await methods.search({
      guest: ['grace@navy.mil', 'ada@analytical.co'],
      from: at(4, 0),
      to: at(5, 0),
    });
    expect(either.events.map((e) => e.title)).toEqual(['Standup', 'Design review']);
  });

  it('counts the organizer as involving that person', async () => {
    await store.saveEvent({
      title: 'Their invitation',
      start: at(7, 12),
      end: at(7, 13),
      organizer: { email: 'ada@analytical.co', name: 'Ada Lovelace' },
    });
    const found = await methods.search({ guest: 'ada@analytical.co', from: at(7, 0), to: at(8, 0) });
    expect(found.events.map((e) => e.title)).toEqual(['Their invitation']);
  });

  it('refuses a search with neither a query nor a guest', async () => {
    await expect(methods.search({ from: at(1, 0), to: at(9, 0) })).rejects.toMatchObject({
      code: ERRORS.BAD_REQUEST,
    });
  });

  it('gets a stored event and a single occurrence by id', async () => {
    const master = store.getAllEvents().find((e) => e.recurrence);
    const plain = await methods.get({ id: master.id });
    expect(plain.event.recurrence.freq).toBe('daily');
    const occurrenceId = `${master.id}::${at(3, 9)}`;
    const one = await methods.get({ id: occurrenceId });
    expect(one.event.start).toBe(at(3, 9));
    expect(one.event.seriesId).toBe(master.id);
    // The rule travels with the series, not with an occurrence of it.
    expect(one.event.recurrence).toBeUndefined();
    await expect(methods.get({ id: 'nope' })).rejects.toMatchObject({ code: ERRORS.NOT_FOUND });
  });

  it('phantom occurrence ids are not_found — never fabricated, updated, or "deleted"', async () => {
    // Regression: an off-pattern rid materialized a phantom event on get,
    // update wrote a junk override the views filter out (accumulating on the
    // master in KV forever), and delete added an inert exdate — all reported
    // as success for changes no view would ever show.
    const master = store.getAllEvents().find((e) => e.recurrence);
    const offPattern = `${master.id}::${at(3, 9) + 1234}`; // 9:00-series, rid mid-morning
    await expect(methods.get({ id: offPattern })).rejects.toMatchObject({ code: ERRORS.NOT_FOUND });
    await expect(
      methods.update({ id: offPattern, patch: { title: 'X' } }),
    ).rejects.toMatchObject({ code: ERRORS.NOT_FOUND });
    await expect(methods.delete({ id: offPattern })).rejects.toMatchObject({ code: ERRORS.NOT_FOUND });
    expect(Object.keys(store.getEvent(master.id).overrides)).toHaveLength(0); // no junk landed

    // `Number('') === 0`: a bare "id::" must not resolve to an epoch-0 event.
    await expect(methods.get({ id: `${master.id}::` })).rejects.toMatchObject({
      code: ERRORS.NOT_FOUND,
    });

    // A cancelled occurrence does not exist either.
    const rid = at(3, 9);
    await methods.delete({ id: `${master.id}::${rid}` });
    await expect(methods.get({ id: `${master.id}::${rid}` })).rejects.toMatchObject({
      code: ERRORS.NOT_FOUND,
    });
  });

  it('creates an event, including a repeating one, in a single call', async () => {
    const { event } = await methods.create({
      event: {
        title: "Ada Lovelace's birthday",
        start: at(20, 0),
        end: at(20, 0) + DAY - 1,
        allDay: true,
        recurrence: { freq: 'yearly' },
      },
    });
    expect(event.id).toBeTruthy();
    expect(event.allDay).toBe(true);
    expect(event.recurrence.freq).toBe('yearly');
    expect(store.getEvent(event.id)).toBeTruthy();
  });

  it('never lets a caller steer ids, timestamps, or calendar-owned state', async () => {
    const { event } = await methods.create({
      event: {
        id: 'forced-id',
        title: 'Lunch',
        start: at(5, 12),
        createdAt: 1,
        ooo: true,
        declined: true,
        exdates: [at(5, 12)],
      },
    });
    expect(event.id).not.toBe('forced-id');
    expect(event.createdAt).not.toBe(1);
    expect(event.declined).toBe(false);
    expect(event.ooo).toBeUndefined();
    expect(store.getEvent(event.id).exdates).toBeUndefined();
  });

  it('rejects a create with no start, and a rule it would otherwise drop', async () => {
    await expect(methods.create({ event: { title: 'Someday' } })).rejects.toMatchObject({
      code: ERRORS.BAD_REQUEST,
    });
    // A start the store would drop (and then stamp at "now") is an error, not a
    // surprise event this afternoon.
    await expect(
      methods.create({ event: { title: 'Stringly typed', start: String(at(5)) } }),
    ).rejects.toMatchObject({ code: ERRORS.INVALID });
    await expect(
      methods.create({ event: { title: 'Odd', start: at(5), recurrence: { freq: 'fortnightly' } } }),
    ).rejects.toMatchObject({ code: ERRORS.INVALID });
    await expect(
      methods.create({ event: { title: 'Odd', start: at(5), guests: 'ada@analytical.co' } }),
    ).rejects.toMatchObject({ code: ERRORS.INVALID });
    // A start no Date can hold would persist an event with a null end and a
    // rule with a null weekday that every range query then walks in vain.
    await expect(
      methods.create({ event: { title: 'Far', start: 9e15, allDay: true, recurrence: { freq: 'weekly' } } }),
    ).rejects.toMatchObject({ code: ERRORS.INVALID });
    await expect(
      methods.create({ event: { title: 'Far', start: at(5), end: -9e15 } }),
    ).rejects.toMatchObject({ code: ERRORS.INVALID });
  });

  it('patches only the fields it is given', async () => {
    const dentist = store.getAllEvents().find((e) => e.title === 'Dentist');
    const { event } = await methods.update({
      id: dentist.id,
      patch: { location: 'High Street', start: at(6, 16), end: at(6, 17) },
    });
    expect(event.title).toBe('Dentist'); // untouched
    expect(event.location).toBe('High Street');
    expect(event.start).toBe(at(6, 16));
    await expect(methods.update({ id: dentist.id, patch: {} })).rejects.toMatchObject({
      code: ERRORS.BAD_REQUEST,
    });
  });

  it('treats an occurrence id as "this occurrence", leaving the series alone', async () => {
    const master = store.getAllEvents().find((e) => e.recurrence);
    const occurrenceId = `${master.id}::${at(3, 9)}`;
    const { event } = await methods.update({
      id: occurrenceId,
      patch: { title: 'Standup (demo day)' },
    });
    expect(event.title).toBe('Standup (demo day)');
    expect(store.getEvent(master.id).title).toBe('Standup');
    const nextDay = await methods.get({ id: `${master.id}::${at(4, 9)}` });
    expect(nextDay.event.title).toBe('Standup');
    // Whatever belongs to the series as a whole is a question for the series —
    // and is refused here rather than accepted and quietly dropped.
    for (const patch of [{ recurrence: { freq: 'weekly' } }, { guests: [] }]) {
      await expect(methods.update({ id: occurrenceId, patch })).rejects.toMatchObject({
        code: ERRORS.BAD_REQUEST,
      });
    }
    expect(store.getEvent(master.id).guests).toHaveLength(1);
  });

  it('a series-master patch behaves like the app\'s own series editor', async () => {
    const master = store.getAllEvents().find((e) => e.recurrence);
    // Build up per-occurrence state through the API itself.
    await methods.delete({ id: `${master.id}::${at(3, 9)}` });
    await methods.update({ id: `${master.id}::${at(4, 9)}`, patch: { title: 'Special' } });
    expect(store.getEvent(master.id).exdates).toHaveLength(1);
    expect(Object.keys(store.getEvent(master.id).overrides)).toHaveLength(1);

    // A content-only patch keeps the exceptions…
    await methods.update({ id: master.id, patch: { title: 'Renamed standup' } });
    let m = store.getEvent(master.id);
    expect(m.title).toBe('Renamed standup');
    expect(m.exdates).toHaveLength(1);
    expect(Object.keys(m.overrides)).toHaveLength(1);

    // …and a time change clears them (they are keyed to the old schedule) and
    // reprojects onto the master's own date — the pattern owns the dates.
    await methods.update({ id: master.id, patch: { start: at(3, 10), end: at(3, 11) } });
    m = store.getEvent(master.id);
    expect(m.exdates).toEqual([]);
    expect(m.overrides).toEqual({});
    expect(new Date(m.start).getHours()).toBe(10);
    expect(new Date(m.start).getDate()).toBe(new Date(at(1, 9)).getDate()); // anchor date unmoved

    // A lone-bound patch still changes the time instead of being ignored.
    await methods.update({ id: master.id, patch: { start: at(3, 8) } });
    expect(new Date(store.getEvent(master.id).start).getHours()).toBe(8);
  });

  it('deletes an event, and cancels a single occurrence, saying which it did', async () => {
    const dentist = store.getAllEvents().find((e) => e.title === 'Dentist');
    expect(await methods.delete({ id: dentist.id })).toEqual({
      deleted: true,
      id: dentist.id,
      scope: 'event',
    });
    expect(store.getEvent(dentist.id)).toBeNull();

    const master = store.getAllEvents().find((e) => e.recurrence);
    const occurrenceId = `${master.id}::${at(3, 9)}`;
    const result = await methods.delete({ id: occurrenceId });
    expect(result.scope).toBe('occurrence');
    expect(store.getEvent(master.id)).toBeTruthy();
    const day = await methods.list({ from: at(3, 0), to: at(4, 0) });
    expect(day.total).toBe(0);
    await expect(methods.delete({ id: 'nope' })).rejects.toMatchObject({ code: ERRORS.NOT_FOUND });
  });

  it('re-reads a calendar another window may have changed, then stops re-reading', async () => {
    let clock = 1_000_000;
    const fresh = createMethods({ store, now: () => clock });
    await fresh.list({ from: at(1, 0), to: at(9, 0) });
    const reads = kv.list.mock.calls.length;
    // A burst of requests shares one read…
    await Promise.all([
      fresh.list({ from: at(1, 0), to: at(9, 0) }),
      fresh.list({ from: at(1, 0), to: at(9, 0) }),
    ]);
    expect(kv.list.mock.calls.length).toBe(reads);
    // …and a request after the freshness window pays for another.
    clock += 11_000;
    await fresh.list({ from: at(1, 0), to: at(9, 0) });
    expect(kv.list.mock.calls.length).toBeGreaterThan(reads);
  });

  it('answers from the calendar it has when a re-read fails', async () => {
    let clock = 1_000_000;
    const fresh = createMethods({ store, now: () => clock });
    await fresh.list({ from: at(1, 0), to: at(9, 0) });
    kv.list.mockRejectedValueOnce(new Error('network down'));
    clock += 11_000;
    const stale = await fresh.list({ from: at(4, 0), to: at(5, 0) });
    expect(stale.total).toBe(2); // the copy we already had, rather than an error
  });

  it('surfaces a failed write as a storage error rather than a broken promise', async () => {
    kv.set.mockRejectedValueOnce(new Error('offline'));
    await expect(
      methods.create({ event: { title: 'Nope', start: at(5, 12) } }),
    ).rejects.toMatchObject({ code: ERRORS.STORAGE });
  });
});

describe('api/server', () => {
  let store;
  let methods;
  let connection;

  beforeEach(async () => {
    store = createStore(makeKv());
    await store.load();
    methods = createMethods({ store });
    connection = fakeConnection();
  });

  const serve = (callerApp, allowed) =>
    startApiServer({
      connection,
      callerApp,
      methods,
      allowed,
      subscribe: (fn) => store.subscribe(fn),
    });

  /** The reply to request `id`, once the handler (and any cloud read it made)
   *  has settled. */
  async function replyTo(id, from = connection) {
    for (let i = 0; i < 50 && !from.sent.some((m) => m.id === id); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return from.sent.find((m) => m.id === id);
  }

  it('announces itself with exactly what the caller may call', () => {
    const server = serve('contacts');
    expect(connection.sent[0]).toMatchObject({
      $: CHANNEL,
      v: PROTOCOL_VERSION,
      type: 'ready',
      methods: server.granted,
    });
    expect(server.granted).not.toContain('list');
  });

  it('does not listen at all to an app with no grant', () => {
    expect(serve('some-other-app')).toBeNull();
    expect(connection.sent).toHaveLength(0);
    expect(connection.listenerCount('message')).toBe(0);
  });

  it('answers a granted call', async () => {
    serve('contacts');
    connection.receive({ $: CHANNEL, v: 1, id: 'a', method: 'ping' });
    expect(await replyTo('a')).toMatchObject({ ok: true, result: { app: 'calendar' } });
  });

  it('ping names the methods this caller may use, not the whole table', async () => {
    // Un-granted and unknown methods are answered alike so a caller cannot
    // learn what exists beyond its grant; ping must not hand the list over.
    const server = serve('contacts');
    connection.receive({ $: CHANNEL, v: 1, id: 'p', method: 'ping' });
    const reply = await replyTo('p');
    expect(reply.result.methods).toEqual(server.granted);
    expect(reply.result.methods).not.toContain('list');
    expect(reply.result.methods).toEqual(connection.sent[0].methods);
  });

  it('answers an un-granted method exactly like an unknown one', async () => {
    serve('contacts');
    connection.receive({ $: CHANNEL, v: 1, id: 'b', method: 'list', params: {} });
    connection.receive({ $: CHANNEL, v: 1, id: 'c', method: 'teleport', params: {} });
    const [ungranted, unknown] = [await replyTo('b'), await replyTo('c')];
    expect(ungranted.error.code).toBe(ERRORS.UNKNOWN_METHOD);
    expect(unknown.error.code).toBe(ERRORS.UNKNOWN_METHOD);
    expect(ungranted.error.message).toBe(unknown.error.message.replace('teleport', 'list'));
  });

  it('refuses a protocol version it does not speak', async () => {
    serve('contacts');
    connection.receive({ $: CHANNEL, v: 99, id: 'd', method: 'ping' });
    expect((await replyTo('d')).error.code).toBe(ERRORS.VERSION);
  });

  it('ignores traffic that is not ours', () => {
    serve('contacts');
    const before = connection.sent.length;
    connection.receive({ hello: 'there' });
    connection.receive({ $: 'other-app', id: 'x', method: 'ping' });
    connection.receive(null);
    expect(connection.sent).toHaveLength(before);
  });

  it('reports a handler error with its own code, and hides anything else', async () => {
    serve('contacts', { contacts: ['ping', 'search'] });
    connection.receive({ $: CHANNEL, v: 1, id: 'e', method: 'search', params: {} });
    expect((await replyTo('e')).error.code).toBe(ERRORS.BAD_REQUEST);

    const boom = { ...methods, ping: async () => { throw new Error('secret internals'); } };
    const other = fakeConnection();
    startApiServer({ connection: other, callerApp: 'contacts', methods: boom });
    other.receive({ $: CHANNEL, v: 1, id: 'f', method: 'ping' });
    const reply = await replyTo('f', other);
    expect(reply.error.code).toBe(ERRORS.STORAGE);
    expect(JSON.stringify(reply)).not.toContain('secret internals');
  });

  it('tells the caller when the calendar changed, coalescing a burst', async () => {
    vi.useFakeTimers();
    try {
      serve('contacts');
      await store.saveEvent({ title: 'One', start: Date.now() });
      await store.saveEvent({ title: 'Two', start: Date.now() + HOUR });
      vi.advanceTimersByTime(500);
      expect(connection.sent.filter((m) => m.type === 'changed')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * `changed` is a promise that the calendar moved, and a caller acts on it by
   * throwing away what it has. The store emits for more than that — a freshness
   * re-read that found nothing new, or settings and tasks, which this API does
   * not serve — and announcing those cost a caller a second read of everything.
   */
  describe('changed, gated on a revision', () => {
    const serveWithRevision = () =>
      startApiServer({
        connection,
        callerApp: 'contacts',
        methods,
        subscribe: (fn) => store.subscribe(fn),
        revision: () => store.revision(),
      });
    const notices = () => connection.sent.filter((m) => m.type === 'changed');

    it('says nothing when the first read loads the calendar', async () => {
      vi.useFakeTimers();
      try {
        const fresh = createStore(makeKv()); // as a freshly booted service instance
        startApiServer({
          connection,
          callerApp: 'contacts',
          methods: createMethods({ store: fresh }),
          subscribe: (fn) => fresh.subscribe(fn),
          revision: () => fresh.revision(),
        });
        await fresh.load(); // what ensureLoaded() does on the first request
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('announces a write that is the instance\'s very first request', async () => {
      // A fresh service instance loads the calendar and writes to it within
      // the same debounce (Contacts adds a birthday: load, then create, a few
      // ms apart). The load's emit is the baseline; the create must still be
      // announced, or the caller keeps showing a stale answer.
      vi.useFakeTimers();
      try {
        const kv = makeKv();
        await createStore(kv).saveEvent({ title: 'Existing', start: at(4) }); // the cloud's state
        const instance = createStore(kv); // the just-launched service instance: nothing loaded yet
        const conn = fakeConnection();
        startApiServer({
          connection: conn,
          callerApp: 'contacts',
          methods: createMethods({ store: instance }),
          subscribe: (fn) => instance.subscribe(fn),
          revision: () => instance.revision(),
        });
        conn.receive({
          $: CHANNEL,
          v: 1,
          id: 'c1',
          method: 'create',
          params: { event: { title: 'Birthday', start: at(5), end: at(5, 10) } },
        });
        await vi.advanceTimersByTimeAsync(1000);
        expect(conn.sent.find((m) => m.id === 'c1')).toMatchObject({ ok: true });
        expect(conn.sent.filter((m) => m.type === 'changed')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says nothing when a re-read finds the same calendar', async () => {
      vi.useFakeTimers();
      try {
        await store.saveEvent({ title: 'Standup', start: at(4) });
        serveWithRevision();
        await store.load();
        await vi.advanceTimersByTimeAsync(500);
        await store.load();
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says nothing for settings, which this API does not serve', async () => {
      vi.useFakeTimers();
      try {
        serveWithRevision();
        await store.saveSettings({ hiddenColors: ['pink'] });
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('announces a write, including a single-occurrence edit', async () => {
      vi.useFakeTimers();
      try {
        serveWithRevision();
        const series = await store.saveEvent({
          title: 'Standup',
          start: at(4),
          end: at(4) + HOUR,
          recurrence: { freq: 'daily' },
        });
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(1);

        await store.updateOccurrence(series.id, at(5), { title: 'Moved' });
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(2);

        await store.deleteEvent(series.id);
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('announces every emit when no revision is available to compare', async () => {
      vi.useFakeTimers();
      try {
        serve('contacts');
        await store.saveSettings({ hiddenColors: ['pink'] });
        await vi.advanceTimersByTimeAsync(500);
        expect(notices()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('stops listening and stops announcing after stop()', async () => {
    const server = serve('contacts');
    server.stop();
    expect(connection.listenerCount('message')).toBe(0);
    const before = connection.sent.length;
    await store.saveEvent({ title: 'After', start: Date.now() });
    await new Promise((r) => setTimeout(r, 300));
    expect(connection.sent).toHaveLength(before);
  });
});

describe('api/protocol — scoped grants', () => {
  it('grants Meetings a read-only slice: list, over events with a meeting link', () => {
    expect(grantedMethods('meetings')).toEqual(['ping', 'list']);
    expect(grantedScope('meetings')).toEqual({ has: ['meeting'] });
  });

  it('reads the method list out of an object grant like an array one', () => {
    const allowed = { star: { methods: '*', has: ['guests'] }, few: { methods: ['get', 'bogus'] } };
    expect(grantedMethods('star', allowed)).toContain('delete');
    expect(grantedMethods('few', allowed)).toEqual(['get']);
  });

  it('has no scope for a whole-calendar grant, or for no grant at all', () => {
    expect(grantedScope('contacts')).toBeNull();
    expect(grantedScope('nobody')).toBeNull();
    expect(grantedScope('flat', { flat: { methods: ['list'] } })).toBeNull();
    expect(grantedScope('empty', { empty: { methods: ['list'], has: [] } })).toBeNull();
  });

  it('keeps a mistyped scope rather than widening it, and dedupes', () => {
    expect(grantedScope('x', { x: { methods: ['list'], has: ['meetng', 'meetng', ' '] } })).toEqual({
      has: ['meetng'],
    });
  });

  it('is not fooled by an app named after an Object property', () => {
    expect(grantedMethods('constructor')).toEqual([]);
    expect(grantedMethods('toString')).toEqual([]);
    expect(grantedScope('__proto__')).toBeNull();
  });
});

describe('api/methods — `has` and scope', () => {
  const MEET = 'https://meetings.puter.com/#/m/abcd-efgh-ijkl';
  let store;
  let kv;

  beforeEach(async () => {
    kv = makeKv();
    store = createStore(kv);
    await store.load();
    await store.saveEvent({
      title: 'Design review',
      location: 'Studio',
      start: at(4, 10),
      end: at(4, 11),
      guests: [{ email: 'ada@analytical.co', name: 'Ada Lovelace' }],
      meeting: { url: MEET, code: 'abcd-efgh-ijkl' },
    });
    await store.saveEvent({ title: 'Dentist', start: at(4, 15), end: at(4, 16) });
    await store.saveEvent({
      title: 'Standup',
      start: at(1, 9),
      end: at(1, 9) + 15 * 60_000,
      recurrence: { freq: 'daily' },
      guests: [{ email: 'grace@navy.mil', name: 'Grace Hopper' }],
      meeting: { url: 'https://example.com/zoom/123' },
    });
  });

  const day4 = { from: at(4, 0), to: at(5, 0) };

  it('`has` keeps only events that have every field named', async () => {
    const methods = createMethods({ store });
    const all = await methods.list(day4);
    expect(all.events.map((e) => e.title)).toEqual(['Standup', 'Design review', 'Dentist']);

    const meetings = await methods.list({ ...day4, has: ['meeting'] });
    expect(meetings.events.map((e) => e.title)).toEqual(['Standup', 'Design review']);
    expect(meetings.total).toBe(2);
    // The occurrence carries its series' link, exactly as the UI shows it.
    expect(meetings.events[0].meeting).toEqual({ url: 'https://example.com/zoom/123' });

    const placed = await methods.list({ ...day4, has: 'location' });
    expect(placed.events.map((e) => e.title)).toEqual(['Design review']);

    const both = await methods.list({ ...day4, has: ['meeting', 'location'] });
    expect(both.events.map((e) => e.title)).toEqual(['Design review']);
  });

  it('`has` works on search too, and an empty one is no filter', async () => {
    const methods = createMethods({ store });
    const found = await methods.search({ ...day4, query: 'd', has: ['meeting'] });
    expect(found.events.map((e) => e.title)).toEqual(['Standup', 'Design review']);
    const none = await methods.list({ ...day4, has: [] });
    expect(none.total).toBe(3);
    const nul = await methods.list({ ...day4, has: null });
    expect(nul.total).toBe(3);
  });

  it('refuses an unknown `has` name, naming the known ones', async () => {
    const methods = createMethods({ store });
    const err = await methods.list({ ...day4, has: ['colour'] }).catch((e) => e);
    expect(err.code).toBe(ERRORS.BAD_REQUEST);
    for (const name of HAS_FIELDS) expect(err.message).toContain(name);
  });

  it('every HAS field has a meaning', async () => {
    const methods = createMethods({ store });
    for (const name of HAS_FIELDS) {
      // None of them throws; each narrows to a subset of the window.
      const { total } = await methods.list({ ...day4, has: [name] });
      expect(total).toBeLessThanOrEqual(3);
    }
    expect((await methods.list({ ...day4, has: ['guests'] })).total).toBe(2);
    expect((await methods.list({ ...day4, has: ['organizer'] })).total).toBe(0);
    expect((await methods.list({ ...day4, has: ['description'] })).total).toBe(0);
  });

  describe('a scoped caller', () => {
    let scoped;
    let review;
    let dentist;

    beforeEach(async () => {
      scoped = createMethods({ store, scope: { has: ['meeting'] } });
      const all = await createMethods({ store }).list(day4);
      review = all.events.find((e) => e.title === 'Design review');
      dentist = all.events.find((e) => e.title === 'Dentist');
    });

    it('never sees outside its slice, whatever it asks for', async () => {
      const listed = await scoped.list(day4);
      expect(listed.events.map((e) => e.title)).toEqual(['Standup', 'Design review']);
      expect(listed.total).toBe(2);
      // Omitting `has`, or asking for a different one, cannot widen the slice.
      const located = await scoped.list({ ...day4, has: ['location'] });
      expect(located.events.map((e) => e.title)).toEqual(['Design review']);
      const searched = await scoped.search({ ...day4, query: 'dentist' });
      expect(searched.total).toBe(0);
    });

    it('reads an event outside the slice as not_found — by id, for every method', async () => {
      expect((await scoped.get({ id: review.id })).event.title).toBe('Design review');
      const get = await scoped.get({ id: dentist.id }).catch((e) => e);
      expect(get.code).toBe(ERRORS.NOT_FOUND);
      const update = await scoped.update({ id: dentist.id, patch: { title: 'x' } }).catch((e) => e);
      expect(update.code).toBe(ERRORS.NOT_FOUND);
      const del = await scoped.delete({ id: dentist.id }).catch((e) => e);
      expect(del.code).toBe(ERRORS.NOT_FOUND);
      // Nothing happened to the event it could not see.
      expect(store.getEvent(dentist.id).title).toBe('Dentist');
    });

    it('can change what it can see, even when that moves it out of the slice', async () => {
      const locScoped = createMethods({ store, scope: { has: ['location'] } });
      const { event } = await locScoped.update({ id: review.id, patch: { location: '' } });
      expect(event.location).toBe('');
      expect(store.getEvent(review.id).location).toBe('');
    });

    it('refuses a create that would fall outside the slice', async () => {
      const err = await scoped
        .create({ event: { title: 'Sneaky', start: at(7, 9), end: at(7, 10) } })
        .catch((e) => e);
      expect(err.code).toBe(ERRORS.FORBIDDEN);
      expect(store.getAllEvents().some((e) => e.title === 'Sneaky')).toBe(false);

      // A scope over a writable field can be met.
      const locScoped = createMethods({ store, scope: { has: ['location'] } });
      const ok = await locScoped.create({
        event: { title: 'Placed', location: 'Room 4', start: at(7, 9), end: at(7, 10) },
      });
      expect(ok.event.location).toBe('Room 4');
    });

    it('judges a create by what the store keeps, not by what was sent', async () => {
      // Each payload names the scoped field, but with nothing the store will
      // keep: the saved event would fall outside the slice, invisible to the
      // app that created it and beyond its reach to take back.
      const cases = [
        [{ has: ['guests'] }, { guests: [{}, { email: 'not-an-address' }] }],
        [{ has: ['organizer'] }, { organizer: { email: 'nope' } }],
        [{ has: ['reminders'] }, { reminders: ['x', -5, 99999999] }],
        [{ has: ['location'] }, { location: '   ' }],
      ];
      const before = store.getAllEvents().length;
      for (const [scope, fields] of cases) {
        const api = createMethods({ store, scope });
        const err = await api
          .create({ event: { title: 'Sneaky', start: at(7, 9), end: at(7, 10), ...fields } })
          .catch((e) => e);
        expect(err.code).toBe(ERRORS.FORBIDDEN);
      }
      expect(store.getAllEvents().length).toBe(before);
      // The same fields, valid, are kept — and so allowed.
      const guests = createMethods({ store, scope: { has: ['guests'] } });
      const ok = await guests.create({
        event: { title: 'Placed', start: at(7, 9), end: at(7, 10), guests: [{ email: 'ada@analytical.co' }] },
      });
      expect(ok.event.guests).toHaveLength(1);
      expect((await guests.get({ id: ok.event.id })).event.title).toBe('Placed');
    });

    it('a mistyped scope fails closed', async () => {
      const broken = createMethods({ store, scope: { has: ['meetng'] } });
      expect((await broken.list(day4)).total).toBe(0);
      const err = await broken.get({ id: review.id }).catch((e) => e);
      expect(err.code).toBe(ERRORS.NOT_FOUND);
    });
  });

  it('the server announces a scope alongside the granted methods', () => {
    const connection = fakeConnection();
    const server = startApiServer({
      connection,
      callerApp: 'meetings',
      methods: createMethods({ store, scope: grantedScope('meetings') }),
      scope: grantedScope('meetings'),
    });
    expect(server.granted).toEqual(['ping', 'list']);
    expect(connection.sent[0]).toMatchObject({ type: 'ready', methods: ['ping', 'list'], scope: { has: ['meeting'] } });
    // Contacts, unscoped, gets no `scope` key at all.
    const c2 = fakeConnection();
    startApiServer({ connection: c2, callerApp: 'contacts', methods: createMethods({ store }) });
    expect(c2.sent[0]).not.toHaveProperty('scope');
  });
});
