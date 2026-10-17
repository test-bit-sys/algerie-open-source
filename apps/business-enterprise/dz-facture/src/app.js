/**
 * DZ-Facture & POS: Master Application Controller (Enterprise Grade)
 * Trilingual (AR / FR / EN), Offline-First, Full POS & Invoicing Flow
 * Interactive Financial Charts, Synthesized Sound Effects, Barcode Stickers,
 * Cashier Change Calculator, Held Carts, Client Debt Payments, and Authentic QR Codes.
 */

import { LocalDB } from './modules/db.js';
import { calculateInvoiceTotals, TVA_RATES, PAYMENT_METHODS } from './modules/fiscal.js';
import { tafqitDZD } from './modules/tafqit.js';
import { getWilayas } from './modules/geo.js';
import { sound } from './modules/audio.js';
import { QRCodeSVG } from './modules/qrcode.js';
import { BusinessCharts } from './modules/charts.js';

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
    navDashboard: 'لوحة القيادة والمؤشرات',
    navPOS: 'نقطة البيع والكاشير (POS)',
    navInvoices: 'الفواتير وسندات التسليم (A4)',
    navProducts: 'المنتجات والمخزون',
    navClients: 'العملاء والديون (Crédit)',
    navSettings: 'بيانات المؤسسة والنسخ الاحتياطي',
    statRevenue: 'مبيعات اليوم الإجمالية',
    statProfit: 'هامش الربح الإجمالي التقديري',
    statInvoicesCount: 'عدد الفواتير والتذاكر',
    statProducts: 'إجمالي أصناف المخزون',
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
    cartTitle: 'سلة المبيعات (Ticket)',
    totalHT: 'المجموع الصافي HT:',
    timbreFiscal: 'رسم الطابع الجبائي (1%):',
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
    navDashboard: 'Tableau de bord & Analyses',
    navPOS: 'Point de vente (POS)',
    navInvoices: 'Factures & Bons (A4)',
    navProducts: 'Articles & Stock',
    navClients: 'Clients & Créances',
    navSettings: 'Établissement & Sauvegarde',
    statRevenue: 'Ventes du Jour',
    statProfit: 'Marge Bénéficiaire Estimée',
    statInvoicesCount: 'Factures & Tickets',
    statProducts: 'Total Références',
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
    cartTitle: 'Panier de vente (Ticket)',
    totalHT: 'Total Hors Taxes (HT) :',
    timbreFiscal: 'Droit de Timbre (1%) :',
    grandTotal: 'Total Général TTC :',
    btnPayAndPrint: 'Payer & Imprimer [F9]',
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
    navDashboard: 'Dashboard & Metrics',
    navPOS: 'Point of Sale (POS)',
    navInvoices: 'Invoices & Vouchers (A4)',
    navProducts: 'Products & Inventory',
    navClients: 'Clients & Receivables',
    navSettings: 'Company & USB Backup',
    statRevenue: "Today's Revenue",
    statProfit: 'Estimated Gross Margin',
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
    companyProfileTitle: '🏢 Business Profile',
    lblCompanyName: 'Company Name / Trade Name',
    lblAddress: 'Full Address',
    btnSaveProfile: 'Save Profile',
    backupTitle: '💾 Backup & Data Protection',
    backupDesc: 'Export your entire local database to an external USB Flash drive with one click for maximum 100% offline security.',
    btnDownloadBackup: 'Download Backup (.json)',
    lblRestoreBackup: 'Restore from USB Flash drive',
    modalNewProduct: 'Add New Item to Inventory',
    btnCancel: 'Cancel',
    btnSave: 'Save',
    modalNewClient: 'Add New Client / Company',
    thermalTicketTitle: 'Cashier Thermal Receipt (80mm)'
  }
};

// Toast Notifications Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// Master DOM Initialization
document.addEventListener('DOMContentLoaded', () => {
  LocalDB.init();

  initNavigation();
  initLanguageAndTheme();
  initSoundEngine();
  initKeyboardShortcuts();
  initDashboard();
  initPOS();
  initFacturationA4();
  initProducts();
  initClients();
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
      }
    });
  });

  document.getElementById('btnLaunchPos')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="tab-pos"]')?.click();
  });

  document.getElementById('btnNewA4Invoice')?.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-tab="tab-invoices"]')?.click();
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
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.body.removeAttribute('data-theme');
      themeBtn.textContent = '🌙';
    } else {
      document.body.setAttribute('data-theme', 'dark');
      themeBtn.textContent = '☀️';
    }
    // Refresh charts on theme change
    refreshDashboard();
  });
}

