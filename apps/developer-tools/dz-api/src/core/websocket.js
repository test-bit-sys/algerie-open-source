/**
 * WebSocket requests: the saved item shape, URL scheme handling and a live
 * session that wraps the browser WebSocket with a capped message log, state
 * events and optional reconnect with backoff.
 *
 * WebSocketRequest { id, type: 'websocket', name, description, url, params, protocols,
 *                    messages: [{ id, name, body, format: 'text' | 'json' }], settings: { reconnect } }
 *
 * Log entry { id, dir: 'in' | 'out' | 'system', at, data, binary, size, kind }
 *   kind: 'message' for data frames; 'open', 'close', 'error' or 'info' for system entries.
 */
import { Emitter } from '../lib/emitter.js';
import { uid } from '../lib/ids.js';
import { pair } from './model.js';
import { hostOf, isPrivateHost } from './url.js';

export const MESSAGE_FORMATS = ['text', 'json'];
export const LOG_LIMIT = 2000;
/** Total characters of message data kept in the log, so large frames cannot fill memory. */
export const LOG_CHARS_LIMIT = 32 * 1048576;
/** Binary frames are shown as hex; past this many bytes the dump is cut short. */
export const HEX_PREVIEW_BYTES = 4096;

const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);

// Saved item ------------------------------------------------------------------

export function wsMessage(fields = {}) {
  return normalizeWsMessage({ name: 'Message', ...fields });
}

export function normalizeWsMessage(m = {}, i = 0) {
  return {
    id: str(m?.id) || uid(),
    name: str(m?.name) || `Message ${i + 1}`,
    body: str(m?.body),
    format: MESSAGE_FORMATS.includes(m?.format) ? m.format : 'text',
  };
}

function normalizePairs(list) {
  return arr(list)
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const out = pair(str(p.key), str(p.value), { enabled: p.enabled !== false, description: str(p.description) });
      if (p.id) out.id = str(p.id);
      return out;
    });
}

export function normalizeWebSocket(r = {}) {
  const messages = arr(r.messages).filter((m) => m && typeof m === 'object').map(normalizeWsMessage);
  return {
    id: str(r.id) || uid(),
    type: 'websocket',
    name: str(r.name, 'Untitled WebSocket'),
    description: str(r.description),
    url: str(r.url),
    params: normalizePairs(r.params),
    protocols: str(r.protocols),
    messages: messages.length ? messages : [normalizeWsMessage({ name: 'Message 1' })],
    settings: { reconnect: !!r.settings?.reconnect },
  };
}

/** A new WebSocket request with one empty message. */
export function websocketRequest(fields = {}) {
  return normalizeWebSocket({ name: 'New WebSocket', messages: [{ name: 'Message 1', body: '', format: 'text' }], ...fields });
}

/** "a, b ,,c" -> ['a', 'b', 'c'] */
export function parseProtocols(text) {
  return str(text)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

// URLs ------------------------------------------------------------------------

/**
 * Normalizes what the user typed into a ws:// or wss:// URL: http(s) becomes
 * ws(s), and a URL without a scheme gets wss://, or ws:// for local and
 * private-network hosts. Other schemes are returned unchanged so the
 * WebSocket constructor can reject them with its own message.
 */
export function wsUrl(url) {
  const trimmed = str(url).trim();
  if (!trimmed) return '';
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    const rest = trimmed.slice(scheme[0].length);
    if (s === 'ws' || s === 'wss') return `${s}://${rest}`;
    if (s === 'http') return `ws://${rest}`;
    if (s === 'https') return `wss://${rest}`;
    return trimmed;
  }
  if (trimmed.startsWith('//')) return `wss:${trimmed}`;
  return `${isPrivateHost(hostOf(trimmed)) ? 'ws' : 'wss'}://${trimmed}`;
}

