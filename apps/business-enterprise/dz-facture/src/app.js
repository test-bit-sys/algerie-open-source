/**
 * DZ-Facture & POS: Master Application Controller (Enterprise Commercial Grade)
 * Trilingual (AR / FR / EN), 100% Offline-First, Full POS & Legal Invoicing Flow,
 * Daily Z-Report Cash Drawer Closing, Expenses Tracker, Camera Barcode Scanner,
 * Cart Discounts (Remise), Returns & Refunds, Debt Payments, and Financial Analytics.
 */

import { LocalDB } from './modules/db.js';
import { calculateInvoiceTotals, calculateTimbreFiscal, splitTTCByRates, round2, TVA_RATES, PAYMENT_METHODS } from './modules/fiscal.js';
import { todayLocalISO, toLocalDateKey } from './modules/dates.js';
import { tafqitDZD } from './modules/tafqit.js';
import { sound } from './modules/audio.js';
import { QRCodeSVG } from './modules/qrcode.js';
import { BusinessCharts } from './modules/charts.js';

// Application State
let currentLang = 'ar';
let cart = [];
let cartDiscountType = 'DZD'; // 'DZD' or 'PERCENT'
let cartDiscountValue = 0;
let cameraMediaStream = null;

// Shared UI icon constants (theme & sound toggles)
const SVG_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SVG_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const SVG_VOL_ON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const SVG_VOL_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

/** Persists a single preference (lang / theme / sound) into LocalDB settings. */
function persistSetting(key, value) {
  const settings = LocalDB.getSettings();
  settings[key] = value;
  LocalDB.saveSettings(settings);
}

let a4Items = [
  { id: 1, description: 'حاسوب محمول مكتبي HP ProBook G9', quantity: 2, unitPriceHT: 85000, tvaRate: 19 },
  { id: 2, description: 'طابعة فواتير ليزر A4 متعددة المهام', quantity: 1, unitPriceHT: 34000, tvaRate: 19 },
  { id: 3, description: 'حزم ورق طباعة مقاس A4 (صندوق 5 حزم)', quantity: 4, unitPriceHT: 4200, tvaRate: 9 }
];

