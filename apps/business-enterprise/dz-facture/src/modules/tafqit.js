/**
 * DZ-Facture: Tafqit Engine
 * Algerian Dinar number-to-words converter in Arabic, French, and English
 */

const ONES_AR = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TENS_AR = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const TEENS_AR = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const HUNDREDS_AR = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function convertUnder1000Ar(n) {
  if (n === 0) return '';
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(HUNDREDS_AR[h]);
  if (rem > 0) {
    if (rem < 10) parts.push(ONES_AR[rem]);
    else if (rem >= 10 && rem < 20) parts.push(TEENS_AR[rem - 10]);
    else {
      const u = rem % 10;
      const t = Math.floor(rem / 10);
      parts.push(u > 0 ? `${ONES_AR[u]} و${TENS_AR[t]}` : TENS_AR[t]);
    }
  }
  return parts.join(' و');
}

export function numberToArabicWords(num) {
  const n = Math.floor(num);
  if (n === 0) return 'صفر';
  if (n < 0) return 'سالب ' + numberToArabicWords(-n);

  const scales = [
    { value: 1000000000, singular: 'مليار', dual: 'ملياران', plural: 'ملايير', accusative: 'ملياراً' },
    { value: 1000000, singular: 'مليون', dual: 'مليونان', plural: 'ملايين', accusative: 'مليوناً' },
    { value: 1000, singular: 'ألف', dual: 'ألفان', plural: 'آلاف', accusative: 'ألفاً' }
  ];

  let remaining = n;
  const parts = [];

  for (const scale of scales) {
    if (remaining >= scale.value) {
      const count = Math.floor(remaining / scale.value);
      remaining %= scale.value;
      if (count === 1) parts.push(scale.singular);
      else if (count === 2) parts.push(scale.dual);
      else if (count >= 3 && count <= 10) parts.push(`${ONES_AR[count]} ${scale.plural}`);
      else parts.push(`${convertUnder1000Ar(count)} ${scale.accusative}`);
    }
  }
  if (remaining > 0) parts.push(convertUnder1000Ar(remaining));
  return parts.filter(Boolean).join(' و');
}

// French
const ONES_FR = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const TEENS_FR = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS_FR = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

function convertUnder100Fr(n) {
  if (n < 10) return ONES_FR[n];
  if (n >= 10 && n < 20) return TEENS_FR[n - 10];
  if (n >= 20 && n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 1) return `${TENS_FR[t]} et un`;
    return u === 0 ? TENS_FR[t] : `${TENS_FR[t]}-${ONES_FR[u]}`;
  }
  if (n >= 70 && n < 80) {
    const u = n - 60;
    return u === 11 ? 'soixante et onze' : `soixante-${TEENS_FR[u - 10]}`;
  }
  if (n >= 80 && n < 90) {
    const u = n - 80;
    return u === 0 ? 'quatre-vingts' : `quatre-vingt-${ONES_FR[u]}`;
  }
  if (n >= 90 && n < 100) {
    const u = n - 80;
    return `quatre-vingt-${TEENS_FR[u - 10]}`;
  }
  return '';
}

function convertUnder1000Fr(n) {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  let res = '';
  if (h === 1) res = 'cent';
  else if (h > 1) res = rem === 0 ? `${ONES_FR[h]} cents` : `${ONES_FR[h]} cent`;

  if (rem > 0) {
    const remStr = convertUnder100Fr(rem);
    res = res ? `${res} ${remStr}` : remStr;
  }
  return res;
}

export function numberToFrenchWords(num) {
  const n = Math.floor(num);
  if (n === 0) return 'zéro';
  if (n < 0) return 'moins ' + numberToFrenchWords(-n);

  let remaining = n;
  const parts = [];
  const billions = Math.floor(remaining / 1000000000);
  if (billions > 0) {
    parts.push(billions === 1 ? 'un milliard' : `${numberToFrenchWords(billions)} milliards`);
    remaining %= 1000000000;
  }
  const millions = Math.floor(remaining / 1000000);
  if (millions > 0) {
    parts.push(millions === 1 ? 'un million' : `${numberToFrenchWords(millions)} millions`);
    remaining %= 1000000;
  }
  const thousands = Math.floor(remaining / 1000);
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mille' : `${convertUnder1000Fr(thousands)} mille`);
    remaining %= 1000;
  }
  if (remaining > 0) parts.push(convertUnder1000Fr(remaining));
  return parts.join(' ');
}

