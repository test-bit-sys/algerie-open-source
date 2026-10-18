/**
 * DZ-DevTools Pro — Application Logic
 * Algerian Developer Platform & Administrative Geography Studio
 */

import { ALGERIA_WILAYAS, searchWilayas } from './geo-data.js';
import {
  validateNif,
  validateNis,
  validateRc,
  calculateCcpKey,
  generatePostalRip,
  validateRip,
  validatePaymentCard,
  validateAlgerianPhone,
  tafqitArabic,
  tafqitFrench
} from './validators.js';

const I18N = {
  ar: {
    appTitle: 'أدوات المطورين الجزائريين — DZ-DevTools',
    tabGeo: 'ولايات ومدن الجزائر (58)',
    tabValidators: 'المعرفات الجبائية والبنكية',
    tabPhone: 'مدقق أرقام الهواتف',
    tabTafqit: 'مختبر التفقيط البرمجي',
    tabSnippets: 'قصاصات الأكواد و SDK',
    searchWilayas: 'بحث بالاسم، الرمز (01-58)، رمز الهاتف، أو الرمز البريدي...',
    allRegions: 'جميع المناطق',
    regionCenter: 'الوسط',
    regionEast: 'الشرق',
    regionWest: 'الغرب',
    regionSouth: 'الجنوب',
    exportData: 'تصدير البيانات البرمجية',
    matricule: 'ترقيم السيارات:',
    phoneCode: 'مفتاح الهاتف:',
    postalPrefix: 'الرمز البريدي:',
    communesCount: 'البلديات الموثقة:',
    aboutTitle: 'عن منصة أدوات المطورين (DZ-DevTools)',
    aboutDesc: 'منصة مكتبية حرة ومفتوحة المصدر 100% جزائرية، تقدم حزمة متكاملة لبيانات ولايات ومدن الجزائر، مع دوال التحقق الجبائية والبنكية ومحاكيات الدفع الإلكتروني.',
    close: 'إغلاق',
    copySuccess: 'تم النسخ بنجاح إلى الحافظة'
  },
  fr: {
    appTitle: 'DZ-DevTools — Outils & SDK Développeurs Algériens',
    tabGeo: 'Wilayas & Communes (58)',
    tabValidators: 'Identifiants Fiscaux & Bancaires',
    tabPhone: 'Validateur Télécom & Mobile',
    tabTafqit: 'Sandbox Tafqit & Devises',
    tabSnippets: 'Snippets & SDK Algérie',
    searchWilayas: 'Rechercher par nom, code (01-58), indicatif...',
    allRegions: 'Toutes les régions',
    regionCenter: 'Centre',
    regionEast: 'Est',
    regionWest: 'Ouest',
    regionSouth: 'Sud',
    exportData: 'Exporter les données',
    matricule: 'Matricule :',
    phoneCode: 'Indicatif tél :',
    postalPrefix: 'Code postal :',
    communesCount: 'Communes répertoriées :',
    aboutTitle: 'À propos de DZ-DevTools',
    aboutDesc: 'Plateforme souveraine open source pour les développeurs algériens avec base de données des 58 wilayas et validateurs fiscaux.',
    close: 'Fermer',
    copySuccess: 'Copié dans le presse-papiers avec succès'
  },
  en: {
    appTitle: 'DZ-DevTools — Algerian Developer Suite & Geo Studio',
    tabGeo: 'Algerian Wilayas & Cities (58)',
    tabValidators: 'Fiscal & Banking Validators',
    tabPhone: 'Phone Carrier Inspector',
    tabTafqit: 'Tafqit API Sandbox',
    tabSnippets: 'Dev SDK Snippets',
    searchWilayas: 'Search by name, code (01-58), phone code, zip...',
    allRegions: 'All Regions',
    regionCenter: 'Center',
    regionEast: 'East',
    regionWest: 'West',
    regionSouth: 'South',
    exportData: 'Export Developer Data',
    matricule: 'Plate Code:',
    phoneCode: 'Phone Area Code:',
    postalPrefix: 'Postal Code:',
    communesCount: 'Documented Communes:',
    aboutTitle: 'About DZ-DevTools',
    aboutDesc: '100% offline-first open-source developer suite for Algerian administrative divisions, fiscal validators, and telecom tools.',
    close: 'Close',
    copySuccess: 'Successfully copied to clipboard'
  }
};

