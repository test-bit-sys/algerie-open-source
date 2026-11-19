/**
 * DZ-Compta Pro — Plan Comptable National (SCF 2007)
 * Official Algerian Financial Accounting System (Système Comptable Financier)
 * Classes 1 through 7 with official numbers and Arabic/French labels.
 */

export const SCF_CLASSES = [
  { code: '1', nameAr: 'حسابات رؤوس الأموال (Capitaux propres et emprunts)', nameFr: 'Comptes de capitaux' },
  { code: '2', nameAr: 'حسابات التثبيتات (Immobilisations)', nameFr: 'Comptes d\'immobilisations' },
  { code: '3', nameAr: 'حسابات المخزونات والمنتجات قيد التنفيذ (Stocks)', nameFr: 'Comptes de stocks et en-cours' },
  { code: '4', nameAr: 'حسابات الغير (Tiers: Fournisseurs, Clients, Personnel, État)', nameFr: 'Comptes de tiers' },
  { code: '5', nameAr: 'الحسابات المالية (Comptes financiers: Trésorerie, Banque, Caisse)', nameFr: 'Comptes financiers' },
  { code: '6', nameAr: 'حسابات الأعباء (Charges d\'exploitation, financières, exceptionnelles)', nameFr: 'Comptes de charges' },
  { code: '7', nameAr: 'حسابات المنتوجات (Produits: Ventes, Prestations, Produits financiers)', nameFr: 'Comptes de produits' }
];

