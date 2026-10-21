import { describe, it, expect, beforeEach } from 'vitest';
import { Workspace } from '../src/data/workspace.js';
import { collection, folder, request, variable } from '../src/core/model.js';
import { runCollection, planRun, runnableRequests, resultOutcome, MAX_STEPS_FACTOR } from '../src/core/runner.js';
import { runScript } from '../src/core/scripts/runtime.js';
import { MemoryDb } from './helpers/memory-db.js';

/**
 * A fake execute(): `script(name, ctx)` returns overrides for the result
 * ({ status, tests, error, flow }) for each request name. Every call is
 * recorded in `calls`.
 */
function fakeExecute(script = () => ({}), calls = []) {
  return async (req, parents, ctx) => {
    calls.push({ name: req.name, parents: parents.map((p) => p.name), data: ctx.data, info: ctx.info });
    const o = (await script(req.name, ctx, calls.length - 1)) || {};
    if (o.error) return { request: req, resolved: null, response: null, tests: [], logs: [], warnings: [], error: o.error, flow: o.flow || null };
    return {
      request: req,
      resolved: { method: req.method, url: `https://api.test/${req.name}` },
      response: { status: o.status ?? 200, statusText: 'OK', headers: [], body: new Uint8Array(3), size: { body: 3 }, timeMs: o.timeMs ?? 10 },
      tests: o.tests || [],
      logs: [],
      warnings: [],
      error: null,
      flow: o.flow || null,
    };
  };
}

let ws;
let col;
let env;
const names = (calls) => calls.map((c) => c.name);

beforeEach(async () => {
  ws = new Workspace(new MemoryDb());
  await ws.load();
  col = await ws.addCollection(
    collection({
      name: 'Shop',
      variables: [variable('token', 'abc')],
      items: [
        request({ name: 'A', method: 'GET' }),
        folder({ name: 'Orders', items: [request({ name: 'B', method: 'POST' }), request({ name: 'C' })] }),
        request({ name: 'D', method: 'DELETE' }),
      ],
    }),
  );
  env = await ws.addEnvironment({ name: 'Dev', variables: [variable('host', 'dev.test')] });
});

const run = (opts) => runCollection({ ws, targetId: col.id, environmentId: env.id, ...opts });

/** Applies script variable changes the way execute() does, reporting them to the runner. */
async function applyChanges(ctx, changes) {
  await ctx.ws.applyVariableChanges({ environmentId: ctx.environmentId, collectionId: col.id, changes });
  ctx.onVariableChanges?.(changes);
}

