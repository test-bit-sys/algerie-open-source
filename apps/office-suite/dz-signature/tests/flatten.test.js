import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildSignedPdf } from '../src/lib/flatten.js';

/** pdf-lib flate-encodes content streams; this is what they say. */
function contentStreams(bytes) {
  const buf = Buffer.from(bytes);
  let out = '';
  let at = 0;
  for (;;) {
    const start = buf.indexOf('stream', at);
    if (start < 0) break;
    const end = buf.indexOf('endstream', start);
    if (end < 0) break;
    const body = buf.subarray(start + 6, end);
    try {
      out += inflateSync(body.subarray(body.findIndex((b) => b !== 0x0d && b !== 0x0a))).toString('latin1');
    } catch {
      out += body.toString('latin1');
    }
    at = end + 9;
  }
  return out;
}

const fromHex = (digits) => {
  let text = '';
  for (let i = 0; i + 1 < digits.length; i += 2) {
    text += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
  }
  return text;
};

/**
 * Every string the document draws, with the font and size it was drawn at, in
 * order: what a reader sees as one line on the page. pdf-lib names its font
 * resources after the font ("/Helvetica-Bold-7098480789"), so the name says
 * which metrics to measure a line against.
 */
function drawnLines(bytes) {
  const stream = contentStreams(bytes);
  const lines = [];
  let size = 0;
  let bold = false;
  let x = 0;
  let y = 0;
  const ops = /\/([A-Za-z0-9+._-]+)\s+([\d.]+)\s+Tf|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|<([0-9A-Fa-f\s]*)>\s*Tj/g;
  for (let hit = ops.exec(stream); hit; hit = ops.exec(stream)) {
    if (hit[2]) {
      size = Number(hit[2]);
      bold = /bold/i.test(hit[1]);
    } else if (hit[4] !== undefined) {
      x = Number(hit[3]);
      y = Number(hit[4]);
    } else {
      lines.push({ text: fromHex(hit[5].replace(/\s+/g, '')), size, bold, x, y });
    }
  }
  return lines;
}

/**
 * The text a reader would see: pdf-lib flate-encodes content streams, so the
 * drawn strings only show up after inflating them.
 */
function pdfText(bytes) {
  const out = contentStreams(bytes);
  // Strings reach the content stream either literal ("(text) Tj") or, as
  // pdf-lib writes them, hex ("<74657874> Tj"). Normalize both to text.
  return out
    .replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex) => fromHex(hex.replace(/\s+/g, '')))
    .replace(/\\([()\\])/g, '$1');
}

// A valid 1x1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function onePagePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  return pdf.save();
}

function doc(overrides = {}) {
  return {
    id: 'd1',
    title: 'Mutual NDA',
    pageCount: 1,
    status: 'completed',
    completedAt: Date.now(),
    signers: [
      { id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'signed', signedAt: Date.now() },
    ],
    fields: [
      { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.06, required: true },
      { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.7, w: 0.3, h: 0.03, required: true },
      { id: 'f3', signerId: 's1', type: 'date', page: 0, x: 0.1, y: 0.6, w: 0.2, h: 0.03, required: true },
      { id: 'f4', signerId: 's1', type: 'checkbox', page: 0, x: 0.1, y: 0.5, w: 0.03, h: 0.023, required: false },
    ],
    audit: [
      { at: Date.now() - 1000, type: 'sent', detail: '1 signer' },
      { at: Date.now(), type: 'signed', detail: 'Ava Chen' },
    ],
    ...overrides,
  };
}

const values = {
  f1: { kind: 'image', data: PNG },
  f2: 'Ava Chen',
  f3: 'Aug 17, 2026',
  f4: true,
};

