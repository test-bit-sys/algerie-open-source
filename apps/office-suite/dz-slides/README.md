# DZ-Impress Pro (عارض الجزائر)
## The Sovereign Algerian Open-Source Presentation Studio & Slideshow Engine
### استوديو العروض التقديمية السيادي المفتوح المصدر | بديل مايكروسوفت باوربوينت

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Mission & Sovereign Value
**DZ-Impress Pro (عارض الجزائر)** is a 100% offline-first, zero-dependency, desktop-grade presentation studio and slide deck designer built to the **HeyPuter/everything** standard. It serves as a sovereign Algerian alternative to Microsoft PowerPoint, Apple Keynote, and Google Slides.

Specifically optimized for Algerian universities (USTHB, UMC, ESI, ENP), national enterprises (Sonatrach, Algérie Télécom), and startup incubators (Algeria Venture, ASF), DZ-Impress Pro enables students, researchers, and professionals to design, present, and export high-impact presentations without reliance on cloud infrastructure or proprietary licenses.

---

### Key Capabilities

#### 1. Authentic Algerian Presentation Templates
* **Soutenance PFE / Master / Doctorat (مذكرة تخرج جامعية):** Pre-formatted with official Ministry of Higher Education headers, university faculties, committee members, thesis problem formulation, architecture diagrams, live KPIs, and conclusions.
* **Startup Incubator Pitch Deck (عرض مشروع ناشئ وحاضنة أعمال):** High-impact investor deck tailored for ASF and Algerian market realities (DZD monetization, 58 wilayas expansion, unit economics).
* **Corporate Strategy & KPI Report (التقرير الاستراتيجي ومؤشرات الأداء):** Executive dashboard template for Algerian enterprises and institutions.
* **Blank Canvas (شريحة بيضاء فارغة):** Clean canvas for bespoke presentations.

#### 2. Advanced 16:9 Canvas & Element Manipulation
* **8-Point Bounding Resize Handles:** `nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w` handles for smooth geometric resizing with aspect ratio preservation.
* **Element Dragging & Precision Placement:** Intuitive canvas dragging with boundary protection.
* **Rich Editable Typography:** Content-editable headings, paragraphs, and formatted bullets.
* **Layer Management:** Bring Forward, Send Backward, Duplicate (`Ctrl+D`), and Delete (`Del`).

#### 3. Vector Shapes & Infographics Gallery
* **Pure Vector SVGs & Components:** 100% offline, zero emojis.
* **Algerian Sovereign Badges:** National Crescent & Star emblem, bilingual badges.
* **Executive Components:** 3×3 Data Tables, Donut / Pie Charts, Code Block snippets with syntax highlighting.
* **Directional Arrows & Callouts:** Flow arrows, dialogue bubbles, and 5-point stars.

#### 4. Immersive Fullscreen Slideshow Mode (`F5`)
* **Responsive 16:9 Auto-Scaling:** Automatically adjusts to any screen resolution while maintaining exact aspect ratios.
* **Interactive Red Laser Pointer (`L`):** High-visibility red glowing dot tracking the mouse for speaker emphasis.
* **Live Presenter Pen Annotator (`P`):** Smooth freehand drawing overlay directly on slides during speech with 1-click eraser (`C`).
* **Presenter Stopwatch Timer:** Real-time elapsed minutes and seconds counter (`mm:ss`).
* **Blackout Mode (`B`):** Temporarily blanks the screen to refocus audience attention on the speaker.
* **Full Keyboard Navigation:** `Right Arrow` / `Space` / `PageDown` for Next; `Left Arrow` / `Backspace` / `PageUp` for Previous; `Esc` to Exit.

#### 5. Universal Export & Sharing Hub
* **1920×1080 Full HD PNG Export:** Crisp slide rasterization via SVG foreignObject rendering.
* **Standalone Portable HTML Slideshow:** Generates a single, self-contained HTML file containing all slides and presenter engine that runs 100% offline on any browser or computer.
* **Native `.dzslide` JSON Schema:** Open standard JSON project files for seamless versioning, git backups, and exchange.
* **Direct Landscape Print / PDF:** Flawless `@media print` CSS rules ensuring 1 slide per landscape page with zero layout spillovers.

---

### Desktop Launchers (1-Click Launch)

* **Workspace Root:** Double-click `run-slides.bat` to launch the standalone desktop app window (runs seamlessly without browser URL bar via Microsoft Edge / Chrome `--app` mode).
* **Local App Directory:** Run `apps/office-suite/dz-slides/run-desktop.bat`.

---

### Command Line & Development

Run standalone on port 3008:
```bash
npm run start:slides
# or
node apps/office-suite/dz-slides/server.js
```

Run test suite:
```bash
npm test
```

---

### Trilingual Support
DZ-Impress Pro defaults to **Arabic (RTL)** and provides seamless 1-click switching to **French (FR)** and **English (EN)** with localized terminology and RTL/LTR automatic adaptation.
