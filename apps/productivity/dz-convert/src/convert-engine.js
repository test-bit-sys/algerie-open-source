/**
 * DZ-Convert & Mihwar Engine — محرك التحويلات المالية، العقارية، والهندسية الجزائرية
 * 100% Offline-First, Zero-Dependency Computation Engine
 */

/**
 * 1. تحويل العملة الوطنية الجزائرية بين الدينار والسنتيم والدورو والتفقيد
 */
export function convertAlgerianCurrency(amount, fromUnit = 'dzd') {
  let dzd = 0;
  const num = Number(amount) || 0;

  switch (fromUnit.toLowerCase()) {
    case 'dzd':
    case 'dinar':
      dzd = num;
      break;
    case 'centime':
      dzd = num / 100;
      break;
    case 'doro':
      dzd = num / 5;
      break;
    case 'franc':
      dzd = num / 100;
      break;
    case 'million_centimes':
      dzd = num * 10000;
      break;
    case 'milliard_centimes':
      dzd = num * 10000000;
      break;
    default:
      dzd = num;
  }

  const centimes = dzd * 100;
  const doro = dzd * 5;
  const millionCentimes = centimes / 1000000;
  const milliardCentimes = centimes / 1000000000;

  let popularSpokenAr = '';
  if (centimes >= 1000000000) {
    const mill = Math.floor(centimes / 1000000000);
    const remMill = (centimes % 1000000000) / 1000000;
    popularSpokenAr = remMill > 0 
      ? `${mill} مليار و ${Math.round(remMill)} مليون سنتيم`
      : `${mill} مليار سنتيم`;
  } else if (centimes >= 1000000) {
    const millions = Math.floor(centimes / 1000000);
    const thousands = (centimes % 1000000) / 1000;
    popularSpokenAr = thousands > 0 
      ? `${millions} مليون و ${Math.round(thousands)} ألف سنتيم`
      : `${millions} مليون سنتيم`;
  } else if (centimes >= 1000) {
    popularSpokenAr = `${Math.round(centimes / 1000)} ألف سنتيم`;
  } else {
    popularSpokenAr = `${Math.round(centimes)} سنتيم`;
  }

  return {
    dzd: Math.round(dzd * 100) / 100,
    centimes: Math.round(centimes),
    doro: Math.round(doro),
    millionCentimes: Math.round(millionCentimes * 1000) / 1000,
    milliardCentimes: Math.round(milliardCentimes * 10000) / 10000,
    popularSpokenAr,
    tafqitAr: tafqitDinarArabic(dzd),
    tafqitFr: tafqitDinarFrench(dzd)
  };
}

/**
 * 2. التفقيد بالدينار الجزائري باللغة العربية
 */