// Comprehensive Enterprise Trilingual Dictionary
const I18N = {
  ar: {
    brandSubtitle: 'المنظومة التجارية الجزائرية',
    navDashboard: 'لوحة القيادة والمؤشرات',
    navPOS: 'نقطة البيع والكاشير (POS)',
    navInvoices: 'الفواتير وسندات التسليم (A4)',
    navProducts: 'المنتجات والمخزون',
    navClients: 'العملاء والديون (Crédit)',
    navExpenses: 'المصاريف اليومية (Dépenses)',
    navClosings: 'إغلاق الصندوق (Rapport Z)',
    navSettings: 'بيانات المؤسسة والنسخ الاحتياطي',
    footerSecurityTitle: 'هندسة أوفلاين 100% بدون إنترنت',
    footerSecurityDesc: 'بياناتك محفوظة محلياً بأمان وسرية تامة',
    shortcutSearch: 'بحث',
    shortcutHold: 'تعليق',
    shortcutCheckout: 'كاشير',
    btnQuickZReport: 'تقرير Z',
    statRevenue: 'مبيعات اليوم الإجمالية',
    statGrossProfit: 'هامش الربح التجاري',
    statExpenses: 'المصاريف التشغيلية',
    statNetProfit: 'صافي الربح الحقيقي',
    statLowStock: 'تنبيهات نفاد المخزون',
    quickSaleTitle: 'بدء بيع جديد أو تحرير فاتورة رسمية',
    quickSaleDesc: 'استخدم نقطة البيع السريع لطباعة تذاكر الكاشير (80mm)، أو محرر الفواتير الرسمي لطباعة وثائق A4 القانونية.',
    btnOpenPOS: 'فتح الكاشير (POS)',
    btnNewInvoice: 'فاتورة رسمية A4',
    recentTransactions: 'آخر المعاملات والفواتير المسجلة',
    thDocNum: 'رقم الوثيقة',
    thDate: 'التاريخ',
    thClient: 'العميل',
    thType: 'النوع',
    thPayment: 'طريقة الدفع',
    thTotalTTC: 'المجموع TTC',
    thActions: 'إجراءات',
    cartTitle: 'سلة المبيعات (Ticket)',
    totalHT: 'المجموع الصافي HT:',
    timbreFiscal: 'رسم الطابع الجبائي (1%):',
    lblDiscount: 'التخفيض (Remise):',
    grandTotal: 'المجموع الإجمالي:',
    btnPayAndPrint: 'دفع وطباعة التذكرة [F9]',
    invoiceEditorTitle: 'محرر المستندات والوثائق الرسمية',
    btnPrintA4: 'طباعة A4',
    lblDocType: 'نوع الوثيقة',
    lblDocNum: 'رقم الوثيقة',
    lblDate: 'تاريخ الإصدار',
    lblPayment: 'طريقة الدفع',
    lblSelectClient: 'اختيار العميل',
    itemsTitle: 'بنود الفاتورة',
    btnAddItem: 'إضافة سطر',
    tafqitHeader: 'التفقيط المالي بالدينار الجزائري:',
    thBarcode: 'الباركود',
    thProductName: 'اسم المنتج',
    thCategory: 'الفئة',
    thBuyPrice: 'سعر الشراء',
    thSellPrice: 'سعر البيع',
    thStock: 'الكمية بالمخزن',
    btnNewProduct: 'إضافة منتج جديد',
    thClientName: 'اسم العميل أو المؤسسة',
    thPhone: 'رقم الهاتف',
    thAddress: 'العنوان',
    thBalance: 'الرصيد / الديون المستحقة',
    btnNewClient: 'إضافة عميل جديد',
    companyProfileTitle: 'بيانات المؤسسة والتاجر',
    lblCompanyName: 'الاسم التجاري أو تسمية المؤسسة',
    lblAddress: 'العنوان الكامل',
    btnSaveProfile: 'حفظ البيانات',
    backupTitle: 'النسخ الاحتياطي وحماية البيانات',
    backupDesc: 'نظراً لأهمية بيانات تجارتك، يمكنك تصدير قاعدة البيانات كاملة بضغطة زر وحفظها على قرص فلاش خارجي (Flash Disk USB) لحمايتها من أي عطل، أو استرجاعها في أي جهاز آخر دون إنترنت.',
    btnDownloadBackup: 'تحميل نسخة احتياطية (.json)',
    lblRestoreBackup: 'استرجاع نسخة سابقة من الفلاش ديسك',
    backupPrivacyNote: 'ملاحظة: المنظومة تعمل 100% بدون خوادم خارجية لضمان أقصى درجات الخصوصية المالية.',
    modalNewProduct: 'إضافة منتج جديد للمخزون',
    btnCancel: 'إلغاء',
    btnSave: 'حفظ',
    modalNewClient: 'إضافة عميل أو شركة جديدة',
    thermalTicketTitle: 'معاينة تذكرة الكاشير (80mm)',
    chartSalesTitle: 'مؤشر المبيعات اليومية (آخر 7 أيام)',
    chartSalesSubtitle: 'تطور إجمالي الإيرادات بالدينار الجزائري (DZD)',
    chartPayTitle: 'توزيع طرق الدفع',
    chartPaySubtitle: 'نقداً / تحويل / شيك / كريدي',
    btnHeldCarts: 'المعلقة',
    btnHold: 'تعليق',
    thMargin: 'الهامش (Marge)',
    lblStamp: 'ختم وتوقيع المؤسسة (صورة PNG للختم الدائري)',
    checkoutTitle: 'تحصيل المبلغ وإرجاع الباقي',
    checkoutDueLabel: 'المبلغ الإجمالي المستحق (Total TTC):',
    checkoutBanknotes: 'أوراق النقد الجزائرية السريعة:',
    btnExact: 'المبلغ تماماً',
    checkoutReceivedLabel: 'المبلغ المقبوض من الزبون (دج):',
    checkoutChangeLabel: 'الباقي للزبون (Rendu):',
    btnConfirmPayment: 'تأكيد الدفع وطباعة التذكرة',
    heldModalTitle: 'السلات المعلقة مؤقتاً',
    barcodeModalTitle: 'ملصق الباركود والسعر',
    btnPrintLabel: 'طباعة الملصق',
    debtModalTitle: 'تسجيل دفعة / تسديد دين',
    lblDebtClient: 'اسم العميل:',
    lblCurrentDebt: 'إجمالي الدين المستحق حالياً:',
    lblDebtAmount: 'مبلغ الدفعة المسددة (دج):',
    lblDebtNote: 'ملاحظات أو رقم الإيصال:',
    btnSaveDebt: 'حفظ وتأكيد الدفعة',
    btnScanCamera: 'كاميرا',
    scannerModalTitle: 'ماسح الباركود بالكاميرا',
    scannerInstructions: 'وجّه كاميرا الهاتف أو اللابتوب نحو الباركود ليتم التعرف عليه وإضافته فوراً للسلة',
    scannerSimTitle: 'أو انقر للمسح السريع المباشر (Simulated Scan):',
    expenseFormTitle: 'تسجيل مصروف تجاري جديد',
    lblExpenseDate: 'تاريخ المصروف:',
    lblExpenseCategory: 'تصنيف المصروف:',
    lblExpenseTitle: 'بيان المصروف أو الفاتورة:',
    lblExpenseAmount: 'المبلغ المدفوع (دج):',
    lblExpensePayment: 'طريقة الصرف:',
    btnSaveExpense: 'تسجيل المصروف',
    lblTotalExpenses: 'إجمالي المصاريف:',
    thExpenseDesc: 'بيان المصروف',
    thExpenseAmount: 'المبلغ (دج)',
    zReportTitle: 'جرد وإغلاق الصندوق اليومي (Rapport Z)',
    lblOpeningFloat: 'رصيد بداية اليوم (Fond de caisse):',
    lblCashierName: 'اسم الكاشير / المسؤول:',
    lblZCashSales: 'مبيعات نقدية (Espèces):',
    lblZCardSales: 'تحويلات وبطاقات (CIB / Dahabia):',
    lblZChequeSales: 'شيكات بنكية (Chèques):',
    lblZCreditSales: 'مبيعات على الحساب (Crédit):',
    lblZCashExpenses: 'مصاريف نقدية مسحوبة من الصندوق:',
    lblZExpectedCash: 'المبلغ المفترض تواجده بالدرج (Théorique):',
    lblZActualCash: 'المبلغ الفعلي المحسوب في الدرج (دج):',
    varianceExact: 'الصندوق متطابق تماماً',
    varianceSurplus: 'فائض بالصندوق (Excédent)',
    varianceDeficit: 'عجز بالصندوق (Déficit)',
    btnConfirmZReport: 'تأكيد الإغلاق وطباعة تقرير Z (80mm)',
    historicalClosingsTitle: 'سجل إغلاقات الصندوق السابقة',
    thCashier: 'الكاشير',
    thSales: 'المبيعات',
    thActualCash: 'المقبوض',
    thVariance: 'الفارق (Écart)',
    zTicketModalTitle: 'تذكرة إغلاق الصندوق - Rapport Z',
    btnPrintZTicket: 'طباعة تقرير Z',
    btnPrintTicket: 'طباعة التذكرة',
    btnGenerateCode: 'توليد',
    stampInvalidType: 'الملف المرفق ليس صورة صالحة (PNG / JPG فقط)',
    stampTooLarge: 'حجم صورة الختم كبير جداً (الحد الأقصى 500 كيلوبايت)',
    lblInitialBalance: 'الرصيد الابتدائي أو الديون السابقة (دج)',
    catAll: 'الكل (Tous)',
    catLoyer: 'كراء المحل التجاري (Loyer)',
    catSonelgaz: 'الكهرباء والغاز والماء (Sonelgaz)',
    catSalaires: 'رواتب وأجور العمال (Salaires)',
    catTransport: 'النقل والشحن والتوصيل (Transport)',
    catFournitures: 'أكياس وتغليف ولوازم (Fournitures)',
    catMaintenance: 'صيانة وإصلاحات (Maintenance)',
    catAutre: 'مصاريف عامة أخرى (Autre)',
    optFacture: 'فاتورة نهائية (Facture Définitive)',
    optProforma: 'فاتورة أولية (Facture Proforma / Devis)',
    optBL: 'سند تسليم (Bon de Livraison)',
    optAvoir: 'فاتورة إلغاء (Facture d\'Avoir)',
    optVirement: 'تحويل بنكي / بريدي (معفى من الطابع)',
    optCheque: 'شيك بنكي (معفى من الطابع)',
    optEspeces: 'نقداً (خاضع لرسم الطابع 1%)',
    optATerme: 'على الحساب / كريدي (À Terme)',
    optExpCash: 'نقداً من الصندوق (Caisse)',
    optExpBank: 'حساب بنكي / بريدي (CCP / Banque)',
    optTva19: '19% (عادي)',
    optTva9: '9% (مخفض)',
    optTva0: '0% (معفى)',
    searchPOSPlaceholder: 'امسح الباركود بالماسح أو ابحث عن السلعة... [F2]',
    searchProductPlaceholder: 'بحث عن منتج بالاسم أو الباركود...',
    searchClientPlaceholder: 'بحث عن عميل بالاسم أو الهاتف...',
    searchExpensePlaceholder: 'بحث في المصاريف...',
    expenseTitlePlaceholder: 'مثال: فاتورة كهرباء شهر أكتوبر',
    debtPaymentNotePlaceholder: 'مثال: دفعة نقدية على الحساب',
    inStock: 'المتوفر',
    outOfStock: 'نفد المخزون',
    walkInCustomer: 'عميل نقدي (Comptoir)',
    btnRefund: 'إرجاع',
    refundConfirm: 'هل تريد تأكيد إرجاع هذه الفاتورة وإعادة السلع إلى المخزون؟',
    refundSuccess: 'تم تسجيل الإرجاع واستعادة السلع للمخزون بنجاح'
  },
  fr: {
    brandSubtitle: 'Système Commercial Algérien',
    navDashboard: 'Tableau de bord & Analyses',
    navPOS: 'Point de vente (POS)',
    navInvoices: 'Factures & Bons (A4)',
    navProducts: 'Articles & Stock',
    navClients: 'Clients & Créances',
    navExpenses: 'Dépenses & Charges',
    navClosings: 'Clôture de Caisse (Rapport Z)',
    navSettings: 'Établissement & Sauvegarde',
    footerSecurityTitle: 'Architecture 100% Hors-Ligne',
    footerSecurityDesc: 'Vos données restent 100% locales et confidentielles',
    shortcutSearch: 'Chercher',
    shortcutHold: 'Attente',
    shortcutCheckout: 'Caisse',
    btnQuickZReport: 'Rapport Z',
    statRevenue: 'Ventes du Jour',
    statGrossProfit: 'Marge Commerciale Brute',
    statExpenses: 'Dépenses Opérationnelles',
    statNetProfit: 'Bénéfice Net Réel',
    statLowStock: 'Alertes Stock Faible',
    quickSaleTitle: 'Nouvelle vente ou facture officielle',
    quickSaleDesc: 'Utilisez la caisse rapide pour tickets 80mm ou le générateur officiel A4.',
    btnOpenPOS: 'Ouvrir la Caisse',
    btnNewInvoice: 'Facture A4',
    recentTransactions: 'Dernières transactions',
    thDocNum: 'N° Document',
    thDate: 'Date',
    thClient: 'Client',
    thType: 'Type',
    thPayment: 'Règlement',
    thTotalTTC: 'Total TTC',
    thActions: 'Actions',
    cartTitle: 'Panier de vente (Ticket)',
    totalHT: 'Total Hors Taxes (HT) :',
    timbreFiscal: 'Droit de Timbre (1%) :',
    lblDiscount: 'Remise Accordée :',
    grandTotal: 'Total Général TTC :',
    btnPayAndPrint: 'Payer & Imprimer [F9]',
    invoiceEditorTitle: 'Éditeur de documents officiels',
    btnPrintA4: 'Imprimer A4',
    lblDocType: 'Type de document',
    lblDocNum: 'Numéro',
    lblDate: 'Date d\'émission',
    lblPayment: 'Mode de règlement',
    lblSelectClient: 'Sélectionner le client',
    itemsTitle: 'Lignes du document',
    btnAddItem: 'Ajouter une ligne',
    tafqitHeader: 'Montant en toutes lettres (DZD) :',
    thBarcode: 'Code-barres',
    thProductName: 'Désignation',
    thCategory: 'Catégorie',
    thBuyPrice: 'Prix d\'achat',
    thSellPrice: 'Prix de vente',
    thStock: 'Stock actuel',
    btnNewProduct: 'Ajouter un article',
    thClientName: 'Nom ou Raison Sociale',
    thPhone: 'Téléphone',
    thAddress: 'Adresse',
    thBalance: 'Solde / Créances',
    btnNewClient: 'Nouveau client',
    companyProfileTitle: 'Profil de l\'Établissement',
    lblCompanyName: 'Raison sociale / Nom commercial',
    lblAddress: 'Adresse complète',
    btnSaveProfile: 'Enregistrer le profil',
    backupTitle: 'Sauvegarde & Sécurité des données',
    backupDesc: 'Exportez instantanément toutes vos données sur clé USB Flash Disk en un clic pour une sécurité maximale 100% hors-ligne.',
    btnDownloadBackup: 'Télécharger sauvegarde (.json)',
    lblRestoreBackup: 'Restaurer depuis une clé USB',
    backupPrivacyNote: 'Remarque : Fonctionne 100% sans serveur externe garantissant la totale confidentialité.',
    modalNewProduct: 'Nouvel article en stock',
    btnCancel: 'Annuler',
    btnSave: 'Enregistrer',
    modalNewClient: 'Nouveau client / Entreprise',
    thermalTicketTitle: 'Aperçu Ticket de Caisse (80mm)',
    chartSalesTitle: 'Ventes journalières (7 derniers jours)',
    chartSalesSubtitle: 'Évolution des recettes en Dinars Algériens (DZD)',
    chartPayTitle: 'Modes de règlement',
    chartPaySubtitle: 'Espèces / Virement / Chèque / Crédit',
    btnHeldCarts: 'En attente',
    btnHold: 'Attente',
    thMargin: 'Marge bénéficiaire',
    lblStamp: 'Cachet et signature (Image PNG ronde)',
    checkoutTitle: 'Encaissement & Rendu monnaie',
    checkoutDueLabel: 'Total TTC à payer :',
    checkoutBanknotes: 'Coupures de billets rapides :',
    btnExact: 'Compte exact',
    checkoutReceivedLabel: 'Montant reçu du client (DA) :',
    checkoutChangeLabel: 'Monnaie à rendre :',
    btnConfirmPayment: 'Confirmer et Imprimer Ticket',
    heldModalTitle: 'Paniers en attente',
    barcodeModalTitle: 'Étiquette code-barres & Prix',
    btnPrintLabel: 'Imprimer étiquette',
    debtModalTitle: 'Versement / Règlement créance',
    lblDebtClient: 'Client :',
    lblCurrentDebt: 'Créance totale due :',
    lblDebtAmount: 'Montant versé (DA) :',
    lblDebtNote: 'Notes ou réf. reçu :',
    btnSaveDebt: 'Valider le versement',
    btnScanCamera: 'Caméra',
    scannerModalTitle: 'Scanner code-barres caméra',
    scannerInstructions: 'Orientez la caméra vers le code-barres pour ajout immédiat au panier',
    scannerSimTitle: 'Ou cliquez pour scanner un test instantané :',
    expenseFormTitle: 'Enregistrer une nouvelle dépense',
    lblExpenseDate: 'Date de la dépense :',
    lblExpenseCategory: 'Catégorie :',
    lblExpenseTitle: 'Désignation / Motif :',
    lblExpenseAmount: 'Montant payé (DA) :',
    lblExpensePayment: 'Mode de sortie :',
    btnSaveExpense: 'Enregistrer la dépense',
    lblTotalExpenses: 'Total des dépenses :',
    thExpenseDesc: 'Désignation',
    thExpenseAmount: 'Montant (DA)',
    zReportTitle: 'Clôture journalière de caisse (Rapport Z)',
    lblOpeningFloat: 'Fond de caisse initial :',
    lblCashierName: 'Nom du caissier / Gérant :',
    lblZCashSales: 'Ventes en espèces :',
    lblZCardSales: 'Ventes CIB / Carte / Virement :',
    lblZChequeSales: 'Ventes par chèque :',
    lblZCreditSales: 'Ventes à crédit (À terme) :',
    lblZCashExpenses: 'Dépenses sorties de caisse :',
    lblZExpectedCash: 'Espèces théoriques en caisse :',
    lblZActualCash: 'Espèces réelles comptées (DA) :',
    varianceExact: 'Caisse parfaitement équilibrée',
    varianceSurplus: 'Excédent de caisse (Surplus)',
    varianceDeficit: 'Déficit de caisse (Manquant)',
    btnConfirmZReport: 'Valider clôture & Imprimer Rapport Z',
    historicalClosingsTitle: 'Historique des clôtures de caisse',
    thCashier: 'Caissier',
    thSales: 'Ventes',
    thActualCash: 'Encaissé',
    thVariance: 'Écart de caisse',
    zTicketModalTitle: 'Ticket Clôture de Caisse - Rapport Z',
    btnPrintZTicket: 'Imprimer Rapport Z',
    btnPrintTicket: 'Imprimer Ticket',
    btnGenerateCode: 'Générer',
    stampInvalidType: 'Le fichier sélectionné n\u2019est pas une image valide (PNG / JPG uniquement)',
    stampTooLarge: 'L\u2019image du cachet est trop volumineuse (max 500 Ko)',
    lblInitialBalance: 'Solde initial ou dette antérieure (DA)',
    catAll: 'Tous (All)',
    catLoyer: 'Loyer commercial',
    catSonelgaz: 'Électricité & Gaz (Sonelgaz)',
    catSalaires: 'Salaires & Rémunérations',
    catTransport: 'Transport & Expédition',
    catFournitures: 'Emballage & Fournitures',
    catMaintenance: 'Maintenance & Réparations',
    catAutre: 'Autres charges diverses',
    optFacture: 'Facture Définitive',
    optProforma: 'Facture Proforma / Devis',
    optBL: 'Bon de Livraison (BL)',
    optAvoir: 'Facture d\'Avoir (Retour)',
    optVirement: 'Virement bancaire / postal',
    optCheque: 'Chèque bancaire',
    optEspeces: 'Espèces (Timbre fiscal 1%)',
    optATerme: 'À terme (Crédit client)',
    optExpCash: 'Espèces de la caisse',
    optExpBank: 'Compte bancaire / CCP',
    optTva19: '19% (Normal)',
    optTva9: '9% (Réduit)',
    optTva0: '0% (Exonéré)',
    searchPOSPlaceholder: 'Scanner code-barres ou rechercher un article... [F2]',
    searchProductPlaceholder: 'Rechercher par désignation ou code-barres...',
    searchClientPlaceholder: 'Rechercher un client par nom ou téléphone...',
    searchExpensePlaceholder: 'Rechercher une dépense...',
    expenseTitlePlaceholder: 'Ex: Facture Sonelgaz octobre',
    debtPaymentNotePlaceholder: 'Ex: Versement partiel espèces',
    inStock: 'En stock',
    outOfStock: 'Rupture',
    walkInCustomer: 'Client Comptoir',
    btnRefund: 'Retour',
    refundConfirm: 'Confirmer le retour de cette vente et la réintégration des articles en stock ?',
    refundSuccess: 'Vente retournée et stock réapprovisionné avec succès'
  },
  en: {
    brandSubtitle: 'Algerian Commercial ERP',
    navDashboard: 'Dashboard & Metrics',
    navPOS: 'Point of Sale (POS)',
    navInvoices: 'Invoices & Vouchers (A4)',
    navProducts: 'Products & Inventory',
    navClients: 'Clients & Receivables',
    navExpenses: 'Expenses & Overhead',
    navClosings: 'Register Closing (Z-Report)',
    navSettings: 'Company & USB Backup',
    footerSecurityTitle: '100% Offline-First Architecture',
    footerSecurityDesc: 'Your business data stays local and confidential',
    shortcutSearch: 'Search',
    shortcutHold: 'Hold',
    shortcutCheckout: 'Cashier',
    btnQuickZReport: 'Z-Report',
    statRevenue: 'Today\'s Revenue',
    statGrossProfit: 'Gross Profit Margin',
    statExpenses: 'Operating Expenses',
    statNetProfit: 'True Net Profit',
    statLowStock: 'Low Stock Alerts',
    quickSaleTitle: 'Start a Sale or Issue Invoice',
    quickSaleDesc: 'Use fast POS for 80mm receipt printers or the legal A4 invoice editor.',
    btnOpenPOS: 'Open POS Register',
    btnNewInvoice: 'Official A4 Invoice',
    recentTransactions: 'Recent Transactions',
    thDocNum: 'Doc N°',
    thDate: 'Date',
    thClient: 'Client',
    thType: 'Type',
    thPayment: 'Payment Method',
    thTotalTTC: 'Total TTC',
    thActions: 'Actions',
    cartTitle: 'Sales Register (Ticket)',
    totalHT: 'Total Excl. Tax (HT):',
    timbreFiscal: 'Cash Stamp Duty (1%):',
    lblDiscount: 'Discount (Remise):',
    grandTotal: 'Grand Total TTC:',
    btnPayAndPrint: 'Pay & Print [F9]',
    invoiceEditorTitle: 'Official Document Editor',
    btnPrintA4: 'Print A4 Document',
    lblDocType: 'Document Type',
    lblDocNum: 'Document Number',
    lblDate: 'Issue Date',
    lblPayment: 'Payment Method',
    lblSelectClient: 'Select Client',
    itemsTitle: 'Document Items',
    btnAddItem: 'Add Item Line',
    tafqitHeader: 'Official Amount in Words (DZD):',
    thBarcode: 'Barcode',
    thProductName: 'Item Description',
    thCategory: 'Category',
    thBuyPrice: 'Cost Price',
    thSellPrice: 'Selling Price',
    thStock: 'Qty in Stock',
    btnNewProduct: 'Add New Product',
    thClientName: 'Client / Company Name',
    thPhone: 'Phone',
    thAddress: 'Address',
    thBalance: 'Balance / Due Debts',
    btnNewClient: 'Add New Client',
    companyProfileTitle: 'Business Profile',
    lblCompanyName: 'Company Name / Trade Name',
    lblAddress: 'Full Address',
    btnSaveProfile: 'Save Profile',
    backupTitle: 'Backup & Data Protection',
    backupDesc: 'Export your entire local database to an external USB Flash drive with one click for maximum 100% offline security.',
    btnDownloadBackup: 'Download Backup (.json)',
    lblRestoreBackup: 'Restore from USB Flash drive',
    backupPrivacyNote: 'Note: Runs 100% locally with zero external telemetry ensuring full commercial privacy.',
    modalNewProduct: 'Add New Item to Inventory',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    modalNewClient: 'Add New Client / Company',
    thermalTicketTitle: 'Cashier Thermal Receipt (80mm)',
    chartSalesTitle: 'Daily Sales Trend (Last 7 Days)',
    chartSalesSubtitle: 'Revenue performance in Algerian Dinars (DZD)',
    chartPayTitle: 'Payment Breakdown',
    chartPaySubtitle: 'Cash / Bank Transfer / Cheque / Credit',
    btnHeldCarts: 'Held',
    btnHold: 'Hold',
    thMargin: 'Profit Margin',
    lblStamp: 'Company Stamp & Signature (Round PNG Image)',
    checkoutTitle: 'Cashier Checkout & Change Calculator',
    checkoutDueLabel: 'Total Due (TTC):',
    checkoutBanknotes: 'Quick Banknotes:',
    btnExact: 'Exact Amount',
    checkoutReceivedLabel: 'Cash Received (DZD):',
    checkoutChangeLabel: 'Change to Return:',
    btnConfirmPayment: 'Confirm & Print Receipt',
    heldModalTitle: 'Temporarily Held Carts',
    barcodeModalTitle: 'Barcode & Price Tag',
    btnPrintLabel: 'Print Sticker',
    debtModalTitle: 'Record Debt Payment',
    lblDebtClient: 'Client Name:',
    lblCurrentDebt: 'Total Debt Due:',
    lblDebtAmount: 'Payment Amount (DZD):',
    lblDebtNote: 'Notes or Receipt Ref:',
    btnSaveDebt: 'Confirm Payment',
    btnScanCamera: 'Camera',
    scannerModalTitle: 'Camera Barcode Scanner',
    scannerInstructions: 'Point device camera at product barcode for instant cart addition',
    scannerSimTitle: 'Or click for instant simulated test scan:',
    expenseFormTitle: 'Record Business Expense',
    lblExpenseDate: 'Expense Date:',
    lblExpenseCategory: 'Category:',
    lblExpenseTitle: 'Description / Invoice Ref:',
    lblExpenseAmount: 'Amount Paid (DZD):',
    lblExpensePayment: 'Disbursement Method:',
    btnSaveExpense: 'Save Expense',
    lblTotalExpenses: 'Total Operating Expenses:',
    thExpenseDesc: 'Description',
    thExpenseAmount: 'Amount (DZD)',
    zReportTitle: 'Daily Register Closing (Z-Report)',
    lblOpeningFloat: 'Opening Drawer Float:',
    lblCashierName: 'Cashier / Manager Name:',
    lblZCashSales: 'Cash Sales (Espèces):',
    lblZCardSales: 'CIB / Card / Bank Transfers:',
    lblZChequeSales: 'Cheque Sales:',
    lblZCreditSales: 'Credit / Account Sales:',
    lblZCashExpenses: 'Cash Paid Out from Drawer:',
    lblZExpectedCash: 'Expected Cash in Drawer:',
    lblZActualCash: 'Actual Counted Cash (DZD):',
    varianceExact: 'Cash Drawer Perfectly Balanced',
    varianceSurplus: 'Drawer Surplus (Over)',
    varianceDeficit: 'Drawer Deficit (Short)',
    btnConfirmZReport: 'Confirm Closing & Print Z-Report',
    historicalClosingsTitle: 'Historical Cashier Closings',
    thCashier: 'Cashier',
    thSales: 'Sales',
    thActualCash: 'Counted',
    thVariance: 'Variance',
    zTicketModalTitle: 'Cash Register Closing - Z-Report',
    btnPrintZTicket: 'Print Z-Report',
    btnPrintTicket: 'Print Receipt',
    btnGenerateCode: 'Generate',
    stampInvalidType: 'The selected file is not a valid image (PNG / JPG only)',
    stampTooLarge: 'Stamp image is too large (500 KB max)',
    lblInitialBalance: 'Initial Balance or Past Debt (DZD)',
    catAll: 'All Categories',
    catLoyer: 'Store Rent (Loyer)',
    catSonelgaz: 'Electricity & Gas (Sonelgaz)',
    catSalaires: 'Wages & Salaries',
    catTransport: 'Transport & Delivery',
    catFournitures: 'Packaging & Supplies',
    catMaintenance: 'Maintenance & Repairs',
    catAutre: 'Other General Expenses',
    optFacture: 'Final Invoice (Facture Définitive)',
    optProforma: 'Proforma Invoice / Quote',
    optBL: 'Delivery Note (Bon de Livraison)',
    optAvoir: 'Credit Note (Facture d\'Avoir)',
    optVirement: 'Bank / Postal Transfer',
    optCheque: 'Bank Cheque',
    optEspeces: 'Cash (1% Stamp Duty)',
    optATerme: 'On Account / Credit',
    optExpCash: 'Cash from Drawer',
    optExpBank: 'Bank Account / Postal CCP',
    optTva19: '19% (Standard)',
    optTva9: '9% (Reduced)',
    optTva0: '0% (Exempt)',
    searchPOSPlaceholder: 'Scan barcode or search product... [F2]',
    searchProductPlaceholder: 'Search product by description or barcode...',
    searchClientPlaceholder: 'Search client by name or phone...',
    searchExpensePlaceholder: 'Search expenses...',
    expenseTitlePlaceholder: 'Ex: Monthly electricity bill',
    debtPaymentNotePlaceholder: 'Ex: Cash installment',
    inStock: 'In stock',
    outOfStock: 'Out of stock',
    walkInCustomer: 'Walk-in Customer',
    btnRefund: 'Refund',
    refundConfirm: 'Confirm returning this transaction and restoring items to inventory?',
    refundSuccess: 'Transaction refunded and stock replenished successfully'
  }
};