export class DZDevToolsApp {
  constructor() {
    this.currentLang = localStorage.getItem('dz_devtools_lang') || 'ar';
    this.currentTab = 'geo';
    this.selectedRegion = 'all';
    this.searchQuery = '';
    this.selectedWilaya = null;

    this.init();
  }

  init() {
    this.bindEvents();
    this.applyLanguage(this.currentLang);
    this.renderWilayasGrid();
    this.initValidators();
    this.initPhoneInspector();
    this.initTafqitSandbox();
    this.initSnippets();
  }

  bindEvents() {
    // Tabs switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Wilayas search input
    const searchInput = document.getElementById('wilayaSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderWilayasGrid();
      });
    }

    // Region filter buttons
    document.querySelectorAll('[data-region]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-region]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedRegion = btn.getAttribute('data-region');
        this.renderWilayasGrid();
      });
    });

    // Export Data Modal
    document.getElementById('btnOpenExportModal')?.addEventListener('click', () => {
      document.getElementById('modalExport')?.classList.add('active');
    });

    // Export Action Buttons
    document.getElementById('btnExportJson')?.addEventListener('click', () => this.downloadJsonData());
    document.getElementById('btnExportCsv')?.addEventListener('click', () => this.downloadCsvData());
    document.getElementById('btnExportSql')?.addEventListener('click', () => this.downloadSqlData());
    document.getElementById('btnExportJsModule')?.addEventListener('click', () => this.downloadJsModule());

    // About Modal
    document.getElementById('btnOpenAbout')?.addEventListener('click', () => {
      document.getElementById('modalAbout')?.classList.add('active');
    });

    // Language switcher
    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => this.setLanguage(btn.getAttribute('data-lang')));
    });

    // Modal closers
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
      });
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tabName}`);
    });
  }

  renderWilayasGrid() {
    const grid = document.getElementById('wilayasGrid');
    if (!grid) return;
    grid.innerHTML = '';

    let list = searchWilayas(this.searchQuery, this.currentLang);
    if (this.selectedRegion !== 'all') {
      list = list.filter(w => w.region === this.selectedRegion);
    }

    const t = I18N[this.currentLang];
    document.getElementById('wilayasCountBadge').textContent = `${list.length} / 58`;

    list.forEach(w => {
      const card = document.createElement('div');
      card.className = 'wilaya-card';
      const name = this.currentLang === 'fr' ? w.nameFr : w.nameAr;
      const subName = this.currentLang === 'fr' ? w.nameAr : w.nameFr;

      card.innerHTML = `
        <div class="wilaya-card-header">
          <span class="wilaya-code-badge">${w.code}</span>
          <div class="wilaya-names">
            <h4>${name}</h4>
            <span class="wilaya-subname">${subName}</span>
          </div>
          <span class="wilaya-region-badge">${w.region}</span>
        </div>
        <div class="wilaya-card-body">
          <div class="wilaya-meta-item">
            <span>${t.phoneCode}</span>
            <strong>${w.phoneCode}</strong>
          </div>
          <div class="wilaya-meta-item">
            <span>${t.postalPrefix}</span>
            <strong>${w.postalCode}</strong>
          </div>
          <div class="wilaya-meta-item">
            <span>${t.matricule}</span>
            <strong>${w.matricule}</strong>
          </div>
          <div class="wilaya-meta-item">
            <span>${t.communesCount}</span>
            <strong>${w.communes.length}</strong>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        this.openWilayaDetails(w);
      });

      grid.appendChild(card);
    });
  }

  openWilayaDetails(w) {
    this.selectedWilaya = w;
    const modal = document.getElementById('modalWilayaDetails');
    if (!modal) return;

    document.getElementById('detailWilayaTitle').textContent = `${w.code} - ${w.nameAr} (${w.nameFr})`;
    document.getElementById('detailWilayaCapital').textContent = w.capital;
    document.getElementById('detailWilayaPostal').textContent = w.postalCode;
    document.getElementById('detailWilayaPhone').textContent = w.phoneCode;
    document.getElementById('detailWilayaMatricule').textContent = w.matricule;
    document.getElementById('detailWilayaRegion').textContent = w.region;

    const communesList = document.getElementById('detailCommunesList');
    communesList.innerHTML = '';
    w.communes.forEach(c => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${c.nameAr}</strong></td>
        <td>${c.nameFr}</td>
        <td><code>${c.postalCode}</code></td>
      `;
      communesList.appendChild(row);
    });

    modal.classList.add('active');
  }

  // Export Data Handlers
  downloadJsonData() {
    const blob = new Blob([JSON.stringify(ALGERIA_WILAYAS, null, 2)], { type: 'application/json' });
    this.downloadFile(blob, 'algeria-58-wilayas.json');
  }

  downloadCsvData() {
    let csv = 'code,name_ar,name_fr,capital,postal_code,phone_code,matricule,region,communes_count\r\n';
    ALGERIA_WILAYAS.forEach(w => {
      csv += `"${w.code}","${w.nameAr}","${w.nameFr}","${w.capital}","${w.postalCode}","${w.phoneCode}","${w.matricule}","${w.region}",${w.communes.length}\r\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    this.downloadFile(blob, 'algeria-58-wilayas.csv');
  }

  downloadSqlData() {
    let sql = `-- Algerian Administrative Geography (58 Wilayas Table)\n`;
    sql += `CREATE TABLE IF NOT EXISTS wilayas (\n  code VARCHAR(2) PRIMARY KEY,\n  name_ar VARCHAR(100) NOT NULL,\n  name_fr VARCHAR(100) NOT NULL,\n  capital VARCHAR(100),\n  postal_code VARCHAR(5),\n  phone_code VARCHAR(4),\n  matricule VARCHAR(2),\n  region VARCHAR(20)\n);\n\n`;
    sql += `INSERT INTO wilayas (code, name_ar, name_fr, capital, postal_code, phone_code, matricule, region) VALUES\n`;
    const rows = ALGERIA_WILAYAS.map(w => {
      return `('${w.code}', '${w.nameAr.replace(/'/g, "''")}', '${w.nameFr.replace(/'/g, "''")}', '${w.capital}', '${w.postalCode}', '${w.phoneCode}', '${w.matricule}', '${w.region}')`;
    });
    sql += rows.join(',\n') + ';\n';
    const blob = new Blob([sql], { type: 'application/sql;charset=utf-8' });
    this.downloadFile(blob, 'algeria-58-wilayas.sql');
  }

  downloadJsModule() {
    const content = `/**\n * Algeria 58 Wilayas ES Module\n */\nexport const WILAYAS = ${JSON.stringify(ALGERIA_WILAYAS, null, 2)};\n`;
    const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
    this.downloadFile(blob, 'algeria-wilayas.js');
  }

  // Tab 2: Fiscal & Banking Validators Binding
  initValidators() {
    // NIF
    const nifInput = document.getElementById('inputNif');
    const nifResult = document.getElementById('resultNif');
    nifInput?.addEventListener('input', () => {
      const res = validateNif(nifInput.value);
      this.renderValidationResult(nifResult, res);
    });

    // NIS
    const nisInput = document.getElementById('inputNis');
    const nisResult = document.getElementById('resultNis');
    nisInput?.addEventListener('input', () => {
      const res = validateNis(nisInput.value);
      this.renderValidationResult(nisResult, res);
    });

    // RC
    const rcInput = document.getElementById('inputRc');
    const rcResult = document.getElementById('resultRc');
    rcInput?.addEventListener('input', () => {
      const res = validateRc(rcInput.value);
      this.renderValidationResult(rcResult, res);
    });

    // CCP Clé & RIP Generator
    const ccpInput = document.getElementById('inputCcp');
    const ccpResult = document.getElementById('resultCcp');
    ccpInput?.addEventListener('input', () => {
      const val = ccpInput.value.trim();
      if (!val) {
        ccpResult.innerHTML = '';
        return;
      }
      const key = calculateCcpKey(val);
      const ripObj = generatePostalRip(val, key);
      if (ripObj) {
        ccpResult.innerHTML = `
          <div class="val-box valid">
            <p><strong>مفتاح الحساب البريدي الجاري (Clé CCP):</strong> <span class="badge-key">${ripObj.key}</span></p>
            <p><strong>رقم الحساب الكامل (20 رقماً - RIP):</strong></p>
            <code class="code-rip">${ripObj.formatted}</code>
          </div>
        `;
      } else {
        ccpResult.innerHTML = `<div class="val-box invalid">يرجى كتابة رقم الحساب البريدي الجاري CCP بشكل صحيح (1-10 أرقام).</div>`;
      }
    });

    // Card (Edahabia / CIB)
    const cardInput = document.getElementById('inputCard');
    const cardResult = document.getElementById('resultCard');
    cardInput?.addEventListener('input', () => {
      const res = validatePaymentCard(cardInput.value);
      if (cardInput.value.trim().length === 0) {
        cardResult.innerHTML = '';
        return;
      }
      if (res.isValid) {
        cardResult.innerHTML = `
          <div class="val-box valid">
            <p><strong>نوع البطاقة والشبكة:</strong> <span style="color: ${res.badgeColor}; font-weight: bold;">${res.cardNetwork}</span></p>
            <p><strong>اختبار خوارزمية Luhn:</strong> <span class="badge-success">ناجح (صالح)</span></p>
            <p><strong>الرقم المنسق:</strong> <code>${res.formatted}</code></p>
          </div>
        `;
      } else {
        cardResult.innerHTML = `<div class="val-box invalid">${res.error || 'رقم البطاقة غير مطابق لخوارزمية Luhn.'}</div>`;
      }
    });
  }

  renderValidationResult(container, res) {
    if (!container) return;
    if (res.isValid) {
      container.innerHTML = `
        <div class="val-box valid">
          <p><strong>الحالة:</strong> <span class="badge-success">صحيح ومطابق للمواصفات</span></p>
          <p><strong>التنسيق:</strong> <code>${res.formatted}</code></p>
          ${res.category ? `<p><strong>الفئة:</strong> ${res.category}</p>` : ''}
          ${res.wilayaCode ? `<p><strong>رمز الولاية:</strong> ${res.wilayaCode}</p>` : ''}
        </div>
      `;
    } else {
      container.innerHTML = `<div class="val-box invalid">${res.error}</div>`;
    }
  }

  // Tab 3: Algerian Phone Inspector
  initPhoneInspector() {
    const phoneInput = document.getElementById('inputPhone');
    const phoneResult = document.getElementById('resultPhone');
    phoneInput?.addEventListener('input', () => {
      const val = phoneInput.value.trim();
      if (!val) {
        phoneResult.innerHTML = '';
        return;
      }
      const res = validateAlgerianPhone(val);
      if (res.isValid) {
        phoneResult.innerHTML = `
          <div class="val-box valid">
            <p><strong>المتعامل / المشغل:</strong> <span style="color: ${res.color}; font-weight: bold;">${res.operator}</span></p>
            <p><strong>الصيغة الوطنية:</strong> <code>${res.nationalFormat}</code></p>
            <p><strong>الصيغة الدولية (E.164):</strong> <code>${res.internationalFormat}</code></p>
          </div>
        `;
      } else {
        phoneResult.innerHTML = `<div class="val-box invalid">${res.error}</div>`;
      }
    });
  }

  // Tab 4: Tafqit Sandbox
  initTafqitSandbox() {
    const amountInput = document.getElementById('inputTafqitAmount');
    const arOutput = document.getElementById('outputTafqitAr');
    const frOutput = document.getElementById('outputTafqitFr');

    const update = () => {
      const val = parseFloat(amountInput?.value) || 0;
      if (arOutput) arOutput.textContent = tafqitArabic(val);
      if (frOutput) frOutput.textContent = tafqitFrench(val);
    };

    amountInput?.addEventListener('input', update);
    update();
  }

  // Tab 5: Code Snippets Copying
  initSnippets() {
    document.querySelectorAll('.btn-copy-code').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const codeEl = document.getElementById(targetId);
        if (codeEl) {
          navigator.clipboard.writeText(codeEl.innerText).then(() => {
            const originalText = btn.textContent;
            btn.textContent = 'تم النسخ!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);
          });
        }
      });
    });
  }

  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  setLanguage(lang) {
    if (!I18N[lang]) return;
    this.currentLang = lang;
    localStorage.setItem('dz_devtools_lang', lang);
    this.applyLanguage(lang);
    this.renderWilayasGrid();
  }

  applyLanguage(lang) {
    const t = I18N[lang];
    const isAr = lang === 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', isAr ? 'rtl' : 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.setAttribute('placeholder', t[key]);
    });

    document.querySelectorAll('[data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
  }
}

// Global App Instance
window.dzDevToolsApp = new DZDevToolsApp();
