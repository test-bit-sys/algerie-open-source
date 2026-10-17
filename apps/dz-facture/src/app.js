import { tafqitDZD } from '../../../packages/dz-tafqit/src/index.js';
import { calculateInvoiceTotals, TVA_RATES, PAYMENT_METHODS } from '../../../packages/dz-fiscal/src/index.js';
import { getWilayas } from '../../../packages/dz-geo/src/index.js';

// Application State
let currentLang = 'ar';
let items = [
  { id: 1, designation: 'حاسوب محمول مكتبي HP ProBook G9', quantity: 2, unitPriceHT: 85000, tvaRate: 19 },
  { id: 2, designation: 'طابعة فواتير ليزر A4 متعددة المهام', quantity: 1, unitPriceHT: 34000, tvaRate: 19 },
  { id: 3, designation: 'حزم ورق طباعة مقاس A4 (صندوق 5 حزم)', quantity: 4, unitPriceHT: 4200, tvaRate: 9 }
];

const I18N = {
  ar: {
    title: 'استوديو الفوترة الجزائري المفتوح المصدر',
    editorTitle: 'محرر بيانات الفاتورة',
    printBtn: 'طباعة الفاتورة A4',
    docMeta: 'بيانات الفاتورة',
    docType: 'نوع الوثيقة',
    docNumber: 'رقم الفاتورة',
    docDate: 'تاريخ الإصدار',
    paymentMethod: 'طريقة الدفع',
    sellerTitle: 'بيانات البائع والمؤسسة',
    sellerName: 'اسم الشركة أو التاجر',
    sellerWilaya: 'الولاية',
    sellerAddress: 'العنوان الكامل',
    clientTitle: 'بيانات العميل / الزبون',
    clientName: 'اسم الزبون أو الشركة',
    clientAddress: 'العنوان',
    itemsTitle: 'السلع والخدمات',
    addItem: 'إضافة بند',
    previewTitle: 'المعاينة المباشرة لطباعة A4',
    printHint: 'مطابق للمرسوم التنفيذي 05-468',
    tafqitBoxNotice: 'التفقيط المالي القانوني بالدينار الجزائري:',
    tafqitDocNotice: 'أوقفت هذه الفاتورة عند المبلغ الإجمالي وقدره:',
    stamp: 'ختم وإمضاء المؤسسة (Cachet & Signature)',
    totalHT: 'المجموع بدون رسوم (Total HT):',
    timbre: 'رسم الطابع (Timbre 1%):',
    grandTotal: 'المجموع الكلي (Total TTC):',
    clientBox: 'العميل / Client',
    taxNotice: 'خاضعة للشروط القانونية للجمهورية الجزائرية الديمقراطية الشعبية',
    currencyNotice: 'العملة: الدينار الجزائري (DZD)',
    thDesignation: 'التعيين (Désignation)',
    thQty: 'الكمية',
    thPrice: 'السعر HT',
    thTVA: 'TVA %',
    thTotal: 'المجموع HT'
  },
  fr: {
    title: 'Studio de Facturation Algérien Open Source',
    editorTitle: 'Éditeur de la Facture',
    printBtn: 'Imprimer Facture A4',
    docMeta: 'Informations du Document',
    docType: 'Type de Document',
    docNumber: 'Numéro de Facture',
    docDate: "Date d'émission",
    paymentMethod: 'Mode de Règlement',
    sellerTitle: "Informations de l'Émetteur",
    sellerName: 'Raison Sociale / Nom',
    sellerWilaya: 'Wilaya',
    sellerAddress: 'Adresse Complète',
    clientTitle: 'Informations du Client',
    clientName: 'Nom ou Raison Sociale',
    clientAddress: 'Adresse',
    itemsTitle: 'Articles et Prestations',
    addItem: 'Ajouter une ligne',
    previewTitle: 'Aperçu Direct A4 Prêt à Imprimer',
    printHint: 'Conforme au Décret Exécutif 05-468',
    tafqitBoxNotice: 'Montant arrêté en toutes lettres (Dinars Algériens) :',
    tafqitDocNotice: 'Arrêtée la présente facture à la somme de :',
    stamp: 'Cachet et Signature de l’Établissement',
    totalHT: 'Total Hors Taxes (Total HT) :',
    timbre: 'Droit de Timbre (1%) :',
    grandTotal: 'Total Toutes Taxes Comprises (TTC) :',
    clientBox: 'Client',
    taxNotice: 'Établie conformément à la législation algérienne en vigueur',
    currencyNotice: 'Monnaie : Dinar Algérien (DZD)',
    thDesignation: 'Désignation',
    thQty: 'Qté',
    thPrice: 'Prix Unitaire HT',
    thTVA: 'TVA %',
    thTotal: 'Total HT'
  },
  en: {
    title: 'Algerian Open Source Invoicing Studio',
    editorTitle: 'Invoice Editor',
    printBtn: 'Print Invoice A4',
    docMeta: 'Document Information',
    docType: 'Document Type',
    docNumber: 'Invoice Number',
    docDate: 'Issue Date',
    paymentMethod: 'Payment Method',
    sellerTitle: 'Seller & Company Details',
    sellerName: 'Company Name / Merchant',
    sellerWilaya: 'Wilaya (Province)',
    sellerAddress: 'Full Address',
    clientTitle: 'Client / Customer Details',
    clientName: 'Client Name / Company',
    clientAddress: 'Address',
    itemsTitle: 'Goods & Services',
    addItem: 'Add Line Item',
    previewTitle: 'Live A4 Print Preview',
    printHint: 'Compliant with Algerian Executive Decree 05-468',
    tafqitBoxNotice: 'Official Legal Currency in Words (Algerian Dinars):',
    tafqitDocNotice: 'Total invoice amount stopped at the sum of:',
    stamp: 'Company Stamp & Signature',
    totalHT: 'Total Excluding Taxes (HT):',
    timbre: 'Fiscal Stamp Duty (1%):',
    grandTotal: 'Total Including Taxes (TTC):',
    clientBox: 'Client',
    taxNotice: 'Established in accordance with Algerian fiscal legislation',
    currencyNotice: 'Currency: Algerian Dinar (DZD)',
    thDesignation: 'Description (Désignation)',
    thQty: 'Qty',
    thPrice: 'Unit Price HT',
    thTVA: 'VAT %',
    thTotal: 'Total HT'
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Set default date to today
  document.getElementById('docDate').value = new Date().toISOString().split('T')[0];
  
  populateWilayas();
  renderItemsEditor();
  attachEventListeners();
  updateCalculations();
});

