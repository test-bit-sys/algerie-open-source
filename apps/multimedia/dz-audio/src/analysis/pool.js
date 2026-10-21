// A small pool of analysis workers (see worker.js). Stateless jobs go to the
// least busy worker; sessions stay on one worker. Sample buffers are
// transferred, so callers pass copies they no longer need.

const AnalysisWorker = class extends Worker {
  constructor() {
    super(new URL('./worker.js', import.meta.url), { type: 'module' });
  }
};
import { dspModule } from '../audio/dsp.js';

let pool = null;

export function analysisPool() {
  if (!pool) pool = new WorkerPool(Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1)));
  return pool;
}

let nextId = 1;
let nextSession = 1;

export class WorkerPool {
  constructor(size) {
    this.size = size;
    this.workers = [];
    this.jobs = new Map();
    this.ready = null;
  }

  #start() {
    if (!this.ready) {
      this.ready = dspModule().then((module) => {
        for (let i = 0; i < this.size; i++) {
          const w = new AnalysisWorker();
          w.busy = 0;
          w.onmessage = (e) => this.#onMessage(w, e.data);
          w.onerror = (e) => {
            for (const [id, job] of this.jobs) {
              if (job.worker === w) {
                this.jobs.delete(id);
                job.reject(new Error(e.message || 'Analysis failed'));
              }
            }
          };
          w.postMessage({ type: 'init', module });
          this.workers.push(w);
        }
      });
      this.ready.catch(() => (this.ready = null));
    }
    return this.ready;
  }

  #onMessage(w, m) {
    const job = this.jobs.get(m.id);
    if (!job) return;
    this.jobs.delete(m.id);
    w.busy--;
    if (m.error) job.reject(new Error(m.error));
    else job.resolve(m.result);
  }

  /** Jobs in flight across the pool. */
  get pending() {
    return this.jobs.size;
  }

  async #send(worker, msg, transfer) {
    await this.#start();
    const w = worker ?? this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = nextId++;
    w.busy++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, worker: w });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  call(msg, transfer = []) {
    return this.#send(null, msg, transfer);
  }

  /** A streaming session pinned to one worker: { push(channels), close() }. */
  async session(kind, params) {
    await this.#start();
    const w = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const sid = nextSession++;
    await this.#send(w, { op: 'open', sid, kind, ...params });
    return {
      push: (channels) => this.#send(w, { op: 'push', sid, channels }, channels.map((c) => c.buffer)),
      close: () => this.#send(w, { op: 'close', sid }),
    };
  }
}