export const SCF_ACCOUNTS = [
  // Classe 1
  { code: '101', nameAr: 'رأس المال الاجتماعي (Capital social)', nameFr: 'Capital social', class: '1' },
  { code: '106', nameAr: 'الاحتياطات القانونية والنظامية (Réserves légales)', nameFr: 'Réserves', class: '1' },
  { code: '110', nameAr: 'الترحيل من جديد (Report à nouveau)', nameFr: 'Report à nouveau', class: '1' },
  { code: '120', nameAr: 'نتيجة السنة المالية - ربح (Résultat de l\'exercice - bénéfice)', nameFr: 'Résultat de l\'exercice (bénéfice)', class: '1' },
  { code: '129', nameAr: 'نتيجة السنة المالية - خسارة (Résultat de l\'exercice - perte)', nameFr: 'Résultat de l\'exercice (perte)', class: '1' },
  { code: '164', nameAr: 'اقتراضات لدى مؤسسات القرض (Emprunts auprès des ét. de crédit)', nameFr: 'Emprunts auprès des établissements de crédit', class: '1' },

  // Classe 2
  { code: '204', nameAr: 'برمجيات معلوماتية وما شابهها (Logiciels informatiques)', nameFr: 'Logiciels informatiques et assimilés', class: '2' },
  { code: '211', nameAr: 'أراضي (Terrains)', nameFr: 'Terrains', class: '2' },
  { code: '213', nameAr: 'بنايات (Constructions)', nameFr: 'Constructions', class: '2' },
  { code: '215', nameAr: 'منشآت تقنية، معدات وأدوات صناعية (Installations techniques et matériel)', nameFr: 'Installations techniques, matériel et outillage industriels', class: '2' },
  { code: '218', nameAr: 'تجهيزات مكتب ومعدات إعلام آلي (Matériel de bureau et informatique)', nameFr: 'Autre matériel et mobilier de bureau', class: '2' },
  { code: '280', nameAr: 'اهتلاك التثبيتات غير المادية (Amortissement immo incorporelles)', nameFr: 'Amortissement des immobilisations incorporelles', class: '2' },
  { code: '281', nameAr: 'اهتلاك التثبيتات المادية (Amortissement immo corporelles)', nameFr: 'Amortissement des immobilisations corporelles', class: '2' },

  // Classe 3
  { code: '30', nameAr: 'مخزونات البضائع (Stocks de marchandises)', nameFr: 'Stocks de marchandises', class: '3' },
  { code: '31', nameAr: 'مواد أولية ولوازم (Matières premières et fournitures)', nameFr: 'Matières premières et fournitures', class: '3' },
  { code: '32', nameAr: 'تموينات أخرى (Autres approvisionnements)', nameFr: 'Autres approvisionnements', class: '3' },
  { code: '35', nameAr: 'مخزونات المنتجات تامة الصنع (Stocks de produits finis)', nameFr: 'Stocks de produits finis', class: '3' },
  { code: '380', nameAr: 'مشتريات البضائع المخزنة (Achats de marchandises stockées)', nameFr: 'Marchandises stockées', class: '3' },
  { code: '390', nameAr: 'خسائر القيمة عن مخزونات البضائع (Dépréciations des stocks)', nameFr: 'Pertes de valeur sur stocks de marchandises', class: '3' },

  // Classe 4
  { code: '401', nameAr: 'موردو المخزونات والخدمات (Fournisseurs de stocks et services)', nameFr: 'Fournisseurs de stocks et services', class: '4' },
  { code: '404', nameAr: 'موردو التثبيتات (Fournisseurs d\'immobilisations)', nameFr: 'Fournisseurs d\'immobilisations', class: '4' },
  { code: '411', nameAr: 'الزبائن (Clients)', nameFr: 'Clients', class: '4' },
  { code: '416', nameAr: 'زبائن مشكوك فيهم (Clients douteux)', nameFr: 'Clients douteux', class: '4' },
  { code: '421', nameAr: 'المستخدمون - الأجور المستحقة (Personnel - Rémunérations dues)', nameFr: 'Personnel - Rémunérations dues', class: '4' },
  { code: '431', nameAr: 'الضمان الاجتماعي (Sécurité sociale - CNAS/CASNOS)', nameFr: 'Sécurité sociale', class: '4' },
  { code: '444', nameAr: 'الدولة - الضرائب على النتائج (État - Impôts sur les résultats / IBS)', nameFr: 'État - Impôts sur les résultats', class: '4' },
  { code: '445', nameAr: 'الدولة - الرسوم على رقم الأعمال المحصلة والواجبة (TVA collectée / déductible)', nameFr: 'État - Taxes sur le chiffre d\'affaires', class: '4' },
  { code: '4456', nameAr: 'رسم على القيمة المضافة قابل للاسترجاع (TVA Déductible)', nameFr: 'TVA déductible', class: '4' },
  { code: '4457', nameAr: 'رسم على القيمة المضافة محصل (TVA Collectée)', nameFr: 'TVA collectée', class: '4' },
  { code: '447', nameAr: 'الدولة - ضرائب ورسوم أخرى قابلة للتحصيل (IRG, Droits de timbre)', nameFr: 'Autres impôts, taxes et versements assimilés', class: '4' },

  // Classe 5
  { code: '512', nameAr: 'الحسابات الجارية لدى البنوك (Banque)', nameFr: 'Banques', class: '5' },
  { code: '517', nameAr: 'الحساب الجاري البريدي (Chèques postaux - CCP)', nameFr: 'Comptes de chèques postaux', class: '5' },
  { code: '530', nameAr: 'الصندوق (Caisse)', nameFr: 'Caisse', class: '5' },
  { code: '585', nameAr: 'تحويلات داخلية للأموال (Virements internes de fonds)', nameFr: 'Virements internes', class: '5' },

  // Classe 6
  { code: '600', nameAr: 'مشتريات بضائع مبيعة (Achats de marchandises vendues)', nameFr: 'Achats de marchandises vendues', class: '6' },
  { code: '601', nameAr: 'مواد أولية مستهلكة (Matières premières consommées)', nameFr: 'Matières premières consommées', class: '6' },
  { code: '607', nameAr: 'مشتريات غير مخزنة من المواد والتوريدات (Achats non stockés)', nameFr: 'Achats non stockés de matières et fournitures', class: '6' },
  { code: '613', nameAr: 'إيجارات عامة (Locations et charges locatives)', nameFr: 'Locations', class: '6' },
  { code: '615', nameAr: 'صيانة وإصلاحات (Entretien et réparations)', nameFr: 'Entretien et réparations', class: '6' },
  { code: '616', nameAr: 'أقساط التأمين (Primes d\'assurances)', nameFr: 'Primes d\'assurances', class: '6' },
  { code: '623', nameAr: 'إشهار، نشر، وعلاقات عامة (Publicité, publications, relations publiques)', nameFr: 'Publicité, publications, relations publiques', class: '6' },
  { code: '626', nameAr: 'مصاريف البريد والاتصالات السلكية واللاسلكية (Frais postaux et télécoms)', nameFr: 'Frais postaux et de télécommunications', class: '6' },
  { code: '627', nameAr: 'خدمات مصرفية وما شابهها (Services bancaires et assimilés)', nameFr: 'Services bancaires et assimilés', class: '6' },
  { code: '631', nameAr: 'أجور المستخدمين (Rémunérations du personnel)', nameFr: 'Rémunérations du personnel', class: '6' },
  { code: '635', nameAr: 'اشتراكات الضمان الاجتماعي الملقاة على عاتق المستخدم (Cotisations CNAS patronales)', nameFr: 'Cotisations aux organismes sociaux', class: '6' },
  { code: '642', nameAr: 'حقوق التسجيل والطابع الجبائي (Droits d\'enregistrement et de timbre)', nameFr: 'Droits d\'enregistrement et de timbre', class: '6' },
  { code: '661', nameAr: 'أعباء الفوائد (Charges d\'intérêts)', nameFr: 'Charges d\'intérêts', class: '6' },
  { code: '681', nameAr: 'مخصصات الاهتلاكات والتموينات (Dotations aux amortissements)', nameFr: 'Dotations aux amortissements et provisions', class: '6' },

  // Classe 7
  { code: '700', nameAr: 'مبيعات البضائع (Ventes de marchandises)', nameFr: 'Ventes de marchandises', class: '7' },
  { code: '701', nameAr: 'مبيعات المنتجات المصنعة (Ventes de produits finis)', nameFr: 'Ventes de produits finis', class: '7' },
  { code: '704', nameAr: 'أشغال وخدمات مقدمة (Prestations de services et travaux)', nameFr: 'Travaux et prestations de services', class: '7' },
  { code: '706', nameAr: 'دراسات وخدمات تقنية وفنية (Études et prestations techniques)', nameFr: 'Autres prestations de services', class: '7' },
  { code: '709', nameAr: 'تخفيضات ومردودات ممنوحة عن المبيعات (Rabais, remises accordés)', nameFr: 'Rabais, remises et ristournes accordés', class: '7' },
  { code: '768', nameAr: 'منتوجات مالية أخرى (Autres produits financiers)', nameFr: 'Autres produits financiers', class: '7' },
  { code: '772', nameAr: 'إعانات استغلال وتسيير (Subventions d\'exploitation)', nameFr: 'Subventions d\'exploitation', class: '7' }
];

export function getAccountName(code, lang = 'ar') {
  const acc = SCF_ACCOUNTS.find(a => a.code === String(code));
  if (acc) {
    return lang === 'fr' ? acc.nameFr : acc.nameAr;
  }
  return lang === 'fr' ? `Compte ${code}` : `حساب ${code}`;
}

export function searchAccounts(query) {
  if (!query) return SCF_ACCOUNTS;
  const q = String(query).trim().toLowerCase();
  return SCF_ACCOUNTS.filter(a =>
    a.code.includes(q) ||
    a.nameAr.toLowerCase().includes(q) ||
    a.nameFr.toLowerCase().includes(q)
  );
}
