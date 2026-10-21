import { describe, it, expect, afterEach, vi } from 'vitest';
import { openDataDialog } from '../src/js/data-io.js';
import { OfflineWriteError } from '../src/js/offline.js';

/** The import/export dialog only needs these two store methods. */
function makeStore() {
  return {
    getAllEvents: () => [],
    importEvents: vi.fn(),
  };
}

const dialogEl = () => document.querySelector('.dialog-scrim');
const buttons = () => [...dialogEl().querySelectorAll('button')];
const retryBtn = () => buttons().find((b) => b.textContent.includes('Retry failed'));
const statusEl = () => dialogEl().querySelector('.io__status');

/** Feed a JSON backup file through the hidden file input. */
async function pickFile(events, name = 'backup.json') {
  const input = dialogEl().querySelector('input[type="file"]');
  const file = new File([JSON.stringify({ version: 1, events })], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('import dialog — partial failure & retry', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the retry option alive when a later import fails at the offline gate', async () => {
    const store = makeStore();
    const failedEvents = [{ title: 'Missed', start: 5, end: 6 }];

    // Import #1: partial failure → the "Retry failed" button appears.
    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 1, failedEvents });
    openDataDialog({ store });
    expect(retryBtn().style.display).toBe('none');

    await pickFile([{ title: 'A', start: 1, end: 2 }]);
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(retryBtn().style.display).not.toBe('none'));

    // Import #2 (a NEW file) is rejected by the offline write-gate. Nothing was
    // imported, so the pending retry list is still valid — its button must
    // come back, not vanish for good.
    store.importEvents.mockRejectedValueOnce(new OfflineWriteError());
    await pickFile([{ title: 'B', start: 3, end: 4 }]);
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(statusEl().textContent).toMatch(/offline/i));
    expect(retryBtn().style.display).not.toBe('none');

    // Clicking retry re-imports EXACTLY the previously failed events.
    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 0, failedEvents: [] });
    retryBtn().click();
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(3));
    expect(store.importEvents.mock.calls[2][0]).toBe(failedEvents);
    await vi.waitFor(() => expect(statusEl().textContent).toMatch(/Imported 1 event/));
    expect(retryBtn().style.display).toBe('none'); // fully recovered → no retry left
  });

  it("a second file's failures ADD to the pending retry list instead of replacing it", async () => {
    const store = makeStore();
    const failedA = [{ title: 'A-missed', start: 5, end: 6 }];
    const failedB = [{ title: 'B-missed', start: 7, end: 8 }];

    // File A: one failure pending.
    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 1, failedEvents: failedA });
    openDataDialog({ store });
    await pickFile([{ title: 'A', start: 1, end: 2 }]);
    await vi.waitFor(() => expect(retryBtn().style.display).not.toBe('none'));

    // File B, imported WITHOUT retrying A first, also partially fails. A's
    // failed events live nowhere else (re-importing file A would duplicate
    // its successes) — replacing the list would orphan them for good.
    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 1, failedEvents: failedB });
    await pickFile([{ title: 'B', start: 3, end: 4 }]);
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(statusEl().textContent).toContain('2 couldn\'t be saved'));

    // Retry carries BOTH files' failures, and a clean retry clears the slate.
    store.importEvents.mockResolvedValueOnce({ imported: 2, failed: 0, failedEvents: [] });
    retryBtn().click();
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(3));
    expect(store.importEvents.mock.calls[2][0]).toEqual([...failedA, ...failedB]);
    await vi.waitFor(() => expect(retryBtn().style.display).toBe('none'));
  });

  it("a fully successful NEW import keeps an older pending retry alive", async () => {
    const store = makeStore();
    const failedA = [{ title: 'A-missed', start: 5, end: 6 }];
    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 1, failedEvents: failedA });
    openDataDialog({ store });
    await pickFile([{ title: 'A', start: 1, end: 2 }]);
    await vi.waitFor(() => expect(retryBtn().style.display).not.toBe('none'));

    store.importEvents.mockResolvedValueOnce({ imported: 3, failed: 0, failedEvents: [] });
    await pickFile([{ title: 'B', start: 3, end: 4 }]);
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(2));
    // B succeeded, but A's failures are still only recoverable from here.
    expect(retryBtn().style.display).not.toBe('none');

    store.importEvents.mockResolvedValueOnce({ imported: 1, failed: 0, failedEvents: [] });
    retryBtn().click();
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(3));
    expect(store.importEvents.mock.calls[2][0]).toBe(failedA);
  });

  it('a failed retry keeps its own button visible for another attempt', async () => {
    const store = makeStore();
    const failedEvents = [{ title: 'Missed', start: 5, end: 6 }];
    store.importEvents.mockResolvedValueOnce({ imported: 0, failed: 1, failedEvents });
    openDataDialog({ store });

    await pickFile([{ title: 'A', start: 1, end: 2 }]);
    await vi.waitFor(() => expect(retryBtn().style.display).not.toBe('none'));

    store.importEvents.mockRejectedValueOnce(new OfflineWriteError());
    retryBtn().click();
    await vi.waitFor(() => expect(store.importEvents).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(statusEl().textContent).toMatch(/offline/i));
    expect(retryBtn().style.display).not.toBe('none');
  });
});
