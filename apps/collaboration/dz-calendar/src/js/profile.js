/**
 * The user's profile picture, read through puter.auth.getProfilePicture().
 *
 * Everything here is strictly best-effort: some users have no picture, the
 * SDK may be missing pieces, the device may be offline, and the returned images
 * are user-editable data — so every path degrades silently to the letter avatar
 * the app has always shown. Nothing in this module ever throws at a caller.
 *
 * The last successfully-shown picture is cached in localStorage (keyed to the
 * account, like the offline calendar snapshot) so the avatar is right instantly
 * on the next boot and while offline. The cache is cleared on sign-out for the
 * same shared-machine reason the snapshot is.
 *
 * The picture is also publishable: `fetchSharePicture` hands booking.js a copy
 * small enough to put on a public booking page, for hosts who ask for one.
 */
import { isBlocked } from './offline.js';

const CACHE_KEY = 'cal:profile-pic';

// Cap inline pictures so they cannot balloon the DOM or localStorage.
const MAX_PICTURE_CHARS = 2 * 1024 * 1024;

// Only ever render inline image data. Anything else in `picture` — http(s)
// URLs, javascript:, plain text — is treated as "no picture".
function isValidPicture(value) {
  return (
    typeof value === 'string' &&
    /^data:image\//i.test(value) &&
    value.length <= MAX_PICTURE_CHARS
  );
}

// Require an explicit account so a missing host never selects the current user.
function isSafeUsername(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name) && !name.startsWith('.');
}

// The calendar's shared offline signal: the blocked flag catches the cases
// where navigator.onLine lies (captive portal, dead upstream) — same idiom as
// booking.js / rsvp-links.js.
const offline = () =>
  isBlocked() || (typeof navigator !== 'undefined' && navigator.onLine === false);

/**
 * Resolve a picture through the SDK, never by reading the legacy profile file.
 * `none` means the SDK returned no usable picture; `unknown` means we could
 * not check (offline, missing SDK, or a thrown error). The SDK also folds
 * request failures into null, so null cannot distinguish removal from failure.
 * Treat online null as unavailable and stop publishing a possibly removed
 * picture. Known offline states preserve the existing local avatar instead.
 */
export async function fetchProfilePicture(username) {
  if (!isSafeUsername(username) || offline()) return { state: 'unknown' };
  const auth = typeof puter !== 'undefined' && puter.auth;
  if (!auth || typeof auth.getProfilePicture !== 'function') return { state: 'unknown' };

  try {
    // Explicit username avoids accidentally fetching a guest's picture. In the
    // host's authenticated session this can read their own picture on any plan.
    const picture = await auth.getProfilePicture(username);
    if (offline()) return { state: 'unknown' };
    return isValidPicture(picture) ? { state: 'found', picture } : { state: 'none' };
  } catch {
    return { state: 'unknown' };
  }
}

/* ---- Publishing (the host's booking page) -------------------------------- */

// A copy small enough to PUBLISH. Booking pages show the host at ~56px, so a
// 160px square covers retina screens, and the cap is what the publishing path
// will carry at all: the picture rides inside the booking config the host's
// worker reads on every public request, so "small" is a requirement rather
// than a nicety. Anything already under the cap is published untouched (its
// own encoding, animation and transparency included) — only a picture too big
// to publish pays for a rescale.
const SHARE_EDGE = 160;
const SHARE_MAX_CHARS = 64 * 1024;

/**
 * Cover-crop `picture` to a SHARE_EDGE square JPEG. Resolves to null whenever
 * this browser can't do it — no canvas, a source that won't decode, a
 * toDataURL that throws or is refused (a tainted canvas) — so the caller
 * publishes nothing rather than something it hasn't checked. Never rejects.
 *
 * JPEG on white, deliberately: the page frames the picture in a circle, so a
 * transparent PNG's corners are clipped anyway, and JPEG is the one encoder
 * every engine has — an unsupported toDataURL('image/webp') quietly answers
 * PNG, which is the size problem this is here to solve.
 */
function scaleToSquare(picture) {
  return new Promise((resolve) => {
    if (typeof Image !== 'function' || typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const side = Math.min(w, h);
        if (!side) return resolve(null); // an image with no dimensions to crop
        const canvas = document.createElement('canvas');
        canvas.width = SHARE_EDGE;
        canvas.height = SHARE_EDGE;
        const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        if (!ctx || typeof canvas.toDataURL !== 'function') return resolve(null);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, SHARE_EDGE, SHARE_EDGE);
        ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SHARE_EDGE, SHARE_EDGE);
        const out = canvas.toDataURL('image/jpeg', 0.86);
        resolve(isValidPicture(out) ? out : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = picture;
  });
}

/** The picture as it may be published, or null when it can't be got small
 *  enough. */
function shrinkPicture(picture) {
  if (picture.length <= SHARE_MAX_CHARS) return Promise.resolve(picture);
  return scaleToSquare(picture).then((small) =>
    small && small.length <= SHARE_MAX_CHARS ? small : null,
  );
}

/**
 * The account's picture in a form the host can publish on a booking page (see
 * booking.js, which pushes it to their worker, and public/book.html, which
 * shows it to strangers).
 *
 * Resolves to the same three states as fetchProfilePicture, because the caller
 * has to tell them apart: 'none' means stop publishing, 'unknown' means change
 * nothing. A picture that exists but can't be shrunk is 'unknown', never
 * 'none' — the host does have one, and saying otherwise would pull a picture
 * off a live page just because this browser lacks a canvas. Never rejects.
 */
