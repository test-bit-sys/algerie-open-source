/**
 * Product photos, stored in the user's own Puter drive.
 *
 * The product record keeps only a path, so `inv:products:v2` stays a
 * small, fast KV value. Pictures are downscaled and re-encoded to WebP
 * in the browser before upload — an 8 MP phone photo becomes tens of
 * kilobytes, which is what makes thumbnails in a list viable at all.
 *
 * Every call here is best-effort: a photo is a convenience, and no
 * failure to read, write, or delete one may block the actual inventory
 * work. Callers get null and carry on.
 */

const DIR = 'inventory/images';

/** The Puter filesystem, or null when it isn't available. */
const fs = () => (typeof puter !== 'undefined' && puter?.fs ? puter.fs : null);

export const photosSupported = () => !!fs();

/* Product ids normally come from uid(), but a restored backup keeps
   whatever ids the file held — and the id becomes a drive path here.
   Filtering it to a plain file stem keeps a crafted id ("../…") from
   steering the write outside the images directory. */
const safeStem = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_');

export const photoPath = (productId) => `${DIR}/${safeStem(productId)}.webp`;

/**
 * Only paths this module could have written. `imagePath` is stored on
 * the product, so a hand-made backup can point it anywhere; deleting
 * (or reading) whatever it names would let that file reach the rest of
 * the drive.
 */
const ownPath = (path) => typeof path === 'string' && path.startsWith(`${DIR}/`) && !path.includes('..');

/* Object URLs by path, so a list re-render doesn't re-read the drive.
   Entries live as long as the tab does; the whole cache is at most one
   URL per product with a photo. */
const urls = new Map();
const inflight = new Map();

/**
 * Shrink an image to fit `max` on its longest side and re-encode it.
 * Falls back to JPEG where WebP encoding isn't available, and to the
 * original file if the canvas route fails entirely.
 */
export async function downscale(file, { max = 800, quality = 0.82 } = {}) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
      || await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob || file;
  } catch (err) {
    console.error('Downscaling failed; uploading the original', err);
    return file;
  }
}

/** Write a product's photo. Returns its path, or null if it couldn't be saved. */
export async function savePhoto(productId, blob) {
  const drive = fs();
  if (!drive || !blob) return null;
  const path = photoPath(productId);
  try {
    await drive.write(path, blob, { overwrite: true, createMissingParents: true });
    forget(path);
    return path;
  } catch (err) {
    console.error('Saving the photo failed', err);
    return null;
  }
}

/** A displayable URL for a product's photo, or null. Cached per path. */
export async function photoURL(product) {
  const path = product?.imagePath;
  const drive = fs();
  if (!path || !drive || !ownPath(path)) return null;
  if (urls.has(path)) return urls.get(path);
  if (inflight.has(path)) return inflight.get(path).promise;

  const request = {};
  inflight.set(path, request);
  request.promise = (async () => {
    try {
      const blob = await drive.read(path);
      if (inflight.get(path) !== request) return urls.get(path) || null;
      const url = URL.createObjectURL(blob);
      urls.set(path, url);
      return url;
    } catch {
      // A missing file is normal after a restore between accounts; the
      // null is cached so a long list doesn't retry it per render.
      if (inflight.get(path) === request) urls.set(path, null);
      return null;
    } finally {
      if (inflight.get(path) === request) inflight.delete(path);
    }
  })();
  return request.promise;
}

/** The URL if it's already loaded, without starting a read. */
export const cachedPhotoURL = (product) => urls.get(product?.imagePath) || null;

function forget(path) {
  inflight.delete(path);
  const url = urls.get(path);
  if (url) URL.revokeObjectURL(url);
  urls.delete(path);
}

/** Remove a product's photo from the drive. Silent on failure. */
export async function deletePhoto(product) {
  const path = product?.imagePath;
  const drive = fs();
  if (!path || !drive || !ownPath(path)) return;
  forget(path);
  try {
    await drive.delete(path);
  } catch (err) {
    console.error('Deleting the photo failed', err);
  }
}
