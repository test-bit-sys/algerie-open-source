<div align="center">

<img src="assets/logo.jpg" alt="DZ Open Suite" width="680">

# 🇩🇿 DZ Open Suite
### The Algerian Sovereign Open-Source Software Ecosystem
**Desktop-Grade Alternatives • 100% Offline-First • Zero Cloud Dependency • Native Trilingual (AR / FR / EN)**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#-architectural-principles)
[![Status: 5 Operational Apps](https://img.shields.io/badge/Status-5_Operational_Apps-10b981.svg?style=for-the-badge&logo=checkmarx&logoColor=white)](#-flagship-operational-applications-11-desktop-alternatives)
[![Tracks: 11 Domains](https://img.shields.io/badge/Tracks-11_Specialized_Domains-0284c7.svg?style=for-the-badge)](#-the-11-strategic-software-tracks--directory)
[![Privacy: 100% Offline](https://img.shields.io/badge/Privacy-100%25_Offline--First-059669.svg?style=for-the-badge&logo=sqlite&logoColor=white)](#-mission--strategic-vision)
[![Languages: AR · FR · EN](https://img.shields.io/badge/Languages-العربية_%7C_Français_%7C_English-dc2626.svg?style=for-the-badge)](#-internationalization--bidirectionality)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-7c3aed.svg?style=for-the-badge&logo=github&logoColor=white)](docs/CONTRIBUTING.md)

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ar.md"><b>🇩🇿 العربية</b></a> •
  <a href="README.fr.md"><b>🇫🇷 Français</b></a>
</p>

</div>

---

## 📑 Table of Contents

- [🌟 Mission & Strategic Vision](#-mission--strategic-vision)
- [🟢 Software Status Matrix (Operational vs Roadmap)](#-software-status-matrix)
- [🚀 Flagship Operational Applications (1:1 Desktop Alternatives)](#-flagship-operational-applications-11-desktop-alternatives)
  - [💼 1. DZ-Facture & POS (Sage / Odoo Alternative — Port 3000)](#1--dz-facture--pos-sage--odoo-pos-alternative)
  - [🌳 2. DZ-Disk-Tree (WizTree 1:1 Alternative — Port 3001)](#2--dz-disk-tree-wiztree-11-alternative)
  - [📦 3. DZ-Archive (WinRAR 1:1 Alternative — Port 3002)](#3--dz-archive-winrar-11-alternative)
  - [🎬 4. DZ-Player (VLC Media Player 1:1 Alternative — Port 3003)](#4--dz-player-vlc-media-player-11-alternative)
  - [📄 5. DZ-PDF Pro (Adobe Acrobat Pro 1:1 Alternative — Port 3004)](#5--dz-pdf-pro-adobe-acrobat-pro-11-alternative)
- [🗺️ The 11 Strategic Software Tracks & Complete Matrix](#-the-11-strategic-software-tracks--complete-matrix)
- [⚙️ Architectural Principles (The HeyPuter Standard)](#️-architectural-principles-the-heyputer-standard)
- [🏛️ Algerian Legal & Regulatory Compliance](#️-algerian-legal--regulatory-compliance)
- [💻 Quick Start & Port Reference](#-quick-start--port-reference)
- [🤝 Contributing & Community Guidelines](#-contributing--community-guidelines)
- [📜 License & Sovereignty](#-license--sovereignty)

---

## 🌟 Mission & Strategic Vision

**DZ Open Suite** is an expansive national sovereign open-source software initiative. Its mandate is to engineer, maintain, and distribute production-grade, 100% free desktop and web alternatives to the commercial and pirated software tools pervasive throughout Algerian public administrations, economic enterprises, hospitals, universities, and small businesses.

### Why DZ Open Suite?
1. **🛡️ National Data Sovereignty**: Official administrative acts, financial ledgers, commercial agreements, and citizen records must never be hosted on foreign proprietary cloud services. All data is processed and stored strictly on the local machine (**Offline-First**).
2. **🚫 Eradication of Pirated Software**: Replace unmaintained legacy applications (Visual Basic 6, Delphi 7, MS Access 2003) and cracked proprietary utilities with secure, modern, auditable open standards.
3. **🇩🇿 Strict Alignment with Algerian Legislation**: Direct compliance with Executive Decree 05-468 (Commercial Invoicing), Law 18-05 (Electronic Commerce), SCF accounting standards, VAT rules (19% & 9%), Timbre Fiscal, DZD currency Tafqit, and authentic administrative seals.
4. **⚡ The HeyPuter Engineering Standard**: Pure Vanilla JavaScript ES Modules, HTML5, Modern CSS, zero framework bloat (no React/Vue/Angular), zero tracking telemetries, and native bi-directionality (Arabic RTL default).

---

## 🟢 Software Status Matrix

| Track | Software Category | Primary Proprietary Target | Status | Port | Operational Link |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **02** | **Billing & Point-of-Sale** | **Sage 100 / Odoo POS** | 🟢 **Ready** | `:3000` | [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/) |
| **07** | **Disk Space Analyzer** | **WizTree / TreeSize 1:1** | 🟢 **Ready** | `:3001` | [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/) |
| **07** | **Archive & Compression** | **WinRAR / 7-Zip 1:1** | 🟢 **Ready** | `:3002` | [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/) |
| **04** | **Multimedia Player** | **VLC Media Player 1:1** | 🟢 **Ready** | `:3003` | [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/) |
| **01** | **PDF Document Suite** | **Adobe Acrobat Pro 1:1** | 🟢 **Ready** | `:3004` | [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/) |
| **10** | **Interactive Whiteboard** | **OpenBoard / Miro 1:1** | 🟢 **Ready** | `:3005` | [`apps/education-academia/dz-whiteboard/`](apps/education-academia/dz-whiteboard/) |
| **01** | **Office Suite (Word/Sheets/Slides)** | Microsoft 365 / Google Docs | 🟡 *In Design* | — | [`apps/office-suite/`](apps/office-suite/) |
| **03** | **Finance & SCF Accounting** | PC Compta, DLG, PC Paie | 🟡 *In Design* | — | [`apps/finance-accounting/`](apps/finance-accounting/) |
| **05** | **Creative & Vector Design** | Adobe Photoshop / Illustrator | 🟡 *In Design* | — | [`apps/creative-tools/`](apps/creative-tools/) |
| **06** | **Team Collaboration & Chat** | Slack, Trello, Teams | 🟡 *In Design* | — | [`apps/collaboration/`](apps/collaboration/) |
| **08** | **Engineering & Seismic CAD** | AutoCAD, Robot Structural, ETABS | 🟡 *In Design* | — | [`apps/engineering/`](apps/engineering/) |
| **09** | **Developer Gateway SDKs** | SATIM, CIB, BaridiMob SDKs | 🟡 *In Design* | — | [`apps/developer-tools/`](apps/developer-tools/) |
| **10** | **Education & Academia** | Legacy Access School DBs, FET | 🟡 *In Design* | — | [`apps/education-academia/`](apps/education-academia/) |
| **11** | **Games & Cultural Heritage** | Commercial casual games | 🟡 *In Design* | — | [`apps/games-interactive/`](apps/games-interactive/) |

---

## 🚀 Flagship Operational Applications (1:1 Desktop Alternatives)

---

### 1. 💼 DZ-Facture & POS (Sage / Odoo POS Alternative)
> **National Invoicing, Retail Point-of-Sale, Stock Tracking & Algerian Fiscal Engine**  
> *Port: `:3000` • Path: [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/)*

- **📜 Executive Decree 05-468 Compliance**: Strictly generates legally valid invoices with NIF (15 digits), NIS (20 digits), Registre de Commerce (RC), Article d'Imposition, and bank/postal RIB credentials.
- **💰 Algerian Fiscal Engine**: Automated VAT calculation (19% standard, 9% reduced, 0% exempt) and Fiscal Stamp Duty (*Droit de Timbre Fiscal*) with legal thresholds.
- **✍️ Arabic Currency Tafqit**: Converts monetary sums into legal written Arabic, French, and English Dinars (*e.g., ثمانمائة وإحدى عشر ألف وسبعمائة دينار جزائري لا غير*).
- **🏪 Dual Retail POS & B2B Invoicing**: Rapid barcode scanning, thermal ticket printing (58mm / 80mm), held carts (paniers en attente), and official A4 enterprise invoices.
- **📊 Daily Z-Report & Cash Balancing**: End-of-day register closure, cash drawer audits, and daily operational expense tracking.
- **🗺️ Complete 58 Wilayas Database**: Built-in directory of all 58 Algerian wilayas and 1,541 communes with postal codes.

```bash
# Run DZ-Facture & Ecosystem Portal on http://localhost:3000
npm start
```

---

### 2. 🌳 DZ-Disk-Tree (WizTree 1:1 Alternative)
> **High-Performance Storage Space Analyzer & Cushioned Squarified Treemap**  
> *Port: `:3001` • Path: [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/)*

- **🖥️ Synchronized Split Desktop Window**: Multi-column hierarchical tree grid in the top pane and squarified cushioned treemap in the bottom pane with an interactive draggable splitter.
- **⚡ Bidirectional Focus Linking**: Selecting any folder in the tree grid zooms the treemap; clicking any visual tile highlights the corresponding item in the tree grid.
- **📊 Multi-Column Header Sorting**: Sort by Name, % Parent, Logical Size, Allocated Cluster Size (4KB boundary), Files, Folders, and Modified Date with ascending/descending indicators.
- **⌨️ Desktop Keyboard Arrow Navigation**: Full keyboard navigation (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Backspace`).
- **🖨️ Executive Printable Audit Report**: Generates an executive printable HTML audit document with embedded canvas treemap snapshot and breakdown tables.
- **💾 Comprehensive Exporting**: Export directory structures to CSV and JSON or save treemaps as high-resolution PNG images.

```bash
# Run DZ-Disk-Tree on http://localhost:3001
npm run start:disk-tree
```

---

### 3. 📦 DZ-Archive (WinRAR 1:1 Alternative)
> **High-Performance Archiver, AES-256-GCM Encryption & Multi-Threaded Benchmark**  
> *Port: `:3002` • Path: [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/)*

- **🗜️ Iconic WinRAR Desktop Interface**: Classic menu bar (`File`, `Commands`, `Tools`, `Options`, `Help`) and big toolbar (`Add`, `Extract To`, `Test`, `View`, `Delete`, `Find`, `Wizard`, `Info`, `Lock`, `Comment`, `Benchmark`).
- **📑 6-Tab Compression Dialog**: Parameters dialog with `General`, `Advanced`, `Files`, `Backup`, `Time`, and `Comment` configuration tabs.
- **🔐 AES-256-GCM Cryptographic Security**: Hardware-accelerated client-side encryption via Web Crypto API with PBKDF2 key derivation and password authentication.
- **🔍 Multi-Mode Internal File Viewer**: Inspect files without disk extraction via Text view, Hex Dump view (16-byte aligned offsets with hex bytes and printable ASCII), or Media preview.
- **⏱️ Hardware Compression Benchmark**: Real-time compression throughput meter (MB/s) and multi-threaded rating score based on hardware concurrency.
- **🛡️ CRC-32 Integrity Verification**: Byte-level verification verifying that compressed streams have not suffered bitrot or corruption.

```bash
# Run DZ-Archive on http://localhost:3002
npm run start:archive
```

---

### 4. 🎬 DZ-Player (VLC Media Player 1:1 Alternative)
> **Advanced Multimedia Player with 300% Volume Boost & Unified Effects Studio**  
> *Port: `:3003` • Path: [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/)*

- **📻 Authentic VLC Experience**: Classic VLC top menus, dark high-contrast video viewport with orange cone emblem, and bottom control bar.
- **🔊 300% Volume Super-Boost**: Custom `GainNode` audio graph pipeline capable of clean amplification up to 300% with a live percentage indicator badge.
- **🎛️ Unified "Adjustments and Effects" Window (Ctrl+E)**:
  - **10-Band Graphic Equalizer**: Standard frequencies (60Hz to 16kHz) with presets (Rock, Pop, Classical, Flat, Full Bass, Voice).
  - **Audio Compressor**: Full dynamic range regulation (`DynamicsCompressorNode`) with Threshold, Knee, Ratio, Attack, and Release controls.
  - **Video Geometry & Colors**: Real-time 90°/180°/270° rotation, horizontal flip, brightness, contrast, saturation, and hue rotation.
  - **Synchronization**: Sub-millisecond audio and subtitle track synchronization delay/advance controls.
- **🔤 Automatic Arabic Subtitle Repair**: Auto-detects `Windows-1256 / CP-1256` vs `UTF-8` encodings to fix corrupted text (`ãÑÍÈÇ Èßã` / `Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©`) with native RTL rendering.
- **🔄 Playback Controls**: A-B repeat looping, frame-by-frame snapshot capture, and network stream playback (HTTP/HTTPS/HLS).

```bash
# Run DZ-Player on http://localhost:3003
npm run start:player
```

---

### 5. 📄 DZ-PDF Pro (Adobe Acrobat Pro 1:1 Alternative)
> **Administrative Document Suite, Algerian Official Seals & Certified Digital Signatures**  
> *Port: `:3004` • Path: [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/)*

- **🛠️ Acrobat Command Palette**: Selection tool (`V`), Hand pan tool (`H`), Freehand pen (`P`), Text highlighter (`U`), Typewriter text tool (`T`), Blackout redaction tool (`R`), and Sticky notes (`N`).
- **🏛️ Official Algerian Administrative Stamps**:
  - **Circular Seal of the Republic**: Dual-ring seal of the People's Democratic Republic of Algeria (*الجمهورية الجزائرية الديمقراطية الشعبية / République Algérienne Démocratique et Populaire*) with national crescent and star, Wilaya, and date.
  - **Official Administrative Boxes**: *Conforme à l'Original*, *Courrier Arrivé / Reçu le*, *Payé Intégralement*, *Strictement Confidentiel*, *Vu et Approuvé*, *Annulé*, and *Très Urgent*.
- **✍️ Certified Digital Signature Pad**: Velocity-sensitive vector signature pad with multiple ink colors (Diplomatic Blue, Bureau Black, Emerald Green, Violet), signatory metadata (Name, Role, Wilaya, Date), and SHA verification code.
- **📑 Page Organizer & Sorter**: Thumbnail grid view for drag-and-drop page reordering, individual and batch 90° rotation, page duplication, deletion, and blank page insertion.
- **📋 Built-in Administrative Templates**: Instant demonstration with authentic Algerian administrative certificates and commercial contracts in DZD.

```bash
# Run DZ-PDF Pro on http://localhost:3004
npm run start:pdf
```

---

### 6. 🧑‍🏫 DZ-Whiteboard Pro (OpenBoard / Miro 1:1 Alternative)
> **Interactive Digital Whiteboard for Smart Screens, Classrooms, University Lectures & Visual Collaboration**  
> *Port: `:3005` • Path: [`apps/education-academia/dz-whiteboard/`](apps/education-academia/dz-whiteboard/)*

- **🎨 Multi-Surface Teaching Backgrounds**: Pure Whiteboard, Graph / Math Grid, Ruled Language Paper, Dotted Matrix, Authentic Classroom Green Chalkboard, and High-Contrast Dark Blackboard with neon inking.
- **✏️ Comprehensive Classroom Toolkit**: Spline-smoothed freehand calligraphy pen, translucent text highlighter, smart geometric shapes (rectangles, rounded boxes, circles, triangles, diamonds, stars), and directional flowchart arrows.
- **💡 Interactive Laser Pointer**: Real-time fading laser trail designed for guiding student and audience focus on interactive screens and projectors without permanent canvas marks.
- **📑 Multi-Page Lecture Slides**: Unlimited pages per lecture document with a slide thumbnail navigation drawer, page duplication, reordering, and clearing.
- **💾 100% Offline Multi-Format Export**: Immediate high-resolution PNG export, scalable vector graphics (SVG), multi-page printable PDF lecture handouts, and local `.dzboard` project save and load.

```bash
# Run DZ-Whiteboard on http://localhost:3005
npm run start:whiteboard
```

---

## 🗺️ The 11 Strategic Software Tracks & Complete Matrix

The DZ Open Suite monorepo is organized into **11 specialized functional domains** addressing all sectors of Algerian civil, administrative, commercial, and educational activity:

```
algerie-open-source/
├── apps/
│   ├── office-suite/            # Track 01: Office Suite (Word, Sheets, Slides, PDF)
│   ├── business-enterprise/      # Track 02: Invoicing, Retail POS, Stock, ERP, CRM
│   ├── finance-accounting/       # Track 03: SCF Accounting, G50, CNAS Paie, CCP Slips
│   ├── multimedia/               # Track 04: Media Players, NLE Video Montage, Recorders
│   ├── creative-tools/           # Track 05: Vector Illustration, Photo Editing, Audio DAW
│   ├── collaboration/            # Track 06: Team Chat, Kanban Boards, WebRTC Meetings
│   ├── productivity/             # Track 07: System Utilities, Disk Analyzers, Citizen Kits
│   ├── engineering/              # Track 08: 2D/3D CAD, Seismic RPA 99/2003, Concrete DTR
│   ├── developer-tools/          # Track 09: SATIM/CIB Payments, SMS OTP, 58 Wilayas CLI
│   ├── education-academia/       # Track 10: School Management, Timetables, Thesis LaTeX
│   └── games-interactive/        # Track 11: Cultural Heritage, 58 Wilayas Quiz, Godot Kits
```

### Detailed Sectoral Scope:

| # | Domain Track | Scope & Planned Applications | Replaced Proprietary Solutions | Status |
| :-: | :--- | :--- | :--- | :---: |
| **01** | **🏢 Office Suite** | **DZ-PDF Pro** (PDF editor & signer), Word processor with ministerial templates, Spreadsheet with Algerian formulas, Presentation slides. | Microsoft 365, Google Workspace, Adobe Acrobat Pro | 🟢 *PDF Ready*<br>🟡 *Office Planned* |
| **02** | **💼 Business & Enterprise** | **DZ-Facture & POS** (Decree 05-468 invoicing, retail cash registers, inventory), Modular ERP, Multi-depot stock, CRM. | Sage 100, Delphi POS, Odoo Enterprise, SAP | 🟢 *POS Ready*<br>🟡 *ERP Planned* |
| **03** | **📊 Finance & Accounting** | SCF Financial Accounting, G50 automated tax filing assistant, CNAS Payroll (IRG scale), Postal CCP check printers. | PC Compta, DLG Compta, PC Paie | 🟡 *In Design* |
| **04** | **🎬 Video & Multimedia** | **DZ-Player** (VLC 1:1 media player), Hardware-accelerated NLE video montage, native RTL Arabic subtitling engine, screen tutorial recorder. | VLC, Adobe Premiere Pro, CapCut PC, Camtasia | 🟢 *Player Ready*<br>🟡 *Editor Planned* |
| **05** | **🎨 Creative Tools** | Raster photo design, Arabic calligraphy vector illustration (Tifinagh/Arabic), multi-track audio workstation, print shop prepress tools. | Adobe Photoshop, Illustrator, Audition, Canva | 🟡 *In Design* |
| **06** | **💬 Collaboration** | Self-hostable local team chat, interactive Kanban project boards, zero-install WebRTC video conferencing, municipal wiki. | Slack, Microsoft Teams, Trello, Zoom | 🟡 *In Design* |
| **07** | **⚡ Productivity & Utilities** | **DZ-Disk-Tree** (WizTree 1:1), **DZ-Archive** (WinRAR 1:1), Citizen administrative kit (residence, declarations), dual calendar. | WizTree, WinRAR, 7-Zip, Proprietary utility kits | 🟢 *Disk-Tree Ready*<br>🟢 *Archive Ready* |
| **08** | **🏗️ Engineering & CAD** | 2D/3D CAD viewer & editor, Algerian seismic calculator (**RPA 99/2003**), reinforced concrete (**DTR-BC 2.41**), topographic GIS. | AutoCAD, Robot Structural Analysis, ETABS | 🟡 *In Design* |
| **09** | **💻 Developer Tools** | Unified SATIM/CIB/BaridiMob payment gateway SDK, multi-provider SMS OTP gateway, 58 Wilayas SDK, scaffold CLI. | Fragmented vendor libraries | 🟡 *In Design* |
| **10** | **🎓 Education & Academia** | Primary & secondary school grades & bulletins, clash-free teacher/classroom timetable generator, university thesis LaTeX templates. | Legacy Access databases, FET | 🟡 *In Design* |
| **11** | **🎮 Games & Culture** | Educational 58 Wilayas geography quizzes, traditional Algerian games (Ronda, Dama), historical interactive adventures, Godot asset kits. | Commercial casual games | 🟡 *In Design* |

---

## ⚙️ Architectural Principles (The HeyPuter Standard)

All applications in DZ Open Suite strictly follow the **HeyPuter/everything** engineering blueprint:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DZ Open Suite Monorepo                          │
├────────────────────────────────────────────────────────────────────────┤
│  Layer 1: Native Web Platform (HTML5 Canvas 2D · Web Audio · Web Crypto)│
│  Layer 2: Vanilla ES Modules (Zero Build Step required in production)   │
│  Layer 3: Local Storage / IndexedDB (100% Offline-First)               │
│  Layer 4: Bi-directional Design System (RTL Arabic / LTR FR & EN)      │
│  Layer 5: Zero-Emoji Vector Policy (Strictly SVG icons in apps)         │
└────────────────────────────────────────────────────────────────────────┘
```

1. **⚡ Zero External Framework Dependencies**: No React, Angular, Vue, or heavy npm bundles in runtime applications. Native DOM and Vanilla JavaScript ES Modules yield instant boot times and long-term maintainability.
2. **🔒 Offline-First & Local-Storage First**: Complete autonomy from internet access. Applications work indefinitely in disconnected environments (such as remote municipal branches, hospitals, border posts, and industrial zones).
3. **🌐 Native Bi-Directionality & RTL**: Arabic is treated as a primary first-class citizen with natural Right-to-Left (RTL) flow, alongside clean Left-to-Right (LTR) French and English.
4. **🎨 Vector Discipline**: All visual indicators and controls inside the application interface use mathematical SVG vectors.

---

## 🏛️ Algerian Legal & Regulatory Compliance

DZ Open Suite is built specifically to address Algerian operational realities:

- **📜 Executive Decree 05-468**: Sets mandatory specifications for commercial invoices, receipts, and electronic point-of-sale registers.
- **⚖️ Law 18-05**: Governs electronic commerce, digital contracts, and electronic signatures across the national territory.
- **💵 Fiscal Regulations**:
  - Standard VAT rate (Taux Normal): **19%**
  - Reduced VAT rate (Taux Réduit): **9%**
  - Fiscal Stamp Duty (Droit de Timbre Fiscal): **1%** on cash transactions (minimum 5 DZD, maximum 10,000 DZD).
- **🗺️ Administrative Territorial Distribution**: Full native support for all **58 Wilayas** and **1,541 Communes** with accurate postal codes and administrative dialing codes.

---

## 💻 Quick Start & Port Reference

### Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- Modern web browser (Chrome, Edge, Firefox, Brave, Safari).

### 1. Clone the Repository
```bash
git clone https://github.com/test-bit-sys/algerie-open-source.git
cd algerie-open-source
```

### 2. Launch the Ecosystem Central Server (Port 3000)
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** to access the central flagship portal and navigate to any application via `/apps/<track>/<app>/`.

### 3. Launch Dedicated Application Servers
You can run any application on its dedicated port independently:

```bash
# 🌳 DZ-Disk-Tree (WizTree Alternative) on http://localhost:3001
npm run start:disk-tree

# 📦 DZ-Archive (WinRAR Alternative) on http://localhost:3002
npm run start:archive

# 🎬 DZ-Player (VLC Alternative) on http://localhost:3003
npm run start:player

# 📄 DZ-PDF Pro (Adobe Acrobat Alternative) on http://localhost:3004
npm run start:pdf
```

---

## 🤝 Contributing & Community Guidelines

We welcome contributions from Algerian and international developers, engineers, designers, accountants, and legal professionals:

1. **Fork** the repository and create a feature branch (`git checkout -b feat/your-feature`).
2. Adhere strictly to the **HeyPuter architectural standard** (Vanilla JS ES Modules, pure SVGs in app UI).
3. Ensure native trilingual support (Arabic RTL default, French, English).
4. Verify code correctness (`node --check <file>` on all JS modules).
5. Submit a detailed **Pull Request** explaining your implementation.

Please read our full [Contributing Guide](docs/CONTRIBUTING.md) and [Code of Conduct](docs/CODE_OF_CONDUCT.md).

---

## 📜 License & Sovereignty

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for complete details.

*🇩🇿 DZ Open Suite is developed for the Algerian nation and community, engineered with pride, autonomy, and zero external compromises.*
