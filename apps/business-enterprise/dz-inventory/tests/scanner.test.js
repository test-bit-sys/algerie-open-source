// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openScanner } from '../src/ui/scanner.js';

vi.mock('../src/ui/modal.js', () => ({
  openModal: ({ content, onClose }) => {
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.append(content);
    document.body.append(root);
    return { close: () => { root.remove(); onClose?.(); } };
  },
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
let stop, detect, getUserMedia;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  stop = vi.fn();
  detect = vi.fn().mockResolvedValue([]);
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('BarcodeDetector', class {
    static getSupportedFormats = async () => ['ean_13'];
    detect(...args) { return detect(...args); }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('ignores a camera result that arrives after the scanner is closed', async () => {
  const result = deferred();
  detect.mockReturnValue(result.promise);
  const onCode = vi.fn();
  const scanner = openScanner({ onCode });
  await vi.advanceTimersByTimeAsync(250);
  expect(detect).toHaveBeenCalledTimes(1);
  scanner.close();
  result.resolve([{ rawValue: '1234567890123' }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(onCode).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not restart the camera timer when video playback resolves after close', async () => {
  const playback = deferred();
  HTMLMediaElement.prototype.play.mockReturnValue(playback.promise);
  const scanner = openScanner({ onCode: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  scanner.close();
  playback.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(stop).toHaveBeenCalledTimes(1);
});

it('still delivers a live camera result and stops its stream after a single scan', async () => {
  detect.mockResolvedValue([{ rawValue: '1234567890123' }]);
  const onCode = vi.fn();
  openScanner({ onCode });
  await vi.advanceTimersByTimeAsync(250);
  expect(onCode).toHaveBeenCalledExactlyOnceWith('1234567890123');
  expect(stop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
