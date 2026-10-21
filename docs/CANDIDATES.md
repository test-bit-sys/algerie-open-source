# Candidate Evaluation & Open-Source Integration Matrix (Phases 1 & 2)

> **Document Version:** 1.0.0  
> **Date:** October 2026  
> **Architect:** Senior Software Architect & Open Source Integration Engineer  
> **Scope:** `HeyPuter/everything` Repository & Curated External GitHub Candidates

---

## 1. Overview & Evaluation Methodology

In accordance with the **Reuse before Build** principle, this document performs an exhaustive audit of:
1. **Source 1:** The `HeyPuter/everything` monorepo (50 distinct applications under permissive MIT license).
2. **Source 2:** Curated external GitHub open-source repositories to fill architectural gaps identified in `docs/ANALYSIS.md`.

### Evaluation Criteria

- **License Compatibility:** Strictly permissive (MIT, Apache-2.0, BSD, ISC). Copyleft (GPL, AGPL) flagged for explicit authorization.
- **Sovereign Offline Autonomy:** Must function 100% offline without mandatory external cloud authentication or remote telemetry.
- **Ecosystem Synergy:** Direct compatibility with `dz-runtime.js` (Puter SDK local emulation, IndexedDB filesystem, trilingual AR/FR/EN interface).
- **Maintenance & Cleanliness:** Minimal runtime dependencies, zero critical CVEs, and modern clean codebase (ES2022+ / TypeScript / Vite).

---

## 2. Complete Evaluation Matrix: HeyPuter/everything (50 Applications)

The table below catalogs all applications residing in `HeyPuter/everything/src/`:

