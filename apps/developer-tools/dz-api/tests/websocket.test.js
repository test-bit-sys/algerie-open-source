import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeWebSocket,
  websocketRequest,
  wsUrl,
  parseProtocols,
  closeCodeText,
  backoffDelay,
  hexDump,
  WebSocketSession,
  LOG_LIMIT, LOG_CHARS_LIMIT,
  RECONNECT_ATTEMPTS,
} from '../src/core/websocket.js';

/** Minimal stand-in for the browser WebSocket, driven by the test. */
class FakeWebSocket {
  static instances = [];
  static throwOnCreate = null;

  constructor(url, protocols) {
    if (FakeWebSocket.throwOnCreate) {
      const err = new Error('bad');
      err.name = FakeWebSocket.throwOnCreate;
      throw err;
    }
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.protocol = '';
    this.extensions = '';
    this.sent = [];
    this.closedWith = null;
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    this.closedWith = { code, reason };
    this.readyState = 2;
  }

  // Test drivers.
  serverOpen(protocol = '') {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.({});
  }

  serverSend(data) {
    this.onmessage?.({ data });
  }

  serverClose(code = 1000, reason = '', wasClean = true) {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }

  fail() {
    this.onerror?.({});
  }
}

const last = () => FakeWebSocket.instances.at(-1);

function session(opts = {}) {
  return new WebSocketSession({ url: 'ws://localhost:1234/echo', WebSocketImpl: FakeWebSocket, ...opts });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnCreate = null;
});

describe('WebSocket request model', () => {
  it('creates a new request with one empty message', () => {
    const r = websocketRequest();
    expect(r.type).toBe('websocket');
    expect(r.name).toBe('New WebSocket');
    expect(r.url).toBe('');
    expect(r.params).toEqual([]);
    expect(r.protocols).toBe('');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ name: 'Message 1', body: '', format: 'text' });
    expect(r.messages[0].id).toBeTruthy();
    expect(r.settings).toEqual({ reconnect: false });
  });

  it('accepts fields in the factory', () => {
    const r = websocketRequest({ name: 'Echo', url: 'wss://x.test' });
    expect(r.name).toBe('Echo');
    expect(r.url).toBe('wss://x.test');
  });

  it('normalizes untrusted input', () => {
    const r = normalizeWebSocket({
      id: 'abc',
      type: 'request',
      name: 5,
      url: null,
      params: [{ key: 'token', value: 'x', enabled: false }, null, 'junk'],
      protocols: 'graphql-ws, json',
      messages: [{ id: 'm1', name: '', body: '{"a":1}', format: 'json' }, { body: 7, format: 'xml' }, null],
      settings: { reconnect: 'yes', pingIntervalMs: 5000 },
      extra: true,
    });
    expect(r.id).toBe('abc');
    expect(r.type).toBe('websocket');
    expect(r.name).toBe('5');
    expect(r.url).toBe('');
    expect(r.params).toHaveLength(1);
    expect(r.params[0]).toMatchObject({ key: 'token', value: 'x', enabled: false, description: '' });
    expect(r.messages).toEqual([
      { id: 'm1', name: 'Message 1', body: '{"a":1}', format: 'json' },
      expect.objectContaining({ name: 'Message 2', body: '7', format: 'text' }),
    ]);
    expect(r.settings).toEqual({ reconnect: true });
    expect(r).not.toHaveProperty('extra');
  });

  it('always keeps at least one message', () => {
    expect(normalizeWebSocket({}).messages).toHaveLength(1);
    expect(normalizeWebSocket({ messages: [] }).messages[0].name).toBe('Message 1');
    expect(normalizeWebSocket().name).toBe('Untitled WebSocket');
  });

  it('is stable when normalized twice', () => {
    const once = normalizeWebSocket({ url: 'ws://a', params: [{ key: 'k', value: 'v' }], messages: [{ body: 'hi' }] });
    expect(normalizeWebSocket(structuredClone(once))).toEqual(once);
  });

  it('splits subprotocols', () => {
    expect(parseProtocols(' graphql-ws , json,, ')).toEqual(['graphql-ws', 'json']);
    expect(parseProtocols('')).toEqual([]);
    expect(parseProtocols(null)).toEqual([]);
  });
});

