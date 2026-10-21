/**
 * Sign links: self-serve signing over a per-user Puter worker.
 *
 * The app's only backend is Puter, which signers (who may have no Puter
 * account at all) can't touch. So each user gets their own serverless worker
 * (`https://doc-sign-….puter.work`, deployed here on first send from the
 * template in src/workers/sign-worker.js) that runs under THEIR account and
 * serves per-signer capability URLs: unguessable tokenized links a signer
 * opens to review and sign, the industry-standard link-signing pattern.
 *
 * Division of state:
 *   - The app's KV keeps the worker config (`sig:worker:cfg:v1`: name, url,
 *     admin secret) and, per document, the owner's copy of the raw links
 *     (in the document record). Raw tokens live ONLY there.
 *   - The worker's KV keeps token HASHES, document snapshots, and signers'
 *     submissions. The app and the worker share no KV namespace; they talk
 *     over the worker's /admin/* HTTP routes, authenticated with
 *     `Bearer <secret>` (the worker stores only SHA-256(secret)).
 *
 * Unlike the calendar's RSVP module this one never syncs on a debounce:
 * snapshots are pushed when the owner sends, signs, or voids, and responses
 * are pulled on boot, on an interval, and when a document is opened.
 */

const workerSource = '';
import { coerce, randomHex, sha256Hex } from './util.js';
import { pdfPath } from './store.js';
import { sendChannel } from './model.js';

// Bump when src/workers/sign-worker.js changes shape: ensureWorker() then
// rewrites the deployed source in place (same URL, sent links survive).
export const SIGN_WORKER_VERSION = '17';

const CFG_KEY = 'sig:worker:cfg:v1';
const PULL_MIN_MS = 45_000;

