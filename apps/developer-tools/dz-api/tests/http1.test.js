import { describe, it, expect, vi } from 'vitest';
import { gzipSync, deflateSync, deflateRawSync, brotliCompressSync } from 'node:zlib';
import { http1Request, followRedirects, toBytes, decodeContent } from '../src/core/http1.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytes = (s) => (typeof s === 'string' ? enc.encode(s) : new Uint8Array(s));
const join = (...parts) => {
  const list = parts.map(bytes);
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of list) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// Small deterministic PRNG so "random" fragmentation is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Fake socket server. `respond(requestText)` returns the raw response bytes; they are
 * delivered in fragments of `fragment` bytes ('random' | 'single' | number) once the request arrives.
 */
function fakeNet({ respond, fragment = 'random', seed = 1, closeAfter = true, failConnect = null, silent = false } = {}) {
  const sockets = [];
  const openSocket = (host, port, tls) => {
    const handlers = {};
    const written = [];
    const socket = {
      host,
      port,
      tls,
      written,
      closed: false,
      on(event, fn) {
        handlers[event] = fn;
      },
      write(data) {
        written.push(bytes(data));
        if (!socket.responded && !silent) {
          socket.responded = true;
          setTimeout(() => deliver(), 0);
        }
      },
      close() {
        socket.closed = true;
      },
      get text() {
        return dec.decode(join(...written));
      },
    };
    const emit = (event, arg) => {
      if (handlers[event]) handlers[event](arg);
    };
    const deliver = async () => {
      const response = bytes(respond(socket.text, socket));
      const next = rng(seed);
      let at = 0;
      while (at < response.length && !socket.closed) {
        let size;
        if (fragment === 'single') size = response.length;
        else if (fragment === 'random') size = 1 + Math.floor(next() * 23);
        else size = fragment;
        emit('data', response.slice(at, at + size));
        at += size;
        if (at % 7 === 0) await tick();
        else await Promise.resolve();
      }
      if (closeAfter && !socket.closed) emit('close', false);
    };
    sockets.push(socket);
    setTimeout(() => {
      if (failConnect) {
        emit('error', new Error(failConnect));
        emit('close', true);
      } else {
        emit('open');
      }
    }, 0);
    return socket;
  };
  return { openSocket, sockets };
}

const MODES = ['single', 1, 'random'];
const headerMap = (headers) => headers.map(([k, v]) => `${k}: ${v}`);

