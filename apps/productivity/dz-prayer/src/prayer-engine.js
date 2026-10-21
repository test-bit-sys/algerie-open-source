/**
 * DZ-Prayer & Awqat Engine — المحرك الفلكي لحساب مواقيت الصلاة والقبلة والتقويم الوطني الجزائري
 * 100% Offline-First, Zero-Dependency Astronomical Computation Engine
 * مطابق لمعايير وزارة الشؤون الدينية والأوقاف بالجمهورية الجزائرية الديمقراطية الشعبية
 */

// 1. قاعدة بيانات الولايات الـ 58 للجمهورية الجزائرية مع الإحداثيات الدقيقة
export const DZ_WILAYAS = [
  { code: '01', name_ar: 'أدرار', name_fr: 'Adrar', lat: 27.8743, lon: -0.2939, gmt: 1 },
  { code: '02', name_ar: 'الشلف', name_fr: 'Chlef', lat: 36.1652, lon: 1.3345, gmt: 1 },
  { code: '03', name_ar: 'الأغواط', name_fr: 'Laghouat', lat: 33.8000, lon: 2.8651, gmt: 1 },
  { code: '04', name_ar: 'أم البواقي', name_fr: 'Oum El Bouaghi', lat: 35.8754, lon: 7.1135, gmt: 1 },
  { code: '05', name_ar: 'باتنة', name_fr: 'Batna', lat: 35.5559, lon: 6.1741, gmt: 1 },
  { code: '06', name_ar: 'بجاية', name_fr: 'Béjaïa', lat: 36.7511, lon: 5.0567, gmt: 1 },
  { code: '07', name_ar: 'بسكرة', name_fr: 'Biskra', lat: 34.8504, lon: 5.7280, gmt: 1 },
  { code: '08', name_ar: 'بشار', name_fr: 'Béchar', lat: 31.6167, lon: -2.2167, gmt: 1 },
  { code: '09', name_ar: 'البليدة', name_fr: 'Blida', lat: 36.4700, lon: 2.8300, gmt: 1 },
  { code: '10', name_ar: 'البويرة', name_fr: 'Bouira', lat: 36.3749, lon: 3.9020, gmt: 1 },
  { code: '11', name_ar: 'تمنراست', name_fr: 'Tamanrasset', lat: 22.7850, lon: 5.5228, gmt: 1 },
  { code: '12', name_ar: 'تبسة', name_fr: 'Tébessa', lat: 35.4042, lon: 8.1242, gmt: 1 },
  { code: '13', name_ar: 'تلمسان', name_fr: 'Tlemcen', lat: 34.8783, lon: -1.3150, gmt: 1 },
  { code: '14', name_ar: 'تيارت', name_fr: 'Tiaret', lat: 35.3710, lon: 1.3170, gmt: 1 },
  { code: '15', name_ar: 'تيزي وزو', name_fr: 'Tizi Ouzou', lat: 36.7118, lon: 4.0459, gmt: 1 },
  { code: '16', name_ar: 'الجزائر العاصمة', name_fr: 'Alger', lat: 36.7538, lon: 3.0588, gmt: 1 },
  { code: '17', name_ar: 'الجلفة', name_fr: 'Djelfa', lat: 34.6728, lon: 3.2630, gmt: 1 },
  { code: '18', name_ar: 'جيجل', name_fr: 'Jijel', lat: 36.8206, lon: 5.7667, gmt: 1 },
  { code: '19', name_ar: 'سطيف', name_fr: 'Sétif', lat: 36.1911, lon: 5.4137, gmt: 1 },
  { code: '20', name_ar: 'سعيدة', name_fr: 'Saïda', lat: 34.8303, lon: 0.1517, gmt: 1 },
  { code: '21', name_ar: 'سكيكدة', name_fr: 'Skikda', lat: 36.8762, lon: 6.9092, gmt: 1 },
  { code: '22', name_ar: 'سيدي بلعباس', name_fr: 'Sidi Bel Abbès', lat: 35.1899, lon: -0.6308, gmt: 1 },
  { code: '23', name_ar: 'عنابة', name_fr: 'Annaba', lat: 36.9000, lon: 7.7667, gmt: 1 },
  { code: '24', name_ar: 'قالمة', name_fr: 'Guelma', lat: 36.4621, lon: 7.4261, gmt: 1 },
  { code: '25', name_ar: 'قسنطينة', name_fr: 'Constantine', lat: 36.3650, lon: 6.6147, gmt: 1 },
  { code: '26', name_ar: 'المدية', name_fr: 'Médéa', lat: 36.2642, lon: 2.7539, gmt: 1 },
  { code: '27', name_ar: 'مستغانم', name_fr: 'Mostaganem', lat: 35.9312, lon: 0.0892, gmt: 1 },
  { code: '28', name_ar: 'المسيلة', name_fr: "M'Sila", lat: 35.7058, lon: 4.5419, gmt: 1 },
  { code: '29', name_ar: 'معسكر', name_fr: 'Mascara', lat: 35.3949, lon: 0.1403, gmt: 1 },
  { code: '30', name_ar: 'ورقلة', name_fr: 'Ouargla', lat: 31.9493, lon: 5.3250, gmt: 1 },
  { code: '31', name_ar: 'وهران', name_fr: 'Oran', lat: 35.6987, lon: -0.6349, gmt: 1 },
  { code: '32', name_ar: 'البيض', name_fr: 'El Bayadh', lat: 33.6832, lon: 1.0193, gmt: 1 },
  { code: '33', name_ar: 'إليزي', name_fr: 'Illizi', lat: 26.4833, lon: 8.4667, gmt: 1 },
  { code: '34', name_ar: 'برج بوعريريج', name_fr: 'Bordj Bou Arréridj', lat: 36.0732, lon: 4.7611, gmt: 1 },
  { code: '35', name_ar: 'بومرداس', name_fr: 'Boumerdès', lat: 36.7598, lon: 3.4728, gmt: 1 },
  { code: '36', name_ar: 'الطارف', name_fr: 'El Tarf', lat: 36.7672, lon: 8.3138, gmt: 1 },
  { code: '37', name_ar: 'تندوف', name_fr: 'Tindouf', lat: 27.6761, lon: -8.1478, gmt: 1 },
  { code: '38', name_ar: 'تيسمسيلت', name_fr: 'Tissemsilt', lat: 35.6072, lon: 1.8108, gmt: 1 },
  { code: '39', name_ar: 'الوادي', name_fr: 'El Oued', lat: 33.3683, lon: 6.8674, gmt: 1 },
  { code: '40', name_ar: 'خنشلة', name_fr: 'Khenchela', lat: 35.4358, lon: 7.1433, gmt: 1 },
  { code: '41', name_ar: 'سوق أهراس', name_fr: 'Souk Ahras', lat: 36.2864, lon: 7.9511, gmt: 1 },
  { code: '42', name_ar: 'تيبازة', name_fr: 'Tipaza', lat: 36.5897, lon: 2.4475, gmt: 1 },
  { code: '43', name_ar: 'ميلة', name_fr: 'Mila', lat: 36.4503, lon: 6.2644, gmt: 1 },
  { code: '44', name_ar: 'عين الدفلى', name_fr: 'Aïn Defla', lat: 36.2641, lon: 1.9679, gmt: 1 },
  { code: '45', name_ar: 'النعامة', name_fr: 'Naâma', lat: 33.2667, lon: -0.3167, gmt: 1 },
  { code: '46', name_ar: 'عين تموشنت', name_fr: 'Aïn Témouchent', lat: 35.2975, lon: -1.1404, gmt: 1 },
  { code: '47', name_ar: 'غرداية', name_fr: 'Ghardaïa', lat: 32.4909, lon: 3.6739, gmt: 1 },
  { code: '48', name_ar: 'غليزان', name_fr: 'Relizane', lat: 35.7373, lon: 0.5558, gmt: 1 },
  { code: '49', name_ar: 'تيميمون', name_fr: 'Timimoun', lat: 29.2639, lon: 0.2310, gmt: 1 },
  { code: '50', name_ar: 'برج باجي مختار', name_fr: 'Bordj Badji Mokhtar', lat: 21.3278, lon: 0.9542, gmt: 1 },
  { code: '51', name_ar: 'أولاد جلال', name_fr: 'Ouled Djellal', lat: 34.4278, lon: 5.0667, gmt: 1 },
  { code: '52', name_ar: 'بني عباس', name_fr: 'Béni Abbès', lat: 30.1333, lon: -2.1667, gmt: 1 },
  { code: '53', name_ar: 'إن صالح', name_fr: 'In Salah', lat: 27.1936, lon: 2.4608, gmt: 1 },
  { code: '54', name_ar: 'إن قزام', name_fr: 'In Guezzam', lat: 19.5686, lon: 5.7725, gmt: 1 },
  { code: '55', name_ar: 'تقرت', name_fr: 'Touggourt', lat: 33.1070, lon: 6.0594, gmt: 1 },
  { code: '56', name_ar: 'جانت', name_fr: 'Djanet', lat: 24.5539, lon: 9.4858, gmt: 1 },
  { code: '57', name_ar: 'المغير', name_fr: "El M'Ghair", lat: 33.9489, lon: 5.9228, gmt: 1 },
  { code: '58', name_ar: 'المنيعة', name_fr: 'El Menia', lat: 30.5833, lon: 2.8833, gmt: 1 }
];

