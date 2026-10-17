# 📦 `@dz-suite/tafqit`
## Trilingual Algerian Dinar Number-to-Words Converter

A lightweight, standalone JavaScript library that converts numerical currency amounts into formal written words in **Arabic**, **French**, and **English**, tailored specifically for the **Algerian Dinar (DZD)** and **Centimes**.

---

### ✨ Features
* **Trilingual:** Accurate grammatical rules for Arabic (RTL), French, and English.
* **Accounting Fraud Prevention:** Appends official legal suffixes (*"لا غير"*, *"et zéro centime"*, *"only"*).
* **Fractional Precision:** Handles Dinars and Centimes with zero external dependencies.
* **100% Test Coverage:** Verified with edge cases, zero amounts, and multi-billion figures.

---

### 💻 Installation & Usage

```javascript
import { tafqitDZD } from '@dz-suite/tafqit';

// 1. Arabic (Default)
tafqitDZD(154230.50, { lang: 'ar', legalSuffix: true });
// => "مائة وأربعة وخمسون ألفاً ومائتان وثلاثون ديناراً جزائرياً وخمسون سنتیماً لا غير"

// 2. French
tafqitDZD(154230.50, { lang: 'fr', legalSuffix: true });
// => "Cent cinquante-quatre mille deux cent trente Dinars Algériens et cinquante Centimes"

// 3. English
tafqitDZD(154230.50, { lang: 'en', legalSuffix: true });
// => "One hundred and fifty-four thousand two hundred and thirty Algerian Dinars and fifty Centimes only"
```

---

### 🧪 Testing
```bash
npm test
```