export function createSignLinks({
  store,
  getPuter = () => (typeof puter !== 'undefined' ? puter : null),
  fetchFn = (...args) => fetch(...args),
  verifyAttempts = 6,
  verifyDelayMs = 3000,
  source = workerSource,
  // Where the worker sends humans for UI (it serves none itself). Frozen into
  // the worker at deploy; a version bump redeploys with the current origin.
  pageUrl = (typeof location !== 'undefined' && location.origin && location.origin !== 'null'
    ? location.origin + location.pathname.replace(/[^/]*$/, '')
    : 'https://puter.com/') + 'sign.html',
  // Where the owner's own copy of a document lives, for the link in the
  // completion mail the worker sends them.
  appUrl = pageUrl.replace(/sign\.html$/, ''),
} = {}) {
  const docUrlFor = (docId) =>
    (/^https:\/\//.test(appUrl) ? appUrl + '#/doc/' + docId : '');
  let cfg = null;
  let cfgSaved = false; // whether the in-memory cfg has definitely reached KV
  let lastPullAt = 0;
  let chain = Promise.resolve(); // serializes every network pass

  const kv = () => getPuter().kv;

  function available() {
    const p = getPuter();
    return Boolean(p && p.workers && typeof p.workers.create === 'function');
  }

  /* ---- Worker deployment ------------------------------------------------ */

  function buildSource(secretHash) {
    return source
      .replace('__SIGN_ADMIN_SECRET_HASH__', secretHash)
      .replace('__SIGN_WORKER_VERSION__', SIGN_WORKER_VERSION)
      .replace('__SIGN_PAGE_URL__', pageUrl);
  }

  async function persistCfg() {
    await kv().set(CFG_KEY, cfg);
    cfgSaved = true;
  }

  async function loadCfg() {
    const stored = coerce(await kv().get(CFG_KEY));
    if (stored && stored.secret) {
      cfg = stored;
      cfgSaved = true;
    }
    return cfg;
  }

  /**
   * A deploy is not done until the LIVE worker reports the expected version.
   * Never stamp cfg.version from the constant alone: verification polls
   * through the platform's 5-30s propagation window, and a failure leaves
   * cfg un-stamped so the next pass rewrites the source again.
   */
  let verifyBlockedUntil = 0;

  async function verifyDeployed(url, secret) {
    let delay = verifyDelayMs;
    for (let attempt = 0; attempt < verifyAttempts; attempt++) {
      try {
        const res = await fetchFn(`${url}/admin/ping`, {
          headers: { authorization: `Bearer ${secret}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.version === SIGN_WORKER_VERSION) {
            verifyBlockedUntil = 0;
            return;
          }
        }
      } catch {
        /* not propagated yet */
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(8000, delay + 1500);
    }
    verifyBlockedUntil = Date.now() + 120_000;
    throw new Error('signlinks: deployed worker did not come up on the expected version');
  }

  async function ensureWorker(depth = 0) {
    // Never trust a missing in-memory copy: deploying a second worker would
    // orphan every link the first one issued. Re-read the config first.
    if (!cfg) await loadCfg();
    if (cfg && cfg.secret && cfg.url && cfg.version === SIGN_WORKER_VERSION) {
      if (!cfgSaved) await persistCfg();
      return cfg;
    }

    const p = getPuter();
    if (!p || !p.workers || !p.fs) throw new Error('signlinks: Puter workers are unavailable');
    if (Date.now() < verifyBlockedUntil) {
      throw new Error('signlinks: worker deploy pending (cooling down after a failed verify)');
    }

    if (cfg && cfg.secret && cfg.name) {
      // Version upgrade: overwrite the source file in place. The worker keeps
      // its URL, so every link already sent out survives.
      const code = buildSource(await sha256Hex(cfg.secret));
      let path = 'sign-worker.js';
      try {
        const info = await p.workers.get(cfg.name);
        if (info && info.file_path) path = info.file_path;
      } catch {
        /* fall back to the original path */
      }
      await p.fs.write(path, code, { createMissingParents: true });
      await verifyDeployed(cfg.url, cfg.secret);
      cfg = { ...cfg, version: SIGN_WORKER_VERSION };
      await persistCfg();
      return cfg;
    }

    // First use: mint the admin secret; only its hash goes into the source.
    const secret = randomHex(32);
    const code = buildSource(await sha256Hex(secret));
    const filePath = 'sign-worker.js';
    await p.fs.write(filePath, code, { createMissingParents: true });
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Another tab/device may have deployed while we prepared; adopt theirs
      // rather than racing a second worker into existence.
      if (depth < 2 && (await loadCfg().catch(() => null))) return ensureWorker(depth + 1);
      const name = `doc-sign-${randomHex(5)}`; // random: no username in the URL
      let dep;
      try {
        dep = await p.workers.create(name, filePath);
      } catch (err) {
        lastErr = err; // most likely a name collision; retry with a fresh one
        continue;
      }
      const url = String((dep && dep.url) || `https://${name}.puter.work`).replace(/\/+$/, '');
      // Persist BEFORE verifying, with a null version: the worker must never
      // be orphaned (a re-run would deploy a duplicate), and a null version
      // routes the next ensureWorker() into the self-healing upgrade branch.
      cfg = { name, url, secret, version: null, createdAt: Date.now() };
      cfgSaved = false;
      try {
        await persistCfg();
      } catch {
        /* healed by the cfgSaved check on the next ensureWorker() */
      }
      // Close the race window: if another tab's cfg won the KV write, adopt
      // it and drop our just-created (still linkless) worker.
      const adoptWinner = async () => {
        const winner = coerce(await kv().get(CFG_KEY));
        if (!winner || !winner.secret || !winner.name || winner.name === name) return false;
        if (typeof p.workers.delete === 'function') {
          await p.workers.delete(name).catch(() => {});
        }
        cfg = winner;
        cfgSaved = true;
        return true;
      };
      try {
        if (await adoptWinner()) return cfg;
      } catch {
        /* keep ours */
      }
      await verifyDeployed(url, secret);
      try {
        if (await adoptWinner()) return cfg;
      } catch {
        /* keep ours */
      }
      cfg = { ...cfg, version: SIGN_WORKER_VERSION };
      await persistCfg();
      return cfg;
    }
    throw lastErr || new Error('signlinks: could not deploy the sign worker');
  }

  async function admin(path, body) {
    const c = await ensureWorker();
    const res = await fetchFn(c.url + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${c.secret}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`signlinks: ${path} failed (${res.status})`);
    return res.json();
  }

  /* ---- Snapshots ----------------------------------------------------------- */

  /** What the worker needs to serve this document's signers. */
  async function snapshotOf(doc) {
    const user = store.user || {};
    // readSigData already treats a missing file as empty. A failed read
    // must stop the sync, or it erases owner signatures from the snapshot.
    const sigData = await store.readSigData(doc.id);
    const selfIds = new Set(doc.signers.filter((s) => s.isMe).map((s) => s.id));
    const values = {};
    for (const field of doc.fields) {
      if (selfIds.has(field.signerId) && sigData[field.id] !== undefined) {
        values[field.id] = sigData[field.id];
      }
    }
    return {
      doc: {
        id: doc.id,
        title: doc.title,
        note: doc.note || '',
        ownerName: store.settings.fullName || user.username || '',
        ownerEmail: user.email || '',
        pageCount: doc.pageCount,
        pdfPath: doc.pdfAbsPath || pdfPath(doc.id),
      },
      // The deadline the worker enforces on its own.
      expiresAt: doc.expiresAt || 0,
      signers: doc.signers.map((s) => ({
        id: s.id,
        name: s.name || '',
        email: s.email || '',
        kind: s.isMe ? 'self' : 'external',
        signed: s.status === 'signed',
      })),
      fields: doc.fields,
      values,
      // Sequential signing: doc.signers IS the order.
      signOrder: doc.signOrder === true,
      order: doc.signers.map((s) => s.id),
      // How the links went out, so a signer held back for their turn can be
      // told how they will hear that it has come.
      channel: sendChannel(doc),
      // What to tell the owner, and where. This worker is the only piece
      // awake when the app is closed, so it does the telling.
      notify: {
        email: user.email || '',
        sign: store.settings.notifySign === true,
        decline: store.settings.notifyDecline !== false,
        complete: store.settings.notifyComplete !== false,
        docUrl: docUrlFor(doc.id),
      },
    };
  }

  /**
   * Push this document to the worker and return the full link map
   * ({ signerId: url }), existing links merged with newly minted ones.
   * The caller persists the map on the document record.
   *
   * `codes` maps a signer id to an access code to SET, or to null to clear
   * one. It travels once, over HTTPS, and only its salted hash is kept; the
   * app never stores the code at all.
   */
  async function syncDoc(doc, { reissue = [], codes = null } = {}) {
    const c = await ensureWorker();
    const snapshot = await snapshotOf(doc);
    snapshot.reissue = reissue;
    if (codes) {
      for (const signer of snapshot.signers) {
        if (Object.prototype.hasOwnProperty.call(codes, signer.id)) signer.code = codes[signer.id];
      }
    }
    const data = await admin('/admin/sync', snapshot);
    const links = { ...(doc.links || {}) };
    for (const [signerId, token] of Object.entries(data.links || {})) {
      links[signerId] = `${c.url}/sign/${token}`;
    }
    for (const signerId of Object.keys(links)) {
      if (!doc.signers.some((s) => s.id === signerId)) delete links[signerId];
    }
    return links;
  }

  /* ---- Responses ------------------------------------------------------------ */

  /**
   * The documents anything can still arrive on: out for signature (or past
   * their deadline, which an extension elsewhere can reopen) and known to
   * the worker. Everything else - drafts, samples, only-me documents that
   * never had a link, and every finished document - is left out of a pull.
   */
  function liveDocIds() {
    return store.listDocs()
      .filter((d) => (d.status === 'sent' || d.status === 'expired') && !d.sample
        && Object.keys(d.links || {}).length)
      .map((d) => d.id);
  }

  /**
   * Pull signer activity and merge it into the store. Returns
   * [{ docId, completedNow, declinedNow }] for docs that changed.
   * Never deploys a worker just to pull, and asks only about the documents
   * something can still happen on.
   */
  async function pull({ force = false } = {}) {
    if (!cfg) await loadCfg().catch(() => null);
    if (!cfg || !cfg.secret) return [];
    if (!force && Date.now() - lastPullAt < PULL_MIN_MS) return [];
    const live = liveDocIds();
    if (!live.length) return [];
    const run = chain.then(async () => {
      const data = await admin(`/admin/responses?docs=${encodeURIComponent(live.join(','))}`);
      lastPullAt = Date.now();
      const results = [];
      for (const [docId, signerMap] of Object.entries(data.docs || {})) {
        const doc = store.getDoc(docId);
        if (!doc) continue;
        const responses = Object.entries(signerMap).map(([signerId, r]) => ({
          signerId,
          status: r.status,
          viewedAt: r.viewedAt,
          signedAt: r.signedAt,
          declinedAt: r.declinedAt,
          declineReason: r.declineReason,
          consentAt: r.consentAt,
          consentVersion: r.consentVersion,
          evidence: r.evidence,
          code: r.code,
          values: r.values,
        }));
        const merged = await store.applyResponses(docId, responses);
        const notified = (data.notified && data.notified[docId]) || {};
        const withValues = responses.filter((r) => r.values && Object.keys(r.values).length);
        if (withValues.length) {
          // Only after the merge landed: an ack before a failed merge would
          // drop the one copy of those values the app was ever offered.
          await admin('/admin/ack', { docId, signerIds: withValues.map((r) => r.signerId) })
            .catch(() => {});
        }
        if (merged.changed) results.push({ docId, ...merged, notified });
      }
      return results;
    });
    chain = run.catch(() => {});
    return run;
  }

  async function voidDoc(docId) {
    if (!cfg) await loadCfg().catch(() => null);
    if (!cfg || !cfg.secret) return;
    await admin('/admin/void', { docId });
  }

  async function revokeDoc(docId) {
    if (!cfg) await loadCfg().catch(() => null);
    if (!cfg || !cfg.secret) return;
    await admin('/admin/revoke', { docId });
  }

  return {
    available,
    ensureWorker,
    syncDoc,
    pull,
    voidDoc,
    revokeDoc,
    /** Tests: resolves when every queued network pass has settled. */
    whenIdle: () => chain,
  };
}
