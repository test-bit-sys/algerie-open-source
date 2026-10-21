// Small stereo peak meter (canvas) with peak hold, used by track headers and
// Mixer channel strips. Feed it linear peaks; draw() decays and repaints and
// returns true while it still needs frames.

import { h } from '../lib/dom.js';
import { cssVar } from '../ui/theme.js';

/** dB span of the meters (0 dBFS at the top). */
export const METER_RANGE = 60;
const RANGE = METER_RANGE;

/** Colour crossover levels in dBFS (Preferences > Playback and Recording, set by the app). */
export const meterLevels = { caution: -12, warning: -3 };

export class MeterBar {
  constructor({ vertical = true, label = 'Level' } = {}) {
    this.vertical = vertical;
    this.canvas = h('canvas', { 'aria-hidden': 'true' });
    this.el = h('div.mt-meter', { role: 'meter', 'aria-label': label, 'aria-valuemin': String(-RANGE), 'aria-valuemax': '0', 'aria-valuenow': String(-RANGE) }, this.canvas);
    this.level = [0, 0];
    this.hold = [0, 0];
    this.holdAt = [0, 0];
    this.last = 0;
    this.clipped = false;
  }

  set label(v) {
    this.el.setAttribute('aria-label', v);
  }

  feed(peaks) {
    const now = performance.now();
    for (let c = 0; c < 2; c++) {
      const p = peaks?.[c] ?? peaks?.[0] ?? 0;
      if (p > this.level[c]) this.level[c] = p;
      if (p >= this.hold[c] || now - this.holdAt[c] > 1500) {
        this.hold[c] = p;
        this.holdAt[c] = now;
      }
      if (p >= 1) this.clipped = true;
    }
  }

  reset() {
    this.level = [0, 0];
    this.hold = [0, 0];
    this.clipped = false;
  }

  /** Repaints; returns true while the meter is still moving. */
  draw(now = performance.now()) {
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    if (!W || !H) return false;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const len = this.vertical ? H : W;
    const thick = ((this.vertical ? W : H) - 1) / 2;
    const pos = (v) => (v <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(v) + RANGE) / RANGE))) * len;
    const at = (db) => (Math.max(0, Math.min(RANGE, RANGE + db)) / RANGE) * len;
    const yellowAt = at(meterLevels.caution);
    const redAt = Math.max(yellowAt, at(meterLevels.warning));
    const colors = [cssVar('--meter-green'), cssVar('--meter-yellow'), cssVar('--meter-red')];
    for (let c = 0; c < 2; c++) {
      const off = c * (thick + 1);
      const rect = (from, to) => {
        if (to <= from) return;
        if (this.vertical) ctx.fillRect(off, H - to, thick, to - from);
        else ctx.fillRect(from, off, to - from, thick);
      };
      ctx.fillStyle = cssVar('--meter-bg');
      rect(0, len);
      const p = pos(this.level[c]);
      ctx.fillStyle = colors[0];
      rect(0, Math.min(p, yellowAt));
      ctx.fillStyle = colors[1];
      rect(yellowAt, Math.min(p, redAt));
      ctx.fillStyle = colors[2];
      rect(redAt, p);
      const hp = pos(this.hold[c]);
      if (hp > 1) {
        ctx.fillStyle = hp >= redAt ? colors[2] : hp >= yellowAt ? colors[1] : colors[0];
        rect(hp - 2, hp);
      }
    }
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    const decay = Math.pow(10, (-24 * dt) / 1000 / 20);
    let active = false;
    for (let c = 0; c < 2; c++) {
      this.level[c] *= decay;
      if (this.level[c] < 1e-4) this.level[c] = 0;
      else active = true;
      if (now - this.holdAt[c] > 2000) this.hold[c] *= decay;
      if (this.hold[c] < 1e-4) this.hold[c] = 0;
      else active = true;
    }
    const peak = Math.max(this.hold[0], this.hold[1]);
    this.el.setAttribute('aria-valuenow', String(peak > 0 ? Math.max(-RANGE, Math.round(20 * Math.log10(peak))) : -RANGE));
    if (!active) this.last = 0;
    return active;
  }
}