describe('runCollection', () => {
  it('runs every request in tree order with parents from the workspace', async () => {
    const calls = [];
    const s = await run({ executeFn: fakeExecute(() => ({ tests: [{ name: 'ok', passed: true }] }), calls) });
    expect(names(calls)).toEqual(['A', 'B', 'C', 'D']);
    expect(calls[1].parents).toEqual(['Shop', 'Orders']);
    expect(calls[0].info).toEqual({ iteration: 0, iterationCount: 1 });
    expect(s.iterations).toHaveLength(1);
    const r = s.iterations[0].results[1];
    expect(r).toMatchObject({ name: 'B', method: 'POST', url: 'https://api.test/B', status: 200, size: 3, timeMs: 10, error: null, skipped: false });
    expect(s.totals).toMatchObject({ requests: 4, passed: 4, failed: 0, errors: 0 });
    expect(s.stopped).toBe(false);
  });

  it('runs a folder only', async () => {
    const orders = col.items[1];
    const calls = [];
    await runCollection({ ws, targetId: orders.id, executeFn: fakeExecute(undefined, calls) });
    expect(names(calls)).toEqual(['B', 'C']);
  });

  it('counts failed tests and errors', async () => {
    const s = await run({
      executeFn: fakeExecute((n) =>
        n === 'B' ? { tests: [{ name: 't1', passed: false, error: 'expected 1 to be 2' }, { name: 't2', passed: true }, { name: 't3', skipped: true }] } : n === 'C' ? { error: { message: 'Network down' } } : {},
      ),
    });
    expect(s.totals).toMatchObject({ requests: 4, passed: 1, failed: 1, skipped: 1, errors: 1 });
    const [, b, c, d] = s.iterations[0].results;
    expect(resultOutcome(b)).toBe('failed');
    expect(resultOutcome(c)).toBe('failed');
    expect(c.error.message).toBe('Network down');
    expect(c.status).toBeNull();
    expect(resultOutcome(d)).toBe('passed');
  });

  it('honours selection and custom order', async () => {
    const [a, , d] = col.items;
    const [b, c] = col.items[1].items;
    const calls = [];
    await run({ selection: new Set([a.id, c.id, d.id]), order: [d.id, c.id, a.id, b.id], executeFn: fakeExecute(undefined, calls) });
    expect(names(calls)).toEqual(['D', 'C', 'A']);
    expect(planRun(runnableRequests(ws, col.id), { order: [c.id] }).map((r) => r.item.name)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('lists runnable requests with their parents without looking each one up', async () => {
    const inner = await ws.addItem(col.id, col.items[1].id, folder({ name: 'Deep', items: [request({ name: 'E' })] }));
    const lookups = [];
    const counting = { locate: (id) => (lookups.push(id), ws.locate(id)) };
    for (const target of [col.id, col.items[1].id, inner.id]) {
      lookups.length = 0;
      const list = runnableRequests(counting, target);
      expect(lookups).toEqual([target]);
      expect(list.length).toBeGreaterThan(0);
      for (const { item, parents } of list) expect(parents.map((p) => p.id)).toEqual(ws.locate(item.id).parents.map((p) => p.id));
    }
    expect(runnableRequests(ws, col.id).map((r) => r.item.name)).toEqual(['A', 'B', 'C', 'E', 'D']);
  });

  it('jumps to a named request with flow.next', async () => {
    const calls = [];
    let jumped = false;
    await run({
      executeFn: fakeExecute((n) => {
        if (n === 'A') return { flow: { next: 'C' } };
        if (n === 'D' && !jumped) {
          jumped = true;
          return { flow: { next: 'B' } };
        }
        return {};
      }, calls),
    });
    expect(names(calls)).toEqual(['A', 'C', 'D', 'B', 'C', 'D']);
  });

  it('ends the iteration on flow.next = null and continues with the next iteration', async () => {
    const calls = [];
    const s = await run({ iterations: 2, executeFn: fakeExecute((n) => (n === 'B' ? { flow: { next: null } } : {}), calls) });
    expect(names(calls)).toEqual(['A', 'B', 'A', 'B']);
    expect(s.iterations.map((i) => i.results.length)).toEqual([2, 2]);
    expect(s.stopped).toBe(false);
  });

  it('ends the iteration with a warning when flow.next names an unknown request', async () => {
    const s = await run({ executeFn: fakeExecute((n) => (n === 'A' ? { flow: { next: 'Nope' } } : {})) });
    expect(s.iterations[0].results).toHaveLength(1);
    expect(s.iterations[0].warnings[0]).toMatch(/"Nope" is not part of this run/);
  });

  it('stops the whole run on flow.stop', async () => {
    const calls = [];
    const s = await run({ iterations: 3, executeFn: fakeExecute((n) => (n === 'B' ? { flow: { stop: true } } : {}), calls) });
    expect(names(calls)).toEqual(['A', 'B']);
    expect(s.stopped).toBe(true);
    expect(s.stopReason).toBe('script');
    expect(s.iterations).toHaveLength(1);
  });

  it('guards against infinite jumps', async () => {
    const calls = [];
    const s = await run({ iterations: 2, executeFn: fakeExecute((n) => (n === 'A' ? { flow: { next: 'A' } } : {}), calls) });
    const max = MAX_STEPS_FACTOR * 4;
    expect(calls).toHaveLength(max * 2);
    expect(s.iterations[0].results).toHaveLength(max);
    expect(s.iterations[0].warnings[0]).toMatch(/loop/);
  });

  it('stops on the first error only when asked', async () => {
    const failing = (n) => (n === 'B' ? { error: { message: 'boom' } } : {});
    const calls1 = [];
    await run({ executeFn: fakeExecute(failing, calls1) });
    expect(names(calls1)).toEqual(['A', 'B', 'C', 'D']);
    const calls2 = [];
    const s = await run({ stopOnError: true, iterations: 2, executeFn: fakeExecute(failing, calls2) });
    expect(names(calls2)).toEqual(['A', 'B']);
    expect(s.stopped).toBe(true);
    expect(s.stopReason).toBe('error');
  });

  it('treats a thrown execute() as an error result', async () => {
    const s = await run({ executeFn: async () => { throw new Error('kaboom'); } });
    expect(s.totals.errors).toBe(4);
    expect(s.iterations[0].results[0].error.message).toBe('kaboom');
  });

  it('feeds data rows to iterations, wrapping around', async () => {
    const calls = [];
    const data = [{ user: 'ada' }, { user: 'grace' }];
    const s = await run({ iterations: 3, data, selection: new Set([col.items[0].id]), executeFn: fakeExecute(undefined, calls) });
    expect(calls.map((c) => c.data.user)).toEqual(['ada', 'grace', 'ada']);
    expect(calls.map((c) => c.info)).toEqual([0, 1, 2].map((iteration) => ({ iteration, iterationCount: 3 })));
    expect(s.iterations[2].data).toEqual({ user: 'ada' });
  });

  it('can be aborted between requests', async () => {
    const ctrl = new AbortController();
    const calls = [];
    const s = await run({
      iterations: 5,
      signal: ctrl.signal,
      executeFn: fakeExecute((n) => {
        if (n === 'B') ctrl.abort();
      }, calls),
    });
    expect(names(calls)).toEqual(['A', 'B']);
    expect(s.aborted).toBe(true);
    expect(s.stopped).toBe(true);
  });

  it('aborts during the delay between requests', async () => {
    const ctrl = new AbortController();
    const calls = [];
    const started = Date.now();
    const p = run({ delayMs: 5000, signal: ctrl.signal, executeFn: fakeExecute(undefined, calls) });
    setTimeout(() => ctrl.abort(), 20);
    const s = await p;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(names(calls)).toEqual(['A']);
    expect(s.aborted).toBe(true);
  });

  it('waits delayMs between requests', async () => {
    const started = Date.now();
    await run({ delayMs: 30, selection: new Set([col.items[0].id, col.items[2].id]), executeFn: fakeExecute() });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('emits start, request-start, request, iteration and done events', async () => {
    const events = [];
    await run({ iterations: 2, selection: new Set([col.items[0].id]), onEvent: (e) => events.push(e.type), executeFn: fakeExecute() });
    expect(events).toEqual(['start', 'request-start', 'request', 'iteration', 'request-start', 'request', 'iteration', 'done']);
  });

  it('restores variables after the run when keepVariables is false', async () => {
    const local = new Map([['keep', '1']]);
    const mutate = async (n, ctx) => {
      await applyChanges(ctx, { environment: { host: 'changed', added: 'x' }, collection: { token: null }, globals: { g: '1' } });
      ctx.local.set('temp', n);
    };
    await run({ keepVariables: false, local, executeFn: fakeExecute(mutate) });
    expect(ws.getEnvironment(env.id).variables.map((v) => [v.key, v.value])).toEqual([['host', 'dev.test']]);
    expect(ws.getCollection(col.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc']]);
    expect(ws.globals.variables).toEqual([]);
    expect([...local]).toEqual([['keep', '1']]);

    await run({ keepVariables: true, local, executeFn: fakeExecute(mutate) });
    expect(ws.getEnvironment(env.id).variables.find((v) => v.key === 'host').value).toBe('changed');
    expect(ws.getCollection(col.id).variables).toEqual([]);
    expect(local.get('temp')).toBe('D');
  });

  it('restores variables of a view-only shared collection in memory and still finishes the run', async () => {
    ws.getCollection(col.id).shared = { owner: 'ada', mode: 'read' };
    const mutate = async (n, ctx) => {
      await applyChanges(ctx, { environment: { host: 'changed' }, collection: { token: 'new' }, globals: { g: '1' } });
    };
    const events = [];
    await run({ keepVariables: false, onEvent: (e) => events.push(e.type), executeFn: fakeExecute(mutate) });
    expect(events.at(-1)).toBe('done');
    expect(ws.getEnvironment(env.id).variables.map((v) => [v.key, v.value])).toEqual([['host', 'dev.test']]);
    expect(ws.getCollection(col.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc']]);
    expect(ws.globals.variables).toEqual([]);
  });

  it('reverts only the variables scripts changed, keeping edits made during the run', async () => {
    await ws.updateEnvironment(env.id, (e) => e.variables.push(variable('gone', 'g1'), variable('other', 'o')));
    ws.getCollection(col.id).items[0].scripts.pre = "env.set('host', 'changed'); env.set('added', 'x'); env.unset('gone'); collectionVars.set('token', 'new'); globals.set('g', '1');";
    const sandbox = {
      async run(msg) {
        const result = await runScript(msg);
        // Someone edits other variables while the run is going.
        await ws.updateEnvironment(env.id, (e) => {
          e.variables.find((v) => v.key === 'other').value = 'edited';
          e.variables.push(variable('mine', 'm'));
        });
        await ws.updateCollection(col.id, (c) => c.variables.push(variable('colMine', 'c')));
        await ws.updateGlobals((g) => g.variables.push(variable('globalMine', 'G')));
        return result;
      },
    };
    await run({ keepVariables: false, sandbox, selection: new Set([col.items[0].id]) });
    expect(ws.getEnvironment(env.id).variables.map((v) => [v.key, v.value])).toEqual([['host', 'dev.test'], ['gone', 'g1'], ['other', 'edited'], ['mine', 'm']]);
    expect(ws.getCollection(col.id).variables.map((v) => [v.key, v.value])).toEqual([['token', 'abc'], ['colMine', 'c']]);
    expect(ws.globals.variables.map((v) => [v.key, v.value])).toEqual([['globalMine', 'G']]);
  });

  it('throws when the target is gone', async () => {
    await expect(runCollection({ ws, targetId: 'missing' })).rejects.toThrow(/no longer exists/);
  });
});
