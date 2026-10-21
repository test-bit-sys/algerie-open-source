/**
 * The optional invoice logo: reading a stored one for display, and turning
 * a file the user picked into something worth storing.
 *
 * Logo files live in the user's own Puter files and are read as blobs, so
 * every render needs an object URL. They are cached per path for the life
 * of the session: one invoice can be opened, printed, and reopened without
 * re-reading, and a print never waits on the network. Misses are not
 * cached, so a logo that was unreachable while offline appears as soon as
 * the connection is back.
 */

import { store } from '../lib/store.js';

const urls = new Map(); // stored path -> object URL

/** Object URL for a stored logo path, or null when there is none to show. */
export async function logoURL(path) {
  if (!path) return null;
  if (urls.has(path)) return urls.get(path);
  const blob = await store.readLogo(path);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return url;
}

/* Printing wants more pixels than the 56px the sheet shows, and a logo
   dropped straight off a camera roll would be megabytes of them. Fit the
   image into a box a few times the printed size: crisp on paper, small
   enough that reading it never delays an invoice. */
const MAX_W = 480;
const MAX_H = 160;
const MAX_FILE = 10 * 1024 * 1024;
/* Past this, the PNG is carrying photographic detail no letterhead needs;
   JPEG says the same thing in a fraction of the bytes. */
const PNG_BUDGET = 250 * 1024;

/**
 * A picked file as a small, print-ready blob (PNG, or JPEG when the PNG
 * comes out photo-sized). Throws with a message worth showing when the
 * file is not an image this can read.
 */
export async function prepareLogo(file) {
  if (!file) throw new Error('No file');
  if (!/^image\//.test(file.type || '')) throw new Error('That file is not an image');
  if (file.size > MAX_FILE) throw new Error('That image is too large, use one under 10 MB');

  const img = await decode(file);
  // An ImageBitmap reports width/height; an <img> that was never laid out
  // only reports honest numbers through naturalWidth/Height.
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_W / iw, MAX_H / ih);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();

  const png = await toBlob(canvas, 'image/png');
  if (png && png.size <= PNG_BUDGET) return png;
  // Paper is white, so flattening transparency onto white loses nothing
  // that will be printed.
  const flat = document.createElement('canvas');
  flat.width = w;
  flat.height = h;
  const flatCtx = flat.getContext('2d');
  flatCtx.fillStyle = '#ffffff';
  flatCtx.fillRect(0, 0, w, h);
  flatCtx.drawImage(canvas, 0, 0);
  const jpeg = await toBlob(flat, 'image/jpeg', 0.88);
  if (jpeg && (!png || jpeg.size < png.size)) return jpeg;
  if (png) return png;
  throw new Error('Could not read that image');
}

/**
 * Decode a picked file. createImageBitmap is the fast path but does not
 * take SVG in every browser, so an <img> load covers the rest.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function' && file.type !== 'image/svg+xml') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) reject(new Error('Could not read that image'));
        else resolve(img);
      };
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = url;
    });
  } finally {
    // The bitmap is already drawn from by the time this resolves in every
    // engine that fires load; revoking on the next tick keeps Safari from
    // racing the decode.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
