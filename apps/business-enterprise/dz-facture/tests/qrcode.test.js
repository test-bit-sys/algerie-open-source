/**
 * DZ-Facture unit tests — Real QR-Code & Code 128 generators.
 * These structural checks prove the codes follow the ISO/IEC 18004 and
 * GS1 Code-128 specifications (the old decorative pseudo-random matrix
 * would have failed every single one of them).
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { QRCodeSVG, encodeCode128B } from '../src/modules/qrcode.js';

test('QR version auto-selection produces the correct ISO matrix size', () => {
  assert.equal(QRCodeSVG.generateMatrix('DZ').size, 21);            // v1 → 21×21
  assert.equal(QRCodeSVG.generateMatrix('A'.repeat(60)).size, 33);  // v4 → 33×33
  assert.equal(QRCodeSVG.generateMatrix('A'.repeat(100)).size, 41); // v6 → 41×41
  assert.equal(QRCodeSVG.generateMatrix('A'.repeat(115)).size, 45); // v7 → 45×45
});

test('the three finder patterns exist with light separators', () => {
  const { size, matrix } = QRCodeSVG.generateMatrix('DZ-Facture');
  assert.equal(matrix[0][0], 1);            // top-left corner
  assert.equal(matrix[3][3], 1);            // top-left center
  assert.equal(matrix[0][size - 1], 1);     // top-right corner
  assert.equal(matrix[size - 1][0], 1);     // bottom-left corner
  assert.equal(matrix[0][7], 0);            // separator column
  assert.equal(matrix[7][0], 0);            // separator row
  assert.equal(matrix[3][3 + 1], 1);        // finder ring is dark
});

test('timing patterns strictly alternate dark/light', () => {
  const { size, matrix } = QRCodeSVG.generateMatrix('DZ-Facture');
  for (let i = 8; i < size - 8; i++) {
    assert.equal(matrix[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(matrix[i][6], i % 2 === 0 ? 1 : 0);
  }
});

test('dark module exists at (size-8, 8) as mandated by the spec', () => {
  const { size, matrix } = QRCodeSVG.generateMatrix('DZ-Facture');
  assert.equal(matrix[size - 8][8], 1);
});

test('matrix is fully binary and deterministic (same input ⇒ same output)', () => {
  const a = QRCodeSVG.generateMatrix('DZ-Facture & POS');
  const b = QRCodeSVG.generateMatrix('DZ-Facture & POS');
  assert.deepEqual(a.matrix, b.matrix);
  a.matrix.forEach((row) => row.forEach((v) => assert.ok(v === 0 || v === 1, 'no null/undefined cells left')));
  const c = QRCodeSVG.generateMatrix('Different payload 12345');
  assert.notDeepEqual(a.matrix, c.matrix);
});

test('generateSVG emits a clean SVG with quiet zone and many modules', () => {
  const svg = QRCodeSVG.generateSVG('DZ-Facture', 120);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('shape-rendering'));
  const rectCount = (svg.match(/<rect /g) || []).length;
  assert.ok(rectCount > 100, `a real QR has >100 dark modules, got ${rectCount}`);
});

test('Code 128-B: Start B (104), mod-103 checksum, Stop (106)', () => {
  assert.deepEqual(encodeCode128B('ABC'), [104, 33, 34, 35, 1, 106]);
  // checksum = (104 + 33×1 + 34×2 + 35×3) mod 103 = 310 mod 103 = 1
  assert.equal(encodeCode128B('')[0], 104);
  assert.equal(encodeCode128B('X').at(-1), 106);

  const codes = encodeCode128B('6131234567890');
  let expected = 104;
  [...'6131234567890'].forEach((ch, i) => {
    expected += (ch.charCodeAt(0) - 32) * (i + 1);
  });
  assert.equal(codes.at(-2), expected % 103);
});

test('Code 128 barcode SVG renders bars plus the human-readable text', () => {
  const svg = QRCodeSVG.generateBarcodeSVG('6131234567890', 210, 60);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('6131234567890'));
  const rectCount = (svg.match(/<rect /g) || []).length;
  assert.ok(rectCount > 30, `a 13-char Code128 needs >30 bars, got ${rectCount}`);
  assert.ok(svg.includes('6131234567890</text>'));
});