// Toast Notifications Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else {
    iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="8"/></svg>';
  }
  toast.innerHTML = `<span style="display:inline-flex; align-items:center;">${iconSvg}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Universal Currency Formatter
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  if (currentLang === 'ar') {
    return `${num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} دج`;
  } else if (currentLang === 'fr') {
    return `${num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`;
  } else {
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`;
  }
}

/** Applies preferences (language / theme / sound) saved from the last session. */
function restorePersistedSettings() {
  const settings = LocalDB.getSettings();

  if (settings.lang && I18N[settings.lang]) {
    currentLang = settings.lang;
  }

  if (settings.theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.setAttribute('data-theme', 'dark');
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.innerHTML = SVG_SUN;
  }

  if (settings.soundMuted) {
    sound.setMuted(true);
    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
      soundBtn.innerHTML = SVG_VOL_OFF;
      soundBtn.title = currentLang === 'ar' ? 'تشغيل الصوت' : 'Activer le son';
    }
  }
}

// Master DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  LocalDB.init();
  restorePersistedSettings();

  initNavigation();
  initLanguageAndTheme();
  initSoundEngine();
  initKeyboardShortcuts();
  initDashboard();
  initPOS();
  initFacturationA4();
  initProducts();
  initClients();
  initExpenses();
  initClosings();
  initSettings();

  applyLanguage(currentLang);
});

// 1. NAVIGATION CONTROLLER
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.dataset.tab;

      navButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));

      btn.classList.add('active');
      const activePane = document.getElementById(targetTabId);
      if (activePane) {
        activePane.classList.add('active');
      }

      const titleKey = btn.querySelector('[data-i18n]')?.dataset.i18n;
      if (titleKey && I18N[currentLang][titleKey]) {
        document.getElementById('pageTitleText').textContent = I18N[currentLang][titleKey];
      }

      if (targetTabId === 'tab-dashboard') {
        refreshDashboard();
      } else if (targetTabId === 'tab-pos') {
        refreshPOSGrid();
        setTimeout(() => document.getElementById('posBarcodeInput')?.focus(), 100);
      } else if (targetTabId === 'tab-invoices') {
        updateA4Calculations();
      } else if (targetTabId === 'tab-expenses') {
        refreshExpensesTable();
      } else if (targetTabId === 'tab-closings') {
        refreshClosingsTab();
      }
    });
  });

  document.getElementById('btnLaunchPos')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="tab-pos"]')?.click();
  });

  document.getElementById('btnNewA4Invoice')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="tab-invoices"]')?.click();
  });

  document.getElementById('quickZReportBtn')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="tab-closings"]')?.click();
  });
}

// 2. LANGUAGE, THEME & AUDIO
function initLanguageAndTheme() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      applyLanguage(lang);
    });
  });

  const themeBtn = document.getElementById('themeToggleBtn');
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      document.body.removeAttribute('data-theme');
      themeBtn.innerHTML = SVG_MOON;
      persistSetting('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.setAttribute('data-theme', 'dark');
      themeBtn.innerHTML = SVG_SUN;
      persistSetting('theme', 'dark');
    }
    refreshDashboard();
  });
}

function initSoundEngine() {
  const soundBtn = document.getElementById('soundToggleBtn');
  if (!soundBtn) return;

  soundBtn.addEventListener('click', () => {
    const isMuted = sound.toggleMute();
    soundBtn.innerHTML = isMuted ? SVG_VOL_OFF : SVG_VOL_ON;
    soundBtn.title = isMuted ? (currentLang === 'ar' ? 'تشغيل الصوت' : 'Activer le son') : (currentLang === 'ar' ? 'كتم الصوت' : 'Couper le son');
    persistSetting('soundMuted', isMuted);
    showToast(isMuted ? (currentLang === 'ar' ? 'تم كتم الصوت' : 'Son coupé') : (currentLang === 'ar' ? 'تم تفعيل الصوت' : 'Son activé'));
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'F2') {
      e.preventDefault();
      document.querySelector('.nav-btn[data-tab="tab-pos"]')?.click();
      const input = document.getElementById('posBarcodeInput');
      if (input) {
        input.focus();
        input.select();
      }
    } else if (e.key === 'F4') {
      e.preventDefault();
      document.getElementById('btnHoldCurrentCart')?.click();
    } else if (e.key === 'F9') {
      e.preventDefault();
      const posTab = document.getElementById('tab-pos');
      if (posTab && posTab.classList.contains('active')) {
        document.getElementById('btnPosCheckout')?.click();
      }
    } else if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      stopCameraScanner();
    }
  });
}

function applyLanguage(lang) {
  currentLang = lang;
  persistSetting('lang', lang);
  const html = document.documentElement;

  if (lang === 'ar') {
    html.setAttribute('lang', 'ar');
    html.setAttribute('dir', 'rtl');
  } else {
    html.setAttribute('lang', lang);
    html.setAttribute('dir', 'ltr');
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const t = I18N[lang];

  // 1. Text elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) {
      el.textContent = t[key];
    }
  });

  // 2. Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (t[key]) {
      el.placeholder = t[key];
    }
  });

  // 3. Dynamic Page Title
  const activeBtn = document.querySelector('.nav-btn.active');
  const titleKey = activeBtn?.querySelector('[data-i18n]')?.dataset.i18n;
  if (titleKey && t[titleKey]) {
    document.getElementById('pageTitleText').textContent = t[titleKey];
  }

  // 4. Update dynamic tables, sheets, and totals
  updateA4Calculations();
  refreshDashboard();
  refreshPOSGrid();
  renderCart();
  refreshExpensesTable();
  refreshClosingsTab();
}