// English
const ONES_EN = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_EN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function convertUnder1000En(n) {
  if (n === 0) return '';
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(`${ONES_EN[h]} hundred`);
  if (rem > 0) {
    if (rem < 20) parts.push(ONES_EN[rem]);
    else {
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      parts.push(u === 0 ? TENS_EN[t] : `${TENS_EN[t]}-${ONES_EN[u]}`);
    }
  }
  return parts.join(' and ');
}

export function numberToEnglishWords(num) {
  const n = Math.floor(num);
  if (n === 0) return 'zero';
  if (n < 0) return 'minus ' + numberToEnglishWords(-n);

  let remaining = n;
  const parts = [];
  const billions = Math.floor(remaining / 1000000000);
  if (billions > 0) {
    parts.push(`${numberToEnglishWords(billions)} billion`);
    remaining %= 1000000000;
  }
  const millions = Math.floor(remaining / 1000000);
  if (millions > 0) {
    parts.push(`${numberToEnglishWords(millions)} million`);
    remaining %= 1000000;
  }
  const thousands = Math.floor(remaining / 1000);
  if (thousands > 0) {
    parts.push(`${convertUnder1000En(thousands)} thousand`);
    remaining %= 1000;
  }
  if (remaining > 0) parts.push(convertUnder1000En(remaining));
  return parts.join(' ');
}

export function tafqitDZD(amount, options = {}) {
  const { lang = 'ar', legalSuffix = true, currency = true } = options;
  if (amount == null || isNaN(amount)) return '';

  const isNegative = amount < 0;
  const positiveAmount = Math.abs(amount);
  const dinars = Math.floor(positiveAmount);
  const centimes = Math.round((positiveAmount - dinars) * 100);

  if (lang === 'en') {
    let dinarsText = numberToEnglishWords(dinars);
    dinarsText = dinarsText.charAt(0).toUpperCase() + dinarsText.slice(1);
    let result = dinarsText;
    if (currency) result += dinars <= 1 ? ' Algerian Dinar' : ' Algerian Dinars';
    if (centimes > 0) {
      result += ` and ${numberToEnglishWords(centimes)}` + (currency ? (centimes <= 1 ? ' Centime' : ' Centimes') : '');
    } else if (legalSuffix && currency) {
      result += ' only';
    }
    return isNegative ? `Minus ${result}` : result;
  }

  if (lang === 'fr') {
    let dinarsText = numberToFrenchWords(dinars);
    dinarsText = dinarsText.charAt(0).toUpperCase() + dinarsText.slice(1);
    let result = dinarsText;
    if (currency) result += dinars <= 1 ? ' Dinar Algérien' : ' Dinars Algériens';
    if (centimes > 0) {
      result += ` et ${numberToFrenchWords(centimes)}` + (currency ? (centimes <= 1 ? ' Centime' : ' Centimes') : '');
    } else if (legalSuffix && currency) {
      result += ' et zéro centime';
    }
    return isNegative ? `Moins ${result}` : result;
  }

  // Arabic
  let dinarsText = numberToArabicWords(dinars);
  let result = dinarsText;
  if (currency) {
    if (dinars === 1) result = 'دينار جزائري واحد';
    else if (dinars === 2) result = 'ديناران جزائريان';
    else if (dinars >= 3 && dinars <= 10) result = `${dinarsText} دنانير جزائرية`;
    else result = `${dinarsText} ديناراً جزائرياً`;
  }
  if (centimes > 0) {
    const cWords = numberToArabicWords(centimes);
    let cText = centimes === 1 ? 'سنتيم واحد' : centimes === 2 ? 'سنتيمان' : centimes <= 10 ? `${cWords} سنتيمات` : `${cWords} سنتيماً`;
    result += ` و${cText}`;
  }
  if (legalSuffix) result += ' لا غير';
  return isNegative ? `سالب ${result}` : result;
}
