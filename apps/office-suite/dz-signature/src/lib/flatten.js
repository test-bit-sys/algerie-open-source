/**
 * Building the completed PDF with pdf-lib: field values are drawn onto the
 * original pages, and a signature certificate page is appended, the audit
 * trail a completed document carries with it. Runs in the browser (app and
 * sign page) and in node (tests).
 */

import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { toPdfRect, isFieldComplete, displayValue, auditLabel, signerStatusMeta } from './model.js';
import { formatDateTime } from './util.js';
import { evidenceLine, stampWithOffset, groupHex, DISCLOSURE_TITLE } from './consent.js';

const INK = rgb(0.08, 0.08, 0.12);
const MUTED = rgb(0.42, 0.42, 0.47);
const HAIRLINE = rgb(0.85, 0.85, 0.83);

/**
 * pdf-lib's standard fonts encode WinAnsi only; any character outside it
 * makes width measurement and drawing throw, which used to fail the whole
 * build over one CJK/emoji character in a title, name, or field value.
 * Keep what WinAnsi can show and stand in '?' for the rest (one '?' per
 * code point, so an emoji doesn't become two).
 */
const WINANSI_CHAR = /[\x20-\x7e\xa0-\xffŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]/;

function winAnsi(value) {
  let out = '';
  for (const ch of String(value).replace(/[\r\n\t\f\v]+/g, ' ')) {
    out += WINANSI_CHAR.test(ch) ? ch : '?';
  }
  return out;
}

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function embedImage(pdf, dataUrl) {
  const bytes = dataUrlBytes(dataUrl);
  if (dataUrl.startsWith('data:image/jpeg')) return pdf.embedJpg(bytes);
  return pdf.embedPng(bytes);
}

/** Largest font size (capped) at which `text` fits the box on one line. */
function fitFontSize(font, text, w, h, cap = 14) {
  let size = Math.min(cap, h * 0.72);
  while (size > 4 && font.widthOfTextAtSize(text, size) > w - 4) size -= 0.5;
  return size;
}

/**
 * How many leading characters of `text` fit `room`, found by bisection: a
 * 2000-character value walked back one character at a time takes seconds.
 */
function prefixThatFits(font, text, room, size) {
  if (font.widthOfTextAtSize(text, size) <= room) return text.length;
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid), size) <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * `text` as lines no wider than `room`, broken on spaces where there are any
 * and mid-word where there are not (a URL, an address with no spaces). At most
 * `maxLines` of them; `rest` is whatever did not fit, so a caller can tell a
 * value that ran out of room from one that fitted exactly.
 */
function wrapToWidth(font, text, room, size, maxLines = Infinity) {
  const lines = [];
  let rest = text.trim();
  while (rest.length && lines.length < maxLines) {
    const fits = prefixThatFits(font, rest, room, size);
    let take = rest.slice(0, fits);
    if (fits < rest.length) {
      // Prefer a space inside the part that fits; mid-word only if there is none.
      const space = take.lastIndexOf(' ');
      if (space > 0) take = take.slice(0, space);
    }
    lines.push(take);
    rest = rest.slice(take.length).trimStart();
  }
  return { lines, rest };
}

/** `text` cut short enough that it and an ellipsis fit `room`. */
function withEllipsis(font, text, room, size) {
  let base = text;
  while (base.length > 1 && font.widthOfTextAtSize(`${base}…`, size) > room) {
    base = base.slice(0, -1);
  }
  return `${base}…`;
}

/**
 * How a text value is drawn inside its box: on one line at the largest size
 * that fits, exactly as it always was, and failing that wrapped over as many
 * lines as the box has room for. A value too long even for that is cut with an
 * ellipsis, because a field whose text ran across the page — over the
 * document's own words — was worse than a field that ran out of room, and at
 * 4pt on one 400-point line it could not be read anyway.
 */
function layoutText(font, text, w, h, cap = 14) {
  const room = w - 4;
  const single = fitFontSize(font, text, w, h, cap);
  if (font.widthOfTextAtSize(text, single) <= room) return { lines: [text], size: single };
  const rowsAt = (size) => Math.max(1, Math.floor(h / (size * 1.2)));
  for (let size = Math.min(cap, h * 0.72); size >= 4.5; size -= 0.5) {
    const { lines, rest } = wrapToWidth(font, text, room, size, rowsAt(size));
    if (!rest) return { lines, size };
  }
  const size = 4;
  const { lines, rest } = wrapToWidth(font, text, room, size, rowsAt(size));
  if (rest) lines[lines.length - 1] = withEllipsis(font, lines[lines.length - 1], room, size);
  return { lines, size };
}

