# DZ-Word (DZ-Writer / كاتب الجزائر)
## The Sovereign Algerian Open-Source Word Processor & Document Studio

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Mission
**DZ-Word (كاتب الجزائر)** is a 100% offline-first, zero-dependency, modern word processing studio designed as a sovereign Algerian alternative to Microsoft Word and Google Docs. Built for administrative offices, universities, schools, law practices, and enterprises across Algeria with native bi-directional Arabic-French support and official ministerial templates.

---

### Key Capabilities

1. **Bespoke Algerian Administrative Templates**
   * **Attestation de Travail (شهادة عمل وخبرة مهنية):** Full legal format with Algerian Republic header and official stamp areas.
   * **Demande Manuscrite Officielle (طلب خطي رسمي):** Standard Algerian administrative request format for ministries, wilayas, universities, and public institutions.
   * **Note de Service (مراسلة ومذكرة إدارية):** Official circular format with ministerial references and circular numbering.
   * **Curriculum Vitae (سيرة ذاتية وطنية احترافية):** Clean, modern, highly readable resume template.

2. **Native Bi-directional Typography & Layout Engine**
   * Instant switching between Arabic (RTL) and Latin/French/English (LTR).
   * Algerian and Arabic typography fonts (`Amiri`, `Cairo`, `Tajawal`, `Inter`).
   * Zero cursor jumping, no text disorientation when mixing Arabic and French/numbers.

3. **Desktop-Grade Formatting Suite**
   * Rich text styling: Font family, font size, bold, italic, underline, strikethrough, superscript, subscript.
   * Color palettes: High-contrast text colors and document highlighter.
   * Paragraph alignments (Right, Center, Left, Justify) and custom indentations.
   * Tables insertion with dynamic rows and columns.
   * Drag-and-drop local image insertion and resizing.
   * Official Algerian national seal and header insertion.

4. **Document Tools & Metrics**
   * Real-time word count, character count, page count calculation, and reading time estimation.
   * Zoom slider (50% to 175%).
   * Find and Replace with instant document navigation.
   * Print-to-PDF engine with dedicated clean `@media print` styling.
   * Export formats: `.dzdoc` (JSON schema), `.html`, `.md` (Markdown), and `.txt`.

---

### Quick Start

Run standalone on port 3006:
```bash
npm run start:word
# or
node apps/office-suite/dz-word/server.js
```
Open in browser: `http://localhost:3006/` or via ecosystem hub at `http://localhost:3000/apps/office-suite/dz-word/`.
