/**
 * DZ-Facture & POS: Master Application Controller
 * Trilingual (AR / FR / EN), Offline-First, Full POS & Invoicing Flow
 */

import { LocalDB } from './modules/db.js';
import { calculateInvoiceTotals, TVA_RATES, PAYMENT_METHODS } from './modules/fiscal.js';
import { tafqitDZD } from './modules/tafqit.js';
import { getWilayas } from './modules/geo.js';

// Application State
let currentLang = 'ar';
let cart = [];
let a4Items = [
  { description: 'حاسوب محمول مكتبي HP ProBook G9', quantity: 2, unitPriceHT: 85000, tvaRate: 19 },
  { id: 2, description: 'طابعة فواتير ليزر A4 متعددة المهام', quantity: 1, unitPriceHT: 34000, tvaRate: 19 },
  { id: 3, description: 'حزم ورق طباعة مقاس A4 (صندوق 5 حزم)', quantity: 4, unitPriceHT: 4200, tvaRate: 9 }
];

const I18N = {
  ar: {
    navDashboard: 'لوحة القيادة',
    navPOS: 'نقطة البيع والكاشير (POS)',
    navInvoices: 'الفواتير وسندات التسليم (A4)',
    navProducts: 'المنتجات والمخزون',
    navClients: 'العملاء والديون',
    navSettings: 'بيانات المؤسسة والنسخ الاحتياطي',
    statRevenue: 'مبيعات اليوم الإجمالية',
    statInvoicesCount: 'عدد الفواتير والتذاكر',
    statProducts: 'إجمالي أصناف المخزون',
    statLowStock: 'تنبيهات نفاد المخزون',
    quickSaleTitle: 'بدء بيع جديد أو تحرير فاتورة',
    quickSaleDesc: 'استخدم نقطة البيع السريع لطباعة تذاكر الكاشير، أو محرر الفواتير الرسمي لطباعة وثائق A4.',
    btnOpenPOS: 'فتح الكاشير (POS)',
    btnNewInvoice: 'فاتورة رسمية A4',
    recentTransactions: 'آخر المعاملات والفواتير',
    thDocNum: 'رقم الوثيقة',
    thDate: 'التاريخ',
    thClient: 'العميل',
    thType: 'النوع',
    thPayment: 'طريقة الدفع',
    thTotalTTC: 'المجموع TTC',
    cartTitle: 'سلة المبيعات (Ticket)',
    totalHT: 'المجموع الصافي HT:',
    timbreFiscal: 'رسم الطابع الجبائي (1%):',
    grandTotal: 'المجموع الإجمالي:',
    btnPayAndPrint: 'دفع وطباعة التذكرة',
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
    companyProfileTitle: '🏢 بيانات المؤسسة والتاجر',
    lblCompanyName: 'الاسم التجاري أو تسمية المؤسسة',
    lblAddress: 'العنوان الكامل',
    btnSaveProfile: 'حفظ البيانات',
    backupTitle: '💾 النسخ الاحتياطي وحماية البيانات',
    backupDesc: 'نظراً لأهمية بيانات تجارتك، يمكنك تصدير قاعدة البيانات كاملة بضغطة زر وحفظها على قرص فلاش خارجي (Flash Disk USB) لحمايتها من أي عطل، أو استرجاعها في أي جهاز آخر دون إنترنت.',
    btnDownloadBackup: 'تحميل نسخة احتياطية (.json)',
    lblRestoreBackup: 'استرجاع نسخة سابقة من الفلاش ديسك',
    modalNewProduct: 'إضافة منتج جديد للمخزون',
    btnCancel: 'إلغاء',
    btnSave: 'حفظ',
    modalNewClient: 'إضافة عميل أو شركة جديدة',
    thermalTicketTitle: 'معاينة تذكرة الكاشير (80mm)'
  },
  fr: {
    navDashboard: 'Tableau de bord',
    navPOS: 'Point de vente (POS)',
    navInvoices: 'Factures & Bons (A4)',
    navProducts: 'Articles & Stock',
    navClients: 'Clients & Créances',
    navSettings: 'Établissement & Sauvegarde',
    statRevenue: 'Ventes du Jour',
    statInvoicesCount: 'Factures & Tickets',
    statProducts: 'Total Références',
    statLowStock: 'Alertes Stock Faible',
    quickSaleTitle: 'Nouvelle vente ou facture',
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
    cartTitle: 'Panier de vente (Ticket)',
    totalHT: 'Total Hors Taxes (HT) :',
    timbreFiscal: 'Droit de Timbre (1%) :',
    grandTotal: 'Total Général TTC :',
    btnPayAndPrint: 'Payer & Imprimer Ticket',
    invoiceEditorTitle: 'Éditeur de documents officiels',
    btnPrintA4: 'Imprimer A4',
    lblDocType: 'Type de document',
    lblDocNum: 'Numéro',
    lblDate: "Date d'émission",
    lblPayment: 'Mode de règlement',
    lblSelectClient: 'Sélectionner le client',
    itemsTitle: 'Lignes du document',
    btnAddItem: 'Ajouter une ligne',
    tafqitHeader: 'Montant en toutes lettres (DZD) :',
    thBarcode: 'Code-barres',
    thProductName: 'Désignation',
    thCategory: 'Catégorie',
    thBuyPrice: "Prix d'achat",
    thSellPrice: 'Prix de vente',
    thStock: 'Stock actuel',
    btnNewProduct: 'Ajouter un article',
    thClientName: 'Nom ou Raison Sociale',
    thPhone: 'Téléphone',
    thAddress: 'Adresse',
    thBalance: 'Solde / Créances',
    btnNewClient: 'Nouveau client',
    companyProfileTitle: "🏢 Profil de l'Établissement",
    lblCompanyName: 'Raison sociale / Nom commercial',
    lblAddress: 'Adresse complète',
    btnSaveProfile: 'Enregistrer le profil',
    backupTitle: '💾 Sauvegarde & Sécurité des données',
    backupDesc: 'Exportez instantanément toutes vos données sur clé USB Flash Disk en un clic pour une sécurité maximale 100% hors-ligne.',
    btnDownloadBackup: 'Télécharger sauvegarde (.json)',
    lblRestoreBackup: 'Restaurer depuis une clé USB',
    modalNewProduct: 'Nouvel article en stock',
    btnCancel: 'Annuler',
    btnSave: 'Enregistrer',
    modalNewClient: 'Nouveau client / Entreprise',
    thermalTicketTitle: 'Aperçu Ticket de Caisse (80mm)'
  },
  en: {
    navDashboard: 'Dashboard',
    navPOS: 'Point of Sale (POS)',
    navInvoices: 'Invoices & Vouchers (A4)',
    navProducts: 'Products & Inventory',
    navClients: 'Clients & Receivables',
    navSettings: 'Company & USB Backup',
    statRevenue: "Today's Revenue",
    statInvoicesCount: 'Invoices & Tickets',
    statProducts: 'Total Items in Stock',
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
    cartTitle: 'Sales Register (Ticket)',
    totalHT: 'Total Excl. Tax (HT):',
    timbreFiscal: 'Cash Stamp Duty (1%):',
    grandTotal: 'Grand Total TTC:',
    btnPayAndPrint: 'Pay & Print Receipt',
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
    companyProfileTitle: '🏢 Business Profile',
    lblCompanyName: 'Company Name / Trade Name',
    lblAddress: 'Full Address',
    btnSaveProfile: 'Save Profile',
    backupTitle: '💾 Backup & Data Protection',
    backupDesc: 'Backup all your data instantly to a USB Flash Drive for 100% offline security and zero cloud dependency.',
    btnDownloadBackup: 'Download Backup (.json)',
    lblRestoreBackup: 'Restore Backup from USB Drive',
    modalNewProduct: 'Add Product to Inventory',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    modalNewClient: 'Add New Client / Company',
    thermalTicketTitle: '80mm Receipt Ticket Preview'
  }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  LocalDB.init();
  
  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('a4DocDate').value = today;

  initNavigation();
  initThemeAndLang();
  initDashboard();
  initPOS();
  initA4Invoices();
  initProducts();
  initClients();
  initSettings();
});