// إحداثيات الكعبة المشرفة في مكة المكرمة لحساب القبلة
export const KAABA_COORDS = { lat: 21.422478, lon: 39.826204 };

// زوايا الحساب المعتمدة في الجزائر (وزارة الشؤون الدينية)
export const DZ_PRAYER_METHOD = {
  fajrAngle: 18.0,   // زاوية الفجر: 18 درجة
  ishaAngle: 17.0,   // زاوية العشاء: 17 درجة (أو 90 دقيقة بحسب الإمساكيات الرسمية)
  asrFactor: 1.0     // المذهب المالكي والشافعي: ظل الشيء مثله
};

// الدوال المثلثية بالدرجات
const d2r = (d) => (d * Math.PI) / 180.0;
const r2d = (r) => (r * 180.0) / Math.PI;
const sinD = (d) => Math.sin(d2r(d));
const cosD = (d) => Math.cos(d2r(d));
const tanD = (d) => Math.tan(d2r(d));
const acosD = (x) => r2d(Math.acos(Math.max(-1, Math.min(1, x))));
const atan2D = (y, x) => r2d(Math.atan2(y, x));

/**
 * حساب زاوية القبلة والمسافة بالكيلومتر من أي نقطة على الكرة الأرضية للكعبة المشرفة
 */
