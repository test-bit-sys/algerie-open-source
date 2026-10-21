import { describe, it, expect as vexpect } from 'vitest';
import { RUNTIME_SOURCE, createExpect, runScript, serialize, createResponseApi, normalizeSendRequest } from '../src/core/scripts/runtime.js';
import { ScriptSandbox, hasScript } from '../src/core/scripts/sandbox.js';
import { fakeLoader } from './helpers/fake-loader.js';

const expect = createExpect();

function fails(fn) {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  throw new Error('expected the assertion to fail');
}

function message(fields = {}) {
  return {
    id: 'm1',
    phase: 'pre',
    code: '',
    request: {
      method: 'GET',
      url: 'https://api.example.com/items',
      headers: [
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'X-Off', value: '1', enabled: false },
      ],
      body: { mode: 'none', raw: '', rawType: 'json' },
    },
    variables: { environment: {}, collection: {}, globals: {}, local: {} },
    info: { requestName: 'List items', requestId: 'r1', iteration: 0, iterationCount: 1 },
    ...fields,
  };
}

const okResponse = {
  status: 201,
  statusText: 'Created',
  headers: [['Content-Type', 'application/json'], ['Set-Cookie', 'a=1'], ['set-cookie', 'b=2']],
  bodyText: '{"id":7,"tags":["x","y"]}',
  timeMs: 42,
  sizeBytes: 25,
};

describe('expect matchers', () => {
  it('passes and fails with readable messages', () => {
    expect(1).toBe(1);
    vexpect(fails(() => expect(1).toBe(2))).toBe('expected 1 to be 2');
    vexpect(fails(() => expect({ a: 1 }).toBe({ a: 1 }))).toMatch(/use toEqual/);
    expect({ a: [1, { b: 2 }], u: undefined }).toEqual({ a: [1, { b: 2 }] });
    vexpect(fails(() => expect({ a: 1 }).toEqual({ a: 2 }))).toBe('expected {a: 1} to equal {a: 2}');
    vexpect(fails(() => expect({ a: 1, u: undefined }).toStrictEqual({ a: 1 }))).toMatch(/strictly equal/);
    expect(NaN).toEqual(NaN);
    expect(new Date(5)).toEqual(new Date(5));
    expect(new Map([['k', { v: 1 }]])).toEqual(new Map([['k', { v: 1 }]]));
  });

  it('supports .not', () => {
    expect(1).not.toBe(2);
    vexpect(fails(() => expect('a').not.toBe('a'))).toBe('expected "a" not to be "a"');
    vexpect(fails(() => expect([1]).not.toHaveLength(1))).toBe('expected [1] not to have length 1');
  });

  it('covers the rest of the matcher set', () => {
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(0).toBeDefined();
    expect(NaN).toBeNaN();
    expect(3).toBeGreaterThan(2);
    expect(3).toBeGreaterThanOrEqual(3);
    expect(1).toBeLessThan(2);
    expect(2).toBeLessThanOrEqual(2);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    expect('hello').toContain('ell');
    expect([1, 2]).toContain(2);
    expect([{ a: 1 }]).toContainEqual({ a: 1 });
    expect('abc123').toMatch(/\d+/);
    expect('abc').toMatch('bc');
    expect('abc').toHaveLength(3);
    expect({ a: { b: [{ c: 5 }] } }).toHaveProperty('a.b[0].c', 5);
    expect({ a: { b: 1 } }).toHaveProperty(['a', 'b']);
    expect(new TypeError('x')).toBeInstanceOf(Error);
    expect(201).toBeOneOf([200, 201]);
    expect([]).toBeType('array');
    expect(null).toBeType('null');
    expect({}).toBeType('object');
    expect({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } });
    expect(() => {
      throw new TypeError('bad thing');
    }).toThrow('bad');
    expect(() => {
      throw new TypeError('bad thing');
    }).toThrow(TypeError);
    expect(() => {}).not.toThrow();
  });

  it('explains failures with detail', () => {
    vexpect(fails(() => expect('abc').toHaveLength(2))).toBe('expected "abc" to have length 2, but its length is 3');
    vexpect(fails(() => expect('1').toBeType('number'))).toBe('expected "1" to be of type number, but it is string');
    vexpect(fails(() => expect({ a: 1 }).toHaveProperty('a', 2))).toMatch(/but it is 1/);
    vexpect(fails(() => expect(() => {}).toThrow())).toMatch(/did not throw/);
    vexpect(fails(() => expect('x').toBeGreaterThan(1))).toMatch(/expected a number/);
    vexpect(fails(() => expect(1).toBeType('thing'))).toMatch(/unknown type/);
    const long = fails(() => expect('x'.repeat(1000)).toBe('y'));
    vexpect(long.length).toBeLessThan(500);
  });

  it('rejects a non-numeric expected value in comparison matchers', () => {
    vexpect(fails(() => expect(5).not.toBeGreaterThan(undefined))).toMatch(/toBeGreaterThan: expected value must be a number/);
    vexpect(fails(() => expect(5).toBeGreaterThan(null))).toMatch(/expected value must be a number but received null/);
    vexpect(fails(() => expect(5).toBeGreaterThanOrEqual('abc'))).toMatch(/expected value must be a number/);
    vexpect(fails(() => expect(5).not.toBeLessThan({}))).toMatch(/expected value must be a number/);
    vexpect(fails(() => expect(5).toBeLessThanOrEqual(''))).toMatch(/expected value must be a number/);
    vexpect(fails(() => expect(5).not.toBeCloseTo(undefined))).toMatch(/expected value must be a number/);
    vexpect(fails(() => expect('abc').not.toHaveLength(null))).toMatch(/expected value must be a number/);
    // Variables are strings, so numeric strings still compare as numbers.
    expect(5).toBeGreaterThan('3');
    expect(5).not.toBeLessThan(' 3 ');
    expect(0.1 + 0.2).toBeCloseTo('0.3');
    expect('abc').toHaveLength('3');
    expect(5n).toBeLessThanOrEqual(5n);
  });

  it('supports resolves and rejects', async () => {
    await expect(Promise.resolve(5)).resolves.toBe(5);
    await expect(Promise.reject(new Error('nope'))).rejects.toHaveProperty('message', 'nope');
    await vexpect(expect(Promise.resolve(1)).rejects.toBe(1)).rejects.toThrow(/expected promise to reject/);
  });
});