// 1. NAVIGATION
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add('active');

      const titleKey = btn.querySelector('span')?.getAttribute('data-i18n');
      if (titleKey && I18N[currentLang][titleKey]) {
        document.getElementById('pageTitleText').textContent = I18N[currentLang][titleKey];
      }

      // Refresh data
      if (targetTab === 'tab-dashboard') refreshDashboard();
      if (targetTab === 'tab-pos') refreshPOSProducts();
      if (targetTab === 'tab-products') refreshProductsTable();
      if (targetTab === 'tab-clients') refreshClientsTable();
      if (targetTab === 'tab-invoices') refreshA4ClientsSelect();
    });
  });

  document.getElementById('btnLaunchPos').addEventListener('click', () => {
    document.querySelector('[data-tab="tab-pos"]').click();
  });
  document.getElementById('btnNewA4Invoice').addEventListener('click', () => {
    document.querySelector('[data-tab="tab-invoices"]').click();
  });
}

// 2. THEME & LANGUAGE
function initThemeAndLang() {
  const settings = LocalDB.getSettings();
  if (settings.theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    document.getElementById('themeToggleBtn').textContent = '☀️';
  }

  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.body.removeAttribute('data-theme');
      document.getElementById('themeToggleBtn').textContent = '🌙';
      LocalDB.saveSettings({ ...LocalDB.getSettings(), theme: 'light' });
    } else {
      document.body.setAttribute('data-theme', 'dark');
      document.getElementById('themeToggleBtn').textContent = '☀️';
      LocalDB.saveSettings({ ...LocalDB.getSettings(), theme: 'dark' });
    }
  });

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      if (lang && lang !== currentLang) {
        currentLang = lang;
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyTranslations(lang);
      }
    });
  });
}

