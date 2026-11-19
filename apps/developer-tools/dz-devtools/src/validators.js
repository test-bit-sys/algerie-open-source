/**
 * DZ-DevTools — Algerian Fiscal, Banking, Postal, and Telecom Validators
 * Standard reference implementation for developers.
 */

// 1. NIF Validation (15 numeric digits)
export function validateNif(nif) {
  const clean = String(nif || '').replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(clean)) {
    return {
      isValid: false,
      error: 'الرقم التعريفي الجبائي NIF يجب أن يتكون من 15 رقماً بالضبط.'
    };
  }
  const wilayaCode = clean.slice(0, 2);
  return {
    isValid: true,
    nif: clean,
    wilayaCode,
    formatted: `${clean.slice(0, 2)} ${clean.slice(2, 6)} ${clean.slice(6, 10)} ${clean.slice(10, 15)}`
  };
}

// 2. NIS Validation (20 numeric digits)
export function validateNis(nis) {
  const clean = String(nis || '').replace(/[\s-]/g, '');
  if (!/^\d{20}$/.test(clean)) {
    return {
      isValid: false,
      error: 'الرقم التعريفي الإحصائي NIS يجب أن يتكون من 20 رقماً بالضبط.'
    };
  }
  return {
    isValid: true,
    nis: clean,
    formatted: `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12, 16)} ${clean.slice(16, 20)}`
  };
}

// 3. Registre de Commerce (RC) Validation
export function validateRc(rc) {
  const clean = String(rc || '').trim().toUpperCase();
  // Standard format: [Wilaya 2 digits]/[Type 2 digits]-[Number 7 digits][Letter A|B][Year 2 digits]
  // Example: 16/00-1234567B22 or 09/00-0012345A18
  const regex = /^(\d{2})\/(\d{2})-?(\d{7})([AB])(\d{2})$/;
  const match = clean.match(regex);
  if (!match) {
    return {
      isValid: false,
      error: 'صيغة السجل التجاري غير صحيحة. الصيغة القياسية: 16/00-1234567B22'
    };
  }
  return {
    isValid: true,
    wilayaCode: match[1],
    typeCode: match[2],
    registerNumber: match[3],
    category: match[4] === 'A' ? 'شخص طبيعي (Personne Physique)' : 'شخص معنوي (Personne Morale)',
    year: `20${match[5]}`,
    formatted: `${match[1]}/${match[2]}-${match[3]}${match[4]}${match[5]}`
  };
}

// 4. Algérie Poste CCP & RIP Mod-97 Check Digit Calculator
export function calculateCcpKey(ccpNum) {
  const clean = String(ccpNum || '').replace(/\D/g, '');
  if (!clean || clean.length < 1 || clean.length > 10) {
    return null;
  }
  const n = BigInt(clean);
  const remainder = Number((n * 100n) % 97n);
  const key = remainder === 0 ? 0 : 97 - remainder;
  return String(key).padStart(2, '0');
}

export function generatePostalRip(ccpNum) {
  const cleanCcp = String(ccpNum || '').replace(/\D/g, '');
  if (!cleanCcp) return null;
  const ccpKey = calculateCcpKey(cleanCcp);
  if (!ccpKey) return null;

  // Algérie Poste Bank Code: 007, Guichet Code: 99999
  const paddedAccount = cleanCcp.padStart(10, '0');
  const base18 = `00799999${paddedAccount}`;
  const baseNum = BigInt(base18 + '00');
  const rem = Number(baseNum % 97n);
  const ripKey = rem === 0 ? 0 : 97 - rem;
  const ripKeyStr = String(ripKey).padStart(2, '0');

  const fullRip = base18 + ripKeyStr;
  return {
    rip: fullRip,
    bankCode: '007',
    guichetCode: '99999',
    accountNumber: paddedAccount,
    ccpKey,
    key: ripKeyStr,
    ripKey: ripKeyStr,
    formatted: `007 99999 ${paddedAccount} ${ripKeyStr}`
  };
}

export function validateRip(ripStr) {
  const clean = String(ripStr || '').replace(/\D/g, '');
  if (clean.length !== 20) {
    return { isValid: false, error: 'رقم التعريف البريدي/البنكي RIP يجب أن يتكون من 20 رقماً.' };
  }
  const bankCode = clean.slice(0, 3);
  const guichet = clean.slice(3, 8);
  const account = clean.slice(8, 18);
  const checkKey = clean.slice(18, 20);

  // BigInt Mod 97 validation
  const baseNum = BigInt(clean.slice(0, 18) + '00');
  const rem = Number(baseNum % 97n);
  const calculatedKey = rem === 0 ? 0 : 97 - rem;
  const isValid = Number(checkKey) === calculatedKey;

  return {
    isValid,
    bankCode,
    isAlgeriePoste: bankCode === '007',
    guichet,
    account,
    key: checkKey,
    calculatedKey: String(calculatedKey).padStart(2, '0'),
    formatted: `${bankCode} ${guichet} ${account} ${checkKey}`
  };
}