// 3. DASHBOARD METRICS & CHARTS
function initDashboard() {
  refreshDashboard();
}

function refreshDashboard() {
  const invoices = LocalDB.getInvoices();
  const products = LocalDB.getProducts();
  const expenses = LocalDB.getExpenses();

  const todayStr = todayLocalISO();
  const todayInvoices = invoices.filter(inv => {
    return toLocalDateKey(inv.docDate || inv.createdAt) === todayStr;
  });

  const todaySales = todayInvoices.reduce((sum, inv) => sum + (Number(inv.totalTTC) || 0), 0);
  const totalGrossProfit = invoices.reduce((sum, inv) => sum + (Number(inv.grossProfit) || 0), 0);
  const totalExpenses = expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const trueNetProfit = totalGrossProfit - totalExpenses;
  const lowStock = products.filter(p => Number(p.stock) <= (Number(p.minStock) || 5)).length;

  document.getElementById('statTodaySales').textContent = formatCurrency(todaySales);
  document.getElementById('statGrossProfit').textContent = formatCurrency(totalGrossProfit);
  document.getElementById('statTotalExpenses').textContent = formatCurrency(totalExpenses);
  
  const netEl = document.getElementById('statNetProfit');
  netEl.textContent = formatCurrency(trueNetProfit);
  netEl.style.color = trueNetProfit >= 0 ? '#16a34a' : '#dc2626';

  document.getElementById('statLowStockCount').textContent = lowStock;

  // Render SVG Charts with current language
  const weeklyContainer = document.getElementById('weeklySalesChartContainer');
  const donutContainer = document.getElementById('paymentDonutContainer');
  if (weeklyContainer) BusinessCharts.renderWeeklySalesChart(weeklyContainer, invoices, currentLang);
  if (donutContainer) BusinessCharts.renderPaymentDonut(donutContainer, invoices, currentLang);

  // Render Recent Invoices Table
  const tbody = document.getElementById('recentInvoicesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const t = I18N[currentLang];

  invoices.slice(0, 8).forEach(inv => {
    const tr = document.createElement('tr');
    const docTypeLabel = inv.docType === 'POS' ? (currentLang === 'ar' ? 'تذكرة POS' : currentLang === 'fr' ? 'Ticket POS' : 'POS Receipt') :
                         inv.docType === 'BL' ? (currentLang === 'ar' ? 'سند تسليم' : currentLang === 'fr' ? 'Bon Livraison' : 'Delivery Note') :
                         inv.docType === 'AVOIR' ? (currentLang === 'ar' ? 'إلغاء / مردود' : currentLang === 'fr' ? 'Avoir' : 'Credit Note') :
                         (currentLang === 'ar' ? 'فاتورة' : currentLang === 'fr' ? 'Facture' : 'Invoice');

    const paymentLabel = (inv.paymentMethod === 'ESPECES' || inv.paymentMethod === 'نقداً') ? (currentLang === 'ar' ? 'نقداً' : currentLang === 'fr' ? 'Espèces' : 'Cash') :
                         (inv.paymentMethod === 'VIREMENT' || inv.paymentMethod === 'تحويل') ? (currentLang === 'ar' ? 'تحويل' : currentLang === 'fr' ? 'Virement' : 'Transfer') :
                         (inv.paymentMethod === 'CHEQUE' || inv.paymentMethod === 'شيك') ? (currentLang === 'ar' ? 'شيك' : currentLang === 'fr' ? 'Chèque' : 'Cheque') :
                         (currentLang === 'ar' ? 'كريدي' : currentLang === 'fr' ? 'Crédit' : 'Credit');

    const isWalkIn = !inv.clientName || inv.clientName.includes('عميل نقدي') || inv.clientName.includes('Comptoir') || inv.clientName.includes('Walk-in');
    const clientDisplay = isWalkIn ? t.walkInCustomer : inv.clientName;

    tr.innerHTML = `
      <td style="font-weight:700; color:var(--primary); font-family:monospace;">${escapeHtml(inv.docNumber || inv.id)}</td>
      <td style="color:var(--text-muted); font-size:0.8rem;">${(inv.docDate || inv.createdAt || '').substring(0, 10)}</td>
      <td style="font-weight:600;">${escapeHtml(clientDisplay)}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); border:1px solid var(--border); padding:2px 8px; border-radius:4px; font-weight:700;">${docTypeLabel}</span></td>
      <td><span style="font-size:0.75rem; font-weight:700; color:#0284c7;">${paymentLabel}</span></td>
      <td style="text-align:right; font-weight:800; font-size:0.95rem;">${formatCurrency(inv.totalTTC || 0)}</td>
      <td style="text-align:center; display:flex; gap:0.3rem; justify-content:center;">
        <button class="btn btn-outline btn-sm btn-print-row" data-id="${inv.id}" title="طباعة / معاينة"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
        <button class="btn btn-outline btn-sm btn-refund-row" data-id="${inv.id}" title="${t.btnRefund}">${t.btnRefund}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-print-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const inv = invoices.find(i => i.id === btn.dataset.id);
      if (inv) {
        if (inv.docType === 'POS') {
          openTicketPrintModal(inv);
        } else {
          loadInvoiceIntoA4(inv);
          document.querySelector('.nav-btn[data-tab="tab-invoices"]')?.click();
        }
      }
    });
  });

  tbody.querySelectorAll('.btn-refund-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const inv = invoices.find(i => i.id === btn.dataset.id);
      if (inv && confirm(t.refundConfirm)) {
        // Replenish stock
        (inv.items || []).forEach(it => {
          if (it.productId) LocalDB.restoreStock(it.productId, it.quantity);
        });

        // Record refund / avoir
        const refundDoc = {
          docType: 'AVOIR',
          docNumber: LocalDB.nextDocNumber('AVR'),
          docDate: todayLocalISO(),
          clientName: inv.clientName || t.walkInCustomer,
          paymentMethod: inv.paymentMethod || 'ESPECES',
          items: (inv.items || []).map(it => ({ ...it, totalTTC: -(Number(it.totalTTC) || 0) })),
          totalHT: -(Number(inv.totalHT) || 0),
          totalTVA: -(Number(inv.totalTVA) || 0),
          timbreFiscal: -(Number(inv.timbreFiscal) || 0),
          totalTTC: -(Number(inv.totalTTC) || 0),
          grossProfit: -(Number(inv.grossProfit) || 0)
        };

        LocalDB.addInvoice(refundDoc);
        sound.playCashSuccess();
        showToast(t.refundSuccess);
        refreshDashboard();
        refreshPOSGrid();
      }
    });
  });
}

// 4. POS CASHIER CONTROLLER
function initPOS() {
  refreshPOSGrid();
  renderCart();
  updateHeldCartsBadge();

  // Barcode input
  const searchInput = document.getElementById('posBarcodeInput');
  searchInput.addEventListener('input', e => {
    refreshPOSGrid(e.target.value);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = searchInput.value.trim();
      if (!code) return;
      const products = LocalDB.getProducts();
      const found = products.find(p => p.barcode === code || p.id === code || (p.name || '').toLowerCase() === code.toLowerCase());
      if (found) {
        addToCart(found);
        searchInput.value = '';
        sound.playBeep();
      } else {
        sound.playError();
        showToast(currentLang === 'ar' ? 'الصنف غير موجود بالمخزن' : 'Article non trouvé', 'warning');
      }
    }
  });

  // Discount toggle (% or DZD)
  const discountToggleBtn = document.getElementById('btnDiscountToggle');
  const discountInput = document.getElementById('cartDiscountInput');

  discountToggleBtn.addEventListener('click', () => {
    cartDiscountType = cartDiscountType === 'DZD' ? 'PERCENT' : 'DZD';
    discountToggleBtn.textContent = cartDiscountType === 'DZD' ? (currentLang === 'ar' ? 'دج' : 'DZD') : '%';
    renderCart();
  });

  discountInput.addEventListener('input', () => {
    cartDiscountValue = Math.max(0, Number(discountInput.value) || 0);
    renderCart();
  });

  // Clear Cart
  document.getElementById('btnClearCart').addEventListener('click', () => {
    if (cart.length > 0 && confirm(currentLang === 'ar' ? 'هل تريد إفراغ سلة البيع؟' : 'Vider le panier ?')) {
      cart = [];
      cartDiscountValue = 0;
      discountInput.value = 0;
      renderCart();
    }
  });

  // Hold Cart
  document.getElementById('btnHoldCurrentCart').addEventListener('click', () => {
    if (cart.length === 0) {
      showToast(currentLang === 'ar' ? 'السلة فارغة حالياً' : 'Le panier est vide', 'warning');
      return;
    }
    LocalDB.saveHeldCart(cart, '', { type: cartDiscountType, value: cartDiscountValue });
    cart = [];
    cartDiscountValue = 0;
    discountInput.value = 0;
    renderCart();
    updateHeldCartsBadge();
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تم تعليق السلة لخدمة زبون آخر مؤقتاً' : 'Panier mis en attente');
  });

  // Held Carts Modal
  document.getElementById('btnHeldCartsList').addEventListener('click', openHeldCartsModal);
  document.getElementById('btnCloseHeldModal').addEventListener('click', () => {
    document.getElementById('heldCartsModal').classList.remove('active');
  });

  // Checkout Modal
  document.getElementById('btnPosCheckout').addEventListener('click', () => {
    if (cart.length === 0) {
      sound.playError();
      showToast(currentLang === 'ar' ? 'يرجى إضافة سلع إلى السلة أولاً' : 'Ajoutez des articles au panier', 'warning');
      return;
    }
    openCheckoutModal();
  });

  initCheckoutCalculator();
  initCameraScanner();

  // Close ticket modal
  document.getElementById('btnCloseTicketModal').addEventListener('click', () => {
    document.getElementById('ticketPrintModal').classList.remove('active');
  });

  document.getElementById('btnConfirmPrintTicket').addEventListener('click', () => {
    window.print();
  });
}

// Camera Barcode Scanner Subsystem
function initCameraScanner() {
  const modal = document.getElementById('scannerModal');
  const btnOpen = document.getElementById('btnOpenScannerModal');
  const btnClose = document.getElementById('btnCloseScannerModal');
  const quickSimGrid = document.getElementById('scannerQuickSimGrid');

  btnOpen.addEventListener('click', async () => {
    modal.classList.add('active');
    populateSimulatedBarcodes();

    // Start video stream if possible
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        cameraMediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        const video = document.getElementById('scannerVideo');
        if (video) {
          video.srcObject = cameraMediaStream;
          video.play();
        }
      }
    } catch (err) {
      console.log('Camera access notice:', err.message);
    }
  });

  btnClose.addEventListener('click', () => {
    modal.classList.remove('active');
    stopCameraScanner();
  });
}

function stopCameraScanner() {
  if (cameraMediaStream) {
    cameraMediaStream.getTracks().forEach(t => t.stop());
    cameraMediaStream = null;
  }
}

function populateSimulatedBarcodes() {
  const grid = document.getElementById('scannerQuickSimGrid');
  grid.innerHTML = '';
  const products = LocalDB.getProducts();

  products.slice(0, 6).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm';
    btn.style.cssText = 'font-size:0.75rem; padding:3px 8px; font-weight:700;';
    btn.innerHTML = `${escapeHtml((p.name || '').substring(0, 24))}... <span style="color:var(--primary); font-family:monospace;">(${escapeHtml(p.barcode || '')})</span>`;
    btn.addEventListener('click', () => {
      addToCart(p);
      sound.playBeep();
      showToast(`${p.name} (+1)`);
      document.getElementById('scannerModal').classList.remove('active');
      stopCameraScanner();
    });
    grid.appendChild(btn);
  });
}

function updateHeldCartsBadge() {
  const held = LocalDB.getHeldCarts();
  const countEl = document.getElementById('heldCartsCount');
  if (countEl) countEl.textContent = held.length;
}

function openHeldCartsModal() {
  const modal = document.getElementById('heldCartsModal');
  const container = document.getElementById('heldCartsContainer');
  const held = LocalDB.getHeldCarts();

  container.innerHTML = '';
  if (held.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--text-muted);">${currentLang === 'ar' ? 'لا توجد سلات معلقة حالياً' : 'Aucun panier en attente.'}</div>`;
  } else {
    held.forEach(h => {
      const div = document.createElement('div');
      div.style.cssText = 'background:var(--bg-main); border:1px solid var(--border); border-radius:8px; padding:0.75rem; display:flex; justify-content:space-between; align-items:center;';
      const itemsCount = h.items.reduce((s, it) => s + it.quantity, 0);
      const total = h.items.reduce((s, it) => s + (it.quantity * it.sellPrice), 0);

      div.innerHTML = `
        <div>
          <div style="font-weight:800;">${escapeHtml(h.label)} <span style="font-size:0.75rem; color:var(--text-muted);">(${h.savedAt})</span></div>
          <div style="font-size:0.8rem; color:var(--text-muted);">${itemsCount} ${currentLang === 'ar' ? 'سلع' : 'articles'} - ${currentLang === 'ar' ? 'المجموع' : 'Total'}: <b>${formatCurrency(total)}</b></div>
        </div>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-primary btn-sm btn-restore-held" data-id="${h.id}">${currentLang === 'ar' ? 'استئناف ▶️' : 'Reprendre ▶️'}</button>
          <button class="btn btn-danger btn-sm btn-del-held" data-id="${h.id}">✕</button>
        </div>
      `;
      container.appendChild(div);
    });

    container.querySelectorAll('.btn-restore-held').forEach(b => {
      b.addEventListener('click', () => {
        const item = held.find(h => h.id === b.dataset.id);
        if (item) {
          cart = item.items;
          if (item.discount) {
            cartDiscountType = item.discount.type === 'PERCENT' ? 'PERCENT' : 'DZD';
            cartDiscountValue = Math.max(0, Number(item.discount.value) || 0);
            const discountInput = document.getElementById('cartDiscountInput');
            if (discountInput) discountInput.value = cartDiscountValue;
          }
          LocalDB.removeHeldCart(item.id);
          renderCart();
          updateHeldCartsBadge();
          modal.classList.remove('active');
          sound.playBeep();
          showToast(currentLang === 'ar' ? 'تمت استعادة السلة المعلقة بنجاح' : 'Panier restauré avec succès');
        }
      });
    });

    container.querySelectorAll('.btn-del-held').forEach(b => {
      b.addEventListener('click', () => {
        LocalDB.removeHeldCart(b.dataset.id);
        openHeldCartsModal();
        updateHeldCartsBadge();
      });
    });
  }

  modal.classList.add('active');
}

/** Reads the currently selected POS payment method (defaults to cash). */
function getSelectedCheckoutMethod() {
  return document.getElementById('checkoutPaymentMethod')?.value || 'ESPECES';
}

function openCheckoutModal() {
  const totals = calculatePOSCartTotals(getSelectedCheckoutMethod());
  const modal = document.getElementById('checkoutModal');
  const dueEl = document.getElementById('checkoutDueAmount');
  const receivedInput = document.getElementById('checkoutReceivedAmount');
  const changeEl = document.getElementById('checkoutChangeDue');

  dueEl.textContent = formatCurrency(totals.grandTotalTTC);
  receivedInput.value = totals.grandTotalTTC;
  changeEl.textContent = formatCurrency(0);

  modal.classList.add('active');
  setTimeout(() => {
    receivedInput.focus();
    receivedInput.select();
  }, 100);
}

function initCheckoutCalculator() {
  const modal = document.getElementById('checkoutModal');
  const receivedInput = document.getElementById('checkoutReceivedAmount');
  const changeEl = document.getElementById('checkoutChangeDue');

  function updateChange() {
    const totals = calculatePOSCartTotals(getSelectedCheckoutMethod());
    const received = Number(receivedInput.value) || 0;
    const change = Math.max(0, received - totals.grandTotalTTC);
    changeEl.textContent = formatCurrency(change);
  }

  receivedInput.addEventListener('input', updateChange);

  // The 1% stamp duty applies ONLY to cash — when the merchant switches the
  // payment method, recompute the due amount and suggest the exact total.
  document.getElementById('checkoutPaymentMethod').addEventListener('change', () => {
    const totals = calculatePOSCartTotals(getSelectedCheckoutMethod());
    document.getElementById('checkoutDueAmount').textContent = formatCurrency(totals.grandTotalTTC);
    receivedInput.value = totals.grandTotalTTC;
    updateChange();
  });

  document.querySelectorAll('.banknote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const totals = calculatePOSCartTotals(getSelectedCheckoutMethod());
      const amt = btn.dataset.amt;
      if (amt === 'exact') {
        receivedInput.value = totals.grandTotalTTC;
      } else {
        receivedInput.value = Number(amt);
      }
      updateChange();
      sound.playBeep();
    });
  });

  document.getElementById('btnCloseCheckoutModal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  document.getElementById('btnConfirmPaymentAndTicket').addEventListener('click', () => {
    const method = getSelectedCheckoutMethod();
    const totals = calculatePOSCartTotals(method);

    // Calculate gross profit
    let totalGrossProfit = 0;
    cart.forEach(item => {
      const profitPerUnit = (Number(item.sellPrice) || 0) - (Number(item.buyPrice) || 0);
      totalGrossProfit += profitPerUnit * (Number(item.quantity) || 1);
    });

    if (totals.totalDiscount > 0) {
      totalGrossProfit = Math.max(0, totalGrossProfit - totals.totalDiscount);
    }

    const newInvoice = {
      docType: 'POS',
      docNumber: LocalDB.nextDocNumber('TKT'),
      docDate: todayLocalISO(),
      clientName: I18N[currentLang].walkInCustomer,
      paymentMethod: method,
      items: cart.map(it => ({
        productId: it.id,
        description: it.name,
        quantity: it.quantity,
        unitPriceHT: it.sellPrice / (1 + (it.tvaRate || 19) / 100),
        tvaRate: it.tvaRate || 19,
        totalHT: (it.sellPrice / (1 + (it.tvaRate || 19) / 100)) * it.quantity,
        totalTTC: it.sellPrice * it.quantity,
        buyPrice: it.buyPrice
      })),
      discountAmount: totals.totalDiscount,
      totalHT: totals.totalHT,
      totalTVA: totals.totalTVA,
      timbreFiscal: totals.timbreFiscal,
      totalTTC: totals.grandTotalTTC,
      grossProfit: Math.max(0, totalGrossProfit)
    };

    // Deduct stock from LocalDB
    cart.forEach(it => {
      LocalDB.deductStock(it.id, it.quantity);
    });

    LocalDB.addInvoice(newInvoice);
    modal.classList.remove('active');
    sound.playCashSuccess();

    cart = [];
    cartDiscountValue = 0;
    cartDiscountType = 'DZD';
    document.getElementById('cartDiscountInput').value = 0;
    renderCart();
    refreshPOSGrid();
    refreshDashboard();

    // Open Printable 80mm thermal receipt
    openTicketPrintModal(newInvoice);
  });
}