function applyTranslations(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (I18N[lang] && I18N[lang][key]) {
      el.textContent = I18N[lang][key];
    }
  });

  // Active tab title
  const activeNav = document.querySelector('.nav-btn.active span')?.getAttribute('data-i18n');
  if (activeNav && I18N[lang][activeNav]) {
    document.getElementById('pageTitleText').textContent = I18N[lang][activeNav];
  }

  updateA4Calculations();
  updateCartTotals();
}

// 3. DASHBOARD
function initDashboard() {
  refreshDashboard();
}

function refreshDashboard() {
  const invoices = LocalDB.getInvoices();
  const products = LocalDB.getProducts();

  let todayTotal = 0;
  const todayStr = new Date().toISOString().split('T')[0];

  invoices.forEach(inv => {
    if (inv.date && inv.date.startsWith(todayStr)) {
      todayTotal += inv.grandTotalTTC || 0;
    }
  });

  document.getElementById('statTodaySales').textContent = `${todayTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('statInvoiceCount').textContent = invoices.length;
  document.getElementById('statProductCount').textContent = products.length;

  const lowStock = products.filter(p => p.stock <= (p.minStock || 5)).length;
  document.getElementById('statLowStockCount').textContent = lowStock;

  // Render recent transactions table
  const tbody = document.getElementById('recentInvoicesTableBody');
  tbody.innerHTML = '';

  if (invoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:1.5rem;">لا توجد معاملات مسجلة بعد. ابدأ عملية بيع من الكاشير أو محرر الفواتير!</td></tr>`;
    return;
  }

  invoices.slice(0, 8).forEach(inv => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700; color:var(--primary);">${escapeHtml(inv.docNumber || inv.id)}</td>
      <td>${inv.date || '-'}</td>
      <td>${escapeHtml(inv.clientName || 'عميل نقدي (Comptoir)')}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); padding:2px 6px; border-radius:4px; font-weight:700;">${inv.type || 'FACTURE'}</span></td>
      <td>${inv.paymentMethod || 'ESPECES'}</td>
      <td style="text-align:right; font-weight:800;">${(inv.grandTotalTTC || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج</td>
      <td style="text-align:center;">
        <button class="btn btn-outline btn-sm btn-print-inv" data-id="${inv.id}">🖨️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. POS (CAISSE RAPIDE)
function initPOS() {
  refreshPOSProducts();

  // Search / Barcode input
  const barcodeInput = document.getElementById('posBarcodeInput');
  barcodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = barcodeInput.value.trim();
      if (!code) return;

      const products = LocalDB.getProducts();
      const found = products.find(p => p.barcode === code || p.name.toLowerCase().includes(code.toLowerCase()));
      if (found) {
        addToCart(found);
        barcodeInput.value = '';
      }
    }
  });

  // Clear Cart
  document.getElementById('btnClearCart').addEventListener('click', () => {
    cart = [];
    renderCart();
  });

  // POS Checkout Button
  document.getElementById('btnPosCheckout').addEventListener('click', () => {
    if (cart.length === 0) {
      alert(currentLang === 'ar' ? 'السلة فارغة! أضف منتجات أولاً.' : 'Le panier est vide !');
      return;
    }
    openTicketModal();
  });

  // Close ticket modal
  document.getElementById('btnCloseTicketModal').addEventListener('click', () => {
    document.getElementById('ticketPrintModal').classList.remove('active');
  });

  // Confirm Print Ticket
  document.getElementById('btnConfirmPrintTicket').addEventListener('click', () => {
    // Record sale in DB
    const totals = calculateCartFiscal();
    const company = LocalDB.getCompany();
    const docNum = 'POS-' + Date.now().toString().slice(-6);

    LocalDB.addInvoice({
      docNumber: docNum,
      type: 'TICKET_POS',
      date: new Date().toISOString().split('T')[0],
      clientName: currentLang === 'ar' ? 'زبون نقدي (Comptoir)' : 'Client Comptoir',
      items: cart.map(c => ({
        productId: c.product.id,
        description: c.product.name,
        quantity: c.qty,
        unitPriceHT: c.product.sellPrice / (1 + (c.product.tvaRate || 19) / 100),
        tvaRate: c.product.tvaRate || 19
      })),
      paymentMethod: 'ESPECES',
      totalHT: totals.totalHT,
      totalTVA: totals.totalTVA,
      timbreFiscal: totals.timbreFiscal,
      grandTotalTTC: totals.grandTotalTTC
    });

    window.print();
    cart = [];
    renderCart();
    document.getElementById('ticketPrintModal').classList.remove('active');
    refreshDashboard();
  });
}

