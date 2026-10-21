// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildSignedPdf } from '../src/lib/flatten.js';

const fields = [
  { id: 'first', type: 'text', page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.08 },
  { id: 'second', type: 'text', page: 0, x: 0.6, y: 0.7, w: 0.3, h: 0.08 },
];

describe('flattened field placement matches the signing preview', () => {
  for (const angle of [0, 90, 180, 270]) {
    it.each(['full page', 'cropped page', 'offset media box', 'disjoint crop'])(`${angle} degrees, %s`, async (box) => {
      const source = await PDFDocument.create();
      const original = source.addPage([612, 792]);
      original.setRotation(degrees(angle));
      if (box === 'cropped page') original.setCropBox(40, 60, 480, 650);
      if (box === 'offset media box') {
        original.setMediaBox(20, -30, 612, 792);
        original.setCropBox(0, 0, 500, 700);
      }
      if (box === 'disjoint crop') original.setCropBox(700, 900, 100, 100);
      const bytes = await buildSignedPdf(await source.save(), {
        title: 'Placement', fields, signers: [],
      }, { first: 'First', second: 'Second' }, { certificate: false });

      // Parse the exported PDF with the same renderer as the signing page,
      // including its effective CropBox and rotation. Test visible positions,
      // not the PDF writer's internal coordinates.
      const pdf = await getDocument({ data: bytes, verbosity: 0 }).promise;
      try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent();
        for (const field of fields) {
          const item = text.items.find((entry) => entry.str.toLowerCase() === field.id);
          expect(item).toBeDefined();
          const [a, b, c, d, x, y] = Util.transform(viewport.transform, item.transform);
          expect(x).toBeGreaterThanOrEqual(field.x * viewport.width);
          expect(x + item.width).toBeLessThanOrEqual((field.x + field.w) * viewport.width);
          expect(y).toBeGreaterThanOrEqual(field.y * viewport.height);
          expect(y).toBeLessThanOrEqual((field.y + field.h) * viewport.height);
          // Text must read horizontally and upright, just as in the preview.
          expect(a).toBeGreaterThan(0);
          expect(b).toBeCloseTo(0);
          expect(c).toBeCloseTo(0);
          expect(d).toBeLessThan(0);
        }
      } finally {
        await pdf.destroy();
      }
    });
  }
});
