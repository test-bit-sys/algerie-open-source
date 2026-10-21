import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUserEmail } from '../src/js/auth.js';

afterEach(() => vi.unstubAllGlobals());

describe('requestUserEmail', () => {
  it('requests email access and uses the granted address even when getUser has none', async () => {
    const getUser = vi.fn(async () => ({ username: 'host' }));
    const request = vi.fn(async () => 'host@example.com');
    vi.stubGlobal('puter', { auth: { getUser }, perms: { request } });

    await expect(requestUserEmail()).resolves.toBe('host@example.com');
    expect(request).toHaveBeenCalledExactlyOnceWith('email');
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, ''])('returns no address when access yields %s', async (result) => {
    vi.stubGlobal('puter', { perms: { request: vi.fn(async () => result) } });
    await expect(requestUserEmail()).resolves.toBeNull();
  });

  it('allows a fresh permission request after a refusal', async () => {
    const request = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('host@example.com');
    vi.stubGlobal('puter', { perms: { request } });

    await expect(requestUserEmail()).resolves.toBeNull();
    await expect(requestUserEmail()).resolves.toBe('host@example.com');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('handles an unavailable SDK or failed permission request', async () => {
    vi.stubGlobal('puter', undefined);
    await expect(requestUserEmail()).resolves.toBeNull();
    vi.stubGlobal('puter', { perms: { request: vi.fn().mockRejectedValue(new Error('Unavailable')) } });
    await expect(requestUserEmail()).resolves.toBeNull();
  });
});
