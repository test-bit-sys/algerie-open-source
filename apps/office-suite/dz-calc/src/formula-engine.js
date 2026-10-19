/**
 * DZ-Calc — Spreadsheet Formula Engine
 * Evaluates Excel/Google Sheets compatible formulas and Algerian fiscal/financial functions.
 * 100% offline-first, pure JavaScript.
 */

// Algerian Arabic Tafqit dictionary & logic
const AR_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function convertUnder1000Ar(n) {
  let parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(AR_HUNDREDS[h]);
  if (rem >= 10 && rem <= 19) {
    parts.push(AR_TEENS[rem - 10]);
  } else if (rem > 0) {
    const u = rem % 10;
    const t = Math.floor(rem / 10);
    if (u > 0 && t > 0) {
      parts.push(`${AR_UNITS[u]} و${AR_TENS[t]}`);
    } else if (u > 0) {
      parts.push(AR_UNITS[u]);
    } else if (t > 0) {
      parts.push(AR_TENS[t]);
    }
  }
  return parts.join(' و');
}

export function tafqitArabic(amount) {
  if (amount == null || isNaN(amount)) return '';
  const num = Math.round(Number(amount) * 100) / 100;
  if (num === 0) return 'صفر دينار جزائري';
  
  const dinars = Math.floor(Math.abs(num));
  const centimes = Math.round((Math.abs(num) - dinars) * 100);

  let result = [];
  const billions = Math.floor(dinars / 1_000_000_000);
  const millions = Math.floor((dinars % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((dinars % 1_000_000) / 1000);
  const remainder = dinars % 1000;

  if (billions > 0) result.push(`${convertUnder1000Ar(billions)} مليار`);
  if (millions > 0) result.push(`${convertUnder1000Ar(millions)} مليون`);
  if (thousands > 0) {
    if (thousands === 1) result.push('ألف');
    else if (thousands === 2) result.push('ألفان');
    else result.push(`${convertUnder1000Ar(thousands)} آلاف`);
  }
  if (remainder > 0 || result.length === 0) {
    result.push(convertUnder1000Ar(remainder));
  }

  let text = result.join(' و') + ' دينار جزائري';
  if (centimes > 0) {
    text += ` و${convertUnder1000Ar(centimes)} سنتيم`;
  }
  return text;
}

// French Tafqit
const FR_UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingts', 'quatre-vingt-dix'];

function convertUnder100Fr(n) {
  if (n < 20) return FR_UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7) return `soixante-${FR_UNITS[10 + u]}`;
  if (t === 9) return `quatre-vingt-${FR_UNITS[10 + u]}`;
  if (u === 0) return FR_TENS[t];
  if (u === 1 && t < 8) return `${FR_TENS[t]} et un`;
  return `${FR_TENS[t]}-${FR_UNITS[u]}`;
}

function convertUnder1000Fr(n) {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  let res = '';
  if (h === 1) res = 'cent';
  else if (h > 1) res = `${FR_UNITS[h]} cents`;
  if (rem > 0) {
    res = res ? `${res} ${convertUnder100Fr(rem)}` : convertUnder100Fr(rem);
  }
  return res || '';
}

export function tafqitFrench(amount) {
  if (amount == null || isNaN(amount)) return '';
  const num = Math.round(Number(amount) * 100) / 100;
  if (num === 0) return 'zéro dinar algérien';
  const dinars = Math.floor(Math.abs(num));
  const centimes = Math.round((Math.abs(num) - dinars) * 100);
  let res = convertUnder1000Fr(dinars % 1000);
  let text = `${res} dinars algériens`;
  if (centimes > 0) {
    text += ` et ${convertUnder100Fr(centimes)} centimes`;
  }
  return text;
}

// Algerian Fiscal Rules
export function calculateTvaDz(amount, rate = 19) {
  const a = Number(amount) || 0;
  const r = Number(rate) || 19;
  return Math.round(a * (r / 100) * 100) / 100;
}

export function calculateTtcDz(amount, rate = 19) {
  const a = Number(amount) || 0;
  return Math.round((a + calculateTvaDz(a, rate)) * 100) / 100;
}

export function calculateTimbreDz(amount) {
  const a = Number(amount) || 0;
  if (a <= 0) return 0;
  const raw = Math.ceil(a * 0.01);
  return Math.min(10000, Math.max(5, raw));
}

export function calculateCnasDz(brut) {
  const b = Number(brut) || 0;
  return Math.round(b * 0.09 * 100) / 100;
}

export function calculateIrgDz(taxable) {
  const s = Number(taxable) || 0;
  if (s <= 30000) return 0;
  if (s <= 35000) return Math.round((s - 30000) * 0.23);
  if (s <= 120000) return Math.round(1150 + (s - 35000) * 0.27);
  return Math.round(24100 + (s - 120000) * 0.30);
}

// Cell coordinate helpers: "A1" -> { col: 0, row: 0 }
export function parseCellAddress(addr) {
  if (!addr || typeof addr !== 'string') return null;
  const m = addr.toUpperCase().match(/^([A-Z]+)([0-9]+)$/);
  if (!m) return null;
  const colStr = m[1];
  const rowNum = parseInt(m[2], 10) - 1;
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  return { col: col - 1, row: rowNum };
}

export function colToLetter(colIndex) {
  let str = '';
  let n = colIndex + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

export class FormulaEngine {
  constructor(getCellValueFn) {
    this.getCellValue = getCellValueFn;
  }

  evaluate(formula) {
    if (!formula || typeof formula !== 'string') return formula;
    if (!formula.startsWith('=')) return formula;
    const expr = formula.slice(1).trim();

    try {
      return this.evaluateExpression(expr);
    } catch (err) {
      console.warn('Formula eval error:', err);
      return '#VALUE!';
    }
  }

  evaluateExpression(expr) {
    // Nested functions handling
    const fnMatch = expr.match(/^([A-Z_0-9]+)\s*\((.*)\)$/i);
    if (fnMatch) {
      const fnName = fnMatch[1].toUpperCase();
      const rawArgs = this.splitArgs(fnMatch[2]);
      return this.executeFunction(fnName, rawArgs);
    }

    // Direct arithmetic / logical expression: replace cell tokens with values
    let sanitized = expr.replace(/[A-Z]+[0-9]+/gi, (token) => {
      const v = this.resolveValue(token);
      return typeof v === 'number' ? v : (parseFloat(v) || 0);
    });

    if (/^[0-9+\-*/().\s^%><=!&|]+$/.test(sanitized)) {
      sanitized = sanitized.replace(/\^/g, '**');
      try {
        const res = Function(`"use strict"; return (${sanitized})`)();
        return typeof res === 'number' ? (Math.round(res * 10000) / 10000) : res;
      } catch (e) {
        return '#ERR!';
      }
    }

    return expr;
  }

  splitArgs(argsStr) {
    const args = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if ((char === ',' || char === ';') && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) args.push(current.trim());
    return args;
  }

  expandRange(rangeStr) {
    const parts = rangeStr.split(':');
    if (parts.length !== 2) return [rangeStr];
    const start = parseCellAddress(parts[0].trim());
    const end = parseCellAddress(parts[1].trim());
    if (!start || !end) return [rangeStr];

    const cells = [];
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        cells.push(`${colToLetter(c)}${r + 1}`);
      }
    }
    return cells;
  }

  resolveValue(token) {
    if (token == null) return '';
    token = String(token).trim();

    // Nested formula like =IF(...) or SUM(...)
    if (token.startsWith('=')) {
      return this.evaluate(token);
    }
    if (/^[A-Z_0-9]+\(.*\)$/i.test(token)) {
      return this.evaluateExpression(token);
    }

    if (token.includes(':')) {
      return this.expandRange(token).map(cell => this.resolveValue(cell));
    }
    const addr = parseCellAddress(token);
    if (addr) {
      const val = this.getCellValue(addr.col, addr.row);
      if (val != null && !isNaN(val) && val !== '') {
        return Number(val);
      }
      return val ?? '';
    }
    if (!isNaN(token)) return Number(token);
    return token.replace(/^["']|["']$/g, '');
  }

  flattenNumericArgs(rawArgs) {
    const nums = [];
    for (const arg of rawArgs) {
      if (typeof arg === 'string' && arg.includes(':')) {
        const expanded = this.expandRange(arg);
        for (const cell of expanded) {
          const v = this.resolveValue(cell);
          if (typeof v === 'number' && !isNaN(v)) nums.push(v);
        }
      } else {
        const v = this.resolveValue(arg);
        if (typeof v === 'number' && !isNaN(v)) nums.push(v);
        else if (Array.isArray(v)) {
          v.forEach(item => { if (typeof item === 'number' && !isNaN(item)) nums.push(item); });
        }
      }
    }
    return nums;
  }

  executeFunction(name, rawArgs) {
    switch (name) {
      // 1. Math & Statistics
      case 'SUM':
      case 'SOMME': {
        const nums = this.flattenNumericArgs(rawArgs);
        return nums.reduce((a, b) => a + b, 0);
      }
      case 'AVERAGE':
      case 'MOYENNE': {
        const nums = this.flattenNumericArgs(rawArgs);
        return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
      }
      case 'MIN': {
        const nums = this.flattenNumericArgs(rawArgs);
        return nums.length ? Math.min(...nums) : 0;
      }
      case 'MAX': {
        const nums = this.flattenNumericArgs(rawArgs);
        return nums.length ? Math.max(...nums) : 0;
      }
      case 'COUNT':
      case 'NB': {
        const nums = this.flattenNumericArgs(rawArgs);
        return nums.length;
      }
      case 'COUNTA':
      case 'NBVAL': {
        let count = 0;
        for (const arg of rawArgs) {
          if (typeof arg === 'string' && arg.includes(':')) {
            const cells = this.expandRange(arg);
            for (const c of cells) {
              const v = this.resolveValue(c);
              if (v !== '' && v != null) count++;
            }
          } else {
            const v = this.resolveValue(arg);
            if (v !== '' && v != null) count++;
          }
        }
        return count;
      }
      case 'COUNTIF':
      case 'NB.SI': {
        const range = typeof rawArgs[0] === 'string' && rawArgs[0].includes(':') ? this.expandRange(rawArgs[0]) : [rawArgs[0]];
        const target = this.resolveValue(rawArgs[1]);
        let count = 0;
        for (const cell of range) {
          const v = this.resolveValue(cell);
          if (String(v) === String(target)) count++;
        }
        return count;
      }
      case 'SUMIF':
      case 'SOMME.SI': {
        const range = typeof rawArgs[0] === 'string' && rawArgs[0].includes(':') ? this.expandRange(rawArgs[0]) : [rawArgs[0]];
        const target = this.resolveValue(rawArgs[1]);
        const sumRange = rawArgs[2] ? (rawArgs[2].includes(':') ? this.expandRange(rawArgs[2]) : [rawArgs[2]]) : range;
        let sum = 0;
        for (let i = 0; i < range.length; i++) {
          const v = this.resolveValue(range[i]);
          if (String(v) === String(target)) {
            const num = Number(this.resolveValue(sumRange[i])) || 0;
            sum += num;
          }
        }
        return sum;
      }
      case 'ROUND':
      case 'ARRONDI': {
        const val = Number(this.resolveValue(rawArgs[0])) || 0;
        const dec = Number(this.resolveValue(rawArgs[1])) || 0;
        const factor = Math.pow(10, dec);
        return Math.round(val * factor) / factor;
      }
      case 'ROUNDUP': {
        const val = Number(this.resolveValue(rawArgs[0])) || 0;
        const dec = Number(this.resolveValue(rawArgs[1])) || 0;
        const factor = Math.pow(10, dec);
        return Math.ceil(val * factor) / factor;
      }
      case 'ROUNDDOWN': {
        const val = Number(this.resolveValue(rawArgs[0])) || 0;
        const dec = Number(this.resolveValue(rawArgs[1])) || 0;
        const factor = Math.pow(10, dec);
        return Math.floor(val * factor) / factor;
      }
      case 'ABS': {
        return Math.abs(Number(this.resolveValue(rawArgs[0])) || 0);
      }
      case 'SQRT':
      case 'RACINE': {
        return Math.sqrt(Number(this.resolveValue(rawArgs[0])) || 0);
      }
      case 'POWER':
      case 'PUISSANCE': {
        const b = Number(this.resolveValue(rawArgs[0])) || 0;
        const p = Number(this.resolveValue(rawArgs[1])) || 0;
        return Math.pow(b, p);
      }
      case 'MOD': {
        const n = Number(this.resolveValue(rawArgs[0])) || 0;
        const d = Number(this.resolveValue(rawArgs[1])) || 1;
        return n % d;
      }
      case 'INT': {
        return Math.floor(Number(this.resolveValue(rawArgs[0])) || 0);
      }

      // 2. Logic
      case 'IF':
      case 'SI': {
        const cond = this.resolveValue(rawArgs[0]);
        const valTrue = this.resolveValue(rawArgs[1]);
        const valFalse = rawArgs[2] != null ? this.resolveValue(rawArgs[2]) : '';
        return cond ? valTrue : valFalse;
      }
      case 'AND':
      case 'ET': {
        return rawArgs.every(a => Boolean(this.resolveValue(a)));
      }
      case 'OR':
      case 'OU': {
        return rawArgs.some(a => Boolean(this.resolveValue(a)));
      }
      case 'NOT':
      case 'NON': {
        return !Boolean(this.resolveValue(rawArgs[0]));
      }
      case 'IFERROR':
      case 'SIERREUR': {
        try {
          const res = this.resolveValue(rawArgs[0]);
          return (res === '#VALUE!' || res === '#ERR!' || res === '#NAME?') ? this.resolveValue(rawArgs[1]) : res;
        } catch (e) {
          return this.resolveValue(rawArgs[1]);
        }
      }

      // 3. Text
      case 'CONCAT':
      case 'CONCATENATE': {
        return rawArgs.map(a => this.resolveValue(a)).join('');
      }
      case 'UPPER':
      case 'MAJUSCULE': {
        return String(this.resolveValue(rawArgs[0])).toUpperCase();
      }
      case 'LOWER':
      case 'MINUSCULE': {
        return String(this.resolveValue(rawArgs[0])).toLowerCase();
      }
      case 'TRIM':
      case 'SUPPRESPACE': {
        return String(this.resolveValue(rawArgs[0])).trim();
      }
      case 'LEN':
      case 'NBCAR': {
        return String(this.resolveValue(rawArgs[0])).length;
      }
      case 'LEFT':
      case 'GAUCHE': {
        const str = String(this.resolveValue(rawArgs[0]));
        const count = Number(this.resolveValue(rawArgs[1])) || 1;
        return str.substring(0, count);
      }
      case 'RIGHT':
      case 'DROITE': {
        const str = String(this.resolveValue(rawArgs[0]));
        const count = Number(this.resolveValue(rawArgs[1])) || 1;
        return str.substring(str.length - count);
      }
      case 'MID':
      case 'STXT': {
        const str = String(this.resolveValue(rawArgs[0]));
        const start = (Number(this.resolveValue(rawArgs[1])) || 1) - 1;
        const len = Number(this.resolveValue(rawArgs[2])) || str.length;
        return str.substring(start, start + len);
      }

      // 4. Date & Time
      case 'TODAY':
      case 'AUJOURDHUI': {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      case 'NOW':
      case 'MAINTENANT': {
        return new Date().toLocaleString('ar-DZ');
      }
      case 'YEAR':
      case 'ANNEE': {
        const d = new Date(this.resolveValue(rawArgs[0]));
        return isNaN(d) ? new Date().getFullYear() : d.getFullYear();
      }

      // 5. Algerian Sovereign & Fiscal Functions
      case 'TAFQIT_AR':
      case 'تفقيط': {
        const val = this.resolveValue(rawArgs[0]);
        return tafqitArabic(val);
      }
      case 'TAFQIT_FR': {
        const val = this.resolveValue(rawArgs[0]);
        return tafqitFrench(val);
      }
      case 'TVA_DZ': {
        const val = this.resolveValue(rawArgs[0]);
        const rate = rawArgs[1] ? this.resolveValue(rawArgs[1]) : 19;
        return calculateTvaDz(val, rate);
      }
      case 'TTC_DZ': {
        const val = this.resolveValue(rawArgs[0]);
        const rate = rawArgs[1] ? this.resolveValue(rawArgs[1]) : 19;
        return calculateTtcDz(val, rate);
      }
      case 'TIMBRE_DZ': {
        const val = this.resolveValue(rawArgs[0]);
        return calculateTimbreDz(val);
      }
      case 'CNAS_DZ': {
        const val = this.resolveValue(rawArgs[0]);
        return calculateCnasDz(val);
      }
      case 'IRG_DZ': {
        const val = this.resolveValue(rawArgs[0]);
        return calculateIrgDz(val);
      }
      case 'SALAIRE_NET_DZ': {
        const brut = Number(this.resolveValue(rawArgs[0])) || 0;
        const prime = Number(this.resolveValue(rawArgs[1])) || 0;
        const cnas = calculateCnasDz(brut);
        const taxable = (brut + prime) - cnas;
        const irg = calculateIrgDz(taxable);
        return Math.round((taxable - irg) * 100) / 100;
      }

      default:
        return `#NAME? (${name})`;
    }
  }
}

if (typeof window !== 'undefined') {
  window.FormulaEngine = FormulaEngine;
  window.tafqitArabic = tafqitArabic;
  window.tafqitFrench = tafqitFrench;
  window.parseCellAddress = parseCellAddress;
  window.colToLetter = colToLetter;
}
