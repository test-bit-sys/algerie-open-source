// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let toast;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.replaceChildren();
  ({ toast } = await import('../src/ui/toast.js'));
});
afterEach(() => vi.useRealTimers());

it('runs Undo only once while its toast is animating away', () => {
  const undo = vi.fn();
  const expire = vi.fn();
  toast('Taken out', { action: { label: 'Undo', onClick: undo }, onExpire: expire });
  const button = document.querySelector('.toast-action');
  button.click();
  button.click();
  expect(undo).toHaveBeenCalledTimes(1);
  vi.runAllTimers();
  expect(expire).not.toHaveBeenCalled();
});

it('does not run an action after the toast has expired', () => {
  const undo = vi.fn();
  const expire = vi.fn();
  toast('Deleted', { duration: 100, action: { label: 'Undo', onClick: undo }, onExpire: expire });
  vi.advanceTimersByTime(100);
  document.querySelector('.toast-action').click();
  expect(undo).not.toHaveBeenCalled();
  expect(expire).toHaveBeenCalledTimes(1);
});
