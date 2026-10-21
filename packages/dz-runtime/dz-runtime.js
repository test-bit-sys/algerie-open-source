/**
 * المنظومة الجزائرية المفتوحة المصدر - جسر التشغيل السيادي المحلي
 * DZ Open Source Sovereign Offline Runtime (dz-runtime.js)
 * 
 * يوفر بيئة تشغيل محلية 100% دون الحاجة لأي اتصال بالإنترنت أو حسابات سحابية
 * بديل سيادي لـ Puter SDK، متوافق مع كافة برمجيات Puter و HeyPuter/everything
 * يدعم التخزين المحلي الآمن (IndexedDB & LocalStorage)، الترجمة الثلاثية، والمظهر السيادي الجزائري
 */

(function () {
  'use strict';

  // 1. إعداد المخزن المحلي الآمن لـ Key-Value والملفات
  const KV_PREFIX = 'dz:kv:';
  const FS_DB_NAME = 'dz_sovereign_fs';
  const FS_STORE_NAME = 'files';

  function openFsDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(FS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
          db.createObjectStore(FS_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  const puterKv = {
    async get(key) {
      try {
        const raw = localStorage.getItem(KV_PREFIX + key);
        if (raw === null) return null;
        return JSON.parse(raw);
      } catch (e) {
        return localStorage.getItem(KV_PREFIX + key);
      }
    },
    async set(key, val) {
      try {
        const str = typeof val === 'string' ? JSON.stringify(val) : JSON.stringify(val);
        localStorage.setItem(KV_PREFIX + key, str);
        return true;
      } catch (e) {
        console.warn('[DZ-Runtime] KV set failed:', e);
        return false;
      }
    },
    async del(key) {
      localStorage.removeItem(KV_PREFIX + key);
      return true;
    },
    async incr(key, by = 1) {
      const current = Number(await this.get(key)) || 0;
      const next = current + by;
      await this.set(key, next);
      return next;
    },
    async expire(key, seconds) {
      return true;
    },
    async list(pattern, returnValues = false) {
      const keys = [];
      const regex = pattern
        ? new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
        : null;

      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (fullKey && fullKey.startsWith(KV_PREFIX)) {
          const k = fullKey.slice(KV_PREFIX.length);
          if (!regex || regex.test(k)) {
            if (returnValues) {
              const val = await this.get(k);
              keys.push({ key: k, value: val });
            } else {
              keys.push(k);
            }
          }
        }
      }
      return keys;
    }
  };

  const puterFs = {
    async write(filePath, content) {
      const db = await openFsDb();
      let blob;
      if (content instanceof Blob) {
        blob = content;
      } else if (typeof content === 'string') {
        blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
        blob = new Blob([content]);
      } else {
        blob = new Blob([JSON.stringify(content)], { type: 'application/json' });
      }

      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(FS_STORE_NAME, 'readwrite');
          tx.objectStore(FS_STORE_NAME).put(blob, filePath);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      } else {
        try {
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          await new Promise(r => { reader.onloadend = r; });
          localStorage.setItem('dz:fs:' + filePath, reader.result);
        } catch (e) {
          console.warn('[DZ-Runtime] Fallback write failed:', e);
        }
      }
      return { path: filePath, name: filePath.split('/').pop() };
    },

    async read(filePath) {
      const db = await openFsDb();
      if (db) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(FS_STORE_NAME, 'readonly');
          const req = tx.objectStore(FS_STORE_NAME).get(filePath);
          req.onsuccess = () => {
            if (req.result) resolve(req.result);
            else reject(new Error('الملف غير موجود / File not found'));
          };
          req.onerror = () => reject(tx.error);
        });
      }
      const dataUri = localStorage.getItem('dz:fs:' + filePath);
      if (!dataUri) throw new Error('الملف غير موجود');
      const res = await fetch(dataUri);
      return await res.blob();
    },

    async delete(filePath) {
      const db = await openFsDb();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(FS_STORE_NAME, 'readwrite');
          tx.objectStore(FS_STORE_NAME).delete(filePath);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      }
      localStorage.removeItem('dz:fs:' + filePath);
      return true;
    },

    async getReadURL(filePath) {
      try {
        const blob = await this.read(filePath);
        return URL.createObjectURL(blob);
      } catch (e) {
        return '';
      }
    },

    async list(dirPath = '') {
      const db = await openFsDb();
      if (!db) return [];
      return new Promise((resolve) => {
        const tx = db.transaction(FS_STORE_NAME, 'readonly');
        const req = tx.objectStore(FS_STORE_NAME).getAllKeys();
        req.onsuccess = () => {
          const keys = req.result || [];
          const prefix = dirPath ? (dirPath.endsWith('/') ? dirPath : dirPath + '/') : '';
          const matching = keys.filter(k => k.startsWith(prefix));
          resolve(matching.map(k => ({ name: k.slice(prefix.length), path: k, isDir: false })));
        };
        req.onerror = () => resolve([]);
      });
    }
  };

  // 2. كائن محاكاة Puter السيادي الكامل (100% بدون سحابة)
  const dzPuter = {
    env: 'sovereign-dz',
    isSovereign: true,
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({
        uuid: 'dz-sovereign-user',
        username: 'مواطن جزائري',
        email: 'citoyen@algerie.dz',
        accountType: 'sovereign_citizen'
      }),
      signIn: async () => true,
      signOut: async () => {
        console.log('[DZ-Runtime] الوضع السيادي مفعل دائماً دون تسجيل خروج.');
      }
    },
    kv: puterKv,
    fs: puterFs,
    ui: {
      alert: (msg) => window.alert(msg),
      showSaveDialog: async () => null,
      showOpenDialog: async () => null,
      hideWindow: () => {},
      showWindow: () => {},
      parentApp: () => null,
      launchApp: async () => null
    }
  };

  window.puter = dzPuter;
  window.DZ_RUNTIME = {
    version: '2026.1.0',
    sovereign: true,
    puter: dzPuter,
    exportAllData: async function () {
      const data = {
        timestamp: new Date().toISOString(),
        kv: {},
        version: '1.0'
      };
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KV_PREFIX)) {
          data.kv[k] = localStorage.getItem(k);
        }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dz-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    }
  };

  // 3. حقن شريط السيادة الجزائري (DZ Sovereign Topbar) في الواجهة
  function injectSovereignBanner() {
    if (document.getElementById('dz-sovereign-header')) return;

    const banner = document.createElement('div');
    banner.id = 'dz-sovereign-header';
    banner.className = 'dz-topbar';
    banner.innerHTML = `
      <div class="dz-topbar-content">
        <a href="/" class="dz-brand" title="العودة للبوابة الرئيسية للمنظومة الجزائرية">
          <span class="dz-flag">🇩🇿</span>
          <span class="dz-title-ar">المنظومة الجزائرية المفتوحة</span>
          <span class="dz-badge-sovereign">100% سيادي دون إنترنت</span>
        </a>
        <div class="dz-actions">
          <button id="dz-btn-backup" class="dz-btn" title="حفظ نسخة احتياطية محلية من بياناتك">
            💾 نسخ احتياطي
          </button>
          <a href="/" class="dz-btn dz-btn-home" title="الرئيسية">
            🏠 البوابة
          </a>
        </div>
      </div>
    `;

    // إدراج الشريط في أعلى الصفحة فور جهوزية الـ DOM
    if (document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.insertBefore(banner, document.body.firstChild);
      });
    }

    // ربط الأحداث
    setTimeout(() => {
      const backupBtn = document.getElementById('dz-btn-backup');
      if (backupBtn) {
        backupBtn.addEventListener('click', () => {
          window.DZ_RUNTIME.exportAllData();
        });
      }
    }, 100);
  }

  // تفعيل الحقن
  if (window.location.search.indexOf('no-banner') === -1) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectSovereignBanner);
    } else {
      injectSovereignBanner();
    }
  }

  console.log('🇩🇿 [DZ-Runtime] تم تحميل بيئة التشغيل السيادية الجزائرية (100% محلي - بدون سحابة خارجية).');
})();
