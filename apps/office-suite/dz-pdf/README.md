<div align="center">

# DZ-PDF Pro
### High-Performance Open-Source PDF Editor, Administrative Stamping & Digital Signature Suite
**1:1 Desktop Alternative to Adobe Acrobat Pro • 100% Offline-First • Official Algerian Administrative Seals**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](../../../LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#technical-architecture)
[![Port: 3004](https://img.shields.io/badge/Port-3004-0284c7.svg?style=for-the-badge)](#running-dz-pdf-pro)
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
**DZ-PDF Pro** is a 100% offline-first, desktop-grade alternative to **Adobe Acrobat Pro**. Built according to the **HeyPuter/everything** architecture using native Vanilla JavaScript ES Modules, HTML5 Canvas, and pure client-side PDF 1.7 binary compilation, it empowers public administrations, businesses, and citizens to inspect, annotate, redact, reorder, stamp, and digitally sign PDF documents without sending sensitive data to external clouds.

### Key Reverse Engineering (REA) Insights
Analysis of Adobe Acrobat Pro workflows identified the essential capabilities reproduced in DZ-PDF Pro:
- **Direct PDF 1.7 Object Graph Compilation**: Binary generation of PDF catalogs, page tree dictionaries, font descriptors, content streams, and cross-reference tables (`xref`) directly in memory via `Uint8Array`.
- **Administrative Stamping & Seals**: Mathematically drawn vector seals and official Algerian stamps (Circular Republic Seal, Conforme à l'Original, Reçu le, Payé, Confidentiel) that composite seamlessly onto document matrices.
- **Redaction Security**: True graphical blackout rendering directly onto the underlying pixel grid to permanently obscure confidential data before PDF export.

### Production Features
- **Acrobat Command Palette**: Pointer tool (`V`), Hand pan tool (`H`), Freehand pen tool (`P`), Text highlighter (`U`), Typewriter text tool (`T`), Blackout redaction box tool (`R`), and Sticky note comments (`N`).
- **Official Algerian Administrative Stamps**:
  - **Circular Seal of the Republic**: Dual concentric borders with official Arabic and French republic banners (*الجمهورية الجزائرية الديمقراطية الشعبية / RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE*), national crescent and star, Wilaya selection (58 Wilayas), and date.
  - **Administrative Stamp Suite**: *Conforme à l'Original*, *Courrier Arrivé / Reçu le*, *Payé Intégralement*, *Strictement Confidentiel*, *Vu et Approuvé*, *Annulé*, and *Très Urgent*.
- **Certified Digital Signature Pad**: Velocity-sensitive vector signature pad with Bézier stroke smoothing, official ink colors (Diplomatic Blue, Bureau Black, Emerald Green, Violet), signatory metadata (Name, Role, Wilaya, Date), and verification code.
- **Dual View Modes**: Single Page Reader & Interactive Canvas Editor vs Organize Pages Grid (drag-and-drop reordering, 90° rotation, duplication, deletion, blank page insertion).
- **Watermark & Bates Numbering**: Angle, opacity, and automatic header/footer page numbering.
- **Built-in Algerian Templates**: Instant demonstration with authentic administrative certificates and commercial contracts in DZD.

### Running DZ-PDF Pro
```bash
# Launch from repository root
npm run start:pdf

# Or run directly from app directory
cd apps/office-suite/dz-pdf
node server.js
```
Open **[http://localhost:3004](http://localhost:3004)** in your browser.

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-PDF Pro** هو استوديو متكامل لتحرير، تنظيم، ختم، وتوقيع وثائق PDF، وهو بديل مكتبي متطابق 1:1 لبرنامج **Adobe Acrobat Pro**. صُمم ليعمل محلياً بنسبة 100% دون أي اتصال بالإنترنت (Offline-First) لحماية سرية الوثائق والملفات الإدارية والتجارية في الجزائر.

### قدرات وخصائص البرنامج المكتملة 1:1
1. **واجهة وقوائم Adobe Acrobat Pro المكتملة**:
   - قوائم سطح مكتب كلاسيكية (`ملف`, `تحرير`, `عرض`, `أدوات`, `مساعدة`) واختصارات لوحة المفاتيح المعيارية.
   - شريط أدوات Acrobat: أداة التحديد (`V`)، أداة اليد والتحريك (`H`)، قلم الرسم والتوقيع (`P`)، قلم التظليل الملون (`U`)، إدراج نصوص وكتابة حرة (`T`)، مستطيل الحجب الأمني الأسود (**Redaction Tool** `R`)، والملاحظات اللاصقة (**Sticky Notes** `N`).
2. **منظومة الأختام والمصادقات الإدارية الجزائرية الرسمية**:
   - **الختم الدائري الرسمي للجمهورية**: ختم مزدوج الحلقة للجمهورية الجزائرية الديمقراطية الشعبية (*الجمهورية الجزائرية الديمقراطية الشعبية / RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE*) مع النجمة والهلال، الولاية والتاريخ.
   - **أختام إدارية جاهزة**: *نسخة طبق الأصل (Conforme à l'Original)*، *وارد ومسجل بتاريخ (Courrier Arrivé)*، *مدفوع بالكامل (Payé)*، *سري للغاية (Confidentiel)*، *تمت المصادقة (Approuvé)*، *ملغى (Annulé)*، و*عاجل جداً (Urgent)*.
3. **لوحة التوقيع الرقمي المعتمد للمستندات (Fill & Sign)**:
   - لوحة رسم توقيع ناعمة بمنحنيات Bézier، حبر أزرق دبلوماسي / أسود رسمي / أخضر وزاري / بنفسجي قضائي.
   - بطاقة مصادقة إدارية تتضمن اسم الموقّع، صفته ومنصبه، الولاية، التاريخ، ورمز التحقق الرقمي المعتمد.
4. **وضع تنظيم وترتيب الصفحات (Organize Pages Grid)**: فرز الصفحات بالسحب والإفلات، التدوير الفردي أو الجماعي بـ 90°، التكرار، الحذف، وإدراج صفحات بيضاء جديدة.
5. **محرك تجميع وتوليد PDF 1.7 داخلي مستقل**: دمج كافة التأشيرات والرسومات والأختام والتواقيع بدقة عالية دون أي خادم خارجي.
6. **نماذج إدارية وتجارية جزائرية مدمجة**: تحميل فوري لـ **شهادة إدارية رسمية جزائرية** و**فاتورة وعقد توريد تجاري بالدينار الجزائري (DZD)** بكافة الضرائب والتفقيط لاختبار المنظومة فوراً.

### التشغيل المباشر
```bash
npm run start:pdf
```
افتح المتصفح على: **[http://localhost:3004](http://localhost:3004)**

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-PDF Pro** est une alternative libre, moderne et souveraine à **Adobe Acrobat Pro**. Conçu pour fonctionner à 100% hors-ligne (Offline-First) selon le standard **HeyPuter/everything**, il permet de visualiser, annoter, caviarder, organiser et signer numériquement les documents administratifs sans aucune fuite vers le cloud.

### Fonctionnalités Clés
- **Palette d'Outils Complète Acrobat** : Sélection (`V`), Main (`H`), Stylet (`P`), Surligneur (`U`), Texte (`T`), Masquage/Caviardage (`R`), et Notes adhésives (`N`).
- **Sceau et Tampons Officiels Algériens** :
  - **Cachet Rond de la République** : Double anneau réglementaire bilingue (*الجمهورية الجزائرية الديمقراطية الشعبية / RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE*), étoile et croissant, Wilaya et date.
  - **Tampons Administratifs** : *Conforme à l'Original*, *Courrier Arrivé / Reçu le*, *Payé Intégralement*, *Strictement Confidentiel*, *Vu et Approuvé*, *Annulé et Non Avenu*, et *Très Urgent*.
- **Signature Numérique Certifiée (Fill & Sign)** : Pavé de signature vectoriel fluide, encres officielles et carte d'authentification nominative avec fonction, Wilaya et empreinte de contrôle.
- **Organiseur de Pages** : Grille visuelle de tri par glisser-déposer, rotation à 90°, duplication, suppression et ajout de pages vierges.
- **Compilateur PDF 1.7 Intégré** : Génération binaire directe en mémoire des pages, polices et flux d'objets sans dépendance externe.

### Lancement
```bash
npm run start:pdf
```
Disponible sur : **[http://localhost:3004](http://localhost:3004)**
