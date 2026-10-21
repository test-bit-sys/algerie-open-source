/**
 * Thin wrapper around pdf.js for rendering pages to canvases. Kept in its own
 * module so nothing else transitively imports pdf.js (it needs browser
 * globals that tests don't have).
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Open a PDF from bytes. pdf.js TRANSFERS the buffer to its worker (detaching
 * the caller's copy), so hand it a copy: callers reuse the original bytes for
 * flattening and downloads.
 */
export async function openPdf(bytes) {
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice();
  return pdfjs.getDocument({ data }).promise;
}

/** A page's size in PDF points, for showing a field's size in real units. */
export async function pagePoints(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { w: viewport.width, h: viewport.height };
}

/** height / width of a page, for sizing placeholders before render. */
export async function pageAspect(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return viewport.height / viewport.width;
}

/**
 * Render page `pageNumber` (1-based) into `canvas` at `cssWidth` CSS pixels,
 * crisp on high-DPI screens. The canvas's display size is left to CSS (it
 * fills its page frame), so the page keeps tracking the frame through
 * resizes; only the backing store is sized here. Returns the CSS-pixel size
 * the backing store was drawn for.
 */
export async function renderPage(pdf, pageNumber, canvas, cssWidth) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const cssHeight = Math.round(viewport.height / dpr);
  const ctx = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: Math.round(cssWidth), height: cssHeight };
}