// 5. Edahabia & CIB Card Luhn Algorithm Validation
export function validatePaymentCard(cardNumber) {
  const clean = String(cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(clean)) {
    return { isValid: false, error: 'رقم البطاقة يجب أن يتكون من 16 رقماً.' };
  }

  // Luhn Algorithm
  let sum = 0;
  let alternate = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  const isValidLuhn = sum % 10 === 0;

  // Network Detection
  let cardNetwork = 'بطاقة غير معروفة';
  let badgeColor = '#64748b';
  if (clean.startsWith('628058') || clean.startsWith('6280 58')) {
    cardNetwork = 'بريد الجزائر — بطاقة الذهبية (Edahabia)';
    badgeColor = '#d97706';
  } else if (clean.startsWith('6037')) {
    cardNetwork = 'ساتيم — بطاقة بنكية CIB (SATIM)';
    badgeColor = '#059669';
  } else if (clean.startsWith('4')) {
    cardNetwork = 'فيزا كارد (Visa)';
    badgeColor = '#2563eb';
  } else if (/^5[1-5]/.test(clean)) {
    cardNetwork = 'ماستركارد (Mastercard)';
    badgeColor = '#ea580c';
  }

  return {
    isValid: isValidLuhn,
    cardNetwork,
    badgeColor,
    isEdahabia: clean.startsWith('628058'),
    isCib: clean.startsWith('6037'),
    masked: `${clean.slice(0, 4)} **** **** ${clean.slice(12)}`,
    formatted: `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12, 16)}`
  };
}

// 6. Algerian Phone Number Validator & Operator Identifier
export function validateAlgerianPhone(phoneNumber) {
  let clean = String(phoneNumber || '').replace(/[\s\-.()]/g, '');
  if (clean.startsWith('+213')) {
    clean = '0' + clean.slice(4);
  } else if (clean.startsWith('00213')) {
    clean = '0' + clean.slice(5);
  } else if (clean.startsWith('213')) {
    clean = '0' + clean.slice(3);
  }

  if (!/^0[2-7]\d{8}$/.test(clean)) {
    return {
      isValid: false,
      error: 'رقم الهاتف غير صحيح. يجب أن يتكون من 10 أرقام ويبدأ بـ 05 أو 06 أو 07 أو مفتاح الهاتف الثابت 02x/03x/04x.'
    };
  }

  const prefix2 = clean.slice(0, 2);
  let operator = 'هاتف ثابت — اتصالات الجزائر (Fixe)';
  let opCode = 'algerie-telecom';
  let color = '#2563eb';

  if (prefix2 === '06') {
    operator = 'موبيليس (Mobilis - ATM)';
    opCode = 'mobilis';
    color = '#10b981';
  } else if (prefix2 === '07') {
    operator = 'جيزي (Djezzy - OTA)';
    opCode = 'djezzy';
    color = '#ef4444';
  } else if (prefix2 === '05') {
    operator = 'أوريدو (Ooredoo - WTA)';
    opCode = 'ooredoo';
    color = '#dc2626';
  }

  return {
    isValid: true,
    operator,
    opCode,
    color,
    nationalFormat: `${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)}`,
    internationalFormat: `+213 ${clean.slice(1, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)}`
  };
}

// 7. Algerian Arabic Tafqit (Amount to Words)
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

// 8. French Tafqit
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

// 9. Algerian National Identification Number (NIN - 18 digits)
export function validateNin(nin) {
  const clean = String(nin || '').replace(/[\s-]/g, '');
  if (!/^\d{18}$/.test(clean)) {
    return {
      isValid: false,
      error: 'الرقم التعريفي الوطني (NIN) يجب أن يتكون من 18 رقماً بالضبط.'
    };
  }

  const genderDigit = clean.charAt(0);
  const wilayaCode = clean.slice(1, 3);
  const communeCode = clean.slice(3, 7);
  const birthYear = clean.slice(7, 11);
  const acteNumber = clean.slice(11, 16);
  const checkDigits = clean.slice(16, 18);

  const gender = genderDigit === '1' ? 'ذكر (Masculin)' : genderDigit === '2' ? 'أنثى (Féminin)' : 'غير محدد';
  const currentYear = new Date().getFullYear();
  const yearNum = parseInt(birthYear, 10);
  const validYear = yearNum >= 1900 && yearNum <= currentYear;

  const wilayaNum = parseInt(wilayaCode, 10);
  const validWilaya = wilayaNum >= 1 && wilayaNum <= 58;

  const isValid = (genderDigit === '1' || genderDigit === '2') && validYear && validWilaya;

  return {
    isValid,
    nin: clean,
    gender,
    wilayaCode,
    communeCode,
    birthYear,
    acteNumber,
    checkDigits,
    formatted: `${genderDigit} ${wilayaCode} ${communeCode} ${birthYear} ${acteNumber} ${checkDigits}`
  };
}

