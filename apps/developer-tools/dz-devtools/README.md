# DZ-DevTools Pro (أدوات ومكتبات المطورين الجزائريين)
## The Sovereign Algerian Developer Platform, 58 Wilayas & Communes Explorer & Fiscal Validators

[English](README.md) • [العربية](../../../README.ar.md) • [Français](../../../README.fr.md)

---

### Mission
**DZ-DevTools Pro** is an open-source, 100% offline-first developer platform providing Algerian administrative geographic datasets (58 Wilayas, major communes, postal codes, telephone area codes), fiscal and banking validation algorithms (NIF, NIS, RC, CCP Mod-97, Edahabia/CIB Luhn check), telecom carrier inspectors, and instant data export in JSON, CSV, SQL, and JavaScript ES Module.

---

### Key Capabilities

1. **Algerian Administrative Geography (58 Wilayas & Communes Studio)**
   * Complete verified dataset of all 58 Wilayas:
     * Official 2-digit code (`01` to `58`).
     * Arabic & French official names.
     * Capital (Chef-lieu).
     * Postal code prefix (e.g. `16000`, `31000`, `25000`).
     * Telephone area code (Zone indicatif: `021`, `041`, `031`, etc.).
     * License plate matricule code (`01` to `58`).
     * Regional classification (Centre, Est, Ouest, Sud).
     * List of major Communes & Dairas with exact postal codes.
   * Real-time search by name, code, postal code, or telephone area code.
   * One-click Data Export Center:
     * Export to JSON (`algeria-58-wilayas.json`)
     * Export to CSV (`algeria-58-wilayas.csv`)
     * Export to SQL (`CREATE TABLE & INSERT INTO ...`)
     * Export to JavaScript/TypeScript ES Module

2. **Algerian Fiscal & Banking Validators**
   * **NIF (رقم التعريف الجبائي):** 15 digits validation with wilaya activity structure.
   * **NIS (رقم التعريف الإحصائي):** 20 digits validation.
   * **RC (السجل التجاري):** Standard CNRC format validation (`16/00-1234567B22`).
   * **Algérie Poste CCP Clé Mod-97 Calculator:** Calculates the official 2-digit check digit for any CCP account.
   * **Postal RIP Generator:** Produces the full 20-digit postal RIP (`007 99999 ...`).
   * **Edahabia & CIB Card Inspector:** Validates card numbers against the Luhn algorithm and detects issuer BINs (Algérie Poste Edahabia `628058`, SATIM CIB `6037`).

3. **Algerian Telecom & Mobile Carrier Inspector**
   * Instant detection of operator network:
     * Mobilis (`06xx`)
     * Djezzy (`07xx`)
     * Ooredoo (`05xx`)
     * Algérie Télécom Fixe (`02x / 03x / 04x`)
   * Standardization to local `06 12 34 56 78` and international `+213` E.164 formats.

4. **Tafqit API Sandbox & Code Snippets**
   * Real-time conversion of numerical dinar amounts into legal Arabic and French text.
   * Ready-to-use SDK code snippets in JavaScript, Python, PHP, and cURL.

---

### Quick Start

Run standalone on port 3009:
```bash
npm run start:devtools
# or
node apps/developer-tools/dz-devtools/server.js
```
Open in browser: `http://localhost:3009/` or via ecosystem hub at `http://localhost:3000/apps/developer-tools/dz-devtools/`.