function refreshPOSGrid(query = '', category = 'ALL') {
  const grid = document.getElementById('posProductGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const products = LocalDB.getProducts();
  const t = I18N[currentLang];

  const q = query.trim().toLowerCase();
  const filtered = products.filter(p => {
    const matchesQuery = (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(q);
    const matchesCat = category === 'ALL' || p.category === category;
    return matchesQuery && matchesCat;
  });

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pos-card';
    const isOutOfStock = p.stock <= 0;

    card.innerHTML = `
      <div>
        <div class="pos-card-title">${escapeHtml(p.name)}</div>
        <div class="pos-card-stock" style="${isOutOfStock ? 'color:#dc2626; font-weight:800;' : ''}">
          ${!isOutOfStock ? `${t.inStock}: ${p.stock}` : t.outOfStock}
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:0.6rem;">
        <div class="pos-card-price">${formatCurrency(p.sellPrice)}</div>
        <button class="btn btn-primary btn-sm" style="padding:2px 10px; font-weight:800;">+</button>
      </div>
    `;

    card.addEventListener('click', () => {
      if (p.stock <= 0) {
        sound.playError();
        showToast(t.outOfStock, 'warning');
      } else {
        addToCart(p);
        sound.playBeep();
      }
    });

    grid.appendChild(card);
  });
}

function addToCart(product) {
  const existing = cart.find(it => it.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      sellPrice: product.sellPrice,
      buyPrice: product.buyPrice,
      tvaRate: product.tvaRate || 19,
      quantity: 1
    });
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('posCartItems');
  const badge = document.getElementById('cartItemsBadge');
  // Keep the discount toggle label in sync with the active type & language.
  const discountToggleLabel = document.getElementById('btnDiscountToggle');
  if (discountToggleLabel) {
    discountToggleLabel.textContent = cartDiscountType === 'DZD' ? (currentLang === 'ar' ? 'دج' : 'DZD') : '%';
  }
  if (!container) return;
  container.innerHTML = '';

  const totalQty = cart.reduce((s, it) => s + it.quantity, 0);
  if (badge) badge.textContent = totalQty;

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); font-size:0.85rem;">
        <div style="display:flex; justify-content:center; margin-bottom:0.75rem;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.35;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg></div>${currentLang === 'ar' ? 'سلة المبيعات فارغة.<br>امسح باركود أو انقر على سلعة للإضافة.' : (currentLang === 'fr' ? 'Le panier est vide.<br>Scannez ou cliquez sur un article.' : 'Cart is empty.<br>Scan barcode or select an item to add.')}
      </div>
    `;
  } else {
    cart.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'cart-item-row';
      row.innerHTML = `
        <div style="flex:1; padding-inline-end:0.5rem;">
          <div style="font-weight:700; font-size:0.85rem;">${escapeHtml(it.name)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${formatCurrency(it.sellPrice)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.35rem;">
          <button class="cart-qty-btn btn-dec" data-idx="${idx}">-</button>
          <span style="font-weight:800; min-width:22px; text-align:center;">${it.quantity}</span>
          <button class="cart-qty-btn btn-inc" data-idx="${idx}">+</button>
          <button class="cart-qty-btn btn-rem" data-idx="${idx}" style="color:#dc2626; border-color:transparent;">✕</button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.btn-inc').forEach(btn => {
      btn.addEventListener('click', () => {
        cart[btn.dataset.idx].quantity += 1;
        renderCart();
        sound.playBeep();
      });
    });

    container.querySelectorAll('.btn-dec').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = cart[btn.dataset.idx];
        if (item.quantity > 1) {
          item.quantity -= 1;
        } else {
          cart.splice(btn.dataset.idx, 1);
        }
        renderCart();
        sound.playBeep();
      });
    });

    container.querySelectorAll('.btn-rem').forEach(btn => {
      btn.addEventListener('click', () => {
        cart.splice(btn.dataset.idx, 1);
        renderCart();
      });
    });
  }

  const totals = calculatePOSCartTotals();
  document.getElementById('cartTotalHT').textContent = formatCurrency(totals.totalHT);
  document.getElementById('cartTotalTVA').textContent = formatCurrency(totals.totalTVA);
  document.getElementById('cartTimbre').textContent = formatCurrency(totals.timbreFiscal);
  document.getElementById('cartGrandTotal').textContent = formatCurrency(totals.grandTotalTTC);
}

/**
 * POS totals — retail (TTC-first) financial model.
 * The printed shelf prices are authoritative: the customer ALWAYS pays
 * Σ(sellPrice × qty) − remise (+ timbre fiscal only when paid in cash).
 * splitTTCByRates() guarantees totalHT + totalTVA === subtotalTTC to the
 * cent, so the charged amount can never drift from the shelf total.
 */
function calculatePOSCartTotals(paymentMethod = 'ESPECES') {
  const split = splitTTCByRates(
    cart.map((it) => ({
      quantity: it.quantity,
      unitPriceTTC: it.sellPrice,
      tvaRate: it.tvaRate || 19
    }))
  );

  let totalDiscount = 0;
  if (cartDiscountValue > 0) {
    totalDiscount =
      cartDiscountType === 'PERCENT'
        ? round2((split.totalTTC * Math.min(100, cartDiscountValue)) / 100)
        : Math.min(split.totalTTC, round2(cartDiscountValue));
  }

  const netTTC = round2(split.totalTTC - totalDiscount);
  const timbreFiscal = paymentMethod === PAYMENT_METHODS.ESPECES ? calculateTimbreFiscal(netTTC) : 0;

  return {
    totalHT: split.totalHT,
    totalTVA: split.totalTVA,
    tvaBreakdown: split.tvaBreakdown,
    subtotalTTC: split.totalTTC,
    totalDiscount,
    netTTC,
    timbreFiscal,
    grandTotalTTC: round2(netTTC + timbreFiscal)
  };
}

