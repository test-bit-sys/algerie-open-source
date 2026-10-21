/**
 * The user's address book, borrowed from the Contacts app.
 *
 * Inside the Puter desktop the calendar can talk to other apps: we launch
 * Contacts as a headless API server and talk to it over the AppConnection that
 * `puter.ui.launchApp` hands back (https://docs.puter.com/Objects/AppConnection/).
 * Contacts only answers apps on its own allowlist, so this works because the
 * desktop tells it — from the calling process, not from anything we could
 * claim — that the caller is `calendar`.
 *
 * Why a snapshot rather than a query per keystroke: a launched app is a real
 * window, and holding one open for the length of someone's typing to round-trip
 * every character is both slower and messier than reading the directory once and
 * filtering it here. So we pull a lightweight list of everyone with an email
 * address, let the connection close again, and match locally.
 *
 * That snapshot is kept in localStorage as well as in memory, because launching
 * another app is the expensive part: without it, every calendar session paid for
 * one on the first guest keystroke. Restored from disk, suggestions work
 * immediately and most sessions launch nothing at all. The trade-off is a copy
 * of the address book — names, addresses, and companies, nothing else — sitting
 * device-locally under the calendar's own origin; it is scoped per user and
 * cleared on sign-out.
 *
 * ── Keeping it fresh ────────────────────────────────────────────────────────
 * A cached address book is only as good as its invalidation, and ours cannot
 * rely on being told. Contacts does post a `changed` notice, but it comes from
 * the *instance we launched*, which is a different process from the window the
 * user edits their contacts in — and we close our connection seconds after the
 * last call anyway. So `changed` covers writes we made ourselves and little
 * else. What actually keeps the snapshot current is re-reading it at the moments
 * where a stale copy would be felt, all of them cheap because they are throttled
 * and none of them in the typing path:
 *
 *   - the calendar opens (main.js), and again when it is brought back to the
 *     front after the address book has been used — "I just added someone in
 *     Contacts and switched back" is the case this exists for;
 *   - the event editor opens, and when the guest field is focused while empty;
 *   - after a query finds nobody, or after the user types in an address we have
 *     never heard of — both are evidence that the book moved on without us.
 *
 * Freshness is a *revalidation window* (REVALIDATE_MS), not a lifetime: an old
 * snapshot is still served immediately and replaced when the read lands, and
 * subscribers (`onChange`) re-render then, so a list that was empty a moment ago
 * fills in without the user touching the keyboard.
 *
 * An *empty* snapshot is the special case: "nobody yet" is a real answer, but
 * it is the one most likely to change under us — a brand-new user opens the
 * calendar once, imports their address book into Contacts, and comes straight
 * back. So an empty book is trusted for a minute (EMPTY_REFRESH_MS), not an
 * hour, and a query typed against it always counts as a miss.
 *
 * Everything here degrades to "no suggestions": on the open web there is no
 * desktop to launch anything (puter.env !== 'app'), Contacts may not be
 * installed, and the user may not have it. Suggestions come from the snapshot,
 * so they keep working when Contacts is briefly unreachable; and no call in this
 * module ever rejects into the guest field's typing path.
 */

/* ---- The contract with the Contacts app ---------------------------------- */
// Mirrored from contacts/src/api/protocol.js — a published contract between the
// two apps. Change them together and bump VERSION when the shape changes.
const CHANNEL = 'contacts-api';
const VERSION = 1;
const SERVICE_ARG = 'contacts-api';
const APP_NAME = 'contacts';

const REFRESH_AFTER_MS = 60 * 60 * 1000; // a snapshot this old is always re-read
const EMPTY_REFRESH_MS = 60 * 1000; // …but an *empty* one is only trusted this long
const REVALIDATE_MS = 2 * 60 * 1000; // …and this old is re-read at a safe moment
const MISS_REFRESH_MS = 60 * 1000; // shortest gap between "we look behind" reads
const IDLE_CLOSE_MS = 5000; // close the service window this long after the last call
const REQUEST_TIMEOUT_MS = 8000;
const LAUNCH_TIMEOUT_MS = 12_000; // includes Contacts' own boot
const RETRY_AFTER_MS = 60_000; // after a failure, don't try again for a while
const MAX_RETRY_MS = 10 * 60 * 1000; // …doubling per failure, up to this
const PAGE_SIZE = 1000; // contacts per `list` request
const MAX_PAGES = 10; // …so a very large book is read in at most this many
const DIRECTORY_MAX = 10_000; // hard ceiling on addresses held in memory

