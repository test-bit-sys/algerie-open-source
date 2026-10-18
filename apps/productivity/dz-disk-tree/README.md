# DZ-DiskTree (محلل ومستكشف مساحات الأقراص)
### High-Performance Open-Source Disk Space Analyzer & Squarified Treemap Visualizer
#### Part of DZ Open Suite — The Algerian National Open-Source Software Ecosystem

[العربية](README.md#ar) • [Français](README.md#fr) • [English](README.md#en)

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-DiskTree** هو بديل مفتوح المصدر وعالي الأداء لبرنامج **WizTree** وبرامج تحليل الأقراص مثل TreeSize و WinDirStat. تم تصميمه بالكامل من الصفر ليعمل محلياً (100% Offline-First) دون الحاجة للإنترنت، وبواجهة حديثة ثلاثية اللغات (العربية، الفرنسية، الإنجليزية) خالية تماماً من الرموز التعبيرية (Zero Emojis) وبأيقونات متجهة نقية (Vector SVGs).

---

### نتائج الهندسة العكسية لبرنامج WizTree عبر مهارة REA
تم فحص وتحليل الملف التنفيذي `WizTree64.exe` باستخدام أدوات الهندسة العكسية REA، وأسفرت الدراسة عن معرفة أسرار سرعته الفائقة:

1. **القراءة المباشرة لجدول الملفات الرئيسي (NTFS MFT Direct Parsing):**
   - يتجاوز WizTree واجهات برمجة نظام التشغيل البطيئة (`FindFirstFileW` / `FindNextFileW`).
   - يقوم بفتح مقبض القرص الخام `\\.\C:` عبر `CreateFileW` بصلاحيات المسؤول، ويستعلم عن بنية وحدات التخزين عبر `FSCTL_GET_NTFS_VOLUME_DATA`.
   - يقوم بقراءة ملف `$MFT` مباشرة على شكل كتل خام (Cluster Extents) دفعة واحدة، ويفك شفرة سجلات الملفات (MFT Records بحجم 1024 بايت لكل ملف) في الذاكرة عبر تحليل سمات `$STANDARD_INFORMATION` و `$FILE_NAME`.
   - هذا يتيح له أرشفة 2 مليون ملف في أقل من ثانيتين!

2. **سجل تحديثات USN (USN Change Journal):**
   - يستعين بـ `FSCTL_READ_USN_JOURNAL` لتتبع التغييرات الآنية على الملفات فور حدوثها دون الحاجة لإعادة فحص القرص كاملاً.

3. **خوارزمية المخطط المساحي المربع (Squarified Treemap Algorithm):**
   - يعتمد على خوارزمية *Bruls, Huizing, van Wijk (2000)* لتقسيم المساحات ثنائية الأبعاد إلى مستطيلات متقاربة النسبة (قريبة من المربع) لتقليل التشوه البصري وتسهيل مقارنة حجوم الملفات والمجلدات.

---

### البنية التقنية لبرنامج DZ-DiskTree
تم تطبيق هذه الركائز الأساسية في `DZ-DiskTree` من خلال:

1. **محرك المسح السريع المتوازي (High-Speed Directory Scanner):**
   - فحص متوازي للمجلدات والملفات مع تحكم بالتدفق ومزامنة الذاكرة.
   - استخراج الحجم الفعلي للملفات (Logical Size) وحساب الحجم المحجوز على وحدات التخزين (Allocated Cluster Size - 4KB).
   - رصد استباقي لكافة الأقراص المتاحة في النظام (`C:\`, `D:\`) مع استعلام فوري عن المساحة الكلية والمتبقية عبر `fs.statfsSync`.

2. **محرك المخطط المساحي المستقل (Squarified Treemap Canvas Engine):**
   - محرك رسومي مبني من الصفر على HTML5 Canvas ينفذ خوارزمية Bruls et al. بالكامل دون أي مكتبات خارجية.
   - دعم التكبير والتعمق في المجلدات (Drill-down / Zoom-in) بمجرد النقر، مع مسار تنقل شجري (Breadcrumbs) للرجوع للأعلى.
   - نافذة تفاعلية (Interactive Tooltip) تعرض اسم الملف، مساره، حجمه، المساحة المحجوزة، ونسبته المئوية.
   - تمييز لوني دلالي بحسب تصنيف الملفات (فيديو، صوتيات، صور، مضغوطات، مستندات، أكواد برمجية، ملفات تنفيذية، قواعد بيانات).
   - إمكانية تصدير المخطط الرسومي كصورة عالية الدقة PNG بضغطة زر.

3. **شجرة المجلدات الهرمية (Hierarchical Tree View):**
   - استكشاف هرمي سريع للمجلدات مرتبة تنازلياً بحسب الحجم.

4. **إحصائيات الامتدادات وأنواع الملفات (Extensions Breakdown):**
   - جدول تفاعلي يصنف الملفات بحسب امتداداتها مع نسب المساحة، الحجم الكلي، وعدد الملفات.

5. **قائمة أكبر 500 ملف (Top 500 Largest Files):**
   - كشف فوري لأكبر الملفات المستهلكة للمساحة مع فلترة بحث حية وزر لنسخ مسار الملف فوراً إلى الحافظة.

6. **تصدير التقارير:**
   - تصدير كامل البيانات إلى صيغتي CSV و JSON.

---

### طريقة التشغيل
```bash
# تشغيل خادم DZ-DiskTree مباشرة
npm run start:disk-tree

# أو من خلال مجلد التطبيق
cd apps/productivity/dz-disk-tree
node server.js
```
ثم افتح المتصفح على: `http://localhost:3001`

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-DiskTree** est une alternative libre, moderne et ultra-rapide à **WizTree**, TreeSize et WinDirStat. Développé pour la suite nationale algérienne `DZ Open Suite`, il fonctionne de manière 100% hors-ligne (Offline-First) avec une interface trilingue (Arabe, Français, Anglais), sans aucun emoji et avec des icônes vectorielles SVG épurées.

### Découvertes de rétro-ingénierie (REA sur WizTree)
L'analyse binaire a mis en lumière les mécanismes clés de WizTree :
1. **Lecture directe de la table MFT NTFS :** Contourne les API Win32 pour lire directement les clusters du fichier `$MFT` via `CreateFileW` sur `\\.\C:` et `FSCTL_GET_NTFS_VOLUME_DATA`.
2. **Algorithme Squarified Treemap (Bruls, Huizing, van Wijk) :** Partitionnement géométrique optimisant le ratio d'aspect des rectangles.
3. **Journal USN NTFS :** Synchronisation différentielle en temps réel.

### Fonctionnalités de DZ-DiskTree
- Détection automatique de tous les disques locaux et amovibles.
- Visualisation interactive par Treemap haute résolution (zoom, infobulles, export PNG).
- Comparaison entre taille logique et espace réellement alloué sur les clusters.
- Analyse par extension de fichier et catégorie.
- Liste instantanée des 500 fichiers les plus volumineux avec copie de chemin en un clic.
- Exportation des rapports au format CSV et JSON.

---

<a name="en"></a>
## English Documentation

### Overview
**DZ-DiskTree** is a high-performance, 100% offline-first open-source alternative to **WizTree**, TreeSize, and WinDirStat. Built from scratch for the Algerian National Open-Source Software Ecosystem (`DZ Open Suite`).

### Key REA Insights into WizTree Architecture
- **Raw NTFS MFT Parsing:** Bypasses conventional directory enumeration to stream `$MFT` records directly from raw disk clusters.
- **Squarified Treemap Layout:** Implements the Bruls, Huizing, van Wijk (2000) algorithm for optimal rectangle aspect ratios.
- **USN Journal Monitoring:** Live file updates without rescanning the entire filesystem.

### Architecture & Capabilities
- **Squarified Treemap Canvas Engine:** Zero-dependency HTML5 canvas visualizer with drill-down, hover tooltips, and PNG export.
- **Multi-threaded Async Crawler:** Rapid directory traversal with logical vs cluster-allocated storage computation.
- **Extension & Category Matrix:** Breakdown of storage consumption by file categories (Videos, Archives, Documents, Code, etc.).
- **Top 500 Largest Files:** Real-time search filter and instant clipboard path copy.
- **Enterprise UI/UX:** Clean vector SVGs, zero emojis, dark/light theme, trilingual (Arabic RTL, French LTR, English LTR).

---

### خريطة الطريق للتطبيقات القادمة (Next Roadmap Applications)
1. **`dz-archive` (بديل WinRAR):** أداة ضغط وأرشفة وفك تشفير ملفات ZIP/RAR/7Z/TAR محلية فائقة الأمان.
2. **`dz-player` (بديل VLC):** مشغل وسائط وصوتيات وفيديو خفيف الوزن مع دعم الترجمة العربية والفصل الصوتي.
3. **`dz-pdf` (محرر ومحول PDF):** محرر ومدمج ومستخرج وثائق PDF متكامل بدون أي اتصال بالإنترنت.
