<div align="center">

# DZ-Disk-Tree
### High-Performance Open-Source Disk Space Analyzer & Squarified Treemap Visualizer
**1:1 Desktop Alternative to WizTree & TreeSize • 100% Offline-First • Zero Dependencies**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](../../../LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#technical-architecture)
[![Port: 3001](https://img.shields.io/badge/Port-3001-0284c7.svg?style=for-the-badge)](#running-dz-disk-tree)
[![Zero Emojis](https://img.shields.io/badge/UI-Zero_Emojis_%7C_Pure_SVG-dc2626.svg?style=for-the-badge)](#design-system)

<p align="center">
  <a href="#ar"><b>العربية</b></a> •
  <a href="#en"><b>English</b></a> •
  <a href="#fr"><b>Français</b></a>
</p>

</div>

---

<a name="en"></a>
## English Documentation

### Overview
**DZ-Disk-Tree** is a high-speed, zero-dependency, 100% offline-first desktop alternative to **WizTree**, TreeSize, and WinDirStat. Built from scratch for the Algerian National Open-Source Ecosystem (`DZ Open Suite`), it follows the **HeyPuter/everything** architectural standard: pure Vanilla JavaScript ES Modules, HTML5 Canvas, modern CSS, native bi-directionality, and zero bloated frameworks.

### Key Reverse Engineering (REA) Insights
During the binary reverse-engineering analysis of `WizTree64.exe` using REA tools:
1. **Direct NTFS MFT Extraction**: WizTree achieves its speed by opening the raw volume handle `\\.\C:` via `CreateFileW` with admin privileges, reading `$MFT` clusters directly through `FSCTL_GET_NTFS_VOLUME_DATA`, bypassing slow standard Win32 directory recursion.
2. **Squarified Treemap Partitioning**: Implements the *Bruls, Huizing, van Wijk (2000)* algorithm to minimize rectangle aspect ratio distortion, making comparisons immediately scannable.
3. **Cushioned 3D Shading**: Applies quadratic height curves across hierarchical boundaries to produce subtle 3D ridge illumination, preventing visual nesting confusion.

### Production Features
- **Synchronized Split Desktop Window**: Multi-column hierarchical tree grid on top and squarified cushioned treemap on the bottom with a live draggable resizer.
- **Bidirectional Linking**: Selecting any folder in the tree grid focuses and zooms the treemap; clicking any visual rectangle selects the corresponding row in the tree.
- **Multi-Column Sorting**: Sort by Name, % of Parent, Logical Size, Allocated Cluster Size (4KB boundary), Files, Folders, and Modified Date with ascending/descending visual carets.
- **Full Keyboard Navigation**: Move seamlessly through folder hierarchies with `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, and `Backspace`.
- **Executive Printable Audit Report**: Generate an executive printable HTML audit document with embedded canvas treemap snapshot and breakdown tables.
- **Export Options**: Export directory scans to CSV and JSON or save the current treemap as a high-resolution PNG image.

### Running DZ-Disk-Tree
```bash
# Launch from repository root
npm run start:disk-tree

# Or run directly from app directory
cd apps/productivity/dz-disk-tree
node server.js
```
Open **[http://localhost:3001](http://localhost:3001)** in your browser.

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-Disk-Tree** هو بديل مفتوح المصدر وعالي الأداء لبرنامج **WizTree** وبرامج فحص الأقراص مثل TreeSize و WinDirStat. صُمم وطُوّر بالكامل ليعمل محلياً بنسبة 100% دون أي اتصال خارجي بالإنترنت (Offline-First)، وبواجهة سطح مكتب احترافية ثلاثية اللغات (العربية RTL افتراضياً، الفرنسية، والإنجليزية)، خالية تماماً من الرموز التعبيرية وبأيقونات متجهة نقية (Vector SVGs).

### خصائص البرنامج المكتملة 1:1
1. **شاشة العرض المزدوجة المتزامنة (Split-Window)**: مطابقة تامة لتصميم WizTree الأصلي؛ شبكة شجرية متعددة الأعمدة في الأعلى وخريطة مساحية بارزة ومظللة مجسمة (**Cushioned Treemap Canvas**) في الأسفل مع مقسم سحب مباشر.
2. **تحديد ثنائي الاتجاه اللحظي**: النقر على أي مجلد في الشجرة يسلط الضوء فوراً على كتلته في الخريطة؛ والنقر على أي كتلة مرئية يحدد موقعها مباشرة في الجدول.
3. **فرز الأعمدة التفاعلي**: فرز حسب الاسم، نسبة الحجم، الحجم الفعلي، الحجم المحجوز على كتل التخزين (Allocated Cluster Space)، عدد الملفات والمجلدات، وتاريخ التعديل.
4. **تنقل كامل عبر الأسهم بلوحة المفاتيح**: دعم كامل للأسهم (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Backspace`).
5. **تقرير تدقيق تنفيذي رسمي قابل للطباعة**: توليد تقرير تدقيق HTML احترافي يتضمن لقطة مدمجة للخريطة وجداول تفصيلية لأكبر الملفات استهلاكاً للمساحة.
6. **تصدير كامل للبيانات**: تصدير الفحص بصيغتي CSV و JSON وحفظ المخطط كصورة PNG عالية الدقة.

### التشغيل المباشر
```bash
npm run start:disk-tree
```
افتح المتصفح على: **[http://localhost:3001](http://localhost:3001)**

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-Disk-Tree** est une alternative libre, moderne et ultra-rapide à **WizTree** et TreeSize. Développé pour la suite nationale `DZ Open Suite`, il fonctionne de manière 100% hors-ligne (Offline-First) avec une interface trilingue (Arabe, Français, Anglais), sans aucun emoji et avec des icônes vectorielles SVG épurées.

### Fonctionnalités Clés
- **Affichage Découpé Synchronisé (Split View)** : Arborescence hiérarchique en haut et Treemap biseauté en bas avec séparateur redimensionnable par glisser-déposer.
- **Liaison Bidirectionnelle** : Sélection synchronisée entre le tableau arborescent et la carte géométrique.
- **Tri Multicolonne** : Tri par Nom, % Espace parent, Taille réelle, Espace alloué sur clusters, Nombre de fichiers et Date.
- **Navigation Complète au Clavier** : Prise en charge native des touches fléchées.
- **Rapport d'Audit Imprimable** : Génération d'un document d'audit HTML exécutif avec capture treemap intégrée.
- **Exportations Multiples** : Export des données en CSV, JSON et capture PNG haute résolution.

### Lancement
```bash
npm run start:disk-tree
```
Disponible sur : **[http://localhost:3001](http://localhost:3001)**
