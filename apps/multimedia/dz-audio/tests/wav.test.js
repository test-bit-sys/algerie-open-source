import { describe, it, expect } from 'vitest';
import { encodeWav, parseWav } from '../src/audio/wav.js';
import { Channel } from '../src/audio/channel.js';
import { sniffSampleRate } from '../src/audio/decode.js';

const tone = (n) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 7) * 0.5);

describe('wav', () => {
  for (const bitDepth of [16, 24, 32]) {
    it(`round-trips ${bitDepth}-bit audio with markers`, async () => {
      const ch = [Channel.fromSamples(tone(1000)), Channel.fromSamples(tone(1000).map((v) => -v))];
      const blob = encodeWav({ sampleRate: 44100, channels: ch, bitDepth, dither: false, markers: [{ start: 100, duration: 0, name: 'Intro' }, { start: 300, duration: 50, name: 'Verse' }] });
      const r = parseWav(await blob.arrayBuffer());
      expect(r.sampleRate).toBe(44100);
      expect(r.channels.length).toBe(2);
      expect(r.channels[0].length).toBe(1000);
      const tol = bitDepth === 16 ? 1e-4 : 1e-6;
      expect(Math.abs(r.channels[1][123] - -tone(1000)[123])).toBeLessThan(tol);
      expect(r.markers.map((m) => [m.start, m.duration, m.name])).toEqual([
        [100, 0, 'Intro'],
        [300, 50, 'Verse'],
      ]);
    });
  }
  it('rejects non-WAV data', () => {
    expect(() => parseWav(new ArrayBuffer(64))).toThrow();
  });
  it('sniffs FLAC and MP3 sample rates', () => {
    const flac = new Uint8Array(42);
    flac.set([0x66, 0x4c, 0x61, 0x43]);
    // 44100 = 0xAC44 -> 20 bits at bytes 18..20
    flac[18] = 0x0a;
    flac[19] = 0xc4;
    flac[20] = 0x40;
    expect(sniffSampleRate(flac.buffer)).toBe(44100);
    const mp3 = new Uint8Array(16);
    mp3.set([0xff, 0xfb, 0x94, 0x00]); // MPEG1 layer III, 48 kHz index 1
    expect(sniffSampleRate(mp3.buffer)).toBe(48000);
  });
});
