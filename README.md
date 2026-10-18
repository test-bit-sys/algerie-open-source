<div align="center">

<img src="assets/logo.jpg" alt="DZ Open Suite" width="640">

# DZ Open Suite

### The Algerian National Open-Source Desktop Software Ecosystem
**100% Sovereign • Privacy-First • Zero Cloud Dependency • Native Trilingual (AR / FR / EN)**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#architectural-principles)
[![Platforms: Web & Desktop](https://img.shields.io/badge/Platform-Web_%7C_Desktop-0284c7.svg?style=for-the-badge&logo=electron&logoColor=white)](#quick-start)
[![Languages: AR · FR · EN](https://img.shields.io/badge/Languages-Arabic_%7C_Français_%7C_English-dc2626.svg?style=for-the-badge)](#internationalization)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-7c3aed.svg?style=for-the-badge&logo=github&logoColor=white)](docs/CONTRIBUTING.md)

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.fr.md"><b>Français</b></a>
</p>

</div>

---

## Table of Contents

- [Mission & Strategic Vision](#mission--strategic-vision)
- [Flagship Desktop Applications (1:1 Native Alternatives)](#flagship-desktop-applications-11-native-alternatives)
  - [1. DZ-Facture & POS (Sage / Odoo Alternative)](#1-dz-facture--pos-port-3000)
  - [2. DZ-Disk-Tree (WizTree 1:1 Alternative)](#2-dz-disk-tree-port-3001)
  - [3. DZ-Archive (WinRAR 1:1 Alternative)](#3-dz-archive-port-3002)
  - [4. DZ-Player (VLC Media Player 1:1 Alternative)](#4-dz-player-port-3003)
  - [5. DZ-PDF Pro (Adobe Acrobat Pro 1:1 Alternative)](#5-dz-pdf-pro-port-3004)
- [Architectural Principles](#architectural-principles)
- [Monorepo Structure (11 Specialized Tracks)](#monorepo-structure-11-specialized-tracks)
- [Algerian Regulatory & Legal Compliance](#algerian-regulatory--legal-compliance)
- [Quick Start & Local Deployment](#quick-start--local-deployment)
- [Contributing & Development Workflow](#contributing--development-workflow)
- [License & Sovereignty](#license--sovereignty)

---

## Mission & Strategic Vision

**DZ Open Suite** is a nationwide sovereign software initiative engineered to build, standardize, and maintain production-grade, 100% free and open-source desktop alternatives to the proprietary and frequently pirated software tools pervasive throughout Algerian public administrations, enterprises, universities, and small businesses.

### Core Objectives
1. **Eradicate Pirated & Outdated Legacy Software**: Replace unmaintained legacy solutions (Visual Basic 6, Delphi 7, Microsoft Access 2003) and cracked proprietary utilities with secure, auditable, high-performance web-standard software.
2. **National Data Sovereignty**: Ensure that financial ledgers, administrative acts, citizen records, and executive deliberations never leak to third-party proprietary clouds. All processing is strictly local (Offline-First).
3. **Strict Algerian Legal & Fiscal Alignment**: Enforce compliance with Executive Decree 05-468 (Commercial Invoicing), Law 18-05 (Electronic Commerce), SCF accounting standards, VAT rules (19% standard, 9% reduced), Timbre Fiscal, Tafqit in Algerian Dinars (DZD), and official administrative stamping.
4. **Engineering Excellence (HeyPuter Standard)**: Pure Vanilla JavaScript ES Modules, HTML5, Modern CSS, zero bloated external frameworks (no React/Vue/Angular baggage), zero telemetry, zero emojis, and pure SVG vector graphics.

---

## Flagship Desktop Applications (1:1 Native Alternatives)

| Application | Replaced Proprietary Software | Local Port | Launch Command | Core Capabilities |
| :--- | :--- | :---: | :--- | :--- |
| **DZ-Facture & POS** | **Sage 100 / Odoo POS** | `:3000` | `npm start` | Executive Decree 05-468 invoicing, retail POS cash register, VAT/Timbre engine, DZD Tafqit, 58 Wilayas database. |
| **DZ-Disk-Tree** | **WizTree 1:1** | `:3001` | `npm run start:disk-tree` | Synchronized tree grid + cushioned treemap, multi-column sorting, keyboard arrow navigation, printable HTML audit reports. |
| **DZ-Archive** | **WinRAR 1:1** | `:3002` | `npm run start:archive` | WinRAR iconic toolbar, 6-tab archive options dialog, AES-256-GCM encryption, Text/Hex 16-byte/Media preview, hardware benchmark. |
| **DZ-Player** | **VLC Media Player 1:1** | `:3003` | `npm run start:player` | Authentic VLC interface, volume boost up to 300%, unified effects (Ctrl+E): 10-band EQ, compressor, video geometry, sync delay. |
| **DZ-PDF Pro** | **Adobe Acrobat Pro 1:1** | `:3004` | `npm run start:pdf` | Acrobat toolbar & menus, official Algerian administrative stamps (Republic circular seal, Conforme à l'Original), certified signature pad, Bates numbering, page organizer. |

---

### 1. DZ-Facture & POS (Port :3000)
*Location: [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/)*

The national open-source billing, point-of-sale, and commercial management solution tailored specifically for Algerian businesses.
- **Regulatory Invoice Layout**: Enforces NIF (15 digits), NIS (20 digits), RC, Article d'Imposition, and bank RIB credentials.
- **Tafqit Currency Converter**: Converts amounts to written legal Arabic, French, and English Dinars (e.g., *ثمانمائة وإحدى عشر ألف وسبعمائة دينار جزائري لا غير*).
- **Dual POS / Invoice Mode**: Fast barcode scanning, thermal ticket printing (58mm/80mm), customer receipts, and A4 enterprise invoicing.
- **Z-Report & Daily Closings**: End-of-day register balancing with cash drawer audits and daily expense accounting.

---

### 2. DZ-Disk-Tree (Port :3001)
*Location: [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/)*

A 1:1 high-speed desktop alternative to **WizTree** and TreeSize for scanning, auditing, and reclaiming storage space.
- **Desktop Split Layout**: Live hierarchical multi-column tree grid in the top pane and squarified cushioned treemap in the bottom pane with an interactive draggable splitter.
- **Bidirectional Selection**: Clicking any node in the tree highlights and zooms the treemap; clicking any visual tile selects the file in the tree grid.
- **Multi-Column Sorting**: Interactive sorting by Name, % Parent, Allocated Space, File Count, Folder Count, and Last Modified Date with ascending/descending visual carets.
- **Desktop Arrow Navigation**: Full keyboard navigation (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Backspace`).
- **Executive Audit Report**: Generates an executive printable HTML audit document with embedded canvas treemap snapshot and breakdown tables.

---

### 3. DZ-Archive (Port :3002)
*Location: [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/)*

A 1:1 desktop alternative to **WinRAR** and 7-Zip designed to pack, inspect, encrypt, and test compressed archives.
- **Iconic WinRAR Interface**: Full desktop menu bar (`File`, `Commands`, `Tools`, `Options`, `Help`) and big command toolbar (`Add`, `Extract To`, `Test`, `View`, `Delete`, `Find`, `Wizard`, `Info`, `Lock`, `Comment`, `Benchmark`).
- **6-Tab Compression Dialog**: Desktop modal with `General`, `Advanced`, `Files`, `Backup`, `Time`, and `Comment` configuration tabs.
- **AES-256-GCM Cryptographic Security**: Hardware-accelerated client-side encryption via Web Crypto API with PBKDF2 key derivation.
- **Multi-Mode Internal Viewer**: Fast file inspection with Text view, Hex Dump view (16-byte aligned hex offsets + ASCII side-by-side), and Media preview without extracting to disk.
- **Hardware Compression Benchmark**: Multi-threaded compression speed meter (MB/s) and real-time rating score based on available hardware cores.

---

### 4. DZ-Player (Port :3003)
*Location: [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/)*

A 1:1 desktop media player alternative to **VLC Media Player** with deep audio-processing capabilities.
- **Authentic VLC Experience**: Classic VLC top menus, dark high-contrast video viewport, orange cone emblem, and bottom control bar.
- **300% Volume Super-Boost**: Custom `GainNode` audio graph pipeline capable of clean amplification up to 300% for quiet recordings.
- **Unified "Adjustments and Effects" Window (Ctrl+E)**:
  - **10-Band Graphic Equalizer**: Standard center frequencies (60Hz to 16kHz) with presets (Rock, Pop, Classical, Flat, Full Bass, Voice).
  - **Audio Compressor**: Full dynamic range compression (`DynamicsCompressorNode`) with Threshold, Knee, Ratio, Attack, and Release controls.
  - **Video Geometry & Colors**: Real-time 90°/180°/270° rotation, horizontal flip, brightness, contrast, saturation, and hue rotation.
  - **Synchronization**: Sub-millisecond audio and subtitle track synchronization delay/advance controls.
- **Playback Precision**: A-B repeat looping, frame-by-frame snapshot capture, and network stream playback (HTTP/HTTPS/HLS).

---

### 5. DZ-PDF Pro (Port :3004)
*Location: [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/)*

A 1:1 desktop alternative to **Adobe Acrobat Pro** for inspecting, annotating, organizing, and signing official PDF documents.
- **Acrobat Command Palette**: Selection tool (`V`), Hand pan tool (`H`), Freehand pen (`P`), Text highlighter (`U`), Typewriter text tool (`T`), Blackout redaction tool (`R`), and Sticky notes (`N`).
- **Official Algerian Administrative Stamps**:
  - **Circular Seal of the Republic**: Dual-ring seal of the People's Democratic Republic of Algeria (*الجمهورية الجزائرية الديمقراطية الشعبية / République Algérienne Démocratique et Populaire*) with national crescent and star, Wilaya, and date.
  - **Official Administrative Boxes**: *Conforme à l'Original*, *Courrier Arrivé / Reçu le*, *Payé Intégralement*, *Strictement Confidentiel*, *Vu et Approuvé*, *Annulé*, and *Très Urgent*.
- **Certified Digital Signature Pad**: Velocity-sensitive vector signature pad with multiple ink colors (Diplomatic Blue, Bureau Black, Emerald Green, Violet), signatory metadata (Name, Role, Wilaya, Date), and SHA verification code.
- **Page Organizer & Sorter**: Thumbnail grid view for drag-and-drop page reordering, individual and batch 90° rotation, page duplication, deletion, and blank page insertion.
- **Built-in Administrative Templates**: Instant demonstration with authentic Algerian administrative certificates and commercial contracts in DZD.

---

## Architectural Principles

All applications in the DZ Open Suite monorepo strictly observe the **HeyPuter / everything** architectural guidelines:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DZ Open Suite Monorepo                          │
├────────────────────────────────────────────────────────────────────────┤
│  Layer 1: Native Web Platform (HTML5 Canvas 2D · Web Audio · Web Crypto)│
│  Layer 2: Vanilla ES Modules (Zero Build Step required in production)   │
│  Layer 3: Local Storage / IndexedDB (100% Offline-First)               │
│  Layer 4: Bi-directional Design System (RTL Arabic / LTR FR & EN)      │
│  Layer 5: Zero-Emoji Vector Policy (Strictly SVG icons)               │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Zero External Framework Dependencies**: No React, Angular, Vue, or heavy npm bundles in runtime applications. Native DOM and Vanilla JavaScript ES Modules yield instant boot times and long-term maintainability.
2. **Offline-First & Local-Storage First**: Complete autonomy from internet access. Applications work indefinitely in disconnected environments (such as remote municipal branches, hospitals, border posts, and industrial zones).
3. **Native Bi-Directionality & RTL**: Arabic is treated as a primary first-class citizen with natural Right-to-Left (RTL) flow, alongside clean Left-to-Right (LTR) French and English.
4. **Vector Discipline**: All visual indicators, controls, and branding use pure, mathematical SVG vectors. No emojis are permitted anywhere in production user interfaces or codebases.

---

## Monorepo Structure (11 Specialized Tracks)

```
algerie-open-source/
├── apps/
│   ├── business-enterprise/      # Track 02: Invoicing, Retail POS, Stock, ERP
│   │   └── dz-facture/           # DZ-Facture & POS (Port 3000)
│   ├── productivity/             # Track 07: System utilities & citizen tools
│   │   ├── dz-disk-tree/         # DZ-Disk-Tree WizTree clone (Port 3001)
│   │   └── dz-archive/           # DZ-Archive WinRAR clone (Port 3002)
│   ├── multimedia/               # Track 04: Audio/Video players & montage
│   │   └── dz-player/            # DZ-Player VLC clone (Port 3003)
│   ├── office-suite/             # Track 01: PDF, Documents, Spreadsheets
│   │   └── dz-pdf/               # DZ-PDF Pro Acrobat clone (Port 3004)
│   ├── finance-accounting/       # Track 03: SCF Accounting, G50, CNAS Paie
│   ├── creative-tools/           # Track 05: Vector graphics, photo editing
│   ├── collaboration/            # Track 06: Team chat, local kanban boards
│   ├── engineering/              # Track 08: CAD, Algerian Seismic RPA 99/2003
│   ├── developer-tools/          # Track 09: SATIM/CIB SDK, 58 Wilayas CLI
│   ├── education-academia/       # Track 10: School grading, timetables
│   └── games-interactive/        # Track 11: Cultural games, geography quizzes
├── assets/                       # High-resolution logos, banners, and stamps
├── docs/                         # Legal, fiscal, and engineering blueprints
│   ├── standards/                # VAT laws, timbre fiscal, tafqit rules
│   ├── architecture/             # System architecture and blueprints
│   └── CONTRIBUTING.md           # Developer onboarding guidelines
├── tools/                        # Shared zero-dependency local static servers
│   └── static-server.js          # Hardened HTTP static server
├── server.js                     # Root ecosystem portal server
└── package.json                  # Workspace script orchestration
```

---

## Algerian Regulatory & Legal Compliance

DZ Open Suite is built specifically to address Algerian operational realities:

- **Executive Decree 05-468**: Sets mandatory specifications for commercial invoices, receipts, and electronic point-of-sale registers.
- **Law 18-05**: Governs electronic commerce, digital contracts, and electronic signatures across the national territory.
- **Fiscal Regulations**:
  - Standard VAT rate (Taux Normal): **19%**
  - Reduced VAT rate (Taux Réduit): **9%**
  - Fiscal Stamp Duty (Droit de Timbre Fiscal): **1%** on cash transactions (minimum 5 DZD, maximum 10,000 DZD).
- **Administrative Territorial Distribution**: Full native support for all **58 Wilayas** and **1,541 Communes** with accurate postal codes and administrative dialing codes.

---

## Quick Start & Local Deployment

### Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- Modern web browser (Chrome, Edge, Firefox, Brave, Safari).

### 1. Clone the Repository
```bash
git clone https://github.com/test-bit-sys/algerie-open-source.git
cd algerie-open-source
```

### 2. Launch the Ecosystem Server (Port 3000)
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) to access the central flagship portal and navigate to any application via `/apps/<track>/<app>/`.

### 3. Launch Dedicated Application Servers
You can run any application on its dedicated port independently:

```bash
# DZ-Disk-Tree (WizTree Alternative) on http://localhost:3001
npm run start:disk-tree

# DZ-Archive (WinRAR Alternative) on http://localhost:3002
npm run start:archive

# DZ-Player (VLC Alternative) on http://localhost:3003
npm run start:player

# DZ-PDF Pro (Adobe Acrobat Alternative) on http://localhost:3004
npm run start:pdf
```

---

## Contributing & Development Workflow

We welcome contributions from Algerian and international developers, engineers, designers, accountants, and legal professionals:

1. **Fork** the repository and create a feature branch (`git checkout -b feat/your-feature`).
2. Adhere strictly to the **HeyPuter architectural standard** (Vanilla JS ES Modules, pure SVGs, zero emojis).
3. Ensure native trilingual support (Arabic RTL default, French, English).
4. Verify code correctness (`node --check <file>` on all JS modules).
5. Submit a detailed **Pull Request** explaining your implementation.

Please read our full [Contributing Guide](docs/CONTRIBUTING.md) and [Code of Conduct](docs/CODE_OF_CONDUCT.md).

---

## License & Sovereignty

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for complete details.

*DZ Open Suite is developed for the Algerian community, engineered with pride, autonomy, and zero external compromises.*
