/**
 * Host side of the user-script sandbox.
 *
 * Layout: a hidden <iframe sandbox="allow-scripts"> (opaque origin, so no access
 * to the app's DOM, storage or cookies) boots a small loader. The host hands it
 * a MessagePort plus the runtime source; the loader turns the source into a
 * Blob URL and runs every script in its own dedicated Worker, so the host can
 * kill a runaway script by terminating that worker. One spare worker is kept
 * warm so a run does not wait for worker startup.
 *
 * The srcdoc CSP blocks all network access (connect-src 'none'); scripts can
 * only reach the network through send(), which the host executes via onSend.
 * Blob workers inherit the CSP of the document that created them.
 *
 * Fallback: if the sandboxed iframe cannot create a Worker, the loader runs the
 * runtime inline in the iframe. Scripts are still isolated by the opaque
 * origin, but a busy loop can only be stopped by destroying the iframe, which
 * works only when the browser runs the sandboxed iframe on its own thread
 * (otherwise the host page freezes along with it). Inline scripts would share
 * the iframe's globals, so each run gets an iframe of its own, removed when the
 * run ends; later iframes are told to go inline straight away.
 *
 * Protocol (host <-> iframe, over the MessagePort):
 *   iframe -> host: ready { mode }, send { id, sendId, request }, result { id, result }, pong { nonce }
 *   host -> iframe: run { id, message }, sendResult { id, sendId, response | error }, terminate { id }, ping { nonce }
 * The iframe is started with a window message: init { source, inline } plus the port.
 * Worker messages are the same minus the id, which the loader adds, so a
 * script cannot answer for another run.
 */
import { RUNTIME_SOURCE } from './runtime.js';

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  'worker-src blob:',
  'child-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const PING_TIMEOUT_MS = 1000;
const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

/** Runs inside the sandboxed iframe. Must stay self-contained: it is inlined via toString(). */
function sandboxLoader() {
  let port = null;
  let blobUrl = null;
  let inline = null;
  let spare = null;
  const workers = new Map();
  const inlineSends = new Map();
  let inlineSeq = 0;

  function spawn() {
    return new Worker(blobUrl, { name: 'user-script' });
  }

  function verify(worker) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('worker did not start')), 3000);
      function fail(err) {
        clearTimeout(timer);
        worker.terminate();
        reject(err);
      }
      worker.onmessage = (e) => {
        if (!e.data || e.data.type !== 'hello') return;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        resolve(worker);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        fail(new Error(e.message || 'worker failed to start'));
      };
      worker.postMessage({ type: 'hello' });
    });
  }

  function takeWorker() {
    const w = spare || spawn();
    try {
      spare = spawn();
    } catch {
      spare = null;
    }
    return w;
  }

  function finishWorker(id) {
    const w = workers.get(id);
    if (!w) return;
    workers.delete(id);
    w.terminate();
  }

  function runInWorker(id, message) {
    let w;
    try {
      w = takeWorker();
    } catch (err) {
      port.postMessage({ type: 'result', id, result: { ok: false, error: { message: `Could not start a script worker: ${err.message}` } } });
      return;
    }
    workers.set(id, w);
    w.onmessage = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object' || !workers.has(id)) return;
      if (d.type === 'send') port.postMessage({ type: 'send', id, sendId: d.sendId, request: d.request });
      else if (d.type === 'result') {
        finishWorker(id);
        port.postMessage({ type: 'result', id, result: d.result });
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      if (!workers.has(id)) return;
      finishWorker(id);
      const message = `Script worker failed: ${e.message || 'unknown error'}`;
      port.postMessage({ type: 'result', id, result: { ok: false, error: { message } } });
    };
    w.postMessage({ type: 'run', message });
  }

  function runInline(id, message) {
    const host = {
      send: (request) =>
        new Promise((resolve, reject) => {
          const sendId = ++inlineSeq;
          inlineSends.set(`${id}:${sendId}`, { resolve, reject });
          port.postMessage({ type: 'send', id, sendId, request });
        }),
    };
    inline.runScript(message, host).then(
      (result) => port.postMessage({ type: 'result', id, result }),
      (err) => port.postMessage({ type: 'result', id, result: { ok: false, error: { message: String(err && err.message) } } }),
    );
  }

  function onHostMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ping') port.postMessage({ type: 'pong', nonce: d.nonce });
    else if (d.type === 'run') (inline ? runInline : runInWorker)(d.id, d.message);
    else if (d.type === 'terminate') finishWorker(d.id);
    else if (d.type === 'sendResult') {
      const payload = { type: 'sendResult', sendId: d.sendId, response: d.response, error: d.error };
      if (inline) {
        const key = `${d.id}:${d.sendId}`;
        const s = inlineSends.get(key);
        if (!s) return;
        inlineSends.delete(key);
        if (d.error != null) s.reject(new Error(String(d.error)));
        else s.resolve(d.response);
      } else if (workers.has(d.id)) workers.get(d.id).postMessage(payload);
    }
  }

  async function boot(source, forceInline) {
    let mode = 'worker';
    let reason;
    try {
      if (forceInline) throw new Error('an earlier iframe could not start a worker');
      blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      spare = await verify(spawn());
    } catch (err) {
      mode = 'inline';
      reason = String((err && err.message) || err);
      (0, eval)(source);
      inline = self.__scriptRuntime;
      delete self.__scriptRuntime;
    }
    port.postMessage({ type: 'ready', mode, reason });
  }

  addEventListener('message', function onInit(e) {
    if (port || e.source !== parent || !e.data || e.data.type !== 'init' || !e.ports || !e.ports[0]) return;
    removeEventListener('message', onInit);
    port = e.ports[0];
    port.onmessage = onHostMessage;
    boot(String(e.data.source), e.data.inline === true);
  });
}

