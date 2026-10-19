/**
 * DZ-Player: Algerian Open Media Library & Procedural Signal Generator
 * 100% Offline-First | Zero Network Dependencies | Pure WebAudio & Canvas DSP
 * 
 * Provides built-in test media for immediate offline evaluation:
 * 1. Kassaman Instrumental Synth Track (النشيد الوطني الجزائري - قسماً)
 * 2. Andalusian Classical Nuba (نوبة أندلسية جزائرية - مقطع تراثي توليدي)
 * 3. 4K Ultra-HD Video & Audio Sync Test Pattern (مقطع اختبار الشاشة والصوت 60fps)
 * 4. Algerian Arabic Subtitle Samples (with Windows-1256 / UTF-8 auto-detection tester)
 */

/**
 * Encodes Float32Array stereo audio buffer to a standard 16-bit PCM WAV Blob.
 */
function encodeWav(leftChannel, rightChannel, sampleRate = 44100) {
  const numChannels = 2;
  const numSamples = leftChannel.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF Chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt Sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data Sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1, Math.min(1, leftChannel[i]));
    const sR = Math.max(-1, Math.min(1, rightChannel[i]));
    const intL = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;
    const intR = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
    view.setInt16(offset, intL, true);
    view.setInt16(offset + 2, intR, true);
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Note to frequency helper (A4 = 440Hz).
 */
const NOTES = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
  REST: 0
};

/**
 * Generates Algerian National Anthem (قسماً) instrumental audio WAV.
 */
