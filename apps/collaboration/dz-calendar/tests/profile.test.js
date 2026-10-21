/**
 * The profile picture is decoration on top of a working letter avatar, so the
 * bar for it is: show it only when every step checks out — a safe username, a
 * successful SDK lookup, a real data:image URL of sane size,
 * and an image that actually decodes — and on ANY other outcome change
 * nothing, throw nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The shared offline signal, controllable per test (offline.js's real flag is
// module state owned by the app's boot sequence).
let blockedFlag = false;
vi.mock(import('../src/js/offline.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  isBlocked: () => blockedFlag,
}));

const {
  fetchProfilePicture,
  fetchSharePicture,
  readCachedPicture,
  clearCachedPicture,
  applyPicture,
  showProfilePicture,
} = await import('../src/js/profile.js');

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const PIC2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const CACHE_KEY = 'cal:profile-pic';

/** Stub the supported SDK method with a picture result or rejection. */
function stubPicture(read) {
  vi.stubGlobal('puter', { auth: { getProfilePicture: read } });
}
/**
 * Image stub that records instances and lets tests decide when (and whether)
 * each decode succeeds — jsdom never fires load events for data URLs itself.
 */
let images;
class FakeImage {
  constructor() {
    images.push(this);
    // What a decoded picture measures — only the rescale path reads these.
    this.naturalWidth = FakeImage.w;
    this.naturalHeight = FakeImage.h;
  }
  set src(v) {
    this._src = v;
    if (FakeImage.auto) queueMicrotask(() => this.finish(!FakeImage.fail));
  }
  get src() {
    return this._src;
  }
  finish(ok) {
    if (ok) this.onload && this.onload();
    else this.onerror && this.onerror();
  }
}

function makeAvatarBtn() {
  const btn = document.createElement('button');
  btn.textContent = 'N';
  btn.setAttribute('aria-label', 'Account and settings');
  document.body.append(btn);
  return btn;
}

beforeEach(() => {
  images = [];
  FakeImage.auto = true;
  FakeImage.fail = false;
  FakeImage.w = 400;
  FakeImage.h = 400;
  blockedFlag = false;
  vi.stubGlobal('Image', FakeImage);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('fetchProfilePicture', () => {
  it('uses the SDK with the explicit host username and never reads legacy files', async () => {
    const getProfilePicture = vi.fn(function (username) {
      expect(this).toBe(puter.auth);
      return Promise.resolve(PIC);
    });
    const read = vi.fn();
    vi.stubGlobal('puter', { auth: { getProfilePicture }, fs: { read } });
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'found', picture: PIC });
    expect(getProfilePicture).toHaveBeenCalledWith('alice');
    expect(read).not.toHaveBeenCalled();
  });

  it('is unknown when the SDK method is unavailable, without falling back to fs', async () => {
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
    const read = vi.fn();
    vi.stubGlobal('puter', { auth: {}, fs: { read } });
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
    expect(read).not.toHaveBeenCalled();
  });

  it('requires an explicit safe username', async () => {
    const read = vi.fn();
    stubPicture(read);
    for (const name of ['', null, undefined, 'a/b', '../x', '.hidden', 'a b', 'a\\b', 42]) {
      expect(await fetchProfilePicture(name)).toEqual({ state: 'unknown' });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('handles rejected and synchronously thrown SDK errors', async () => {
    stubPicture(vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
    stubPicture(() => { throw new Error('SDK error'); });
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
  });

  it('does not request a picture while offline or blocked', async () => {
    const read = vi.fn().mockResolvedValue(null);
    stubPicture(read);
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
    } finally {
      onLine.mockRestore();
    }
    blockedFlag = true;
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves the picture if connectivity is lost during the lookup', async () => {
    stubPicture(async () => { blockedFlag = true; return null; });
    expect(await fetchProfilePicture('alice')).toEqual({ state: 'unknown' });
  });

  it('reports no picture for null and unusable or oversized results', async () => {
    for (const picture of [null, undefined, '', 42, {}, 'https://example.com/x.png',
      'javascript:alert(1)', 'data:text/html,<script>',
      'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024 + 1)]) {
      stubPicture(vi.fn().mockResolvedValue(picture));
      expect(await fetchProfilePicture('alice')).toEqual({ state: 'none' });
    }
  });
});

describe('cache', () => {
  it('round-trips for the same account, never for a KNOWN different one', async () => {
    stubPicture(vi.fn().mockResolvedValue(PIC));
    await showProfilePicture(makeAvatarBtn(), { username: 'alice', uuid: 'u1' });
    expect(readCachedPicture('u1')).toBe(PIC);
    expect(readCachedPicture('someone-else')).toBe(null);
    // An UNKNOWN user (offline boot, getUser() failed) is presumed the owner —
    // the same presumption under which the offline calendar snapshot renders.
    expect(readCachedPicture('')).toBe(PIC);
  });

  it('is null on garbage or tampered storage', () => {
    localStorage.setItem(CACHE_KEY, 'not json');
    expect(readCachedPicture('u1')).toBe(null);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: 'https://x' }));
    expect(readCachedPicture('u1')).toBe(null);
  });

  it('clearCachedPicture removes it and survives missing storage', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    clearCachedPicture();
    expect(localStorage.getItem(CACHE_KEY)).toBe(null);
    expect(() => clearCachedPicture()).not.toThrow();
  });
});

