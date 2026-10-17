# 📦 `@dz-suite/fiscal`
## Algerian Fiscal & Tax Calculation Engine

A unified fiscal calculation and validation engine conforming to Algerian tax legislation (DGI, Code des Impôts Directs, Code du Timbre).

---

### ✨ Features

1. **National Identifier Validators:**
   * **NIF:** 15-digit Tax Identification Number.
   * **NIS:** 20-digit Statistical Identification Number.
   * **RC:** Commercial Register number (with Wilaya prefix and company/individual type).
   * **CCP Key:** Algerian Post (Algérie Poste) account check digit calculation.

2. **Tax & Invoicing Mathematics:**
   * **TVA Rates:** Normal (19%), Reduced (9%), and Exonerated (0%).
   * **Cash Stamp Duty (Timbre Fiscal):** Automatic 1% calculation for cash payments with statutory minimums and maximums.
   * **Full Breakdown:** Computes Total HT, VAT breakdown, and Grand Total TTC.

---

### 💻 Usage Example

```javascript
import { calculateInvoiceTotals, validateNIF, PAYMENT_METHODS } from '@dz-suite/fiscal';

// Validate NIF
const isValid = validateNIF('001216012345678'); // true

// Calculate Invoice
const totals = calculateInvoiceTotals({
  items: [
    { quantity: 2, unitPriceHT: 5000, tvaRate: 19 },
    { quantity: 1, unitPriceHT: 2000, tvaRate: 9 }
  ],
  paymentMethod: PAYMENT_METHODS.ESPECES // Applies 1% cash stamp duty
});

console.log(totals.grandTotalTTC); // Total including taxes and fiscal stamp
```
