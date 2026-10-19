/**
 * DZ-Calc (جداول الجزائر) — Official Algerian Spreadsheet Business Templates
 * Standardized accounting models complying with Algerian financial laws, SCF, and taxes.
 */

export const SPREADSHEET_TEMPLATES = [
  {
    id: 'fiche-paie',
    nameAr: 'كشف الأجور والرواتب الجزائري (Fiche de Paie)',
    nameFr: 'Livre de Paie & Traitements',
    nameEn: 'Algerian Payroll Ledger',
    category: 'hr-finance',
    data: {
      'A1': { val: 'الجمهورية الجزائرية الديمقراطية الشعبية — كشف الرواتب والأجور', style: { bold: true, fontSize: '13pt', color: '#047857' } },
      'A2': { val: 'المؤسسة: [الشركة الجزائرية للحلول والبرمجيات] — شهر: أكتوبر 2026', style: { color: '#64748b' } },
      
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
      'B9': { val: 'المبلغ الإجمالي صافي للدفع كتابة بالأحرف:' },
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
      'A1': { val: 'فاتورة بيع رسمية — المؤسسة الجزائرية للحلول الرقمية', style: { bold: true, fontSize: '13pt', color: '#1e40af' } },
      'A2': { val: 'رقم الفاتورة: FA-2026-042 | التاريخ: 19 أكتوبر 2026 | السجل التجاري: 16/00-1234567B', style: { color: '#64748b' } },
      
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
      'C6': { val: 10 },
      'D6': { val: 8500 },
      'E6': { val: '=C6*D6' },

      'B8': { val: 'المجموع خارج الرسم (Total HT):', style: { bold: true } },
      'E8': { val: '=SUM(E4:E6)', style: { bold: true } },

      'B9': { val: 'الرسم على القيمة المضافة (TVA 19%):', style: { bold: true } },
      'E9': { val: '=TVA_DZ(E8, 19)', style: { bold: true } },

      'B10': { val: 'حق الطابع الجبائي (Timbre Fiscal):', style: { bold: true } },
      'E10': { val: '=TIMBRE_DZ(E8)', style: { bold: true } },

      'B11': { val: 'المبلغ الإجمالي بكافة الرسوم (TTC):', style: { bold: true, bg: '#dbeafe', color: '#1e40af' } },
      'E11': { val: '=E8+E9+E10', style: { bold: true, bg: '#dbeafe', color: '#1e40af' } },

      'B13': { val: 'المبلغ الإجمالي كتابة بالأحرف:' },
      'C13': { val: '=TAFQIT_AR(E11)', style: { bold: true, color: '#1e40af' } }
    }
  },
  {
    id: 'tcr-scf',
    nameAr: 'جدول حساب النتائج للنظام المحاسبي المالي (TCR - SCF)',
    nameFr: 'Compte de Résultats (SCF Algérien)',
    nameEn: 'Income Statement (Algerian SCF)',
    category: 'accounting',
    data: {
      'A1': { val: 'الجمهورية الجزائرية — جدول حساب النتائج وفق النظام المحاسبي المالي (TCR / SCF)', style: { bold: true, fontSize: '13pt', color: '#047857' } },
      'A2': { val: 'السنة المالية: 2026 — المبالغ بآلاف الدنانير الجزائرية (K DZD)', style: { color: '#64748b' } },

      'A3': { val: 'الحساب', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'البيان المحاسبي', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'السنة N', style: { bold: true, bg: '#f1f5f9' } },
      'D3': { val: 'السنة N-1', style: { bold: true, bg: '#f1f5f9' } },

      'A4': { val: '70' },
      'B4': { val: 'المبيعات والمنتجات الملحقة' },
      'C4': { val: 45000 },
      'D4': { val: 38000 },

      'A5': { val: '72/73/74' },
      'B5': { val: 'الإنتاج المخزن أو المثبت وإعانات الاستغلال' },
      'C5': { val: 3200 },
      'D5': { val: 2500 },

      'A6': { val: 'I' },
      'B6': { val: '1. إنتاج السنة المالية', style: { bold: true, bg: '#e2e8f0' } },
      'C6': { val: '=C4+C5', style: { bold: true, bg: '#e2e8f0' } },
      'D6': { val: '=D4+D5', style: { bold: true, bg: '#e2e8f0' } },

      'A7': { val: '60' },
      'B7': { val: 'المشتريات المستهلكة' },
      'C7': { val: 18500 },
      'D7': { val: 16000 },

      'A8': { val: '61/62' },
      'B8': { val: 'الخدمات الخارجية والاستهلاكات الأخرى' },
      'C8': { val: 4200 },
      'D8': { val: 3800 },

      'A9': { val: 'II' },
      'B9': { val: '2. استهلاك السنة المالية', style: { bold: true, bg: '#e2e8f0' } },
      'C9': { val: '=C7+C8', style: { bold: true, bg: '#e2e8f0' } },
      'D9': { val: '=D7+D8', style: { bold: true, bg: '#e2e8f0' } },

      'A10': { val: 'III' },
      'B10': { val: '3. القيمة المضافة للاستغلال (1 - 2)', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'C10': { val: '=C6-C9', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'D10': { val: '=D6-D9', style: { bold: true, bg: '#dcfce7', color: '#047857' } },

      'A11': { val: '63' },
      'B11': { val: 'أعباء المستخدمين (الرواتب والأجور والاشتراكات)' },
      'C11': { val: 12400 },
      'D11': { val: 10800 },

      'A12': { val: '64' },
      'B12': { val: 'الضرائب والرسوم والمدفوعات المماثلة' },
      'C12': { val: 1800 },
      'D12': { val: 1600 },

      'A13': { val: 'IV' },
      'B13': { val: '4. إجمالي فائض الاستغلال (EBE)', style: { bold: true, bg: '#fef3c7' } },
      'C13': { val: '=C10-C11-C12', style: { bold: true, bg: '#fef3c7' } },
      'D13': { val: '=D10-D11-D12', style: { bold: true, bg: '#fef3c7' } }
    }
  },
  {
    id: 'budget-tresorerie',
    nameAr: 'ميزانية تسيير ومتابعة السيولة الشهرية (Budget)',
    nameFr: 'Budget Prévisionnel & Trésorerie',
    nameEn: 'Treasury & Monthly Operating Budget',
    category: 'finance',
    data: {
      'A1': { val: 'ميزانية التدفقات النقدية ومتابعة السيولة لسنة 2026', style: { bold: true, fontSize: '13pt', color: '#0f766e' } },
      
      'A3': { val: 'البيان / الشهر', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'جانفي', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'فيفري', style: { bold: true, bg: '#f1f5f9' } },
      'D3': { val: 'مارس', style: { bold: true, bg: '#f1f5f9' } },
      'E3': { val: 'الثلاثي الأول (T1)', style: { bold: true, bg: '#ccfbf1', color: '#0f766e' } },

      'A4': { val: 'رصيد بداية الشهر', style: { bold: true } },
      'B4': { val: 2500000 },
      'C4': { val: '=B9' },
      'D4': { val: '=C9' },
      'E4': { val: '=B4' },

      'A5': { val: 'المقبوضات من المبيعات والزبائن' },
      'B5': { val: 1800000 },
      'C5': { val: 2100000 },
      'D5': { val: 2400000 },
      'E5': { val: '=SUM(B5:D5)', style: { bold: true } },

      'A6': { val: 'تسديدات الموردين والمشتريات' },
      'B6': { val: 950000 },
      'C6': { val: 1100000 },
      'D6': { val: 1250000 },
      'E6': { val: '=SUM(B6:D6)', style: { bold: true } },

      'A7': { val: 'أجور المستخدمين والضمان الاجتماعي' },
      'B7': { val: 450000 },
      'C7': { val: 450000 },
      'D7': { val: 480000 },
      'E7': { val: '=SUM(B7:D7)', style: { bold: true } },

      'A8': { val: 'مصاريف عامة وإيجار وطاقة' },
      'B8': { val: 120000 },
      'C8': { val: 130000 },
      'D8': { val: 140000 },
      'E8': { val: '=SUM(B8:D8)', style: { bold: true } },

      'A9': { val: 'صافي رصيد نهاية الشهر', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'B9': { val: '=B4+B5-B6-B7-B8', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'C9': { val: '=C4+C5-C6-C7-C8', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'D9': { val: '=D4+D5-D6-D7-D8', style: { bold: true, bg: '#dcfce7', color: '#047857' } },
      'E9': { val: '=D9', style: { bold: true, bg: '#dcfce7', color: '#047857' } }
    }
  },
  {
    id: 'gestion-stock',
    nameAr: 'إدارة وجرد حركة المخزون (Gestion de Stock)',
    nameFr: 'Suivi et Inventaire des Stocks',
    nameEn: 'Inventory and Stock Management',
    category: 'inventory',
    data: {
      'A1': { val: 'سجل جرد المخزون وحركة البضائع — التقييم بالتكلفة المتوسطة المرجحة (PMP)', style: { bold: true, fontSize: '13pt', color: '#b45309' } },

      'A3': { val: 'رمز الصنف', style: { bold: true, bg: '#f1f5f9' } },
      'B3': { val: 'اسم المادة / المنتج', style: { bold: true, bg: '#f1f5f9' } },
      'C3': { val: 'مخزون أولي', style: { bold: true, bg: '#f1f5f9' } },
      'D3': { val: 'الوارد (Entrées)', style: { bold: true, bg: '#f1f5f9' } },
      'E3': { val: 'الصادر (Sorties)', style: { bold: true, bg: '#f1f5f9' } },
      'F3': { val: 'المخزون الحالي', style: { bold: true, bg: '#fef3c7' } },
      'G3': { val: 'سعر التكلفة (دج)', style: { bold: true, bg: '#f1f5f9' } },
      'H3': { val: 'القيمة الإجمالية للمخزون (دج)', style: { bold: true, bg: '#fef3c7', color: '#b45309' } },

      'A4': { val: 'ART-001' },
      'B4': { val: 'لوحات إلكترونية ذكية ARM' },
      'C4': { val: 120 },
      'D4': { val: 80 },
      'E4': { val: 45 },
      'F4': { val: '=C4+D4-E4' },
      'G4': { val: 4500 },
      'H4': { val: '=F4*G4', style: { bold: true } },

      'A5': { val: 'ART-002' },
      'B5': { val: 'محولات طاقة عالية الجهد' },
      'C5': { val: 65 },
      'D5': { val: 30 },
      'E5': { val: 20 },
      'F5': { val: '=C5+D5-E5' },
      'G5': { val: 7800 },
      'H5': { val: '=F5*G5', style: { bold: true } },

      'A6': { val: 'ART-003' },
      'B6': { val: 'حساسات صناعية ليزرية' },
      'C6': { val: 200 },
      'D6': { val: 100 },
      'E6': { val: 140 },
      'F6': { val: '=C6+D6-E6' },
      'G6': { val: 2200 },
      'H6': { val: '=F6*G6', style: { bold: true } },

      'B7': { val: 'المجموع الإجمالي لقيمة المخزون:', style: { bold: true, bg: '#f1f5f9' } },
      'H7': { val: '=SUM(H4:H6)', style: { bold: true, bg: '#fef3c7', color: '#b45309' } },

      'B9': { val: 'قيمة المخزون الإجمالي كتابة بالأحرف:' },
      'D9': { val: '=TAFQIT_AR(H7)', style: { bold: true, color: '#b45309' } }
    }
  }
];

if (typeof window !== 'undefined') {
  window.SPREADSHEET_TEMPLATES = SPREADSHEET_TEMPLATES;
}
