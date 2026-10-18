# DZ-Archive (بديل WinRAR المفتوح المصدر)
### High-Performance Open-Source Archiver, Compression & Benchmark Suite
#### Built following the [HeyPuter/everything](https://github.com/HeyPuter/everything) architecture standard
#### Part of DZ Open Suite — The Algerian National Open-Source Software Ecosystem

[العربية](README.md#ar) • [Français](README.md#fr) • [English](README.md#en)

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-Archive** هو بديل مفتوح المصدر وعالي الأداء لبرنامج **WinRAR** و 7-Zip. تم بناؤه بالكامل وفق المعيار الهندسي المعتمد في مشروع **HeyPuter/everything**:
- **جافاسكربت المعيارية النقية (Vanilla JavaScript ES Modules):** بدون أطر عمل ثقيلة (Zero React/Vue bloat).
- **HTML5 و CSS3 المعاصر:** واجهة أنيقة بالوضع الليلي/النهاري، خالية تماماً 100% من الرموز التعبيرية (Zero Emojis)، وبأيقونات متجهة SVG نقية.
- **محلي ومستقل 100% (Offline-First):** يعمل بالكامل في المتصفح وسطح المكتب دون الحاجة لأي اتصال بالإنترنت أو خوادم خلفية.
- **ثلاثي اللغات:** العربية (افتراضي RTL)، الفرنسية، والإنجليزية.

---

### نتائج الهندسة العكسية لبرنامج WinRAR عبر مهارة REA
تم تحليل وفحص الملف التنفيذي `C:\Program Files\WinRAR\WinRAR.exe` عبر أدوات الهندسة العكسية REA لاستخلاص بنيته:
- **المعمارية:** `PE32+ x86_64`، تشفير وسلامة البيانات عبر `CRC32` و `BLAKE2sp` و `SHA256`.
- **الميزات الأساسية المستخلصة:**
  1. ضغط وفك حزم `ZIP` و `TAR` و `GZ` محلياً.
  2. فحص سلامة الأرشيف (Integrity Test) عبر التحقق الدقيق من توافق بصمات CRC-32 لكل ملف.
  3. أداة قياس سرعة العتاد والمعالج (WinRAR Hardware Benchmark) التي تقيس معدل الضغط والترميز بـ KB/s وتحسب تقييماً رقمياً للأداء.
  4. المعاينة السريعة للملفات (Preview) دون الحاجة لاستخراجها إلى القرص أولاً.

---

### قدرات وميزات برنامج DZ-Archive
1. **إنشاء الأرشيفات المضغوطة (Create Archives):**
   - إنشاء ملفات `.zip` و `.tar` متوافقة قياسياً مع أنظمة Windows و Linux و macOS.
   - خيارات متعددة لمستوى الضغط (Store بدون ضغط، Normal Deflate).
2. **استعراض واستخراج الملفات (Extract & Browse):**
   - فتح واستعراض ملفات ZIP و TAR بسحبها وإفلاتها مباشرة في الواجهة.
   - استخراج وتنزيل الأرشيف بالكامل أو ملفات محددة.
3. **معاينة الملفات الفورية (In-Archive File Preview):**
   - فتح ومعاينة الصور والملفات النصية والأكواد البرمجية مباشرة من داخل الأرشيف بالنقر المزدوج دون فك ضغطها إلى مساحة التخزين.
4. **أداة قياس أداء المعالج والضغط (WinRAR Benchmark):**
   - محاكاة دقيقة لاختبار أداء WinRAR؛ تقوم بتوليد كتل بيانات اختبارية وقياس سرعة معالجة وضغط الـ Deflate و CRC-32 وحساب تقييم رقمي بحسب عدد مسارات المعالج (CPU Threads).
5. **فحص سلامة الأرشيف (Test Archive):**
   - تدقيق كل سجل وملف في الأرشيف ومطابقته مع الـ CRC-32 المرفق لضمان سلامته من التلف.

---

### طريقة التشغيل والتطوير (معيار HeyPuter / Vite)
```bash
# الانتقال لمجلد التطبيق
cd apps/productivity/dz-archive

# تشغيل خادم التطوير عبر Vite
npm run dev
```

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-Archive** est une alternative libre, moderne et ultra-rapide à **WinRAR** et 7-Zip, développée selon l'architecture de référence de **HeyPuter/everything** (Vanilla JavaScript moderne, CSS natif, 100% hors-ligne, zéro emoji, zéro dépendance réseau).

### Fonctionnalités
- Création et extraction d'archives standard **ZIP** et **POSIX TAR**.
- Algorithme de décompression et compression Deflate via Streams natifs.
- Outil de benchmark matériel WinRAR (test de vitesse de compression processeur en Ko/s avec score).
- Test d'intégrité de l'archive par validation des sommes de contrôle **CRC-32**.
- Prévisualisation instantanée des images, textes et code source sans extraction sur disque.
- Glisser-déposer intuitif, interface trilingue (Arabe, Français, Anglais) et thèmes Sombre/Clair.

---

<a name="en"></a>
## English Documentation

### Overview
**DZ-Archive** is a high-performance open-source alternative to **WinRAR** and 7-Zip, built according to the **HeyPuter/everything** architecture standard:
- Pure modern Vanilla JavaScript (ES Modules).
- Zero bloated UI frameworks; lightning-fast execution.
- 100% offline-first with zero external tracking or network calls.
- Trilingual UI (Arabic RTL, French LTR, English LTR), dark/light mode, zero emojis.

### Key Capabilities
- **ZIP & TAR Engine:** Full support for reading, creating, and modifying PKZIP and POSIX TAR archives.
- **Hardware Benchmark:** Built-in WinRAR-style compression speed test evaluating multi-threaded CPU throughput in KB/s with performance score.
- **Archive Integrity Test:** Deep CRC-32 checksum verification across all archive entries.
- **Instant Preview:** Read and view documents, source code, and images directly from memory without extracting to disk.
