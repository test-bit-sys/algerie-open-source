// Event log: noteworthy things that happened while the app ran (errors,
// warnings such as playback dropouts, and information messages), listed by the
// Events panel. Kept in memory for this page; the oldest entries drop off past
// the limit.

import { Emitter } from './emitter.js';

export const EVENT_TYPES = [
  { id: 'error', label: 'Error', rank: 0 },
  { id: 'warning', label: 'Warning', rank: 1 },
  { id: 'info', label: 'Information', rank: 2 },
];

const typeRank = (id) => EVENT_TYPES.find((t) => t.id === id)?.rank ?? 3;

export class EventLog extends Emitter {
  constructor({ limit = 500, now = () => Date.now() } = {}) {
    super();
    this.limit = limit;
    this.now = now;
    this.list = [];
    this.nextId = 1;
  }

  get entries() {
    return this.list;
  }

  /** Adds an entry { type: 'error'|'warning'|'info', name, message }; returns it. */
  add({ type = 'info', name = '', message }) {
    const text = String(message ?? '').trim();
    if (!text) return null;
    const entry = { id: this.nextId++, type: EVENT_TYPES.some((t) => t.id === type) ? type : 'info', time: this.now(), name: String(name || ''), message: text };
    this.list.push(entry);
    if (this.list.length > this.limit) this.list.splice(0, this.list.length - this.limit);
    this.emit('change', { added: entry });
    return entry;
  }

  remove(ids) {
    const gone = new Set(ids);
    const next = this.list.filter((e) => !gone.has(e.id));
    if (next.length === this.list.length) return;
    this.list = next;
    this.emit('change', {});
  }

  clear() {
    if (!this.list.length) return;
    this.list = [];
    this.emit('change', {});
  }
}

/**
 * Entries sorted by a column ('type' | 'time' | 'name' | 'event'), ascending
 * or descending. Ties fall back to the order they were logged.
 */
export function sortEvents(entries, key = 'time', dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = {
    type: (a, b) => typeRank(a.type) - typeRank(b.type),
    time: (a, b) => a.time - b.time,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    event: (a, b) => a.message.localeCompare(b.message, undefined, { sensitivity: 'base', numeric: true }),
  }[key] || ((a, b) => a.time - b.time);
  return entries.slice().sort((a, b) => sign * cmp(a, b) || sign * (a.id - b.id));
}

export function eventTypeLabel(id) {
  return EVENT_TYPES.find((t) => t.id === id)?.label || 'Information';
}
