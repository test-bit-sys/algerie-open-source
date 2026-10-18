# Office Suite (برامج الأوفيس والوثائق)
## DZ Office — Document & Office Productivity Track

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### Mission
Provide lightweight, modern, free, and open-source alternatives to Microsoft 365 and Google Workspace, natively tailored for the Algerian administrative, academic, and business landscape with flawless bi-directional Arabic-French support.

---

### Planned Project Blueprints

| Project Identifier | Target Application | Proprietary Equivalent | Algerian Specifics & Key Features |
| :--- | :--- | :--- | :--- |
| **`dz-word`** | **DZ-Writer (محرر النصوص)** | Microsoft Word | Mixed Arabic-French text engine without cursor dislocation, official ministerial header templates, administrative memo & certificate formats. |
| **`dz-calc`** | **DZ-Sheets (الجداول الحسابية)** | Microsoft Excel | High-speed data grid, pre-loaded Algerian fiscal & financial functions (`=TAFQIT_AR()`, `=TVA_DZ()`, `=TIMBRE_DZ()`). |
| **`dz-slides`** | **DZ-Impress (العروض التقديمية)** | Microsoft PowerPoint | Minimalist presentation slides with pre-built themes for Algerian university defenses (Soutenance PFE) and company pitches. |
| **`dz-pdf`** | [**DZ-PDF Suite (أدوات ملفات PDF)**](./dz-pdf/) | Adobe Acrobat Pro | 100% offline PDF merging, page splitting, digital signature stamp, and automated form filling (S12 civil status forms, residence certificates). **[Active App]** |

---

### ️ Recommended Tech Stack for Contributors
* **Desktop Runtime:** Tauri (Rust) or Electron
* **Rendering Engine:** Web Canvas / Slate.js / TipTap for rich text editing
* **Export Engines:** Rust-based PDF generators / WASM
