/**
 * Collection runner: runs every request in a collection or folder, in tree
 * order (or a given order), for one or more iterations, through execute().
 *
 * Scripts can steer the run with runner.next('Request Name') (jump to that
 * request; null ends the iteration) and runner.stop() (ends the run).
 *
 * runCollection({
 *   ws, targetId, environmentId, sandbox, sendOptions,
 *   iterations = 1, delayMs = 0, data = null, stopOnError = false,
 *   keepVariables = true, local, signal, onEvent, onLog, selection, order,
 *   executeFn = execute,
 * }) -> summary
 *
 * Events passed to onEvent:
 *   { type: 'start', requests: [{ id, name, method }], iterations, total }
 *   { type: 'request-start', iteration, step, position, done, total, request: { id, name, method } }
 *   { type: 'request', iteration, step, done, total, result, raw }   raw is execute()'s full output
 *   { type: 'iteration', index, iteration }                          after each iteration finishes
 *   { type: 'done', summary }
 */
import { execute as realExecute } from './execute.js';
import { requestsIn } from './model.js';
import { canEdit } from '../data/shared.js';

export const MAX_STEPS_FACTOR = 20;

/** Requests that a run of targetId would include, in tree order: [{ item, parents }]. */
export function runnableRequests(ws, targetId) {
  const loc = ws.locate(targetId);
  if (!loc) return [];
  if (loc.item.type === 'request') return [{ item: loc.item, parents: loc.parents }];
  // Each request's parents are the target's chain plus the folders between: no lookup per request.
  const base = [...loc.parents, loc.item];
  return requestsIn(loc.item).map(({ item, parents }) => ({ item, parents: [...base, ...parents] }));
}

