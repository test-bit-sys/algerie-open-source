/**
 * المنظومة الجزائرية المفتوحة المصدر - قائمة ولايات الجمهورية الجزائرية الـ 58
 * DZ Open Source - 58 Algerian Wilayas Registry for DZ-CRM
 */

export const DZ_WILAYAS = [
  { code: '01', name_ar: 'أدرار', name_fr: 'Adrar' },
  { code: '02', name_ar: 'الشلف', name_fr: 'Chlef' },
  { code: '03', name_ar: 'الأغواط', name_fr: 'Laghouat' },
  { code: '04', name_ar: 'أم البواقي', name_fr: 'Oum El Bouaghi' },
  { code: '05', name_ar: 'باتنة', name_fr: 'Batna' },
  { code: '06', name_ar: 'بجاية', name_fr: 'Béjaïa' },
  { code: '07', name_ar: 'بسكرة', name_fr: 'Biskra' },
  { code: '08', name_ar: 'بشار', name_fr: 'Béchar' },
  { code: '09', name_ar: 'البليدة', name_fr: 'Blida' },
  { code: '10', name_ar: 'البويرة', name_fr: 'Bouira' },
  { code: '11', name_ar: 'تمنراست', name_fr: 'Tamanrasset' },
  { code: '12', name_ar: 'تبسة', name_fr: 'Tébessa' },
  { code: '13', name_ar: 'تلمسان', name_fr: 'Tlemcen' },
  { code: '14', name_ar: 'تيارت', name_fr: 'Tiaret' },
  { code: '15', name_ar: 'تيزي وزو', name_fr: 'Tizi Ouzou' },
  { code: '16', name_ar: 'الجزائر العاصمة', name_fr: 'Alger' },
  { code: '17', name_ar: 'الجلفة', name_fr: 'Djelfa' },
  { code: '18', name_ar: 'جيجل', name_fr: 'Jijel' },
  { code: '19', name_ar: 'سطيف', name_fr: 'Sétif' },
  { code: '20', name_ar: 'سعيدة', name_fr: 'Saïda' },
  { code: '21', name_ar: 'سكيكدة', name_fr: 'Skikda' },
  { code: '22', name_ar: 'سيدي بلعباس', name_fr: 'Sidi Bel Abbès' },
  { code: '23', name_ar: 'عنابة', name_fr: 'Annaba' },
  { code: '24', name_ar: 'قالمة', name_fr: 'Guelma' },
  { code: '25', name_ar: 'قسنطينة', name_fr: 'Constantine' },
  { code: '26', name_ar: 'المدية', name_fr: 'Médéa' },
  { code: '27', name_ar: 'مستغانم', name_fr: 'Mostaganem' },
  { code: '28', name_ar: 'المسيلة', name_fr: "M'Sila" },
  { code: '29', name_ar: 'معسكر', name_fr: 'Mascara' },
  { code: '30', name_ar: 'ورقلة', name_fr: 'Ouargla' },
  { code: '31', name_ar: 'وهران', name_fr: 'Oran' },
  { code: '32', name_ar: 'البيض', name_fr: 'El Bayadh' },
  { code: '33', name_ar: 'إليزي', name_fr: 'Illizi' },
  { code: '34', name_ar: 'برج بوعريريج', name_fr: 'Bordj Bou Arreridj' },
  { code: '35', name_ar: 'بومرداس', name_fr: 'Boumerdès' },
  { code: '36', name_ar: 'الطارف', name_fr: 'El Tarf' },
  { code: '37', name_ar: 'تندوف', name_fr: 'Tindouf' },
  { code: '38', name_ar: 'تسمسيلت', name_fr: 'Tissemsilt' },
  { code: '39', name_ar: 'الوادي', name_fr: 'El Oued' },
  { code: '40', name_ar: 'خنشلة', name_fr: 'Khenchela' },
  { code: '41', name_ar: 'سوق أهراس', name_fr: 'Souk Ahras' },
  { code: '42', name_ar: 'تيبازة', name_fr: 'Tipaza' },
  { code: '43', name_ar: 'ميلة', name_fr: 'Mila' },
  { code: '44', name_ar: 'عين الدفلى', name_fr: 'Aïn Defla' },
  { code: '45', name_ar: 'النعامة', name_fr: 'Naâma' },
  { code: '46', name_ar: 'عين تموشنت', name_fr: 'Aïn Témouchent' },
  { code: '47', name_ar: 'غرداية', name_fr: 'Ghardaïa' },
  { code: '48', name_ar: 'غليزان', name_fr: 'Relizane' },
  { code: '49', name_ar: 'تيميمون', name_fr: 'Timimoun' },
  { code: '50', name_ar: 'برج باجي مختار', name_fr: 'Bordj Badji Mokhtar' },
  { code: '51', name_ar: 'أولاد جلال', name_fr: 'Ouled Djellal' },
  { code: '52', name_ar: 'بني عباس', name_fr: 'Béni Abbès' },
  { code: '53', name_ar: 'عين صالح', name_fr: 'In Salah' },
  { code: '54', name_ar: 'عين قزام', name_fr: 'In Guezzam' },
  { code: '55', name_ar: 'تقرت', name_fr: 'Touggourt' },
  { code: '56', name_ar: 'جانت', name_fr: 'Djanet' },
  { code: '57', name_ar: 'المغير', name_fr: 'El M\'Ghair' },
  { code: '58', name_ar: 'المنيعة', name_fr: 'El Menia' }
];

export function wilayaByCode(code) {
  const norm = String(code).padStart(2, '0');
  return DZ_WILAYAS.find(w => w.code === norm) || null;
}

export function formatWilaya(code, lang = 'ar') {
  const w = wilayaByCode(code);
  if (!w) return String(code || '');
  return lang === 'ar' ? `${w.code} - ${w.name_ar}` : `${w.code} - ${w.name_fr}`;
}