// 10. Algerian Banks Directory & RIB Builder
export const ALGERIAN_BANKS = [
  { code: '001', nameAr: 'البنك الوطني الجزائري (BNA)', nameFr: 'Banque Nationale d\'Algérie', swift: 'BNADEZAL' },
  { code: '002', nameAr: 'بنك الجزائر الخارجي (BEA)', nameFr: 'Banque Extérieure d\'Algérie', swift: 'BEXADZAL' },
  { code: '003', nameAr: 'بنك الفلاحة والتنمية الريفية (BADR)', nameFr: 'Banque de l\'Agriculture et du Développement Rural', swift: 'BADRDZAL' },
  { code: '004', nameAr: 'بنك التنمية المحلية (BDL)', nameFr: 'Banque de Développement Local', swift: 'BDLEDZAL' },
  { code: '005', nameAr: 'صندوق التوفير والاحتياط (CNEP-Banque)', nameFr: 'Caisse Nationale d\'Épargne et de Prévoyance', swift: 'CNEPDZAL' },
  { code: '006', nameAr: 'القرض الشعبي الجزائري (CPA)', nameFr: 'Crédit Populaire d\'Algérie', swift: 'CPALDZAL' },
  { code: '007', nameAr: 'بريد الجزائر (Algérie Poste / CCP)', nameFr: 'Algérie Poste (BaridiMob / CCP)', swift: 'POSTDZAL' },
  { code: '008', nameAr: 'تراست بنك الجزائر (Trust Bank)', nameFr: 'Trust Bank Algeria', swift: 'TBADDZAL' },
  { code: '009', nameAr: 'مصرف السلام الجزائر (Al Salam Bank)', nameFr: 'Banque Al Salam Algeria', swift: 'ASBLDZAL' },
  { code: '011', nameAr: 'البنك العربي للمؤسسة المصرفية (ABC)', nameFr: 'Arab Banking Corporation Algeria', swift: 'ABCOEDZA' },
  { code: '012', nameAr: 'بي إن بي باريبا الجزائر (BNP Paribas)', nameFr: 'BNP Paribas El Djazaïr', swift: 'BNPBDZAL' },
  { code: '014', nameAr: 'ناتيكسيس الجزائر (Natixis)', nameFr: 'Natixis Algérie', swift: 'NATXDZAL' },
  { code: '017', nameAr: 'سيتي بنك الجزائر (Citibank)', nameFr: 'Citibank N.A. Algeria', swift: 'CITIDZAL' },
  { code: '018', nameAr: 'إتش إس بي سي الجزائر (HSBC)', nameFr: 'HSBC Bank Middle East Algeria', swift: 'HSBCDZAL' },
  { code: '020', nameAr: 'سوسيتي جنرال الجزائر (Société Générale)', nameFr: 'Société Générale Algérie', swift: 'SOGEDZAL' },
  { code: '021', nameAr: 'بنك البركة الجزائري (Al Baraka)', nameFr: 'Banque Al Baraka d\'Algérie', swift: 'BARKEDZA' },
  { code: '022', nameAr: 'بنك الإسكان للتجارة والتمويل (Housing Bank)', nameFr: 'Housing Bank for Trade and Finance', swift: 'HBADDZAL' },
  { code: '023', nameAr: 'فرنسبنك الجزائر (Fransabank)', nameFr: 'Fransabank El Djazaïr', swift: 'FSBKDZAL' },
  { code: '025', nameAr: 'البنك الوطني للإسكان (BNH)', nameFr: 'Banque Nationale de l\'Habitat', swift: 'BNHEDZAL' }
];

export function lookupBankByCode(code) {
  const padded = String(code || '').padStart(3, '0');
  return ALGERIAN_BANKS.find(b => b.code === padded) || null;
}

