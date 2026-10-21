// Video thumbnails for the video lane: an offscreen <video> seeks to each
// requested time and the frame is drawn into a small canvas. Requests come
// from the lane for the tiles it can see, newest first; thumbnails are cached
// per source (least recently used ones are dropped).

import { videoURL } from './media.js';

const MAX_CACHED = 240;
const SEEK_TIMEOUT = 4000;

export class Thumbnailer {
  /**
   * @param {object} src video pool entry
   * @param {() => void} onReady called when a requested thumbnail is ready
   */
  constructor(src, onReady) {
    this.src = src;
    this.onReady = onReady;
    this.height = 0;
    this.cache = new Map(); // time -> canvas
    this.queue = [];
    this.busy = false;
    this.failed = false;
    this.video = null;
  }

  /** Thumbnail pixel height; changing it drops the cache. */
  setHeight(h) {
    h = Math.max(8, Math.round(h));
    if (h === this.height) return;
    this.height = h;
    this.cache.clear();
  }

  get(time) {
    const c = this.cache.get(time);
    if (c) {
      // Recently used: move to the back of the eviction order.
      this.cache.delete(time);
      this.cache.set(time, c);
    }
    return c || null;
  }

  /** The cached thumbnail closest in time (a stand-in while the exact one is made). */
  nearest(time, within = Infinity) {
    let best = null;
    let bd = within;
    for (const [t, c] of this.cache) {
      const d = Math.abs(t - time);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Asks for thumbnails at `times` (replacing earlier requests that are not done). */
  request(times) {
    if (this.failed || !this.src.blob) return;
    this.queue = times.filter((t) => !this.cache.has(t));
    if (!this.busy && this.queue.length) this.#run();
  }

  async #ensureVideo() {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = videoURL(this.src);
    await new Promise((resolve, reject) => {
      if (v.readyState >= 2) return resolve();
      v.addEventListener('loadeddata', resolve, { once: true });
      v.addEventListener('error', () => reject(new Error('video')), { once: true });
    });
    this.video = v;
    return v;
  }

  async #run() {
    this.busy = true;
    try {
      const v = await this.#ensureVideo();
      while (this.queue.length) {
        const t = this.queue.shift();
        if (this.cache.has(t)) continue;
        await seek(v, t);
        if (!v.videoWidth) continue;
        const h = this.height || 48;
        const w = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')?.drawImage(v, 0, 0, w, h);
        this.cache.set(t, c);
        while (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value);
        this.onReady();
      }
    } catch {
      // Not playable here: the lane keeps its plain strip.
      this.failed = true;
      this.onReady();
    } finally {
      this.busy = false;
    }
  }

  dispose() {
    this.queue = [];
    this.cache.clear();
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }
}

function seek(v, t) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      v.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}