describe('wsUrl', () => {
  it('keeps ws and wss URLs', () => {
    expect(wsUrl('ws://a.test/x')).toBe('ws://a.test/x');
    expect(wsUrl('  WSS://a.test/x ')).toBe('wss://a.test/x');
  });

  it('converts http and https', () => {
    expect(wsUrl('http://a.test/socket?x=1')).toBe('ws://a.test/socket?x=1');
    expect(wsUrl('HTTPS://a.test')).toBe('wss://a.test');
  });

  it('adds wss for public hosts and ws for local or private ones', () => {
    expect(wsUrl('echo.example.com/ws')).toBe('wss://echo.example.com/ws');
    expect(wsUrl('localhost:8080')).toBe('ws://localhost:8080');
    expect(wsUrl('127.0.0.1:9000/ws')).toBe('ws://127.0.0.1:9000/ws');
    expect(wsUrl('192.168.1.20/socket')).toBe('ws://192.168.1.20/socket');
    expect(wsUrl('10.0.0.5?x=1')).toBe('ws://10.0.0.5?x=1');
    expect(wsUrl('[::1]:3000')).toBe('ws://[::1]:3000');
    expect(wsUrl('printer.local')).toBe('ws://printer.local');
    expect(wsUrl('user@8.8.8.8:1/x')).toBe('wss://user@8.8.8.8:1/x');
    expect(wsUrl('//cdn.test/ws')).toBe('wss://cdn.test/ws');
  });

  it('leaves other schemes and empty input alone', () => {
    expect(wsUrl('ftp://a.test')).toBe('ftp://a.test');
    expect(wsUrl('')).toBe('');
    expect(wsUrl('   ')).toBe('');
  });
});

describe('helpers', () => {
  it('describes close codes', () => {
    expect(closeCodeText(1000)).toBe('Normal closure');
    expect(closeCodeText(1006)).toBe('Connection lost');
    expect(closeCodeText(4001)).toBe('Application code');
    expect(closeCodeText(3001)).toBe('Library or framework code');
    expect(closeCodeText(2000)).toBe('');
  });

  it('backs off exponentially up to 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('dumps bytes as hex', () => {
    expect(hexDump(new Uint8Array([0, 15, 255]))).toBe('00 0f ff');
    expect(hexDump(new Uint8Array(5000))).toMatch(/\.\.\. \(904 more bytes\)$/);
  });
});

