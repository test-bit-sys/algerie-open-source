// Status bar fields. View > Status Bar shows or hides the bar and picks which
// fields it lists: the time and level under the pointer, the frame rate of the
// file's or session's video, file status, sample type, uncompressed size,
// duration, free storage (as bytes and as recording time) and dropped playback
// buffers.

import { formatBytes } from '../panels/properties.js';
import { videoOfDoc } from '../video/media.js';
import { videoSourceOf } from '../model/session-video.js';

export const STATUS_FIELDS = [
  { id: 'cursor', label: 'Data Under Cursor' },
  { id: 'frameRate', label: 'Video Frame Rate' },
  { id: 'fileStatus', label: 'File Status' },
  { id: 'sampleType', label: 'Sample Type' },
  { id: 'size', label: 'Uncompressed Audio Size' },
  { id: 'duration', label: 'Duration' },
  { id: 'freeSpace', label: 'Free Space' },
  { id: 'freeTime', label: 'Free Space (Time)' },
  { id: 'dropped', label: 'Detect Dropped Samples' },
];

export const STATUS_DEFAULTS = { cursor: true, frameRate: true, fileStatus: false, sampleType: true, size: true, duration: true, freeSpace: true, freeTime: false, dropped: false };

/** Which fields are on, completed with defaults. */
export function statusFieldsOn(prefs) {
  return { ...STATUS_DEFAULTS, ...(prefs.get('statusFields') || {}) };
}

/** Recording time that `bytes` of storage holds at a rate and channel count (32-bit float samples). */
export function recordingSeconds(bytes, rate, channels) {
  return bytes / (rate * Math.max(1, channels) * 4);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `${h} h ${m} min`;
  if (m >= 1) return `${m} min`;
  return `${Math.floor(seconds)} s`;
}

/** Bytes per sample of the file as stored (32-bit float while it has no file format yet). */
const bytesPerSample = (doc) => Math.max(1, Math.round((doc.info?.bitDepth || 32) / 8));

/** Frame rate of the video an audio file came from or a session plays along with (0 when none). */
function videoFps(doc) {
  try {
    return (doc.kind === 'session' ? videoSourceOf(doc)?.fps : videoOfDoc(doc)?.fps) || 0;
  } catch {
    return 0;
  }
}

/**
 * Status bar texts for the active document (only the free space with none open).
 * @param {object} live { cursor: {frame, rate, channel, db} | null, freeBytes: number | null, dropped: number }
 */
export function statusParts(app, doc, live) {
  const on = statusFieldsOn(app.prefs);
  const parts = [];
  if (!doc) {
    if (on.freeSpace && live.freeBytes != null) parts.push(`${formatBytes(live.freeBytes)} free`);
    return parts;
  }
  if (on.cursor && live.cursor) {
    const c = live.cursor;
    const level = Number.isFinite(c.db) ? `${c.db.toFixed(1)} dB` : '-∞ dB';
    parts.push(`${c.channel ? `${c.channel}: ` : ''}${level} @ ${app.formatTime(c.frame, c.rate)}`);
  }
  const fps = on.frameRate ? videoFps(doc) : 0;
  if (fps) parts.push(`${fps} fps`);
  if (on.fileStatus) parts.push(app.recording ? 'Recording' : doc.dirty ? 'Modified' : doc.source?.type === 'new' ? 'Not saved' : 'Saved');
  if (on.sampleType) {
    if (doc.kind === 'audio') parts.push(`${doc.sampleRate} Hz • ${doc.info.bitDepth === 32 ? '32-bit (float)' : `${doc.info.bitDepth}-bit`} • ${doc.channelCount === 1 ? 'Mono' : doc.channelCount === 2 ? 'Stereo' : `${doc.channelCount} ch`}`);
    else parts.push(`${doc.sampleRate} Hz • 32-bit Mixing`);
  }
  if (on.size && doc.kind === 'audio') parts.push(formatBytes(doc.length * doc.channelCount * bytesPerSample(doc)));
  if (on.duration) parts.push(app.formatTime(doc.length, doc.sampleRate));
  if (live.freeBytes != null) {
    if (on.freeSpace) parts.push(`${formatBytes(live.freeBytes)} free`);
    if (on.freeTime) parts.push(`${formatDuration(recordingSeconds(live.freeBytes, doc.sampleRate, doc.channelCount ?? 2))} free`);
  }
  if (on.dropped && live.dropped) parts.push(`${live.dropped} dropped`);
  return parts;
}

/** View > Status Bar commands and the live values the fields show. */
export function installStatusCommands(app) {
  const live = { cursor: null, freeBytes: null, dropped: 0 };
  app.statusLive = live;
  const prefs = app.prefs;
  app.commands.register(
    STATUS_FIELDS.map((f) => ({
      id: `status.${f.id}`,
      label: f.label,
      checked: () => statusFieldsOn(prefs)[f.id],
      run: () => {
        const cur = statusFieldsOn(prefs);
        prefs.set('statusFields', { ...cur, [f.id]: !cur[f.id] });
      },
    })),
  );
  let pending = 0;
  const changed = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      app.emit('status-live');
    });
  };
  app.on('cursor-data', (d) => {
    live.cursor = d;
    if (statusFieldsOn(prefs).cursor) changed();
  });
  app.engine.on?.('underrun', () => {
    live.dropped++;
    if (statusFieldsOn(prefs).dropped) changed();
  });
  // Dropped buffers count per playback run.
  app.on('transport', (s) => s === 'playing' && live.dropped && ((live.dropped = 0), changed()));
  const refreshFree = async () => {
    const on = statusFieldsOn(prefs);
    if (!on.freeSpace && !on.freeTime) return;
    try {
      const est = await navigator.storage?.estimate?.();
      live.freeBytes = est && est.quota ? Math.max(0, est.quota - (est.usage || 0)) : null;
    } catch {
      live.freeBytes = null;
    }
    changed();
  };
  refreshFree();
  prefs.on('change', (key) => key === 'statusFields' && refreshFree());
  app.on('documents', refreshFree);
  app.on('exported', refreshFree);
}