function populateWilayas() {
  const wilayaSelect = document.getElementById('sellerWilaya');
  wilayaSelect.innerHTML = '';
  const wilayas = getWilayas(currentLang);
  wilayas.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.code;
    opt.textContent = `${w.code} - ${w.name}`;
    if (w.code === '16') opt.selected = true; // Alger default
    wilayaSelect.appendChild(opt);
  });
}

function renderItemsEditor() {
  const tbody = document.getElementById('itemsTableBody');
  tbody.innerHTML = '';

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" value="${escapeHtml(item.designation)}" data-field="designation" data-index="${index}">
      </td>
      <td>
        <input type="number" min="1" value="${item.quantity}" data-field="quantity" data-index="${index}">
      </td>
      <td>
        <input type="number" min="0" step="10" value="${item.unitPriceHT}" data-field="unitPriceHT" data-index="${index}">
      </td>
      <td>
        <select data-field="tvaRate" data-index="${index}">
          <option value="19" ${item.tvaRate === 19 ? 'selected' : ''}>19%</option>
          <option value="9" ${item.tvaRate === 9 ? 'selected' : ''}>9%</option>
          <option value="0" ${item.tvaRate === 0 ? 'selected' : ''}>0%</option>
        </select>
      </td>
      <td style="font-weight:700; text-align:right;">
        ${(item.quantity * item.unitPriceHT).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
      </td>
      <td style="text-align:center;">
        <button class="btn btn-danger remove-item-btn" data-index="${index}" style="padding:2px 6px; font-size:0.75rem;" title="حذف">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateCalculations() {
  const paymentMethod = document.getElementById('paymentMethod').value;
  
  // Calculate using dz-fiscal package
  const totals = calculateInvoiceTotals({
    items: items.map(it => ({
      quantity: it.quantity,
      unitPriceHT: it.unitPriceHT,
      tvaRate: it.tvaRate
    })),
    paymentMethod
  });

  // Convert grand total to words using dz-tafqit package
  const tafqitText = tafqitDZD(totals.grandTotalTTC, {
    lang: currentLang,
    legalSuffix: true,
    currency: true
  });

  // Update Editor Tafqit box
  document.getElementById('editorTafqitText').textContent = tafqitText;

  // Update Live Preview Sheet
  renderPreview(totals, tafqitText);
}

function renderPreview(totals, tafqitText) {
  // Seller
  document.getElementById('viewSellerName').textContent = document.getElementById('sellerName').value;
  document.getElementById('viewSellerAddress').textContent = document.getElementById('sellerAddress').value;
  document.getElementById('viewSellerNif').textContent = document.getElementById('sellerNif').value;
  document.getElementById('viewSellerNis').textContent = document.getElementById('sellerNis').value;
  document.getElementById('viewSellerRc').textContent = document.getElementById('sellerRc').value;
  document.getElementById('viewSellerAi').textContent = document.getElementById('sellerAi').value;
  document.getElementById('viewSellerRib').textContent = document.getElementById('sellerRib').value;

  // Doc info
  const docTypeVal = document.getElementById('docType').value;
  let docTypeLabel = 'FACTURE';
  if (docTypeVal === 'PROFORMA') docTypeLabel = 'FACTURE PROFORMA';
  if (docTypeVal === 'BL') docTypeLabel = 'BON DE LIVRAISON';
  document.getElementById('viewDocType').textContent = docTypeLabel;
  document.getElementById('viewDocNumber').textContent = `N°: ${document.getElementById('docNumber').value}`;
  document.getElementById('viewDocDate').textContent = document.getElementById('docDate').value;
  
  const paymentSelect = document.getElementById('paymentMethod');
  document.getElementById('viewPaymentMethod').textContent = paymentSelect.options[paymentSelect.selectedIndex].text;

  // Client
  document.getElementById('viewClientName').textContent = document.getElementById('clientName').value;
  document.getElementById('viewClientAddress').textContent = document.getElementById('clientAddress').value;
  document.getElementById('viewClientNif').textContent = document.getElementById('clientNif').value || '-';
  document.getElementById('viewClientRc').textContent = document.getElementById('clientRc').value || '-';

  // Items table in preview
  const viewBody = document.getElementById('viewItemsBody');
  viewBody.innerHTML = '';
  items.forEach(it => {
    const row = document.createElement('tr');
    const lineTotal = it.quantity * it.unitPriceHT;
    row.innerHTML = `
      <td>${escapeHtml(it.designation)}</td>
      <td style="text-align:center;">${it.quantity}</td>
      <td style="text-align:right;">${it.unitPriceHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
      <td style="text-align:center;">${it.tvaRate}%</td>
      <td style="text-align:right; font-weight:700;">${lineTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
    `;
    viewBody.appendChild(row);
  });

  // Totals
  document.getElementById('viewTotalHT').textContent = `${totals.totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('viewTVA19').textContent = `${(totals.tvaBreakdown['19']?.amountTVA || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('viewTVA9').textContent = `${(totals.tvaBreakdown['9']?.amountTVA || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('viewTimbre').textContent = `${totals.timbreFiscal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('viewGrandTotal').textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;

  // Tafqit
  document.getElementById('viewTafqitText').textContent = tafqitText;
}

function attachEventListeners() {
  // Input changes
  document.querySelector('.panel-editor').addEventListener('input', e => {
    if (e.target.dataset.field) {
      const idx = parseInt(e.target.dataset.index, 10);
      const field = e.target.dataset.field;
      if (field === 'quantity' || field === 'unitPriceHT' || field === 'tvaRate') {
        items[idx][field] = Number(e.target.value) || 0;
      } else {
        items[idx][field] = e.target.value;
      }
      renderItemsEditor();
    }
    updateCalculations();
  });

  // Select changes
  document.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => {
      updateCalculations();
    });
  });

  // Remove item
  document.getElementById('itemsTable').addEventListener('click', e => {
    if (e.target.classList.contains('remove-item-btn')) {
      const idx = parseInt(e.target.dataset.index, 10);
      items.splice(idx, 1);
      renderItemsEditor();
      updateCalculations();
    }
  });

  // Add item
  document.getElementById('addItemBtn').addEventListener('click', () => {
    items.push({
      id: Date.now(),
      designation: currentLang === 'ar' ? 'سلعة أو خدمة جديدة' : 'Nouvel article ou service',
      quantity: 1,
      unitPriceHT: 1000,
      tvaRate: 19
    });
    renderItemsEditor();
    updateCalculations();
  });

  // Print button
  document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
  });

  // Theme toggle
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.body.removeAttribute('data-theme');
      document.getElementById('themeToggleBtn').textContent = '🌙';
    } else {
      document.body.setAttribute('data-theme', 'dark');
      document.getElementById('themeToggleBtn').textContent = '☀️';
    }
  });

  // Trilingual language selector
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const selectedLang = e.target.dataset.lang;
      if (selectedLang && selectedLang !== currentLang) {
        currentLang = selectedLang;
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        applyLanguage(currentLang);
      }
    });
  });
}