function openTicketPrintModal(inv) {
  const company = LocalDB.getCompany();
  const t = I18N[currentLang];

  document.getElementById('tktCompanyName').textContent = company.name || 'مؤسسة الأوراس';
  document.getElementById('tktCompanyAddress').textContent = company.address || 'الجزائر';
  document.getElementById('tktCompanyNif').textContent = company.nif || '-';
  document.getElementById('tktDocNum').textContent = inv.docNumber || inv.id;
  document.getElementById('tktDate').textContent = (inv.docDate || inv.createdAt || '').substring(0, 16);

  // Headers
  document.getElementById('tktColItem').textContent = currentLang === 'ar' ? 'البند' : currentLang === 'fr' ? 'Désignation' : 'Item';
  document.getElementById('tktColQty').textContent = currentLang === 'ar' ? 'الكمية' : currentLang === 'fr' ? 'Qté' : 'Qty';
  document.getElementById('tktColPrice').textContent = currentLang === 'ar' ? 'المبلغ' : currentLang === 'fr' ? 'Total' : 'Amount';
  document.getElementById('tktTotalLabel').textContent = currentLang === 'ar' ? 'المجموع:' : 'TOTAL:';

  const tbody = document.getElementById('tktItemsBody');
  tbody.innerHTML = '';
  (inv.items || []).forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(it.description || it.name)}</td>
      <td style="text-align:center;">${it.quantity}</td>
      <td style="text-align:right;">${formatCurrency(it.totalTTC || (it.unitPriceHT * it.quantity))}</td>
    `;
    tbody.appendChild(tr);
  });

  // Discount row
  const discountRow = document.getElementById('tktDiscountRow');
  if (inv.discountAmount > 0) {
    discountRow.style.display = 'flex';
    document.getElementById('tktDiscountVal').textContent = `-${formatCurrency(inv.discountAmount)}`;
  } else {
    discountRow.style.display = 'none';
  }

  document.getElementById('tktGrandTotal').textContent = formatCurrency(inv.totalTTC || 0);

  // Dynamic QR Code on ticket
  const qrData = `DZ-POS | TICKET:${inv.docNumber} | TOTAL:${inv.totalTTC} DZD | DATE:${inv.docDate} | NIF:${company.nif}`;
  const qrEl = document.getElementById('tktQRCodeContainer');
  if (qrEl) {
    qrEl.innerHTML = QRCodeSVG.generateSVG(qrData, 85);
  }

  document.getElementById('ticketPrintModal').classList.add('active');
}

// 5. FACTURATION A4 CONTROLLER
/** Maps a document type to its legal sequential-number prefix. */
function docTypePrefix(docType) {
  return { FACTURE: 'FAC', PROFORMA: 'PRF', BL: 'BL', AVOIR: 'AVR' }[docType] || 'FAC';
}

/** Prints ONLY the A4 sheet — marks the pane as print target and restores after. */
function printA4Sheet() {
  const pane = document.getElementById('tab-invoices');
  if (!pane) return;
  pane.classList.add('print-target');

  const cleanup = () => {
    pane.classList.remove('print-target');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  window.print();
  // Safety net for engines without the afterprint event.
  setTimeout(cleanup, 3000);
}

function initFacturationA4() {
  document.getElementById('a4DocDate').value = todayLocalISO();
  document.getElementById('a4DocNumber').value = LocalDB.nextDocNumber(
    docTypePrefix(document.getElementById('a4DocType').value)
  );

  refreshA4ClientsSelect();
  renderA4ItemsForm();

  document.getElementById('btnA4AddItem').addEventListener('click', () => {
    a4Items.push({ description: currentLang === 'ar' ? 'خدمة استشارية أو منتج جديد' : 'Prestation ou article', quantity: 1, unitPriceHT: 10000, tvaRate: 19 });
    renderA4ItemsForm();
    sound.playBeep();
  });

  ['a4DocType', 'a4DocNumber', 'a4DocDate', 'a4PaymentMethod', 'a4ClientSelect'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateA4Calculations);
    document.getElementById(id).addEventListener('input', updateA4Calculations);
  });

  // When the document type changes, propose the next legal number for it.
  document.getElementById('a4DocType').addEventListener('change', (e) => {
    document.getElementById('a4DocNumber').value = LocalDB.nextDocNumber(docTypePrefix(e.target.value));
  });

  document.getElementById('btnPrintA4').addEventListener('click', () => {
    saveCurrentA4Invoice();
    printA4Sheet();
  });
}

/**
 * Estimates gross profit for A4 lines by matching each line's description
 * against the product catalogue: Σ (unit HT − buy price) × qty.
 * Unmatched manual lines legitimately contribute 0.
 */
function computeA4GrossProfit() {
  const products = LocalDB.getProducts();
  let grossProfit = 0;
  a4Items.forEach((it) => {
    const product = products.find((p) => p.name === it.description);
    if (product) {
      grossProfit += ((Number(it.unitPriceHT) || 0) - (Number(product.buyPrice) || 0)) * (Number(it.quantity) || 0);
    }
  });
  return Math.max(0, round2(grossProfit));
}

function saveCurrentA4Invoice() {
  const clientSelect = document.getElementById('a4ClientSelect');
  const clientId = clientSelect.value;
  const clients = LocalDB.getClients();
  const client = clients.find(c => c.id === clientId) || clients[0];

  const paymentMethod = document.getElementById('a4PaymentMethod').value;
  const totals = calculateInvoiceTotals({
    items: a4Items,
    paymentMethod: paymentMethod === 'ESPECES' ? PAYMENT_METHODS.ESPECES : PAYMENT_METHODS.VIREMENT
  });

  const inv = {
    docType: document.getElementById('a4DocType').value,
    docNumber: document.getElementById('a4DocNumber').value,
    docDate: document.getElementById('a4DocDate').value,
    clientId: client ? client.id : null,
    clientName: client ? client.name : I18N[currentLang].walkInCustomer,
    clientNif: client ? client.nif : '',
    clientRc: client ? client.rc : '',
    clientAddress: client ? client.address : '',
    paymentMethod,
    items: a4Items,
    totalHT: totals.totalHT,
    totalTVA: totals.totalTVA,
    timbreFiscal: totals.timbreFiscal,
    totalTTC: totals.grandTotalTTC,
    grossProfit: computeA4GrossProfit()
  };

  LocalDB.upsertInvoice(inv);
  refreshDashboard();
  showToast(currentLang === 'ar' ? 'تم حفظ الفاتورة بنجاح في قاعدة البيانات' : 'Document enregistré avec succès');
}

function refreshA4ClientsSelect() {
  const sel = document.getElementById('a4ClientSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const clients = LocalDB.getClients();
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.address || 'Alger'})`;
    sel.appendChild(opt);
  });
}

function renderA4ItemsForm() {
  const container = document.getElementById('a4ItemsContainer');
  if (!container) return;
  container.innerHTML = '';

  a4Items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap:0.4rem; align-items:center; background:var(--bg-main); padding:0.4rem; border-radius:6px;';
    row.innerHTML = `
      <input type="text" class="search-input inp-desc" value="${escapeHtml(it.description)}" style="padding:4px 8px; font-size:0.8rem;" placeholder="التعيين">
      <input type="number" class="search-input inp-qty" value="${it.quantity}" style="padding:4px 8px; font-size:0.8rem; text-align:center;" min="1">
      <input type="number" class="search-input inp-price" value="${it.unitPriceHT}" style="padding:4px 8px; font-size:0.8rem; text-align:right;" step="100">
      <select class="search-input sel-tva" style="padding:4px 4px; font-size:0.75rem;">
        <option value="19" ${it.tvaRate === 19 ? 'selected' : ''}>19%</option>
        <option value="9" ${it.tvaRate === 9 ? 'selected' : ''}>9%</option>
        <option value="0" ${it.tvaRate === 0 ? 'selected' : ''}>0%</option>
      </select>
      <button class="btn btn-danger btn-sm btn-del-item" data-idx="${idx}" style="padding:2px 6px;">✕</button>
    `;

    row.querySelector('.inp-desc').addEventListener('input', e => { it.description = e.target.value; updateA4Calculations(); });
    row.querySelector('.inp-qty').addEventListener('input', e => { it.quantity = Number(e.target.value) || 1; updateA4Calculations(); });
    row.querySelector('.inp-price').addEventListener('input', e => { it.unitPriceHT = Number(e.target.value) || 0; updateA4Calculations(); });
    row.querySelector('.sel-tva').addEventListener('change', e => { it.tvaRate = Number(e.target.value) || 19; updateA4Calculations(); });
    row.querySelector('.btn-del-item').addEventListener('click', () => {
      a4Items.splice(idx, 1);
      renderA4ItemsForm();
      updateA4Calculations();
    });

    container.appendChild(row);
  });

  updateA4Calculations();
}

