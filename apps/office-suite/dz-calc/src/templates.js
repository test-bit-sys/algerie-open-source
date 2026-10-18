/**
 * DZ-Calc — Algerian Spreadsheet Business Templates
 * Pre-configured financial models, payroll, and accounting templates.
 */

export const SPREADSHEET_TEMPLATES = [
  {
    id: 'fiche-paie',
    nameAr: 'كشف الأجور والرواتب الجزائري (Fiche de Paie)',
    nameFr: 'Livre de Paie & Traitements',
    nameEn: 'Algerian Payroll Ledger',
    category: 'hr-finance',
    data: {
      'A1': { val: 'كشف الرواتب والأجور لشهر أكتوبر 2026', style: { bold: true, fontSize: '14pt', color: '#047857' } },
      'A3': { val: 'الرمز', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'اسم الموظف', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'الراتب الأساسي', style: { bold: true, bg: '#f1f5f9' } },
      'D3': { val: 'المنح والعلاوات', style: { bold: true, bg: '#f1f5f9' } },
      'E3': { val: 'الراتب الخام (Brut)', style: { bold: true, bg: '#f1f5f9' } },
      'F3': { val: 'الضمان الاجتماعي (9%)', style: { bold: true, bg: '#f1f5f9' } },
      'G3': { val: 'الخام الخاضع للضريبة', style: { bold: true, bg: '#f1f5f9' } },
      'H3': { val: 'الضريبة على الدخل (IRG)', style: { bold: true, bg: '#f1f5f9' } },
      'I3': { val: 'صافي الراتب (Net DZD)', style: { bold: true, bg: '#dcfce7', color: '#047857' } },

      // Row 4 - Employee 1
      'A4': { val: 'EMP-01' },
      'B4': { val: 'محمد بلقاسم (مهندس نظم)' },
      'C4': { val: 65000 },
      'D4': { val: 18000 },
      'E4': { val: '=C4+D4' },
      'F4': { val: '=ROUND(E4*0.09, 2)' },
      'G4': { val: '=E4-F4' },
      'H4': { val: '=IRG_DZ(G4)' },
      'I4': { val: '=G4-H4', style: { bold: true } },

      // Row 5 - Employee 2
      'A5': { val: 'EMP-02' },
      'B5': { val: 'أمينة منصوري (محاسبة رئيسية)' },
      'C5': { val: 55000 },
      'D5': { val: 12000 },
      'E5': { val: '=C5+D5' },
      'F5': { val: '=ROUND(E5*0.09, 2)' },
      'G5': { val: '=E5-F5' },
      'H5': { val: '=IRG_DZ(G5)' },
      'I5': { val: '=G5-H5', style: { bold: true } },

      // Row 6 - Employee 3
      'A6': { val: 'EMP-03' },
      'B6': { val: 'كريم بن سالم (تقني سامي)' },
      'C6': { val: 42000 },
      'D6': { val: 8000 },
      'E6': { val: '=C6+D6' },
      'F6': { val: '=ROUND(E6*0.09, 2)' },
      'G6': { val: '=E6-F6' },
      'H6': { val: '=IRG_DZ(G6)' },
      'I6': { val: '=G6-H6', style: { bold: true } },

      // Row 7 - Totals
      'B7': { val: 'المجموع الإجمالي العام', style: { bold: true, bg: '#f1f5f9' } },
      'C7': { val: '=SUM(C4:C6)', style: { bold: true } },
      'D7': { val: '=SUM(D4:D6)', style: { bold: true } },
      'E7': { val: '=SUM(E4:E6)', style: { bold: true } },
      'F7': { val: '=SUM(F4:F6)', style: { bold: true } },
      'G7': { val: '=SUM(G4:G6)', style: { bold: true } },
      'H7': { val: '=SUM(H4:H6)', style: { bold: true } },
      'I7': { val: '=SUM(I4:I6)', style: { bold: true, bg: '#dcfce7', color: '#047857' } },

      // Tafqit
      'B9': { val: 'المبلغ الإجمالي كتابة بالأحرف:' },
      'D9': { val: '=TAFQIT_AR(I7)', style: { bold: true, color: '#047857' } }
    }
  },
  {
    id: 'facture-tva',
    nameAr: 'فاتورة تجارية مع حساب الرسم (TVA) والتفقيط',
    nameFr: 'Facture Commerciale avec TVA & Tafqit',
    nameEn: 'Commercial Invoice with VAT & Tafqit',
    category: 'accounting',
    data: {
      'A1': { val: 'فاتورة بيع رسمية — المؤسسة الجزائرية للحلول البرمجية', style: { bold: true, fontSize: '13pt', color: '#1e40af' } },
      'A3': { val: 'الرقم', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'التعيين والوصف', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'الكمية', style: { bold: true, bg: '#f1f5f9' } },
      'D3': { val: 'سعر الوحدة (دج)', style: { bold: true, bg: '#f1f5f9' } },
      'E3': { val: 'المبلغ الإجمالي الخام (HT)', style: { bold: true, bg: '#f1f5f9' } },

      'A4': { val: '01' },
      'B4': { val: 'خادم حاسوبي مكتبي ذو كفاءة عالية' },
      'C4': { val: 2 },
      'D4': { val: 120000 },
      'E4': { val: '=C4*D4' },

      'A5': { val: '02' },
      'B5': { val: 'شاشة عرض فائقة الدقة 27 بوصة' },
      'C5': { val: 4 },
      'D5': { val: 32000 },
      'E5': { val: '=C5*D5' },

      'A6': { val: '03' },
      'B6': { val: 'رخصة نظام التشغيل والبرمجيات المفتوحة' },
      'C6': { val: 2 },
      'D6': { val: 15000 },
      'E6': { val: '=C6*D6' },

      // Subtotals
      'D8': { val: 'المجموع الإجمالي الخام (HT):', style: { bold: true } },
      'E8': { val: '=SUM(E4:E6)', style: { bold: true } },

      'D9': { val: 'الرسم على القيمة المضافة (TVA 19%):', style: { bold: true } },
      'E9': { val: '=TVA_DZ(E8, 19)', style: { bold: true } },

      'D10': { val: 'حق الطابع الجبائي (Timbre Fiscal):', style: { bold: true } },
      'E10': { val: '=TIMBRE_DZ(E8)', style: { bold: true } },

      'D11': { val: 'المبلغ الإجمالي الصافي للدفع (TTC):', style: { bold: true, bg: '#fef08a' } },
      'E11': { val: '=E8+E9+E10', style: { bold: true, bg: '#fef08a', color: '#b45309' } },

      'B13': { val: 'صافي الفاتورة كتابة بالأحرف:' },
      'C13': { val: '=TAFQIT_AR(E11)', style: { bold: true, color: '#047857' } }
    }
  },
  {
    id: 'tcr-algerie',
    nameAr: 'جدول حسابات النتائج (TCR) النظام المحاسبي المالي (SCF)',
    nameFr: 'Compte de Résultats SCF',
    nameEn: 'Income Statement (TCR - SCF)',
    category: 'accounting',
    data: {
      'A1': { val: 'جدول حسابات النتائج (TCR) للفترة المحاسبية 2026', style: { bold: true, fontSize: '13pt', color: '#0f172a' } },
      'A3': { val: 'رقم الحساب', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'البيان المحاسبي', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'المبلغ (دج)', style: { bold: true, bg: '#f1f5f9' } },

      'A4': { val: '70' },
      'B4': { val: 'المبيعات والمنتجات الملحقة (رقم الأعمال)' },
      'C4': { val: 4500000 },

      'A5': { val: '60' },
      'B5': { val: 'المشتريات المستهلكة' },
      'C5': { val: 1650000 },

      'A6': { val: '61/62' },
      'B6': { val: 'الخدمات الخارجية والاستهلاكات الأخرى' },
      'C6': { val: 420000 },

      'B7': { val: 'القيمة المضافة للاستغلال (1)', style: { bold: true, bg: '#f1f5f9' } },
      'C7': { val: '=C4-C5-C6', style: { bold: true } },

      'A8': { val: '63' },
      'B8': { val: 'أعباء المستخدمين (الرواتب والأجور)' },
      'C8': { val: 980000 },

      'A9': { val: '64' },
      'B9': { val: 'الضرائب والرسوم والمدفوعات المماثلة' },
      'C9': { val: 110000 },

      'B10': { val: 'إجمالي فائض الاستغلال (EBE)', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'C10': { val: '=C7-C8-C9', style: { bold: true, bg: '#dcfce7', color: '#047857' } }
    }
  }
];