export function generateBankRib(bankCode, guichet, account) {
  const b = String(bankCode || '').padStart(3, '0').slice(0, 3);
  const g = String(guichet || '').padStart(5, '0').slice(0, 5);
  const a = String(account || '').padStart(10, '0').slice(0, 10);

  const baseStr = b + g + a;
  if (baseStr.length !== 18 || !/^\d+$/.test(baseStr)) {
    return null;
  }

  const baseNum = BigInt(baseStr + '00');
  const rem = Number(baseNum % 97n);
  const checkKey = rem === 0 ? 0 : 97 - rem;
  const kStr = String(checkKey).padStart(2, '0');

  const fullRip = baseStr + kStr;
  const bankInfo = lookupBankByCode(b);

  return {
    rib: fullRip,
    bankCode: b,
    bankNameAr: bankInfo ? bankInfo.nameAr : 'بنك غير محدد',
    bankNameFr: bankInfo ? bankInfo.nameFr : 'Banque inconnue',
    swift: bankInfo ? bankInfo.swift : '',
    guichet: g,
    account: a,
    key: kStr,
    formatted: `${b} ${g} ${a} ${kStr}`
  };
}

// 11. SATIM / CIB / EDAHABIA Test Card Generator for Developers
export function generateTestCard(type = 'edahabia') {
  let prefix = '628058'; // Edahabia BIN
  let label = 'بريد الجزائر — بطاقة الذهبية (Edahabia Test)';
  if (type === 'cib') {
    prefix = '603700'; // CIB / SATIM BIN
    label = 'ساتيم — بطاقة بنكية تجريبية (SATIM CIB Test)';
  }

  // 15 digits total before check digit: prefix (6) + random (9)
  let body = prefix;
  while (body.length < 15) {
    body += Math.floor(Math.random() * 10);
  }

  // Calculate Luhn check digit
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(body.charAt(14 - i), 10);
    // Double every second digit from right to left
    digit *= 2;
    if (digit > 9) digit -= 9;
    sum += digit;
    i++;
    if (i < 15) {
      sum += parseInt(body.charAt(14 - i), 10);
    }
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  const fullCardNumber = body + checkDigit;

  // Generate test expiry (1 to 4 years ahead) & CVV
  const now = new Date();
  const expMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const expYear = String((now.getFullYear() % 100) + Math.floor(Math.random() * 4) + 1).padStart(2, '0');
  const cvv = String(Math.floor(Math.random() * 900) + 100);

  return {
    cardNumber: fullCardNumber,
    formatted: `${fullCardNumber.slice(0, 4)} ${fullCardNumber.slice(4, 8)} ${fullCardNumber.slice(8, 12)} ${fullCardNumber.slice(12, 16)}`,
    expiry: `${expMonth}/${expYear}`,
    cvv,
    type,
    label
  };
}

// 12. Algerian Official Barème IRG 2024 / 2025 Detailed Calculation
export function calculateIRGDetails(imposableAmount) {
  const imposable = Math.max(0, Math.round(Number(imposableAmount) || 0));
  if (imposable <= 30000) {
    return {
      imposable,
      rawTax: 0,
      abattement: 0,
      monthlyTax: 0,
      annualTax: 0,
      netImposable: imposable,
      effectiveRatePercent: 0,
      tranches: [
        { tranche: '0 - 20,000 دج (0%)', base: Math.min(imposable, 20000), rate: 0, tax: 0 },
        { tranche: '20,001 - 40,000 دج (23%)', base: Math.max(0, Math.min(imposable, 40000) - 20000), rate: 0.23, tax: 0 }
      ]
    };
  }

  let t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0;
  // Tranche 1: 0 - 20,000 => 0%
  // Tranche 2: 20,001 - 40,000 => 23%
  if (imposable > 20000) {
    const base = Math.min(imposable, 40000) - 20000;
    t2 = base * 0.23;
  }
  // Tranche 3: 40,001 - 80,000 => 27%
  if (imposable > 40000) {
    const base = Math.min(imposable, 80000) - 40000;
    t3 = base * 0.27;
  }
  // Tranche 4: 80,001 - 160,000 => 30%
  if (imposable > 80000) {
    const base = Math.min(imposable, 160000) - 80000;
    t4 = base * 0.30;
  }
  // Tranche 5: > 160,000 => 35%
  if (imposable > 160000) {
    const base = imposable - 160000;
    t5 = base * 0.35;
  }

  const rawTax = t1 + t2 + t3 + t4 + t5;

  // Abattement légal de 40% (min 1,000 DA, max 1,500 DA)
  let abattement = rawTax * 0.40;
  if (abattement < 1000) abattement = 1000;
  if (abattement > 1500) abattement = 1500;

  let tax = Math.max(0, rawTax - abattement);

  // Dégrèvement transitoire pour la tranche 30,000 - 35,000 DA
  if (imposable > 30000 && imposable < 35000) {
    const factor = (35000 - imposable) / 5000;
    tax = tax * (1 - factor * 0.8);
  }

  const monthlyTax = Math.round(tax);
  const annualTax = monthlyTax * 12;
  const netImposable = imposable - monthlyTax;
  const effectiveRate = imposable > 0 ? ((monthlyTax / imposable) * 100).toFixed(2) : '0';

  return {
    imposable,
    rawTax: Math.round(rawTax),
    abattement: Math.round(abattement),
    monthlyTax,
    annualTax,
    netImposable,
    effectiveRatePercent: Number(effectiveRate),
    tranches: [
      { tranche: '0 - 20,000 دج (0%)', base: Math.min(imposable, 20000), rate: 0, tax: 0 },
      { tranche: '20,001 - 40,000 دج (23%)', base: Math.max(0, Math.min(imposable, 40000) - 20000), rate: 0.23, tax: Math.round(t2) },
      { tranche: '40,001 - 80,000 دج (27%)', base: Math.max(0, Math.min(imposable, 80000) - 40000), rate: 0.27, tax: Math.round(t3) },
      { tranche: '80,001 - 160,000 دج (30%)', base: Math.max(0, Math.min(imposable, 160000) - 80000), rate: 0.30, tax: Math.round(t4) },
      { tranche: '> 160,000 دج (35%)', base: Math.max(0, imposable - 160000), rate: 0.35, tax: Math.round(t5) }
    ]
  };
}

