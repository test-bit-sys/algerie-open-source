// Control surface message handling, kept free of Web MIDI and the DOM so it
// can be tested. Two ways to drive the app from hardware:
//
//  - 'mcu': the widely used Mackie-style protocol spoken by most DAW
//    controllers: eight channel strips (motor fader as pitch bend on MIDI
//    channels 1-8, master fader on channel 9, rotary encoders as relative
//    CCs 16-23, mute/solo/arm/select buttons as notes) plus transport and
//    bank buttons. Strips map to the visible tracks of the session from the
//    current bank offset.
//  - 'learn': any note or CC the user assigns to a command or a continuous
//    target (selected track volume or pan, master volume).

/** Decodes raw MIDI bytes into { type, channel, number, value } (value 0..1 for 7- and 14-bit data). */
export function decodeMidi(data) {
  const [status, a = 0, b = 0] = data;
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0x90 && b > 0) return { type: 'noteon', channel, number: a, value: b / 127 };
  if (type === 0x80 || (type === 0x90 && b === 0)) return { type: 'noteoff', channel, number: a, value: 0 };
  if (type === 0xb0) return { type: 'cc', channel, number: a, value: b / 127, raw: b };
  if (type === 0xe0) return { type: 'pitchbend', channel, number: 0, value: ((b << 7) | a) / 16383 };
  return null;
}

// Button notes of the Mackie-style layout.
const ARM = 0;
const SOLO = 8;
const MUTE = 16;
const SELECT = 24;
const TRANSPORT = { 91: 'transport.rewind', 92: 'transport.forward', 93: 'transport.stop', 94: 'transport.play', 95: 'transport.record', 86: 'transport.loop', 89: 'marker.add', 84: 'marker.previous', 85: 'marker.next', 70: 'edit.undo', 71: 'edit.redo', 72: 'file.save' };
const BANK = { 46: -8, 47: 8, 48: -1, 49: 1 };

/**
 * Turns one decoded MCU message into an action:
 *   { kind: 'command', id } | { kind: 'fader', strip, value } | { kind: 'master', value }
 *   { kind: 'pan', strip, delta } | { kind: 'toggle', strip, key } | { kind: 'select', strip }
 *   { kind: 'bank', delta } | null
 * `strip` is 0-7 relative to the bank. Pan deltas are in percent steps.
 */
export function mcuAction(msg) {
  if (!msg) return null;
  if (msg.type === 'pitchbend') return msg.channel === 8 ? { kind: 'master', value: msg.value } : msg.channel < 8 ? { kind: 'fader', strip: msg.channel, value: msg.value } : null;
  if (msg.type === 'cc' && msg.number >= 16 && msg.number <= 23) {
    // Relative encoder: bit 6 set turns counter-clockwise, the low bits are the speed.
    const ticks = msg.raw & 0x3f;
    return { kind: 'pan', strip: msg.number - 16, delta: (msg.raw & 0x40 ? -ticks : ticks) * 2 };
  }
  if (msg.type !== 'noteon') return null;
  const n = msg.number;
  if (n >= ARM && n < ARM + 8) return { kind: 'toggle', strip: n - ARM, key: 'arm' };
  if (n >= SOLO && n < SOLO + 8) return { kind: 'toggle', strip: n - SOLO, key: 'solo' };
  if (n >= MUTE && n < MUTE + 8) return { kind: 'toggle', strip: n - MUTE, key: 'mute' };
  if (n >= SELECT && n < SELECT + 8) return { kind: 'select', strip: n - SELECT };
  if (TRANSPORT[n]) return { kind: 'command', id: TRANSPORT[n] };
  if (BANK[n]) return { kind: 'bank', delta: BANK[n] };
  return null;
}

/** LED and motor-fader feedback for the surface: MIDI messages as byte arrays. */
export function mcuFeedback({ tracks, master, offset, playing, recording, loop, faderPos }) {
  const out = [];
  const led = (note, on) => out.push([0x90, note, on ? 127 : 0]);
  for (let i = 0; i < 8; i++) {
    const t = tracks[offset + i];
    led(ARM + i, Boolean(t?.arm));
    led(SOLO + i, Boolean(t?.solo));
    led(MUTE + i, Boolean(t?.mute));
    led(SELECT + i, Boolean(t?.selected));
    const v = Math.round((t ? faderPos(t.volume) : 0) * 16383);
    out.push([0xe0 | i, v & 0x7f, v >> 7]);
  }
  if (master) {
    const v = Math.round(faderPos(master.volume) * 16383);
    out.push([0xe8, v & 0x7f, v >> 7]);
  }
  led(94, playing);
  led(93, !playing && !recording);
  led(95, recording);
  led(86, loop);
  return out;
}

/** A learned mapping's key: which control it listens to. */
export function mappingKey(msg) {
  if (!msg) return null;
  if (msg.type === 'cc') return `cc:${msg.channel}:${msg.number}`;
  if (msg.type === 'noteon' || msg.type === 'noteoff') return `note:${msg.channel}:${msg.number}`;
  if (msg.type === 'pitchbend') return `pb:${msg.channel}`;
  return null;
}

/** Targets a learned control can drive. Continuous ones take the control's 0..1 value. */
export const LEARN_TARGETS = [
  { id: 'track.volume', label: 'Selected Track Volume', continuous: true },
  { id: 'track.pan', label: 'Selected Track Pan', continuous: true },
  { id: 'master.volume', label: 'Master Volume', continuous: true },
  { id: 'cmd:transport.toggle', label: 'Play/Stop' },
  { id: 'cmd:transport.play', label: 'Play' },
  { id: 'cmd:transport.stop', label: 'Stop' },
  { id: 'cmd:transport.record', label: 'Record' },
  { id: 'cmd:transport.loop', label: 'Loop Playback' },
  { id: 'cmd:transport.rewind', label: 'Rewind' },
  { id: 'cmd:transport.forward', label: 'Fast Forward' },
  { id: 'cmd:transport.toStart', label: 'Move Playhead to Beginning' },
  { id: 'cmd:marker.add', label: 'Add Cue Marker' },
  { id: 'cmd:marker.previous', label: 'Previous Marker' },
  { id: 'cmd:marker.next', label: 'Next Marker' },
  { id: 'cmd:edit.undo', label: 'Undo' },
  { id: 'cmd:edit.redo', label: 'Redo' },
  { id: 'cmd:mt.selectPreviousTrack', label: 'Select Previous Track' },
  { id: 'cmd:mt.selectNextTrack', label: 'Select Next Track' },
];

/**
 * Action for a message under learned mappings ({ [key]: targetId }): commands
 * fire on note-on or when a CC crosses from below the middle to above it
 * (`last` remembers each CC's previous value), continuous targets take the
 * value.
 */
export function learnAction(msg, mappings, last = new Map()) {
  const key = mappingKey(msg);
  const target = key && mappings?.[key];
  const prev = last.get(key);
  if (key && msg.type === 'cc') last.set(key, msg.value);
  if (!target) return null;
  if (target.startsWith('cmd:')) {
    const pressed = msg.type === 'noteon' || (msg.type === 'cc' && msg.value >= 0.5 && !(prev >= 0.5));
    return pressed ? { kind: 'command', id: target.slice(4) } : null;
  }
  if (target === 'master.volume') return { kind: 'master', value: msg.value };
  if (target === 'track.volume') return { kind: 'selectedVolume', value: msg.value };
  if (target === 'track.pan') return { kind: 'selectedPan', value: msg.value };
  return null;
}
