import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCalendarFileDrop } from '../src/js/file-drop.js';

const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:drop-test\r\nDTSTART:20260918T090000Z\r\nDTEND:20260918T100000Z\r\nSUMMARY:Dropped meeting\r\nEND:VEVENT\r\nEND:VCALENDAR';
const calendarFile = () => new File([ics], 'meeting.ICS', { type: 'text/calendar' });

function drag(target, type, { files = [], types = ['Files'] } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
  target.dispatchEvent(e);
  return e;
}

describe('calendar file drops', () => {
  let calendar, child, store, canImport, dispose;
  beforeEach(() => {
    calendar = document.createElement('main');
    child = document.createElement('div');
    calendar.append(child);
    document.body.append(calendar);
    store = {
      getAllEvents: () => [],
      importEvents: vi.fn().mockResolvedValue({ imported: 1, failed: 0, failedEvents: [] }),
    };
    canImport = vi.fn(() => !document.querySelector('.dialog-scrim'));
    dispose = bindCalendarFileDrop(calendar, { store, canImport });
  });
  afterEach(() => {
    dispose();
    document.querySelector('.io-modal [aria-label="Close"]')?.click();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('highlights across nested cells and clears when the file leaves', () => {
    drag(calendar, 'dragenter');
    drag(child, 'dragenter');
    drag(calendar, 'dragleave');
    expect(calendar.classList.contains('is-file-drop-target')).toBe(true);
    const over = drag(child, 'dragover');
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    drag(child, 'dragleave');
    expect(calendar.classList.contains('is-file-drop-target')).toBe(false);
  });

  it('imports an ICS drop through the dialog and prevents browser navigation', async () => {
    drag(child, 'dragenter');
    const drop = drag(child, 'drop', { files: [calendarFile()] });
    expect(drop.defaultPrevented).toBe(true);
    expect(calendar.classList.contains('is-file-drop-target')).toBe(false);
    expect(document.querySelector('.io-modal')).not.toBeNull();
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(1));
    expect(store.importEvents.mock.calls[0][0][0]).toMatchObject({
      title: 'Dropped meeting',
      start: Date.parse('2026-09-18T09:00:00Z'),
      end: Date.parse('2026-09-18T10:00:00Z'),
    });
    await vi.waitFor(() => expect(document.querySelector('.io__status').textContent).toBe('Imported 1 event.'));
  });

  it('rejects additional drops while the import dialog is open', async () => {
    drag(child, 'drop', { files: [calendarFile()] });
    drag(child, 'drop', { files: [calendarFile()] });
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.io-modal')).toHaveLength(1);
  });

  it('leaves text and internal event drags untouched', () => {
    drag(child, 'dragenter', { types: ['text/plain'] });
    expect(drag(child, 'dragover', { types: ['text/plain'] }).defaultPrevented).toBe(false);
    expect(drag(child, 'drop', { types: ['text/plain'] }).defaultPrevented).toBe(false);
    expect(calendar.classList.contains('is-file-drop-target')).toBe(false);
    expect(document.querySelector('.io-modal')).toBeNull();
  });

  it('blocks file navigation outside the calendar and while an overlay is open', () => {
    for (const target of [document.body, child]) {
      canImport.mockReturnValue(false);
      const over = drag(target, 'dragover');
      expect(over.defaultPrevented).toBe(true);
      expect(over.dataTransfer.dropEffect).toBe('none');
      expect(drag(target, 'drop', { files: [calendarFile()] }).defaultPrevented).toBe(true);
    }
    expect(document.querySelector('.io-modal')).toBeNull();
    expect(store.importEvents).not.toHaveBeenCalled();
  });

  it('rejects unsupported files and multiple files with feedback', () => {
    drag(child, 'drop', { files: [new File(['text'], 'notes.txt')] });
    expect(document.body.textContent).toContain('Choose an .ics');
    drag(child, 'drop', { files: [calendarFile(), calendarFile()] });
    expect(document.body.textContent).toContain('Drop one calendar file at a time.');
    expect(document.querySelector('.io-modal')).toBeNull();
    expect(store.importEvents).not.toHaveBeenCalled();
  });

  it('shows an empty-file result without importing events', async () => {
    drag(child, 'drop', { files: [new File(['not a calendar'], 'empty.ics')] });
    await vi.waitFor(() => expect(document.querySelector('.io__status').textContent).toBe('No events found in that file.'));
    expect(store.importEvents).not.toHaveBeenCalled();
  });

  it('cleans up feedback and document listeners on destroy', () => {
    drag(child, 'dragenter');
    dispose();
    expect(calendar.classList.contains('is-file-drop-target')).toBe(false);
    expect(drag(child, 'drop', { files: [calendarFile()] }).defaultPrevented).toBe(false);
    expect(document.querySelector('.io-modal')).toBeNull();
  });
});