function applyLanguage(lang) {
  const t = I18N[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  document.getElementById('txtPrint').textContent = t.printBtn;
  document.getElementById('txtEditorTitle').textContent = t.editorTitle;
  document.getElementById('txtDocMeta').textContent = t.docMeta;
  document.getElementById('lblDocType').textContent = t.docType;
  document.getElementById('lblDocNumber').textContent = t.docNumber;
  document.getElementById('lblDocDate').textContent = t.docDate;
  document.getElementById('lblPaymentMethod').textContent = t.paymentMethod;
  document.getElementById('txtSellerTitle').textContent = t.sellerTitle;
  document.getElementById('lblSellerName').textContent = t.sellerName;
  document.getElementById('lblSellerWilaya').textContent = t.sellerWilaya;
  document.getElementById('lblSellerAddress').textContent = t.sellerAddress;
  document.getElementById('txtClientTitle').textContent = t.clientTitle;
  document.getElementById('lblClientName').textContent = t.clientName;
  document.getElementById('lblClientAddress').textContent = t.clientAddress;
  document.getElementById('txtItemsTitle').textContent = t.itemsTitle;
  document.getElementById('txtAddItem').textContent = t.addItem;
  document.getElementById('txtPreviewTitle').textContent = t.previewTitle;
  document.getElementById('txtPrintHint').textContent = t.printHint;
  document.getElementById('lblTafqitBox').textContent = t.tafqitBoxNotice;
  document.getElementById('txtViewClientTitle').textContent = t.clientBox;
  document.getElementById('txtViewTaxNotice').textContent = t.taxNotice;
  document.getElementById('viewCurrencyNotice').textContent = t.currencyNotice;
  document.getElementById('txtViewTafqitNotice').textContent = t.tafqitDocNotice;
  document.getElementById('txtViewStamp').textContent = t.stamp;
  document.getElementById('txtViewTotalHT').textContent = t.totalHT;
  document.getElementById('txtViewTimbre').textContent = t.timbre;
  document.getElementById('txtViewGrandTotal').textContent = t.grandTotal;

  document.getElementById('thDesignation').textContent = t.thDesignation;
  document.getElementById('thQty').textContent = t.thQty;
  document.getElementById('thPrice').textContent = t.thPrice;
  document.getElementById('thTVA').textContent = t.thTVA;
  document.getElementById('thTotal').textContent = t.thTotal;

  document.getElementById('viewThDesignation').textContent = t.thDesignation;
  document.getElementById('viewThQty').textContent = t.thQty;
  document.getElementById('viewThPrice').textContent = t.thPrice;
  document.getElementById('viewThTVA').textContent = t.thTVA;
  document.getElementById('viewThTotal').textContent = t.thTotal;

  populateWilayas();
  updateCalculations();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
