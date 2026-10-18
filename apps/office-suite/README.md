# Office Suite (برامج الأوفيس والوثائق)
## DZ Office — The Algerian Sovereign Document & Productivity Suite

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### Mission
Provide lightweight, modern, free, and 100% offline-first open-source alternatives to Microsoft 365 and Google Workspace, natively tailored for the Algerian administrative, academic, and business landscape with flawless bi-directional Arabic-French support and national templates.

---

### Active Applications in DZ Office Suite

| Project Identifier | Target Application | Proprietary Equivalent | Algerian Specifics & Key Features | Status |
| :--- | :--- | :--- | :--- | :--- |
| [**`dz-word`**](./dz-word/) | [**DZ-Writer (كاتب الجزائر)**](./dz-word/) | Microsoft Word / Google Docs | Bi-directional Arabic-French text engine, official ministerial templates (شهادة عمل، طلب خطي، مذكرة مصلحة، سيرة ذاتية), A4 page canvas, print-to-PDF. (Port 3006) | **Active App** |
| [**`dz-calc`**](./dz-calc/) | [**DZ-Sheets (جداول الجزائر)**](./dz-calc/) | Microsoft Excel / Google Sheets | High-performance calculation grid, native Algerian fiscal functions (`=TAFQIT_AR()`, `=TVA_DZ()`, `=TIMBRE_DZ()`, `=IRG_DZ()`), built-in payroll (Fiche de Paie) & SCF accounting models, instant charts. (Port 3007) | **Active App** |
| [**`dz-slides`**](./dz-slides/) | [**DZ-Impress (عارض الجزائر)**](./dz-slides/) | Microsoft PowerPoint / Google Slides | 16:9 presentation studio with Algerian university thesis defense templates (Soutenance PFE), startup pitch decks, and fullscreen slideshow with elapsed timer & laser pointer. (Port 3008) | **Active App** |
| [**`dz-pdf`**](./dz-pdf/) | [**DZ-PDF Suite (أدوات PDF)**](./dz-pdf/) | Adobe Acrobat Pro | 100% offline PDF merging, page splitting, digital signature stamp, Bates numbering, and Algerian administrative stamps suite. (Port 3004) | **Active App** |

---

### Quick Launch Commands

```bash
# Launch DZ-Word (Port 3006)
npm run start:word

# Launch DZ-Calc (Port 3007)
npm run start:calc

# Launch DZ-Slides (Port 3008)
npm run start:slides

# Launch DZ-PDF (Port 3004)
npm run start:pdf
```
