// Diagnostics worker: runs one kernel (kernels.js) per message.
// in:  { id, op, args, module? }   out: { id, result } | { id, error }

import { setDspModule, dsp } from '../audio/dsp.js';
import { ops } from './kernels.js';

self.onmessage = async (e) => {
  const { id, op, args, module } = e.data;
  try {
    if (module) setDspModule(module);
    const result = ops[op](await dsp(), args);
    self.postMessage({ id, result }, result?.buffer ? [result.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
