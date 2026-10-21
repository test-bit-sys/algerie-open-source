/**
 * Formats response text in a worker when it is large, inline when small.
 * format({ bytes | text, language, charset }) -> Promise<{ text, pretty }>
 */
import { prettyOrSame, decodeText } from './pretty.js';

const INLINE_LIMIT = 200 * 1024;
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/format.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('Formatter failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function format({ bytes, text, language, charset = '' }) {
  const size = bytes ? bytes.length : text.length;
  if (size <= INLINE_LIMIT || typeof Worker === 'undefined') {
    const source = text ?? decodeText(bytes, charset);
    return Promise.resolve({ text: source, pretty: prettyOrSame(source, language) });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, bytes, text, language, charset });
  });
}