const SRCDOC = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
</head><body><script>(${sandboxLoader.toString().replace(/<\//g, '<\\/')})();</script></body></html>`;

/** False for empty, whitespace-only or comment-only code. */
export { hasScript } from './has-script.js';

const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const isObj = (v) => v !== null && typeof v === 'object';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function stringMap(obj) {
  const out = {};
  if (isObj(obj)) for (const [k, v] of Object.entries(obj)) out[k] = str(v);
  return out;
}

const SCOPES = ['environment', 'collection', 'globals', 'local'];

/**
 * A scope the result does not report keeps the values the script started
 * with: a missing scope must never read as every variable deleted.
 */
function scopeMaps(reported, before) {
  const out = {};
  for (const name of SCOPES) out[name] = stringMap(isObj(reported?.[name]) ? reported[name] : before?.[name]);
  return out;
}

function cloneJson(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function sanitizeRequest(r, fallback) {
  if (!isObj(r)) return fallback;
  return {
    method: str(r.method, 'GET').toUpperCase(),
    url: str(r.url),
    headers: (Array.isArray(r.headers) ? r.headers : [])
      .filter(isObj)
      .map((h) => ({ ...h, key: str(h.key), value: str(h.value), enabled: h.enabled !== false })),
    body: isObj(r.body) ? { ...r.body, mode: str(r.body.mode, 'none'), raw: str(r.body.raw) } : { mode: 'none', raw: '' },
  };
}

function headerList(h) {
  if (!h) return [];
  if (Array.isArray(h)) {
    return h
      .map((x) => (Array.isArray(x) ? [str(x[0]), str(x[1])] : isObj(x) && x.enabled !== false ? [str(x.key), str(x.value)] : null))
      .filter((x) => x && x[0]);
  }
  if (typeof h.forEach === 'function' && typeof h.get === 'function') {
    const out = [];
    h.forEach((v, k) => out.push([str(k), str(v)]));
    return out;
  }
  return isObj(h) ? Object.entries(h).map(([k, v]) => [k, str(v)]) : [];
}

function sanitizeResponse(r) {
  const src = isObj(r) ? r : {};
  return {
    status: num(src.status),
    statusText: str(src.statusText),
    headers: headerList(src.headers),
    bodyText: str(src.bodyText),
    timeMs: num(src.timeMs),
    sizeBytes: src.sizeBytes == null ? undefined : num(src.sizeBytes),
  };
}

/** Results come from untrusted code: rebuild them field by field. */
function sanitizeResult(raw, message) {
  const r = isObj(raw) ? raw : {};
  const out = {
    id: message.id,
    ok: r.ok === true && !r.error,
    tests: (Array.isArray(r.tests) ? r.tests : []).filter(isObj).map((t) => ({
      name: str(t.name),
      passed: t.passed === true,
      skipped: t.skipped === true,
      error: t.error == null ? null : str(t.error),
      durationMs: num(t.durationMs),
    })),
    logs: (Array.isArray(r.logs) ? r.logs : []).filter(isObj).map((l) => ({
      level: LOG_LEVELS.includes(l.level) ? l.level : 'log',
      args: Array.isArray(l.args) ? l.args : [],
      at: num(l.at),
    })),
    variables: scopeMaps(r.variables, message.variables),
    request: message.phase === 'post' ? undefined : sanitizeRequest(r.request, message.request),
    flow: {
      next: isObj(r.flow) && r.flow.next !== undefined ? (r.flow.next === null ? null : str(r.flow.next)) : undefined,
      stop: isObj(r.flow) && r.flow.stop === true,
    },
  };
  if (r.error || r.ok !== true) {
    const e = isObj(r.error) ? r.error : { message: 'Script failed' };
    out.error = { name: str(e.name, 'Error'), message: str(e.message, 'Script failed') };
    if (e.stack) out.error.stack = str(e.stack);
    if (Number.isFinite(e.line)) out.error.line = e.line;
    if (Number.isFinite(e.column)) out.error.column = e.column;
  }
  return out;
}

function failure(message, text) {
  return {
    id: message.id,
    ok: false,
    error: { name: 'Error', message: text },
    tests: [],
    logs: [],
    variables: scopeMaps(null, message.variables),
    request: message.phase === 'post' ? undefined : message.request,
    flow: { next: undefined, stop: false },
  };
}

function formatSeconds(ms) {
  return `${Math.round((ms / 1000) * 100) / 100} s`;
}

export class ScriptSandbox {
  #frame = null;
  #runs = new Map();
  #seq = 0;
  #disposed = false;
  // Once an iframe could not start a worker, later ones skip trying (which can take seconds).
  #inline = false;

  /**
   * @param {object} [options]
   * @param {number} [options.timeoutMs] per-run limit, default 10 s
   * @param {(request, { signal }) => Promise<{status, statusText, headers, bodyText, timeMs, sizeBytes}>} [options.onSend] executes send() calls; the signal aborts when the run ends
   * @param {Element} [options.container] where the hidden iframe goes, default document.body
   * @param {number} [options.bootTimeoutMs] how long the iframe may take to start
   */
  constructor({ timeoutMs = 10000, onSend = null, container = null, bootTimeoutMs = 10000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.onSend = onSend;
    this.container = container;
    this.bootTimeoutMs = bootTimeoutMs;
  }

  /** 'worker', 'inline', or null before the first run. */
  get mode() {
    return this.#inline ? 'inline' : (this.#frame?.mode ?? null);
  }

  /** `signal` stops the script: the run ends with a failure and changes no variables. */
  async run(message, { signal = null } = {}) {
    let msg;
    try {
      msg = cloneJson(isObj(message) ? message : {});
    } catch (err) {
      return failure(isObj(message) ? message : {}, `Script input could not be copied: ${err.message}`);
    }
    if (this.#disposed) return failure(msg, 'Script sandbox has been disposed');
    let frame;
    try {
      for (;;) {
        frame = await this.#ensureFrame();
        if (frame.mode !== 'inline') break;
        // Inline scripts share the iframe's globals, so a run takes the iframe for
        // itself (it is removed when the run ends) and the next run gets a new one.
        if (frame.taken) continue;
        frame.taken = true;
        if (this.#frame === frame) this.#frame = this.#createFrame();
        break;
      }
    } catch (err) {
      return failure(msg, err.message);
    }
    if (signal?.aborted || this.#disposed) {
      if (frame.taken) this.#destroyFrame(frame, 'Script stopped');
      return failure(msg, this.#disposed ? 'Script sandbox has been disposed' : 'Script stopped');
    }
    return new Promise((resolve) => {
      const id = `run-${++this.#seq}`;
      // `sends` aborts the script's send() calls once the run is over.
      const entry = { id, frame, message: msg, resolve, timer: null, signal, onAbort: null, sends: new AbortController() };
      entry.timer = setTimeout(() => this.#kill(entry, `Script timed out after ${formatSeconds(this.timeoutMs)}`, 'timed out'), this.timeoutMs);
      entry.onAbort = () => this.#kill(entry, 'Script stopped', 'was stopped');
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      this.#runs.set(id, entry);
      frame.port.postMessage({ type: 'run', id, message: msg });
    });
  }

  dispose() {
    this.#disposed = true;
    for (const entry of [...this.#runs.values()]) this.#destroyFrame(entry.frame, 'Script sandbox has been disposed');
    if (this.#frame) this.#destroyFrame(this.#frame, 'Script sandbox has been disposed');
  }

  #finish(entry, result) {
    if (!this.#runs.has(entry.id)) return;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    entry.sends.abort();
    this.#runs.delete(entry.id);
    // An inline run's iframe served that run only.
    if (entry.frame.taken) this.#destroyFrame(entry.frame, 'Script sandbox was reset');
    entry.resolve(result);
  }

  #ensureFrame() {
    if (!this.#frame) this.#frame = this.#createFrame();
    return this.#frame.ready;
  }

  #createFrame() {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.title = 'Script sandbox';
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    iframe.srcdoc = SRCDOC;
    const frame = { iframe, port: null, mode: null, pings: new Map(), ready: null };
    frame.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Script sandbox failed to start'));
        this.#destroyFrame(frame, 'Script sandbox failed to start');
      }, this.bootTimeoutMs);
      // A fresh channel per load event: if a load fires for the initial blank
      // document, its port is lost and the next load gets a working one.
      iframe.addEventListener('load', () => {
        if (frame.port || !iframe.contentWindow) return;
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          const d = e.data;
          if (!isObj(d)) return;
          if (d.type === 'ready' && !frame.port) {
            clearTimeout(timer);
            frame.port = channel.port1;
            frame.mode = d.mode === 'inline' ? 'inline' : 'worker';
            if (frame.mode === 'inline') this.#inline = true;
            resolve(frame);
          } else if (frame.port === channel.port1) this.#onFrameMessage(frame, d);
        };
        iframe.contentWindow.postMessage({ type: 'init', source: RUNTIME_SOURCE, inline: this.#inline }, '*', [channel.port2]);
      });
    });
    frame.ready.catch(() => {});
    (this.container || document.body).appendChild(iframe);
    return frame;
  }

  #onFrameMessage(frame, d) {
    if (d.type === 'pong') {
      frame.pings.get(d.nonce)?.();
      return;
    }
    const entry = this.#runs.get(d.id);
    if (!entry || entry.frame !== frame) return;
    if (d.type === 'result') this.#finish(entry, sanitizeResult(d.result, entry.message));
    else if (d.type === 'send') this.#handleSend(entry, d.sendId, d.request);
  }

  #handleSend(entry, sendId, request) {
    const reply = (payload) => {
      if (this.#runs.has(entry.id) && entry.frame.port) entry.frame.port.postMessage({ type: 'sendResult', id: entry.id, sendId, ...payload });
    };
    if (typeof this.onSend !== 'function') {
      reply({ error: 'send() is not available here' });
      return;
    }
    Promise.resolve()
      .then(() => this.onSend(sanitizeRequest(request, null) || { method: 'GET', url: '', headers: [], body: { mode: 'none', raw: '' } }, { signal: entry.sends.signal }))
      .then(
        (response) => reply({ response: sanitizeResponse(response) }),
        (err) => reply({ error: str(err?.message ?? err, 'Request failed') }),
      );
  }

  #ping(frame) {
    return new Promise((resolve) => {
      if (!frame.port) return resolve(false);
      const nonce = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        frame.pings.delete(nonce);
        resolve(false);
      }, PING_TIMEOUT_MS);
      frame.pings.set(nonce, () => {
        clearTimeout(timer);
        frame.pings.delete(nonce);
        resolve(true);
      });
      frame.port.postMessage({ type: 'ping', nonce });
    });
  }

  /** Ends a run that timed out or was stopped, and kills the script. */
  async #kill(entry, text, why) {
    if (!this.#runs.has(entry.id)) return;
    this.#finish(entry, failure(entry.message, text));
    const { frame } = entry;
    frame.port?.postMessage({ type: 'terminate', id: entry.id });
    // In worker mode the iframe stays responsive; inline mode (or a wedged
    // loader) does not answer, so start over with a new iframe.
    if (!(await this.#ping(frame))) this.#destroyFrame(frame, `Script sandbox was reset after another script ${why}`);
  }

  #destroyFrame(frame, reason) {
    if (this.#frame === frame) this.#frame = null;
    for (const entry of [...this.#runs.values()]) if (entry.frame === frame) this.#finish(entry, failure(entry.message, reason));
    try {
      frame.port?.close();
    } catch {
      // already closed
    }
    frame.port = null;
    frame.iframe.remove();
  }
}
