# Business & Enterprise (برامج الإدارة والأعمال)
## DZ Business — Commercial & Enterprise Management Track

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### Mission
Replace clunky, outdated, and cracked commercial management software with modern, secure, and offline-first solutions designed specifically for Algerian merchants, SMEs (PME/TPE), and distributors.

---

### Planned Project Blueprints

| Project Identifier | Target Application | Proprietary Equivalent | Algerian Specifics & Key Features |
| :--- | :--- | :--- | :--- |
| [**`dz-facture`**](./dz-facture/) | **DZ-Facture & POS** [![Ready](https://img.shields.io/badge/Status-100%25%20Completed-success.svg)](./dz-facture/) | Commercial Delphi POS, Sage | Compliant with Executive Decree 05-468, automatic 1% cash stamp duty calculation, thermal receipt printers (80mm/58mm), barcode scanning. |
| **`dz-erp`** | **DZ-Enterprise ERP** | SAP Business One, Odoo Enterprise | Integrated modular ERP: sales, procurement (Bons de commande/réception), customer credits, supplier balances, multi-currency support. |
| **`dz-stock`** | **DZ-Inventory & Warehousing** | Cracked desktop inventory apps | Multi-warehouse tracking, batch number & expiry date monitoring for pharmacies and agri-food businesses, minimum stock alert triggers. |
| **`dz-crm`** | **DZ-Client Relations** | HubSpot, Zoho CRM | Customer relationship management with WhatsApp/SMS notification integrations for Algerian customer follow-up and delivery dispatching. |

---

### ️ Recommended Tech Stack for Contributors
* **Architecture:** Offline-First with SQLite (Local DB) + optional LAN synchronization (multi-caisse).
* **Frontend:** TypeScript + TailwindCSS / Modern Vanilla CSS (Native RTL/LTR).
