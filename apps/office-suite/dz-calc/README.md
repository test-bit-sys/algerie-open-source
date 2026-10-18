# DZ-Calc (DZ-Sheets / جداول الجزائر)
## The Sovereign Algerian Open-Source Spreadsheet & Financial Engine

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Mission
**DZ-Calc (جداول الجزائر)** is a 100% offline-first, high-performance data grid and calculation spreadsheet designed as a sovereign Algerian alternative to Microsoft Excel and Google Sheets. It natively includes Algerian fiscal formulas (`=TAFQIT_AR`, `=TVA_DZ`, `=TIMBRE_DZ`, `=IRG_DZ`), SCF accounting templates, and instant data visualization.

---

### Key Capabilities

1. **Native Algerian Fiscal & Financial Functions**
   * `=TAFQIT_AR(A1)`: Automatically converts numerical amounts into official Algerian Arabic currency words (*دينار جزائري وسنتيم*).
   * `=TAFQIT_FR(A1)`: Converts amounts into official French legal currency words (*dinars algériens et centimes*).
   * `=TVA_DZ(amount, [rate])`: Computes Algerian VAT (standard 19% or reduced 9%).
   * `=TTC_DZ(amount, [rate])`: Computes TTC directly from HT.
   * `=TIMBRE_DZ(amount)`: Calculates legal stamp duty according to the Algerian Tax Code (1% on cash settlements, min 5 DZD, max 10,000 DZD).
   * `=IRG_DZ(taxable_salary)`: Calculates estimated Algerian monthly income tax (IRG) based on national progressive brackets.

2. **Standard Spreadsheet Functions**
   * Math & Statistics: `=SUM()`, `=AVERAGE()`, `=MIN()`, `=MAX()`, `=COUNT()`, `=ROUND()`, `=ABS()`, `=SQRT()`.
   * Logic: `=IF(condition, true_value, false_value)`.
   * Arithmetic expressions with cell coordinates: `=A1+B1*2`.

3. **Pre-built Algerian Business Models & Templates**
   * **Fiche de Paie & Livre de Traitements (كشف الرواتب والأجور):** Complete payroll calculation with base wage, bonuses, CNAS social security (9%), IRG deductions, and net salary.
   * **Facture Commerciale & TVA (فاتورة تجارية مع الضريبة والتفقيط):** Line items calculation, TVA, Timbre, and automated Tafqit wording.
   * **TCR — Compte de Résultats SCF (جدول حسابات النتائج):** Standard Algerian financial accounting framework (Accounts 70, 60, 61, 62, 63, 64, EBE).

4. **Interactive Data Visualization & Charts**
   * Generate instant charts from selected cell ranges:
     * Bar Charts (Histogram)
     * Time-series Line Charts
     * Pie Charts (Distribution)

5. **Import & Export Operations**
   * Export to standard CSV.
   * Save and load native `.dzsheet` documents (JSON schema).
   * Clean print-to-PDF formatting (`window.print()`).

---

### Quick Start

Run standalone on port 3007:
```bash
npm run start:calc
# or
node apps/office-suite/dz-calc/server.js
```
Open in browser: `http://localhost:3007/` or via ecosystem hub at `http://localhost:3000/apps/office-suite/dz-calc/`.