/** Applies an optional custom order (array of ids) and selection (Set of ids). */
export function planRun(list, { order = null, selection = null } = {}) {
  let out = list;
  if (Array.isArray(order) && order.length) {
    const rank = new Map(order.map((id, i) => [id, i]));
    out = list
      .map((r, i) => ({ r, k: rank.has(r.item.id) ? rank.get(r.item.id) : order.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.r);
  }
  if (selection) out = out.filter((r) => selection.has(r.item.id));
  return out;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (!ms || ms <= 0 || signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

const varSnapshot = (list) => structuredClone(list || []);

function snapshotVariables(ws, environmentId, collectionId, local) {
  return {
    environment: environmentId ? varSnapshot(ws.getEnvironment(environmentId)?.variables) : null,
    collection: collectionId ? varSnapshot(ws.getCollection(collectionId)?.variables) : null,
    globals: varSnapshot(ws.globals.variables),
    local: local ? new Map(local) : null,
  };
}

/**
 * Puts the rows of `keys` back as they were in `before` (old value and state,
 * removed rows re-added, added rows dropped) and leaves every other row alone.
 */
function revertKeys(list, before, keys) {
  const old = new Map(before.filter((v) => keys.has(v.key)).map((v) => [v.id, v]));
  const out = list.filter((v) => !keys.has(v.key) || old.has(v.id)).map((v) => old.get(v.id) || v);
  before.forEach((v, i) => {
    if (old.has(v.id) && !out.some((x) => x.id === v.id)) out.splice(Math.min(i, out.length), 0, v);
  });
  return out;
}

/** Reverts the variables the run's scripts changed (touched: { environment, collection, globals } Sets of keys). */
async function restoreVariables(ws, snap, touched, environmentId, collectionId, local) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Each scope is restored on its own so one failure cannot leave the others changed.
  const attempt = async (fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(err);
    }
  };
  const needs = (list, scope) => touched[scope].size && !same(list, revertKeys(list, snap[scope], touched[scope]));
  if (snap.environment && environmentId && environmentId !== 'globals') {
    const env = ws.getEnvironment(environmentId);
    if (env && needs(env.variables, 'environment')) {
      await attempt(() =>
        ws.updateEnvironment(environmentId, (e) => {
          e.variables = revertKeys(e.variables, snap.environment, touched.environment);
        }),
      );
    }
  }
  if (snap.collection && collectionId) {
    const c = ws.getCollection(collectionId);
    if (c && needs(c.variables, 'collection')) {
      // View-only shared collections took the run's changes in memory only; undo them the same way.
      if (c.shared && !canEdit(c.shared.mode)) c.variables = revertKeys(c.variables, snap.collection, touched.collection);
      else {
        await attempt(() =>
          ws.updateCollection(collectionId, (x) => {
            x.variables = revertKeys(x.variables, snap.collection, touched.collection);
          }),
        );
      }
    }
  }
  if (needs(ws.globals.variables, 'globals')) {
    await attempt(() =>
      ws.updateGlobals((g) => {
        g.variables = revertKeys(g.variables, snap.globals, touched.globals);
      }),
    );
  }
  if (local && snap.local) {
    local.clear();
    for (const [k, v] of snap.local) local.set(k, v);
  }
}

/** Plain, serializable summary of one execute() result. */
export function summarizeResult(item, raw, { iteration, step }) {
  const r = raw?.response || null;
  const tests = (raw?.tests || []).map((t) => ({
    name: t.name,
    passed: !!t.passed,
    skipped: !!t.skipped,
    error: t.error ?? null,
    source: t.source,
  }));
  return {
    requestId: item.id,
    name: item.name,
    method: raw?.resolved?.method || raw?.request?.method || item.method,
    url: raw?.resolved?.url || raw?.request?.url || item.url,
    status: r ? r.status : null,
    statusText: r ? r.statusText || '' : '',
    timeMs: r ? r.timeMs ?? null : null,
    size: r ? r.size?.body ?? r.body?.length ?? null : null,
    tests,
    error: raw?.error ? { message: raw.error.message, hint: raw.error.hint, code: raw.error.code, phase: raw.error.phase } : null,
    skipped: !!raw?.flow?.skip,
    warnings: raw?.warnings?.length ? [...raw.warnings] : [],
    iteration,
    step,
  };
}

/** 'passed' | 'failed' | 'skipped' for one request result. */
export function resultOutcome(res) {
  if (res.skipped) return 'skipped';
  if (res.error || res.tests.some((t) => !t.passed && !t.skipped)) return 'failed';
  return 'passed';
}

export async function runCollection({
  ws,
  targetId,
  environmentId = null,
  sandbox = null,
  sendOptions = {},
  iterations = 1,
  delayMs = 0,
  data = null,
  stopOnError = false,
  keepVariables = true,
  local = new Map(),
  signal = null,
  onEvent = null,
  onLog = null,
  selection = null,
  order = null,
  executeFn = realExecute,
}) {
  const loc = ws.locate(targetId);
  if (!loc) throw new Error('The collection or folder to run no longer exists.');
  const collectionId = loc.collection.id;
  const list = planRun(runnableRequests(ws, targetId), { order, selection });
  const rows = Array.isArray(data) && data.length ? data : null;
  const count = Math.max(1, Math.floor(Number(iterations) || 1));
  const delay = Math.max(0, Number(delayMs) || 0);
  const maxSteps = MAX_STEPS_FACTOR * list.length;
  const emit = (e) => {
    try {
      onEvent?.(e);
    } catch (err) {
      console.error(err);
    }
  };

  const startedAt = Date.now();
  const t0 = performance.now();
  const summary = {
    targetId,
    collectionId,
    name: loc.item.name,
    startedAt,
    finishedAt: null,
    iterations: [],
    totals: { requests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, timeMs: 0, responseTimeMs: 0 },
    stopped: false,
    aborted: false,
    stopReason: null,
  };
  const total = count * list.length;
  emit({ type: 'start', requests: list.map((r) => ({ id: r.item.id, name: r.item.name, method: r.item.method })), iterations: count, total });

  const snap = keepVariables ? null : snapshotVariables(ws, environmentId, collectionId, local);
  // Keys the run's scripts changed, so restoring leaves other edits made during the run alone.
  const touched = { environment: new Set(), collection: new Set(), globals: new Set() };
  const onVariableChanges = snap
    ? (changes) => {
        for (const scope of Object.keys(touched)) for (const k of Object.keys(changes[scope] || {})) touched[scope].add(k);
      }
    : undefined;
  let done = 0;
  let first = true;
  const stop = (reason) => {
    summary.stopped = true;
    summary.stopReason ||= reason;
  };

  try {
    for (let it = 0; it < count && !summary.stopped; it++) {
      const iteration = { index: it, results: [], warnings: [], data: rows ? rows[it % rows.length] : null };
      summary.iterations.push(iteration);
      let pos = 0;
      let steps = 0;
      while (pos < list.length) {
        if (signal?.aborted) {
          summary.aborted = true;
          stop('aborted');
          break;
        }
        if (steps >= maxSteps) {
          iteration.warnings.push(`Iteration ${it + 1} stopped after ${steps} requests. A script may be jumping between requests in a loop.`);
          break;
        }
        if (!first && delay) {
          await sleep(delay, signal);
          if (signal?.aborted) {
            summary.aborted = true;
            stop('aborted');
            break;
          }
        }
        first = false;
        const { item, parents } = list[pos];
        emit({ type: 'request-start', iteration: it, step: steps, position: pos, done, total: Math.max(total, done + 1), request: { id: item.id, name: item.name, method: item.method } });
        let raw;
        try {
          raw = await executeFn(item, ws.locate(item.id)?.parents || parents, {
            ws,
            environmentId,
            local,
            sandbox,
            sendOptions,
            signal,
            data: iteration.data,
            info: { iteration: it, iterationCount: count },
            onLog,
            onVariableChanges,
          });
        } catch (err) {
          raw = { request: item, response: null, tests: [], logs: [], warnings: [], error: { message: err?.message || String(err) }, flow: null };
        }
        if (signal?.aborted && !raw?.response) {
          summary.aborted = true;
          stop('aborted');
          break;
        }
        const result = summarizeResult(item, raw, { iteration: it, step: steps });
        iteration.results.push(result);
        steps++;
        done++;
        const t = summary.totals;
        t.requests++;
        if (result.error) t.errors++;
        if (result.timeMs != null) t.responseTimeMs += result.timeMs;
        for (const test of result.tests) {
          if (test.skipped) t.skipped++;
          else if (test.passed) t.passed++;
          else t.failed++;
        }
        emit({ type: 'request', iteration: it, step: steps - 1, done, total: Math.max(total, done), result, raw });

        const flow = raw?.flow || null;
        if (flow?.stop) {
          stop('script');
          break;
        }
        if (stopOnError && result.error) {
          stop('error');
          break;
        }
        if (flow && flow.next !== undefined) {
          if (flow.next === null) break;
          const target = list.findIndex((r) => r.item.name === flow.next);
          if (target < 0) {
            iteration.warnings.push(`"${flow.next}" is not part of this run, so iteration ${it + 1} ended after "${item.name}".`);
            break;
          }
          pos = target;
          continue;
        }
        pos++;
      }
      emit({ type: 'iteration', index: it, iteration });
    }
  } finally {
    if (snap) await restoreVariables(ws, snap, touched, environmentId, collectionId, local);
    summary.finishedAt = Date.now();
    summary.totals.timeMs = performance.now() - t0;
  }
  emit({ type: 'done', summary });
  return summary;
}
