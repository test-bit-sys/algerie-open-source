/**
 * DZ-Chess: WebAudio sound-effects engine — 100% synthesized, zero files.
 */

class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensure() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = !!muted;
  }

  tone(freq, duration = 0.08, type = 'sine', volume = 0.12, delay = 0) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + delay;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  click() {
    this.tone(660, 0.05, 'triangle', 0.08);
  }

  move() {
    this.tone(440, 0.07, 'triangle', 0.12);
  }

  capture() {
    this.tone(300, 0.09, 'square', 0.1);
    this.tone(220, 0.1, 'square', 0.08, 0.05);
  }

  check() {
    this.tone(880, 0.09, 'sawtooth', 0.09);
    this.tone(660, 0.12, 'sawtooth', 0.07, 0.08);
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, i * 0.09));
  }

  lose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.12, i * 0.12));
  }

  draw() {
    this.tone(440, 0.2, 'sine', 0.1);
    this.tone(440, 0.2, 'sine', 0.08, 0.25);
  }
}

export const sfx = new SoundFX();