function refreshPOSProducts(category = 'ALL') {
  const grid = document.getElementById('posProductGrid');
  const catContainer = document.getElementById('posCategoryFilters');
  const products = LocalDB.getProducts();

  // Populate categories
  const categories = ['ALL', ...new Set(products.map(p => p.category || 'عام'))];
  catContainer.innerHTML = '';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `cat-btn ${cat === category ? 'active' : ''}`;
    btn.textContent = cat === 'ALL' ? (currentLang === 'ar' ? 'الكل' : 'Tous') : cat;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshPOSProducts(cat);
    });
    catContainer.appendChild(btn);
  });

  // Populate Grid
  grid.innerHTML = '';
  const filtered = category === 'ALL' ? products : products.filter(p => p.category === category);

  filtered.forEach(prod => {
    const card = document.createElement('div');
    card.className = 'pos-card';
    card.innerHTML = `
      <div class="pos-card-name">${escapeHtml(prod.name)}</div>
      <div style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">المخزون: ${prod.stock}</div>
      <div class="pos-card-price">${Number(prod.sellPrice).toLocaleString('fr-FR')} دج</div>
    `;
    card.addEventListener('click', () => {
      addToCart(prod);
    });
    grid.appendChild(card);
  });
}

function addToCart(product) {
  const existing = cart.find(c => c.product.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ product, qty: 1 });
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('posCartItems');
  container.innerHTML = '';

  if (cart.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:2rem 1rem;">سلة البيع فارغة.<br>انقر على صنف أو امسح الباركود لإضافته.</div>`;
    updateCartTotals();
    return;
  }

  cart.forEach((item, index) => {
    const row = document.createElement('div');
    const lineTotal = item.qty * item.product.sellPrice;
    row.className = 'cart-item-row';
    row.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:700;">${escapeHtml(item.product.name)}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${item.product.sellPrice.toLocaleString('fr-FR')} دج × ${item.qty}</div>
      </div>
      <div style="display:flex; align-items:center; gap:0.4rem;">
        <button class="btn btn-outline btn-sm btn-cart-dec" data-idx="${index}" style="padding:2px 8px;">-</button>
        <span style="font-weight:800; min-width:20px; text-align:center;">${item.qty}</span>
        <button class="btn btn-outline btn-sm btn-cart-inc" data-idx="${index}" style="padding:2px 8px;">+</button>
      </div>
      <div style="font-weight:800; min-width:80px; text-align:right;">
        ${lineTotal.toLocaleString('fr-FR')} دج
      </div>
    `;
    container.appendChild(row);
  });

  // Attach item quantity handlers
  container.querySelectorAll('.btn-cart-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      cart[idx].qty += 1;
      renderCart();
    });
  });

  container.querySelectorAll('.btn-cart-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      cart[idx].qty -= 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      renderCart();
    });
  });

  updateCartTotals();
}

function calculateCartFiscal() {
  const items = cart.map(c => {
    const sellPriceTTC = c.product.sellPrice;
    const tva = c.product.tvaRate || 19;
    const priceHT = sellPriceTTC / (1 + tva / 100);
    return {
      quantity: c.qty,
      unitPriceHT: priceHT,
      tvaRate: tva
    };
  });

  return calculateInvoiceTotals({
    items,
    paymentMethod: PAYMENT_METHODS.ESPECES
  });
}

function updateCartTotals() {
  const totals = calculateCartFiscal();
  document.getElementById('cartTotalHT').textContent = `${totals.totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartTotalTVA').textContent = `${totals.totalTVA.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartTimbre').textContent = `${totals.timbreFiscal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartGrandTotal').textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
}

function openTicketModal() {
  const company = LocalDB.getCompany();
  const totals = calculateCartFiscal();

  document.getElementById('tktCompanyName').textContent = company.name || 'مؤسسة الجزائر';
  document.getElementById('tktCompanyAddress').textContent = company.address || '-';
  document.getElementById('tktCompanyNif').textContent = company.nif || '-';
  document.getElementById('tktDocNum').textContent = 'POS-' + Date.now().toString().slice(-6);
  document.getElementById('tktDate').textContent = new Date().toLocaleString('fr-FR');

  const tbody = document.getElementById('tktItemsBody');
  tbody.innerHTML = '';
  cart.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.product.name)}</td>
      <td style="text-align:center;">${c.qty}</td>
      <td style="text-align:right;">${(c.qty * c.product.sellPrice).toLocaleString('fr-FR')}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tktGrandTotal').textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('ticketPrintModal').classList.add('active');
}

// 5. A4 INVOICING ENGINE
function initA4Invoices() {
  refreshA4ClientsSelect();
  renderA4ItemsForm();

  document.getElementById('btnA4AddItem').addEventListener('click', () => {
    a4Items.push({
      description: currentLang === 'ar' ? 'سلعة أو خدمة جديدة' : 'Nouvel article ou prestation',
      quantity: 1,
      unitPriceHT: 5000,
      tvaRate: 19
    });
    renderA4ItemsForm();
  });

  document.getElementById('btnPrintA4').addEventListener('click', () => {
    // Save invoice to DB before print
    const company = LocalDB.getCompany();
    const clientSelect = document.getElementById('a4ClientSelect');
    const client = LocalDB.getClients().find(c => c.id === clientSelect.value) || { name: 'عميل عام' };
    const totals = calculateInvoiceTotals({
      items: a4Items.map(it => ({ quantity: it.quantity, unitPriceHT: it.unitPriceHT, tvaRate: it.tvaRate })),
      paymentMethod: document.getElementById('a4PaymentMethod').value
    });

    LocalDB.addInvoice({
      docNumber: document.getElementById('a4DocNumber').value,
      type: document.getElementById('a4DocType').value,
      date: document.getElementById('a4DocDate').value,
      clientName: client.name,
      paymentMethod: document.getElementById('a4PaymentMethod').value,
      items: a4Items,
      totalHT: totals.totalHT,
      totalTVA: totals.totalTVA,
      timbreFiscal: totals.timbreFiscal,
      grandTotalTTC: totals.grandTotalTTC
    });

    window.print();
    refreshDashboard();
  });

  // Form input listeners
  ['a4DocType', 'a4DocNumber', 'a4DocDate', 'a4PaymentMethod', 'a4ClientSelect'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateA4Calculations);
  });
}

function refreshA4ClientsSelect() {
  const select = document.getElementById('a4ClientSelect');
  select.innerHTML = '';
  const clients = LocalDB.getClients();
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.phone || c.address || ''})`;
    select.appendChild(opt);
  });
  updateA4Calculations();
}

