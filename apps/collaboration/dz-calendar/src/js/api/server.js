/**
 * Transport for the Calendar API: reads requests off an AppConnection,
 * dispatches them to the method table, and posts replies back.
 *
 * One request → one reply, matched by the caller's `id`:
 *   in   { $: 'calendar-api', v: 1, id, method, params }
 *   out  { $: 'calendar-api', v: 1, id, ok: true,  result }
 *        { $: 'calendar-api', v: 1, id, ok: false, error: { code, message, details? } }
 *
 * Two unsolicited notices are also posted (neither carries an `id`):
 *   { $: 'calendar-api', v: 1, type: 'ready',   methods: [...], scope? }  — on
 *       start; `scope` ({ has: [...] }) is present only for a caller whose
 *       grant covers a slice of the calendar rather than all of it.
 *   { $: 'calendar-api', v: 1, type: 'changed' }                  — after the
 *       calendar actually changed, so a client can drop a cached answer.
 *       Reads never provoke one, however often the store re-reads itself.
 *
 * Anything in neither shape is ignored: the connection is shared with whatever
 * else the two apps say to each other.
 */
import {
  ALLOWED_CALLERS,
  ApiError,
  CHANNEL,
  ERRORS,
  PROTOCOL_VERSION,
  grantedMethods,
  isRequest,
} from './protocol.js';

const CHANGED_DEBOUNCE_MS = 250;

/**
 * Serve the API to whichever app opened `connection`.
 *
 * @param {object} deps
 * @param {{ on: Function, off?: Function, postMessage: Function }} deps.connection
 *   the AppConnection from `puter.ui.parentApp()`
 * @param {string} deps.callerApp the launching app's name, per readLaunchContext()
 * @param {Record<string, Function>} deps.methods method table (see createMethods)
 * @param {{ has: string[] }|null} [deps.scope] the caller's scope, already
 *   applied inside `methods`; announced in `ready` so the caller can tell
 * @param {object} [deps.allowed] caller → grant map, for tests
 * @param {(fn: Function) => Function} [deps.subscribe] store subscribe, to
 *   announce changes; its unsubscribe is called by stop()
 * @param {() => (string|null)} [deps.revision] a fingerprint of the calendar
 *   (store.revision), so a `changed` notice is sent only when it really did.
 *   Omitted, every store emit is announced — safe, but noisy; see below.
 * @param {(method: string) => void} [deps.onActivity] called per accepted request
 * @returns {{ stop: () => void, granted: string[] } | null} null when the caller
 *   has no grant — in that case nothing is listened to at all.
 */
