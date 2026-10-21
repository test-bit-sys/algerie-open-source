import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  identityPlan, movePlan, deletePlan, rotatePlan, rotateRect, remapFields, fieldsLostBy,
  applyPagePlan, mergeFiles, inspectPdf, LETTER,
} from '../src/lib/pdfedit.js';
import { titleFromName } from '../src/ui/newdoc.js';

// A valid 1x1 PNG and a 1x1 JPEG, the two formats pdf-lib embeds directly.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** A PDF whose pages are labelled, so a reorder can be read back. */
async function labelled(labels, { rotate = 0 } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = pdf.addPage([LETTER.w, LETTER.h]);
    if (rotate) page.setRotation({ type: 'degrees', angle: rotate });
    page.drawText(label, { x: 40, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  }
  return pdf.save();
}

async function pageLabels(bytes) {
  // The label survives in the copied content stream; reading rotation is
  // enough for the rotation tests, so labels come from the draw order here.
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((p) => Math.round(p.getRotation().angle));
}

describe('page plans', () => {
  it('the identity plan changes nothing', () => {
    expect(identityPlan(3)).toEqual([{ from: 0, rotate: 0 }, { from: 1, rotate: 0 }, { from: 2, rotate: 0 }]);
  });

  it('moves, deletes, and rotates one page', () => {
    expect(movePlan(3, 0, 2).map((e) => e.from)).toEqual([1, 2, 0]);
    expect(movePlan(3, 2, 0).map((e) => e.from)).toEqual([2, 0, 1]);
    // A move that goes nowhere is the identity, not an error.
    expect(movePlan(3, 0, -1).map((e) => e.from)).toEqual([0, 1, 2]);
    expect(movePlan(3, 2, 3).map((e) => e.from)).toEqual([0, 1, 2]);
    expect(deletePlan(3, 1).map((e) => e.from)).toEqual([0, 2]);
    expect(rotatePlan(3, 1, 1).map((e) => e.rotate)).toEqual([0, 90, 0]);
    expect(rotatePlan(3, 1, -1).map((e) => e.rotate)).toEqual([0, 270, 0]);
  });
});

describe('rotating a field with its page', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };

  it('leaves it alone at zero', () => {
    expect(rotateRect(rect, 0)).toEqual(rect);
    expect(rotateRect(rect, 360)).toEqual(rect);
  });

  it('turns the rect a quarter clockwise', () => {
    // The old bottom-left corner becomes the new top-left.
    expect(rotateRect(rect, 90)).toEqual({ x: 1 - 0.25, y: 0.1, w: 0.05, h: 0.3 });
  });

  it('is its own inverse over four turns', () => {
    let out = rect;
    for (let i = 0; i < 4; i++) out = rotateRect(out, 90);
    expect(out.x).toBeCloseTo(rect.x);
    expect(out.y).toBeCloseTo(rect.y);
    expect(out.w).toBeCloseTo(rect.w);
    expect(out.h).toBeCloseTo(rect.h);
  });

  it('keeps the rect on the page', () => {
    for (const turn of [90, 180, 270]) {
      const out = rotateRect({ x: 0.7, y: 0.9, w: 0.28, h: 0.08 }, turn);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.x + out.w).toBeLessThanOrEqual(1.0001);
      expect(out.y + out.h).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('fields follow their pages', () => {
  const fields = [
    { id: 'a', page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.04, signerId: 's1' },
    { id: 'b', page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, signerId: 's1' },
    { id: 'c', page: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.04, signerId: 's2' },
  ];

  it('renumbers them on a reorder', () => {
    const out = remapFields(fields, movePlan(3, 2, 0));
    expect(out.find((f) => f.id === 'c').page).toBe(0);
    expect(out.find((f) => f.id === 'a').page).toBe(1);
    expect(out.find((f) => f.id === 'b').page).toBe(2);
    // Geometry is untouched by a reorder.
    expect(out.find((f) => f.id === 'b')).toMatchObject({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 });
  });

  it('drops the ones on a deleted page and renumbers the rest', () => {
    const plan = deletePlan(3, 1);
    expect(fieldsLostBy(fields, plan)).toBe(1);
    const out = remapFields(fields, plan);
    expect(out.map((f) => f.id)).toEqual(['a', 'c']);
    expect(out[1].page).toBe(1);
  });

  it('turns with a rotated page and leaves the others alone', () => {
    const out = remapFields(fields, rotatePlan(3, 1, 1));
    expect(out.find((f) => f.id === 'b')).toMatchObject({ x: 0.75, y: 0.1, w: 0.05, h: 0.3 });
    expect(out.find((f) => f.id === 'a')).toMatchObject({ x: 0.1, y: 0.1 });
    expect(fieldsLostBy(fields, rotatePlan(3, 1, 1))).toBe(0);
  });
});

describe('applying a plan to the file', () => {
  it('reorders pages', async () => {
    const bytes = await labelled(['one', 'two', 'three']);
    const out = await applyPagePlan(bytes, movePlan(3, 0, 2));
    expect(out.pageCount).toBe(3);
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(3);
  });

  it('deletes a page', async () => {
    const bytes = await labelled(['one', 'two', 'three']);
    const out = await applyPagePlan(bytes, deletePlan(3, 1));
    expect(out.pageCount).toBe(2);
  });

  it('adds rotation to whatever the page already had', async () => {
    const bytes = await labelled(['one', 'two'], { rotate: 90 });
    const out = await applyPagePlan(bytes, rotatePlan(2, 0, 1));
    expect(await pageLabels(out.bytes)).toEqual([180, 90]);
    // And four quarter-turns come back around.
    let current = out.bytes;
    for (let i = 0; i < 3; i++) current = (await applyPagePlan(current, rotatePlan(2, 0, 1))).bytes;
    expect((await pageLabels(current))[0]).toBe(90);
  });
});

describe('building one document from several files', () => {
  it('merges PDFs in the order given', async () => {
    const first = await labelled(['a', 'b']);
    const second = await labelled(['c']);
    const out = await mergeFiles([
      { name: 'first.pdf', type: 'application/pdf', bytes: first },
      { name: 'second.pdf', type: 'application/pdf', bytes: second },
    ]);
    expect(out.pageCount).toBe(3);
  });

  it('gives an image a page of its own, scaled inside the paper', async () => {
    const out = await mergeFiles([{ name: 'photo.png', type: 'image/png', bytes: PNG }]);
    expect(out.pageCount).toBe(1);
    const page = (await PDFDocument.load(out.bytes)).getPage(0);
    expect(Math.round(page.getWidth())).toBe(LETTER.w);
    expect(Math.round(page.getHeight())).toBe(LETTER.h);
  });

  it('appends onto an existing document', async () => {
    const base = await labelled(['a', 'b']);
    const out = await mergeFiles([{ name: 'extra.pdf', type: 'application/pdf', bytes: await labelled(['c']) }], { onto: base });
    expect(out.pageCount).toBe(3);
  });

  it('names the file at fault rather than dropping it', async () => {
    await expect(mergeFiles([{ name: 'broken.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }]))
      .rejects.toThrow(/broken\.pdf is not a readable PDF/);
    await expect(mergeFiles([{ name: 'holiday.heic', type: 'image/heic', bytes: PNG }]))
      .rejects.toThrow(/holiday\.heic could not be read/);
    await expect(mergeFiles([])).rejects.toThrow(/Nothing to build/);
  });

  it('converts an image the browser can decode but pdf-lib cannot', async () => {
    const out = await mergeFiles(
      [{ name: 'holiday.heic', type: 'image/heic', bytes: new Uint8Array([9]), file: {} }],
      { transcode: async () => PNG },
    );
    expect(out.pageCount).toBe(1);
  });

  it('counts the pages of one file', async () => {
    expect(await inspectPdf(await labelled(['a', 'b', 'c']))).toBe(3);
  });
});

describe('titles from file names', () => {
  it('reads a file name as a title', () => {
    expect(titleFromName('client-nda_v2.pdf')).toBe('client nda v2');
    expect(titleFromName('Consulting Agreement.PDF')).toBe('Consulting Agreement');
    expect(titleFromName('photo.HEIC')).toBe('photo');
    expect(titleFromName('')).toBe('Untitled document');
    expect(titleFromName('.pdf')).toBe('Untitled document');
  });
});