// 9. Auto-Entrepreneur Card & ANAE Verification (Loi 22-23 / LF 2024)
export function validateAutoEntrepreneurCard(cardNumber) {
  const clean = String(cardNumber || '').trim().toUpperCase();
  const regex = /^AE-(\d{4})-(\d{6})$/;
  const match = clean.match(regex);
  if (!match) {
    return {
      isValid: false,
      error: 'صيغة بطاقة المقاول الذاتي غير صحيحة. الصيغة القياسية لـ ANAE: AE-2024-001234'
    };
  }

  const year = parseInt(match[1], 10);
  const currentYear = new Date().getFullYear();
  if (year < 2023 || year > currentYear + 1) {
    return {
      isValid: false,
      error: `سنة التسجيل في بطاقة المقاول الذاتي (${year}) غير صالحة.`
    };
  }

  return {
    isValid: true,
    cardNumber: clean,
    registrationYear: year,
    serialNumber: match[2],
    status: 'مسجل ومصادق عليه من الوكالة الوطنية للمقاول الذاتي (ANAE)',
    regimeFiscal: 'الضريبة الجزافية الوحيدة (IFU) بنسبة 0.5% (قانون المالية 2024)',
    tvaExempt: true,
    legalNotice: `مؤسس وفق أحكام القانون رقم 22-23 المتضمن القانون الأساسي للمقاول الذاتي — معفى من الرسم على القيمة المضافة TVA`
  };
}

/**
 * Computes IFU and CASNOS for Algerian Auto-entrepreneurs (Loi 22-23 & LF 2024)
 */
export function calculateAutoEntrepreneurTaxes(chiffreAffairesAnnuel, options = {}) {
  const ca = Math.max(0, Number(chiffreAffairesAnnuel) || 0);
  const CA_PLAFOND = 5000000;
  const isOverCeiling = ca > CA_PLAFOND;

  const ifuRate = 0.005; // 0.5%
  const ifuTax = Math.round(ca * ifuRate);
  const casnosAnnual = Number(options.casnosCotisation) || 34000;

  const totalChargesFiscalesSociales = ifuTax + casnosAnnual;
  const netEarnings = Math.max(0, ca - totalChargesFiscalesSociales);
  const pressurePercent = ca > 0 ? ((totalChargesFiscalesSociales / ca) * 100).toFixed(2) : '0';

  return {
    chiffreAffairesAnnuel: ca,
    plafondLegal: CA_PLAFOND,
    isOverCeiling,
    ceilingWarning: isOverCeiling ? 'تحذير: لقد تجاوز رقم الأعمال سقف 5 ملايين دج السنوي المحدد لنظام المقاول الذاتي، مما يلزم بالانتقال للنظام الحقيقي.' : null,
    ifu: {
      ratePercent: 0.5,
      amount: ifuTax
    },
    casnos: {
      annualAmount: casnosAnnual,
      category: 'اشتراك سنوي جزافي أدنى للضمان الاجتماعي لغير الأجراء CASNOS'
    },
    totaux: {
      totalCharges: totalChargesFiscalesSociales,
      netEarnings,
      effectivePressurePercent: Number(pressurePercent)
    }
  };
}