const CLOSE_CODES = {
  1000: 'Normal closure',
  1001: 'Going away',
  1002: 'Protocol error',
  1003: 'Unsupported data',
  1005: 'No status code',
  1006: 'Connection lost',
  1007: 'Invalid message data',
  1008: 'Policy violation',
  1009: 'Message too big',
  1010: 'Missing extension',
  1011: 'Server error',
  1012: 'Service restart',
  1013: 'Try again later',
  1014: 'Bad gateway',
  1015: 'TLS handshake failed',
};

/** Short description of a close code. */
export function closeCodeText(code) {
  if (CLOSE_CODES[code]) return CLOSE_CODES[code];
  if (code >= 3000 && code < 4000) return 'Library or framework code';
  if (code >= 4000 && code < 5000) return 'Application code';
  return '';
}

// Payloads ----------------------------------------------------------------------

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export function byteLength(text) {
  return encoder ? encoder.encode(text).length : text.length;
}

function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** "0a ff 10 ..." for the first HEX_PREVIEW_BYTES bytes. */
export function hexDump(bytes) {
  const shown = bytes.subarray(0, HEX_PREVIEW_BYTES);
  let out = '';
  for (let i = 0; i < shown.length; i++) out += (i ? ' ' : '') + shown[i].toString(16).padStart(2, '0');
  if (bytes.length > shown.length) out += ` ... (${bytes.length - shown.length} more bytes)`;
  return out;
}

// Session -------------------------------------------------------------------------

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
export const RECONNECT_ATTEMPTS = 10;
/** A connection that lasts this long counts as a success, resetting the backoff. */
const STABLE_MS = 5000;

/** Delay before reconnect attempt n (1-based): 1 s, 2 s, 4 s ... up to 30 s. */
export function backoffDelay(attempt) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

const ERROR_HELP =
  'The connection failed. Browsers do not say why a WebSocket fails, so check that the URL is right, the server is running and accepts WebSocket connections on that path, and that its certificate is valid. The browser developer console may show more.';

/**
 * A live connection and its message log. Events:
 *   'state'   (state)  connection state changed (also on reconnect scheduling)
 *   'message' (entry)  an entry was added to the log
 *   'clear'   ()       the log was cleared
 */
export class WebSocketSession extends Emitter {
  #reconnect = false;

