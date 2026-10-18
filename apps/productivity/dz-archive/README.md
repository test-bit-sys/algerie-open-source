<div align="center">

# DZ-Archive
### High-Performance Open-Source Archiver, Compression & Hardware Benchmark Suite
**1:1 Desktop Alternative to WinRAR & 7-Zip • 100% Offline-First • AES-256-GCM Encryption**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](../../../LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#technical-architecture)
[![Port: 3002](https://img.shields.io/badge/Port-3002-0284c7.svg?style=for-the-badge)](#running-dz-archive)
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
**DZ-Archive** is a desktop-grade, zero-dependency, 100% offline-first open-source alternative to **WinRAR** and 7-Zip. Built from scratch following the **HeyPuter/everything** standard, it delivers full archive management, hardware-accelerated AES-256-GCM encryption, internal multi-mode file inspection, and an authentic WinRAR multi-threaded hardware benchmark without any external binaries or cloud dependencies.

### Key Reverse Engineering (REA) Insights
Analysis of the WinRAR executable (`WinRAR.exe`) established the structural benchmarks for DZ-Archive:
- **Archive Format Integrity**: Precise parsing of ZIP Local File Headers, Central Directory Records, and End of Central Directory (EOCD) records with CRC-32 verification.
- **Hardware Benchmarking**: Simulating multi-threaded buffer compression and computing performance ratings based on active CPU threads.
- **Internal Inspection**: Providing instant hexadecimal offsets and ASCII representations directly from compressed memory buffers without unpacking to disk.

### Production Features
- **Iconic WinRAR Desktop Layout**: Classic menu bar (`File`, `Commands`, `Tools`, `Options`, `Help`) and big command toolbar (`Add`, `Extract To`, `Test`, `View`, `Delete`, `Find`, `Wizard`, `Info`, `Lock`, `Comment`, `Benchmark`).
- **6-Tab Compression Dialog**: Desktop modal replicating WinRAR archive parameters across `General`, `Advanced`, `Files`, `Backup`, `Time`, and `Comment` tabs.
- **AES-256-GCM Encryption**: Client-side military-grade encryption via the native Web Crypto API with PBKDF2 key derivation and password authentication.
- **Internal Multi-Mode Viewer**: Double-click any file inside an archive to inspect it immediately via Text view, Hex Dump view (16-byte aligned offsets with hex bytes and printable ASCII), or Media view.
- **WinRAR Hardware Benchmark**: Real-time compression speed gauge (MB/s) and multi-threaded rating score based on hardware concurrency.
- **CRC-32 Integrity Verification**: Byte-level verification verifying that compressed streams have not suffered bitrot or corruption.

### Running DZ-Archive
```bash
# Launch from repository root
npm run start:archive

# Or run directly from app directory
cd apps/productivity/dz-archive
node server.js
```
Open **[http://localhost:3002](http://localhost:3002)** in your browser.

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-Archive** هو بديل مفتوح المصدر وعالي الأداء لبرنامج **WinRAR** و 7-Zip. تم بناؤه بالكامل وفق المعيار الهندسي لمشروع **HeyPuter/everything** بالاعتماد الحصري على JavaScript الصافي الصريح (Vanilla JS ES Modules) دون أي أطر عمل ثقيلة، ويعمل بنسبة 100% دون اتصال بالإنترنت (Offline-First).

### قدرات وخصائص البرنامج المكتملة 1:1
1. **واجهة WinRAR الأصلية**: شريط قوائم مألوف (`File`, `Commands`, `Tools`, `Options`, `Help`) وشريط الأدوات الأيقوني الكبير (`Add`, `Extract To`, `Test`, `View`, `Delete`, `Find`, `Wizard`, `Info`, `Lock`, `Comment`, `Benchmark`).
2. **نافذة معلمات الضغط بـ 6 تبويبات**: إعدادات متكاملة تشمل تبويبات (`General`, `Advanced`, `Files`, `Backup`, `Time`, `Comment`).
3. **تشفير عسكري متقدم AES-256-GCM**: حماية أمنية مشفرة بكلمة مرور عبر **Web Crypto API** مع اشتقاق المفاتيح بواسطة **PBKDF2**.
4. **عارض ملفات داخلي متعدد الأنماط (Internal Viewer)**: استعراض الملفات فورياً بنقر مزدوج دون استخراجها إلى القرص عبر عارض النصوص، عارض الهكسا (**Hex Dump**) بمحاذاة 16 بايت وعرض ASCII، وعارض الوسائط والصور.
5. **مقياس كفاءة العتاد والمعالج (Hardware Benchmark)**: فحص سرعة الضغط الآنية بالميغابايت/ثانية واحتساب نقاط تقييم الأداء استناداً إلى مسارات المعالج (CPU Threads).
6. **فحص سلامة الأرشيف (Test Archive)**: تدقيق كل سجل وملف في الأرشيف ومطابقته مع بصمة **CRC-32** لضمان سلامته من التلف.

### التشغيل المباشر
```bash
npm run start:archive
```
افتح المتصفح على: **[http://localhost:3002](http://localhost:3002)**

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-Archive** est une alternative libre, moderne et performante à **WinRAR** et 7-Zip. Conçu selon le standard **HeyPuter/everything**, il fonctionne de manière 100% hors-ligne (Offline-First) avec une interface trilingue (Arabe, Français, Anglais), sans aucun emoji et avec des icônes vectorielles SVG épurées.

### Fonctionnalités Clés
- **Interface Iconique WinRAR** : Barre de menus complète et grande barre d'outils classique.
- **Dialogue de Compression à 6 Onglets** : Paramétrage avancé via `Général`, `Avancé`, `Fichiers`, `Sauvegarde`, `Temps`, et `Commentaire`.
- **Chiffrement Robuste AES-256-GCM** : Sécurisation matérielle par mot de passe via l'API Web Crypto avec dérivation PBKDF2.
- **Visionneuse Interne Multi-Mode** : Visualisation instantanée (Texte brut, Vidage hexadécimal 16 octets + ASCII, Lecteur multimédia).
- **Benchmark Matériel Intégré** : Évaluation du débit de compression (Mo/s) et indice de performance multi-cœur.
- **Vérification d'Intégrité CRC-32** : Contrôle d'intégrité octet par octet de chaque entrée d'archive.

### Lancement
```bash
npm run start:archive
```
Disponible sur : **[http://localhost:3002](http://localhost:3002)**