function updateA4Calculations() {
  const company = LocalDB.getCompany();
  const clients = LocalDB.getClients();
  const clientSelect = document.getElementById('a4ClientSelect');
  if (!clientSelect) return;
  const clientId = clientSelect.value;
  const client = clients.find(c => c.id === clientId) || clients[0] || {};

  const paymentMethod = document.getElementById('a4PaymentMethod').value;
  const docType = document.getElementById('a4DocType').value;
  const docNum = document.getElementById('a4DocNumber').value;
  const docDate = document.getElementById('a4DocDate').value;

  const totals = calculateInvoiceTotals({
    items: a4Items,
    paymentMethod: paymentMethod === 'ESPECES' ? PAYMENT_METHODS.ESPECES : PAYMENT_METHODS.VIREMENT
  });

  // Call tafqitDZD with options object { lang: currentLang }
  const tafqitText = tafqitDZD(totals.grandTotalTTC, { lang: currentLang });
  document.getElementById('a4TafqitText').textContent = tafqitText;

  // Sheet column translations
  document.getElementById('sheetColDesc').textContent = currentLang === 'ar' ? 'التعيين (Désignation)' : currentLang === 'fr' ? 'Désignation des Articles' : 'Item Description';
  document.getElementById('sheetColQty').textContent = currentLang === 'ar' ? 'الكمية' : currentLang === 'fr' ? 'Qté' : 'Qty';
  document.getElementById('sheetColPrice').textContent = currentLang === 'ar' ? 'السعر HT' : currentLang === 'fr' ? 'Prix Unitaire HT' : 'Unit Price HT';
  document.getElementById('sheetColTotal').textContent = currentLang === 'ar' ? 'المجموع HT' : currentLang === 'fr' ? 'Total HT' : 'Subtotal HT';
  document.getElementById('sheetClientHeader').textContent = currentLang === 'ar' ? 'بيانات العميل / Client' : currentLang === 'fr' ? 'Client Facturé' : 'Customer Details';
  document.getElementById('sheetLegalNoticeLabel').textContent = currentLang === 'ar' ? 'أوقفت الفاتورة عند المبلغ الإجمالي وقدره:' : currentLang === 'fr' ? 'Arrêté la présente facture à la somme de :' : 'Invoice total in words:';

  // Update Sheet Preview
  document.getElementById('sheetCompanyName').textContent = company.name || 'مؤسسة الأوراس';
  document.getElementById('sheetCompanyAddress').textContent = company.address || 'الجزائر';
  document.getElementById('sheetCompanyRc').textContent = company.rc || '-';
  document.getElementById('sheetCompanyNif').textContent = company.nif || '-';
  document.getElementById('sheetCompanyNis').textContent = company.nis || '-';
  document.getElementById('sheetCompanyAi').textContent = company.ai || '-';
  document.getElementById('sheetCompanyRib').textContent = company.rib || '-';

  const docTypeLabels = {
    FACTURE: { ar: 'فاتورة تجارية رسمية (FACTURE)', fr: 'FACTURE COMMERCIALE', en: 'COMMERCIAL INVOICE' },
    PROFORMA: { ar: 'فاتورة أولية / عرض أسعار (FACTURE PROFORMA)', fr: 'FACTURE PROFORMA / DEVIS', en: 'PROFORMA INVOICE' },
    BL: { ar: 'سند تسليم واستلام (BON DE LIVRAISON)', fr: 'BON DE LIVRAISON (B.L)', en: 'DELIVERY NOTE' },
    AVOIR: { ar: 'فاتورة استدراك وإلغاء (FACTURE D\'AVOIR)', fr: 'FACTURE D\'AVOIR', en: 'CREDIT NOTE' }
  };
  const docLabel = (docTypeLabels[docType] && docTypeLabels[docType][currentLang]) || docType;
  document.getElementById('sheetDocType').textContent = docLabel;
  document.getElementById('sheetDocNum').textContent = `N°: ${docNum}`;
  document.getElementById('sheetDocDate').textContent = docDate;

  document.getElementById('sheetClientName').textContent = client.name || 'العميل';
  document.getElementById('sheetClientAddress').textContent = client.address || 'الجزائر';
  document.getElementById('sheetClientNif').textContent = client.nif || '-';
  document.getElementById('sheetClientRc').textContent = client.rc || '-';

  // Digital Stamp
  const stampBox = document.getElementById('sheetStampContainer');
  if (company.stampImage) {
    stampBox.innerHTML = `<img src="${company.stampImage}" style="max-height:65px; object-fit:contain;" alt="Cachet">`;
  } else {
    stampBox.innerHTML = currentLang === 'ar' ? 'ختم وإمضاء المؤسسة (Cachet & Signature)' : 'Cachet & Signature de l\'établissement';
  }

  // QR Code Header
  const qrData = `DZ-FACTURE | N°:${docNum} | TOTAL:${totals.grandTotalTTC} DZD | TVA:${totals.totalTVA} DZD | DATE:${docDate} | NIF:${company.nif}`;
  const qrHeader = document.getElementById('a4HeaderQRCode');
  if (qrHeader) {
    qrHeader.innerHTML = QRCodeSVG.generateSVG(qrData, 75);
  }

  // Populate Table Body
  const sheetBody = document.getElementById('sheetTableBody');
  sheetBody.innerHTML = '';
  a4Items.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="border:1px solid #cbd5e1; padding:4px;">${escapeHtml(it.description)}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${it.quantity}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:right;">${formatCurrency(it.unitPriceHT)}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${it.tvaRate}%</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:700;">${formatCurrency(it.quantity * it.unitPriceHT)}</td>
    `;
    sheetBody.appendChild(tr);
  });

  document.getElementById('sheetTotalHT').textContent = formatCurrency(totals.totalHT);
  document.getElementById('sheetTotalTVA').textContent = formatCurrency(totals.totalTVA);
  document.getElementById('sheetTimbre').textContent = formatCurrency(totals.timbreFiscal);
  document.getElementById('sheetGrandTotal').textContent = formatCurrency(totals.grandTotalTTC);
  document.getElementById('sheetTafqitWords').textContent = tafqitText;
}

function loadInvoiceIntoA4(inv) {
  document.getElementById('a4DocType').value = inv.docType || 'FACTURE';
  document.getElementById('a4DocNumber').value = inv.docNumber || inv.id;
  document.getElementById('a4DocDate').value = inv.docDate || new Date().toISOString().split('T')[0];
  document.getElementById('a4PaymentMethod').value = inv.paymentMethod || 'VIREMENT';

  if (inv.items && inv.items.length > 0) {
    a4Items = inv.items.map(it => ({
      description: it.description || it.name,
      quantity: it.quantity || 1,
      unitPriceHT: it.unitPriceHT || (it.sellPrice ? round2(it.sellPrice / (1 + (it.tvaRate || 19) / 100)) : 0),
      tvaRate: it.tvaRate || 19
    }));
  }
  renderA4ItemsForm();
}

// 6. PRODUCTS MANAGEMENT
function initProducts() {
  refreshProductsTable();

  const modal = document.getElementById('productModal');
  document.getElementById('btnOpenNewProductModal').addEventListener('click', () => {
    modal.classList.add('active');
  });
  document.getElementById('btnCloseProductModal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  document.getElementById('btnGenerateBarcode')?.addEventListener('click', () => {
    const code = '613' + Math.floor(1000000000 + Math.random() * 9000000000);
    document.getElementById('prodBarcode').value = code;
    sound.playBeep();
  });

  document.getElementById('productForm').addEventListener('submit', e => {
    e.preventDefault();
    LocalDB.addProduct({
      barcode: document.getElementById('prodBarcode').value.trim(),
      name: document.getElementById('prodName').value.trim(),
      category: document.getElementById('prodCategory').value.trim() || 'عام',
      tvaRate: Number(document.getElementById('prodTvaRate').value) || 19,
      buyPrice: Number(document.getElementById('prodBuyPrice').value) || 0,
      sellPrice: Number(document.getElementById('prodSellPrice').value) || 0,
      stock: Number(document.getElementById('prodStock').value) || 0,
      minStock: 5
    });

    modal.classList.remove('active');
    document.getElementById('productForm').reset();
    refreshProductsTable();
    refreshDashboard();
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تمت إضافة المنتج بنجاح للمخزون' : 'Article ajouté au stock');
  });

  document.getElementById('productSearchInput').addEventListener('input', e => {
    refreshProductsTable(e.target.value);
  });

  document.getElementById('btnCloseBarcodeModal')?.addEventListener('click', () => {
    document.getElementById('barcodeLabelModal').classList.remove('active');
  });
}

function refreshProductsTable(query = '') {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const products = LocalDB.getProducts();
  const q = query.trim().toLowerCase();

  const filtered = products.filter(p =>
    (p.name || '').toLowerCase().includes(q) || (p.barcode || '').includes(q)
  );

  filtered.forEach(p => {
    const margin = (Number(p.sellPrice) || 0) - (Number(p.buyPrice) || 0);
    const marginPct = p.buyPrice > 0 ? ((margin / p.buyPrice) * 100).toFixed(1) : '100';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:monospace; color:#64748b;">${escapeHtml(p.barcode || '-')}</td>
      <td style="font-weight:700;">${escapeHtml(p.name)}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); border:1px solid var(--border); padding:2px 8px; border-radius:4px;">${escapeHtml(p.category || '-')}</span></td>
      <td style="text-align:right;">${formatCurrency(p.buyPrice)}</td>
      <td style="text-align:right; font-weight:800; color:var(--primary);">${formatCurrency(p.sellPrice)}</td>
      <td style="text-align:center; font-size:0.8rem; font-weight:700; color:#0284c7;">+${formatCurrency(margin)} (${marginPct}%)</td>
      <td style="text-align:center; font-weight:700; ${p.stock <= (p.minStock || 5) ? 'color:#dc2626;' : ''}">
        ${p.stock}
      </td>
      <td style="text-align:center; display:flex; gap:0.25rem; justify-content:center;">
        <button class="btn btn-outline btn-sm btn-barcode-prod" data-id="${p.id}" title="طباعة ملصق الباركود والسعر"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
        <button class="btn btn-danger btn-sm btn-delete-prod" data-id="${p.id}" title="حذف">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-barcode-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = products.find(x => x.id === btn.dataset.id);
      if (p) openBarcodeStickerModal(p);
    });
  });

  tbody.querySelectorAll('.btn-delete-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(currentLang === 'ar' ? 'هل أنت متأكد من حذف هذا المنتج؟' : 'Supprimer cet article ?')) {
        LocalDB.deleteProduct(btn.dataset.id);
        refreshProductsTable();
        refreshDashboard();
      }
    });
  });
}

function openBarcodeStickerModal(product) {
  const modal = document.getElementById('barcodeLabelModal');
  const view = document.getElementById('barcodeLabelView');
  const company = LocalDB.getCompany();

  view.innerHTML = `
    <div style="font-weight:800; font-size:10pt;">${escapeHtml(company.name || 'DZ Store')}</div>
    <div style="font-size:9.5pt; font-weight:700; margin:4px 0;">${escapeHtml(product.name)}</div>
    <div style="display:flex; justify-content:center; margin:6px 0;">
      ${QRCodeSVG.generateBarcodeSVG(product.barcode || '6130000000000', 210, 60)}
    </div>
    <div style="font-size:14pt; font-weight:900; color:#008744; margin-top:4px;">
      ${formatCurrency(product.sellPrice)}
    </div>
  `;

  modal.classList.add('active');
}

// 7. CLIENTS MANAGEMENT & DEBT PAYMENTS
function initClients() {
  refreshClientsTable();

  const modal = document.getElementById('clientModal');
  document.getElementById('btnOpenNewClientModal').addEventListener('click', () => {
    modal.classList.add('active');
  });
  document.getElementById('btnCloseClientModal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  document.getElementById('clientForm').addEventListener('submit', e => {
    e.preventDefault();
    LocalDB.addClient({
      name: document.getElementById('cliName').value.trim(),
      phone: document.getElementById('cliPhone').value.trim(),
      address: document.getElementById('cliAddress').value.trim(),
      nif: document.getElementById('cliNif').value.trim(),
      rc: document.getElementById('cliRc').value.trim(),
      balance: Number(document.getElementById('cliBalance').value) || 0
    });

    modal.classList.remove('active');
    document.getElementById('clientForm').reset();
    refreshClientsTable();
    refreshA4ClientsSelect();
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تمت إضافة العميل بنجاح' : 'Client ajouté');
  });

  document.getElementById('clientSearchInput').addEventListener('input', e => {
    refreshClientsTable(e.target.value);
  });

  // Debt payment modal bindings
  document.getElementById('btnCloseDebtModal')?.addEventListener('click', () => {
    document.getElementById('debtPaymentModal').classList.remove('active');
  });
  document.getElementById('btnCancelDebtPayment')?.addEventListener('click', () => {
    document.getElementById('debtPaymentModal').classList.remove('active');
  });

  document.getElementById('debtPaymentForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const clientId = document.getElementById('debtClientId').value;
    const amount = Number(document.getElementById('debtPaymentAmount').value) || 0;
    const note = document.getElementById('debtPaymentNote').value.trim();

    if (amount <= 0) {
      alert(currentLang === 'ar' ? 'يرجى إدخال مبلغ صحيح' : 'Montant invalide');
      return;
    }

    const res = LocalDB.addClientPayment(clientId, amount, 'ESPECES', note);
    if (res) {
      sound.playCashSuccess();
      document.getElementById('debtPaymentModal').classList.remove('active');
      document.getElementById('debtPaymentForm').reset();
      refreshClientsTable();
      showToast(`${currentLang === 'ar' ? 'تم تسجيل دفعة بقيمة' : 'Versement de'} ${formatCurrency(amount)}`);
    }
  });
}

function refreshClientsTable(query = '') {
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const clients = LocalDB.getClients();
  const q = query.trim().toLowerCase();

  const filtered = clients.filter(c =>
    (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
  );

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td>${escapeHtml(c.address || '-')}</td>
      <td style="font-family:monospace; color:#64748b;">${escapeHtml(c.nif || '-')}</td>
      <td style="text-align:right; font-weight:800; ${c.balance > 0 ? 'color:#dc2626;' : 'color:#16a34a;'}">
        ${formatCurrency(c.balance || 0)}
      </td>
      <td style="text-align:center;">
        ${c.balance > 0 ? `<button class="btn btn-warning btn-sm btn-pay-debt" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-bal="${c.balance}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> ${currentLang === 'ar' ? 'تسديد' : 'Régler'}</button>` : `<span style="color:#16a34a; font-size:0.75rem;">● ${currentLang === 'ar' ? 'خالص' : 'Soldé'}</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-pay-debt').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById('debtClientId').value = b.dataset.id;
      document.getElementById('debtClientNameDisplay').textContent = b.dataset.name;
      document.getElementById('debtCurrentBalance').textContent = formatCurrency(b.dataset.bal);
      document.getElementById('debtPaymentAmount').value = Number(b.dataset.bal);
      document.getElementById('debtPaymentModal').classList.add('active');
    });
  });
}

// 8. EXPENSES CONTROLLER (المصاريف والتشغيل)
function initExpenses() {
  document.getElementById('expDate').value = todayLocalISO();

  const form = document.getElementById('expenseForm');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const newExp = {
      date: document.getElementById('expDate').value,
      category: document.getElementById('expCategory').value,
      title: document.getElementById('expTitle').value.trim(),
      amount: Number(document.getElementById('expAmount').value) || 0,
      paymentMethod: document.getElementById('expPaymentMethod').value
    };

    if (newExp.amount <= 0) {
      alert(currentLang === 'ar' ? 'يرجى إدخال مبلغ صحيح' : 'Montant invalide');
      return;
    }

    LocalDB.addExpense(newExp);
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تم تسجيل المصروف بنجاح' : 'Dépense enregistrée');
    document.getElementById('expTitle').value = '';
    document.getElementById('expAmount').value = '';
    refreshExpensesTable();
    refreshDashboard();
  });

  document.getElementById('expenseSearchInput')?.addEventListener('input', e => {
    refreshExpensesTable(e.target.value);
  });
}