export async function fetchSharePicture(user) {
  const username = user && typeof user.username === 'string' ? user.username : '';
  const userKey = (user && (user.uuid || user.id || user.username)) || '';
  const res = await fetchProfilePicture(username);
  // On an inconclusive read the cached copy is what the avatar button is
  // already showing, and republishing that beats publishing nothing.
  const picture =
    res.state === 'found' ? res.picture : res.state === 'unknown' ? readCachedPicture(userKey) : '';
  if (!picture) return res; // 'none' (stop publishing) or 'unknown' (leave it)
  const small = await shrinkPicture(picture);
  return small ? { state: 'found', picture: small } : { state: 'unknown' };
}

/* ---- Cache -------------------------------------------------------------- */

// Bumped by clearCachedPicture() so a fetch that was already in flight when
// sign-out wiped the cache can't re-persist the signed-out account's picture
// from its .then() — its write is stamped with the old generation and refused.
let cacheGeneration = 0;

export function readCachedPicture(userKey) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry) return null;
    // A known mismatch is never shown. An UNKNOWN user (offline boot where
    // getUser() failed) is presumed to be the cache's owner — the calendar
    // shows its offline snapshot on exactly the same presumption, and sign-out
    // wipes this cache just like the snapshot.
    if (userKey && entry.user !== userKey) return null;
    return isValidPicture(entry.picture) ? entry.picture : null;
  } catch {
    return null;
  }
}

function writeCachedPicture(userKey, picture, generation) {
  if (!userKey || generation !== cacheGeneration) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ user: userKey, picture }));
  } catch {
    /* quota / private mode — the cache is optional */
  }
}

/** Drop the cached picture and refuse writes from already-running fetches
 *  (used on sign-out; safe to call anywhere). */
export function clearCachedPicture() {
  cacheGeneration += 1;
  removeCachedPicture();
}

function removeCachedPicture() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/* ---- DOM ---------------------------------------------------------------- */

// Per-button swap state. `seq` makes the newest apply/restore win, so a slow
// decode of the cached picture can never clobber a fresher one; `letter` is the
// original text to fall back to; `src` is what's currently displayed;
// `inflight` dedups concurrent requests for the same URL (cached copy and
// fresh fetch usually agree) so the picture is only decoded once.
const swapState = new WeakMap();

function stateFor(btn) {
  let s = swapState.get(btn);
  if (!s) {
    s = { seq: 0, letter: btn.textContent, src: null, inflight: null };
    swapState.set(btn, s);
  }
  return s;
}

/**
 * Swap the button's letter for the picture — but only once the image has
 * actually decoded, so a corrupt data URL keeps the letter instead of showing
 * a broken-image glyph. Resolves true when the picture is on screen.
 */
export function applyPicture(btn, picture) {
  if (!btn || !isValidPicture(picture)) return Promise.resolve(false);
  const state = stateFor(btn);
  if (state.src === picture) return Promise.resolve(true); // already showing — no flicker
  if (state.inflight && state.inflight.src === picture) return state.inflight.promise;
  if (typeof Image !== 'function') return Promise.resolve(false); // can't verify → keep the letter
  const seq = ++state.seq;
  const probe = new Image();
  const promise = new Promise((resolve) => {
    const settle = (shown) => {
      if (state.inflight && state.inflight.src === picture) state.inflight = null;
      resolve(shown);
    };
    probe.onload = () => {
      if (state.seq !== seq) return settle(false); // a newer apply/restore won
      // Insert the already-decoded probe itself when it's a real element, so
      // the data URL isn't decoded a second time; the fallback covers exotic
      // environments where Image() doesn't produce an insertable node.
      const img =
        typeof HTMLImageElement === 'function' && probe instanceof HTMLImageElement
          ? probe
          : document.createElement('img');
      img.className = 'avatar__img';
      img.alt = '';
      img.draggable = false;
      if (img !== probe) img.src = picture;
      btn.replaceChildren(img);
      state.src = picture;
      settle(true);
    };
    probe.onerror = () => settle(false);
  });
  // Registered before the load starts: an engine that fires onload
  // synchronously for data URLs must find the entry it is meant to clear.
  state.inflight = { src: picture, promise };
  probe.src = picture;
  return promise;
}

/** Put the original letter back (the picture was unavailable). */
function restoreLetter(btn) {
  const state = stateFor(btn);
  state.seq += 1; // cancel any in-flight decode
  if (state.src != null) {
    btn.replaceChildren(document.createTextNode(state.letter));
    state.src = null;
  }
}

/**
 * Show the account's profile picture on the avatar button: the cached copy
 * immediately (offline-friendly), then whatever the SDK returns. Fire-and-forget from the caller's point of view — the returned
 * promise never rejects and exists only so tests can await settlement.
 */
export function showProfilePicture(btn, user) {
  const username = user && typeof user.username === 'string' ? user.username : '';
  const userKey = (user && (user.uuid || user.id || user.username)) || '';
  const generation = cacheGeneration;

  const cached = readCachedPicture(userKey);
  if (cached) applyPicture(btn, cached);

  return fetchProfilePicture(username)
    .then((res) => {
      if (res.state === 'found') {
        return applyPicture(btn, res.picture).then((shown) => {
          // No rewrite of an unchanged entry: on warm boots the cache already
          // holds these exact bytes, and re-serializing a data URL into
          // localStorage on the main thread every startup buys nothing.
          if (shown && res.picture !== cached) writeCachedPicture(userKey, res.picture, generation);
        });
      }
      if (res.state === 'none') {
        // The profile says there is no picture any more; agree everywhere.
        removeCachedPicture();
        restoreLetter(btn);
      }
      // 'unknown' — leave whatever is showing (letter or cached picture) alone.
    })
    .catch(() => {
      /* never let avatar decoration surface as an app error */
    });
}
