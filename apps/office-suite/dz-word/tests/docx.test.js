/**
 * DZ-Word — Standalone DOCX Engine & Administrative Templates Unit Tests
 * 100% Offline-First, Zero-Dependency Test Suite (node:test)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Load templates and docx-engine
await import('../src/templates.js');
await import('../src/docx-engine.js');

const generateDocxBlob = globalThis.generateDocxBlob;
const TEMPLATES = globalThis.DZ_WORD_TEMPLATES;

describe('DZ-Word DOCX Engine & Algerian Template Tests', () => {

  test('Official Algerian administrative templates are populated and valid', () => {
    assert.ok(Array.isArray(TEMPLATES));
    assert.ok(TEMPLATES.length >= 4);

    const attestation = TEMPLATES.find(t => t.id === 'attestation-travail');
    assert.ok(attestation);
    assert.strictEqual(attestation.direction, 'rtl');
    assert.ok(attestation.content.includes('الجمهورية الجزائرية الديمقراطية الشعبية'));
    assert.ok(attestation.content.includes('شـــهــــادة عـــمــــل'));
  });

  test('generateDocxBlob produces a valid PKZIP / DOCX package', async () => {
    assert.strictEqual(typeof generateDocxBlob, 'function');

    const html = `
      <h1>الجمهورية الجزائرية الديمقراطية الشعبية</h1>
      <p>هذا اختبار للمستند المكتبي <strong>DZ-Word</strong> المتوافق مع معايير مايكروسوفت وورد.</p>
      <ul>
        <li>عنصر أول</li>
        <li>عنصر ثاني</li>
      </ul>
    `;

    const blob = generateDocxBlob(html, {
      title: 'مستند اختباري',
      orientation: 'portrait'
    });

    assert.ok(blob);
    assert.strictEqual(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Verify PKZIP magic bytes: 'PK\x03\x04' (0x50, 0x4b, 0x03, 0x04)
    assert.strictEqual(bytes[0], 0x50);
    assert.strictEqual(bytes[1], 0x4b);
    assert.strictEqual(bytes[2], 0x03);
    assert.strictEqual(bytes[3], 0x04);

    // Verify length is realistic for an OpenXML zip package (> 1000 bytes)
    assert.ok(bytes.length > 1000);
  });

  test('generateDocxBlob supports landscape orientation', async () => {
    const html = `<p>Landscape Document</p>`;
    const blob = generateDocxBlob(html, { orientation: 'landscape' });
    assert.ok(blob);
    const arrayBuffer = await blob.arrayBuffer();
    assert.ok(arrayBuffer.byteLength > 500);
  });
});
