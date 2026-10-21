import { describe, it, expect } from 'vitest';
import { Mp3Writer, infoFrame, parseMp3Header, ENCODER_DELAY } from '../src/export/mp3.js';

describe('MP3 gapless Info frame', () => {
  it('records frame count, encoder delay and padding for exact-length decoding', async () => {
    const w = new Mp3Writer({ sampleRate: 44100, channels: 2, settings: { bitrate: 128 } });
    await w.init();
    const n = 44100 + 77;
    const planar = [new Float32Array(n).fill(0.1), new Float32Array(n).fill(-0.1)];
    w.write(planar, n);
    const bytes = new Uint8Array(await w.finish().arrayBuffer());
    // Skip the ID3 tag, then the first frame is the Info frame.
    let o = 0;
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) o = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    const info = parseMp3Header(bytes, o);
    expect(info).not.toBeNull();
    const t = o + 4 + 32;
    expect(String.fromCharCode(...bytes.subarray(t, t + 4))).toBe('Info');
    const dv = new DataView(bytes.buffer);
    const frames = dv.getUint32(t + 8);
    const delay = (bytes[t + 141] << 4) | (bytes[t + 142] >> 4);
    const padding = ((bytes[t + 142] & 0x0f) << 8) | bytes[t + 143];
    expect(delay).toBe(ENCODER_DELAY);
    expect(frames * 1152 - delay - padding).toBe(n);
  });
  it('returns null for data without MPEG frames', () => {
    expect(infoFrame(new Uint8Array(16), 100)).toBeNull();
  });
});
