# 🏢 Track 01: Business & Administrative Software
## قسم برمجيات الإدارة، الأعمال والمحاسبة

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### 🎯 Overview
This track is dedicated to designing modern, free, and open-source alternatives to commercial and pirated software widely used in Algerian commerce, SMEs, and accounting offices.

---

### 📋 Planned Projects & Specifications

| Program ID | Algerian Target Application | Proprietary Alternative Replaced | Key Features |
| :--- | :--- | :--- | :--- |
| **`dz-facture`** | **DZ-Facture & POS** | Commercial Delphi/Access software, Sage | A4 legal invoices (Decree 05-468), cash stamp duty (1%), thermal receipt printing (80mm/58mm), barcode scanner integration, offline-first SQLite. |
| **`dz-compta`** | **DZ-Compta SCF** | PC Compta, DLG Compta | Full compliance with Algerian Financial Accounting System (SCF), balance sheets (Bilan), profit & loss (TCR), general ledger (Grand Livre), G50 tax assist. |
| **`dz-paie`** | **DZ-Paie & RH** | PC Paie | Payroll calculation according to Algerian labor law, progressive IRG scale, CNAS social contributions (9% worker / 26% employer), ATS certificate export. |
| **`dz-stock`** | **DZ-Stock & Warehouse** | Proprietary stock trackers | Multi-depot inventory tracking, batch expiry date monitoring (for pharmacies & food distributors), purchase orders, and supplier credit balance. |

---

### 🏗️ Technical Architecture
* **Engine:** Tauri (Rust) + TypeScript
* **Local Database:** SQLite (Zero-config, portable file backup on USB flash drive)
* **Shared Libraries Used:** `@dz-suite/fiscal`, `@dz-suite/tafqit`, `@dz-suite/geo`