  constructor({ url = '', protocols = [], WebSocketImpl = globalThis.WebSocket, reconnect = false } = {}) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnect = reconnect;
    this.state = 'idle';
    this.messages = [];
    this.socket = null;
    this.protocol = '';
    this.extensions = '';
    this.connectedAt = null;
    this.startedAt = null;
    this.closeCode = null;
    this.closeReason = '';
    this.wasClean = null;
    this.reconnectAttempt = 0;
    this.reconnectAt = null;
    this.stats = { sent: 0, received: 0, bytesSent: 0, bytesReceived: 0 };
    this.timer = null;
    this.userClosed = false;
    this.disposed = false;
  }

  get isOpen() {
    return this.state === 'open';
  }

  /** Opens the connection. url and protocols may be updated for this attempt. */
  connect({ url, protocols } = {}) {
    if (this.disposed) return false;
    if (url != null) this.url = url;
    if (protocols != null) this.protocols = protocols;
    this.#cancelReconnect();
    this.reconnectAttempt = 0; // A manual connect starts over rather than continuing a retry series.
    if (this.socket) {
      this.#detach(true);
      this.#system('close', 'Closed the previous connection', { code: 1000, reason: '', wasClean: true });
    }
    this.userClosed = false;
    return this.#open();
  }

  #open() {
    this.protocol = '';
    this.extensions = '';
    this.connectedAt = null;
    this.closeCode = null;
    this.closeReason = '';
    this.wasClean = null;
    const Impl = this.WebSocketImpl;
    if (typeof Impl !== 'function') {
      this.#system('error', 'This browser does not support WebSocket connections.');
      this.#setState('closed');
      return false;
    }
    let socket;
    try {
      socket = this.protocols?.length ? new Impl(this.url, this.protocols) : new Impl(this.url);
    } catch (err) {
      this.#system('error', constructorError(err, this.url));
      this.#setState('closed');
      return false;
    }
    this.socket = socket;
    try {
      socket.binaryType = 'arraybuffer';
    } catch {}
    this.startedAt = Date.now();
    this.#system('info', `Connecting to ${this.url}${this.protocols?.length ? ` with subprotocols ${this.protocols.join(', ')}` : ''}`);
    this.#setState('connecting');
    socket.onopen = () => this.#onOpen(socket);
    socket.onmessage = (e) => this.#onMessage(socket, e);
    socket.onerror = () => this.#onError(socket);
    socket.onclose = (e) => this.#onClose(socket, e);
    return true;
  }

  #onOpen(socket) {
    if (socket !== this.socket) return;
    this.connectedAt = Date.now();
    this.protocol = socket.protocol || '';
    this.extensions = socket.extensions || '';
    this.attemptAtOpen = this.reconnectAttempt;
    this.reconnectAttempt = 0;
    const extra = [this.protocol ? `subprotocol ${this.protocol}` : null, this.extensions ? `extensions ${this.extensions}` : null].filter(Boolean).join(', ');
    this.#system('open', `Connected to ${this.url}${extra ? ` (${extra})` : ''}`);
    this.#setState('open');
  }

  #onMessage(socket, e) {
    if (socket !== this.socket) return;
    const data = e.data;
    if (typeof data === 'string') {
      this.#record('in', data, false, byteLength(data));
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      // Only when binaryType could not be set; order is kept by reading in sequence.
      const seq = (this.blobChain ||= Promise.resolve());
      this.blobChain = seq
        .then(() => data.arrayBuffer())
        .then((buf) => this.#record('in', hexDump(new Uint8Array(buf)), true, buf.byteLength))
        .catch(() => {});
    } else {
      const bytes = toBytes(data) || new Uint8Array(0);
      this.#record('in', hexDump(bytes), true, bytes.length);
    }
  }

  #onError(socket) {
    if (socket !== this.socket) return;
    this.#system('error', this.state === 'connecting' ? ERROR_HELP : 'The connection reported an error. Browsers do not share the details.');
  }

  #onClose(socket, e) {
    if (socket !== this.socket) return;
    const wasOpen = !!this.connectedAt;
    this.socket = null;
    this.closeCode = e?.code ?? 1005;
    this.closeReason = e?.reason || '';
    this.wasClean = !!e?.wasClean;
    const text = closeCodeText(this.closeCode);
    const reason = this.closeReason ? `: ${this.closeReason}` : '';
    const prefix = wasOpen ? 'Disconnected' : 'Could not connect';
    this.#system('close', `${prefix}, code ${this.closeCode}${text ? ` (${text})` : ''}${reason}`, { code: this.closeCode, reason: this.closeReason, wasClean: this.wasClean });
    this.#setState('closed');
    // A server that accepts and then drops right away keeps backing off instead of retrying every second forever.
    if (wasOpen && Date.now() - this.connectedAt < STABLE_MS) this.reconnectAttempt = this.attemptAtOpen || 0;
    if (this.reconnect && !this.userClosed && !this.disposed) this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.reconnectAttempt >= RECONNECT_ATTEMPTS) {
      this.#system('info', `Stopped reconnecting after ${RECONNECT_ATTEMPTS} attempts.`);
      this.reconnectAttempt = 0;
      return;
    }
    this.reconnectAttempt += 1;
    const delay = backoffDelay(this.reconnectAttempt);
    this.reconnectAt = Date.now() + delay;
    this.#system('info', `Reconnecting in ${Math.round(delay / 1000)} s (attempt ${this.reconnectAttempt} of ${RECONNECT_ATTEMPTS})`);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.reconnectAt = null;
      if (!this.disposed && !this.userClosed) this.#open();
    }, delay);
    this.emit('state', this.state);
  }

  #cancelReconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const was = this.reconnectAt != null;
    this.reconnectAt = null;
    return was;
  }

  get reconnect() {
    return this.#reconnect;
  }

  /** Turning it off also stops a reconnect that is already waiting. */
  set reconnect(on) {
    this.#reconnect = !!on;
    if (!on && this.#cancelReconnect()) {
      this.#system('info', 'Stopped reconnecting.');
      this.emit('state', this.state);
    }
  }

  get reconnecting() {
    return this.reconnectAt != null;
  }

  /** Sends text or binary data. Returns the log entry; throws when not open. */
  send(data) {
    if (this.state !== 'open' || !this.socket) throw new Error('Not connected');
    this.socket.send(data);
    if (typeof data === 'string') return this.#record('out', data, false, byteLength(data));
    const bytes = toBytes(data) || new Uint8Array(0);
    return this.#record('out', hexDump(bytes), true, bytes.length);
  }

  /** Closes the connection (or stops a pending reconnect). */
  close(code = 1000, reason = '') {
    this.userClosed = true;
    const stopped = this.#cancelReconnect();
    if (!this.socket || this.state === 'closing' || this.state === 'closed' || this.state === 'idle') {
      if (stopped) {
        this.#system('info', 'Stopped reconnecting.');
        this.emit('state', this.state);
      }
      return;
    }
    if (this.state === 'connecting') {
      // Closing before the handshake finishes makes some browsers log a
      // warning; the close event still follows.
      this.#detach(false);
      this.#system('close', 'Connection attempt cancelled', { code: null, reason: '', wasClean: false });
      this.#setState('closed');
      return;
    }
    this.#setState('closing');
    try {
      this.socket.close(code, reason);
    } catch (err) {
      this.#system('error', `Could not close: ${err.message}`);
      this.socket.close();
    }
  }

  /** Drops the socket without waiting for its close event. */
  #detach(closeIt) {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
    try {
      if (closeIt || s.readyState === 0 || s.readyState === 1) s.close();
    } catch {}
  }

  clear() {
    this.messages = [];
    this.logChars = 0;
    this.stats = { sent: 0, received: 0, bytesSent: 0, bytesReceived: 0 };
    this.emit('clear');
  }

  /** Closes for good and stops reconnecting; used when the tab closes. */
  dispose() {
    this.userClosed = true;
    this.#cancelReconnect();
    if (this.socket) {
      try {
        if (this.state === 'open') this.socket.close(1000, '');
      } catch {}
      this.#detach(false);
    }
    this.disposed = true;
    if (this.state !== 'idle') this.state = 'closed';
  }

  #setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  #record(dir, data, binary, size) {
    if (dir === 'in') {
      this.stats.received += 1;
      this.stats.bytesReceived += size;
    } else {
      this.stats.sent += 1;
      this.stats.bytesSent += size;
    }
    return this.#push({ id: uid(), dir, at: Date.now(), data, binary, size, kind: 'message' });
  }

  #system(kind, data, extra = {}) {
    return this.#push({ id: uid(), dir: 'system', at: Date.now(), data, binary: false, size: 0, kind, ...extra });
  }

  #push(entry) {
    this.messages.push(entry);
    this.logChars = (this.logChars || 0) + (entry.data?.length || 0);
    let drop = Math.max(0, this.messages.length - LOG_LIMIT);
    for (let i = 0; i < drop; i++) this.logChars -= this.messages[i].data?.length || 0;
    // Then the oldest entries until the log fits, always keeping the newest one.
    while (this.logChars > LOG_CHARS_LIMIT && drop < this.messages.length - 1) this.logChars -= this.messages[drop++].data?.length || 0;
    if (drop) this.messages.splice(0, drop);
    this.emit('message', entry);
    return entry;
  }
}

function constructorError(err, url) {
  const name = err?.name || '';
  if (name === 'SyntaxError') return `"${url}" is not a valid WebSocket URL. Use ws:// or wss:// followed by a host, for example wss://example.com/socket.`;
  if (name === 'SecurityError') {
    if (/^ws:\/\//i.test(url) && typeof location !== 'undefined' && location.protocol === 'https:') {
      return 'The browser blocked an unencrypted ws:// connection from this secure page. Use wss:// instead.';
    }
    return `The browser blocked the connection: ${err.message}`;
  }
  return `Could not open the connection: ${err?.message || String(err)}`;
}