function renderA4ItemsForm() {
  const container = document.getElementById('a4ItemsContainer');
  container.innerHTML = '';

  a4Items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.style = 'display:grid; grid-template-columns: 2fr 0.8fr 1.2fr 0.8fr 30px; gap:0.4rem; align-items:center;';
    row.innerHTML = `
      <input type="text" class="search-input" value="${escapeHtml(it.description)}" data-idx="${idx}" data-field="description" style="max-width:none;">
      <input type="number" min="1" class="search-input" value="${it.quantity}" data-idx="${idx}" data-field="quantity" style="max-width:none;">
      <input type="number" min="0" step="10" class="search-input" value="${it.unitPriceHT}" data-idx="${idx}" data-field="unitPriceHT" style="max-width:none;">
      <select class="search-input" data-idx="${idx}" data-field="tvaRate" style="max-width:none;">
        <option value="19" ${it.tvaRate === 19 ? 'selected' : ''}>19%</option>
        <option value="9" ${it.tvaRate === 9 ? 'selected' : ''}>9%</option>
        <option value="0" ${it.tvaRate === 0 ? 'selected' : ''}>0%</option>
      </select>
      <button class="btn btn-danger btn-sm remove-a4-item" data-idx="${idx}" style="padding:4px 6px;">✕</button>
    `;
    container.appendChild(row);
  });

  // Listeners
  container.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      if (field === 'quantity' || field === 'unitPriceHT' || field === 'tvaRate') {
        a4Items[idx][field] = Number(e.target.value) || 0;
      } else {
        a4Items[idx][field] = e.target.value;
      }
      updateA4Calculations();
    });
  });

  container.querySelectorAll('.remove-a4-item').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      a4Items.splice(idx, 1);
      renderA4ItemsForm();
      updateA4Calculations();
    });
  });

  updateA4Calculations();
}

