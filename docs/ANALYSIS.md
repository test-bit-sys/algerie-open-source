# DZ Open Source — Comprehensive Project Analysis (Phase 0)

> **Document Version:** 1.0.0  
> **Date:** October 2026  
> **Architect:** Senior Software Architect & Open Source Integration Engineer  
> **Target:** DZ Open Source Repository (`algerie-open-source`)

---

## 1. Executive Summary

**DZ Open Source** is a national sovereign open-source ecosystem engineered to provide Algerian public administrations, private enterprises, schools, universities, and citizens with high-grade, 100% offline-first, sovereign software alternatives.

The project currently encompasses **29 distinct applications** spanning 12 strategic domain tracks, unified by a central portal (`index.html`), a shared sovereign offline runtime bridge (`packages/dz-runtime/dz-runtime.js`), and polyglot desktop engines across Rust, Python, and C# .NET.

This document establishes the baseline technical assessment of the repository, identifying its architectural foundation, strengths, technical debts, security posture, accessibility, and gaps to guide informed open-source integrations.

---

## 2. Technical Stack & Architecture Assessment

### 2.1 Languages & Framework Distribution

| Technology Layer | Languages / Tools | Applied Scope | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Front-End & Web** | Vanilla JavaScript (ES2022+), HTML5 Canvas, Modern CSS | 29 Web Applications & Central Portal | Zero framework lock-in, ultra-fast cold start, zero build step required for core apps, native browser execution. |
| **Styling & Design** | Pure CSS Custom Properties (CSS Variables) | Global Theme & Per-App Styles | Dual theme (Warm Paper Light & Calm Slate Dark), RTL-first Arabic layout, zero Tailwind bloat. |
| **Native Systems Tier** | Rust (Edition 2021) + Cargo | `dz-disk-tree`, `dz-archive`, `dz-devtools` | Direct NTFS MFT reading, SIMD multi-threaded compression (Zstd/LZMA2), high performance CLI binaries. |
| **Scientific & Engineering** | Python 3.10+ (NumPy, SciPy, Matplotlib) | `dz-rpa`, `dz-photo`, `dz-player` | Implementation of Algerian Seismic Building Code (RPA 99/v2003) and scientific matrix calculations. |
| **Enterprise Financials** | C# (.NET 10 / Avalonia UI) | `dz-compta`, `dz-paie` | Algerian Financial Accounting System (SCF) and Social Security / CNAS declarations requiring fixed-point decimal arithmetic. |
| **Offline Runtime Bridge** | Vanilla JS (`dz-runtime.js`) + IndexedDB | Shared package across all apps | 100% local emulator for Puter SDK (`window.puter.kv`, `fs`, `auth`, `ui`), sovereign backup export. |
| **Build & Dev Tools** | Node.js (>=18), Vite (v8.3), Vitest (v5.0) | Selected bundle apps (`dz-archive`, `dz-player`, `dz-pdf`) | Rapid dev server and bundling where WebAssembly or worker modules are utilized. |

### 2.2 Directory Structure & Organization

```
algerie-open-source/
├── apps/
│   ├── business-enterprise/    # Commercial ERP & Billing (dz-facture)
│   ├── collaboration/          # Team coordination (dz-boards)
│   ├── creative-tools/         # Graphics & Image editing (dz-photo)
│   ├── developer-tools/        # Dev utilities & 58 Wilayas API (dz-devtools)
│   ├── education-academia/     # Interactive Whiteboard (dz-whiteboard)
│   ├── engineering/            # Civil engineering & structural calculations (dz-rpa)
│   ├── finance-accounting/     # Certified Accounting SCF & Payroll (dz-compta, dz-paie)
│   ├── games-interactive/      # Heritage & strategic games (chess, dama, domino, othello, etc.)
│   ├── multimedia/             # Audio workstation & VLC-grade player (dz-audio, dz-player)
│   ├── office-suite/           # Sovereign Office (dz-word, dz-calc, dz-slides, dz-pdf, dz-signature)
│   ├── productivity/           # Utilities (dz-archive, dz-convert, dz-disk-tree, dz-notes, dz-prayer, dz-tasks, dz-time)
│   └── video-montage/          # Screen recording & capture (dz-recorder)
├── assets/                     # Global branding, national badges, logos
├── docs/                       # Architecture documents, standards, legal compliance
├── packages/
│   └── dz-runtime/             # Sovereign Offline Runtime Bridge (Mock Puter SDK + Topbar)
├── tools/                      # Static HTTP server engine (Node.js native http)
├── index.html                  # Central App Portal & Catalog (29+ Apps)
├── server.js                   # Ecosystem Server & Route Dispatcher (Port 3000)
└── package.json                # Monorepo scripts, test runner commands, dev dependencies
```

### 2.3 Routing & Navigation

- **Centralized Hub:** Root `index.html` acts as the ecosystem launcher with live search, domain category filters, direct app launch links, and command-line execution modals for native binaries.
- **Unified Server Dispatch:** `server.js` (powered by `tools/static-server.js`) resolves `/` to the root portal, `/apps/<track>/<app>/` to individual apps, `/packages/*` to shared runtime bridges, and `/assets/*` to ecosystem graphics.
- **Static Hosting Portability:** All application links and asset references use relative paths, preserving 100% functionality on static CDN/GitHub Pages (`https://test-bit-sys.github.io/algerie-open-source/`).

### 2.4 State Management & Storage Architecture

