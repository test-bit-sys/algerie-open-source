/**
 * Building and fixing up the document file itself, with pdf-lib.
 *
 * Two jobs. Building: several PDFs and images become one document, merged in
 * the order they were given, images one per page scaled to fit the paper.
 * Fixing up: reordering, rotating, and deleting pages of a DRAFT, which also
 * has to move the fields already placed on those pages.
 *
 * A page plan is the whole vocabulary: `[{ from, rotate }, ...]`, one entry
 * per page of the result, `from` indexing the CURRENT document and `rotate`
 * the quarter-turns to add. Every operation is one plan, so applying it to the
 * file (applyPagePlan) and to the fields (remapFields) can never disagree.
 */

/** US Letter, in points. Images become pages this size. */
export const LETTER = { w: 612, h: 792 };
const IMAGE_MARGIN = 24;

/** The plan that changes nothing: n pages, in order, unrotated. */
export function identityPlan(pageCount) {
  return Array.from({ length: pageCount }, (_, from) => ({ from, rotate: 0 }));
}

export function movePlan(pageCount, from, to) {
  const plan = identityPlan(pageCount);
  if (to < 0 || to >= pageCount || from === to) return plan;
  const [moved] = plan.splice(from, 1);
  plan.splice(to, 0, moved);
  return plan;
}

export function deletePlan(pageCount, index) {
  return identityPlan(pageCount).filter((entry) => entry.from !== index);
}

export function rotatePlan(pageCount, index, quarterTurns = 1) {
  return identityPlan(pageCount).map((entry) =>
    (entry.from === index ? { ...entry, rotate: ((quarterTurns * 90) % 360 + 360) % 360 } : entry));
}

/**
 * A field's rect after its page is rotated clockwise. Geometry is stored
 * against the RENDERED page (x right, y down, fractions), and pdf.js renders
 * with the page's own /Rotate applied — so turning the paper has to turn the
 * fields with it, or every signature line lands somewhere else.
 */
export function rotateRect(rect, degrees) {
  const turn = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  const { x, y, w, h } = rect;
  // A point (u, v) maps to (1 - v, u) per clockwise quarter-turn; the new
  // rect's top-left corner is the old one's bottom-left.
  if (turn === 90) return { x: 1 - y - h, y: x, w: h, h: w };
  if (turn === 180) return { x: 1 - x - w, y: 1 - y - h, w, h };
  if (turn === 270) return { x: y, y: 1 - x - w, w: h, h: w };
  return { x, y, w, h };
}

/**
 * The fields a plan leaves behind: those on a deleted page are dropped, the
 * rest follow their page to its new index and turn with it.
 */
export function remapFields(fields, plan) {
  const to = new Map();
  plan.forEach((entry, index) => to.set(entry.from, { index, rotate: entry.rotate || 0 }));
  return (fields || []).flatMap((field) => {
    const target = to.get(field.page);
    if (!target) return [];
    const rect = rotateRect(field, target.rotate);
    return [{ ...field, ...rect, page: target.index }];
  });
}

/** How many fields a plan would drop, for the confirm before it runs. */
export function fieldsLostBy(fields, plan) {
  const kept = new Set(plan.map((entry) => entry.from));
  return (fields || []).filter((field) => !kept.has(field.page)).length;
}

/* ---- The file itself ----------------------------------------------------- */

async function pdfLib() {
  return import('pdf-lib');
}

/**
 * Rebuild a PDF to match a page plan. Pages are copied into a fresh document
 * rather than deleted in place, so the result carries no trace of a page that
 * was removed.
 */
export async function applyPagePlan(bytes, plan) {
  const { PDFDocument, degrees } = await pdfLib();
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, plan.map((entry) => entry.from));
  copied.forEach((page, index) => {
    const add = plan[index].rotate || 0;
    if (add) page.setRotation(degrees((page.getRotation().angle + add) % 360));
    out.addPage(page);
  });
  return { bytes: await out.save(), pageCount: out.getPageCount() };
}

/** Bitmap types pdf-lib can embed directly. */
const DIRECT_IMAGE = /^image\/(png|jpeg|jpg)$/i;

/**
 * Anything else a browser can decode (HEIC on Apple devices, WebP, AVIF)
 * becomes a PNG first. Injected in tests, absent in node.
 */
async function defaultTranscode(file) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Draw one image as its own page, scaled to fit inside the paper. */
async function addImagePage(out, image) {
  const page = out.addPage([LETTER.w, LETTER.h]);
  const room = { w: LETTER.w - IMAGE_MARGIN * 2, h: LETTER.h - IMAGE_MARGIN * 2 };
  const scale = Math.min(room.w / image.width, room.h / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x: (LETTER.w - w) / 2, y: (LETTER.h - h) / 2, width: w, height: h });
}

/**
 * One PDF from several files, in the order given. `items` are
 * { name, type, bytes } — reading them is the caller's job, so this stays
 * testable without a File API. `onto` prepends an existing document.
 *
 * Rejects with a message naming the file at fault: a merge that silently
 * dropped a page would be worse than not merging at all.
 */
export async function mergeFiles(items, { onto = null, transcode = defaultTranscode } = {}) {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();

  if (onto) {
    const base = await PDFDocument.load(onto, { ignoreEncryption: true });
    const pages = await out.copyPages(base, base.getPageIndices());
    for (const page of pages) out.addPage(page);
  }

  for (const item of items) {
    const name = item.name || 'that file';
    const isPdf = /^application\/pdf$/i.test(item.type || '') || /\.pdf$/i.test(name);
    if (isPdf) {
      let source;
      try {
        source = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
      } catch {
        throw new Error(`${name} is not a readable PDF.`);
      }
      if (!source.getPageCount()) throw new Error(`${name} has no pages.`);
      const pages = await out.copyPages(source, source.getPageIndices());
      for (const page of pages) out.addPage(page);
      continue;
    }
    let image = null;
    try {
      if (DIRECT_IMAGE.test(item.type || '') || /\.(png|jpe?g)$/i.test(name)) {
        image = /png/i.test(item.type || '') || /\.png$/i.test(name)
          ? await out.embedPng(item.bytes)
          : await out.embedJpg(item.bytes);
      } else {
        const png = item.file && transcode ? await transcode(item.file) : null;
        if (!png) throw new Error('undecodable');
        image = await out.embedPng(png);
      }
    } catch {
      throw new Error(`${name} could not be read. Try a PDF, JPEG, or PNG.`);
    }
    await addImagePage(out, image);
  }

  const pageCount = out.getPageCount();
  if (!pageCount) throw new Error('Nothing to build a document from.');
  return { bytes: await out.save(), pageCount };
}

/** Page count and readability of one file, for the picker's own list. */
export async function inspectPdf(bytes) {
  const { PDFDocument } = await pdfLib();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getPageCount();
}