describe('buildSignedPdf', () => {
  it('does not restore a preset that the signer explicitly cleared', async () => {
    const field = { ...doc().fields[1], required: false, preset: 'Acme Inc' };
    const original = await onePagePdf();
    const cleared = await buildSignedPdf(original, doc({ fields: [field] }), { f2: '' }, { certificate: false });
    expect(pdfText(cleared)).not.toContain('Acme Inc');
    const untouched = await buildSignedPdf(original, doc({ fields: [field] }), {}, { certificate: false });
    expect(pdfText(untouched)).toContain('Acme Inc');
  });

  it('draws values and appends a certificate page', async () => {
    const bytes = await buildSignedPdf(await onePagePdf(), doc(), values);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2); // original + certificate
    expect(out.getTitle()).toBe('Mutual NDA (signed)');
  });

  it('can skip the certificate', async () => {
    const bytes = await buildSignedPdf(await onePagePdf(), doc(), values, { certificate: false });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it('survives malformed values instead of failing the document', async () => {
    const broken = { ...values, f1: { kind: 'image', data: 'data:image/png;base64,!!notbase64' } };
    const bytes = await buildSignedPdf(await onePagePdf(), doc(), broken);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('ignores fields on pages that do not exist', async () => {
    const offPage = doc();
    offPage.fields = [{ id: 'f9', signerId: 's1', type: 'text', page: 7, x: 0.1, y: 0.1, w: 0.2, h: 0.03 }];
    const bytes = await buildSignedPdf(await onePagePdf(), offPage, { f9: 'ghost' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('wraps a long value inside its field box instead of across the page', async () => {
    // 4pt on one 363-point line, in a 159-point box, over whatever the
    // document itself says there.
    const long = 'Please note that the address on file is 4821 Meridian Avenue, Suite 300, '
      + 'and correspondence should go to the attention of the operations team rather '
      + 'than the front desk, as agreed on the call last Thursday.';
    const field = { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.5, w: 0.26, h: 0.032, required: true };
    const bytes = await buildSignedPdf(await onePagePdf(), doc({ fields: [field] }), { f2: long }, { certificate: false });
    const font = await (await PDFDocument.load(bytes)).embedFont(StandardFonts.Helvetica);
    const box = { x: field.x * 612, y: (1 - field.y - field.h) * 792, w: field.w * 612, h: field.h * 792 };
    const drawn = drawnLines(bytes);
    expect(drawn.length).toBeGreaterThan(1); // wrapped, not one long line
    for (const line of drawn) {
      const width = font.widthOfTextAtSize(line.text, line.size);
      expect(line.x).toBeGreaterThanOrEqual(box.x);
      expect(line.x + width).toBeLessThanOrEqual(box.x + box.w + 0.5);
      expect(line.y).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(line.y + line.size).toBeLessThanOrEqual(box.y + box.h + 0.5);
    }
    // And readable rather than shrunk to the floor to fit one line.
    expect(Math.min(...drawn.map((line) => line.size))).toBeGreaterThan(4);
    expect(drawn.map((line) => line.text).join(' ')).toContain('4821 Meridian Avenue');
  });

  it('marks a value too long for its box rather than spilling it', async () => {
    const field = { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.5, w: 0.12, h: 0.02, required: true };
    const bytes = await buildSignedPdf(await onePagePdf(), doc({ fields: [field] }), { f2: 'x'.repeat(2000) },
      { certificate: false });
    const drawn = drawnLines(bytes);
    const box = { x: field.x * 612, y: (1 - field.y - field.h) * 792, w: field.w * 612, h: field.h * 792 };
    // WinAnsi encodes the ellipsis as 0x85, which is what lands in the stream.
    expect(drawn.at(-1).text).toMatch(/[…\u0085]$/);
    for (const line of drawn) {
      expect(line.y).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(line.y + line.size).toBeLessThanOrEqual(box.y + box.h + 0.5);
    }
  });

  it('leaves a value that already fits exactly where it was', async () => {
    const field = { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.5, w: 0.26, h: 0.032, required: true };
    const bytes = await buildSignedPdf(await onePagePdf(), doc({ fields: [field] }), { f2: 'Ava Chen' },
      { certificate: false });
    const drawn = drawnLines(bytes);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].size).toBe(14);
    expect(drawn[0].x).toBeCloseTo(0.1 * 612 + 2, 5);
    expect(drawn[0].y).toBeCloseTo((1 - 0.5 - 0.032) * 792 + (0.032 * 792 - 14 * 0.72) / 2, 5);
  });

  it('degrades non-WinAnsi characters instead of failing the build', async () => {
    const intl = doc({ title: '业务合同 🎉' });
    intl.signers = [{ id: 's1', name: '田中太郎', email: 'taro@example.com', status: 'signed', signedAt: Date.now() }];
    const bytes = await buildSignedPdf(await onePagePdf(), intl, { ...values, f2: 'Beijing 北京' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('draws the value the sender filled in when no signer submitted one', async () => {
    const prefilled = doc();
    prefilled.fields = [
      { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.7, w: 0.4, h: 0.03, required: true, readOnly: true, preset: 'Acme Incorporated' },
    ];
    // Nothing in `values`: a read-only field is never submitted by a signer.
    const bytes = await buildSignedPdf(await onePagePdf(), prefilled, {}, { certificate: false });
    expect(pdfText(bytes)).toContain('Acme Incorporated');
  });

  it('a submitted value beats the sender\'s prefill', async () => {
    const prefilled = doc();
    prefilled.fields = [
      { id: 'f2', signerId: 's1', type: 'text', page: 0, x: 0.1, y: 0.7, w: 0.4, h: 0.03, required: true, preset: 'Acme Incorporated' },
    ];
    const text = pdfText(
      await buildSignedPdf(await onePagePdf(), prefilled, { f2: 'Other Limited' }, { certificate: false }));
    expect(text).toContain('Other Limited');
    expect(text).not.toContain('Acme Incorporated');
  });

  it('numbers the signers when the document was signed in order', async () => {
    const seq = doc({ signOrder: true });
    seq.signers = [
      { id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'signed', signedAt: 1 },
      { id: 's2', name: 'Bo Diaz', email: 'bo@example.com', status: 'signed', signedAt: 2 },
    ];
    const text = pdfText(await buildSignedPdf(await onePagePdf(), seq, values));
    expect(text).toContain('Signers, in signing order');
    expect(text).toContain('1. Ava Chen');
    expect(text).toContain('2. Bo Diaz');
  });

  it('prints the consent, the context, and the file fingerprint', async () => {
    const evidenced = doc({
      fingerprint: { alg: 'SHA-256', hex: 'ab'.repeat(32), at: Date.now() },
    });
    evidenced.signers = [{
      id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'signed',
      signedAt: Date.parse('2026-08-20T21:41:00Z'),
      viewedAt: Date.parse('2026-08-20T21:30:00Z'),
      consentAt: Date.parse('2026-08-20T21:31:00Z'),
      consentVersion: '1',
      evidence: {
        consent: { at: 1, ip: '203.0.113.7', ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0', tzOffset: -420 },
        sign: { at: 2, ip: '203.0.113.7', ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0', tzOffset: -420 },
      },
    }];
    const text = pdfText(await buildSignedPdf(await onePagePdf(), evidenced, values));
    expect(text).toContain('Agreed to sign electronically');
    expect(text).toContain('Signing electronically v1');
    expect(text).toContain('203.0.113.7 · Firefox 130 on Windows');
    expect(text).toContain("signer's clock UTC-07:00");
    expect(text).toContain('Original SHA-256 fingerprint');
    // Grouped in eights so a 64-character digest can wrap.
    expect(text).toContain('abababab abababab');
    expect(text).toContain('First opened');
  });

  it('keeps a reason with no spaces in it inside the page', async () => {
    // The certificate is the record of what happened: a decline reason with a
    // long URL in it used to be drawn as one line twice the width of the
    // paper, with everything past the edge simply not there.
    const reason = `https://example.com/legal/why-i-cannot-sign?ref=${'x'.repeat(140)}`;
    const bytes = await buildSignedPdf(await onePagePdf(), doc({
      signers: [{
        id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'declined',
        declinedAt: Date.now(), declineReason: reason,
      }],
    }), values);
    const out = await PDFDocument.load(bytes);
    const font = await out.embedFont(StandardFonts.Helvetica);
    const boldFont = await out.embedFont(StandardFonts.HelveticaBold);
    const column = 612 - 56 * 2;
    const lines = drawnLines(bytes);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) {
      expect(line.size).toBeGreaterThan(0);
      const width = (line.bold ? boldFont : font).widthOfTextAtSize(line.text, line.size);
      expect(width).toBeLessThanOrEqual(column);
    }
    // Broken up, not thrown away: the pieces still spell out the whole reason.
    expect(lines.map((line) => line.text).join('')).toContain(reason);
  });

  it('a long audit trail flows onto extra certificate pages', async () => {
    const busy = doc();
    busy.audit = Array.from({ length: 40 }, (_, i) => ({ at: i, type: 'viewed', detail: `Signer ${i}` }));
    busy.signers = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, name: `Signer Number ${i}`, email: `s${i}@example.com`, status: 'signed', signedAt: i,
    }));
    const bytes = await buildSignedPdf(await onePagePdf(), busy, values);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
});