/** The page area and orientation the signer saw in pdf.js. */
function visiblePageSpace(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  // pdf.js renders the intersection, falling back to the MediaBox if empty.
  const { x, y, width: w, height: h } = right > left && top > bottom
    ? { x: left, y: bottom, width: right - left, height: top - bottom }
    : media;
  const angle = (page.getRotation().angle % 360 + 360) % 360;
  // Map upright, visible-page coordinates back into the PDF's coordinate
  // system. Applying this to the whole field keeps images, ticks, and text
  // in the same position and orientation as the signing overlay.
  if (angle === 90) return { w: h, h: w, matrix: [0, 1, -1, 0, x + w, y] };
  if (angle === 180) return { w, h, matrix: [-1, 0, 0, -1, x + w, y + h] };
  if (angle === 270) return { w: h, h: w, matrix: [0, -1, 1, 0, x, y + h] };
  return { w, h, matrix: [1, 0, 0, 1, x, y] };
}

/**
 * Draw every completed field value onto its page. `values` maps field id to
 * the stored value ({ kind: 'image', data } | string | boolean). A field the
 * SENDER filled in falls back to that value, so read-only fields land on the
 * page even though no signer ever submitted them. Malformed values are
 * skipped rather than failing the whole document.
 */
export async function drawValues(pdf, fields, values) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const field of fields || []) {
    const value = displayValue(field, values);
    if (!isFieldComplete(field, value)) continue;
    const pages = pdf.getPages();
    const page = pages[field.page];
    if (!page) continue;
    const space = visiblePageSpace(page);
    const rect = toPdfRect(field, space.w, space.h);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...space.matrix));
    try {
      if (field.type === 'signature' || field.type === 'initials') {
        const image = await embedImage(pdf, value.data);
        const scale = Math.min(rect.w / image.width, rect.h / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, {
          x: rect.x + (rect.w - w) / 2,
          y: rect.y + (rect.h - h) / 2,
          width: w,
          height: h,
        });
      } else if (field.type === 'checkbox') {
        if (value === true) {
          const s = Math.min(rect.w, rect.h);
          const x = rect.x + (rect.w - s) / 2;
          const y = rect.y + (rect.h - s) / 2;
          const t = Math.max(1.2, s * 0.12);
          page.drawLine({
            start: { x: x + s * 0.15, y: y + s * 0.5 },
            end: { x: x + s * 0.42, y: y + s * 0.22 },
            thickness: t, color: INK,
          });
          page.drawLine({
            start: { x: x + s * 0.42, y: y + s * 0.22 },
            end: { x: x + s * 0.85, y: y + s * 0.78 },
            thickness: t, color: INK,
          });
        }
      } else {
        const { lines, size } = layoutText(font, winAnsi(value), rect.w, rect.h);
        if (lines.length === 1) {
          page.drawText(lines[0], {
            x: rect.x + 2,
            y: rect.y + (rect.h - size * 0.72) / 2,
            size,
            font,
            color: INK,
          });
        } else {
          // The block sits centred in the box, first line at the top.
          const step = size * 1.2;
          let y = rect.y + rect.h - (rect.h - lines.length * step) / 2 - size;
          for (const line of lines) {
            page.drawText(line, { x: rect.x + 2, y, size, font, color: INK });
            y -= step;
          }
        }
      }
    } catch {
      /* skip a field that can't be drawn; the rest of the document stands */
    } finally {
      page.pushOperators(popGraphicsState());
    }
  }
}