function updateA4Calculations() {
  const company = LocalDB.getCompany();
  const paymentMethod = document.getElementById('a4PaymentMethod').value;
  const docType = document.getElementById('a4DocType').value;
  const docNum = document.getElementById('a4DocNumber').value;
  const docDate = document.getElementById('a4DocDate').value;

  const clientSelect = document.getElementById('a4ClientSelect');
  const clients = LocalDB.getClients();
  const client = clients.find(c => c.id === clientSelect.value) || { name: '-', address: '-', nif: '-', rc: '-' };

  const totals = calculateInvoiceTotals({
    items: a4Items.map(it => ({ quantity: it.quantity, unitPriceHT: it.unitPriceHT, tvaRate: it.tvaRate })),
    paymentMethod
  });

  const tafqitText = tafqitDZD(totals.grandTotalTTC, { lang: currentLang, legalSuffix: true, currency: true });

  // Update builder Tafqit Box
  document.getElementById('a4TafqitText').textContent = tafqitText;

  // Update Printable Sheet Preview
  document.getElementById('sheetCompanyName').textContent = company.name || '-';
  document.getElementById('sheetCompanyAddress').textContent = company.address || '-';
  document.getElementById('sheetCompanyRc').textContent = company.rc || '-';
  document.getElementById('sheetCompanyNif').textContent = company.nif || '-';
  document.getElementById('sheetCompanyNis').textContent = company.nis || '-';
  document.getElementById('sheetCompanyAi').textContent = company.ai || '-';

  document.getElementById('sheetDocType').textContent = docType;
  document.getElementById('sheetDocNum').textContent = `N°: ${docNum}`;
  document.getElementById('sheetDocDate').textContent = docDate;

  document.getElementById('sheetClientName').textContent = client.name || '-';
  document.getElementById('sheetClientAddress').textContent = client.address || '-';
  document.getElementById('sheetClientNif').textContent = client.nif || '-';
  document.getElementById('sheetClientRc').textContent = client.rc || '-';

  const sheetBody = document.getElementById('sheetTableBody');
  sheetBody.innerHTML = '';
  a4Items.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="border:1px solid #cbd5e1; padding:4px;">${escapeHtml(it.description)}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${it.quantity}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:right;">${it.unitPriceHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${it.tvaRate}%</td>
      <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:700;">${(it.quantity * it.unitPriceHT).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
    `;
    sheetBody.appendChild(tr);
  });

  document.getElementById('sheetTotalHT').textContent = `${totals.totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('sheetTotalTVA').textContent = `${totals.totalTVA.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('sheetTimbre').textContent = `${totals.timbreFiscal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('sheetGrandTotal').textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('sheetTafqitWords').textContent = tafqitText;
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
  });

  document.getElementById('productSearchInput').addEventListener('input', e => {
    refreshProductsTable(e.target.value);
  });
}

