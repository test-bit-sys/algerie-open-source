# DZ-Slides (DZ-Impress / عارض الجزائر)
## The Sovereign Algerian Open-Source Presentation Studio & Slideshow Engine

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Mission
**DZ-Slides (عارض الجزائر)** is a 100% offline-first, modern presentation and slide deck studio designed as a sovereign Algerian alternative to Microsoft PowerPoint and Google Slides. Crafted for universities, engineering schools, startup incubators, and enterprise teams across Algeria with standard thesis defense formats, startup pitch decks, and fullscreen presenter mode.

---

### Key Capabilities

1. **Algerian Academic & Enterprise Presentation Templates**
   * **Soutenance PFE / Master / Doctorat (مذكرة تخرج جامعية):** Pre-formatted with official Ministry and University headers, presentation outline (Plan), Problem statement, System Architecture, Results, and Future Perspectives.
   * **Startup Incubator Pitch Deck (عرض مشروع ناشئ وحاضنة أعمال):** High-impact investor format covering the Problem in the Algerian market, Value Proposition, Business Model, and Founder Team.

2. **16:9 Canvas & Drag-and-Drop Elements**
   * Rich editable text boxes with headings and bullet lists.
   * Infographic metric cards for key results and statistical indicators.
   * Image insertion with automatic positioning and shadow styling.
   * Color palettes and custom slide background gradients.

3. **Fullscreen Presentation Mode (Slideshow - `F5`)**
   * Immersive full-screen projection view with keyboard navigation (`Right Arrow`, `Space`, `Left Arrow`).
   * On-screen floating presenter controls bar.
   * Real-time presentation elapsed timer.
   * Interactive Laser Pointer mode (illuminated cursor for emphasizing points on the screen).

4. **Slide Deck Management & Export**
   * Thumbnails sidebar with live previews, slide reordering, duplicating, and deletion.
   * Native `.dzslide` format (JSON schema) for seamless saving and sharing.
   * Clean print-to-PDF formatting (`window.print()`) rendering each slide cleanly on landscape pages.

---

### Quick Start

Run standalone on port 3008:
```bash
npm run start:slides
# or
node apps/office-suite/dz-slides/server.js
```
Open in browser: `http://localhost:3008/` or via ecosystem hub at `http://localhost:3000/apps/office-suite/dz-slides/`.