/** Append the signature certificate page(s). */
export async function appendCertificate(pdf, doc) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 56;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const line = (text, { size = 10.5, useFont = font, color = INK, gap = 7 } = {}) => {
    if (y < M + size) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
    // Wrapped the same way a field's value is, mid-word included: a decline
    // reason with a long URL in it would otherwise be drawn as one line that
    // runs off the paper — and this page is the record of what happened.
    const { lines } = wrapToWidth(useFont, winAnsi(text), W - M * 2, size);
    for (const piece of lines) {
      page.drawText(piece, { x: M, y: y - size, size, font: useFont, color });
      y -= size + gap;
      if (y < M) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
    }
  };
  const rule = () => {
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: HAIRLINE });
    y -= 16;
  };

  line('Signature certificate', { size: 20, useFont: bold, gap: 12 });
  line(doc.title || 'Untitled document', { size: 13, useFont: bold, gap: 10 });
  line(`Document ID ${doc.id} · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`, { color: MUTED });
  if (doc.completedAt) line(`Completed ${formatDateTime(doc.completedAt)}`, { color: MUTED });
  if (doc.signOrder) {
    line('Signed sequentially: each link opened only after the signer before it had signed', { color: MUTED });
  }
  // The fingerprint of the file signers were served, so this copy can be tied
  // to exactly those bytes. Grouped: a 64-character digest has no space to
  // wrap on.
  if (doc.fingerprint && doc.fingerprint.hex) {
    line(`Original ${doc.fingerprint.alg || 'SHA-256'} fingerprint`, { color: MUTED, gap: 3 });
    line(groupHex(doc.fingerprint.hex), { size: 9.5, color: MUTED, gap: 4 });
    line('Recompute this digest over the original PDF to confirm it is the file that was signed.',
      { size: 9, color: MUTED });
  }
  rule();

  line(doc.signOrder ? 'Signers, in signing order' : 'Signers', { size: 12, useFont: bold, gap: 10 });
  const signerList = doc.signers || [];
  for (const [index, signer] of signerList.entries()) {
    const position = doc.signOrder ? `${index + 1}. ` : '';
    line(`${position}${signer.name || signer.email || 'Signer'}${signer.email ? ` <${signer.email}>` : ''}`, { useFont: bold, gap: 4 });
    const meta = signerStatusMeta(signer.status);
    const evidence = signer.evidence || {};
    const act = signer.signedAt ? evidence.sign : signer.declinedAt ? evidence.decline : null;
    const when = signer.signedAt ? ` on ${stampWithOffset(signer.signedAt, act)}`
      : signer.declinedAt ? ` on ${stampWithOffset(signer.declinedAt, act)}` : '';
    line(`${meta.label}${when}`, { color: MUTED, gap: 4 });
    // What makes the signature defensible: that the disclosure was agreed to,
    // and the technical context of the act itself.
    if (signer.consentAt) {
      line(`Agreed to sign electronically on ${stampWithOffset(signer.consentAt, evidence.consent)}`
        + `${signer.consentVersion ? ` · ${DISCLOSURE_TITLE} v${signer.consentVersion}` : ''}`,
      { size: 9.5, color: MUTED, gap: 4 });
    }
    const context = evidenceLine(act) || evidenceLine(evidence.consent) || evidenceLine(evidence.view);
    if (context) line(context, { size: 9.5, color: MUTED, gap: 4 });
    if (signer.viewedAt) {
      line(`First opened ${formatDateTime(signer.viewedAt)}`, { size: 9.5, color: MUTED, gap: 4 });
    }
    if (signer.declineReason) line(`Reason: ${signer.declineReason}`, { color: MUTED, gap: 4 });
    y -= 8;
  }
  rule();

  line('Activity', { size: 12, useFont: bold, gap: 10 });
  for (const event of (doc.audit || []).slice(-40)) {
    line(`${formatDateTime(event.at)}  ${auditLabel(event)}`, { size: 9.5, color: MUTED, gap: 5 });
  }

  y = M - 14;
  page.drawText('Generated by Signatures, powered by Puter', {
    x: M, y: M - 30, size: 8.5, font, color: MUTED,
  });
}

/**
 * The completed copy: original pages with every value drawn in, plus the
 * certificate. Returns PDF bytes.
 */
export async function buildSignedPdf(originalBytes, doc, values, { certificate = true } = {}) {
  const pdf = await PDFDocument.load(originalBytes);
  await drawValues(pdf, doc.fields, values);
  if (certificate) await appendCertificate(pdf, doc);
  pdf.setTitle(`${doc.title || 'Document'} (signed)`);
  return pdf.save();
}