export function calculateQibla(latitude, longitude) {
  const phiK = d2r(KAABA_COORDS.lat);
  const lambdaK = d2r(KAABA_COORDS.lon);
  const phi = d2r(latitude);
  const lambda = d2r(longitude);

  const deltaLambda = lambdaK - lambda;

  // قانون السمت الدائري للقبلة
  const y = Math.sin(deltaLambda);
  const x = Math.cos(phi) * Math.tan(phiK) - Math.sin(phi) * Math.cos(deltaLambda);
  let qiblaBearing = r2d(Math.atan2(y, x));
  qiblaBearing = (qiblaBearing + 360) % 360;

  // حساب المسافة بواسطة صيغة هافرسين الكروية
  const R = 6371; // نصف قطر الأرض بالكيلومتر
  const dLat = phiK - phi;
  const dLon = deltaLambda;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(phi) * Math.cos(phiK) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = Math.round(R * c);

  return {
    bearing: Math.round(qiblaBearing * 10) / 10,
    distanceKm,
    directionCompass: getCompassDirection(qiblaBearing)
  };
}

function getCompassDirection(bearing) {
  const directions = [
    'شمال (N)', 'شمال شرق (NE)', 'شرق (E)', 'جنوب شرق (SE)',
    'جنوب (S)', 'جنوب غرب (SW)', 'غرب (W)', 'شمال غرب (NW)'
  ];
  const idx = Math.round(bearing / 45) % 8;
  return directions[idx];
}

/**
 * حساب اليوم اليولياني Julian Date
 */
function getJulianDate(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
}

/**
 * حساب موقع الشمس (الميل ومعادلة الوقت) ليوم معين
 */
function getSunPosition(jd) {
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) % 360;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * sinD(g) + 0.020 * sinD(2 * g)) % 360;
  const e = 23.439 - 0.00000036 * D;

  const declination = r2d(Math.asin(sinD(e) * sinD(L)));
  let RA = r2d(Math.atan2(cosD(e) * sinD(L), cosD(L))) / 15;
  RA = (RA + 24) % 24;

  const eqOfTime = q / 15 - RA;
  return { declination, eqOfTime };
}

/**
 * حساب مواقيت الصلاة ليوم محدد لولاية جزائرية
 */