function refreshProductsTable(query = '') {
  const tbody = document.getElementById('productsTableBody');
  tbody.innerHTML = '';
  const products = LocalDB.getProducts();
  const q = query.trim().toLowerCase();

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))
  );

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:monospace; color:#64748b;">${escapeHtml(p.barcode || '-')}</td>
      <td style="font-weight:700;">${escapeHtml(p.name)}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); padding:2px 8px; border-radius:4px;">${escapeHtml(p.category || '-')}</span></td>
      <td style="text-align:right;">${Number(p.buyPrice).toLocaleString('fr-FR')} دج</td>
      <td style="text-align:right; font-weight:800; color:var(--primary);">${Number(p.sellPrice).toLocaleString('fr-FR')} دج</td>
      <td style="text-align:center; font-weight:700; ${p.stock <= (p.minStock || 5) ? 'color:#dc2626;' : ''}">
        ${p.stock}
      </td>
      <td style="text-align:center;">
        <button class="btn btn-danger btn-sm btn-delete-prod" data-id="${p.id}" title="حذف">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-delete-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
        LocalDB.deleteProduct(btn.dataset.id);
        refreshProductsTable();
        refreshDashboard();
      }
    });
  });
}

// 7. CLIENTS MANAGEMENT
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
      balance: 0
    });

    modal.classList.remove('active');
    document.getElementById('clientForm').reset();
    refreshClientsTable();
    refreshA4ClientsSelect();
  });

  document.getElementById('clientSearchInput').addEventListener('input', e => {
    refreshClientsTable(e.target.value);
  });
}

function refreshClientsTable(query = '') {
  const tbody = document.getElementById('clientsTableBody');
  tbody.innerHTML = '';
  const clients = LocalDB.getClients();
  const q = query.trim().toLowerCase();

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
  );

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td>${escapeHtml(c.address || '-')}</td>
      <td style="font-family:monospace; color:#64748b;">${escapeHtml(c.nif || '-')}</td>
      <td style="text-align:right; font-weight:800; ${c.balance > 0 ? 'color:#dc2626;' : 'color:#16a34a;'}">
        ${Number(c.balance || 0).toLocaleString('fr-FR')} دج
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 8. SETTINGS & USB FLASH BACKUP
function initSettings() {
  const company = LocalDB.getCompany();
  document.getElementById('cfgCompanyName').value = company.name || '';
  document.getElementById('cfgCompanyAddress').value = company.address || '';
  document.getElementById('cfgCompanyNif').value = company.nif || '';
  document.getElementById('cfgCompanyNis').value = company.nis || '';
  document.getElementById('cfgCompanyRc').value = company.rc || '';
  document.getElementById('cfgCompanyAi').value = company.ai || '';
  document.getElementById('cfgCompanyRib').value = company.rib || '';

  document.getElementById('companyProfileForm').addEventListener('submit', e => {
    e.preventDefault();
    LocalDB.saveCompany({
      name: document.getElementById('cfgCompanyName').value.trim(),
      address: document.getElementById('cfgCompanyAddress').value.trim(),
      nif: document.getElementById('cfgCompanyNif').value.trim(),
      nis: document.getElementById('cfgCompanyNis').value.trim(),
      rc: document.getElementById('cfgCompanyRc').value.trim(),
      ai: document.getElementById('cfgCompanyAi').value.trim(),
      rib: document.getElementById('cfgCompanyRib').value.trim()
    });
    alert(currentLang === 'ar' ? 'تم حفظ بيانات المؤسسة بنجاح!' : 'Profil enregistré avec succès !');
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
  });

  // Import Backup File
  document.getElementById('importBackupFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      const res = LocalDB.importBackupJSON(ev.target.result);
      if (res.success) {
        alert(currentLang === 'ar' ? 'تم استرجاع النسخة الاحتياطية بنجاح!' : 'Sauvegarde restaurée avec succès !');
        location.reload();
      } else {
        alert('حدث خطأ في قراءة ملف النسخة الاحتياطية: ' + res.error);
      }
    };
    reader.readAsText(file);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
