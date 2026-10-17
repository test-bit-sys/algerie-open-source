<p align="center">
  <img src="assets/banner.jpg" alt="DZ Open Suite - Algerian Open Source Ecosystem" width="100%">
</p>

<h1 align="center">🇩🇿 Algerian Open Source Software Ecosystem</h1>
<h3 align="center">DZ Open Suite — Modern, Free & Localized Software for Algeria</h3>

<p align="center">
  <a href="README.md"><b>English</b></a> •
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.fr.md"><b>Français</b></a>
</p>

<p align="center">
  <a href="https://github.com/test-bit-sys/algerie-open-source/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="License: MIT"></a>
  <a href="#"><img src="https://img.shields.io/badge/Status-Architectural_Framework-blue.svg?style=for-the-badge" alt="Status"></a>
  <a href="#"><img src="https://img.shields.io/badge/Languages-Arabic_%7C_French_%7C_English-d21034.svg?style=for-the-badge" alt="Trilingual"></a>
  <a href="#"><img src="https://img.shields.io/badge/Architecture-Offline--First-0ea5e9.svg?style=for-the-badge&logo=sqlite&logoColor=white" alt="Offline-First"></a>
  <a href="https://github.com/test-bit-sys/algerie-open-source/pulls"><img src="https://img.shields.io/badge/PRs-Welcome-purple.svg?style=for-the-badge&logo=github" alt="PRs Welcome"></a>
</p>

---

## 🌟 Vision & Mission

**DZ Open Suite** is a unified national open-source initiative engineered to provide high-performance, privacy-respecting, and 100% free software alternatives to the legacy proprietary and pirated tools commonly used across Algerian enterprises, schools, media studios, and public administrations.

By designing the blueprints and specifications from scratch with the **Algerian economic, legal, and linguistic ecosystem** in mind, this project aims to foster local tech sovereignty, eliminate dependence on expensive recurring subscriptions, and empower Algerian developers and creators.

---

## 🗺️ Software Categories & Track Taxonomy

The ecosystem is organized into **5 specialized tracks**, establishing the functional standards and blueprints for each software domain:

```
algerie-open-source/
│
├── 📁 apps/
│   ├── 🏢 01-business-management/    # Invoicing, Accounting (SCF), Payroll (CNAS), Inventory
│   ├── 🎬 02-creative-multimedia/      # Video Editing (Montage), Graphic Design, Audio Engineering
│   ├── 📝 03-office-productivity/      # Word Processor, Spreadsheets, PDF Tools, Presentations
│   ├── 🎓 04-education-academia/       # School Grading, Timetable Generation, University Thesis
│   └── 🛠️ 05-system-utilities/         # Postal (CCP) Slips, Administrative Forms, Postal Directory
│
├── 📁 assets/                          # High-resolution banners and visual identity
└── 📁 docs/                            # Algerian legal, fiscal, and technical specifications
    ├── standards/                      # VAT laws, timbre fiscal, tafqit rules, 58 wilayas
    ├── architecture/                   # Local-first system blueprints
    └── CONTRIBUTING.md                 # Multi-language developer contribution guide
```

---

## 📊 Comprehensive Software Track Matrix

| Track | Target Application | Proprietary Alternative Replaced | Key Algerian Specifics |
| :--- | :--- | :--- | :--- |
| **🏢 Business** | `dz-facture` | Sage, Delphi POS, pirated cash registers | Executive Decree 05-468 A4 invoices, 1% cash stamp duty, 80mm receipt printers. |
| **🏢 Business** | `dz-compta` | PC Compta, DLG | Financial Accounting System (SCF), Bilan, TCR, G50 tax preparation. |
| **🏢 Business** | `dz-paie` | PC Paie | Progressive IRG brackets, CNAS contributions (9% / 26%), ATS documents. |
| **🎬 Creative** | `dz-video` | Adobe Premiere Pro, CapCut PC | Non-linear video editor with native RTL Arabic subtitles (no broken/reversed letters). |
| **🎬 Creative** | `dz-photo` | Adobe Photoshop, Canva | Raster & vector editing with Algerian social media and billboard presets. |
| **🎬 Creative** | `dz-audio` | Adobe Audition, FL Studio | Multi-track podcast mastering, noise reduction, and voiceover leveling. |
| **📝 Office** | `dz-docs` | Microsoft Word | Bi-directional Arabic-French typing engine, Algerian ministerial document templates. |
| **📝 Office** | `dz-sheets` | Microsoft Excel | Native Algerian formulas (`=TAFQIT_AR()`, `=TVA_DZ()`, `=TIMBRE_DZ()`). |
| **📝 Office** | `dz-pdf` | Adobe Acrobat Pro, iLovePDF | 100% offline PDF merger, digital signature, and administrative form filler (S12). |
| **🎓 Education** | `dz-school` | Legacy Access databases | Grading system, coefficients, quarterly report cards (Bulletins de notes). |
| **🎓 Education** | `dz-schedule` | FET, manual scheduling | Automated classroom & teacher timetable generation with zero clashes. |
| **🛠️ Utilities** | `dz-ccp-tool` | Manual handwriting | Automatic printing of official postal checks and CCP payment slips. |

---

## 🏛️ System Architecture & Core Standards

```mermaid
graph TD
    subgraph "Algerian Open Source Ecosystem (DZ Open Suite)"
        subgraph "Software Tracks (apps/)"
            A1[🏢 Business Management]
            A2[🎬 Creative & Multimedia]
            A3[📝 Office Productivity]
            A4[🎓 Education & Academia]
            A5[🛠️ System Utilities]
        end

        subgraph "Algerian Core Standards (docs/standards/)"
            S1[Legal & Fiscal: VAT 19%/9% & Timbre 1%]
            S2[Currency Tafqit: Trilingual Number-to-Words]
            S3[Administrative Geography: 58 Wilayas]
            S4[Bi-Directional RTL/LTR Typography]
        end

        subgraph "Local-First Architecture"
            DB[(Embedded SQLite / Zero-Cloud)]
            USB[One-Click Flash Drive Backup]
        end
    end

    A1 --> S1
    A1 --> S2
    A1 --> S3
    A2 --> S4
    A3 --> S2
    A3 --> S4
    A4 --> S3
    A5 --> S2
    A1 --> DB
    DB --> USB
```

---

## 🤝 Contributing

We welcome software developers, legal experts, certified accountants, teachers, and graphic designers to contribute to this national initiative!

1. Explore the track directories under [`apps/`](apps/).
2. Review our [Contributing Guide](docs/CONTRIBUTING.md).
3. Open a Pull Request or file an issue to join the effort.

---

## 📜 License

This project is licensed under the **MIT License** — free to use, modify, and distribute for personal and commercial purposes.