export function tafqitDinarArabic(amount) {
  const n = Math.floor(Math.abs(amount));
  const centimes = Math.round((Math.abs(amount) - n) * 100);

  if (n === 0 && centimes === 0) return 'صفر دينار جزائري';

  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertGroup(num) {
    let out = '';
    const h = Math.floor(num / 100);
    const rem = num % 100;
    if (h > 0) out += hundreds[h];

    if (rem > 0) {
      if (out) out += ' و';
      if (rem < 10) out += ones[rem];
      else if (rem < 20) out += teens[rem - 10];
      else {
        const u = rem % 10;
        const t = Math.floor(rem / 10);
        if (u > 0) out += ones[u] + ' و' + tens[t];
        else out += tens[t];
      }
    }
    return out;
  }

  let text = '';
  const billions = Math.floor(n / 1000000000);
  const millions = Math.floor((n % 1000000000) / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const remainder = n % 1000;

  if (billions > 0) {
    text += (billions === 1 ? 'مليار' : billions === 2 ? 'ملياران' : convertGroup(billions) + ' ملايير');
  }
  if (millions > 0) {
    if (text) text += ' و';
    text += (millions === 1 ? 'مليون' : millions === 2 ? 'مليونان' : convertGroup(millions) + ' ملايين');
  }
  if (thousands > 0) {
    if (text) text += ' و';
    text += (thousands === 1 ? 'ألف' : thousands === 2 ? 'ألفان' : thousands <= 10 ? convertGroup(thousands) + ' آلاف' : convertGroup(thousands) + ' ألف');
  }
  if (remainder > 0) {
    if (text) text += ' و';
    text += convertGroup(remainder);
  }

  let res = text ? `${text} دينار جزائري` : '';
  if (centimes > 0) {
    res += (res ? ' و' : '') + `${convertGroup(centimes)} سنتيم`;
  }
  return res + ' لا غير';
}

/**
 * 3. التفقيد بالدينار الجزائري باللغة الفرنسية
 */
export function tafqitDinarFrench(amount) {
  const n = Math.floor(Math.abs(amount));
  const centimes = Math.round((Math.abs(amount) - n) * 100);

  if (n === 0 && centimes === 0) return 'Zéro dinar algérien';

  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingts', 'quatre-vingt-dix'];

  function convertGroupFr(num) {
    let out = '';
    const h = Math.floor(num / 100);
    const rem = num % 100;
    if (h > 0) {
      out += (h === 1 ? 'cent' : units[h] + ' cents');
    }
    if (rem > 0) {
      if (out) out += ' ';
      if (rem < 10) out += units[rem];
      else if (rem < 20) out += teens[rem - 10];
      else {
        const t = Math.floor(rem / 10);
        const u = rem % 10;
        if (t === 7) {
          out += 'soixante-' + teens[u];
        } else if (t === 9) {
          out += 'quatre-vingt-' + teens[u];
        } else {
          out += tens[t] + (u > 0 ? (u === 1 ? ' et un' : '-' + units[u]) : '');
        }
      }
    }
    return out;
  }

  let text = '';
  const millions = Math.floor((n % 1000000000) / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const remainder = n % 1000;

  if (millions > 0) {
    text += (millions === 1 ? 'un million' : convertGroupFr(millions) + ' millions');
  }
  if (thousands > 0) {
    if (text) text += ' ';
    text += (thousands === 1 ? 'mille' : convertGroupFr(thousands) + ' mille');
  }
  if (remainder > 0) {
    if (text) text += ' ';
    text += convertGroupFr(remainder);
  }

  let res = text ? `${text} dinars algériens` : '';
  if (centimes > 0) {
    res += (res ? ' et ' : '') + `${convertGroupFr(centimes)} centimes`;
  }
  return (res.charAt(0).toUpperCase() + res.slice(1)) + ' seulement';
}

/**
 * 4. تحويل المساحات العقارية والفلاحية الجزائرية
 */
export function convertLandArea(value, fromUnit = 'm2') {
  const val = Number(value) || 0;
  let m2 = 0;

  switch (fromUnit.toLowerCase()) {
    case 'm2':
    case 'sqm':
      m2 = val;
      break;
    case 'hectare':
    case 'ha':
      m2 = val * 10000;
      break;
    case 'are':
    case 'a':
      m2 = val * 100;
      break;
    case 'centiare':
    case 'ca':
      m2 = val;
      break;
    case 'zoudja': // الزوجة الفلاحية التقليدية: تقريباً 10 هكتارات (100,000 م²)
      m2 = val * 100000;
      break;
    case 'faddan': // الفدان
      m2 = val * 4200.83;
      break;
    default:
      m2 = val;
  }

  const ha = m2 / 10000;
  const a = (m2 % 10000) / 100;
  const ca = m2 % 100;

  return {
    m2: Math.round(m2 * 100) / 100,
    hectares: Math.round((m2 / 10000) * 10000) / 10000,
    ares: Math.round((m2 / 100) * 100) / 100,
    centiares: Math.round(m2),
    zoudja: Math.round((m2 / 100000) * 100) / 100,
    officialCadastreFormatted: `${Math.floor(ha)} هكتار و ${Math.floor(a)} آر و ${Math.round(ca)} سنتيار`
  };
}

/**
 * 5. حسابات حديد التسليح FeE500 ومواد البناء
 */
export function calculateRebarWeight(diameterMm, lengthMeters = 12, count = 1) {
  // كثافة الفولاذ: 7850 كغ/م³
  // الوزن الخطي = (القطر² / 162) كغ/م
  const d = Number(diameterMm) || 0;
  const l = Number(lengthMeters) || 0;
  const qty = Number(count) || 1;

  const weightPerMeter = (d * d) / 162.2;
  const totalWeightKg = weightPerMeter * l * qty;

  return {
    diameterMm: d,
    lengthMeters: l,
    count: qty,
    weightPerMeterKg: Math.round(weightPerMeter * 1000) / 1000,
    totalWeightKg: Math.round(totalWeightKg * 10) / 10,
    totalWeightTonnes: Math.round((totalWeightKg / 1000) * 1000) / 1000
  };
}

/**
 * 6. حساب مكونات الخرسانة المسلحة (Dosage Béton 350 kg/m³)
 */
export function calculateConcreteMaterials(volumeM3, dosageKgPerM3 = 350) {
  const v = Number(volumeM3) || 0;
  const dosage = Number(dosageKgPerM3) || 350;

  const totalCementKg = v * dosage;
  const cementBags50kg = Math.ceil(totalCementKg / 50);
  const sandVolumeM3 = Math.round(v * 0.4 * 100) / 100; // رمل ~ 400 لتر/م³
  const gravelVolumeM3 = Math.round(v * 0.8 * 100) / 100; // حصى ~ 800 لتر/م³
  const waterLiters = Math.round(v * 175); // ماء ~ 175 لتر/م³

  return {
    volumeM3: v,
    dosageKgPerM3: dosage,
    totalCementKg: Math.round(totalCementKg),
    cementBags50kg,
    sandVolumeM3,
    gravelVolumeM3,
    waterLiters
  };
}