| Application | Category | Target Replacement | Technical Stack & Key Dependencies | Benefit to DZ Open Source | Effort | Risks | Priority |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **wiki** | Productivity | Notion, Confluence | Vanilla JS, Yjs, Lucide, Vite | **Crucial** (Knowledge base & documentation hub) | Low | Low | **P1 (Top)** |
| **crm** | Business | HubSpot, Salesforce | Vanilla JS, Lucide, Vite | **Crucial** (Sales pipeline & CRM for DZ-Facture) | Low | Low | **P1 (Top)** |
| **inventory** | Business | Zoho Inventory, Sortly | Vanilla JS, Lucide, Vite | **High** (Stock management, warehouses, SKUs) | Low | Low | **P1 (Top)** |
| **api-client** | Dev Tools | Postman, Insomnia | Vanilla JS, CodeMirror 6, YAML, Lucide | **High** (Offline API testing for DZ developers) | Medium | Low | **P1 (Top)** |
| **calendar** | Collaboration | Google Calendar | Vanilla JS, Zero deps, Vite | **High** (Appointments, schedule, reminders) | Very Low | Very Low | **P1 (Top)** |
| **contacts** | Collaboration | Google Contacts | Vanilla JS, Zero deps, Vite | **High** (National address book & vCard sync) | Very Low | Very Low | **P2** |
| **records** | Office | Airtable, MS Access | Vanilla JS, Lucide, Vite | **High** (Relational no-code database) | Medium | Low | **P2** |
| **cad** | Engineering | AutoCAD 2D | Vanilla JS, earcut, rbush, Lucide | **High** (2D architectural drawing engine) | Medium | Medium | **P2** |
| **sudoku** | Games | Sudoku.com | Vanilla JS, Lucide, Inter | **Medium** (Enriches DZ Games suite) | Very Low | Very Low | **P2** |
| **solitaire** | Games | Windows Solitaire | Vanilla JS, Zero deps, Vite | **Medium** (Enriches DZ Games suite) | Very Low | Very Low | **P2** |
| **spreadsheet** | Office | Microsoft Excel | Vanilla JS, @noble/hashes, xmldom | **Covered** (DZ-Calc already operational) | High | Medium | **P4** |
| **documents** | Office | Microsoft Word | Vanilla JS, bidi-js, yjs, opentype | **Covered** (DZ-Word already operational) | High | Medium | **P4** |
| **presentation**| Office | PowerPoint, Slides | Vanilla JS, Lucide, Vite | **Covered** (DZ-Impress already operational) | High | Medium | **P4** |
| **pdf** | Office | Adobe Acrobat Pro | Vanilla JS, pdf-lib | **Covered** (DZ-PDF Pro already operational) | High | Medium | **P4** |
| **whiteboard** | Office | Miro, FigJam | Vanilla JS, Canvas | **Covered** (DZ-Whiteboard already operational) | High | Medium | **P4** |
| **photo-studio**| Creative | Adobe Photoshop | Vanilla JS, Canvas filters | **Covered** (DZ-Photo already operational) | High | Medium | **P4** |
| **audio-studio**| Creative | Audacity, Audition | Vanilla JS, Web Audio API | **Covered** (DZ-Audio already operational) | High | Medium | **P4** |
| **time-tracking**| Productivity| Toggl, Clockify | Vanilla JS, Lucide | **Covered** (DZ-Time already operational) | Low | Low | **P3** |
| **tasks** | Productivity| Todoist, MS To Do | Vanilla JS, Lucide | **Covered** (DZ-Tasks already operational) | Low | Low | **P3** |
| **notes** | Productivity| OneNote, Apple Notes| Vanilla JS, Markdown | **Covered** (DZ-Notes already operational) | Low | Low | **P3** |
| **pos** | Business | Square POS, Odoo | Vanilla JS, Lucide | **Covered** (DZ-Facture POS already operational)| High | Medium | **P4** |
| **invoicing** | Finance | FreshBooks, Wave | Vanilla JS, Lucide | **Covered** (DZ-Facture already operational) | High | Medium | **P4** |
| **accounting** | Finance | QuickBooks, Wave | Vanilla JS, Lucide | **Covered** (DZ-Compta C# already operational) | High | Medium | **P4** |
| **signatures** | Collaboration | DocuSign | Vanilla JS, Canvas | **Covered** (DZ-Signature already operational) | Medium | Low | **P3** |
| **chess** | Games | Chess.com | Vanilla JS, Chess engine | **Covered** (DZ-Chess already operational) | Low | Low | **P4** |
| **checkers** | Games | Checkers | Vanilla JS | **Covered** (DZ-Dama already operational) | Low | Low | **P4** |
| **backgammon** | Games | Backgammon | Vanilla JS | **Covered** (DZ-Tawla already operational) | Low | Low | **P4** |
| **meetings** | Collaboration | Zoom, Google Meet | Vanilla JS, WebRTC | **Low** (Requires live signaling infrastructure)| High | High | **P4** |
| **teamchat** | Collaboration | Slack, Discord | Vanilla JS, WebSocket/Puter | **Low** (Requires multi-user server backend) | High | High | **P4** |
| **email** | Collaboration | Gmail, Thunderbird | Vanilla JS, Puter Mail API | **Low** (Tied to Puter remote mail daemon) | High | High | **P4** |
| **video-studio**| Creative | CapCut, Premiere | Vanilla JS, WebCodecs/FFmpeg wasm | **Medium** (Heavy wasm assets) | High | High | **P3** |
| **vector-studio**| Creative | Illustrator, CorelDRAW | Vanilla JS, Paper.js/SVG | **Medium** (Vector graphics editor) | High | Medium | **P3** |
| **music-studio**| Creative | FL Studio, Ableton | Vanilla JS, Web Audio Synth | **Medium** (Audio synthesis & DAW) | High | Medium | **P3** |
| **3d** | Creative | Maya, SketchUp | Vanilla JS, Three.js, Rapier3D | **Medium** (3D mesh studio) | High | Medium | **P3** |
| **building-design**| Engineering| Revit, BIM | Vanilla JS, Three.js | **Medium** (Architectural 3D BIM) | High | High | **P3** |
| **circuits** | Engineering | Altium, KiCAD | Vanilla JS, Canvas simulation | **Medium** (Schematic circuit simulator) | High | Medium | **P3** |
| **parametric** | Engineering | SolidWorks, Fusion 360 | Vanilla JS, OpenCascade wasm | **Medium** (Parametric solid modeling) | High | High | **P4** |
| **survey** | Productivity| Typeform, Forms | Vanilla JS, Lucide | **Medium** (Forms and survey creator) | Low | Low | **P3** |
| **projects** | Productivity| Trello, Asana | Vanilla JS, Kanban | **Covered** (DZ-Boards already operational) | Medium | Low | **P4** |
| **expense** | Finance | Expensify, Concur | Vanilla JS, Lucide | **Medium** (Expense and receipts log) | Low | Low | **P3** |
| **cap-table** | Finance | Carta, Pulley | Vanilla JS, Lucide | **Low** (Startup equity capitalization) | Low | Low | **P4** |
| **help-desk** | Business | Zendesk, Freshdesk | Vanilla JS, Lucide | **Medium** (Customer support tickets) | Medium | Low | **P3** |
| **contracts** | Business | ContractSafe | Vanilla JS, Lucide | **Medium** (Legal contracts manager) | Medium | Low | **P3** |
| **assets** | Business | Asset Panda | Vanilla JS, Lucide | **Medium** (IT/Physical asset inventory) | Medium | Low | **P3** |
| **hiring** | Business | Greenhouse, Lever | Vanilla JS, Lucide | **Low** (Applicant tracking system) | Medium | Low | **P4** |
| **shifts** | Business | Deputy, When I Work | Vanilla JS, Lucide | **Low** (Employee work shift rosters) | Medium | Low | **P4** |
| **childcare** | Business | Brightwheel, Procare | Vanilla JS, Lucide | **Low** (Niche childcare tracking) | Medium | Low | **P4** |
| **field-service**| Business | Jobber, ServiceTitan | Vanilla JS, Lucide | **Low** (Field service work orders) | Medium | Low | **P4** |
| **legal** | Business | Clio, PracticePanther | Vanilla JS, Lucide | **Low** (Law firm case management) | Medium | Low | **P4** |
| **fleet** | Business | Fleetio, Samsara | Vanilla JS, Lucide | **Low** (Vehicle fleet maintenance) | Medium | Low | **P4** |
| **property-management**| Business | Buildium, AppFolio | Vanilla JS, Lucide | **Low** (Real estate lease tracking) | Medium | Low | **P4** |

---

## 3. Deep-Dive: Top 5 Highest-Impact Applications from HeyPuter/everything

### 1. 📚 DZ-Wiki (`src/wiki` → `apps/productivity/dz-wiki`)
- **What it is:** A sovereign, offline Notion-grade collaborative knowledge base.
- **Key Capabilities:** Rich block editor (headings, callouts, toggles, code blocks, task lists, subpages, markdown shortcuts), nested page tree, local offline persistence via `dz-runtime.js` (`fs` & `kv`).
- **Why it is Top Priority:** Algerian ministries, university students, research laboratories, and SMEs completely lack an offline Notion alternative. It addresses the largest single documentation and procedural workflow gap in the ecosystem.
- **Integration Feasibility:** 100% Vanilla JS + Vite. Zero proprietary cloud backend required.

### 2. 🤝 DZ-CRM (`src/crm` → `apps/business-enterprise/dz-crm`)
- **What it is:** An intuitive sales pipeline, customer relationship manager, and company directory.
- **Key Capabilities:** Deal Kanban stages, lead qualification, contact interaction logs, saved custom views, forecast analytics.
- **Why it is Top Priority:** Synergizes immediately with `dz-facture`. Algerian merchants and commercial representatives can track prospective deals and clients before generating official decrees and invoices.
- **Integration Feasibility:** Pure Vanilla JS, zero dependencies other than `lucide`. Ready for immediate local storage and DZD currency localization.

### 3. 📦 DZ-Stock & Inventory (`src/inventory` → `apps/business-enterprise/dz-inventory`)
- **What it is:** Multi-location warehouse, product stock, SKU, and barcode management system.
- **Key Capabilities:** Per-depot stock counters, barcode scanning, minimum stock threshold alerts, supplier order generation, cost vs. retail valuation.
- **Why it is Top Priority:** Transforms `algerie-open-source` from a billing tool into an end-to-end commercial operations suite for Algerian wholesalers and retail chains.
- **Integration Feasibility:** Vanilla JS, Lucide, Vite. Direct mapping to `dz-runtime.js` IndexedDB filesystem.

### 4. ⚡ DZ-API Studio (`src/api-client` → `apps/developer-tools/dz-api`)
- **What it is:** A sleek, 100% offline REST and GraphQL testing environment (Postman alternative).
- **Key Capabilities:** CodeMirror 6 syntax highlighting (JSON, XML, JS), environment variables (`{{baseUrl}}`), query parameter tables, header presets, response preview.
- **Why it is Top Priority:** Postman has forced cloud accounts and telemetry onto developers. Algerian computer science university departments and local software developers need an unencumbered, sovereign API testbed.
- **Integration Feasibility:** Vanilla JS with modern CodeMirror 6 modules. Clean, isolated, and highly performant.

### 5. 📅 DZ-Calendar (`src/calendar` → `apps/collaboration/dz-calendar`)
- **What it is:** A clean, responsive calendar and appointment scheduling application.
- **Key Capabilities:** Month, week, day, and agenda views, recurring events, color-coded categories, dark/light theme toggle, zero external runtime dependencies.
- **Why it is Top Priority:** Standard office essential that rounds out the administrative desktop suite alongside `dz-word`, `dz-calc`, `dz-tasks`, and `dz-time`.
- **Integration Feasibility:** Zero runtime dependencies! Immediate drop-in compatibility with `dz-runtime.js`.

---

## 4. Curated External GitHub Candidates (Phase 2)

To complement the Everything apps and solve foundational native/technical gaps, we evaluated key external open-source projects:

### Candidate A: Tesseract.js (Offline Administrative OCR)
- **Repository:** `https://github.com/naptha/tesseract.js`
- **Stars:** 38,800+ | **License:** Apache License 2.0 (Compatible)
- **Last Active:** Actively maintained (< 3 months)
- **Stack:** Pure WebAssembly + JavaScript (Emscripten port of Google Tesseract OCR)
- **Why Chosen:** Algerian administrative bureaucracy operates extensively on scanned paper documents, circulars, and certificates. An in-browser OCR engine supporting Arabic (`ara`) and French (`fra`) without remote cloud uploading preserves citizen privacy and administrative confidentiality.
- **Proposed Integration:** `apps/office-suite/dz-ocr` (or integrated into `dz-pdf`), bundling offline language models.

### Candidate B: Dxf-Parser & Canvas 2D CAD Viewer
- **Repository:** `https://github.com/gdsestimating/dxf-parser`
- **Stars:** 750+ | **License:** MIT (Compatible)
- **Last Active:** Actively maintained, zero dependencies
- **Stack:** Pure JavaScript AST parser for AutoCAD DXF format
- **Why Chosen:** Directly unlocks the planned **Level 2 Engineering Tier** (`dz-cad`), allowing Algerian civil engineering students and architects to inspect building blueprints, road layouts, and cadastral maps offline.
- **Proposed Integration:** Standalone parser module integrated into `apps/engineering/dz-cad/`.

### Candidate C: HTML5-QRCode & Barcode Engine
- **Repository:** `https://github.com/mebjas/html5-qrcode`
- **Stars:** 6,500+ | **License:** Apache License 2.0 (Compatible)
- **Last Active:** Actively maintained
- **Stack:** Pure JavaScript camera & canvas QR/Barcode scanner
- **Why Chosen:** Critical for Algerian fiscal compliance (Executive Decree 05-468 requiring digital verification codes) and warehouse SKU scanning in `dz-inventory` and `dz-facture`.
- **Proposed Integration:** Shared library under `packages/` or vendor utility inside `dz-inventory`.

---

## 5. Architectural Synergy: The Puter-to-DZ Adapter

A pivotal architectural finding of this phase is that **HeyPuter/everything applications already communicate with the standard Puter SDK interface**:
- `window.puter.kv` (Key-Value storage)
- `window.puter.fs` (Virtual Filesystem)
- `window.puter.auth` (User Session)
- `window.puter.ui` (Modals and dialogs)

Because `packages/dz-runtime/dz-runtime.js` **already implements this exact API locally** backed by IndexedDB and LocalStorage:
1. Candidate applications can run **100% offline** without refactoring their underlying persistence calls.
2. The sovereign Algerian topbar (`dz-topbar`) and local backup system automatically attach to them.
3. Integration focuses strictly on:
   - Stripping external cloud telemetry and hardcoded `*.puter.com` references.
   - Injecting Arabic RTL styles, typography (`Cairo`), and trilingual UI dictionaries (AR / FR / EN).
   - Localizing business logic (Dinars, 58 Wilayas, Algerian calendar).
   - Exposing routes in `server.js` and adding launchers to `index.html`.