/* ---- The stored snapshot -------------------------------------------------- */
const STORE_PREFIX = 'cal:contacts:dir:';
const STORE_VERSION = 1;
const STORE_MAX_CHARS = 1_500_000; // don't push a huge book at a ~5MB quota

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (_e) {
    return null; // private mode, or storage disabled
  }
}

const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Everything a query is matched against, lowercased once up front. */
function haystack({ name, company, jobTitle, email, tags }) {
  return [name, company, jobTitle, email, ...(Array.isArray(tags) ? tags : [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/** One selectable address: a person plus one of their email addresses. */
function entriesFor(summary) {
  if (!summary || typeof summary !== 'object') return [];
  const emails = Array.isArray(summary.emails) ? summary.emails : [];
  const name = text(summary.name).trim();
  const company = text(summary.company).trim();
  const out = [];
  const seen = new Set();
  for (const row of emails) {
    const email = text(row && row.value).trim().toLowerCase();
    // Blank rows are skipped, and a duplicate address on one contact is one
    // entry. Walking the original rows (rather than a filtered copy) is what
    // keeps each address with its own label.
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      contactId: text(summary.id),
      name,
      email,
      label: text(row && row.label),
      company,
      favorite: Boolean(summary.favorite),
      // Where this address sits on its contact, so someone's several addresses
      // stay in the order they entered them instead of being alphabetized.
      pos: out.length,
      hay: haystack({ name, company, jobTitle: summary.jobTitle, email, tags: summary.tags }),
    });
  }
  return out;
}

/**
 * Make an entry safe to match against, or return null if it is past saving.
 * Snapshots are read back from disk, where they may have been written by an
 * older build or arrived truncated: one malformed row must not be able to throw
 * from inside a keystroke handler and take every suggestion with it.
 */
function reviveEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const email = text(e.email).trim().toLowerCase();
  if (!email) return null; // nothing to invite
  const name = text(e.name).trim();
  const company = text(e.company).trim();
  return {
    contactId: text(e.contactId),
    name,
    email,
    label: text(e.label),
    company,
    favorite: Boolean(e.favorite),
    pos: Number.isFinite(e.pos) ? e.pos : 0,
    hay: typeof e.hay === 'string' && e.hay ? e.hay : haystack({ name, company, email }),
  };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over one field, continuing from `h`, then a separator — so that two
 *  ways of splitting the same characters can't hash alike. */
function hashField(h, value) {
  const str = typeof value === 'string' ? value : String(value);
  let out = h;
  for (let i = 0; i < str.length; i++) {
    out ^= str.charCodeAt(i);
    out = Math.imul(out, FNV_PRIME);
  }
  out ^= 0x1f;
  return Math.imul(out, FNV_PRIME);
}

/**
 * A cheap fingerprint of a snapshot, to tell a real change from a re-read that
 * returned the same book — subscribers should only be woken for the former.
 *
 * Every field a suggestion is drawn from or matched against goes in. Ids and
 * addresses alone are not enough: renaming a contact, moving them to a new
 * company, relabelling an address or starring them all leave those two
 * untouched, so a re-read that picked the change up would be judged identical
 * and an open suggestion list would keep drawing the old one. `hay` carries the
 * job title and tags, which are matched on but never shown; `name` and
 * `company` go in as well because `hay` is lowercased and a capitalisation fix
 * is a real edit. Hashed field by field rather than joined, so a large address
 * book doesn't build a large string twice per read.
 */
function signature(entries) {
  if (!entries) return null;
  let h = FNV_OFFSET;
  for (const e of entries) {
    h = hashField(h, e.contactId);
    h = hashField(h, e.email);
    h = hashField(h, e.name);
    h = hashField(h, e.company);
    h = hashField(h, e.label);
    h = hashField(h, e.favorite ? '1' : '0');
    h = hashField(h, e.pos);
    h = hashField(h, e.hay);
  }
  return `${entries.length}:${h >>> 0}`;
}

/** How well an entry matches `q`; lower sorts first. Mirrors what the guest
 *  field shows: the name and the address, with a whole-word start counting as a
 *  strong hit ("khan" is a good match for "Nadia Khan"). */
function rank(entry, q) {
  const name = entry.name.toLowerCase();
  if (name.startsWith(q) || entry.email.startsWith(q)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 0;
  if (name.includes(q) || entry.email.includes(q)) return 1;
  return 2;
}

export function createContacts({
  getPuter = () => (typeof puter !== 'undefined' ? puter : null),
  appName = APP_NAME,
  now = () => Date.now(),
  // Which user's snapshot this is. Without one nothing is written to disk: a
  // shared device must never show one account's contacts to the next.
  userKey = '',
  refreshAfterMs = REFRESH_AFTER_MS,
  emptyRefreshMs = EMPTY_REFRESH_MS,
  revalidateMs = REVALIDATE_MS,
  missRefreshMs = MISS_REFRESH_MS,
  idleCloseMs = IDLE_CLOSE_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  launchTimeoutMs = LAUNCH_TIMEOUT_MS,
  retryAfterMs = RETRY_AFTER_MS,
  maxRetryMs = MAX_RETRY_MS,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
} = {}) {
  let conn = null; // the live AppConnection, or null
  let connecting = null; // in-flight connect(), so callers share one launch
  let pending = new Map(); // request id -> { resolve, reject, timer }
  let nextId = 1;
  let idleTimer = null;
  let generation = 0; // bumped by disconnect(), so a late launch is abandoned
  let entries = null; // the flattened directory snapshot
  let fetchedAt = 0;
  let restored = false; // have we tried the stored snapshot yet this session?
  let loading = null; // in-flight directory read
  let blockedUntil = 0; // set after a failure, so we stop retrying for a bit
  let failures = 0; // consecutive failures, for how long that block lasts
  let lastMissRefresh = 0; // throttle for the "we look behind" refresh
  let behind = false; // evidence the book moved on; acted on once typing stops
  let rereadAfterLoad = false; // a `changed` notice arrived mid-read; go again
  let used = false; // has anything actually asked for suggestions this session?
  const listeners = new Set();

  const storeKey = () => (userKey ? `${STORE_PREFIX}${userKey}` : '');

  /** Can we talk to other apps at all? Only true inside the Puter desktop. */
  function supported() {
    const p = getPuter();
    return Boolean(p && p.env === 'app' && p.ui && typeof p.ui.launchApp === 'function');
  }

  /** Is launching Contacts something we should try right now? */
  function available() {
    return supported() && now() >= blockedUntil;
  }

  /** Stop trying for a while, doubling the wait for a Contacts app that keeps
   *  failing: a missing or denied one must not turn every safe moment into
   *  another doomed launch. Cleared by the first success. */
  function backOff(err) {
    failures += 1;
    const wait = Math.min(retryAfterMs * 2 ** (failures - 1), maxRetryMs);
    blockedUntil = now() + wait;
    if (err) console.warn('[calendar] contacts unavailable:', err.message || err);
  }

  function clearIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  /** Let the service window go once we've been quiet for a moment. */
  function scheduleIdleClose() {
    clearIdle();
    if (!conn) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pending.size) return scheduleIdleClose();
      disconnect();
    }, idleCloseMs);
  }

  function rejectPending(reason) {
    const err = new Error(reason);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending = new Map();
  }

  /** Drop the connection. `gone: true` means the service already closed itself,
   *  so there is nothing left to close from this side. */
  function disconnect({ gone = false } = {}) {
    clearIdle();
    generation++;
    const c = conn;
    conn = null;
    connecting = null;
    rejectPending('The contacts service closed');
    if (c && !gone) closeQuietly(c);
  }

  function closeQuietly(connection) {
    try {
      connection.close();
    } catch (_e) {
      /* already gone */
    }
  }

  /** Tell subscribers the snapshot changed. A listener that throws is its own
   *  problem: this is called from the tail of a background read. */
  function announce() {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        console.warn('[calendar] contacts listener failed:', err && err.message);
      }
    }
  }

  /* ---- The stored snapshot ----------------------------------------------- */

  /** Read the snapshot left by an earlier session, if it's still usable. */
  function restore() {
    restored = true;
    const store = storage();
    const key = storeKey();
    if (!store || !key) return null;
    // Another account's snapshot on this browser is someone else's address
    // book at rest. Sign-out drops the signed-out account's own; a session
    // that simply expired and was followed by a different sign-in never went
    // through that path, so apply the rule the offline calendar snapshot
    // applies (ensureUser): one account's data on disk at a time.
    try {
      const stale = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(STORE_PREFIX) && k !== key) stale.push(k);
      }
      for (const k of stale) store.removeItem(k);
    } catch (_e) {
      /* best-effort */
    }
    try {
      const raw = store.getItem(key);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || saved.v !== STORE_VERSION || !Array.isArray(saved.entries)) {
        store.removeItem(key); // written by an older shape; start over
        return null;
      }
      const revived = saved.entries.map(reviveEntry).filter(Boolean);
      if (saved.entries.length && !revived.length) {
        // We were given rows and could make nothing of any of them. Treat that as
        // "nothing cached" rather than trusting a file we know is not usable — an
        // address book that is genuinely empty (no rows at all) is kept, and is
        // a perfectly good answer.
        store.removeItem(key);
        return null;
      }
      entries = revived;
      // Clamped: a stamp from the future (the clock moved back since it was
      // written) would otherwise keep this snapshot "fresh" until the clock
      // catches up — hours of never revalidating. Age zero is the honest cap.
      fetchedAt = Math.min(Number(saved.fetchedAt) || 0, now());
      return entries;
    } catch (_e) {
      // Unreadable or corrupt: forget it rather than carry it around.
      try {
        store.removeItem(key);
      } catch (_e2) {
        /* nothing more to do */
      }
      return null;
    }
  }

  function persist() {
    const store = storage();
    const key = storeKey();
    if (!store || !key || !entries) return;
    try {
      const raw = JSON.stringify({ v: STORE_VERSION, fetchedAt, entries });
      // A very large address book isn't worth risking the whole quota for; it
      // simply stays in memory for this session.
      if (raw.length > STORE_MAX_CHARS) return;
      store.setItem(key, raw);
    } catch (_e) {
      /* out of quota or storage disabled — the in-memory copy still works */
    }
  }

  function forget() {
    const had = Boolean(entries && entries.length);
    entries = null;
    fetchedAt = 0;
    restored = false; // so a later read isn't served by a snapshot we dropped
    const store = storage();
    const key = storeKey();
    if (store && key) {
      try {
        store.removeItem(key);
      } catch (_e) {
        /* best-effort */
      }
    }
    if (had) announce();
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.$ !== CHANNEL) return;
    if (msg.type === 'changed') {
      // The address book moved under us. Re-read it rather than just dropping
      // what we have: this arrives while we are connected, so the read costs no
      // launch, and a subscriber gets fresh suggestions instead of none. Should
      // that read fail, then we do drop it — a copy we know is out of date is not
      // one to keep, on disk least of all.
      // (Note this only covers changes the instance we launched can see — see
      // the freshness note at the top of the file.)
      refresh({ force: true }).then((next) => {
        if (!next) forget();
      });
      return;
    }
    const entry = msg.id ? pending.get(msg.id) : null;
    if (!entry) return; // a reply we no longer care about, or the `ready` notice
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error((msg.error && msg.error.message) || 'The request failed'));
  }

  /**
   * Launch Contacts in service mode and wait for it to say hello. Resolves to
   * the AppConnection; rejects (and backs off) if it never arrives.
   */
  function connect() {
    if (conn) return Promise.resolve(conn);
    if (connecting) return connecting;
    if (!available()) return Promise.reject(new Error('Contacts is not available here'));

    const p = getPuter();
    const gen = generation;
    connecting = new Promise((resolve, reject) => {
      let settled = false;
      let opened = null; // set once launchApp resolves
      let timer = null;

      // Never leave a service window behind: if it opened but never said hello,
      // close it on the way out.
      const giveUp = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (opened) closeQuietly(opened);
        reject(err);
      };
      timer = setTimeout(() => giveUp(new Error('Contacts did not respond')), launchTimeoutMs);

      // `background: true` asks the desktop not to show the window at all.
      // Older desktops ignore it and show one, which Contacts then hides
      // itself — a brief flash rather than a broken launch.
      Promise.resolve(
        p.ui.launchApp({ name: appName, args: { service: SERVICE_ARG }, background: true }),
      )
        .then((connection) => {
          if (!connection || connection.usesSDK === false) {
            throw new Error('Contacts did not open with messaging support');
          }
          opened = connection;
          // Timed out, or torn down (dispose) while the launch was in flight.
          // Either way the window is ours to clean up: giveUp() ran before we
          // had anything to close.
          if (settled || gen !== generation) {
            closeQuietly(connection);
            giveUp(new Error('Contacts was closed'));
            return;
          }
          connection.on('message', onMessage);
          connection.on('close', () => {
            if (conn === connection) {
              disconnect({ gone: true });
              return;
            }
            // Closed before it ever said hello. That is the ordinary shape of
            // "Contacts is not going to serve us" — not installed, not allowed,
            // nobody signed in — because the service exits as soon as it works
            // that out. Waiting out the launch timeout instead only delays the
            // backoff, and blocks every caller sharing this launch for twelve
            // seconds first. `giveUp` is a no-op once we're settled, so a close
            // arriving after an idle disconnect changes nothing.
            giveUp(new Error('Contacts closed before it was ready'));
          });
          // The service announces itself once it's listening; treat that as the
          // handshake, so the first real request can't race its own listener.
          const ready = (msg) => {
            if (!msg || msg.$ !== CHANNEL || msg.type !== 'ready') return;
            if (typeof connection.off === 'function') connection.off('message', ready);
            if (settled) return;
            // Torn down between the launch and the handshake: adopting the
            // connection now would leave a window open (and a read running)
            // for a client that has been disposed.
            if (gen !== generation) {
              closeQuietly(connection);
              giveUp(new Error('Contacts was closed'));
              return;
            }
            settled = true;
            clearTimeout(timer);
            conn = connection;
            resolve(connection);
          };
          connection.on('message', ready);
        })
        .catch(giveUp);
    })
      .catch((err) => {
        backOff(err);
        throw err;
      })
      .finally(() => {
        connecting = null;
      });

    return connecting;
  }

  /**
   * Call a Contacts API method. Rejects on transport failure, on a timeout, or
   * with the message Contacts sent back.
   *
   * @param {string} method e.g. 'search', 'create', 'update', 'delete'
   * @param {object} [params]
   */
  async function call(method, params = {}) {
    const connection = await connect();
    const id = `c${nextId++}`;
    clearIdle();
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Contacts timed out on "${method}"`));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
    try {
      // postMessage can throw synchronously (the window closed under us before
      // its `close` event was delivered). The pending entry must go with it, or
      // its timer would later reject a promise nobody holds.
      connection.postMessage({ $: CHANNEL, v: VERSION, id, method, params });
      return await result;
    } catch (err) {
      const entry = pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(id);
      }
      throw err;
    } finally {
      scheduleIdleClose();
    }
  }

  /** Whatever snapshot we have, restoring the stored one the first time. */
  function localEntries() {
    if (!entries && !restored) restore();
    return entries;
  }

  /**
   * Read the whole directory, a page at a time. Contacts caps a single `list`,
   * so a book bigger than one page is followed with `offset` rather than
   * quietly truncated at the first page's worth of people.
   */
  async function readDirectory() {
    const collected = [];
    // A page boundary is the one place the book can shift under us — someone
    // saving a contact between two requests — which would otherwise show the
    // same person twice. Counting people (not addresses) is also how we know
    // whether we really reached the end.
    const people = new Set();
    // One entry per *address*, not per contact-and-address. Two people who
    // share a mailbox would otherwise both be offered, and picking either adds
    // the same guest — a choice with no difference behind it. Contacts answers
    // its own `suggest` the same way, so the two paths to a suggestion cannot
    // disagree; `list` is sorted, so which contact keeps a shared address is
    // the same on both sides and the same on every read.
    const addresses = new Set();
    let offset = 0;
    let total = 0;
    for (let page = 0; page < maxPages; page++) {
      const result = await call('list', { limit: pageSize, offset });
      const list = (result && Array.isArray(result.contacts) && result.contacts) || [];
      total = Number(result && result.total) || total;
      for (const summary of list) {
        const id = text(summary && summary.id);
        if (id) {
          if (people.has(id)) continue;
          people.add(id);
        }
        for (const entry of entriesFor(summary)) {
          if (addresses.has(entry.email)) continue;
          addresses.add(entry.email);
          collected.push(entry);
        }
      }
      offset += list.length;
      // A short page (or none at all) means we have reached the end. Guard
      // against a service that ignores `offset`, too: the count still advances,
      // so the loop ends instead of asking for the first page forever.
      if (!list.length || list.length < pageSize || offset >= total) break;
      if (collected.length >= DIRECTORY_MAX) break;
    }
    if (total > people.size) {
      // Say so rather than silently suggesting from a partial address book.
      console.warn(`[calendar] suggesting from ${people.size} of ${total} contacts`);
    }
    return collected.slice(0, DIRECTORY_MAX);
  }

  /**
   * Re-read the directory from Contacts. One read at a time; never throws.
   * A failed read leaves the snapshot we already have in place — stale
   * suggestions beat none — and subscribers hear about it only if it changed.
   */
  function refresh({ force = false } = {}) {
    if (loading) {
      // A forced refresh means the book changed. The read already in flight may
      // have started before that change, so it cannot satisfy this request —
      // landing its result as "fresh" is exactly the staleness `changed` exists
      // to prevent. Note it, and run one more read once this one settles.
      if (force) rereadAfterLoad = true;
      return loading;
    }
    if (!force && !available()) return Promise.resolve(null);
    if (force && !supported()) return Promise.resolve(null);
    const before = signature(entries);
    loading = readDirectory()
      .then((next) => {
        failures = 0;
        blockedUntil = 0; // a working Contacts clears any earlier backoff
        entries = next;
        fetchedAt = now();
        persist();
        if (signature(next) !== before) announce();
        return entries;
      })
      .catch((err) => {
        if (err) console.warn('[calendar] could not read contacts:', err.message || err);
        // A read that failed after a successful launch counts against Contacts
        // too: without this, only launches backed off, and a service that opens
        // but cannot answer would be relaunched at every safe moment. (A failed
        // launch has already backed off inside connect() — don't double-count.)
        if (now() >= blockedUntil) backOff();
        return null;
      })
      .finally(() => {
        loading = null;
        if (rereadAfterLoad) {
          rereadAfterLoad = false;
          refresh({ force: true });
        }
      });
    return loading;
  }

  /**
   * Make sure we have something to suggest from, launching Contacts only when
   * we have nothing or what we have is old. A snapshot from an earlier session
   * counts: launching another app is the expensive part, and the copy on disk
   * is what keeps most sessions from doing it at all. Never throws.
   */
  /**
   * How long the snapshot we hold is good for without a re-read. An empty book
   * gets far less trust than a populated one: "nobody yet" is a legitimate
   * answer — not a missing snapshot — but it is also the answer most likely to
   * change under us, because a brand-new user is usually about to import their
   * address book. Trusting it for the populated book's hour is how a first
   * import stays invisible for the rest of the session and the next.
   */
  function trustFor(have) {
    return have.length ? refreshAfterMs : emptyRefreshMs;
  }

  function ensureDirectory() {
    const have = localEntries();
    if (have && now() - fetchedAt < trustFor(have)) return Promise.resolve(have);
    // No snapshot at all, or an aged "nobody yet": either way there is nothing
    // usable to serve while the read runs, so hand back the read itself.
    if (!have || !have.length) return refresh();
    // Stale but usable: serve it now and re-read in the background.
    refresh();
    return Promise.resolve(have);
  }

  /**
   * Re-read the snapshot if it is older than `maxAgeMs`. Called at the moments
   * listed at the top of the file — never from the typing path, because
   * launching an app is the one thing here that can disturb the window someone
   * is typing into. Resolves when the read it started lands (immediately if it
   * started none), and never rejects.
   */
  function revalidate({ maxAgeMs = revalidateMs } = {}) {
    if (loading) return loading;
    if (!available()) return Promise.resolve(null);
    const have = localEntries();
    if (have && now() - fetchedAt < Math.min(maxAgeMs, trustFor(have))) {
      return Promise.resolve(have);
    }
    return refresh();
  }

  /**
   * Act on evidence that the book moved on without us — a query that found
   * nobody, or an address typed in by hand that we have never seen. Deliberately
   * NOT done while the user is still typing; `settle()` acts on it once they
   * leave the field. Throttled, since most misses are just typos.
   */
  function refreshWhenBehind() {
    if (loading || !available()) return;
    // A populated book also throttles against its own read time — a miss there
    // is usually a typo, and a book read seconds ago has nothing new to say. An
    // empty one gets no such shield: a query against nobody is a certain miss,
    // so only the refresh-to-refresh throttle applies.
    const anchor =
      entries && entries.length ? Math.max(fetchedAt, lastMissRefresh) : lastMissRefresh;
    if (now() - anchor < missRefreshMs) return;
    lastMissRefresh = now();
    refresh();
  }

  return {
    /** True when a launch of Contacts is worth attempting right now. Suggestions
     *  do not need this — see `ready()`. */
    available,

    /**
     * True when suggestions are possible at all: we hold a snapshot, or we are
     * somewhere we could read one. Deliberately not sensitive to a Contacts app
     * that is briefly unreachable — the snapshot answers queries on its own, and
     * hiding the whole combobox over a failed launch is how a transient error
     * turns into "the autocomplete is broken". Safe to call on every render.
     */
    ready() {
      const have = localEntries();
      return Boolean((have && have.length) || supported());
    },

    /** Make sure there is something to suggest from, so the first keystroke has
     *  matches. Usually a no-op: the snapshot from a previous session is read
     *  from disk without launching anything. Never rejects. */
    warm() {
      return ensureDirectory().then(() => undefined);
    },

    /** Re-read the address book if ours has gone stale, at a moment where
     *  launching an app is safe. Cheap and throttled; never rejects. */
    revalidate,

    /**
     * Called when the snapshot changes — a read landed with something new, or it
     * was dropped. The guest field uses this to fill in a list that was empty
     * when the user started typing. Returns an unsubscribe function.
     */
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Has anything asked for suggestions this session? Lets the app skip
     *  background reads for someone who never invites anyone. */
    inUse() {
      return used;
    },

    /**
     * Suggestions for a partially-typed guest, best match first. Returns [] —
     * never throws, never blocks — when there is no snapshot yet; the read it
     * starts will announce itself through `onChange`.
     *
     * @param {string} query
     * @param {number} [limit]
     * @returns {Array<{contactId: string, name: string, email: string, label: string, company: string, favorite: boolean}>}
     */
    suggest(query, limit = 6) {
      used = true;
      const have = localEntries();
      if (!have || !have.length) {
        // With nobody to match, any real query is a miss — the miss logic below
        // is never reached, so note it here, or an empty book would be the one
        // state `settle()` can't recover from.
        if (text(query).trim()) behind = true;
        ensureDirectory();
        return [];
      }
      const q = text(query).trim().toLowerCase();
      try {
        const terms = q ? q.split(/\s+/) : [];
        const pool = terms.length
          ? have.filter((e) => terms.every((term) => e.hay.includes(term)))
          : have;
        // Nobody matched: the snapshot may simply predate this person. Noted,
        // not acted on — see settle().
        if (q && !pool.length) behind = true;
        return pool
          .map((e) => ({ e, r: q ? rank(e, q) : 0 }))
          .sort(
            (a, b) =>
              a.r - b.r ||
              Number(b.e.favorite) - Number(a.e.favorite) ||
              a.e.name.localeCompare(b.e.name, undefined, { sensitivity: 'base' }) ||
              a.e.pos - b.e.pos ||
              a.e.email.localeCompare(b.e.email),
          )
          .slice(0, limit)
          .map(({ e }) => ({
            contactId: e.contactId,
            name: e.name,
            email: e.email,
            label: e.label,
            company: e.company,
            favorite: e.favorite,
          }));
      } catch (err) {
        // Something in the snapshot is not what we think it is. Throw it away
        // and read it again, so a bad copy costs one query rather than every
        // query for as long as it sits on disk.
        console.warn('[calendar] dropping an unusable contacts snapshot:', err && err.message);
        forget();
        refresh();
        return [];
      }
    },

    /**
     * Does the address book, as currently snapshotted, include this address?
     * An exact, case-insensitive match — no fuzzy ranking, no launch, no
     * network read: it only reads whatever snapshot is already in memory or
     * on disk. `false` when there is no snapshot at all — "unknown" is the
     * honest answer to a book we haven't got, not a reason to go fetch one
     * from inside a caller (mail-intake.js's trust check) that must never
     * itself trigger a Contacts launch.
     */
    knows(email) {
      const address = text(email).trim().toLowerCase();
      if (!address) return false;
      // localEntries() only restores what's already on disk (a synchronous
      // local read) — never a Contacts launch, never a network call.
      const have = localEntries();
      return Boolean(have && have.some((e) => e.email === address));
    },

    /**
     * Note an address the user typed in by hand. One we don't know is the
     * clearest evidence there is that our copy of the book is behind — they are
     * inviting someone we have never heard of — so it counts the same as a query
     * that found nobody: acted on by `settle()`, once typing is over.
     */
    noteTyped(email) {
      const address = text(email).trim().toLowerCase();
      if (!address) return;
      const have = localEntries();
      if (!have || !have.some((e) => e.email === address)) behind = true;
    },

    /**
     * The user has finished with the field. If anything suggested our copy is
     * behind while they were typing, re-read the directory now — the safe moment
     * to launch an app, with no text entry in flight to disturb. No-op otherwise.
     */
    settle() {
      if (!behind) return;
      behind = false;
      refreshWhenBehind();
    },

    /** Drop the snapshot, on disk as well as in memory, so the next read goes
     *  back to Contacts. Call this on sign-out: the copy is one user's. */
    invalidate: forget,

    /* The rest of the Contacts API, for a caller that wants live data rather
     * than the snapshot. Each opens the service if it isn't already open, and
     * rejects with a readable message when Contacts is unreachable.
     *
     * Reads only, and deliberately: Contacts grants the calendar its read
     * methods and nothing else, because an app that puts a name into a guest
     * field has no business renaming or deleting the person behind it. Wrappers
     * for `create`/`update`/`delete` would be wrappers around a refusal. */
    call,
    search: (query, opts = {}) => call('search', { query, ...opts }),
    get: (id) => call('get', { id }).then((r) => r && r.contact),

    /** Close the service window and drop the in-memory snapshot. The stored one
     *  is left alone — that's what `invalidate()` is for. */
    dispose() {
      disconnect();
      listeners.clear();
      entries = null;
      fetchedAt = 0;
      restored = false;
      used = false;
      behind = false;
      rereadAfterLoad = false; // a queued re-read must not outlive its client
    },
  };
}