describe('http1Request basics', () => {
  for (const fragment of MODES) {
    it(`GET with Content-Length (${fragment} fragments)`, async () => {
      const net = fakeNet({
        fragment,
        respond: () => 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 11\r\nX-Folded: a\r\n  b\r\n\r\nhello world',
      });
      const res = await http1Request({ url: 'http://example.com/a/b?x=1&y=2#frag', headers: [['Accept', '*/*'], ['X-Dup', '1'], ['x-dup', '2']], openSocket: net.openSocket });
      expect(net.sockets[0].text).toBe(
        'GET /a/b?x=1&y=2 HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\nX-Dup: 1\r\nx-dup: 2\r\nConnection: close\r\n\r\n',
      );
      expect(net.sockets[0]).toMatchObject({ host: 'example.com', port: 80, tls: false, closed: true });
      expect(res.status).toBe(200);
      expect(res.statusText).toBe('OK');
      expect(res.httpVersion).toBe('1.1');
      expect(headerMap(res.headers)).toEqual(['Content-Type: text/plain', 'Content-Length: 11', 'X-Folded: a b']);
      expect(dec.decode(res.body)).toBe('hello world');
      expect(res.encodedSize).toBe(11);
      expect(res.decodedSize).toBe(11);
      expect(res.headerBytes).toBe(83);
      for (const key of ['connect', 'firstByte', 'download', 'total']) expect(res.timings[key]).toBeGreaterThanOrEqual(0);
    });

    it(`chunked with extensions and trailers (${fragment} fragments)`, async () => {
      const raw = 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;ext=1\r\nhello\r\n6 ; foo="bar"\r\n world\r\nA\r\n0123456789\r\n0\r\nX-Checksum: abc\r\nX-Other: 1\r\n\r\n';
      const net = fakeNet({ fragment, closeAfter: false, respond: () => raw });
      const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
      expect(dec.decode(res.body)).toBe('hello world0123456789');
      expect(headerMap(res.trailers)).toEqual(['X-Checksum: abc', 'X-Other: 1']);
      expect(res.encodedSize).toBe(raw.length - raw.indexOf('\r\n\r\n') - 4);
      expect(res.decodedSize).toBe(21);
    });

    it(`close-delimited body (${fragment} fragments)`, async () => {
      const net = fakeNet({ fragment, respond: () => 'HTTP/1.0 200 OK\r\nServer: old\r\n\r\nuntil the end' });
      const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
      expect(res.httpVersion).toBe('1.0');
      expect(dec.decode(res.body)).toBe('until the end');
    });
  }

  it('accepts bare LF line endings', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\nContent-Length: 2\n\nok' });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
    expect(dec.decode(res.body)).toBe('ok');
  });

  it('HEAD has no body even with Content-Length', async () => {
    const net = fakeNet({ closeAfter: false, respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n' });
    const res = await http1Request({ url: 'http://example.com/', method: 'HEAD', openSocket: net.openSocket });
    expect(net.sockets[0].text.startsWith('HEAD / HTTP/1.1\r\n')).toBe(true);
    expect(res.body.length).toBe(0);
    expect(headerMap(res.headers)).toEqual(['Content-Length: 1000']);
  });

  it('204 and 304 have no body', async () => {
    for (const status of [204, 304]) {
      const net = fakeNet({ closeAfter: false, respond: () => `HTTP/1.1 ${status} Whatever\r\nContent-Length: 5\r\n\r\n` });
      const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
      expect(res.status).toBe(status);
      expect(res.body.length).toBe(0);
    }
  });

  it('skips 100 Continue and 103 Early Hints', async () => {
    const net = fakeNet({
      fragment: 1,
      respond: () => 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: </a.css>\r\n\r\nHTTP/1.1 201 Created\r\nContent-Length: 2\r\n\r\nok',
    });
    const res = await http1Request({ url: 'http://example.com/', method: 'POST', body: bytes('x'), openSocket: net.openSocket });
    expect(res.status).toBe(201);
    expect(res.informational.map((r) => r.status)).toEqual([100, 103]);
    expect(dec.decode(res.body)).toBe('ok');
  });

  it('gives up on a server that sends interim responses without end', async () => {
    const hints = 'HTTP/1.1 103 Early Hints\r\nLink: </a.css>\r\n\r\n';
    const many = fakeNet({ fragment: 'single', respond: () => `${hints.repeat(101)}HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n` });
    await expect(http1Request({ url: 'http://example.com/', openSocket: many.openSocket })).rejects.toThrow(/Too many interim/);
    const enough = fakeNet({ fragment: 'single', respond: () => `${hints.repeat(100)}HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n` });
    expect((await http1Request({ url: 'http://example.com/', openSocket: enough.openSocket })).informational).toHaveLength(100);
  });

  it('keeps duplicate Set-Cookie headers in order and case', async () => {
    const net = fakeNet({
      respond: () => 'HTTP/1.1 200 OK\r\nSet-Cookie: a=1; Path=/\r\nset-cookie: b=2\r\nSET-COOKIE: c=3\r\nContent-Length: 0\r\n\r\n',
    });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
    expect(res.headers).toEqual([['Set-Cookie', 'a=1; Path=/'], ['set-cookie', 'b=2'], ['SET-COOKIE', 'c=3'], ['Content-Length', '0']]);
  });

  it('adds the port to Host when it is not the default and uses TLS for https', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'https://api.example.com:8443/v1', openSocket: net.openSocket });
    expect(net.sockets[0]).toMatchObject({ host: 'api.example.com', port: 8443, tls: true });
    expect(net.sockets[0].text).toBe('GET /v1 HTTP/1.1\r\nHost: api.example.com:8443\r\nConnection: close\r\n\r\n');

    const net2 = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'https://api.example.com:443/', openSocket: net2.openSocket });
    expect(net2.sockets[0].port).toBe(443);
    expect(net2.sockets[0].text).toContain('Host: api.example.com\r\n');
  });

  it('respects caller Host, Connection and Content-Length headers', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({
      url: 'http://10.0.0.1:8080/',
      headers: [['X-A', '1'], ['host', 'virtual.test'], ['Connection', 'keep-alive'], ['Cookie', 'sid=1'], ['Origin', 'https://evil.test']],
      openSocket: net.openSocket,
    });
    expect(net.sockets[0].text).toBe('GET / HTTP/1.1\r\nX-A: 1\r\nhost: virtual.test\r\nConnection: keep-alive\r\nCookie: sid=1\r\nOrigin: https://evil.test\r\n\r\n');
  });

  it('sends Content-Length with a body and 0 for an empty POST', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'http://example.com/p', method: 'PUT', headers: [['Content-Type', 'application/json']], body: bytes('{"a":"é"}'), openSocket: net.openSocket });
    expect(net.sockets[0].text).toBe('PUT /p HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 10\r\nConnection: close\r\n\r\n{"a":"é"}');

    const net2 = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'http://example.com/', method: 'POST', openSocket: net2.openSocket });
    expect(net2.sockets[0].text).toBe('POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });

  it('frames the body itself when the caller sets Transfer-Encoding: chunked', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'http://example.com/', method: 'POST', headers: [['Transfer-Encoding', 'chunked']], body: bytes('hello world!'), openSocket: net.openSocket });
    expect(net.sockets[0].text).toBe('POST / HTTP/1.1\r\nHost: example.com\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nc\r\nhello world!\r\n0\r\n\r\n');
  });

  it('rejects header injection', async () => {
    const net = fakeNet({ respond: () => '' });
    await expect(http1Request({ url: 'http://example.com/', headers: [['X', 'a\r\nEvil: 1']], openSocket: net.openSocket })).rejects.toThrow(/line break/);
  });

  it('trims whitespace around header values the way fetch does', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' });
    await http1Request({ url: 'http://example.com/', headers: [['X-Api-Key', ' abc123\r\n'], ['X-Tab', '\tv ']], openSocket: net.openSocket });
    expect(net.sockets[0].text).toBe('GET / HTTP/1.1\r\nHost: example.com\r\nX-Api-Key: abc123\r\nX-Tab: v\r\nConnection: close\r\n\r\n');
  });
});

