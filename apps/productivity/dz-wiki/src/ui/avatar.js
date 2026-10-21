import { h } from '../lib/dom.js';

const PALETTE = ['blue', 'green', 'purple', 'orange', 'pink', 'red', 'brown', 'yellow'];

export function colorFor(name = '') {
  let n = 0;
  for (const ch of String(name)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

export function initials(name = '') {
  const clean = String(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!clean) return '?';
  const parts = clean.split(' ');
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

/** A round avatar: a picture when there is one, otherwise initials. */
export function avatar(name, { picture = null, size = 24, label = null } = {}) {
  const el = h('span.avatar', { 'data-color': colorFor(name), style: { '--size': `${size}px` }, role: label ? 'img' : null, 'aria-label': label, 'aria-hidden': label ? null : 'true' });
  if (picture) el.append(h('img', { src: picture, alt: '' }));
  else el.textContent = initials(name);
  return el;
}

const pictures = new Map();
let source = null;

/** Where other people's profile pictures come from (puter.auth.getProfilePicture). */
export function setPictureSource(fn) {
  source = fn;
  pictures.clear();
}

/**
 * An avatar that shows the person's profile picture once it loads (Puter
 * shares pictures of people on paid plans; others keep their initials).
 */
export function personAvatar(name, opts = {}) {
  const el = avatar(name, opts);
  if (!source || !name) return el;
  if (!pictures.has(name)) pictures.set(name, Promise.resolve(source(name)).catch(() => null));
  pictures.get(name).then((pic) => {
    if (pic && typeof pic === 'string' && pic.startsWith('data:image/')) {
      el.replaceChildren(Object.assign(document.createElement('img'), { src: pic, alt: '' }));
    }
  });
  return el;
}