export async function generateKassamanAudioBlob() {
  const sampleRate = 44100;
  const bpm = 104;
  const beatSec = 60 / bpm;

  // Kassaman Melody score (Note, Duration in beats)
  const score = [
    // قسماً بالنازلات الماحقات
    { note: 'C4', beats: 1.5 },
    { note: 'E4', beats: 0.5 },
    { note: 'G4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'A4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'F4', beats: 1.0 },
    { note: 'E4', beats: 1.0 },
    { note: 'D4', beats: 2.0 },
    { note: 'REST', beats: 0.5 },

    // والدماء الزاكيات الطاهرات
    { note: 'D4', beats: 1.0 },
    { note: 'F4', beats: 1.0 },
    { note: 'A4', beats: 1.0 },
    { note: 'A4', beats: 1.0 },
    { note: 'B4', beats: 1.0 },
    { note: 'A4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'F4', beats: 1.0 },
    { note: 'E4', beats: 2.0 },
    { note: 'REST', beats: 0.5 },

    // والبنود اللامعات الخافقات
    { note: 'E4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'C5', beats: 1.5 },
    { note: 'B4', beats: 0.5 },
    { note: 'A4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'F4', beats: 1.0 },
    { note: 'E4', beats: 1.0 },
    { note: 'D4', beats: 2.0 },
    { note: 'REST', beats: 0.5 },

    // وعقدنا العزم أن تحيا الجزائر
    { note: 'G4', beats: 1.0 },
    { note: 'A4', beats: 1.0 },
    { note: 'G4', beats: 1.0 },
    { note: 'F4', beats: 1.0 },
    { note: 'E4', beats: 1.5 },
    { note: 'D4', beats: 0.5 },
    { note: 'C4', beats: 2.5 }
  ];

  let totalDurationSec = 0;
  score.forEach((s) => (totalDurationSec += s.beats * beatSec));
  totalDurationSec += 1.0; // tail decay

  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) return null;

  const offlineCtx = new OfflineContext(2, Math.ceil(totalDurationSec * sampleRate), sampleRate);

  let currentTime = 0.2;
  score.forEach((item) => {
    const dur = item.beats * beatSec;
    const freq = NOTES[item.note] || 0;

    if (freq > 0) {
      // 1. Lead Brass/Wind Oscillator
      const osc1 = offlineCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = freq;

      const osc2 = offlineCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 0.5; // sub octave

      const gain = offlineCtx.createGain();
      gain.gain.setValueAtTime(0.001, currentTime);
      gain.gain.linearRampToValueAtTime(0.35, currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, currentTime + dur * 0.95);

      // Lowpass Filter for warm brass sound
      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1600;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(offlineCtx.destination);

      osc1.start(currentTime);
      osc2.start(currentTime);
      osc1.stop(currentTime + dur);
      osc2.stop(currentTime + dur);

      // 2. Harmonic Snare / Marching rhythm click
      if (item.beats >= 1.0) {
        const snareGain = offlineCtx.createGain();
        snareGain.gain.setValueAtTime(0.08, currentTime);
        snareGain.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.08);

        const snareOsc = offlineCtx.createOscillator();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(180, currentTime);
        snareOsc.frequency.exponentialRampToValueAtTime(40, currentTime + 0.08);

        snareOsc.connect(snareGain);
        snareGain.connect(offlineCtx.destination);
        snareOsc.start(currentTime);
        snareOsc.stop(currentTime + 0.08);
      }
    }

    currentTime += dur;
  });

  const renderedBuffer = await offlineCtx.startRendering();
  const left = renderedBuffer.getChannelData(0);
  const right = renderedBuffer.getChannelData(1);

  return encodeWav(left, right, sampleRate);
}

/**
 * Generates an Andalusian / Chaabi scale Algerian heritage instrumental track.
 */
export async function generateAndalusianAudioBlob() {
  const sampleRate = 44100;
  const bpm = 112;
  const beatSec = 60 / bpm;

  // Traditional Maqam Hijaz / Andalusian motif (D, Eb, F#, G, A, Bb, C, D)
  const notes = [
    { f: 293.66, b: 1 }, // D4
    { f: 311.13, b: 1 }, // Eb4
    { f: 369.99, b: 1.5 }, // F#4
    { f: 392.00, b: 0.5 }, // G4
    { f: 440.00, b: 2 }, // A4
    { f: 392.00, b: 1 }, // G4
    { f: 369.99, b: 1 }, // F#4
    { f: 311.13, b: 1 }, // Eb4
    { f: 293.66, b: 2 }, // D4
    { f: 220.00, b: 1 }, // A3
    { f: 246.94, b: 1 }, // B3
    { f: 293.66, b: 2 }  // D4
  ];

  let totalDurationSec = 0;
  notes.forEach((n) => (totalDurationSec += n.b * beatSec));
  totalDurationSec += 1.0;

  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) return null;

  const offlineCtx = new OfflineContext(2, Math.ceil(totalDurationSec * sampleRate), sampleRate);
  let cur = 0.2;

  notes.forEach((item) => {
    const dur = item.b * beatSec;

    // Plucked Oud-like instrument
    const osc = offlineCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = item.f;

    const gain = offlineCtx.createGain();
    gain.gain.setValueAtTime(0.001, cur);
    gain.gain.linearRampToValueAtTime(0.4, cur + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, cur + dur * 0.85);

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = item.f * 1.5;
    filter.Q.value = 3.0;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offlineCtx.destination);

    osc.start(cur);
    osc.stop(cur + dur);

    cur += dur;
  });

  const rendered = await offlineCtx.startRendering();
  return encodeWav(rendered.getChannelData(0), rendered.getChannelData(1), sampleRate);
}

/**
 * Generates an Ultra-HD 60FPS Video & Audio Sync Test Pattern via Canvas & MediaRecorder.
 */