describe('applyPicture', () => {
  it('swaps the letter for the decoded image, keeping the aria-label', async () => {
    const btn = makeAvatarBtn();
    expect(await applyPicture(btn, PIC)).toBe(true);
    const img = btn.querySelector('img.avatar__img');
    expect(img).toBeTruthy();
    expect(img.src).toBe(PIC);
    expect(img.alt).toBe('');
    expect(btn.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('Account and settings');
  });

  it('keeps the letter when the image fails to decode', async () => {
    FakeImage.fail = true;
    const btn = makeAvatarBtn();
    expect(await applyPicture(btn, PIC)).toBe(false);
    expect(btn.querySelector('img')).toBe(null);
    expect(btn.textContent).toBe('N');
  });

  it('rejects anything that is not a data:image URL', async () => {
    const btn = makeAvatarBtn();
    for (const bad of [null, '', 'https://x/y.png', 'javascript:1', 'data:text/plain,x']) {
      expect(await applyPicture(btn, bad)).toBe(false);
    }
    expect(btn.textContent).toBe('N');
    expect(images.length).toBe(0); // never even started a decode
  });

  it('concurrent applies of the same picture share one decode', async () => {
    FakeImage.auto = false;
    const btn = makeAvatarBtn();
    const first = applyPicture(btn, PIC);
    const second = applyPicture(btn, PIC); // same URL while the first still decodes
    expect(images.length).toBe(1);
    images[0].finish(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(btn.querySelector('img').src).toBe(PIC);
    // The in-flight slot was cleared: a different picture starts a fresh decode.
    const third = applyPicture(btn, PIC2);
    expect(images.length).toBe(2);
    images[1].finish(true);
    expect(await third).toBe(true);
  });

  it('a stale slow decode never clobbers a newer picture', async () => {
    FakeImage.auto = false;
    const btn = makeAvatarBtn();
    const first = applyPicture(btn, PIC); // starts decoding, left pending
    const second = applyPicture(btn, PIC2); // newer request
    expect(images.length).toBe(2);
    images[1].finish(true); // newer one lands first
    expect(await second).toBe(true);
    images[0].finish(true); // stale decode finally finishes
    expect(await first).toBe(false);
    expect(btn.querySelector('img').src).toBe(PIC2);
  });
});

describe('showProfilePicture', () => {
  it('shows a freshly fetched picture and caches it', async () => {
    stubPicture(vi.fn().mockResolvedValue(PIC));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.querySelector('img').src).toBe(PIC);
    expect(readCachedPicture('u1')).toBe(PIC);
  });

  it('shows the cached picture instantly and keeps it when the read proves nothing', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    stubPicture(vi.fn().mockRejectedValue(new Error('offline')));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.querySelector('img').src).toBe(PIC);
    expect(readCachedPicture('u1')).toBe(PIC);
  });

  it('updates a stale cached picture to the fresh one', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    stubPicture(vi.fn().mockResolvedValue(PIC2));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.querySelector('img').src).toBe(PIC2);
    expect(readCachedPicture('u1')).toBe(PIC2);
  });

  it('restores the letter and drops the cache when the picture is unavailable', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    stubPicture(vi.fn().mockResolvedValue(null));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.querySelector('img')).toBe(null);
    expect(btn.textContent).toBe('N');
    expect(localStorage.getItem(CACHE_KEY)).toBe(null);
  });

  it('never caches a picture that failed to decode', async () => {
    FakeImage.fail = true;
    stubPicture(vi.fn().mockResolvedValue(PIC));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.textContent).toBe('N');
    expect(localStorage.getItem(CACHE_KEY)).toBe(null);
  });

  it("never shows another account's cached picture", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'other', picture: PIC }));
    stubPicture(vi.fn().mockRejectedValue(new Error('offline')));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    expect(btn.querySelector('img')).toBe(null);
    expect(btn.textContent).toBe('N');
  });

  it('is inert and settles cleanly with no user or no SDK at all', async () => {
    const btn = makeAvatarBtn();
    await expect(showProfilePicture(btn, null)).resolves.toBeUndefined();
    await expect(showProfilePicture(btn, {})).resolves.toBeUndefined();
    expect(btn.textContent).toBe('N');
  });

  it('shows the cached picture on an offline boot where getUser() returned null', async () => {
    // Signed-in but offline: main.js still boots the calendar from its snapshot
    // with user:null — the avatar must honor its cache under the same presumption.
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    const btn = makeAvatarBtn();
    await showProfilePicture(btn, null);
    expect(btn.querySelector('img').src).toBe(PIC);
    expect(readCachedPicture('u1')).toBe(PIC); // and never rewrites it under key ''
  });

  it('a fetch already in flight when sign-out clears the cache cannot re-persist it', async () => {
    let resolveRead;
    stubPicture(vi.fn().mockReturnValue(new Promise((r) => (resolveRead = r))));
    const btn = makeAvatarBtn();
    const settled = showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
    clearCachedPicture(); // sign-out on a shared machine, fetch still pending
    resolveRead(PIC);
    await settled;
    expect(localStorage.getItem(CACHE_KEY)).toBe(null);
  });

  it('does not rewrite an unchanged cache entry on a warm boot', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    stubPicture(vi.fn().mockResolvedValue(PIC));
    const setItem = vi.spyOn(localStorage, 'setItem');
    try {
      const btn = makeAvatarBtn();
      await showProfilePicture(btn, { username: 'alice', uuid: 'u1' });
      expect(btn.querySelector('img').src).toBe(PIC);
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('fetchSharePicture (the copy a booking page may publish)', () => {
  const ALICE = { username: 'alice', uuid: 'u1' };
  // Past the 64KB publishing cap, so it only goes out rescaled.
  const HUGE = 'data:image/png;base64,' + 'A'.repeat(70 * 1024);

  /** Canvas stub: jsdom has no 2D context, so tests that want the rescale
   *  path (or want to prove there is none) say so explicitly. */
  function stubCanvas(dataUrl) {
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), set fillStyle(v) {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(dataUrl ? ctx : null);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(dataUrl || '');
    return ctx;
  }

  afterEach(() => {
    vi.restoreAllMocks(); // the canvas spies live on a shared prototype
  });

  it('publishes a picture already small enough, untouched', async () => {
    stubPicture(vi.fn().mockResolvedValue(PIC));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'found', picture: PIC });
    // No re-encode: the host's own PNG (animation, transparency and all) is
    // what guests get, and nothing pays for a canvas it doesn't need.
    expect(getContext).not.toHaveBeenCalled();
  });

  it('rescales a picture too big to publish', async () => {
    stubPicture(vi.fn().mockResolvedValue(HUGE));
    FakeImage.w = 900; // a landscape source, to prove the crop
    FakeImage.h = 600;
    const ctx = stubCanvas(PIC2);
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'found', picture: PIC2 });
    // Cover-cropped from the middle of the landscape source, not squashed.
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 150, 0, 600, 600, 0, 0, 160, 160);
  });

  it('publishes nothing when a too-big picture cannot be rescaled', async () => {
    // No canvas (or an engine that refuses toDataURL) — 'unknown', never
    // 'none': the host HAS a picture, and calling it gone would pull one off a
    // live page that another browser published perfectly well.
    stubPicture(vi.fn().mockResolvedValue(HUGE));
    stubCanvas(null);
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'unknown' });
  });

  it('publishes nothing when the rescale is still too big', async () => {
    stubPicture(vi.fn().mockResolvedValue(HUGE));
    stubCanvas('data:image/jpeg;base64,' + 'B'.repeat(65 * 1024));
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'unknown' });
  });

  it('is none when the account has no available picture', async () => {
    stubPicture(vi.fn().mockResolvedValue(null));
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'none' });
  });

  it('falls back to the cached copy when the read proves nothing', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: 'u1', picture: PIC }));
    stubPicture(vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'found', picture: PIC });
    // …and with nothing cached there is simply nothing to say.
    localStorage.clear();
    expect(await fetchSharePicture(ALICE)).toEqual({ state: 'unknown' });
  });

  it('never rejects, whatever it is given', async () => {
    await expect(fetchSharePicture(null)).resolves.toEqual({ state: 'unknown' });
    await expect(fetchSharePicture({})).resolves.toEqual({ state: 'unknown' });
  });
});
