// Export worker: runs the export pipeline off the main thread. Source audio
// is pulled from the main thread one block at a time (with one block of
// read-ahead), so memory stays bounded however long the file is.
//
// in:  { type: 'start', job, module }   job = runExport options minus read/dsp
//      { type: 'chunk', at, channels }   reply to 'need'
//      { type: 'cancel' }
// out: { type: 'need', at, n } | { type: 'progress', fraction } | { type: 'done', blob } | { type: 'error', message }

import { runExport } from './pipeline.js';
import { Dsp } from '../audio/dsp.js';

const waiting = new Map(); // at -> { promise, resolve }
let cancelled = false;

function request(at, n) {
  let entry = waiting.get(at);
  if (!entry) {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    entry = { promise, resolve };
    waiting.set(at, entry);
    self.postMessage({ type: 'need', at, n });
  }
  return entry.promise;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'chunk') {
    waiting.get(m.at)?.resolve(m.channels);
  } else if (m.type === 'cancel') {
    cancelled = true;
  } else if (m.type === 'start') {
    const { job } = m;
    try {
      const dsp = m.module ? new Dsp(await WebAssembly.instantiate(m.module, {})) : null;
      let last = 0;
      const blob = await runExport({
        ...job,
        dsp,
        cancelled: () => cancelled,
        read: async (at, n) => {
          const data = await request(at, n);
          waiting.delete(at);
          // Read ahead: ask for the next block while this one is encoded.
          if (at + n < job.frames) request(at + n, Math.min(n, job.frames - at - n));
          return data;
        },
        onProgress: (fraction) => {
          const now = Date.now();
          if (fraction >= 1 || now - last > 100) {
            last = now;
            self.postMessage({ type: 'progress', fraction });
          }
        },
      });
      self.postMessage({ type: 'done', blob });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  }
};
