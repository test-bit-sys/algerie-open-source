# 🇩🇿 Algerian Open Source Software Ecosystem
## DZ Open Suite — Modern, Free & Localized Software for Algeria

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.fr.md"><b>Français</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/Tests-15%20Passing-brightgreen.svg" alt="Tests">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-green.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Languages-Arabic%20%7C%20French%20%7C%20English-orange.svg" alt="Trilingual">
  <img src="https://img.shields.io/badge/Offline--First-Supported-teal.svg" alt="Offline-First">
</p>

---

### 🌟 Overview

**DZ Open Suite** is an ambitious open-source initiative dedicated to engineering production-grade, privacy-respecting, and free software alternatives to the legacy proprietary tools commonly used across Algeria. 

Designed specifically for the Algerian economic and administrative landscape, the ecosystem combines **strict local legal compliance** with modern software engineering standards.

---

### 🔑 Key Pillars

* **Trilingual by Design:** Native bidirectional support for **Arabic (RTL)**, **French (LTR)**, and **English (LTR)** across all apps and utilities.
* **100% Algerian Legal & Fiscal Compliance:**
  * National identification number validators (**NIF 15-digits**, **NIS 20-digits**, **RC**, **Article d'Imposition**, **RIP/CCP**).
  * Automated calculation of Algerian Value-Added Tax (**TVA 19% & 9%**) and Cash Stamp Duty (**Timbre Fiscal 1%**).
  * Invoices strictly comply with Algerian Executive Decree n° 05-468.
  * Real-time number-to-words currency conversion (**Tafqit DZD**) in Arabic, French, and English with fraud-prevention legal seals.
* **Offline-First & Local-First:** Runs entirely locally with zero mandatory cloud dependencies. Data is stored safely on local drives with instant USB flash backup support.
* **Lightweight Desktop Runtime:** Engineered for low-spec and older office PCs typically found in stores, administrations, and SMEs.

---

### 🏛️ Monorepo Architecture

This repository is structured as a modular Monorepo managed with native npm workspaces:

```
algerie-open-source/
│
├── 📁 docs/                     # Legal, fiscal, and technical architecture specs
│   ├── standards/               # Algerian VAT, stamp duty, and administrative rules
│   ├── architecture/            # System blueprints and hardware integration
│   └── CONTRIBUTING.md          # Multi-language developer contribution guidelines
│
├── 📁 packages/                 # Standalone, reusable core packages
│   ├── dz-tafqit/               # Trilingual Algerian Dinar number-to-words converter
│   ├── dz-geo/                  # Official 58 Wilayas database and postal code search
│   ├── dz-fiscal/               # Tax calculation engine & NIF/NIS/RC/CCP validators
│   └── dz-ui/                   # Trilingual RTL/LTR design system and UI components
│
└── 📁 apps/                     # Desktop and web business applications
    ├── dz-facture/              # Flagship POS, inventory & legal invoice studio
    ├── dz-paie/                 # Payroll, salary slips & CNAS compliance (Phase 3)
    └── dz-idara/                # Administrative documents & certificate generator
```

---

### 📦 Packages at a Glance

| Package | Version | Description | Tests |
| :--- | :--- | :--- | :--- |
| **`@dz-suite/tafqit`** | `1.0.0` | Converts amounts to written currency words in Arabic, French, and English | ✅ 5/5 Passing |
| **`@dz-suite/fiscal`** | `1.0.0` | Algerian tax engine (TVA, Timbre Fiscal) and NIF/NIS/RC/CCP validators | ✅ 7/7 Passing |
| **`@dz-suite/geo`** | `1.0.0` | Complete database of all 58 Algerian Wilayas and administrative search | ✅ 3/3 Passing |

---

### 🚀 Quick Start

#### Prerequisites
* [Node.js](https://nodejs.org/) (version 20 or higher)
* npm (bundled with Node)

#### Installation & Testing
```bash
# 1. Clone the repository
git clone https://github.com/dz-open-suite/algerie-open-source.git
cd algerie-open-source

# 2. Run unit tests across all packages
npm test

# 3. Launch the DZ-Facture Studio locally
npm start
```

After running `npm start`, navigate to **`http://localhost:3000`** in your browser.

---

### 📄 Invoice Studio Demo (`DZ-Facture`)

* **Real-time Tax Computation:** Automatic calculation of HT, TVA (19% & 9%), and cash stamp duty (Timbre fiscal).
* **Trilingual Switcher:** Toggle smoothly between Arabic (RTL), French (LTR), and English (LTR).
* **A4 Print Engine:** Instant generation of official Algerian invoices ready for stamping and signature.

---

### 🤝 Contributing

We welcome contributions from developers, accountants, translators, and designers across Algeria and the world! Please see our [Contributing Guide](docs/CONTRIBUTING.md) to get started.

---

### 📜 License

This project is licensed under the **MIT License** — feel free to use, modify, and distribute it for both personal and commercial purposes.
