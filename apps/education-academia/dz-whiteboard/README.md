# DZ-Whiteboard Pro (السبورة البيضاء التفاعلية)
## The Algerian National Open-Source Interactive Whiteboard & Classroom Presentation Suite

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Overview (نظرة عامة)
**DZ-Whiteboard Pro** is a modern, 100% offline-first interactive whiteboard designed for Algerian educational institutions (primary schools, middle schools, high schools, universities), research laboratories, training centers, and engineering teams. Built according to the **HeyPuter** architectural principles with pure Vanilla JavaScript, zero third-party dependencies, and zero cloud tracking.

Inspired by industry benchmarks like **OpenBoard**, **Microsoft Whiteboard**, and **Miro**, DZ-Whiteboard delivers an ultra-smooth, responsive 60fps vector canvas that turns any computer, touch screen, or classroom data-show projector into an intelligent interactive teaching environment.

---

### Key Capabilities (الميزات والقدرات الأساسية)

1. **Classroom Backgrounds & Surfaces (أنماط السبورة المتنوعة):**
   - **Pure Whiteboard (صبورة بيضاء نقية):** High contrast white surface for clean notes, diagrams, and corporate presentations.
   - **Grid / Graph Paper (ورق شبكي / مربعات هندسية):** Ideal for mathematics, geometry, graphs, physics, and technical sketches.
   - **Lined / Ruled (ورق مسطر مدرسي):** Dedicated for language lessons, handwriting instruction (Arabic, French, English, Tamazight), and poetry.
   - **Dotted Grid (شبكة النقاط):** Minimalist visual aids for wireframing, architecture, and flowcharting.
   - **Chalkboard Green (السبورة المدرسية الخضراء):** Authentic school chalkboard aesthetic with smooth chalk-style lines.
   - **Blackboard Dark (السبورة السوداء الحديثة):** High-contrast dark room mode with vibrant neon ink lines.

2. **Teaching & Drawing Toolkit (أدوات الشرح والرسم المتكاملة):**
   - **Freehand Calligraphy Pen (قلم الحبر السلس):** Catmull-Rom spline curve smoothing for natural, pressure-friendly handwriting.
   - **Highlighter / Marker (قلم التمييز الشفاف):** Wide, semi-transparent highlighter with alpha blending for emphasizing text and formulas.
   - **Smart Geometric Shapes (الأشكال الهندسية):** Rectangles, rounded boxes, circles, ellipses, triangles, diamonds, stars, and polygons with live fill/stroke customization.
   - **Connectors & Arrows (الأسهم وموصلات المخططات):** Single and double directional arrows with magnetic snap angles (45° / 90°).
   - **Rich Typography & Text (أداة الكتابة النصية):** Multi-line text boxes with font sizing, bold, italic, text color, and alignment.
   - **Sticky Notes (الملاحظات اللاصقة - Post-It Notes):** Colorful sticky notes with shadow depth, quick editing, and auto-wrapping.
   - **Laser Pointer (مؤشر الليزر التفاعلي):** Real-time glowing pointer trail with smooth fade-out effect for guiding student attention during lectures.
   - **Object & Stroke Eraser (ممحاة ذكية):** Seamless erasure of strokes and elements.
   - **Screen Pan & Infinite Zoom:** Fluid pan (Space drag / Middle mouse) and zoom from 25% to 400% with a live Minimap radar.

3. **Multi-Page Lessons & Slide Management (إدارة الصفحات والشرائح):**
   - Unlimited pages per lesson with quick thumbnail navigation sidebar.
   - Add, duplicate, reorder, and clear individual pages.
   - Multi-page document export to PDF for immediate student handout generation.

4. **100% Offline Vector Export & Persistence:**
   - **Export as PNG:** High-resolution transparent or solid canvas rendering.
   - **Export as Scalable Vector Graphics (SVG):** Clean vector curves.
   - **Export as Multi-Page PDF:** Ready-to-print lecture slides.
   - **Save / Open (.dzboard):** Portable JSON document containing all vector paths, text nodes, and slide hierarchy.
   - **Auto-Save:** Automatic persistence to browser storage ensuring no lecture notes are lost on accidental reloads.

---

### Technical Architecture (المعمارية التقنية)

```
apps/education-academia/dz-whiteboard/
├── index.html              # Semantic HTML5 layout with pure SVG vector toolset
├── server.js               # Zero-dependency local Node.js static server (Port 3005)
├── package.json            # Application metadata and scripts
├── README.md               # Complete documentation
└── src/
    ├── app.js              # Application orchestrator, state management, shortcuts & i18n
    ├── canvas-engine.js    # 60fps HTML5 Canvas renderer, transformations, hit testing & minimap
    ├── tools.js            # Tool controllers (Pen, Highlighter, Shapes, Text, Sticky, Laser)
    ├── export-engine.js    # Vector export pipeline (PNG, SVG, PDF, .dzboard JSON)
    └── styles.css          # Sleek desktop UI styling, floating docks & responsive controls
```

---

### Quick Start (طريقة التشغيل)

```bash
# Launch DZ-Whiteboard directly
npm run start:whiteboard

# Or run via root ecosystem server
npm start
# Open http://localhost:3000/apps/education-academia/dz-whiteboard/
```

### Keyboard Shortcuts (اختصارات لوحة المفاتيح)

| Shortcut | Action | الإجراء |
| :--- | :--- | :--- |
| `V` | Selection Tool | أداة التحديد والتحريك |
| `P` | Freehand Pen | قلم الكتابة الحر |
| `H` | Highlighter | قلم التمييز الشفاف |
| `E` | Eraser | الممحاة الذكية |
| `R` | Rectangle Shape | شكل مستطيل |
| `O` | Circle / Ellipse | دائرة أو بيضاوي |
| `A` | Arrow Connector | سهم اتجاهي |
| `L` | Straight Line | خط مستقيم |
| `T` | Text Tool | كتابة نصية |
| `S` | Sticky Note | ملاحظة لاصقة |
| `K` | Laser Pointer | مؤشر الليزر للمحاضرات |
| `Space + Drag` | Hand Pan Canvas | تحريك رقعة السبورة |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo | التراجع والإعادة |
| `Ctrl + +` / `Ctrl + -` | Zoom In / Out | تكبير وتصغير |
| `F` / `F11` | Presentation Mode | وضع ملء الشاشة والشرح |
| `Delete` | Delete Selection | حذف العنصر المحدد |