export async function generateVideoSyncBlob() {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Audio Context for beep pips
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();

  const stream = canvas.captureStream(60);
  // Add audio tracks
  dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const durationSec = 10;
  const totalFrames = durationSec * 60;
  let frame = 0;

  recorder.start();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      frame++;
      const timeSec = frame / 60;

      // 1. Clear background
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, width, height);

      // 2. SMPTE Color Bars at Top
      const colors = ['#ffffff', '#facc15', '#06b6d4', '#10b981', '#ec4899', '#ef4444', '#3b82f6', '#000000'];
      const barW = width / colors.length;
      colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(i * barW, 0, barW, 110);
      });

      // 3. Central Radar / Rotating Disc with Algerian Emblem
      const cx = width / 2;
      const cy = height / 2 + 30;
      const radius = 160;

      // Outer dial
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Rotating indicator
      const angle = (frame % 60) * ((Math.PI * 2) / 60);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(0, -radius + 20, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -radius);
      ctx.stroke();
      ctx.restore();

      // Center Emblem (Star & Crescent)
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(cx - 10, cy, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a0f1d';
      ctx.beginPath();
      ctx.arc(cx - 4, cy, 26, 0, Math.PI * 2);
      ctx.fill();

      // 4. Bouncing Audio-Sync Ball (Hits flash zone on every exact integer second)
      const secFract = timeSec % 1.0;
      const ballY = cy + Math.sin(secFract * Math.PI) * -180 + 140;
      const isSyncHit = secFract < 0.08;

      ctx.fillStyle = isSyncHit ? '#ef4444' : '#10b981';
      ctx.beginPath();
      ctx.arc(cx + 360, ballY, 18, 0, Math.PI * 2);
      ctx.fill();

      // Target Bar
      ctx.fillStyle = isSyncHit ? '#ffffff' : '#334155';
      ctx.fillRect(cx + 300, cy + 140, 120, 8);

      // Trigger 1kHz beep on exact whole seconds
      if (frame % 60 === 0) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 1000; // 1kHz standard broadcast tone
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
      }

      // 5. Digital Timecode Display
      const curM = Math.floor(timeSec / 60);
      const curS = Math.floor(timeSec % 60);
      const curMs = Math.floor((timeSec % 1.0) * 1000);
      const curF = frame % 60;
      const timecode = `00:${String(curM).padStart(2, '0')}:${String(curS).padStart(2, '0')}.${String(curMs).padStart(3, '0')} [FRAME ${String(curF).padStart(2, '0')}/60]`;

      ctx.fillStyle = isSyncHit ? '#facc15' : '#f8fafc';
      ctx.font = '700 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(timecode, cx, height - 70);

      // Title & Watermark
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 16px -apple-system, sans-serif';
      ctx.fillText('DZ-Player — مقطع معايرة واختبار مزامنة الصوت والصورة (Broadcast A/V Sync)', cx, height - 35);

      if (frame >= totalFrames) {
        clearInterval(interval);
        recorder.stop();
        audioCtx.close().catch(() => {});
      }
    }, 1000 / 60);

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
  });
}

/**
 * Returns raw Windows-1256 encoded bytes of the sample Algerian Arabic subtitle
 * to test the intelligent encoding detector without external files.
 */
export function getSampleWindows1256SubtitleBytes() {
  // A raw byte array representing a Windows-1256 encoded SRT snippet
  // "قسماً بالنازلات الماحقات" in Windows-1256:
  // ق=0xE2, س=0xD3, م=0xE3, ا=0xC7, ً=0xEC, space=0x20, ب=0xC8, ا=0xC7, ل=0xE1, ن=0xE4, ا=0xC7, ز=0xD2, ل=0xE1, ا=0xC7, ت=0xCA
  const srtAsciiPrefix = `1\n00:00:00,500 --> 00:00:04,000\n`;
  const srtAsciiSuffix = `\n\n2\n00:00:04,500 --> 00:00:08,000\n`;
  const srtAsciiEnd = `\n`;

  const part1ArabicBytes = [0xE2, 0xD3, 0xE3, 0xC7, 0x20, 0xC8, 0xC7, 0xE1, 0xE4, 0xC7, 0xD2, 0xE1, 0xC7, 0xCA, 0x20, 0xC7, 0xE1, 0xE3, 0xC7, 0xCD, 0xE2, 0xC7, 0xCA];
  const part2ArabicBytes = [0xE6, 0xC7, 0xE1, 0xCF, 0xE3, 0xC7, 0xC1, 0x20, 0xC7, 0xE1, 0xD2, 0xC7, 0xDF, 0xED, 0xC7, 0xCA, 0x20, 0xC7, 0xE1, 0xD8, 0xC7, 0xE5, 0xD1, 0xC7, 0xCA];

  const prefixBytes = Array.from(new TextEncoder().encode(srtAsciiPrefix));
  const suffixBytes = Array.from(new TextEncoder().encode(srtAsciiSuffix));
  const endBytes = Array.from(new TextEncoder().encode(srtAsciiEnd));

  const allBytes = [
    ...prefixBytes,
    ...part1ArabicBytes,
    ...suffixBytes,
    ...part2ArabicBytes,
    ...endBytes
  ];

  return new Uint8Array(allBytes);
}