describe('WebSocketSession', () => {
  it('connects, logs state changes and records the negotiated protocol', () => {
    const s = session({ protocols: ['chat', 'json'] });
    const states = [];
    s.on('state', (st) => states.push(st));
    expect(s.state).toBe('idle');
    s.connect();
    expect(last().url).toBe('ws://localhost:1234/echo');
    expect(last().protocols).toEqual(['chat', 'json']);
    expect(last().binaryType).toBe('arraybuffer');
    expect(s.state).toBe('connecting');
    last().serverOpen('json');
    expect(s.state).toBe('open');
    expect(s.isOpen).toBe(true);
    expect(s.protocol).toBe('json');
    expect(s.connectedAt).toBeTypeOf('number');
    expect(states).toEqual(['connecting', 'open']);
    const kinds = s.messages.map((m) => `${m.dir}:${m.kind}`);
    expect(kinds).toEqual(['system:info', 'system:open']);
    expect(s.messages[1].data).toContain('subprotocol json');
  });

  it('passes no protocols argument when there are none', () => {
    const s = session();
    s.connect();
    expect(last().protocols).toBeUndefined();
  });

  it('sends and receives text', () => {
    const s = session();
    const seen = [];
    s.on('message', (e) => seen.push(e));
    s.connect();
    last().serverOpen();
    const out = s.send('héllo');
    expect(last().sent).toEqual(['héllo']);
    expect(out).toMatchObject({ dir: 'out', kind: 'message', data: 'héllo', binary: false, size: 6 });
    last().serverSend('{"ok":true}');
    const inc = s.messages.at(-1);
    expect(inc).toMatchObject({ dir: 'in', kind: 'message', data: '{"ok":true}', binary: false, size: 11 });
    expect(inc.id).toBeTruthy();
    expect(inc.at).toBeTypeOf('number');
    expect(seen.at(-1)).toBe(inc);
    expect(s.stats).toEqual({ sent: 1, received: 1, bytesSent: 6, bytesReceived: 11 });
  });

  it('handles binary frames both ways', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    last().serverSend(new Uint8Array([1, 2, 255]).buffer);
    expect(s.messages.at(-1)).toMatchObject({ dir: 'in', binary: true, size: 3, data: '01 02 ff' });
    const buf = new Uint8Array([16, 32]).buffer;
    const out = s.send(buf);
    expect(last().sent[0]).toBe(buf);
    expect(out).toMatchObject({ dir: 'out', binary: true, size: 2, data: '10 20' });
  });

  it('refuses to send when not open', () => {
    const s = session();
    expect(() => s.send('x')).toThrow(/Not connected/);
    s.connect();
    expect(() => s.send('x')).toThrow(/Not connected/);
  });

  it('closes with a code and records the close', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    const sock = last();
    s.close(4000, 'bye');
    expect(s.state).toBe('closing');
    expect(sock.closedWith).toEqual({ code: 4000, reason: 'bye' });
    sock.serverClose(4000, 'bye', true);
    expect(s.state).toBe('closed');
    expect(s.closeCode).toBe(4000);
    expect(s.closeReason).toBe('bye');
    expect(s.wasClean).toBe(true);
    const entry = s.messages.at(-1);
    expect(entry).toMatchObject({ dir: 'system', kind: 'close', code: 4000, reason: 'bye' });
    expect(entry.data).toBe('Disconnected, code 4000 (Application code): bye');
  });

  it('defaults to code 1000 when closing', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    s.close();
    expect(last().closedWith).toEqual({ code: 1000, reason: '' });
  });

  it('records server-initiated abnormal closes', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    last().serverClose(1006, '', false);
    expect(s.state).toBe('closed');
    expect(s.wasClean).toBe(false);
    expect(s.messages.at(-1).data).toContain('Connection lost');
  });

  it('turns errors into a friendly explanation', () => {
    const s = session();
    s.connect();
    last().fail();
    last().serverClose(1006, '', false);
    const err = s.messages.find((m) => m.kind === 'error');
    expect(err.dir).toBe('system');
    expect(err.data).toMatch(/Browsers do not say why/);
    expect(s.messages.at(-1).data).toMatch(/^Could not connect, code 1006/);
    expect(s.state).toBe('closed');
  });

  it('reports invalid URLs and blocked connections without throwing', () => {
    FakeWebSocket.throwOnCreate = 'SyntaxError';
    const s = session({ url: 'ws://' });
    expect(s.connect()).toBe(false);
    expect(s.state).toBe('closed');
    expect(s.messages.at(-1)).toMatchObject({ kind: 'error' });
    expect(s.messages.at(-1).data).toMatch(/not a valid WebSocket URL/);
    FakeWebSocket.throwOnCreate = 'SecurityError';
    s.connect();
    expect(s.messages.at(-1).data).toMatch(/blocked/);
  });

  it('reports a missing WebSocket implementation', () => {
    const s = new WebSocketSession({ url: 'ws://a', WebSocketImpl: null });
    expect(s.connect()).toBe(false);
    expect(s.messages.at(-1).data).toMatch(/does not support/);
  });

  it('cancels a connection attempt', () => {
    const s = session();
    s.connect();
    const sock = last();
    s.close();
    expect(s.state).toBe('closed');
    expect(sock.closedWith).not.toBeNull();
    // Late events from the abandoned socket are ignored.
    sock.serverOpen();
    expect(s.state).toBe('closed');
  });

  it('caps the log at the limit, dropping the oldest', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    for (let i = 0; i < LOG_LIMIT + 50; i++) last().serverSend(`m${i}`);
    expect(s.messages).toHaveLength(LOG_LIMIT);
    expect(s.messages.at(-1).data).toBe(`m${LOG_LIMIT + 49}`);
    expect(s.messages[0].data).toBe('m50'); // two system entries and 50 messages dropped
    expect(s.stats.received).toBe(LOG_LIMIT + 50);
  });

  it('caps the log by total size too', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    const big = 'x'.repeat(1048576);
    for (let i = 0; i < 40; i++) last().serverSend(big + i);
    const total = s.messages.reduce((n, m) => n + m.data.length, 0);
    expect(total).toBeLessThanOrEqual(LOG_CHARS_LIMIT);
    expect(s.messages.at(-1).data).toBe(`${big}39`);
    expect(s.stats.received).toBe(40);
  });

  it('clears the log', () => {
    const s = session();
    const cleared = vi.fn();
    s.on('clear', cleared);
    s.connect();
    s.clear();
    expect(s.messages).toEqual([]);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('reconnects to a new URL keeping the log', () => {
    const s = session();
    s.connect();
    last().serverOpen();
    const first = last();
    s.connect({ url: 'ws://localhost:1234/other' });
    expect(first.closedWith).not.toBeNull();
    expect(last()).not.toBe(first);
    expect(last().url).toBe('ws://localhost:1234/other');
    expect(s.messages.some((m) => m.data === 'Closed the previous connection')).toBe(true);
    // Events from the old socket are ignored.
    first.serverClose(1000, '', true);
    expect(s.state).toBe('connecting');
  });

  it('disposes for good', () => {
    const s = session({ reconnect: true });
    s.connect();
    last().serverOpen();
    const sock = last();
    s.dispose();
    expect(sock.closedWith).toEqual({ code: 1000, reason: '' });
    expect(s.state).toBe('closed');
    expect(s.connect()).toBe(false);
  });

  describe('auto reconnect', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reconnects with backoff after an unexpected close and resets after success', () => {
      const s = session({ reconnect: true });
      s.connect();
      last().serverOpen();
      last().serverClose(1006, '', false);
      expect(s.reconnecting).toBe(true);
      expect(s.reconnectAttempt).toBe(1);
      expect(s.messages.at(-1).data).toMatch(/Reconnecting in 1 s \(attempt 1 of/);
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(s.state).toBe('connecting');
      // Fails again: the next wait doubles.
      last().serverClose(1006, '', false);
      expect(s.reconnectAttempt).toBe(2);
      vi.advanceTimersByTime(1999);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(3);
      last().serverOpen();
      expect(s.reconnectAttempt).toBe(0);
      expect(s.state).toBe('open');
    });

    it('keeps backing off when the server accepts and then drops right away', () => {
      const s = session({ reconnect: true });
      s.connect();
      last().serverOpen();
      for (let i = 1; i <= 3; i++) {
        last().serverClose(4001, 'unauthorized', true);
        expect(s.reconnectAttempt).toBe(i);
        vi.advanceTimersByTime(30000);
        last().serverOpen();
      }
      // A connection that stays up resets the backoff.
      vi.advanceTimersByTime(6000);
      last().serverClose(1006, '', false);
      expect(s.reconnectAttempt).toBe(1);
    });

    it('treats a manual connect after stopping as a fresh start', () => {
      const s = session({ reconnect: true });
      s.connect();
      last().serverClose(1006, '', false);
      vi.advanceTimersByTime(1000);
      last().serverClose(1006, '', false);
      s.close();
      s.connect();
      expect(s.reconnectAttempt).toBe(0);
      last().serverClose(1006, '', false);
      expect(s.reconnectAttempt).toBe(1);
    });

    it('does not reconnect after the user closes', () => {
      const s = session({ reconnect: true });
      s.connect();
      last().serverOpen();
      s.close();
      last().serverClose(1000, '', true);
      vi.advanceTimersByTime(60000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(s.reconnecting).toBe(false);
    });

    it('stops a waiting reconnect when the setting is turned off', () => {
      const s = session({ reconnect: true });
      const states = [];
      s.on('state', (st) => states.push(st));
      s.connect();
      last().serverOpen();
      last().serverClose(1006, '', false);
      expect(s.reconnecting).toBe(true);
      states.length = 0;
      s.reconnect = false;
      expect(s.reconnecting).toBe(false);
      expect(states).toEqual(['closed']);
      expect(s.messages.at(-1).data).toBe('Stopped reconnecting.');
      vi.advanceTimersByTime(60000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect when the setting is off', () => {
      const s = session();
      s.connect();
      last().serverOpen();
      last().serverClose(1006, '', false);
      vi.advanceTimersByTime(60000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stops a pending reconnect on close', () => {
      const s = session({ reconnect: true });
      s.connect();
      last().serverOpen();
      last().serverClose(1011, 'boom', false);
      expect(s.reconnecting).toBe(true);
      s.close();
      expect(s.reconnecting).toBe(false);
      expect(s.messages.at(-1).data).toBe('Stopped reconnecting.');
      vi.advanceTimersByTime(60000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('gives up after the maximum number of attempts', () => {
      const s = session({ reconnect: true });
      s.connect();
      for (let i = 0; i < RECONNECT_ATTEMPTS; i++) {
        last().serverClose(1006, '', false);
        vi.advanceTimersByTime(30000);
      }
      expect(FakeWebSocket.instances).toHaveLength(RECONNECT_ATTEMPTS + 1);
      last().serverClose(1006, '', false);
      expect(s.reconnecting).toBe(false);
      expect(s.messages.at(-1).data).toMatch(/Stopped reconnecting after/);
    });
  });
});

describe('WebSocketView', () => {
  // CodeMirror measures text through Range rects, which jsdom does not implement.
  if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [];
    Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }

  let WebSocketView;
  let MAX_ROWS;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    document.body.replaceChildren();
    ({ WebSocketView, MAX_ROWS } = await import('../src/ui/websocket-view.js'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function makeView(draft = {}) {
    const tab = { id: 't1', kind: 'websocket', refId: null, draft: websocketRequest({ name: 'Echo', url: 'ws://localhost:9/echo?x=1', ...draft }) };
    const vars = new Map([['host', 'localhost:9']]);
    const app = {
      ws: { locate: () => null },
      varsFor: () => ({ get: (n) => (vars.has(n) ? { value: vars.get(n), scope: 'environment' } : null), list: () => [], resolve: (s) => s.replace(/\{\{(\w+)\}\}/g, (w, n) => vars.get(n) ?? w) }),
      isDirty: () => true,
      draftChanged: vi.fn(),
      keepTab: vi.fn(),
      saveTab: vi.fn(),
      saveTabAs: vi.fn(),
      openTab: vi.fn(),
      deleteItem: vi.fn(),
      tabbar: { render() {} },
      console: { add: vi.fn() },
      session: {},
      tabs: [],
    };
    app.tabs.push(tab);
    const view = new WebSocketView(app, tab);
    document.body.append(view.el, Object.assign(document.createElement('div'), { id: 'live-region' }));
    view.onShow();
    return { view, tab, app };
  }

  const status = (view) => view.el.querySelector('.ws-status').textContent;
  const rows = (view) => [...view.el.querySelectorAll('.ws-log-list .ws-row')];

  it('renders the header, URL, sections and an empty log', () => {
    const { view } = makeView();
    expect(view.el.querySelector('.req-name').value).toBe('Echo');
    expect(view.el.querySelector('.ws-badge').textContent).toBe('WS');
    expect(view.el.querySelector('[aria-label="WebSocket URL"]').value).toBe('ws://localhost:9/echo?x=1');
    expect([...view.el.querySelectorAll('[role="tab"]')].map((t) => t.textContent.replace(/\d+$/, ''))).toEqual(['Message', 'Params', 'Settings', 'Docs']);
    expect(status(view)).toContain('Not connected');
    expect(view.el.querySelector('.ws-connect').textContent).toBe('Connect');
    expect(view.el.querySelector('.ws-empty').textContent).toMatch(/Connect to start/);
    expect(view.el.querySelectorAll('.ws-msg-item')).toHaveLength(1);
  });

  it('connects, sends, receives and disconnects', () => {
    const { view, tab, app } = makeView({ url: 'ws://{{host}}/echo' });
    view.primaryAction();
    expect(last().url).toBe('ws://localhost:9/echo');
    expect(tab.session.state).toBe('connecting');
    expect(status(view)).toContain('Connecting');
    last().serverOpen();
    expect(status(view)).toContain('Connected');
    expect(app.console.add).toHaveBeenCalledWith(expect.objectContaining({ method: 'WS', status: 101 }));
    expect(view.el.querySelector('.ws-connect').textContent).toBe('Disconnect');
    tab.draft.messages[0].body = 'hello {{host}}';
    view.primaryAction();
    expect(last().sent).toEqual(['hello localhost:9']);
    last().serverSend('{"echo":"hello"}');
    vi.advanceTimersByTime(50);
    const r = rows(view).filter((x) => x.dataset.dir !== 'system');
    expect(r.map((x) => x.dataset.dir)).toEqual(['out', 'in']);
    expect(r[1].querySelector('.ws-preview').textContent).toBe('{"echo":"hello"}');
    // Expanding shows pretty JSON.
    r[1].querySelector('button.ws-row-main').click();
    expect(r[1].querySelector('button.ws-row-main').getAttribute('aria-expanded')).toBe('true');
    expect(r[1].querySelector('.ws-detail-body').textContent).toBe('{\n  "echo": "hello"\n}');
    view.toggleConnection();
    expect(last().closedWith).toEqual({ code: 1000, reason: '' });
    last().serverClose(1000, '', true);
    expect(status(view)).toContain('Disconnected 1000');
    view.destroy();
  });

  it('filters and searches the log', () => {
    const { view, tab } = makeView();
    view.connect();
    last().serverOpen();
    tab.session.send('ping');
    last().serverSend('pong');
    last().serverSend('other');
    vi.advanceTimersByTime(50);
    view.el.querySelector('.ws-filter [data-k="in"]').click();
    expect(rows(view).map((x) => x.querySelector('.ws-preview').textContent)).toEqual(['pong', 'other']);
    const search = view.el.querySelector('.ws-search');
    search.value = 'oth';
    search.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    expect(rows(view)).toHaveLength(1);
    view.el.querySelector('.ws-filter [data-k="out"]').click();
    expect(rows(view)).toHaveLength(0);
    expect(view.el.querySelector('.ws-empty').textContent).toMatch(/No messages match/);
  });

  it('keeps at most MAX_ROWS rows in the DOM', () => {
    const { view } = makeView();
    view.connect();
    last().serverOpen();
    for (let i = 0; i < MAX_ROWS + 30; i++) last().serverSend(`m${i}`);
    vi.advanceTimersByTime(50);
    expect(rows(view)).toHaveLength(MAX_ROWS);
    expect(rows(view).at(-1).querySelector('.ws-preview').textContent).toBe(`m${MAX_ROWS + 29}`);
    expect(view.el.querySelector('.ws-log-note').hidden).toBe(false);
  });

  it('keeps focus on the connect button while disconnecting', () => {
    const { view } = makeView();
    view.connect();
    last().serverOpen();
    const btn = view.el.querySelector('.ws-connect');
    btn.focus();
    btn.click();
    expect(status(view)).toContain('Disconnecting');
    // Unavailable but still focusable, so keyboard focus does not fall back to the page.
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(btn);
    btn.click();
    expect(FakeWebSocket.instances).toHaveLength(1);
    last().serverClose(1000, '', true);
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
    expect(btn.textContent).toBe('Connect');
    view.destroy();
  });

  it('announces that it will reconnect after the connection drops', async () => {
    const { view } = makeView({ settings: { reconnect: true } });
    view.connect();
    last().serverOpen();
    last().serverClose(1006, '', false);
    await vi.advanceTimersByTimeAsync(50);
    expect(document.getElementById('live-region').textContent).toBe('Disconnected, code 1006 (Connection lost). Reconnecting.');
    view.destroy();
  });

  it('does not pile up rows while animation frames are paused', () => {
    const { view } = makeView();
    view.connect();
    last().serverOpen();
    // No frame runs between these, as in a background browser tab.
    for (let i = 0; i < MAX_ROWS * 3; i++) last().serverSend(`m${i}`);
    expect(view.queue.length).toBeLessThanOrEqual(MAX_ROWS * 2);
    vi.advanceTimersByTime(50);
    expect(rows(view)).toHaveLength(MAX_ROWS);
    expect(rows(view).at(-1).querySelector('.ws-preview').textContent).toBe(`m${MAX_ROWS * 3 - 1}`);
    expect(view.el.querySelector('.ws-log-note').hidden).toBe(false);

    // Scrolled up to read while the page is hidden: new rows are added below without moving the log.
    const list = view.el.querySelector('.ws-list') || rows(view)[0].parentElement;
    Object.defineProperty(list, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true });
    list.scrollTop = 0;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    last().serverSend('later');
    hidden.mockRestore();
    vi.advanceTimersByTime(50);
    expect(rows(view).at(-1).querySelector('.ws-preview').textContent).toBe('later');
    expect(list.scrollTop).toBe(0);
    expect(view.el.querySelector('.ws-jump').hidden).toBe(false);
  });

  it('keeps query params and the URL in sync', () => {
    const { view, tab } = makeView({ url: '' });
    const input = view.el.querySelector('[aria-label="WebSocket URL"]');
    input.value = 'wss://x.test/s?token=abc&v=2';
    input.dispatchEvent(new Event('input'));
    expect(tab.draft.params.map((p) => p.key)).toEqual(['token', 'v']);
  });

  it('adds messages and connects before sending when needed', () => {
    const { view, tab } = makeView();
    view.el.querySelector('[aria-label="Add message"]').click();
    expect(tab.draft.messages.map((m) => m.name)).toEqual(['Message 1', 'Message 2']);
    expect(tab.wsMessageId).toBe(tab.draft.messages[1].id);
    tab.draft.messages[1].body = 'queued';
    view.sendMessage();
    expect(FakeWebSocket.instances).toHaveLength(1);
    last().serverOpen();
    expect(last().sent).toEqual(['queued']);
  });

  it('keeps the connection when the view is rebuilt and closes it with the tab', () => {
    const { view, tab, app } = makeView();
    view.connect();
    last().serverOpen();
    view.destroy();
    expect(tab.session.state).toBe('open');
    const again = new WebSocketView(app, tab);
    again.onShow();
    expect(again.el.querySelector('.ws-status').textContent).toContain('Connected');
    app.tabs.length = 0;
    again.destroy();
    expect(tab.session).toBeNull();
    expect(last().closedWith).toEqual({ code: 1000, reason: '' });
  });

  it('keeps the Resend button in step with the connection', () => {
    const { view, tab } = makeView();
    view.connect();
    last().serverOpen();
    tab.session.send('hello');
    vi.advanceTimersByTime(50);
    const row = rows(view).find((r) => r.dataset.dir === 'out');
    row.querySelector('button.ws-row-main').click();
    const resend = () => [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Resend'));
    expect(resend().disabled).toBe(false);
    view.disconnect();
    last().serverClose(1000, '', true);
    vi.advanceTimersByTime(50);
    expect(resend().disabled).toBe(true);
  });

  it('announces the JSON verdict only when it changes', () => {
    const { view, tab } = makeView();
    tab.draft.messages[0].format = 'json';
    tab.draft.messages[0].body = '{"a":1}';
    view.reload();
    const first = view.el.querySelector('.ws-json-state span');
    expect(first.textContent).toBe('Valid JSON');
    view.onVariablesChanged();
    expect(view.el.querySelector('.ws-json-state span')).toBe(first);
  });
});
