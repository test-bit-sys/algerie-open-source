/**
 * DZ-Calc (جداول الجزائر) — Standalone Zero-Dependency XLSX Engine
 * Generates genuine, fully compliant Office Open XML Spreadsheet (.xlsx) packages
 * compatible with Microsoft Excel, Google Sheets, LibreOffice Calc, Apple Numbers.
 * 100% offline, zero external dependencies.
 */

(function () {
  'use strict';

  // CRC-32 Lookup Table for standard ZIP files
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    CRC_TABLE[i] = c >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Lightweight in-memory PKZIP archive writer (Method 0: Store)
   * Standard Office Open XML packages (.xlsx) accept Store method flawlessly.
   */
  class MiniZip {
    constructor() {
      this.files = [];
    }

    addFile(name, content) {
      let bytes;
      if (typeof content === 'string') {
        bytes = new TextEncoder().encode(content);
      } else if (content instanceof Uint8Array) {
        bytes = content;
      } else {
        bytes = new TextEncoder().encode(String(content));
      }
      this.files.push({
        name,
        nameBytes: new TextEncoder().encode(name),
        data: bytes,
        crc: crc32(bytes),
        size: bytes.length
      });
    }

    buildBlob() {
      const parts = [];
      const centralDirs = [];
      let offset = 0;

      const now = new Date();
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2));
      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

      for (const f of this.files) {
        // Local File Header (30 bytes + name)
        const localHeader = new Uint8Array(30 + f.nameBytes.length);
        const lView = new DataView(localHeader.buffer);

        lView.setUint32(0, 0x04034b50, true);  // Local file header signature
        lView.setUint16(4, 20, true);          // Version needed: 2.0
        lView.setUint16(6, 0x0800, true);      // General purpose flags (UTF-8)
        lView.setUint16(8, 0, true);           // Compression: 0 (Store)
        lView.setUint16(10, dosTime, true);
        lView.setUint16(12, dosDate, true);
        lView.setUint32(14, f.crc, true);
        lView.setUint32(18, f.size, true);     // Compressed size
        lView.setUint32(22, f.size, true);     // Uncompressed size
        lView.setUint16(26, f.nameBytes.length, true);
        lView.setUint16(28, 0, true);          // Extra field length
        localHeader.set(f.nameBytes, 30);

        parts.push(localHeader);
        parts.push(f.data);

        // Central Directory Entry (46 bytes + name)
        const cdEntry = new Uint8Array(46 + f.nameBytes.length);
        const cdView = new DataView(cdEntry.buffer);

        cdView.setUint32(0, 0x02014b50, true); // Central directory signature
        cdView.setUint16(4, 20, true);         // Version made by
        cdView.setUint16(6, 20, true);         // Version needed
        cdView.setUint16(8, 0x0800, true);     // UTF-8 flag
        cdView.setUint16(10, 0, true);         // Store
        cdView.setUint16(12, dosTime, true);
        cdView.setUint16(14, dosDate, true);
        cdView.setUint32(16, f.crc, true);
        cdView.setUint32(20, f.size, true);
        cdView.setUint32(24, f.size, true);
        cdView.setUint16(28, f.nameBytes.length, true);
        cdView.setUint16(30, 0, true);         // Extra field length
        cdView.setUint16(32, 0, true);         // Comment length
        cdView.setUint16(34, 0, true);         // Disk number start
        cdView.setUint16(36, 0, true);         // Internal attributes
        cdView.setUint32(38, 0, true);         // External attributes
        cdView.setUint32(42, offset, true);    // Relative offset of local header
        cdEntry.set(f.nameBytes, 46);

        centralDirs.push(cdEntry);
        offset += localHeader.length + f.data.length;
      }

      const cdOffset = offset;
      let cdSize = 0;
      for (const cd of centralDirs) {
        parts.push(cd);
        cdSize += cd.length;
      }

      // End of Central Directory Record (22 bytes)
      const eocd = new Uint8Array(22);
      const eView = new DataView(eocd.buffer);
      eView.setUint32(0, 0x06054b50, true);   // EOCD signature
      eView.setUint16(4, 0, true);            // Disk number
      eView.setUint16(6, 0, true);            // Start disk
      eView.setUint16(8, this.files.length, true);  // Entries on this disk
      eView.setUint16(10, this.files.length, true); // Total entries
      eView.setUint32(12, cdSize, true);      // Size of central directory
      eView.setUint32(16, cdOffset, true);    // Offset of central directory
      eView.setUint16(20, 0, true);           // Comment length

      parts.push(eocd);

      return new Blob(parts, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    }
  }

  function escapeXml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Generates a fully compliant OpenXML .xlsx Blob from workbook data
   * @param {Object} workbook - Object containing sheets: { 'ورقة 1': { cells: { 'A1': { val, style } } } }
   * @param {Object} options - Options like title, creator, rtl
   */
  function generateXlsxBlob(workbook, options = {}) {
    const zip = new MiniZip();
    const sheetNames = Object.keys(workbook.sheets || { 'ورقة 1': { cells: workbook.cells || {} } });
    if (sheetNames.length === 0) sheetNames.push('ورقة 1');

    // 1. [Content_Types].xml
    let sheetOverrides = '';
    sheetNames.forEach((name, idx) => {
      sheetOverrides += `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    });

    zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`);

    // 2. _rels/.rels
    zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

    // 3. xl/_rels/workbook.xml.rels
    let wbRels = '';
    sheetNames.forEach((name, idx) => {
      wbRels += `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`;
    });
    wbRels += `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

    zip.addFile('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${wbRels}
</Relationships>`);

    // 4. xl/workbook.xml
    let sheetsXml = '';
    sheetNames.forEach((name, idx) => {
      sheetsXml += `<sheet name="${escapeXml(name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`;
    });

    zip.addFile('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView xWindow="0" yWindow="0" windowWidth="20480" windowHeight="10240"/>
  </bookViews>
  <sheets>
    ${sheetsXml}
  </sheets>
</workbook>`);

    // 5. xl/styles.xml (Standard fonts, fills, borders, cell formats)
    zip.addFile('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color theme="1"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="11"/><color theme="1"/><name val="Segoe UI"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FF047857"/><name val="Segoe UI"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`);

    // 6. xl/worksheets/sheetN.xml
    sheetNames.forEach((sheetName, idx) => {
      const sheetData = (workbook.sheets && workbook.sheets[sheetName]) ? workbook.sheets[sheetName] : { cells: workbook.cells || {} };
      const cells = sheetData.cells || {};

      // Group cells by row number
      const rowsMap = new Map();
      let maxCol = 1;

      for (const [addr, cellInfo] of Object.entries(cells)) {
        if (!cellInfo || (cellInfo.val == null && !cellInfo.formula)) continue;
        const m = addr.toUpperCase().match(/^([A-Z]+)([0-9]+)$/);
        if (!m) continue;
        const rowNum = parseInt(m[2], 10);
        if (!rowsMap.has(rowNum)) rowsMap.set(rowNum, []);
        rowsMap.get(rowNum).push({ addr, colStr: m[1], ...cellInfo });
      }

      const sortedRowNums = Array.from(rowsMap.keys()).sort((a, b) => a - b);
      let sheetXmlContent = '';

      for (const rNum of sortedRowNums) {
        const rowCells = rowsMap.get(rNum);
        rowCells.sort((a, b) => a.addr.localeCompare(b.addr, undefined, { numeric: true }));

        sheetXmlContent += `<row r="${rNum}" spans="1:26">`;
        for (const cell of rowCells) {
          const val = cell.val != null ? cell.val : '';
          const style = cell.style || {};
          let sAttr = ' s="0"';
          if (style.bold && style.bg) sAttr = ' s="2"';
          else if (style.bold && style.fontSize) sAttr = ' s="3"';
          else if (style.bold) sAttr = ' s="1"';

          // Check if value is a formula (starts with =)
          if (typeof val === 'string' && val.startsWith('=')) {
            const formulaClean = escapeXml(val.slice(1));
            sheetXmlContent += `<c r="${cell.addr}"${sAttr}><f>${formulaClean}</f></c>`;
          } else if (typeof val === 'number') {
            sheetXmlContent += `<c r="${cell.addr}"${sAttr}><v>${val}</v></c>`;
          } else if (!isNaN(val) && val !== '' && typeof val !== 'boolean') {
            sheetXmlContent += `<c r="${cell.addr}"${sAttr}><v>${val}</v></c>`;
          } else {
            // Inline string
            sheetXmlContent += `<c r="${cell.addr}" t="inlineStr"${sAttr}><is><t>${escapeXml(val)}</t></is></c>`;
          }
        }
        sheetXmlContent += `</row>`;
      }

      const isRtl = options.direction !== 'ltr';

      zip.addFile(`xl/worksheets/sheet${idx + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews>
    <sheetView tabSelected="${idx === 0 ? '1' : '0'}" workbookViewId="0" rightToLeft="${isRtl ? '1' : '0'}">
      <selection activeCell="A1" sqref="A1"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="26" width="14" customWidth="1"/>
  </cols>
  <sheetData>
    ${sheetXmlContent}
  </sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`);
    });

    return zip.buildBlob();
  }

  // Export functions
  if (typeof window !== 'undefined') {
    window.generateXlsxBlob = generateXlsxBlob;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateXlsxBlob };
  }
})();