export function calculatePrayerTimes(wilaya, date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const jd = getJulianDate(year, month, day);
  const { declination: d, eqOfTime: eqt } = getSunPosition(jd);

  const lat = wilaya.lat;
  const lon = wilaya.lon;
  const tz = wilaya.gmt || 1;

  // زوال الشمس (الظهر الفلكي)
  const dhuhrTime = 12 + tz - lon / 15 - eqt;

  // حساب زاوية وقت معين
  function hourAngle(angle, direction = 'morning') {
    const cosHA = (sinD(angle) - sinD(lat) * sinD(d)) / (cosD(lat) * cosD(d));
    if (cosHA < -1 || cosHA > 1) return null; // لا يوجد شروق أو غروب
    const ha = acosD(cosHA) / 15;
    return direction === 'morning' ? dhuhrTime - ha : dhuhrTime + ha;
  }

  // 1. الفجر (انحطاط الشمس 18 درجة)
  const fajrTime = hourAngle(-DZ_PRAYER_METHOD.fajrAngle, 'morning');

  // 2. الشروق (طرف الشمس مع انكسار الغلاف الجوي 0.833 درجة)
  const sunriseTime = hourAngle(-0.833, 'morning');

  // 3. الظهر (الزوال الفلكي + إضافة دقيقتين احتياطاً طبقاً للمعمول به جزائرياً)
  const dhuhrActual = dhuhrTime + 2 / 60;

  // 4. العصر (المذهب المالكي: ظل الشيء مثله، زاوية ارتفاع الشمس موجبة فوق الأفق)
  const asrAngle = r2d(Math.atan(1 / (DZ_PRAYER_METHOD.asrFactor + tanD(Math.abs(lat - d)))));
  const asrTime = hourAngle(asrAngle, 'afternoon');

  // 5. المغرب (غروب الشمس مع انكسار الضوء 0.833 درجة + دقيقة أمان)
  const maghribTime = hourAngle(-0.833, 'afternoon') + 1 / 60;

  // 6. العشاء (انحطاط الشمس 17 درجة)
  const ishaTime = hourAngle(-DZ_PRAYER_METHOD.ishaAngle, 'afternoon');

  function formatTime(hoursFloat) {
    if (hoursFloat === null || isNaN(hoursFloat)) return '--:--';
    let h = Math.floor(hoursFloat);
    let m = Math.floor((hoursFloat - h) * 60 + 0.5);
    if (m >= 60) {
      h += 1;
      m -= 60;
    }
    h = (h + 24) % 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function toMinutes(hoursFloat) {
    if (hoursFloat === null || isNaN(hoursFloat)) return 0;
    let h = Math.floor(hoursFloat);
    let m = Math.floor((hoursFloat - h) * 60 + 0.5);
    return ((h % 24) + 24) % 24 * 60 + m;
  }

  const times = {
    fajr: formatTime(fajrTime),
    sunrise: formatTime(sunriseTime),
    dhuhr: formatTime(dhuhrActual),
    asr: formatTime(asrTime),
    maghrib: formatTime(maghribTime),
    isha: formatTime(ishaTime)
  };

  const minutesMap = {
    fajr: toMinutes(fajrTime),
    sunrise: toMinutes(sunriseTime),
    dhuhr: toMinutes(dhuhrActual),
    asr: toMinutes(asrTime),
    maghrib: toMinutes(maghribTime),
    isha: toMinutes(ishaTime)
  };

  return { times, minutesMap };
}

/**
 * تحديد الصلاة القادمة والوقت المتبقي لها بالدقائق والثواني
 */
export function getNextPrayerInfo(timesMap, currentMinutes = null) {
  if (currentMinutes === null) {
    const now = new Date();
    currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  }

  const prayerNames = [
    { id: 'fajr', nameAr: 'الفجر', nameFr: 'Fajr' },
    { id: 'sunrise', nameAr: 'الشروق', nameFr: 'Chourouk', isSun: true },
    { id: 'dhuhr', nameAr: 'الظهر', nameFr: 'Dhuhr' },
    { id: 'asr', nameAr: 'العصر', nameFr: 'Asr' },
    { id: 'maghrib', nameAr: 'المغرب', nameFr: 'Maghrib' },
    { id: 'isha', nameAr: 'العشاء', nameFr: 'Isha' }
  ];

  for (let i = 0; i < prayerNames.length; i++) {
    const p = prayerNames[i];
    const pMinutes = timesMap[p.id];
    if (currentMinutes < pMinutes) {
      const diffMin = pMinutes - currentMinutes;
      const prevPrayer = i > 0 ? prayerNames[i - 1] : prayerNames[prayerNames.length - 1];
      return {
        next: p,
        prev: prevPrayer,
        diffMinutes: Math.round(diffMin),
        remainingTimeFormatted: formatMinutesToCountdown(diffMin)
      };
    }
  }

  // بعد صلاة العشاء: الصلاة القادمة هي فجر اليوم التالي
  const nextDayFajrMinutes = 24 * 60 + timesMap.fajr;
  const diffMin = nextDayFajrMinutes - currentMinutes;
  return {
    next: prayerNames[0],
    prev: prayerNames[prayerNames.length - 1],
    diffMinutes: Math.round(diffMin),
    remainingTimeFormatted: formatMinutesToCountdown(diffMin)
  };
}

function formatMinutesToCountdown(minutesFloat) {
  const totalSeconds = Math.max(0, Math.floor(minutesFloat * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * تحويل التاريخ الميلادي إلى التاريخ الهجري وحساب الأعياد الوطنية والرمضانية
 */
export function getHijriDate(date = new Date(), adjustment = 0) {
  const d = new Date(date.getTime() + adjustment * 86400000);
  let day = d.getDate();
  let month = d.getMonth() + 1;
  let year = d.getFullYear();

  if (month < 3) {
    year -= 1;
    month += 12;
  }

  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;

  const z = jd - 1948439.5;
  const cyc = Math.floor(z / 10631);
  let r = z - cyc * 10631;
  const hYear = Math.floor((r - 0.5) / 354.366) + 1 + cyc * 30;
  r = r - Math.floor((hYear - 1 - cyc * 30) * 354.366);

  let hMonth = 1;
  while (hMonth <= 12) {
    const daysInMonth = (hMonth % 2 === 1 || (hMonth === 12 && isHijriLeap(hYear))) ? 30 : 29;
    if (r <= daysInMonth) break;
    r -= daysInMonth;
    hMonth++;
  }
  const hDay = Math.max(1, Math.min(30, Math.round(r)));

  const hijriMonthsAr = [
    'محرم', 'صفر', 'ربيع الأول', 'ربيع الثاني',
    'جمادى الأولى', 'جمادى الثانية', 'رجب', 'شعبان',
    'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'
  ];

  const hijriMonthsFr = [
    'Mouharram', 'Safar', 'Rabi al-Awwal', 'Rabi ath-Thani',
    'Joumada al-Oula', 'Joumada ath-Thania', 'Rajab', 'Chaabane',
    'Ramadan', 'Chawwal', 'Dhou al-Qi\'da', 'Dhou al-Hijja'
  ];

  return {
    day: hDay,
    month: hMonth,
    year: hYear,
    monthNameAr: hijriMonthsAr[hMonth - 1] || '',
    monthNameFr: hijriMonthsFr[hMonth - 1] || '',
    formattedAr: `${hDay} ${hijriMonthsAr[hMonth - 1]} ${hYear} هـ`,
    formattedFr: `${hDay} ${hijriMonthsFr[hMonth - 1]} ${hYear} H`
  };
}

function isHijriLeap(year) {
  return ((11 * year + 14) % 30) < 11;
}

/**
 * الأعياد الوطنية الجزائرية والمناسبات الرسمية
 */
export const DZ_HOLIDAYS = [
  { day: 1, month: 11, titleAr: 'عيد الثورة التحريرية المجيدة (1 نوفمبر 1954)', titleFr: 'Fête de la Révolution' },
  { day: 5, month: 7, titleAr: 'عيد الاستقلال والشباب (5 جويلية 1962)', titleFr: "Fête de l'Indépendance" },
  { day: 19, month: 3, titleAr: 'عيد النصر (19 مارس 1962)', titleFr: 'Fête de la Victoire' },
  { day: 1, month: 5, titleAr: 'عيد العمال العالمي (1 ماي)', titleFr: 'Fête du Travail' },
  { day: 12, month: 1, titleAr: 'رأس السنة الأمازيغية (يناير Yennayer)', titleFr: 'Nouvel An Amazigh (Yennayer)' },
  { hijriDay: 1, hijriMonth: 1, titleAr: 'أول محرم - رأس السنة الهجرية', titleFr: 'Nouvel An Hégirien' },
  { hijriDay: 10, hijriMonth: 1, titleAr: 'يوم عاشوراء', titleFr: 'Achoura' },
  { hijriDay: 12, hijriMonth: 3, titleAr: 'المولد النبوي الشريف', titleFr: 'Mawlid Ennabawi Echarif' },
  { hijriDay: 1, hijriMonth: 10, titleAr: 'عيد الفطر المبارك', titleFr: 'Aïd El-Fitr' },
  { hijriDay: 10, hijriMonth: 12, titleAr: 'عيد الأضحى المبارك', titleFr: 'Aïd El-Adha' }
];

/**
 * توليد إمساكية شهرية كاملة (30 أو 31 يوماً) للطباعة والتصدير
 */
export function generateMonthlyTimetable(wilaya, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const rows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month - 1, d);
    const { times } = calculatePrayerTimes(wilaya, curDate);
    const hijri = getHijriDate(curDate);
    const dayNameAr = curDate.toLocaleDateString('ar-DZ', { weekday: 'long' });

    rows.push({
      day: d,
      dayNameAr,
      dateFormatted: `${d}/${month}/${year}`,
      hijriFormatted: `${hijri.day} ${hijri.monthNameAr}`,
      ...times
    });
  }

  return rows;
}
