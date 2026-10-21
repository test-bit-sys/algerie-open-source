// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { setupOfflineBanner } from '../src/ui/offlinebanner.js';
import { openReceiveForm } from '../src/ui/receiveform.js';
import { store } from '../src/lib/store.js';
import { kvSet, flushQueue, initSync } from '../src/lib/cloud.js';
import { __resetMemoryState } from '../src/lib/offline.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/modal.js', () => ({ openModal: ({ content }) => {
  document.body.append(content); return { close: () => content.remove() };
} }));
let cleanup;
beforeEach(async () => {
  __resetMemoryState(); await initSync(); document.body.replaceChildren(); vi.clearAllMocks();
});
afterEach(async () => { cleanup?.(); cleanup = null; await initSync(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the error visible, offers retry, and announces success only after recovery', async () => {
  let reject = true;
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('puter', { kv: { set: async () => { if (reject) throw new Error('API rejected'); } } });
  cleanup = setupOfflineBanner();
  const banner = document.querySelector('[role="status"]');
  const retry = banner.querySelector('button');
  await kvSet('inventory', { qty: 7 });
  expect(banner.hidden).toBe(false);
  expect(retry.hidden).toBe(true);
  navigator.onLine = true;
  await flushQueue();
  expect(banner.textContent).toContain('could not sync');
  expect(banner.textContent).toContain('export a backup');
  expect(retry.hidden).toBe(false);
  expect(toast).not.toHaveBeenCalled();
  reject = false;
  retry.click();
  await vi.waitFor(() => expect(banner.hidden).toBe(true));
  expect(toast).toHaveBeenCalledWith('All changes synced', { icon: 'cloud' });
});

it.each([false, true])('handles receipt rejection with committed=%s without inviting duplicate delivery', async (committed) => {
  const error = Object.assign(new Error(committed ? 'Change recorded; reload to recover the saved operation.' : 'Write rejected'), { committed });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(store, 'orderById').mockReturnValue({ id: 'o', reference: 'PO-1', lines: [{ productId: 'p', qty: 5, received: 0 }] });
  vi.spyOn(store, 'productById').mockReturnValue({ id: 'p', name: 'Delivery', unit: 'each', quantity: 0 });
  vi.spyOn(store, 'receiveOrderLines').mockRejectedValue(error);
  const onSaved = vi.fn();
  openReceiveForm('o', { onSaved });
  const form = document.querySelector('form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(error.message, { icon: 'wifiOff' }));
  expect(document.body.contains(form)).toBe(!committed);
  if (!committed) expect(form.querySelector('[type="submit"]').disabled).toBe(false);
  expect(onSaved).toHaveBeenCalledTimes(committed ? 1 : 0);
});
