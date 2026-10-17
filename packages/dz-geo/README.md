# 📦 `@dz-suite/geo`
## Official 58 Algerian Wilayas & Administrative Divisions Database

Complete database and query utilities for the 58 official Wilayas (provinces) of the People's Democratic Republic of Algeria.

---

### 🗺️ Data Overview
* **All 58 Wilayas:** From `01 Adrar` to `58 El Menia`.
* **Trilingual Names:** Arabic, French, and Latin scripts.
* **Fast Lookup:** Retrieve by official 2-digit numeric code or name query.

---

### 💻 Usage Example

```javascript
import { getWilayas, getWilayaByCode, searchWilayas } from '@dz-suite/geo';

// Get list in Arabic or French
const list = getWilayas('ar'); // [{ code: '16', name: 'الجزائر' }, ...]

// Lookup by code
const alger = getWilayaByCode('16');
console.log(alger.nameFr); // "Alger"

// Search by substring
const results = searchWilayas('oran');
console.log(results[0].code); // "31"
```
