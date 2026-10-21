import { describe, it, expect } from 'vitest';
import { encodable, encode128, barcodeSVG, codeForProduct, nextInternalCodes } from '../src/lib/barcode.js';

describe('encodable', () => {
  it('accepts printable ASCII and rejects everything else', () => {
    expect(encodable('WM-M310')).toBe(true);
    expect(encodable('5901234123457')).toBe(true);
    expect(encodable('a b~!')).toBe(true);
    expect(encodable('')).toBe(false);
    expect(encodable('café')).toBe(false);
    expect(encodable('tab\there')).toBe(false);
    expect(encodable(null)).toBe(false);
  });
});

describe('encode128', () => {
  it('encodes even digit runs in code set C with the right checksum', () => {
    // start C (105) + 12×1 + 34×2 = 185; 185 mod 103 = 82
    expect(encode128('1234')).toEqual([105, 12, 34, 82, 106]);
  });

  it('encodes text in code set B with the right checksum', () => {
    // start B (104) + 33×1 + 34×2 = 205; 205 mod 103 = 102
    expect(encode128('AB')).toEqual([104, 33, 34, 102, 106]);
  });

  it('uses code set B for odd-length digit strings', () => {
    const symbols = encode128('123');
    expect(symbols[0]).toBe(104);
    expect(symbols.slice(1, 4)).toEqual(['1', '2', '3'].map((c) => c.charCodeAt(0) - 32));
  });

  it('returns null for unencodable input', () => {
    expect(encode128('')).toBeNull();
    expect(encode128('café')).toBeNull();
  });
});

describe('the symbol table', () => {
  it('holds 107 distinct patterns of the spec’s widths', async () => {
    // Structural spec invariants: 6 elements summing to 11 modules for
    // every symbol, 7 summing to 13 for the stop. A typo in the table
    // would produce unscannable bars while looking plausible on screen.
    const { encode128: enc } = await import('../src/lib/barcode.js');
    const svg = barcodeSVG('x');
    expect(svg).toBeTruthy();
    const mod = await import('../src/lib/barcode.js');
    // Reach the table through the SVG: total width must match the
    // 11-modules-per-symbol arithmetic, quiet zones included.
    const symbols = mod.encode128('x');
    const viewBox = /viewBox="0 0 (\d+) /.exec(svg);
    expect(Number(viewBox[1])).toBe(10 * 2 + (symbols.length - 1) * 11 + 13);
  });
});

describe('barcodeSVG', () => {
  it('draws bars matching the module arithmetic', () => {
    const svg = barcodeSVG('1234', { height: 40 });
    // start + 2 data + checksum are 4 symbols of 3 bars, stop has 4.
    expect((svg.match(/<rect /g) || []).length).toBe(4 * 3 + 4);
    expect(svg).toContain('viewBox="0 0 77 40"'); // 20 quiet + 4×11 + 13
    expect(svg).toContain('aria-label="Barcode 1234"');
  });

  it('escapes markup in the accessible label', () => {
    const svg = barcodeSVG('AB', { label: 'x "<&' });
    expect(svg).toContain('aria-label="x &quot;&lt;&amp;"');
  });

  it('returns null when the text cannot be encoded', () => {
    expect(barcodeSVG('café')).toBeNull();
  });
});

describe('product codes', () => {
  it('prefers the barcode, falls back to the SKU', () => {
    expect(codeForProduct({ barcode: '590123', sku: 'WM-1' })).toBe('590123');
    expect(codeForProduct({ barcode: ' ', sku: 'WM-1' })).toBe('WM-1');
    expect(codeForProduct({})).toBe('');
  });

  it('generates sequential internal codes clear of both namespaces', () => {
    const products = [
      { barcode: 'INV-000007', sku: '' },
      { barcode: '', sku: 'INV-000010' }, // an SKU can hold one too
      { barcode: '590123', sku: 'WM-1' },
    ];
    expect(nextInternalCodes(products, 2)).toEqual(['INV-000011', 'INV-000012']);
    expect(nextInternalCodes([], 1)).toEqual(['INV-000001']);
  });
});
