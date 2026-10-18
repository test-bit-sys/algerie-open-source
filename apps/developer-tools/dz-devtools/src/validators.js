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

export function generatePostalRip(ccpNum, key = null) {
  const cleanCcp = String(ccpNum || '').replace(/\D/g, '');
  if (!cleanCcp) return null;
  const k = key || calculateCcpKey(cleanCcp);
  if (!k) return null;

  // Algérie Poste Bank Code: 007, Guichet Code: 99999
  const paddedAccount = cleanCcp.padStart(10, '0');
  const fullRip = `00799999${paddedAccount}${k}`;
  return {
    rip: fullRip,
    bankCode: '007',
    guichetCode: '99999',
    accountNumber: paddedAccount,
    key: k,
    formatted: `007 99999 ${paddedAccount} ${k}`
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