function initSoundEngine() {
  const soundBtn = document.getElementById('soundToggleBtn');
  if (!soundBtn) return;

  soundBtn.addEventListener('click', () => {
    const isMuted = sound.toggleMute();
    soundBtn.textContent = isMuted ? '🔇' : '🔊';
    soundBtn.title = isMuted ? 'تشغيل الصوت' : 'كتم الصوت';
    showToast(isMuted ? 'تم كتم الصوت' : 'تم تفعيل الصوت');
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ignore when typing inside standard inputs unless it's a function key
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
      // Close active modals
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });
}

function applyLanguage(lang) {
  currentLang = lang;
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
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) {
      el.textContent = t[key];
    }
  });

  const activeBtn = document.querySelector('.nav-btn.active');
  const titleKey = activeBtn?.querySelector('[data-i18n]')?.dataset.i18n;
  if (titleKey && t[titleKey]) {
    document.getElementById('pageTitleText').textContent = t[titleKey];
  }

  updateA4Calculations();
}

// 3. DASHBOARD METRICS & CHARTS
function initDashboard() {
  refreshDashboard();
}

function refreshDashboard() {
  const invoices = LocalDB.getInvoices();
  const products = LocalDB.getProducts();

  const todayStr = new Date().toISOString().split('T')[0];
  const todayInvoices = invoices.filter(inv => {
    const d = (inv.docDate || (inv.createdAt ? inv.createdAt.split('T')[0] : '')).substring(0, 10);
    return d === todayStr;
  });

  const todaySales = todayInvoices.reduce((sum, inv) => sum + (Number(inv.totalTTC) || 0), 0);
  const totalGrossProfit = invoices.reduce((sum, inv) => sum + (Number(inv.grossProfit) || 0), 0);
  const lowStock = products.filter(p => Number(p.stock) <= (Number(p.minStock) || 5)).length;

  document.getElementById('statTodaySales').textContent = `${todaySales.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('statGrossProfit').textContent = `${totalGrossProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('statProductCount').textContent = products.length;
  document.getElementById('statLowStockCount').textContent = lowStock;

  // Render SVG Charts
  const weeklyContainer = document.getElementById('weeklySalesChartContainer');
  const donutContainer = document.getElementById('paymentDonutContainer');
  BusinessCharts.renderWeeklySalesChart(weeklyContainer, invoices);
  BusinessCharts.renderPaymentDonut(donutContainer, invoices);

  // Render Recent Invoices Table
  const tbody = document.getElementById('recentInvoicesTableBody');
  tbody.innerHTML = '';

  invoices.slice(0, 6).forEach(inv => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700; color:var(--primary); font-family:monospace;">${escapeHtml(inv.docNumber || inv.id)}</td>
      <td style="color:var(--text-muted); font-size:0.8rem;">${(inv.docDate || inv.createdAt || '').substring(0, 10)}</td>
      <td style="font-weight:600;">${escapeHtml(inv.clientName || 'عميل نقدي')}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); padding:2px 8px; border-radius:4px; font-weight:700;">${inv.docType || 'FACTURE'}</span></td>
      <td><span style="font-size:0.75rem; font-weight:700; color:#0284c7;">${inv.paymentMethod || 'ESPECES'}</span></td>
      <td style="text-align:right; font-weight:800; font-size:0.95rem;">${Number(inv.totalTTC || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج</td>
      <td style="text-align:center;">
        <button class="btn btn-outline btn-sm btn-print-row" data-id="${inv.id}">🖨️</button>
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
}

// 4. POS CASHIER CONTROLLER
function initPOS() {
  refreshPOSGrid();
  renderCart();
  updateHeldCartsBadge();

  // Search input
  const searchInput = document.getElementById('posBarcodeInput');
  searchInput.addEventListener('input', e => {
    refreshPOSGrid(e.target.value);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = searchInput.value.trim();
      if (!code) return;
      const products = LocalDB.getProducts();
      const found = products.find(p => p.barcode === code || p.id === code);
      if (found) {
        addToCart(found);
        searchInput.value = '';
        sound.playBeep();
      }
    }
  });

  // Clear Cart
  document.getElementById('btnClearCart').addEventListener('click', () => {
    if (cart.length > 0 && confirm('هل تريد إفراغ سلة البيع؟')) {
      cart = [];
      renderCart();
    }
  });

  // Hold current cart
  document.getElementById('btnHoldCurrentCart').addEventListener('click', () => {
    if (cart.length === 0) {
      showToast('السلة فارغة حالياً', 'warning');
      return;
    }
    LocalDB.saveHeldCart(cart);
    cart = [];
    renderCart();
    updateHeldCartsBadge();
    sound.playBeep();
    showToast('تم تعليق السلة لخدمة زبون آخر مؤقتاً');
  });

  // Open Held Carts List
  document.getElementById('btnHeldCartsList').addEventListener('click', openHeldCartsModal);
  document.getElementById('btnCloseHeldModal').addEventListener('click', () => {
    document.getElementById('heldCartsModal').classList.remove('active');
  });

  // Checkout button -> Open Cash Change Calculator Modal
  document.getElementById('btnPosCheckout').addEventListener('click', () => {
    if (cart.length === 0) {
      sound.playError();
      showToast('يرجى إضافة سلع إلى السلة أولاً', 'warning');
      return;
    }
    openCheckoutModal();
  });

  initCheckoutCalculator();

  // Close ticket modal
  document.getElementById('btnCloseTicketModal').addEventListener('click', () => {
    document.getElementById('ticketPrintModal').classList.remove('active');
  });

  document.getElementById('btnConfirmPrintTicket').addEventListener('click', () => {
    window.print();
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
    container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--text-muted);">لا توجد سلات معلقة حالياً.</div>`;
  } else {
    held.forEach(h => {
      const div = document.createElement('div');
      div.style.cssText = 'background:var(--bg-main); border:1px solid var(--border); border-radius:8px; padding:0.75rem; display:flex; justify-content:space-between; align-items:center;';
      const itemsCount = h.items.reduce((s, it) => s + it.quantity, 0);
      const total = h.items.reduce((s, it) => s + (it.quantity * it.sellPrice), 0);

      div.innerHTML = `
        <div>
          <div style="font-weight:800;">${escapeHtml(h.label)} <span style="font-size:0.75rem; color:var(--text-muted);">(${h.savedAt})</span></div>
          <div style="font-size:0.8rem; color:var(--text-muted);">${itemsCount} سلع - المجموع: <b>${total.toLocaleString('fr-FR')} دج</b></div>
        </div>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-primary btn-sm btn-restore-held" data-id="${h.id}">استئناف ▶️</button>
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
          LocalDB.removeHeldCart(item.id);
          renderCart();
          updateHeldCartsBadge();
          modal.classList.remove('active');
          sound.playBeep();
          showToast('تمت استعادة السلة المعلقة بنجاح');
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

function openCheckoutModal() {
  const totals = calculatePOSCartTotals();
  const modal = document.getElementById('checkoutModal');
  const dueEl = document.getElementById('checkoutDueAmount');
  const receivedInput = document.getElementById('checkoutReceivedAmount');
  const changeEl = document.getElementById('checkoutChangeDue');

  dueEl.textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  receivedInput.value = totals.grandTotalTTC;
  changeEl.textContent = '0.00 دج';

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
    const totals = calculatePOSCartTotals();
    const received = Number(receivedInput.value) || 0;
    const change = Math.max(0, received - totals.grandTotalTTC);
    changeEl.textContent = `${change.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  }

  receivedInput.addEventListener('input', updateChange);

  document.querySelectorAll('.banknote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const totals = calculatePOSCartTotals();
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
    const method = document.getElementById('checkoutPaymentMethod').value;
    const totals = calculatePOSCartTotals(method);
    const company = LocalDB.getCompany();

    // Calculate profit
    let totalGrossProfit = 0;
    cart.forEach(item => {
      const profitPerUnit = (Number(item.sellPrice) || 0) - (Number(item.buyPrice) || 0);
      totalGrossProfit += profitPerUnit * (Number(item.quantity) || 1);
    });

    const newInvoice = {
      docType: 'POS',
      docNumber: `TKT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      docDate: new Date().toISOString().split('T')[0],
      clientName: 'عميل نقدي (Comptoir)',
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
      totalHT: totals.totalHT,
      totalTVA: totals.totalTVA,
      timbreFiscal: totals.timbreFiscal,
      totalTTC: totals.grandTotalTTC,
      grossProfit: Math.max(0, totalGrossProfit)
    };

    LocalDB.addInvoice(newInvoice);
    modal.classList.remove('active');
    sound.playCashSuccess();

    cart = [];
    renderCart();
    refreshPOSGrid();
    refreshDashboard();

    // Open Printable 80mm thermal receipt
    openTicketPrintModal(newInvoice);
  });
}

function refreshPOSGrid(query = '', category = 'ALL') {
  const grid = document.getElementById('posProductGrid');
  grid.innerHTML = '';
  const products = LocalDB.getProducts();

  const q = query.trim().toLowerCase();
  const filtered = products.filter(p => {
    const matchesQuery = p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q));
    const matchesCat = category === 'ALL' || p.category === category;
    return matchesQuery && matchesCat;
  });

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pos-card';
    card.innerHTML = `
      <div>
        <div class="pos-card-title">${escapeHtml(p.name)}</div>
        <div class="pos-card-stock">${p.stock > 0 ? `المتوفر: ${p.stock}` : '<b style="color:#dc2626;">نفد المخزون</b>'}</div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:0.5rem;">
        <div class="pos-card-price">${Number(p.sellPrice).toLocaleString('fr-FR')} دج</div>
        <button class="btn btn-primary btn-sm" style="padding:2px 8px;">+</button>
      </div>
    `;

    card.addEventListener('click', () => {
      if (p.stock <= 0) {
        sound.playError();
        showToast('تنبيه: هذا الصنف نفد من المخزون', 'warning');
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
  container.innerHTML = '';

  const totalQty = cart.reduce((s, it) => s + it.quantity, 0);
  if (badge) badge.textContent = totalQty;

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-muted); font-size:0.85rem;">
        🛒 سلة المبيعات فارغة.<br>امسح باركود أو انقر على سلعة للإضافة.
      </div>
    `;
  } else {
    cart.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'cart-item-row';
      row.innerHTML = `
        <div style="flex:1; padding-inline-end:0.5rem;">
          <div style="font-weight:700; font-size:0.85rem;">${escapeHtml(it.name)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${Number(it.sellPrice).toLocaleString('fr-FR')} دج</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.35rem;">
          <button class="cart-qty-btn btn-dec" data-idx="${idx}">-</button>
          <span style="font-weight:800; min-width:20px; text-align:center;">${it.quantity}</span>
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
  document.getElementById('cartTotalHT').textContent = `${totals.totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartTotalTVA').textContent = `${totals.totalTVA.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartTimbre').textContent = `${totals.timbreFiscal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
  document.getElementById('cartGrandTotal').textContent = `${totals.grandTotalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;
}

function calculatePOSCartTotals(paymentMethod = 'ESPECES') {
  const itemsForFiscal = cart.map(it => {
    const rate = it.tvaRate || 19;
    const priceHT = it.sellPrice / (1 + rate / 100);
    return {
      quantity: it.quantity,
      unitPriceHT: priceHT,
      discountPercent: 0,
      tvaRate: rate
    };
  });

  return calculateInvoiceTotals({
    items: itemsForFiscal,
    paymentMethod: paymentMethod === 'ESPECES' ? PAYMENT_METHODS.ESPECES : PAYMENT_METHODS.VIREMENT
  });
}

function openTicketPrintModal(inv) {
  const company = LocalDB.getCompany();
  document.getElementById('tktCompanyName').textContent = company.name || 'مؤسسة الأوراس';
  document.getElementById('tktCompanyAddress').textContent = company.address || 'الجزائر';
  document.getElementById('tktCompanyNif').textContent = company.nif || '-';
  document.getElementById('tktDocNum').textContent = inv.docNumber || inv.id;
  document.getElementById('tktDate').textContent = (inv.docDate || inv.createdAt || '').substring(0, 16);

  const tbody = document.getElementById('tktItemsBody');
  tbody.innerHTML = '';
  (inv.items || []).forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(it.description || it.name)}</td>
      <td style="text-align:center;">${it.quantity}</td>
      <td style="text-align:right;">${Number(it.totalTTC || (it.unitPriceHT * it.quantity)).toLocaleString('fr-FR')}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tktGrandTotal').textContent = `${Number(inv.totalTTC || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} دج`;

  // Dynamic QR Code on ticket
  const qrData = `DZ-POS | TICKET:${inv.docNumber} | TOTAL:${inv.totalTTC} DZD | DATE:${inv.docDate} | NIF:${company.nif}`;
  const qrEl = document.getElementById('tktQRCodeContainer');
  if (qrEl) {
    qrEl.innerHTML = QRCodeSVG.generateSVG(qrData, 85);
  }

  document.getElementById('ticketPrintModal').classList.add('active');
}

// 5. FACTURATION A4 CONTROLLER
function initFacturationA4() {
  document.getElementById('a4DocDate').value = new Date().toISOString().split('T')[0];

  refreshA4ClientsSelect();
  renderA4ItemsForm();

  document.getElementById('btnA4AddItem').addEventListener('click', () => {
    a4Items.push({ description: 'خدمة استشارية أو منتج جديد', quantity: 1, unitPriceHT: 10000, tvaRate: 19 });
    renderA4ItemsForm();
    sound.playBeep();
  });

  ['a4DocType', 'a4DocNumber', 'a4DocDate', 'a4PaymentMethod', 'a4ClientSelect'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateA4Calculations);
    document.getElementById(id).addEventListener('input', updateA4Calculations);
  });

  document.getElementById('btnPrintA4').addEventListener('click', () => {
    // Save invoice to local storage before printing
    saveCurrentA4Invoice();
    window.print();
  });
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
    clientName: client ? client.name : 'عميل غير مسجل',
    clientNif: client ? client.nif : '',
    clientRc: client ? client.rc : '',
    clientAddress: client ? client.address : '',
    paymentMethod,
    items: a4Items,
    totalHT: totals.totalHT,
    totalTVA: totals.totalTVA,
    timbreFiscal: totals.timbreFiscal,
    totalTTC: totals.grandTotalTTC,
    grossProfit: totals.totalHT * 0.2
  };

  LocalDB.addInvoice(inv);
  refreshDashboard();
  showToast('تم حفظ الفاتورة بنجاح في قاعدة البيانات');
}

function refreshA4ClientsSelect() {
  const sel = document.getElementById('a4ClientSelect');
  sel.innerHTML = '';
  const clients = LocalDB.getClients();
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.address || 'الجزائر'})`;
    sel.appendChild(opt);
  });
}

function renderA4ItemsForm() {
  const container = document.getElementById('a4ItemsContainer');
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
  const clientId = document.getElementById('a4ClientSelect').value;
  const client = clients.find(c => c.id === clientId) || clients[0] || {};

  const paymentMethod = document.getElementById('a4PaymentMethod').value;
  const docType = document.getElementById('a4DocType').value;
  const docNum = document.getElementById('a4DocNumber').value;
  const docDate = document.getElementById('a4DocDate').value;

  const totals = calculateInvoiceTotals({
    items: a4Items,
    paymentMethod: paymentMethod === 'ESPECES' ? PAYMENT_METHODS.ESPECES : PAYMENT_METHODS.VIREMENT
  });

  const tafqitText = tafqitDZD(totals.grandTotalTTC, currentLang);
  document.getElementById('a4TafqitText').textContent = tafqitText;

  // Update Sheet Preview
  document.getElementById('sheetCompanyName').textContent = company.name || 'مؤسسة الأوراس';
  document.getElementById('sheetCompanyAddress').textContent = company.address || 'الجزائر';
  document.getElementById('sheetCompanyRc').textContent = company.rc || '-';
  document.getElementById('sheetCompanyNif').textContent = company.nif || '-';
  document.getElementById('sheetCompanyNis').textContent = company.nis || '-';
  document.getElementById('sheetCompanyAi').textContent = company.ai || '-';
  document.getElementById('sheetCompanyRib').textContent = company.rib || '-';

  document.getElementById('sheetDocType').textContent = docType;
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
    stampBox.innerHTML = `ختم وإمضاء المؤسسة (Cachet & Signature)`;
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

function loadInvoiceIntoA4(inv) {
  document.getElementById('a4DocType').value = inv.docType || 'FACTURE';
  document.getElementById('a4DocNumber').value = inv.docNumber || inv.id;
  document.getElementById('a4DocDate').value = inv.docDate || new Date().toISOString().split('T')[0];
  document.getElementById('a4PaymentMethod').value = inv.paymentMethod || 'VIREMENT';

  if (inv.items && inv.items.length > 0) {
    a4Items = inv.items.map(it => ({
      description: it.description || it.name,
      quantity: it.quantity || 1,
      unitPriceHT: it.unitPriceHT || (it.sellPrice / 1.19),
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
    showToast('تمت إضافة المنتج بنجاح للمخزون');
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
  tbody.innerHTML = '';
  const products = LocalDB.getProducts();
  const q = query.trim().toLowerCase();

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))
  );

  filtered.forEach(p => {
    const margin = (Number(p.sellPrice) || 0) - (Number(p.buyPrice) || 0);
    const marginPct = p.buyPrice > 0 ? ((margin / p.buyPrice) * 100).toFixed(1) : '100';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:monospace; color:#64748b;">${escapeHtml(p.barcode || '-')}</td>
      <td style="font-weight:700;">${escapeHtml(p.name)}</td>
      <td><span style="font-size:0.75rem; background:var(--bg-main); padding:2px 8px; border-radius:4px;">${escapeHtml(p.category || '-')}</span></td>
      <td style="text-align:right;">${Number(p.buyPrice).toLocaleString('fr-FR')} دج</td>
      <td style="text-align:right; font-weight:800; color:var(--primary);">${Number(p.sellPrice).toLocaleString('fr-FR')} دج</td>
      <td style="text-align:center; font-size:0.8rem; font-weight:700; color:#0284c7;">+${margin.toLocaleString('fr-FR')} دج (${marginPct}%)</td>
      <td style="text-align:center; font-weight:700; ${p.stock <= (p.minStock || 5) ? 'color:#dc2626;' : ''}">
        ${p.stock}
      </td>
      <td style="text-align:center; display:flex; gap:0.25rem; justify-content:center;">
        <button class="btn btn-outline btn-sm btn-barcode-prod" data-id="${p.id}" title="طباعة ملصق الباركود والسعر">🏷️</button>
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
      if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
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
      ${Number(product.sellPrice).toLocaleString('fr-FR')} DZD
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
    showToast('تمت إضافة العميل بنجاح');
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
      alert('يرجى إدخال مبلغ صحيح');
      return;
    }

    const res = LocalDB.addClientPayment(clientId, amount, 'ESPECES', note);
    if (res) {
      sound.playCashSuccess();
      document.getElementById('debtPaymentModal').classList.remove('active');
      document.getElementById('debtPaymentForm').reset();
      refreshClientsTable();
      showToast(`تم تسجيل دفعة بقيمة ${amount.toLocaleString('fr-FR')} دج بنجاح`);
    }
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
      <td style="text-align:center;">
        ${c.balance > 0 ? `<button class="btn btn-warning btn-sm btn-pay-debt" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-bal="${c.balance}">💰 تسديد</button>` : '<span style="color:#16a34a; font-size:0.75rem;">خالص ✅</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-pay-debt').forEach(b => {
    b.addEventListener('click', () => {
      document.getElementById('debtClientId').value = b.dataset.id;
      document.getElementById('debtClientNameDisplay').textContent = b.dataset.name;
      document.getElementById('debtCurrentBalance').textContent = `${Number(b.dataset.bal).toLocaleString('fr-FR')} دج`;
      document.getElementById('debtPaymentAmount').value = Number(b.dataset.bal);
      document.getElementById('debtPaymentModal').classList.add('active');
    });
  });
}

// 8. SETTINGS & STAMP UPLOAD & USB FLASH BACKUP
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
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        stampDataUrl = ev.target.result;
        showToast('تم تحميل صورة الختم بنجاح');
      };
      reader.readAsDataURL(file);
    }
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
    showToast('تم حفظ بيانات المؤسسة والختم بنجاح');
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
    showToast('تم تصدير النسخة الاحتياطية بنجاح إلى جهازك');
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
        alert('تم استرجاع قاعدة البيانات كاملة بنجاح!');
        location.reload();
      } else {
        sound.playError();
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