describe('runScript', () => {
  it('records sync, async, failing and skipped tests in order', async () => {
    const r = await runScript(
      message({
        code: `
          test('sync ok', () => expect(1).toBe(1));
          test('sync fail', () => expect(1).toBe(2));
          test('async ok', async () => { await new Promise((r) => setTimeout(r, 5)); expect(true).toBeTruthy(); });
          test('async fail', async () => { await null; throw new TypeError('boom'); });
          test.skip('later', () => {});
        `,
      }),
    );
    vexpect(r.ok).toBe(true);
    vexpect(r.tests.map((t) => [t.name, t.passed, t.skipped])).toEqual([
      ['sync ok', true, false],
      ['sync fail', false, false],
      ['async ok', true, false],
      ['async fail', false, false],
      ['later', false, true],
    ]);
    vexpect(r.tests[1].error).toBe('expected 1 to be 2');
    vexpect(r.tests[3].error).toBe('TypeError: boom');
    vexpect(r.tests[2].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves variables by precedence and reports set/unset', async () => {
    const r = await runScript(
      message({
        variables: {
          environment: { host: 'env.example.com', token: 'e' },
          collection: { host: 'col.example.com', ver: 'v1' },
          globals: { ver: 'v0', g: 'G' },
          local: { token: 'local' },
        },
        code: `
          test('precedence', () => {
            expect(variables.get('token')).toBe('local');
            expect(variables.get('host')).toBe('env.example.com');
            expect(variables.get('ver')).toBe('v1');
            expect(variables.get('g')).toBe('G');
            expect(variables.get('nope')).toBeUndefined();
            expect(variables.resolve('https://{{host}}/{{ ver }}/{{missing}}')).toBe('https://env.example.com/v1/{{missing}}');
          });
          env.set('count', 3);
          env.set('obj', { a: 1 });
          env.unset('token');
          collectionVars.set('flag', true);
          globals.clear();
          vars.set('nested', '{{host}}');
          test('nested', () => expect(variables.resolve('{{nested}}')).toBe('env.example.com'));
        `,
      }),
    );
    vexpect(r.tests.every((t) => t.passed)).toBe(true);
    vexpect(r.variables).toEqual({
      environment: { host: 'env.example.com', count: '3', obj: '{"a":1}' },
      collection: { host: 'col.example.com', ver: 'v1', flag: 'true' },
      globals: {},
      local: { token: 'local', nested: '{{host}}' },
    });
  });

  it('lets pre-request scripts change the request', async () => {
    const r = await runScript(
      message({
        code: `
          request.method = 'post';
          request.url = request.url + '?page=2';
          request.headers.set('accept', 'text/plain');
          request.headers.set('X-Trace', utils.uuid());
          request.headers.remove('x-off');
          request.body.raw = { hello: 'world' };
          test('reads', () => {
            expect(request.headers.get('ACCEPT')).toBe('text/plain');
            expect(request.headers.has('x-trace')).toBe(true);
            expect(request.body.json()).toEqual({ hello: 'world' });
          });
        `,
      }),
    );
    vexpect(r.tests[0].passed).toBe(true);
    vexpect(r.request.method).toBe('POST');
    vexpect(r.request.url).toBe('https://api.example.com/items?page=2');
    vexpect(r.request.headers.map((h) => h.key)).toEqual(['Accept', 'X-Trace']);
    vexpect(r.request.headers[0].value).toBe('text/plain');
    vexpect(r.request.body).toEqual({ mode: 'raw', raw: '{"hello":"world"}', rawType: 'json' });
  });

  it('keeps the request read-only after the response', async () => {
    const r = await runScript(message({ phase: 'post', response: okResponse, code: "request.url = 'x';" }));
    vexpect(r.ok).toBe(false);
    vexpect(r.error.message).toMatch(/read-only/);
    vexpect(r.request).toBeUndefined();
  });

  it('exposes response helpers', async () => {
    const r = await runScript(
      message({
        phase: 'post',
        response: okResponse,
        code: `
          test('response', () => {
            expect(response.status).toBe(201);
            expect(response.code).toBe(201);
            expect(response.ok).toBe(true);
            expect(response.statusText).toBe('Created');
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(response.headers.get('set-cookie')).toBe('a=1, b=2');
            expect(response.json().tags).toContain('y');
            expect(response.json()).toBe(response.json());
            expect(response.time).toBe(42);
            expect(response.size).toBe(25);
            expect(info.phase).toBe('post');
            expect(info.requestName).toBe('List items');
          });
        `,
      }),
    );
    vexpect(r.tests[0]).toMatchObject({ passed: true, error: null });
  });

  it('gives a helpful error when the body is not JSON', () => {
    const res = createResponseApi({ status: 500, bodyText: '<html>oops</html>' });
    vexpect(() => res.json()).toThrow(/Response body is not valid JSON .*It starts with: "<html>oops<\/html>"/);
    vexpect(() => createResponseApi({ status: 204, bodyText: '' }).json()).toThrow(/empty/);
    vexpect(res.ok).toBe(false);
  });

  it('captures console output safely', async () => {
    const r = await runScript(
      message({
        code: `
          const a = { name: 'a', fn() {} };
          a.self = a;
          console.log('hi', 1, a);
          console.warn('big', 'x'.repeat(20000));
          console.error(new Error('bad'));
          console.debug(undefined, 10n);
        `,
      }),
    );
    vexpect(r.logs.map((l) => l.level)).toEqual(['log', 'warn', 'error', 'debug']);
    vexpect(r.logs[0].args).toEqual(['hi', 1, { name: 'a', fn: '[Function fn]', self: '[Circular]' }]);
    vexpect(r.logs[1].args[1].length).toBeLessThan(10100);
    vexpect(r.logs[2].args[0]).toMatchObject({ name: 'Error', message: 'bad' });
    vexpect(r.logs[3].args).toEqual([undefined, '10n']);
    vexpect(typeof r.logs[0].at).toBe('number');
    vexpect(() => structuredClone(r)).not.toThrow();
  });

  it('serializes deep and wide values', () => {
    const wide = Array.from({ length: 300 }, (_, i) => i);
    vexpect(serialize(wide).length).toBe(201);
    let deep = {};
    const root = deep;
    for (let i = 0; i < 20; i++) deep = deep.next = {};
    vexpect(JSON.stringify(serialize(root))).toContain('[Object]');
  });

  it('bridges send() to the host', async () => {
    const seen = [];
    const host = {
      async send(request) {
        seen.push(request);
        return { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], bodyText: '{"token":"abc"}', timeMs: 3 };
      },
    };
    const r = await runScript(
      message({
        code: `
          const res = await send({ url: 'https://auth.example.com/token', method: 'post', body: { user: 'u' } });
          env.set('token', res.json().token);
          send('https://example.com/ping').then((res2) => test('unawaited send', () => expect(res2.status).toBe(200)));
        `,
      }),
      host,
    );
    vexpect(r.ok).toBe(true);
    vexpect(r.variables.environment.token).toBe('abc');
    vexpect(r.tests).toHaveLength(1);
    vexpect(r.tests[0].passed).toBe(true);
    vexpect(seen[0]).toEqual({
      method: 'POST',
      url: 'https://auth.example.com/token',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { mode: 'raw', raw: '{"user":"u"}', rawType: 'json' },
    });
    vexpect(seen[1].method).toBe('GET');
  });

  it('sends an object body whose mode field is not a body mode as JSON', () => {
    vexpect(normalizeSendRequest({ url: 'https://x.example.com', method: 'POST', body: { mode: 'payment', amount: 5 } })).toEqual({
      method: 'POST',
      url: 'https://x.example.com',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { mode: 'raw', raw: '{"mode":"payment","amount":5}', rawType: 'json' },
    });
    vexpect(normalizeSendRequest({ url: 'https://x.example.com', method: 'POST', body: { mode: 'raw', raw: 'hi' } }).body).toEqual({ mode: 'raw', raw: 'hi' });
  });

  it('reports send failures and missing hosts', async () => {
    const r = await runScript(message({ code: "await send('https://x.example.com');" }));
    vexpect(r.error.message).toBe('send() is not available here');
    vexpect(() => normalizeSendRequest({})).toThrow(/url/);
  });

  it('records runner flow', async () => {
    const a = await runScript(message({ code: "runner.next('Login');" }));
    vexpect(a.flow).toEqual({ next: 'Login', stop: false });
    const b = await runScript(message({ code: 'runner.next(null); runner.stop();' }));
    vexpect(b.flow).toEqual({ next: null, stop: true });
    const c = await runScript(message({ code: '' }));
    vexpect(c.flow).toEqual({ next: undefined, stop: false });
  });

  it('reports syntax and runtime errors, keeping earlier tests', async () => {
    const syntax = await runScript(message({ code: 'test("x", () => {' }));
    vexpect(syntax.ok).toBe(false);
    vexpect(syntax.error.name).toBe('SyntaxError');
    vexpect(syntax.tests).toEqual([]);

    const thrown = await runScript(message({ code: "test('before', () => {});\nenv.set('a', 1);\nnull.boom;\ntest('after', () => {});" }));
    vexpect(thrown.ok).toBe(false);
    vexpect(thrown.error.name).toBe('TypeError');
    vexpect(thrown.error.line).toBe(3);
    vexpect(thrown.tests.map((t) => t.name)).toEqual(['before']);
    vexpect(thrown.variables.environment).toEqual({ a: '1' });
  });

  it('supports top-level await and the api object', async () => {
    const r = await runScript(
      message({
        code: `
          const v = await new Promise((r) => setTimeout(() => r(5), 5));
          api.vars.set('v', v);
          const hash = await utils.sha256('abc');
          vars.set('hash', hash);
          vars.set('b64', utils.base64('héllo'));
          vars.set('back', utils.base64Decode(utils.base64('héllo')));
        `,
      }),
    );
    vexpect(r.error).toBeUndefined();
    vexpect(r.variables.local.v).toBe('5');
    vexpect(r.variables.local.hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vexpect(r.variables.local.b64).toBe('aMOpbGxv');
    vexpect(r.variables.local.back).toBe('héllo');
  });

  it('computes HMAC-SHA256', async () => {
    const code = "vars.set('mac', await utils.hmacSha256('key', 'The quick brown fox jumps over the lazy dog'));";
    const r = await runScript(message({ code }));
    vexpect(r.variables.local.mac).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('signs the body as it is sent, with its variables filled in, in the signature snippet', async () => {
    const { SNIPPETS } = await import('../src/ui/scripts-editor.js');
    const { code } = SNIPPETS.pre.find((s) => s.label === 'Generate a signature');
    const request = { method: 'POST', url: '{{base}}/items', headers: [], body: { mode: 'raw', raw: '{"user":"{{user}}"}', rawType: 'json' } };
    const variables = { environment: { apiSecret: 's3cret', base: 'https://api.example.com', user: 'ada' }, collection: {}, globals: {}, local: {} };
    const r = await runScript(message({ code, request, variables }));
    const expected = await runScript(message({ code: `vars.set('mac', await utils.hmacSha256('s3cret', 'POST\\nhttps://api.example.com/items\\n{"user":"ada"}'));` }));
    vexpect(r.request.headers.find((h) => h.key === 'X-Signature').value).toBe(expected.variables.local.mac);
  });

  it('hashes without Web Crypto (opaque-origin contexts)', async () => {
    const { createUtils } = await import('../src/core/scripts/runtime.js');
    const utils = createUtils({ getRandomValues: (b) => crypto.getRandomValues(b) });
    vexpect(await utils.sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const long = 'a'.repeat(1000);
    const native = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(long))).toString('hex');
    vexpect(await utils.sha256(long)).toBe(native);
    // Keys longer than the 64-byte block are hashed first.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('k'.repeat(100)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const nativeMac = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode('msg'))).toString('hex');
    vexpect(await utils.hmacSha256('k'.repeat(100), 'msg')).toBe(nativeMac);
    vexpect(utils.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('RUNTIME_SOURCE', () => {
  it('is self-contained and serves the worker protocol', async () => {
    const listeners = {};
    const posted = [];
    const fakeSelf = {
      addEventListener: (type, fn) => (listeners[type] = fn),
      postMessage: (m) => posted.push(m),
    };
    class FakeWorkerScope {}
    Object.setPrototypeOf(fakeSelf, FakeWorkerScope.prototype);
    // Evaluated with no access to this module's scope.
    new Function('self', 'WorkerGlobalScope', RUNTIME_SOURCE)(fakeSelf, FakeWorkerScope);

    listeners.message({ data: { type: 'hello' } });
    vexpect(posted[0]).toEqual({ type: 'hello' });

    const code = "const r = await send('https://x.example.com'); test('t', () => expect(r.status).toBe(204));";
    listeners.message({ data: { type: 'run', message: message({ code }) } });
    await vexpect.poll(() => posted.find((m) => m.type === 'send')).toBeTruthy();
    const sendMsg = posted.find((m) => m.type === 'send');
    vexpect(sendMsg.request.url).toBe('https://x.example.com');
    listeners.message({ data: { type: 'sendResult', sendId: sendMsg.sendId, response: { status: 204, bodyText: '' } } });
    await vexpect.poll(() => posted.find((m) => m.type === 'result')).toBeTruthy();
    const { result } = posted.find((m) => m.type === 'result');
    vexpect(result.ok).toBe(true);
    vexpect(result.tests[0].passed).toBe(true);
  });

  it('exposes the API on self when not in a worker', () => {
    const fakeSelf = {};
    new Function('self', RUNTIME_SOURCE)(fakeSelf);
    vexpect(typeof fakeSelf.__scriptRuntime.runScript).toBe('function');
  });
});

describe('ScriptSandbox', () => {
  it('detects empty and comment-only scripts', () => {
    vexpect(hasScript('')).toBe(false);
    vexpect(hasScript('   \n\t')).toBe(false);
    vexpect(hasScript('// just a note\n/* block\n comment */\n')).toBe(false);
    vexpect(hasScript('/* unterminated')).toBe(false);
    vexpect(hasScript(null)).toBe(false);
    vexpect(hasScript("test('x', () => {})")).toBe(true);
    vexpect(hasScript("const u = 'http://example.com'; // note")).toBe(true);
  });

  it('constructs lazily and reports startup failure', async () => {
    const sandbox = new ScriptSandbox({ timeoutMs: 100, bootTimeoutMs: 50 });
    vexpect(sandbox.mode).toBeNull();
    vexpect(document.querySelector('iframe')).toBeNull();
    // jsdom does not run the iframe's scripts, so the loader never answers.
    const r = await sandbox.run(message({ code: 'test("x", () => {})' }));
    vexpect(r).toMatchObject({ id: 'm1', ok: false, error: { message: 'Script sandbox failed to start' } });
    vexpect(document.querySelector('iframe')).toBeNull();
    sandbox.dispose();
    const after = await sandbox.run(message());
    vexpect(after.error.message).toMatch(/disposed/);
  });

  it('changes no variables when a failed run reports none', async () => {
    const sandbox = new ScriptSandbox();
    const variables = { environment: { token: 'abc' }, collection: { base: 'x' }, globals: { g: '1' }, local: { l: '2' } };
    const pending = sandbox.run(message({ variables }));
    // What the loader sends when a worker dies, e.g. from an uncaught throw in a timer.
    fakeLoader((d, port) => d.type === 'run' && port.postMessage({ type: 'result', id: d.id, result: { ok: false, error: { message: 'Script worker failed: Uncaught null' } } }));
    const r = await pending;
    vexpect(r).toMatchObject({ ok: false, error: { message: 'Script worker failed: Uncaught null' } });
    vexpect(r.variables).toEqual(variables);
    sandbox.dispose();
  });

  it('stops a script and the requests it sent when the run is cancelled', async () => {
    const sends = [];
    const onSend = (request, { signal }) => {
      sends.push(signal);
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    };
    const sandbox = new ScriptSandbox({ onSend });
    const variables = { environment: { token: 'abc' }, collection: {}, globals: {}, local: {} };
    const controller = new AbortController();
    const pending = sandbox.run(message({ variables }), { signal: controller.signal });
    const terminated = [];
    fakeLoader((d, port) => {
      if (d.type === 'run') port.postMessage({ type: 'send', id: d.id, sendId: 1, request: { url: 'https://slow.test' } });
      else if (d.type === 'terminate') terminated.push(d.id);
      else if (d.type === 'ping') port.postMessage({ type: 'pong', nonce: d.nonce });
    });
    await vexpect.poll(() => sends.length).toBe(1);
    vexpect(sends[0].aborted).toBe(false);
    controller.abort();
    const r = await pending;
    vexpect(r).toMatchObject({ ok: false, error: { message: 'Script stopped' } });
    vexpect(r.variables).toEqual(variables);
    vexpect(sends[0].aborted).toBe(true);
    await vexpect.poll(() => terminated.length).toBe(1);
    // The iframe answered the ping, so it is kept for the next run.
    vexpect(document.querySelectorAll('iframe[title="Script sandbox"]')).toHaveLength(1);
    // A run that is already cancelled does not start.
    const again = await sandbox.run(message(), { signal: controller.signal });
    vexpect(again.error.message).toBe('Script stopped');
    vexpect(terminated).toHaveLength(1);
    sandbox.dispose();
  });

  it('gives every run its own iframe when scripts run inline, so one script cannot spy on the next', async () => {
    const sandbox = new ScriptSandbox();
    const frames = () => [...document.querySelectorAll('iframe[title="Script sandbox"]')];
    try {
      const answer = (d, port) => d.type === 'run' && port.postMessage({ type: 'result', id: d.id, result: { ok: true, logs: [{ level: 'log', args: [d.message.code] }] } });
      const first = sandbox.run(message({ code: 'a' }));
      const init = fakeLoader(answer, { mode: 'inline' });
      vexpect(init.inline).toBe(false);
      vexpect((await first).logs[0].args).toEqual(['a']);
      vexpect(sandbox.mode).toBe('inline');
      // The first run's iframe is gone; a fresh one, told to skip trying a worker, waits for the next run.
      vexpect(frames()).toHaveLength(1);
      const second = sandbox.run(message({ code: 'b' }));
      vexpect(fakeLoader(answer, { mode: 'inline', iframe: frames()[0] }).inline).toBe(true);
      vexpect((await second).logs[0].args).toEqual(['b']);
      // Runs at the same time do not share an iframe either.
      const held = [];
      const hold = (d, port) => d.type === 'run' && held.push(() => answer(d, port));
      const both = [sandbox.run(message({ code: 'c' })), sandbox.run(message({ code: 'd' }))];
      fakeLoader(hold, { mode: 'inline', iframe: frames()[0] });
      await vexpect.poll(() => frames().length).toBe(2);
      fakeLoader(hold, { mode: 'inline', iframe: frames()[1] });
      await vexpect.poll(() => held.length).toBe(2);
      held.forEach((reply) => reply());
      vexpect((await Promise.all(both)).map((r) => r.logs[0].args[0])).toEqual(['c', 'd']);
      vexpect(frames()).toHaveLength(1);
    } finally {
      sandbox.dispose();
    }
    vexpect(frames()).toHaveLength(0);
  });

  it('keeps one iframe for every run when scripts run in workers', async () => {
    const sandbox = new ScriptSandbox();
    const answer = (d, port) => d.type === 'run' && port.postMessage({ type: 'result', id: d.id, result: { ok: true } });
    const first = sandbox.run(message());
    fakeLoader(answer);
    await first;
    await sandbox.run(message());
    vexpect(document.querySelectorAll('iframe[title="Script sandbox"]')).toHaveLength(1);
    sandbox.dispose();
  });

  it('cancels the requests a script sent when it times out', async () => {
    let sent = null;
    const sandbox = new ScriptSandbox({ timeoutMs: 100, onSend: (request, { signal }) => ((sent = signal), new Promise(() => {})) });
    const pending = sandbox.run(message());
    fakeLoader((d, port) => {
      if (d.type === 'run') port.postMessage({ type: 'send', id: d.id, sendId: 1, request: { url: 'https://slow.test' } });
      else if (d.type === 'ping') port.postMessage({ type: 'pong', nonce: d.nonce });
    });
    const r = await pending;
    vexpect(r.error.message).toMatch(/timed out/);
    vexpect(sent?.aborted).toBe(true);
    sandbox.dispose();
  });
});

describe('send() requests from scripts', async () => {
  const { resolveScriptRequest } = await import('../src/core/execute.js');
  const { buildBody } = await import('../src/core/prepare.js');
  it('sends no body on GET and the raw text on POST', () => {
    vexpect(resolveScriptRequest({ method: 'GET', url: 'https://x', headers: [], body: { mode: 'none', raw: '' } }).body).toBeNull();
    const post = resolveScriptRequest({ method: 'POST', url: 'https://x', headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }], body: { mode: 'raw', raw: '{"a":1}', rawType: 'json' } });
    vexpect(buildBody(post.body)).toBe('{"a":1}');
    vexpect(post.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }]);
  });
  it('supports urlencoded and form bodies', () => {
    const u = resolveScriptRequest({ method: 'POST', url: 'https://x', body: { mode: 'urlencoded', raw: '', urlencoded: [{ key: 'a', value: '1' }, { key: 'b', value: '2', disabled: true }] } });
    vexpect(String(buildBody(u.body))).toBe('a=1');
    const f = resolveScriptRequest({ method: 'POST', url: 'https://x', body: { mode: 'formdata', raw: '', formdata: [{ key: 'a', value: '1' }] } });
    vexpect(buildBody(f.body).get('a')).toBe('1');
  });
  it('sends GraphQL bodies as JSON and refuses file bodies', () => {
    const g = resolveScriptRequest({ method: 'POST', url: 'https://x', headers: [], body: { mode: 'graphql', raw: '', graphql: { query: '{ me { id } }', variables: '{"a":1}' } } });
    vexpect(buildBody(g.body)).toBe('{"query":"{ me { id } }","variables":{"a":1}}');
    vexpect(g.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }]);
    const own = resolveScriptRequest({ method: 'POST', url: 'https://x', headers: [{ key: 'content-type', value: 'application/graphql+json' }], body: { mode: 'graphql', graphql: { query: 'q', variables: { b: 2 } } } });
    vexpect(buildBody(own.body)).toBe('{"query":"q","variables":{"b":2}}');
    vexpect(own.headers).toEqual([{ key: 'content-type', value: 'application/graphql+json' }]);
    vexpect(() => resolveScriptRequest({ method: 'POST', url: 'https://x', body: { mode: 'graphql', graphql: { query: 'q', variables: '{' } } })).toThrow(/not valid JSON/);
    vexpect(() => resolveScriptRequest({ method: 'POST', url: 'https://x', body: { mode: 'file', raw: '' } })).toThrow(/file/);
    vexpect(() => resolveScriptRequest({ method: 'POST', url: 'https://x', body: { mode: 'binary', raw: '' } })).toThrow(/file/);
  });
});

describe('rejects.toThrow', () => {
  it('checks the rejection reason', async () => {
    await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
    await expect(Promise.reject(new TypeError('x'))).rejects.toThrow(TypeError);
    await expect(Promise.reject(new Error('boom'))).rejects.toThrow();
    await vexpect(expect(Promise.reject(new Error('boom'))).rejects.toThrow('other')).rejects.toThrow(/other/);
  });
});

describe('toEqual on binary data', () => {
  it('compares bytes', () => {
    const a = new Uint8Array([1, 2]).buffer;
    vexpect(() => expect(a).toEqual(new Uint8Array([1, 2]).buffer)).not.toThrow();
    vexpect(() => expect(a).toEqual(new Uint8Array([1, 3]).buffer)).toThrow();
    vexpect(() => expect(new DataView(a)).toEqual(new DataView(new Uint8Array([9, 9]).buffer))).toThrow();
  });
});

describe('toHaveProperty paths', () => {
  it('accepts quoted bracket keys with dots', () => {
    vexpect(() => expect({ 'a.b': 1 }).toHaveProperty('["a.b"]', 1)).not.toThrow();
    vexpect(() => expect({ a: { b: [{ c: 2 }] } }).toHaveProperty('a.b[0].c', 2)).not.toThrow();
  });
});
