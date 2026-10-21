import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runTimers } from '../src/ui/actions.js';
import { store } from '../src/lib/store.js';
import { emailer } from '../src/lib/services.js';
import { DAY_MS } from '../src/lib/model.js';

vi.mock('../src/lib/store.js', () => ({ store: { listDocs: vi.fn(), markReminded: vi.fn() } }));
vi.mock('../src/lib/services.js', () => ({ signlinks: {}, emailer: { available: () => true, send: vi.fn() } }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  store.listDocs.mockReturnValue([{
    id: 'd1', title: 'NDA', status: 'sent', sentAt: Date.now() - 4 * DAY_MS,
    expiresAt: Date.now() + DAY_MS,
    signers: [{ id: 's1', status: 'pending' }],
    reminder: { every: 3, beforeExpiry: true },
  }]);
});

describe('automatic reminders', () => {
  it.each([
    { ok: true, sent: 0, failed: 1, results: [{ status: 'failed' }] },
    { ok: true, sent: 0, skipped: 1, results: [{ status: 'skipped', reason: 'daily_limit' }] },
  ])('keeps an undelivered last reminder due: %j', async (outcome) => {
    emailer.send.mockResolvedValueOnce(outcome);
    await runTimers();
    expect(store.markReminded).not.toHaveBeenCalled();

    emailer.send.mockResolvedValueOnce({ ok: true, sent: 1 });
    await runTimers();
    expect(store.markReminded).toHaveBeenCalledWith('d1', { preExpiry: true });
  });

  it('leaves a transport failure due for retry', async () => {
    emailer.send.mockRejectedValueOnce(new Error('offline'));
    await runTimers();
    expect(store.markReminded).not.toHaveBeenCalled();
  });
});