- **Primary Storage:** Pure local-first storage using HTML5 `localStorage` and `IndexedDB`.
- **Sovereign File System (`dz_sovereign_fs`):** Managed by `dz-runtime.js`, storing blobs, documents, PDFs, and media locally without cloud dependency.
- **Zero Remote Telemetry:** No Google Analytics, no third-party CDNs, no tracking pixels, guaranteeing complete data sovereignty under Algerian national jurisdiction.

### 2.5 Testing & CI/CD Framework

- **Automated Node Test Runner:** Monorepo test suite runs via native `node --test` across 56 engine tests covering games AI, fiscal invoice math, spreadsheet formulas, disk scanner logic, and prayer time astronomical algorithms.
- **Syntax Validation:** `node --check` verifies all server and script entry points across the repository.
- **Current Test Status:** 56 tests passing, 0 failing, 0 skipped.

---

## 3. Project Strengths & Competitive Advantages

1. **Absolute Digital Sovereignty & Privacy:**
   - Works 100% offline without requiring internet access or account logins.
   - Immune to foreign cloud embargoes, API deprecations, or data leaks.
2. **Deep Algerian Localization & Regulatory Compliance:**
   - Strict adherence to Algerian Executive Decree 05-468 (NIF, NIS, RC, Article d'Imposition).
   - Built-in Algerian Tafqit engine converting DZD currency figures into formal Arabic words (*دينار جزائري*).
   - Integrated reference data for all 58 Wilayas, postal codes, and local fiscal stamp duties.
3. **Polyglot Architectural Balance:**
   - Web for instant accessibility and zero-install execution.
   - Native Rust and Python where raw CPU throughput, low latency, and direct Win32/MFT hardware access are mandatory.
4. **Trilingual First-Class Citizen:**
   - Native support for Arabic (RTL), French (LTR), and English (LTR).
   - Thoughtful Arabic typography using `Cairo` and monospace `JetBrains Mono`.
5. **Lightweight Footprint:**
   - Absence of bulky JavaScript frameworks enables instant page loads (< 100ms) even on low-spec hardware common in public offices.

---

## 4. Technical Debt & Current Limitations

1. **Uneven Application Maturity:**
   - While flagship apps (`dz-facture`, `dz-calc`, `dz-word`, `dz-pdf`, `dz-games`) are rich and production-grade, several apps (`dz-notes`, `dz-tasks`, `dz-time`) have relatively basic feature sets compared to modern commercial equivalents.
2. **Fragmented Storage Layers:**
   - Some apps directly write to ad-hoc `localStorage` keys rather than standardizing on `window.puter.fs` or `window.puter.kv` provided by `dz-runtime.js`.
3. **Missing Inter-App Data Exchange:**
   - Invoicing (`dz-facture`) does not currently sync customer records to a centralized CRM, nor does it push journal entries directly to `dz-compta`.
4. **Varying i18n Implementations:**
   - While several apps have dedicated trilingual JSON dictionaries with dynamic switching, others have static Arabic or French UI text with partial English coverage.

---

## 5. Security Posture Assessment

1. **Attack Surface:**
   - Very small attack surface due to offline-first design and zero remote API endpoints.
2. **Local File Handling & XSS Risks:**
   - Apps processing uploaded files (`dz-word`, `dz-pdf`, `dz-signature`) must sanitize SVG/HTML inputs using strict DOMPurify or equivalent parsers to prevent DOM-based XSS when opening untrusted user documents.
3. **HTTP Server Security Headers:**
   - `tools/static-server.js` currently serves basic MIME types. It should be augmented with modern security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and restrictive `Content-Security-Policy`.

---

## 6. Usability & Accessibility (a11y) Assessment

1. **Accessibility Strengths:**
   - Strong color contrast ratios in both light and dark modes.
   - Clear semantic headings (`<h1>`, `<h2>`) and legible font sizes.
2. **Areas for Improvement:**
   - Several custom buttons and interactive canvas tools lack `aria-label` and `aria-expanded` attributes for screen readers.
   - Keyboard focus outlines are suppressed in some CSS styles without fallback `:focus-visible` indicators.

---

## 7. Gaps & Opportunities for High-Impact Integrations

To elevate DZ Open Source into an all-inclusive sovereign operating ecosystem, the following functional gaps should be bridged through targeted open-source integrations:

1. **Personal & Team Wiki / Knowledge Base:**
   - Alternative to Notion / Confluence for procedures, circulars, documentation, and university research notes.
2. **Customer Relationship Management (CRM) & Directory:**
   - Alternative to HubSpot / Salesforce for managing client dossiers, leads, phone numbers, and commercial pipelines directly connected to `dz-facture`.
3. **Inventory & Warehouse Stock Control:**
   - Alternative to Zoho Inventory / Sortly for multi-warehouse management, SKU barcodes, minimum stock alerts, and supplier purchase orders.
4. **Developer REST & API Testing Studio:**
   - Offline alternative to Postman / Insomnia for Algerian developers, IT teams, and universities.
5. **No-Code Relational Database (Records):**
   - Modern replacement for legacy Microsoft Access (.mdb) databases widely used in Algerian offices, offering spreadsheet-like tables, relational links, and forms.
6. **CAD 2D Drawing & DXF Plan Viewer:**
   - Essential tool for civil engineers and architects to view architectural drawings without proprietary AutoCAD licenses.
7. **Offline Document OCR Studio:**
   - In-browser Arabic and French OCR for digitizing scanned administrative paperwork locally.
