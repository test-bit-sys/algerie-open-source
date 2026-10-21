/**
 * Product thumbnails. Photos live in the user's drive, so each one is a
 * read: thumbnails load only once they scroll into view, and a product
 * without a photo (or with an unreadable one) falls back to the box
 * icon rather than a broken image.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { photoURL, cachedPhotoURL } from '../lib/photos.js';

const lazy = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      obs.unobserve(entry.target);
      entry.target.load?.();
    }
  }, { rootMargin: '200px' })
  : null;

/**
 * Stop watching every thumbnail that hasn't appeared yet — call this when
 * a list is about to be rebuilt. An observer holds its targets alive, and
 * one that never scrolled into view is never reported, so without this a
 * list re-rendered on each keystroke leaves its rows behind for good.
 */
export function resetLazyThumbs() {
  lazy?.disconnect();
}

/**
 * A square thumbnail element for a product. `tone` ('warn' | 'danger')
 * rings it in the alert colour, so a photo can replace a status icon
 * without losing what the colour was saying.
 */
export function productThumb(product, { size = 38, tone = '' } = {}) {
  const node = el('span.thumb', {
    className: `thumb${tone ? ` ${tone}` : ''}`,
    style: { width: `${size}px`, height: `${size}px` },
    html: icon('package', Math.round(size * 0.5)),
  });
  if (!product?.imagePath) return node;

  // No isConnected guard: with the URL already cached this runs while
  // the node is still being built, before anything could attach it —
  // and a node whose row was replaced mid-read is detached garbage that
  // an extra <img> can't hurt.
  const show = (url) => {
    if (!url) return;
    node.replaceChildren(el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
    node.classList.add('has-photo');
  };

  const ready = cachedPhotoURL(product);
  if (ready) {
    show(ready);
    return node;
  }

  node.load = () => { photoURL(product).then(show); };
  if (lazy) lazy.observe(node);
  else node.load();
  return node;
}