function refreshExpensesTable(query = '') {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const expenses = LocalDB.getExpenses();
  const q = query.trim().toLowerCase();

  const filtered = expenses.filter(exp =>
    (exp.title || '').toLowerCase().includes(q) || (exp.category || '').toLowerCase().includes(q)
  );

  const totalAmount = expenses.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const totalAmountEl = document.getElementById('expenseTotalAmount');
  if (totalAmountEl) totalAmountEl.textContent = formatCurrency(totalAmount);

  const navBadge = document.getElementById('expensesNavBadge');
  if (navBadge) navBadge.textContent = expenses.length;

  filtered.forEach(exp => {
    const tr = document.createElement('tr');
    const catClass = `cat-badge-${exp.category.toLowerCase()}`;
    const catName = I18N[currentLang][`cat${exp.category.charAt(0) + exp.category.slice(1).toLowerCase()}`] || exp.category;
    const payName = exp.paymentMethod === 'ESPECES' ? (currentLang === 'ar' ? 'نقداً من الصندوق' : 'Espèces Caisse') : (currentLang === 'ar' ? 'تحويل بنكي / CCP' : 'Banque / CCP');

    tr.innerHTML = `
      <td style="color:var(--text-muted); font-size:0.8rem;">${exp.date || '-'}</td>
      <td><span class="cat-badge ${catClass}">${escapeHtml(catName)}</span></td>
      <td style="font-weight:700;">${escapeHtml(exp.title)}</td>
      <td style="font-size:0.8rem; color:#0284c7;">${payName}</td>
      <td style="text-align:right; font-weight:800; color:#dc2626;">${formatCurrency(exp.amount)}</td>
      <td style="text-align:center;">
        <button class="btn btn-danger btn-sm btn-delete-exp" data-id="${exp.id}">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-delete-exp').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(currentLang === 'ar' ? 'هل أنت متأكد من حذف هذا المصروف؟' : 'Supprimer cette dépense ?')) {
        LocalDB.deleteExpense(btn.dataset.id);
        refreshExpensesTable();
        refreshDashboard();
      }
    });
  });
}

// 9. DAILY Z-REPORT & DRAWER CLOSING (إغلاق الصندوق)
function initClosings() {
  const openingFloatInput = document.getElementById('zOpeningFloat');
  const actualCashInput = document.getElementById('zActualCash');

  openingFloatInput?.addEventListener('input', calculateZReportBreakdown);
  actualCashInput?.addEventListener('input', calculateZReportBreakdown);

  document.getElementById('btnConfirmZReportClosing')?.addEventListener('click', () => {
    const breakdown = calculateZReportBreakdown();
    const cashier = document.getElementById('zCashierName').value.trim() || 'Caissier #1';

    const closing = {
      openingFloat: breakdown.openingFloat,
      cashSales: breakdown.cashSales,
      cardSales: breakdown.cardSales,
      chequeSales: breakdown.chequeSales,
      creditSales: breakdown.creditSales,
      cashExpenses: breakdown.cashExpenses,
      expectedCash: breakdown.expectedCash,
      actualCash: breakdown.actualCash,
      variance: breakdown.variance,
      cashier
    };

    LocalDB.addClosing(closing);
    sound.playCashSuccess();
    showToast(currentLang === 'ar' ? 'تم إغلاق الصندوق بنجاح وحفظ التقرير' : 'Clôture de caisse validée avec succès');

    refreshClosingsTab();
    openZReportTicketModal(closing);
  });

  document.getElementById('btnCloseZTicketModal')?.addEventListener('click', () => {
    document.getElementById('zTicketPrintModal').classList.remove('active');
  });
}

function calculateZReportBreakdown() {
  const invoices = LocalDB.getInvoices();
  const expenses = LocalDB.getExpenses();
  const todayStr = todayLocalISO();

  const todayInvoices = invoices.filter(inv => {
    return toLocalDateKey(inv.docDate || inv.createdAt) === todayStr;
  });

  const todayExpenses = expenses.filter(exp => (exp.date || '').substring(0, 10) === todayStr);

  const cashSales = todayInvoices.filter(i => (i.paymentMethod || 'ESPECES') === 'ESPECES').reduce((s, i) => s + (Number(i.totalTTC) || 0), 0);
  const cardSales = todayInvoices.filter(i => i.paymentMethod === 'VIREMENT' || i.paymentMethod === 'CARTE_CIB').reduce((s, i) => s + (Number(i.totalTTC) || 0), 0);
  const chequeSales = todayInvoices.filter(i => i.paymentMethod === 'CHEQUE').reduce((s, i) => s + (Number(i.totalTTC) || 0), 0);
  const creditSales = todayInvoices.filter(i => i.paymentMethod === 'A_TERME').reduce((s, i) => s + (Number(i.totalTTC) || 0), 0);

  const cashExpenses = todayExpenses.filter(e => (e.paymentMethod || 'ESPECES') === 'ESPECES').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const openingFloat = Number(document.getElementById('zOpeningFloat')?.value) || 0;
  const expectedCash = openingFloat + cashSales - cashExpenses;

  const actualCashInput = document.getElementById('zActualCash');
  const actualCash = Number(actualCashInput?.value) || 0;
  const variance = actualCash - expectedCash;

  // Update UI values
  const shiftDateEl = document.getElementById('zReportShiftDate');
  if (shiftDateEl) shiftDateEl.textContent = todayStr;
  document.getElementById('zCashSales').textContent = formatCurrency(cashSales);
  document.getElementById('zCardSales').textContent = formatCurrency(cardSales);
  document.getElementById('zChequeSales').textContent = formatCurrency(chequeSales);
  document.getElementById('zCreditSales').textContent = formatCurrency(creditSales);
  document.getElementById('zCashExpenses').textContent = formatCurrency(cashExpenses);
  document.getElementById('zExpectedCash').textContent = formatCurrency(expectedCash);

  // Update variance card
  const varianceCard = document.getElementById('zVarianceCard');
  const varianceLabel = document.getElementById('zVarianceLabel');
  const varianceAmount = document.getElementById('zVarianceAmount');
  const t = I18N[currentLang];

  varianceAmount.textContent = formatCurrency(variance);

  if (Math.abs(variance) < 0.01) {
    varianceCard.className = 'variance-card variance-exact';
    varianceLabel.textContent = t.varianceExact;
  } else if (variance > 0) {
    varianceCard.className = 'variance-card variance-surplus';
    varianceLabel.textContent = t.varianceSurplus;
  } else {
    varianceCard.className = 'variance-card variance-deficit';
    varianceLabel.textContent = t.varianceDeficit;
  }

  return {
    openingFloat,
    cashSales,
    cardSales,
    chequeSales,
    creditSales,
    cashExpenses,
    expectedCash,
    actualCash,
    variance
  };
}

function refreshClosingsTab() {
  calculateZReportBreakdown();

  const tbody = document.getElementById('closingsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const closings = LocalDB.getClosings();

  closings.forEach(c => {
    const tr = document.createElement('tr');
    const varianceColor = Math.abs(c.variance) < 0.01 ? '#16a34a' : c.variance > 0 ? '#b45309' : '#dc2626';
    const varianceText = (c.variance > 0 ? '+' : '') + formatCurrency(c.variance);

    tr.innerHTML = `
      <td style="font-size:0.8rem; color:var(--text-muted);">${(c.closedAt || '').substring(0, 16).replace('T', ' ')}</td>
      <td style="font-weight:700;">${escapeHtml(c.cashier || 'Caissier')}</td>
      <td style="text-align:right;">${formatCurrency(c.cashSales)}</td>
      <td style="text-align:right; font-weight:800;">${formatCurrency(c.actualCash)}</td>
      <td style="text-align:center; font-weight:800; color:${varianceColor};">${varianceText}</td>
      <td style="text-align:center;">
        <button class="btn btn-outline btn-sm btn-print-closing" data-id="${c.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-print-closing').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = closings.find(x => x.id === btn.dataset.id);
      if (c) openZReportTicketModal(c);
    });
  });
}

function openZReportTicketModal(closing) {
  const company = LocalDB.getCompany();
  document.getElementById('zTktCompanyName').textContent = company.name || 'مؤسسة الأوراس';
  document.getElementById('zTktCompanyNif').textContent = company.nif || '-';
  document.getElementById('zTktDateTime').textContent = (closing.closedAt || new Date().toISOString()).substring(0, 16).replace('T', ' ');
  document.getElementById('zTktCashier').textContent = closing.cashier || 'Responsable';

  document.getElementById('zTktOpening').textContent = formatCurrency(closing.openingFloat);
  document.getElementById('zTktCashSales').textContent = formatCurrency(closing.cashSales);
  document.getElementById('zTktCardSales').textContent = formatCurrency(closing.cardSales);
  document.getElementById('zTktChequeSales').textContent = formatCurrency(closing.chequeSales);
  document.getElementById('zTktCreditSales').textContent = formatCurrency(closing.creditSales);
  document.getElementById('zTktExpenses').textContent = formatCurrency(closing.cashExpenses);

  const totalRev = closing.cashSales + closing.cardSales + closing.chequeSales + closing.creditSales;
  document.getElementById('zTktTotalRevenue').textContent = formatCurrency(totalRev);
  document.getElementById('zTktExpected').textContent = formatCurrency(closing.expectedCash);
  document.getElementById('zTktCounted').textContent = formatCurrency(closing.actualCash);

  const varianceEl = document.getElementById('zTktVariance');
  varianceEl.textContent = (closing.variance > 0 ? '+' : '') + formatCurrency(closing.variance);

  // QR Code
  const qrData = `DZ-Z-REPORT | DATE:${closing.closedAt} | TOTAL:${totalRev} | ECART:${closing.variance} | NIF:${company.nif}`;
  const qrEl = document.getElementById('zTktQRCode');
  if (qrEl) {
    qrEl.innerHTML = QRCodeSVG.generateSVG(qrData, 80);
  }

  document.getElementById('zTicketPrintModal').classList.add('active');
}

// 10. SETTINGS & STAMP UPLOAD & USB FLASH BACKUP
function initSettings() {
  const company = LocalDB.getCompany();
  document.getElementById('cfgCompanyName').value = company.name || '';
  document.getElementById('cfgCompanyAddress').value = company.address || '';
  document.getElementById('cfgCompanyNif').value = company.nif || '';
  document.getElementById('cfgCompanyNis').value = company.nis || '';
  document.getElementById('cfgCompanyRc').value = company.rc || '';
  document.getElementById('cfgCompanyAi').value = company.ai || '';
  document.getElementById('cfgCompanyRib').value = company.rib || '';

  // Stamp file reader
  let stampDataUrl = company.stampImage || '';
  document.getElementById('cfgCompanyStampInput')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    // Guard the localStorage quota: only small real images are accepted.
    if (!file.type.startsWith('image/')) {
      showToast(I18N[currentLang].stampInvalidType, 'warning');
      e.target.value = '';
      return;
    }
    if (file.size > 500 * 1024) {
      showToast(I18N[currentLang].stampTooLarge, 'warning');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
      stampDataUrl = ev.target.result;
      showToast(currentLang === 'ar' ? 'تم تحميل صورة الختم بنجاح' : 'Cachet chargé');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('companyProfileForm').addEventListener('submit', e => {
    e.preventDefault();
    LocalDB.saveCompany({
      name: document.getElementById('cfgCompanyName').value.trim(),
      address: document.getElementById('cfgCompanyAddress').value.trim(),
      nif: document.getElementById('cfgCompanyNif').value.trim(),
      nis: document.getElementById('cfgCompanyNis').value.trim(),
      rc: document.getElementById('cfgCompanyRc').value.trim(),
      ai: document.getElementById('cfgCompanyAi').value.trim(),
      rib: document.getElementById('cfgCompanyRib').value.trim(),
      stampImage: stampDataUrl
    });
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تم حفظ بيانات المؤسسة والختم بنجاح' : 'Profil enregistré');
    updateA4Calculations();
  });

  // Export Backup File for USB Flash Disk
  document.getElementById('btnExportBackup').addEventListener('click', () => {
    const jsonStr = LocalDB.exportBackupJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dz_facture_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    sound.playBeep();
    showToast(currentLang === 'ar' ? 'تم تصدير النسخة الاحتياطية بنجاح إلى جهازك' : 'Sauvegarde exportée');
  });

  // Import Backup File
  document.getElementById('importBackupFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      const res = LocalDB.importBackupJSON(ev.target.result);
      if (res.success) {
        sound.playCashSuccess();
        alert(currentLang === 'ar' ? 'تم استرجاع قاعدة البيانات كاملة بنجاح!' : 'Base restaurée avec succès !');
        location.reload();
      } else {
        sound.playError();
        alert(currentLang === 'ar' ? 'حدث خطأ في قراءة ملف النسخة الاحتياطية: ' + res.error : 'Erreur: ' + res.error);
      }
    };
    reader.readAsText(file);
  });
}

function escapeHtml(str) {
  // HTML-escapes every dangerous character. Entity literals are assembled
  // from unicode escapes (& = \u0026) so they can never appear raw in source.
  if (str === null || str === undefined) return '';
  const AMP = '\u0026';
  return String(str)
    .replace(/\u0026/g, AMP + 'amp;')
    .replace(/</g, AMP + 'lt;')
    .replace(/>/g, AMP + 'gt;')
    .replace(/\u0022/g, AMP + 'quot;')
    .replace(/\u0027/g, AMP + '#39;')
    .replace(/`/g, AMP + '#96;');
}

// Legacy implementation kept ONLY to neutralize the superseded line below;
// safe to delete together with this wrapper (no longer referenced anywhere).
function escapeHtmlDeprecatedUnused(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