describe('http1Request content decoding', () => {
  const text = 'compressible '.repeat(200);

  it('decodes gzip and x-gzip', async () => {
    for (const coding of ['gzip', 'x-gzip']) {
      const gz = gzipSync(text);
      const net = fakeNet({ respond: () => join(`HTTP/1.1 200 OK\r\nContent-Encoding: ${coding}\r\nContent-Length: ${gz.length}\r\n\r\n`, gz) });
      const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
      expect(dec.decode(res.body)).toBe(text);
      expect(res.encodedSize).toBe(gz.length);
      expect(res.decodedSize).toBe(text.length);
      expect(res.decoded).toBe(true);
    }
  });

  it('decodes zlib deflate and raw deflate', async () => {
    for (const data of [deflateSync(text), deflateRawSync(text)]) {
      const net = fakeNet({ respond: () => join(`HTTP/1.1 200 OK\r\nContent-Encoding: deflate\r\nContent-Length: ${data.length}\r\n\r\n`, data) });
      const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
      expect(dec.decode(res.body)).toBe(text);
    }
  });

  it('decodes gzip sent chunked', async () => {
    const gz = gzipSync(text);
    const half = Math.floor(gz.length / 2);
    const raw = join(
      `HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n\r\n${half.toString(16)}\r\n`,
      gz.subarray(0, half),
      `\r\n${(gz.length - half).toString(16)}\r\n`,
      gz.subarray(half),
      '\r\n0\r\n\r\n',
    );
    const net = fakeNet({ fragment: 1, respond: () => raw });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
    expect(dec.decode(res.body)).toBe(text);
  });

  it('brotli decodes when supported, otherwise returns the raw body flagged', async () => {
    const br = brotliCompressSync(text);
    const net = fakeNet({ respond: () => join(`HTTP/1.1 200 OK\r\nContent-Encoding: br\r\nContent-Length: ${br.length}\r\n\r\n`, br) });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
    // The Compression Streams standard calls the format "brotli".
    let brotli = true;
    try {
      new DecompressionStream('brotli'); // eslint-disable-line no-new
    } catch {
      brotli = false;
    }
    expect(res.decoded).toBe(brotli);
    if (res.decoded) {
      expect(dec.decode(res.body)).toBe(text);
    } else {
      expect(res.undecodedEncoding).toBe('br');
      expect(res.body).toEqual(new Uint8Array(br));
    }
  });

  it('ignores bytes after the end of a gzip stream', async () => {
    const out = await decodeContent(join(gzipSync(Buffer.from('hello')), '\n'), ['gzip']);
    expect(out.decoded).toBe(true);
    expect(dec.decode(out.body)).toBe('hello');
  });

  it('never returns a cut-off body when longer junk follows a gzip stream', async () => {
    const text = 'x'.repeat(300000) + Array.from({ length: 20000 }, (_, i) => i).join(',');
    const out = await decodeContent(join(gzipSync(Buffer.from(text)), 'junk after the stream'), ['gzip']);
    // Engines that name trailing junk get the whole body; others report the problem.
    if (out.decoded) expect(dec.decode(out.body)).toBe(text);
    else expect(out.decodeError).toMatch(/Could not decode gzip/);
  });

  it('returns the raw body with decodeError for corrupt data', async () => {
    const out = await decodeContent(bytes('not gzip at all'), ['gzip']);
    expect(out.decoded).toBe(false);
    expect(out.decodeError).toMatch(/Could not decode gzip/);
    expect(dec.decode(out.body)).toBe('not gzip at all');
  });

  it('undoes a gzip transfer coding', async () => {
    const gz = gzipSync(Buffer.from('hello'));
    const chunked = join(`HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n${gz.length.toString(16)}\r\n`, gz, '\r\n0\r\n\r\n');
    const net = fakeNet({ fragment: 'single', closeAfter: false, respond: () => chunked });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket });
    expect(dec.decode(res.body)).toBe('hello');
  });

  it('caps the decoded size too', async () => {
    const gz = gzipSync(Buffer.alloc(50000));
    const net = fakeNet({ respond: () => join(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${gz.length}\r\n\r\n`, gz) });
    await expect(http1Request({ url: 'http://example.com/', maxBodyBytes: 10000, openSocket: net.openSocket })).rejects.toMatchObject({ name: 'BodyTooLargeError' });
  });
});

describe('http1Request failures', () => {
  it('aborts via signal and closes the socket', async () => {
    const net = fakeNet({ silent: true, respond: () => '' });
    const ctrl = new AbortController();
    const p = http1Request({ url: 'http://example.com/', openSocket: net.openSocket, signal: ctrl.signal });
    await tick();
    await tick();
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(net.sockets[0].closed).toBe(true);
  });

  it('limits the total size of chunked trailers', async () => {
    const trailers = 'X-T: '.concat('a'.repeat(95), '\r\n').repeat(20000);
    const net = fakeNet({ fragment: 'single', respond: () => `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n${trailers}\r\n` });
    await expect(http1Request({ url: 'http://example.com/', openSocket: net.openSocket })).rejects.toThrow(/trailers are too large/);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const net = fakeNet({ respond: () => '' });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(http1Request({ url: 'http://example.com/', openSocket: net.openSocket, signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(net.sockets.length).toBe(0);
  });

  it('times out', async () => {
    const net = fakeNet({ silent: true, respond: () => '' });
    const err = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket, timeoutMs: 30 }).catch((e) => e);
    expect(err.name).toBe('TimeoutError');
    expect(err.message).toMatch(/30 ms/);
    expect(net.sockets[0].closed).toBe(true);
  });

  it('does not time out at once when the timeout is too long for a timer', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok' });
    const res = await http1Request({ url: 'http://example.com/', openSocket: net.openSocket, timeoutMs: 2 ** 31 });
    expect(res.status).toBe(200);
  });

  it('reports connection errors helpfully', async () => {
    const net = fakeNet({ failConnect: 'ECONNREFUSED', respond: () => '' });
    await expect(http1Request({ url: 'http://example.com:81/', openSocket: net.openSocket })).rejects.toThrow('Could not connect to example.com:81: ECONNREFUSED');
    const throwing = () => {
      throw new Error('no relay');
    };
    await expect(http1Request({ url: 'https://example.com/', openSocket: throwing })).rejects.toThrow('Could not connect to example.com:443: no relay');
  });

  it('errors when the connection closes mid-body', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort' });
    await expect(http1Request({ url: 'http://example.com/', openSocket: net.openSocket })).rejects.toThrow(/before the response body was complete/);
  });

  it('errors on a non-HTTP reply', async () => {
    const net = fakeNet({ respond: () => 'SSH-2.0-OpenSSH_9.6\r\n\r\n' });
    await expect(http1Request({ url: 'http://example.com:22/', openSocket: net.openSocket })).rejects.toThrow(/valid HTTP response/);
  });

  it('enforces maxBodyBytes for Content-Length, chunked and close-delimited bodies', async () => {
    const big = 'x'.repeat(2000);
    const cases = [
      `HTTP/1.1 200 OK\r\nContent-Length: ${big.length}\r\n\r\n${big}`,
      `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${big.length.toString(16)}\r\n${big}\r\n0\r\n\r\n`,
      `HTTP/1.1 200 OK\r\n\r\n${big}`,
    ];
    for (const raw of cases) {
      const net = fakeNet({ respond: () => raw });
      const err = await http1Request({ url: 'http://example.com/', maxBodyBytes: 1000, openSocket: net.openSocket }).catch((e) => e);
      expect(err.name).toBe('BodyTooLargeError');
      expect(net.sockets[0].closed).toBe(true);
    }
  });

  it('reports progress phases', async () => {
    const net = fakeNet({ respond: () => 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello' });
    const phases = [];
    await http1Request({ url: 'http://example.com/', openSocket: net.openSocket, onProgress: ({ phase }) => phases.push(phase) });
    const distinct = phases.filter((p, i) => p !== phases[i - 1]);
    expect(distinct[0]).toBe('connecting');
    expect(distinct).toContain('headers');
    expect(distinct[distinct.length - 1]).toBe('done');
  });
});

describe('followRedirects', () => {
  const reply = (status, headers = [], body = '') => ({ status, statusText: '', headers, body: bytes(body) });

  function server(routes) {
    const calls = [];
    const sendOnce = vi.fn(async (req) => {
      calls.push({ ...req, headers: req.headers.map(([k, v]) => [k, v]) });
      const handler = routes[req.url];
      if (!handler) return reply(404);
      return typeof handler === 'function' ? handler(req) : handler;
    });
    return { sendOnce, calls };
  }

  it('turns POST into GET on 303 and drops the body headers', async () => {
    const { sendOnce, calls } = server({
      'https://a.test/submit': reply(303, [['Location', '/done?x=1']]),
      'https://a.test/done?x=1': reply(200, [], 'ok'),
    });
    const res = await followRedirects(sendOnce, {
      url: 'https://a.test/submit',
      method: 'POST',
      headers: [['Content-Type', 'application/json'], ['Content-Length', '2'], ['X-Keep', '1']],
      body: bytes('{}'),
    });
    expect(res.status).toBe(200);
    expect(res.url).toBe('https://a.test/done?x=1');
    expect(res.redirects).toEqual([{ url: 'https://a.test/submit', status: 303, location: '/done?x=1' }]);
    expect(calls[1]).toMatchObject({ method: 'GET', body: null, headers: [['X-Keep', '1']] });
  });

  it('301/302 turn POST into GET but keep PUT', async () => {
    for (const status of [301, 302]) {
      const { sendOnce, calls } = server({ 'http://a.test/x': reply(status, [['Location', 'http://a.test/y']]), 'http://a.test/y': reply(200) });
      await followRedirects(sendOnce, { url: 'http://a.test/x', method: 'POST', body: bytes('b') });
      expect(calls[1]).toMatchObject({ method: 'GET', body: null });
      const second = server({ 'http://a.test/x': reply(status, [['Location', 'http://a.test/y']]), 'http://a.test/y': reply(200) });
      await followRedirects(second.sendOnce, { url: 'http://a.test/x', method: 'PUT', body: bytes('b') });
      expect(second.calls[1].method).toBe('PUT');
      expect(dec.decode(second.calls[1].body)).toBe('b');
    }
  });

  it('307 and 308 keep the method and body', async () => {
    for (const status of [307, 308]) {
      const { sendOnce, calls } = server({ 'http://a.test/x': reply(status, [['location', 'y']]), 'http://a.test/y': reply(200) });
      const res = await followRedirects(sendOnce, { url: 'http://a.test/x', method: 'POST', headers: [['Content-Type', 'text/plain']], body: bytes('keep') });
      expect(res.url).toBe('http://a.test/y');
      expect(calls[1]).toMatchObject({ method: 'POST', headers: [['Content-Type', 'text/plain']] });
      expect(dec.decode(calls[1].body)).toBe('keep');
    }
  });

  it('resolves relative locations against the current URL', async () => {
    const { sendOnce } = server({
      'http://a.test/one/two': reply(302, [['Location', '../three']]),
      'http://a.test/three': reply(302, [['Location', '//b.test/four']]),
      'http://b.test/four': reply(200),
    });
    const res = await followRedirects(sendOnce, { url: 'http://a.test/one/two' });
    expect(res.url).toBe('http://b.test/four');
    expect(res.redirects.map((r) => r.url)).toEqual(['http://a.test/one/two', 'http://a.test/three']);
  });

  it('drops Authorization and Cookie across hosts but keeps them on the same origin', async () => {
    const { sendOnce, calls } = server({
      'https://a.test/1': reply(302, [['Location', '/2']]),
      'https://a.test/2': reply(302, [['Location', 'https://b.test/3']]),
      'https://b.test/3': reply(200),
    });
    await followRedirects(sendOnce, { url: 'https://a.test/1', headers: [['Authorization', 'Bearer t'], ['Cookie', 'a=1'], ['Accept', 'x']] });
    expect(calls[1].headers).toEqual([['Authorization', 'Bearer t'], ['Cookie', 'a=1'], ['Accept', 'x']]);
    expect(calls[2].headers).toEqual([['Accept', 'x']]);
  });

  it('throws after maxRedirects', async () => {
    const sendOnce = async (req) => reply(302, [['Location', `${req.url}x`]]);
    const err = await followRedirects(sendOnce, { url: 'http://a.test/', maxRedirects: 3 }).catch((e) => e);
    expect(err.name).toBe('TooManyRedirectsError');
    expect(err.redirects.length).toBe(3);
  });

  it('returns the redirect response itself when follow is false', async () => {
    const { sendOnce, calls } = server({ 'http://a.test/': reply(301, [['Location', '/b']]) });
    const res = await followRedirects(sendOnce, { url: 'http://a.test/', follow: false });
    expect(res.status).toBe(301);
    expect(res.redirects).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it('works end to end with http1Request', async () => {
    const net = fakeNet({
      respond: (req) => {
        if (req.startsWith('POST /start')) return 'HTTP/1.1 303 See Other\r\nLocation: /end\r\nContent-Length: 0\r\n\r\n';
        return 'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndone';
      },
    });
    const res = await followRedirects((req) => http1Request({ ...req, openSocket: net.openSocket }), {
      url: 'http://a.test/start',
      method: 'POST',
      headers: [['Content-Type', 'text/plain']],
      body: bytes('hi'),
    });
    expect(dec.decode(res.body)).toBe('done');
    expect(net.sockets[1].text).toBe('GET /end HTTP/1.1\r\nHost: a.test\r\nConnection: close\r\n\r\n');
  });
});

describe('toBytes', () => {
  it('converts strings, buffers, views and blobs', async () => {
    expect(await toBytes(null)).toEqual({ bytes: null, contentType: null });
    const s = await toBytes('hé');
    expect([...s.bytes]).toEqual([104, 195, 169]);
    expect(s.contentType).toBe('text/plain;charset=UTF-8');
    expect([...(await toBytes(new Uint8Array([1, 2, 3]).buffer)).bytes]).toEqual([1, 2, 3]);
    expect([...(await toBytes(new Uint16Array([1]))).bytes]).toEqual([1, 0]);
    const blob = await toBytes(new Blob(['abc'], { type: 'text/csv' }));
    expect(dec.decode(blob.bytes)).toBe('abc');
    expect(blob.contentType).toBe('text/csv');
  });

  it('serializes URLSearchParams', async () => {
    const out = await toBytes(new URLSearchParams({ a: '1', b: 'x y' }));
    expect(dec.decode(out.bytes)).toBe('a=1&b=x+y');
    expect(out.contentType).toMatch(/^application\/x-www-form-urlencoded/);
  });
});