export function startApiServer({
  connection,
  callerApp,
  methods,
  scope = null,
  allowed = ALLOWED_CALLERS,
  subscribe = null,
  revision = null,
  onActivity = null,
}) {
  if (!connection || typeof connection.postMessage !== 'function') return null;

  const granted = grantedMethods(callerApp, allowed);
  // An app with no grant gets no listener, so an unauthorized caller can't even
  // tell whether a method exists — and can never reach the store.
  if (!granted.length) return null;
  const grantedSet = new Set(granted);

  function reply(id, payload) {
    connection.postMessage({ $: CHANNEL, v: PROTOCOL_VERSION, id, ...payload });
  }

  function fail(id, code, message, details) {
    reply(id, { ok: false, error: details ? { code, message, details } : { code, message } });
  }

  function touch(method) {
    if (!onActivity) return;
    try {
      onActivity(method);
    } catch {
      /* an activity hook must never break a request */
    }
  }

  async function handle(msg) {
    const { id, method } = msg;
    if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
      fail(id, ERRORS.VERSION, `This app speaks calendar-api v${PROTOCOL_VERSION}`);
      return;
    }
    // Unknown and un-granted are one answer on purpose: the reply must not
    // reveal which methods exist beyond what this caller may use.
    if (!grantedSet.has(method) || typeof methods[method] !== 'function') {
      fail(id, ERRORS.UNKNOWN_METHOD, `"${method}" is not available to this app`);
      return;
    }
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    touch(method);
    try {
      let result = await methods[method](params);
      // `ping` describes the API to whoever asked — and the same rule applies
      // as to the un-granted answer above: it names the methods THIS caller
      // may use (the list `ready` carried), not the whole table.
      if (method === 'ping' && result && typeof result === 'object' && 'methods' in result) {
        result = { ...result, methods: [...granted] };
      }
      reply(id, { ok: true, result });
    } catch (err) {
      if (err instanceof ApiError) {
        fail(id, err.code, err.message, err.details);
      } else {
        // Don't leak internals to another app; the details stay in our console.
        console.error('[calendar-api]', method, err);
        fail(id, ERRORS.STORAGE, 'The request could not be completed');
      }
    }
  }

  const onMessage = (msg) => {
    if (!isRequest(msg)) return;
    handle(msg).catch((err) => console.error('[calendar-api]', err));
  };

  connection.on('message', onMessage);

  // The calendar as the caller last saw it, so `changed` can mean what it says.
  // The store emits for more than a change to the events: a freshness re-read
  // that found nothing new emits, and so do settings and tasks, which this API
  // does not serve at all. Announcing those told a caller to throw away a
  // perfectly good answer — and a caller that re-reads on `changed` paid for
  // every read twice.
  //
  // `null` means the calendar has not been read yet. The first read is the
  // caller's own first answer, so it establishes the baseline rather than
  // announcing. Without `revision` we announce on every emit, which is the safe
  // direction to be wrong in: a caller can absorb a notice it did not need, but
  // not a change it was never told about.
  const currentRevision = () => {
    if (typeof revision !== 'function') return null;
    try {
      return revision();
    } catch {
      // A fingerprint we cannot compute must not silence the notice.
      return null;
    }
  };
  let announcedRevision = currentRevision();
  const hasRevisions = typeof revision === 'function';

  /** True when there is genuinely new data to tell the caller about. */
  function shouldAnnounce() {
    if (!hasRevisions) return true;
    const now = currentRevision();
    if (now === null) return false; // nothing readable yet, or unknowable
    if (announcedRevision === null) {
      // The first read of the calendar (normally already taken by the
      // subscriber above). Whatever the caller asks next carries it.
      announcedRevision = now;
      return false;
    }
    if (now === announcedRevision) return false;
    announcedRevision = now;
    return true;
  }

  let changedTimer = null;
  const unsubscribe = subscribe
    ? subscribe(() => {
        // The calendar's first read is the baseline, and it must be taken the
        // moment that read emits — not when the debounce below runs. A fresh
        // service instance answering a caller's `create` loads the calendar
        // and writes to it a few milliseconds apart; deferring the baseline
        // folded the write into it, and the caller's own change was never
        // announced (Contacts kept showing a stale "coming up" for minutes).
        if (hasRevisions && announcedRevision === null) {
          const now = currentRevision();
          if (now !== null) announcedRevision = now;
        }
        // Coalesced: one change can emit several times (optimistic write, then
        // confirmation), and the client only needs to know "ask again".
        // Deciding *after* the wait is deliberate — an optimistic write that
        // rolls back inside it leaves the calendar as it was, and says nothing.
        if (changedTimer) return;
        changedTimer = setTimeout(() => {
          changedTimer = null;
          if (!shouldAnnounce()) return;
          connection.postMessage({ $: CHANNEL, v: PROTOCOL_VERSION, type: 'changed' });
        }, CHANGED_DEBOUNCE_MS);
      })
    : null;

  const ready = { $: CHANNEL, v: PROTOCOL_VERSION, type: 'ready', methods: granted };
  if (scope && Array.isArray(scope.has) && scope.has.length) ready.scope = { has: [...scope.has] };
  connection.postMessage(ready);

  return {
    granted,
    stop() {
      if (typeof connection.off === 'function') connection.off('message', onMessage);
      if (changedTimer) clearTimeout(changedTimer);
      changedTimer = null;
      if (unsubscribe) unsubscribe();
    },
  };
}
