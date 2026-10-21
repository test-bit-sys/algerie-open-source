<div align="center">

<img src="assets/logo.jpg" alt="المنظومة الجزائرية للبرمجيات المفتوحة المصدر" width="680">

# المنظومة الجزائرية للبرمجيات المفتوحة المصدر
## DZ Open Source
### المنظومة الوطنية الشاملة للبدائل البرمجية المكتبية الحرة والمستقلة
**بدائل متطابقة 1:1 • سيادة رقمية 100% • محركات أصلية متقدمة (Rust / Python / C# .NET) • دون أي اتصال سحابي • ثلاثية اللغات (عربية / فرنسية / إنجليزية)**

[![الترخيص: MIT](https://img.shields.io/badge/الترخيص-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![المعمارية: Polyglot Sovereign](https://img.shields.io/badge/المعمارية-Polyglot_Rust_Python_CSharp_JS-1e293b.svg?style=for-the-badge&logo=rust&logoColor=F7DF1E)](#-الركائز-الهندسية-لمشروع-heyputer)
[![الحالة: 34 برنامج وتطبيق مكتمل](https://img.shields.io/badge/الحالة-34_تطبيق_مكتمل_وجاهز-10b981.svg?style=for-the-badge&logo=checkmarx&logoColor=white)](#-البرمجيات-المكتبية-المكتملة-والجاهزة-حالياً-بدائل-متطابقة-11)
[![المسارات: 11 قطاع](https://img.shields.io/badge/المسارات-11_قطاع_تخصصي-0284c7.svg?style=for-the-badge)](#-دليل-المسارات-الـ-11-وجدول-كافة-أنواع-البرمجيات)
[![الخصوصية: 100% دون إنترنت](https://img.shields.io/badge/الخصوصية-100%25_دون_إنترنت_محلي-059669.svg?style=for-the-badge&logo=sqlite&logoColor=white)](#-الرؤية-الاستراتيجية-والسيادة-الرقمية)
[![اللغات: عربية · فرنسية · إنجليزية](https://img.shields.io/badge/اللغات-العربية_%7C_Français_%7C_English-dc2626.svg?style=for-the-badge)](#-التوافق-واللغات)
[![المساهمات مفتوحة](https://img.shields.io/badge/المساهمات-مفتوحة_للجميع-7c3aed.svg?style=for-the-badge&logo=github&logoColor=white)](docs/CONTRIBUTING.md)
[![تجربة مباشرة أونلاين](https://img.shields.io/badge/⚡_تجربة_مباشرة-Try_Now_Online-10b981?style=for-the-badge&logo=googlechrome&logoColor=white)](https://test-bit-sys.github.io/algerie-open-source/)

<p align="center">
  <a href="README.ar.md"><b>العربية</b></a> •
  <a href="README.md"><b>English</b></a> •
  <a href="README.fr.md"><b>Français</b></a>
</p>

> ### ⚡ تجربة مباشرة وفورية لكافة البرمجيات أونلاين (Live Demo / Try Now)
> يمكنك الآن تجربة كافة البرمجيات الـ 34 مباشرة في متصفحك دون الحاجة لتثبيت أي برامج، أو تشغيل المحركات الأصلية عالية الأداء (Rust, Python, C# .NET):  
> 👉 **[اضغط هنا لفتح بوابة المنظومة المركزية وتجربة البرامج مباشرة (Launch DZ Open Suite Hub)](https://test-bit-sys.github.io/algerie-open-source/)**

</div>

---

## 📑 فهرس المحتويات

- [🌟 الرؤية الاستراتيجية والسيادة الرقمية](#-الرؤية-الاستراتيجية-والسيادة-الرقمية)
- [🟢 جدول حالة وتصنيف كافة البرمجيات (34 برمجية سيادية مكتملة)](#-جدول-حالة-وتصنيف-كافة-البرمجيات)
- [🚀 البرمجيات المكتبية والهندسية المكتملة والجاهزة حالياً](#-البرمجيات-المكتبية-المكتملة-والجاهزة-حالياً-بدائل-متطابقة-11)
  - [💼 1. برمجية الفوترة ونقاط البيع DZ-Facture & POS (المنفذ 3000)](#1--برمجية-الفوترة-ونقاط-البيع-dz-facture--pos)
  - [🌳 2. برمجية فحص وسائط التخزين DZ-Disk-Tree (المنفذ 3001 + محرك Rust)](#2--برمجية-فحص-وسائط-التخزين-dz-disk-tree)
  - [📦 3. برمجية إدارة وضغط الأرشيف DZ-Archive (المنفذ 3002 + محرك Rust 7,000+ MB/s)](#3--برمجية-إدارة-وضغط-الأرشيف-dz-archive)
  - [🎬 4. مشغل الوسائط المتعددة DZ-Player (المنفذ 3003 + محرك Python DSP)](#4--مشغل-الوسائط-المتعددة-dz-player)
  - [📄 5. استوديو معالجة وتوثيق PDF DZ-PDF Pro (المنفذ 3004)](#5--استوديو-معالجة-وتوثيق-وثائق-pdf-dz-pdf-pro)
  - [🧑‍🏫 6. السبورة البيضاء التفاعلية DZ-Whiteboard Pro (المنفذ 3005)](#6--السبورة-البيضاء-التفاعلية-dz-whiteboard-pro)
  - [📝 7. محرر المستندات الإدارية DZ-Writer (المنفذ 3006)](#7--محرر-المستندات-الإدارية-الوطنية-dz-writer)
  - [📊 8. معالج الجداول والحسابات الجبائية DZ-Sheets (المنفذ 3007)](#8--معالج-الجداول-والحسابات-الجبائية-dz-sheets)
  - [📽️ 9. استوديو العروض التقديمية DZ-Impress (المنفذ 3008)](#9--استوديو-العروض-التقديمية-dz-impress)
  - [💻 10. منصة أدوات المطورين والـ 58 ولاية DZ-DevTools (المنفذ 3009 + محرك Rust CLI)](#10--منصة-أدوات-المطورين-والـ-58-ولاية-dz-devtools)
  - [🎨 11. استوديو التصميم ومعالجة الصور DZ-Photo (المنفذ 3010 + محرك Python NumPy)](#11--استوديو-التصميم-ومعالجة-الصور-dz-photo)
  - [📋 12. لوحات كانبان وإدارة مهام المشاريع DZ-Boards (المنفذ 3011)](#12--لوحات-كانبان-وإدارة-مهام-المشاريع-dz-boards)
  - [🏗️ 13. محرك الحسابات الزلزالية DZ-RPA Pro (كود RPA 99/2003 + محرك بايثون)](#13--محرك-الحسابات-الزلزالية-الجزائري-dz-rpa-pro)
  - [📊 14. المحاسبة المالية SCF وميزان المراجعة DZ-Compta (محرك C# .NET 10)](#14--المحاسبة-المالية-الجزائرية-dz-compta-scf-pro)
  - [👥 15. منظومة كشوف الأجور وسلم الـ IRG DZ-Paie RH (محرك C# .NET 10)](#15--منظومة-كشوف-الأجور-والضمان-الاجتماعي-dz-paie-rh-pro)
  - [📅 16. منظومة التقويم والمواعيد الوطنية DZ-Calendar (المنفذ 3027)](#16--منظومة-التقويم-وجدولة-المواعيد-الوطنية-dz-calendar)
  - [📚 17. الموسوعة وقواعد المعرفة السيادية DZ-Wiki (المنفذ 3028)](#17--الموسوعة-وقواعد-المعرفة-السيادية-dz-wiki)
  - [🤝 18. إدارة علاقات العملاء والصفقات DZ-CRM (المنفذ 3029)](#18--إدارة-علاقات-العملاء-والصفقات-dz-crm)
  - [📦 19. إدارة المخزون والمستودعات والباركود DZ-Inventory (المنفذ 3030)](#19--إدارة-المخزون-والمستودعات-والباركود-dz-inventory)
  - [⚡ 20. استوديو واجهات البرمجة السيادي DZ-API Studio (المنفذ 3031)](#20--استوديو-واجهات-البرمجة-السيادي-dz-api-studio)
  - [♟️ 21. حزمة الألعاب التراثية والذكاء الاصطناعي المحلي (المنافذ 3012-3017)](#21-️-حزمة-الألعاب-التراثية-والذكاء-الاصطناعي-المحلي)
  - [🎙️ 22. استوديو الصوت والتسجيل DZ-Audio & DZ-Recorder (المنافذ 3018, 3019)](#22-️-استوديو-الصوت-وتسجيل-الشاشة)
  - [📝 23. الملاحظات، المهام والتوقيع الرقمي (المنافذ 3020, 3021, 3022)](#23--الملاحظات-والمهام-والتوقيع-الرقمي)
  - [⏱️ 24. تتبع الوقت، محول الوحدات ومواقيت الصلاة (المنافذ 3023, 3024, 3025)](#24-️-تتبع-الوقت-ومواقيت-الصلاة-ومحول-الوحدات)
- [🗺️ دليل المسارات الـ 11 وجدول خارطة الطريق المتبقية](#-دليل-المسارات-الـ-11-وجدول-كافة-أنواع-البرمجيات)
- [⚙️ الركائز الهندسية والمعمارية المتعددة اللغات Polyglot](#️-الركائز-الهندسية-لمشروع-heyputer)
- [🏛️ الامتثال للمنظومة القانونية والجبائية الجزائرية](#️-الامتثال-للمنظومة-القانونية-والجبائية-الجزائرية)
- [💻 التشغيل السريع والأوامر والمنافذ](#-التشغيل-السريع-والأوامر-والمنافذ)
- [🤝 دليل المساهمة وتطوير المشاريع](#-دليل-المساهمة-وتطوير-المشاريع)
- [📜 الترخيص والسيادة البرمجية](#-الترخيص-والسيادة-البرمجية)

---

## 🌟 الرؤية الاستراتيجية والسيادة الرقمية

**المنظومة الجزائرية للبرمجيات المفتوحة المصدر (DZ Open Suite)** هي مبادرة وطنية كبرى لتأسيس، تنظيم، وتطوير بدائل برمجية مكتبية وحسابية وهندسية حرة ومجانية 100% للبرامج التجارية والمقرصنة الأكثر استخداماً في الإدارات العمومية، المؤسسات الاقتصادية، المصالح المهنية، ومكاتب الدراسات والجامعات الجزائرية.

---

## 🟢 جدول حالة وتصنيف كافة البرمجيات (34 برمجية وتطبيق مكتمل)

| المسار | تصنيف ونوع البرنامج | البديل التجاري المستبدل | الحالة الراهنة والمحركات | تجربة مباشرة (Try Now) | مسار المجلد المصدري |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **02** | **الفوترة ونقاط البيع POS (DZ-Facture)** | **Sage 100 / Odoo POS** | 🟢 **مكتمل** (Web :3000) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/business-enterprise/dz-facture/) | [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/) |
| **07** | **فحص وسائط التخزين (DZ-Disk-Tree)** | **WizTree / TreeSize 1:1** | 🟢 **مكتمل** (Web :3001 + **Rust Native**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/productivity/dz-disk-tree/) | [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/) |
| **07** | **ضغط وإدارة الأرشيف والتشفير (DZ-Archive)** | **WinRAR / 7-Zip 1:1** | 🟢 **مكتمل** (Web :3002 + **Rust Native**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/productivity/dz-archive/) | [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/) |
| **04** | **مشغل الوسائط المتعددة (DZ-Player)** | **VLC Media Player 1:1** | 🟢 **مكتمل** (Web :3003 + **Python DSP**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/multimedia/dz-player/) | [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/) |
| **01** | **استوديو وثائق PDF وتوقيعها (DZ-PDF Pro)** | **Adobe Acrobat Pro 1:1** | 🟢 **مكتمل** (Web :3004) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-pdf/) | [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/) |
| **10** | **السبورة البيضاء التفاعلية (DZ-Whiteboard Pro)** | **OpenBoard / Miro 1:1** | 🟢 **مكتمل** (Web :3005) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/education-academia/dz-whiteboard/) | [`apps/education-academia/dz-whiteboard/`](apps/education-academia/dz-whiteboard/) |
| **01** | **محرر المستندات والنماذج (DZ-Writer)** | **Microsoft Word / Google Docs** | 🟢 **مكتمل** (Web :3006) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-word/) | [`apps/office-suite/dz-word/`](apps/office-suite/dz-word/) |
| **01** | **معالج الجداول والحسابات (DZ-Sheets)** | **Microsoft Excel / Google Sheets** | 🟢 **مكتمل** (Web :3007) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-calc/) | [`apps/office-suite/dz-calc/`](apps/office-suite/dz-calc/) |
| **01** | **استوديو العروض ومؤشر الليزر (DZ-Impress)** | **Microsoft PowerPoint / Slides** | 🟢 **مكتمل** (Web :3008) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-slides/) | [`apps/office-suite/dz-slides/`](apps/office-suite/dz-slides/) |
| **09** | **أدوات المطورين والـ 58 ولاية (DZ-DevTools)** | **مكتبات SATIM/CIB والولايات** | 🟢 **مكتمل** (Web :3009 + **Rust CLI**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/developer-tools/dz-devtools/) | [`apps/developer-tools/dz-devtools/`](apps/developer-tools/dz-devtools/) |
| **05** | **استوديو التصميم ومعالجة الصور (DZ-Photo)** | **Adobe Photoshop / PhotoCraft** | 🟢 **مكتمل** (Web :3010 + **Python Engine**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/creative-tools/dz-photo/) | [`apps/creative-tools/dz-photo/`](apps/creative-tools/dz-photo/) |
| **06** | **لوحات كانبان وإدارة المشاريع (DZ-Boards)** | **Trello / Jira / Focalboard** | 🟢 **مكتمل** (Web :3011) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/collaboration/dz-boards/) | [`apps/collaboration/dz-boards/`](apps/collaboration/dz-boards/) |
| **11** | **شطرنج الجزائر (DZ-Chess)** | **Chess.com / Lichess FIDE AI** | 🟢 **مكتمل** (Web :3012) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-chess/) | [`apps/games-interactive/dz-chess/`](apps/games-interactive/dz-chess/) |
| **11** | **دامة جزائرية (DZ-Dama)** | **Traditional Algerian Checkers** | 🟢 **مكتمل** (Web :3013) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-dama/) | [`apps/games-interactive/dz-dama/`](apps/games-interactive/dz-dama/) |
| **11** | **دومينو الجزائر (DZ-Domino)** | **Algerian Double-Six Dominoes** | 🟢 **مكتمل** (Web :3014) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-domino/) | [`apps/games-interactive/dz-domino/`](apps/games-interactive/dz-domino/) |
| **11** | **طاولة 31 الجزائرية (DZ-Tawla)** | **Backgammon / Tawla 31** | 🟢 **مكتمل** (Web :3015) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-tawla/) | [`apps/games-interactive/dz-tawla/`](apps/games-interactive/dz-tawla/) |
| **11** | **قوة 4 (DZ-Puissance4)** | **Connect Four / Hasbro** | 🟢 **مكتمل** (Web :3016) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-puissance4/) | [`apps/games-interactive/dz-puissance4/`](apps/games-interactive/dz-puissance4/) |
| **11** | **أوتيلو ريفيرسي (DZ-Othello)** | **Reversi / Othello AI** | 🟢 **مكتمل** (Web :3017) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-othello/) | [`apps/games-interactive/dz-othello/`](apps/games-interactive/dz-othello/) |
| **04** | **استوديو تسجيل الشاشة والدروس (DZ-Recorder)** | **Camtasia / OBS Studio** | 🟢 **مكتمل** (Web :3018) | [🚀 **جرب الآن**](apps/video-montage/dz-recorder/) | [`apps/video-montage/dz-recorder/`](apps/video-montage/dz-recorder/) |
| **04** | **استوديو الهندسة الصوتية (DZ-Audio)** | **Audacity / Adobe Audition** | 🟢 **مكتمل** (Web :3019) | [🚀 **جرب الآن**](apps/multimedia/dz-audio/) | [`apps/multimedia/dz-audio/`](apps/multimedia/dz-audio/) |
| **01** | **المفكرة الذكية (DZ-Notes)** | **Microsoft OneNote / Apple Notes** | 🟢 **مكتمل** (Web :3020) | [🚀 **جرب الآن**](apps/productivity/dz-notes/) | [`apps/productivity/dz-notes/`](apps/productivity/dz-notes/) |
| **06** | **منظومة تخطيط المهام (DZ-Tasks)** | **ClickUp / Todoist / Asana** | 🟢 **مكتمل** (Web :3021) | [🚀 **جرب الآن**](apps/productivity/dz-tasks/) | [`apps/productivity/dz-tasks/`](apps/productivity/dz-tasks/) |
| **01** | **منظومة التوقيع والتأشير (DZ-Signature)** | **DocuSign / Adobe Sign** | 🟢 **مكتمل** (Web :3022) | [🚀 **جرب الآن**](apps/office-suite/dz-signature/) | [`apps/office-suite/dz-signature/`](apps/office-suite/dz-signature/) |
| **02** | **تتبع الوقت وساعات العمل (DZ-Time)** | **Toggl / Clockify (قانون 90-11)** | 🟢 **مكتمل** (Web :3023) | [🚀 **جرب الآن**](apps/productivity/dz-time/) | [`apps/productivity/dz-time/`](apps/productivity/dz-time/) |
| **07** | **محول الوحدات والعملات (DZ-Convert)** | **Convertio / XE Currency** | 🟢 **مكتمل** (Web :3024) | [🚀 **جرب الآن**](apps/productivity/dz-convert/) | [`apps/productivity/dz-convert/`](apps/productivity/dz-convert/) |
| **07** | **مواقيت الصلاة لـ 58 ولاية (DZ-Prayer)** | **IslamicFinder / MuslimPro** | 🟢 **مكتمل** (Web :3025) | [🚀 **جرب الآن**](apps/productivity/dz-prayer/) | [`apps/productivity/dz-prayer/`](apps/productivity/dz-prayer/) |
| **06** | **التقويم وجدولة المواعيد الوطنية (DZ-Calendar)** | **Google Calendar / Outlook** | 🟢 **مكتمل** (Web :3027) | [🚀 **جرب الآن**](apps/collaboration/dz-calendar/) | [`apps/collaboration/dz-calendar/`](apps/collaboration/dz-calendar/) |
| **01** | **الموسوعة وقواعد المعرفة السيادية (DZ-Wiki)** | **Notion / Obsidian / Confluence** | 🟢 **مكتمل** (Web :3028) | [🚀 **جرب الآن**](apps/productivity/dz-wiki/) | [`apps/productivity/dz-wiki/`](apps/productivity/dz-wiki/) |
| **02** | **إدارة علاقات العملاء والصفقات (DZ-CRM)** | **Salesforce / HubSpot CRM** | 🟢 **مكتمل** (Web :3029) | [🚀 **جرب الآن**](apps/business-enterprise/dz-crm/) | [`apps/business-enterprise/dz-crm/`](apps/business-enterprise/dz-crm/) |
| **02** | **إدارة المخزون والمستودعات والباركود (DZ-Inventory)** | **Zoho Inventory / Sortly** | 🟢 **مكتمل** (Web :3030) | [🚀 **جرب الآن**](apps/business-enterprise/dz-inventory/) | [`apps/business-enterprise/dz-inventory/`](apps/business-enterprise/dz-inventory/) |
| **09** | **استوديو واجهات البرمجة السيادي (DZ-API)** | **Postman / Insomnia / Hoppscotch** | 🟢 **مكتمل** (Web :3031) | [🚀 **جرب الآن**](apps/developer-tools/dz-api/) | [`apps/developer-tools/dz-api/`](apps/developer-tools/dz-api/) |
| **08** | **الحسابات الزلزالية الجزائري (DZ-RPA Pro)** | **Robot Structural / ETABS RPA** | 🟢 **مكتمل** (Web + **Python RPA 99/03**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/engineering/dz-rpa/) | [`apps/engineering/dz-rpa/`](apps/engineering/dz-rpa/) |
| **03** | **المحاسبة المالية وميزان المراجعة (DZ-Compta)** | **PC Compta / DLG Compta SCF** | 🟢 **مكتمل** (Web + **C# .NET 10**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/finance-accounting/dz-compta/) | [`apps/finance-accounting/dz-compta/`](apps/finance-accounting/dz-compta/) |
| **03** | **كشوف الأجور والضمان الاجتماعي (DZ-Paie RH)** | **PC Paie / DLG Paie / IRG DGI** | 🟢 **مكتمل** (Web + **C# .NET 10**) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/finance-accounting/dz-paie/) | [`apps/finance-accounting/dz-paie/`](apps/finance-accounting/dz-paie/) |
| **11** | **حزمة الألعاب التفاعلية والتراثية (شطرنج، دامة، دومينو، طاولة، قوة 4، أوتيلو)** | ألعاب الذكاء واللوحة مع محركات AI محلية | 🟢 **مكتمل** (Web :3012-:3017) | [🚀 **جرب الآن**](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-chess/) | [`apps/games-interactive/`](apps/games-interactive/) |
| **04** | **استوديو تسجيل الشاشة والدروس (DZ-Recorder)** | **Camtasia / OBS Studio** | 🟢 **مكتمل** (Web :3018) | [🚀 **جرب الآن**](apps/video-montage/dz-recorder/) | [`apps/video-montage/dz-recorder/`](apps/video-montage/dz-recorder/) |
| **04** | **استوديو الهندسة الصوتية والتسجيل (DZ-Audio)** | **Audacity / Adobe Audition** | 🟢 **مكتمل** (Web :3019) | [🚀 **جرب الآن**](apps/multimedia/dz-audio/) | [`apps/multimedia/dz-audio/`](apps/multimedia/dz-audio/) |
| **01** | **المفكرة والسبورة الرقمية الذكية (DZ-Notes)** | **Microsoft OneNote / Apple Notes** | 🟢 **مكتمل** (Web :3020) | [🚀 **جرب الآن**](apps/productivity/dz-notes/) | [`apps/productivity/dz-notes/`](apps/productivity/dz-notes/) |
| **06** | **منظومة تخطيط وإدارة المهام (DZ-Tasks)** | **ClickUp / Todoist / Asana** | 🟢 **مكتمل** (Web :3021) | [🚀 **جرب الآن**](apps/productivity/dz-tasks/) | [`apps/productivity/dz-tasks/`](apps/productivity/dz-tasks/) |
| **01** | **منظومة التوقيع والتأشير الرقمي (DZ-Signature)** | **DocuSign / Adobe Sign** | 🟢 **مكتمل** (Web :3022) | [🚀 **جرب الآن**](apps/office-suite/dz-signature/) | [`apps/office-suite/dz-signature/`](apps/office-suite/dz-signature/) |
| **02** | **تتبع الوقت وساعات العمل الجزائري (DZ-Time)** | **Toggl / Clockify (قانون 90-11)** | 🟢 **مكتمل** (Web :3023) | [🚀 **جرب الآن**](apps/productivity/dz-time/) | [`apps/productivity/dz-time/`](apps/productivity/dz-time/) |
| **06** | **التقويم وجدولة المواعيد الوطنية (DZ-Calendar)** | **Google Calendar / Outlook** | 🟢 **مكتمل** (Web :3027) | [🚀 **جرب الآن**](apps/collaboration/dz-calendar/) | [`apps/collaboration/dz-calendar/`](apps/collaboration/dz-calendar/) |
| **01** | **الموسوعة وقواعد المعرفة السيادية (DZ-Wiki)** | **Notion / Obsidian / Confluence** | 🟢 **مكتمل** (Web :3028) | [🚀 **جرب الآن**](apps/productivity/dz-wiki/) | [`apps/productivity/dz-wiki/`](apps/productivity/dz-wiki/) |
| **02** | **إدارة علاقات العملاء والصفقات (DZ-CRM)** | **Salesforce / HubSpot CRM** | 🟢 **مكتمل** (Web :3029) | [🚀 **جرب الآن**](apps/business-enterprise/dz-crm/) | [`apps/business-enterprise/dz-crm/`](apps/business-enterprise/dz-crm/) |
| **02** | **إدارة المخزون والمستودعات والباركود (DZ-Inventory)** | **Zoho Inventory / Sortly** | 🟢 **مكتمل** (Web :3030) | [🚀 **جرب الآن**](apps/business-enterprise/dz-inventory/) | [`apps/business-enterprise/dz-inventory/`](apps/business-enterprise/dz-inventory/) |
| **09** | **استوديو واجهات البرمجة السيادي (DZ-API)** | **Postman / Insomnia / Hoppscotch** | 🟢 **مكتمل** (Web :3031) | [🚀 **جرب الآن**](apps/developer-tools/dz-api/) | [`apps/developer-tools/dz-api/`](apps/developer-tools/dz-api/) |

---

## 🚀 البرمجيات المكتبية المكتملة والجاهزة حالياً (بدائل متطابقة 1:1)

---

### 1. 💼 برمجية الفوترة ونقاط البيع DZ-Facture & POS
> **الحل الوطني لإدارة المبيعات، الصناديق النقدية، الفوترة التجارية، والمحاسبة اليومية**  
> *المنفذ: `:3000` • المسار: [`apps/business-enterprise/dz-facture/`](apps/business-enterprise/dz-facture/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/business-enterprise/dz-facture/)*

- **📜 مطابقة تامة للمرسوم التنفيذي 05-468**: توليد فواتير وسندات بيع قانونية تتضمن الرقم التعريفي الجبائي NIF (15 رقماً)، الرقم الإحصائي NIS (20 رقماً)، السجل التجاري RC، رقم المادة الجبائية، ورقم الحساب البنكي/البريدي RIB/CCP.
- **💰 محرك الضرائب والرسوم الجزائري**: حساب تلقائي دقيق لضريبة القيمة المضافة TVA (19% عادي، 9% مخفض، و 0% معفى) مع حساب قانوني لرسم الطابع الجبائي (*Droit de Timbre*).
- **✍️ محرك التفقيط المالي بالدينار الجزائري**: تحويل المبالغ المالية آلياً إلى كلمات معربة قانونية بالدينار الجزائري (*مثال: ثمانمائة وإحدى عشر ألف وسبعمائة دينار جزائري لا غير*).
- **🏪 وضع مزدوج لصناديق الدفع (POS) وفواتير الشركات (B2B)**: دعم قارئ الباركود، طباعة التذاكر الحرارية (58mm / 80mm)، إدارة السلات المعلقة، وإصدار الفواتير الرسمية بمقاس A4.
- **📊 تقرير الإغلاق اليومي Z-Report**: حساب الحصيلة اليومية ومطابقة صندوق النقدية وجرد المصاريف اليومية.
- **🗺️ دليل الـ 58 ولاية المدمج**: قاعدة بيانات مدمجة لجميع ولايات وبلديات الوطن الـ 1,541 مع الرموز البريدية.

```bash
# تشغيل البرنامج والبوابة المركزية على http://localhost:3000
npm start
```

---

### 2. 🌳 برمجية فحص وسائط التخزين DZ-Disk-Tree
> **محلل مساحات الأقراص فائق السرعة والخريطة الشجرية المظللة المجسمة (بديل WizTree 1:1)**  
> *المنفذ: `:3001` • المسار: [`apps/productivity/dz-disk-tree/`](apps/productivity/dz-disk-tree/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/productivity/dz-disk-tree/)*

- **🖥️ شاشة عرض مزدوجة متزامنة (Split-Window)**: مطابقة تامة لتصميم WizTree الأصلي؛ شبكة شجرية متعددة الأعمدة في الأعلى وخريطة مساحية بارزة ومظللة مجسمة (**Cushioned Treemap Canvas**) في الأسفل مع مقسم سحب مباشر.
- **⚡ تحديد ثنائي الاتجاه لحظي**: النقر على أي مجلد في الشجرة يسلط الضوء فوراً على كتلته في الخريطة؛ والنقر على أي كتلة مرئية يحدد موقعها مباشرة في الجدول.
- **📊 فرز الأعمدة التفاعلي**: فرز حسب الاسم، نسبة الحجم، الحجم الفعلي، الحجم المحجوز على كتل التخزين (Allocated Cluster Space)، عدد الملفات والمجلدات، وتاريخ التعديل مع أسهم الفرز.
- **⌨️ تنقل كامل عبر أسهم لوحة المفاتيح**: دعم كامل للأسهم والتنقل السريع (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Backspace`).
- **🖨️ تقرير تدقيق تنفيذي رسمي قابل للطباعة**: توليد تقرير تدقيق HTML احترافي يتضمن لقطة مدمجة للخريطة وجداول تفصيلية لأكبر الملفات استهلاكاً للمساحة.
- **💾 تصدير كامل للبيانات**: تصدير الفحص بصيغتي CSV و JSON وحفظ المخطط كصورة PNG عالية الدقة.

```bash
# تشغيل برنامج فحص الأقراص على http://localhost:3001
npm run start:disk-tree
```

---

### 3. 📦 برمجية إدارة وضغط الأرشيف DZ-Archive
> **أداة الأرشفة والضغط والتشفير واختبار كفاءة العتاد المكتبي (بديل WinRAR 1:1)**  
> *المنفذ: `:3002` • المسار: [`apps/productivity/dz-archive/`](apps/productivity/dz-archive/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/productivity/dz-archive/)*

- **🗜️ واجهة وقوائم WinRAR الأصلية**: شريط قوائم مألوف (`File`, `Commands`, `Tools`, `Options`, `Help`) وشريط الأدوات الأيقوني الكبير (`Add`, `Extract To`, `Test`, `View`, `Delete`, `Find`, `Wizard`, `Info`, `Lock`, `Comment`, `Benchmark`).
- **📑 نافذة معلمات الضغط بـ 6 تبويبات**: إعدادات متكاملة تشمل تبويبات (`General`, `Advanced`, `Files`, `Backup`, `Time`, `Comment`).
- **🔐 تشفير عسكري متقدم AES-256-GCM**: حماية أمنية مشفرة بكلمة مرور عبر **Web Crypto API** مع اشتقاق المفاتيح بواسطة **PBKDF2**.
- **🔍 عارض ملفات داخلي متعدد الأنماط**: استعراض الملفات فورياً بنقر مزدوج دون استخراجها إلى القرص عبر عارض النصوص، عارض الهكسا (**Hex Dump**) بمحاذاة 16 بايت وعرض ASCII، وعارض الوسائط والصور.
- **⏱️ مقياس كفاءة العتاد والمعالج (Hardware Benchmark)**: فحص سرعة الضغط الآنية بالميغابايت/ثانية واحتساب نقاط تقييم الأداء استناداً إلى مسارات المعالج (CPU Threads).
- **🛡️ فحص سلامة الأرشيف (CRC-32 Test)**: تدقيق كل سجل وملف في الأرشيف ومطابقته مع بصمة **CRC-32** لضمان سلامته من التلف.

```bash
# تشغيل برنامج الأرشيف على http://localhost:3002
npm run start:archive
```

---

### 4. 🎬 مشغل الوسائط المتعددة DZ-Player
> **مشغل الوسائط المتعددة عالي الأداء مع مضخم صوت 300% واستوديو المؤثرات الموحد (بديل VLC 1:1)**  
> *المنفذ: `:3003` • المسار: [`apps/multimedia/dz-player/`](apps/multimedia/dz-player/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/multimedia/dz-player/)*

- **📻 واجهة وقوائم VLC الأصلية**: شريط قوائم علوي كامل (`Media`, `Playback`, `Audio`, `Video`, `Subtitle`, `Tools`, `View`, `Help`)، شاشة عرض داكنة بشعار المخروط، وشريط تحكم سفلي احترافي.
- **🔊 تضخيم الصوت الفائق حتى 300%**: شريط صوت بمؤشر رقمي حقيقي يتجاوز الحدود التقليدية ليصل إلى **300%** لمعالجة المقاطع الضعيفة عبر عقدة `GainNode`.
- **🎛️ نافذة المؤثرات والمرشحات الموحدة (Ctrl+E)**:
  - **معادل صوتي 10 حزم (Graphic Equalizer)**: ترددات قياسية (من 60Hz إلى 16kHz) مع قوالب جاهزة (Rock, Pop, Classical, Flat, Full Bass, Voice).
  - **ضاغط الصوت الديناميكي (Audio Compressor)**: تنظيم احترافي لعتبة الصوت (Threshold)، النسبة (Ratio)، والحدة (Attack/Release).
  - **هندسة وألوان الفيديو**: تدوير الفيديو بـ 90°/180°/270°، الانعكاس الأفقي، وضبط السطوع والتباين والتشبع ودرجة اللون.
  - **تزامن الصوت والترجمة**: معالجة التأخير أو التقديم بالمللي ثانية لضمان التزامن السمعي البصري المثالي.
- **🔤 حل معضلة ترميز الترجمة العربية**: محرك ذكي يتعرف تلقائياً على بايتات الحروف العربية بترميز `Windows-1256 / CP-1256` أو `UTF-8` ويقوم بفك تشفيرها وإظهارها فوراً بخط عربي واضح مع محاذاة تلقائية لليمين (RTL).
- **🔄 دقة التشغيل**: حلقة التكرار A-B، التقاط إطارات الفيديو كصور عالية الدقة، وتشغيل البث الشبكي الحي (HTTP/HTTPS/HLS).

```bash
# تشغيل مشغل الوسائط على http://localhost:3003
npm run start:player
```

---

### 5. 📄 استوديو معالجة وتوثيق وثائق PDF DZ-PDF Pro
> **محرر وثائق PDF ومنظومة الأختام الإدارية والتوقيع الرقمي المعتمد (بديل Adobe Acrobat Pro 1:1)**  
> *المنفذ: `:3004` • المسار: [`apps/office-suite/dz-pdf/`](apps/office-suite/dz-pdf/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-pdf/)*

- **🛠️ شريط أدوات Acrobat المتكامل**: أداة التحديد (`V`)، أداة اليد والتحريك (`H`)، قلم الرسم والتوقيع (`P`)، قلم التظليل الملون (`U`)، إدراج نصوص وكتابة حرة (`T`)، مستطيل الحجب الأمني الأسود (**Redaction Tool** `R`)، والملاحظات اللاصقة (**Sticky Notes** `N`).
- **🏛️ منظومة الأختام والمصادقات الإدارية الجزائرية الرسمية**:
  - **الختم الدائري الرسمي للجمهورية**: ختم مزدوج الحلقة للجمهورية الجزائرية الديمقراطية الشعبية (*الجمهورية الجزائرية الديمقراطية الشعبية / RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE*) مع النجمة والهلال، الولاية والتاريخ.
  - **أختام إدارية جاهزة**: *نسخة طبق الأصل (Conforme à l'Original)*، *وارد ومسجل بتاريخ (Courrier Arrivé)*، *مدفوع بالكامل (Payé)*، *سري للغاية (Confidentiel)*، *تمت المصادقة (Approuvé)*، *ملغى (Annulé)*، و*عاجل جداً (Urgent)*.
- **✍️ لوحة التوقيع الرقمي المعتمد للمستندات (Fill & Sign)**: لوحة رسم توقيع ناعمة بمنحنيات Bézier، ألوان الحبر الرسمي، بطاقة مصادقة إدارية تتضمن اسم الموقّع، صفته ومنصبه، الولاية، التاريخ، ورمز التحقق الرقمي المعتمد.
- **📑 وضع تنظيم وترتيب الصفحات (Organize Pages Grid)**: فرز الصفحات بالسحب والإفلات، التدوير الفردي أو الجماعي بـ 90°، التكرار، الحذف، وإدراج صفحات بيضاء جديدة.
- **📋 نماذج إدارية وتجارية جزائرية مدمجة**: تحميل فوري لـ **شهادة إدارية رسمية جزائرية** و**فاتورة وعقد توريد تجاري بالدينار الجزائري (DZD)** بكافة الضرائب والتفقيط لاختبار المنظومة فوراً.

```bash
# تشغيل استوديو PDF على http://localhost:3004
npm run start:pdf
```

---

### 6. 🧑‍🏫 السبورة البيضاء التفاعلية DZ-Whiteboard Pro (بديل OpenBoard و Miro 1:1)
> **السبورة البيضاء الرقمية التفاعلية للشاشات الذكية، قاعات التدريس، المحاضرات الجامعية، والعمل التشاركي**  
> *المنفذ: `:3005` • المسار: [`apps/education-academia/dz-whiteboard/`](apps/education-academia/dz-whiteboard/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/education-academia/dz-whiteboard/)*

- **🎨 أنماط السبورة المدرسية المتنوعة**: سبورة بيضاء نقية، ورق شبكي ومربعات للرياضيات والهندسة، ورق مسطر لتدريس اللغات والخط، شبكة نقاط، سبورة مدرسية خضراء كلاسيكية (Chalkboard)، وسبورة سوداء داكنة مع خطوط نيون.
- **✏️ أدوات شرح وتدريس متكاملة**: قلم حبر انسيابي ناعم بمنحنيات Spline للخط العربي والفرنسي، قلم تمييز وتظليل شفاف (Highlighter)، ممحاة ذكية، أشكال هندسية متعددة (مستطيل، دائرة، مثلث، معين، نجمة)، وأسهم وموصلات للمخططات الانسيابية.
- **💡 مؤشر الليزر التفاعلي للمحاضرات (Laser Pointer)**: مسار ليزري متوهج يتلاشى تلقائياً لتوجيه انتباه الطلبة أثناء الشرح على الشاشات التفاعلية وأجهزة العرض (Datashow).
- **📑 إدارة شرائح ودروس متعددة الصفحات**: إضافة عدد غير محدود من الصفحات لكل محاضرة أو درس مع شريط مصغرات جانبي للتنقل والتكرار والحذف.
- **💾 تصدير وحفظ 100% دون إنترنت**: تصدير مباشر إلى صور عالية الدقة (PNG)، رسوم متجهة (SVG)، ملفات PDF متعددة الصفحات جاهزة للطباعة، وحفظ وقراءة ملفات المشاريع المحلية بصيغة `.dzboard`.

```bash
# تشغيل السبورة البيضاء التفاعلية على http://localhost:3005
npm run start:whiteboard
```

---

### 7. 📝 محرر المستندات الإدارية الوطنية DZ-Writer (بديل Microsoft Word و Google Docs 1:1)
> **معالج النصوص والوثائق الرسمية مع محاكاة صفحات A4 الواقعية والنماذج الإدارية والوزارية الجزائرية الجاهزة**  
> *المنفذ: `:3006` • المسار: [`apps/office-suite/dz-word/`](apps/office-suite/dz-word/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-word/)*

- **🏛️ قوالب ونماذج إدارية جزائرية رسمية مدمجة بضغطة زر**:
  - **شهادة عمل رسمية (Attestation de Travail)**: بالصيغة القانونية المعتمدة لدى مصالح الموارد البشرية والضمان الاجتماعي CNAS.
  - **طلب خطي رسمي (Demande Manuscrite)**: لمسابقات التوظيف، الترقية، والمراسلات الإدارية الرسمية.
  - **مذكرة مصلحة داخلية (Note de Service)**: للتسيير الإداري الداخلي في المؤسسات العمومية والخاصة.
  - **سيرة ذاتية وطنية (CV Algérien)**: متوافقة مع متطلبات سوق العمل الجزائري ودعم ثنائي اللغة.
- **📄 شريط أدوات تحرير متكامل ومحاكاة ورق A4**: ضبط الهوامش (2.5 سم)، رأس وتذييل الصفحة، الترقيم التلقائي، تنسيق الخطوط والألوان، إدراج الجداول، الخطوط الفاصلة، ومحاذاة النصوص.
- **🖨️ طباعة وتصدير PDF سيادي 100%**: طباعة مباشرة أو حفظ كملف PDF عالي الدقة دون أي تشويه للتنسيق أو الخطوط العربية.
- **📊 إحصائيات حية للمستند**: عداد لحظي للكلمات، الحروف، الفقرات، وزمن القراءة المقدر.

```bash
# تشغيل محرر المستندات على http://localhost:3006
npm run start:word
```

---

### 8. 📊 معالج الجداول والحسابات الجبائية DZ-Sheets (بديل Microsoft Excel و Google Sheets 1:1)
> **شبكة الجداول الحسابية فائقة السرعة مع دوال الضرائب والرواتب والنظام المحاسبي المالي الجزائري (SCF)**  
> *المنفذ: `:3007` • المسار: [`apps/office-suite/dz-calc/`](apps/office-suite/dz-calc/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-calc/)*

- **🇩🇿 دوال حسابية جزائرية أصلية مدمجة في محرك الصيغ**:
  - `=TAFQIT_AR(A1)`: التفقيط المالي بالدينار الجزائري بالعربية كتابةً.
  - `=TAFQIT_FR(A1)`: التفقيط المالي بالدينار الجزائري بالفرنسية.
  - `=TVA_DZ(A1; 19)`: حساب ضريبة القيمة المضافة وفق النسبة القانونية (19% أو 9%).
  - `=TIMBRE_DZ(A1)`: حساب رسم الطابع الجبائي القانوني (1% بحد أدنى 5 دج وسقف 10,000 دج).
  - `=IRG_DZ(A1)`: حساب الضريبة على الدخل الإجمالي حسب السلم الضريبي الوطني المحين لرواتب الأجراء.
- **📋 نماذج مالية ومحاسبية وطنية جاهزة**:
  - **كشف الراتب الشهري (Fiche de Paie)**: حساب الراتب الأساسي، التعويضات، اقتطاع الضمان الاجتماعي 9%، وخصم IRG.
  - **جدول حسابات النتائج (TCR - Compte de Résultat SCF)**: نموذج الحسابات السنوي المعتمد لدى وزارة المالية.
  - **فاتورة تجارية تفاعلية (Facture Proforma)**: مطابقة لشروط الفوترة مع الحساب التلقائي للضرائب والتفقيط.
- **📈 محرك رسوم بيانية ومخططات فوري**: رسم بياني تفاعلي للأعمدة (Bar)، الخطوط (Line)، والمخطط الدائري (Pie) مع حفظ وتصدير CSV.

```bash
# تشغيل معالج الجداول على http://localhost:3007
npm run start:calc
```

---

### 9. 📽️ استوديو العروض التقديمية DZ-Impress (بديل Microsoft PowerPoint و Google Slides 1:1)
> **استوديو تصميم وتقديم العروض التفاعلية بنسبة 16:9 مع مؤشر الليزر التفاعلي ووضع العارض بملء الشاشة**  
> *المنفذ: `:3008` • المسار: [`apps/office-suite/dz-slides/`](apps/office-suite/dz-slides/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/office-suite/dz-slides/)*

- **🎓 قوالب عروض وطنية جاهزة بنقرة واحدة**:
  - **قالب مناقشة مذكرة التخرج الجامعية (PFE Soutenance)**: غلاف رسمي بأسماء الأساتذة والمؤطر، خطة العرض، الإشكالية، النتائج، والتوصيات.
  - **قالب العرض الاستثماري للشركات الناشئة (Startup Pitch Deck DZ)**: نموذج متوافق مع معايير مسرعات الأعمال الجزائرية (A-Venture) ووزارة اقتصاد المعرفة.
  - **عرض تقديمي فارغ عالي الدقة (Blank 16:9 Canvas)**: تصميم مخصص لكل الاحتياجات التعليمية والإدارية.
- **🔴 وضع العارض الحي مع مؤشر الليزر التفاعلي (`F5`)**: عرض الشرائح بملء الشاشة مع مؤقت زمني دقيق للمحاضرة ومؤشر ليزر أحمر افتراضي متوهج يتبع حركة الفأرة لتسليط الضوء على العناصر أثناء الشرح.
- **🎨 أدوات تصميم غنية**: إضافة نصوص، عناوين، صناديق ألوان، اقتباسات، أشكال، إعادة ترتيب الشرائح بالسحب، وتصدير العرض بالكامل إلى PDF أو صور PNG.

```bash
# تشغيل استوديو العروض التقديمية على http://localhost:3008
npm run start:slides
```

---

### 10. 💻 منصة أدوات المطورين والـ 58 ولاية DZ-DevTools (الاستوديو الوطني للمطورين)
> **المنصة السيادية لأدوات المطورين، مدققات الهوية الجبائية والبنكية، وقاعدة بيانات الـ 58 ولاية المصنفة**  
> *المنفذ: `:3009` • المسار: [`apps/developer-tools/dz-devtools/`](apps/developer-tools/dz-devtools/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/developer-tools/dz-devtools/)*

- **🗺️ مستكشف الـ 58 ولاية والبلديات الوطنية**: استعراض شامل للبيانات الجغرافية بأسماء عربية وفرنسية، مقرات الولايات، الترقيم البريدي، أرقام تسجيل السيارات (Matricules)، والمفتاح الهاتفي مع تصدير فوري إلى `JSON`, `CSV`, `SQL DDL/Inserts`, و `ES Modules`.
- **💳 مدققات الهوية البنكية والجبائية الوطنية**:
  - **حاسبة مفتاح الحساب البريدي الجاري (Algérie Poste CCP Key)**: خوارزمية Modulo-97 البريدية الرسمية.
  - **مولد ومدقق كود الـ RIP البريدي الكامل (20 رقماً)**: مع فحص المفتاح البنكي.
  - **مدقق بطاقات CIB والبطاقة الذهبية**: فحص خوارزمية Luhn والتعرف على كود الـ BIN الوطني (بريد الجزائر، البنك الوطني BNA، الخ).
  - **مدقق الرقم الجبائي NIF (15 رقماً) والرقم الإحصائي NIS (20 رقماً) والسجل التجاري RC**.
- **📡 فاحص شبكات الهاتف النقال والخطوط الثابتة**: تمييز متعاملي الهاتف النقال (Mobilis, Djezzy, Ooredoo) والشبكة الثابتة مع التنسيق الدولي E.164.
- **⚡ حزمة Tafqit SDK للمطورين**: واجهة تجربة وتوليد أكواد تفقيط المبالغ المالية مع مقتطفات برمجية جاهزة للنسخ بلغات JavaScript/TypeScript, Python, و PHP.

```bash
# تشغيل منصة أدوات المطورين على http://localhost:3009
npm run start:devtools
```

---

### 11. 🎨 استوديو التصميم ومعالجة الصور بالطبقات DZ-Photo (بديل Photoshop و PhotoCraft 1:1)
> **استوديو تصميم ورسم وتعديل صور نقطية مكتبي متعدد الطبقات مع مرشحات جزائرية وأبعاد السوشيال ميديا**  
> *المنفذ: `:3010` • المسار: [`apps/creative-tools/dz-photo/`](apps/creative-tools/dz-photo/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/creative-tools/dz-photo/)*

- **🥞 محرك طبقات احترافي كامل (Layers Stack Engine)**: إضافة، تكرار، حذف، وترتيب الطبقات لأعلى وأسفل مع تحكم دقيق في الشفافية (Opacity)، إخفاء وإظهار الطبقات، ورسم مركب فائق الأداء.
- **🖌️ أدوات رسم وتصميم متكاملة**: فرشاة حرة ناعمة، ممحاة ذكية، دلو التعبئة اللحظي، قطارة الألوان (Eyedropper)، وأداة كتابة النصوص بخطوط عربية أصيلة.
- **🌅 مرشحات وتأثيرات بصرية حصرية**: مرشح غروب الصحراء الجزائرية الدافئ، مرشح زرقة البحر الأبيض المتوسط، أبيض وأسود، سيبيا كلاسيكي، عكس الألوان، وانعكاس أفقي وعمودي فوري.
- **📐 قوالب القياسات الوطنية والشبكات الاجتماعية**: منشورات انستغرام وفيسبوك (1080x1080)، ريلز وستوري عمودي (1080x1920)، غلاف وبانر Full HD (1920x1080)، وأبعاد مخصصة.
- **💾 تنسيق المشاريع السيادي (.dzphoto)**: حفظ المشروع بالطبقات بصيغة JSON خاصة واسترجاعه في أي وقت، مع تصدير فائق الجودة بصيغ PNG و JPEG و WEBP.

```bash
# تشغيل استوديو الصور والتصميم على http://localhost:3010
npm run start:photo
```

---

### 12. 📋 لوحات كانبان وإدارة مهام المشاريع DZ-Boards (بديل Trello و Jira و Focalboard 1:1)
> **منصة إدارة المشاريع الرشيقة والمهام الجماعية بنظام كانبان التفاعلي بالسحب والإفلات وقوالب المشاريع الوطنية**  
> *المنفذ: `:3011` • المسار: [`apps/collaboration/dz-boards/`](apps/collaboration/dz-boards/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/collaboration/dz-boards/)*

- **🎯 سحب وإفلات تفاعلي سلس (HTML5 Drag & Drop)**: تحريك المهام والبطاقات بين الأعمدة بانسيابية تامة وتحديث فوري للمؤشرات.
- **🇩🇿 نماذج مشاريع وطنية جاهزة بنقرة واحدة**:
  - **مشروع التخرج الجامعي (PFE Master & License)**: توزيع مراحل البحث الأكاديمي، مراجعة الدراسات السابقة، نمذجة UML، كتابة المذكرة، والمناقشة.
  - **إطلاق شركة ناشئة ومتجر إلكتروني جزائري (DZ E-Commerce Startup)**: السجل التجاري (رمز 607001 CNRC)، الانتساب الجبائي NIF/NIS، ربط SATIM/CIB/الذهبية، وشركات التوصيل عبر 58 ولاية.
  - **سبرنت تطوير برمجي رشيق (Agile 2-Week Sprint)**: تتبع المهام البرمجية، مراجعة الكود، واختبارات الجودة.
- **☑️ بطاقات مهام غنية وقوائم فرعية (Checklists)**: درجات أولوية ملونة (عاجل جداً، أولوية عالية، متوسطة، منخفضة)، تواريخ استحقاق، وسوم مخصصة، وشريط تقدم فرعي لكل بطاقة.
- **📊 شريط تحليلي ومؤشرات إنجاز لحظية**: عرض عدد المهام الكلية، قيد التنفيذ، العاجلة، والمكتملة مع مؤشر نسبة الإنجاز المئوية.
- **💾 سيادة تامة وحفظ محلي**: حفظ تلقائي مستمر في `localStorage`، تصدير واستيراد ملفات اللوحات بصيغة `.dzboard`، وتصدير جدول المهام بصيغة `CSV`.

```bash
# تشغيل لوحات كانبان على http://localhost:3011
npm run start:boards
```

---

### 13. 🏗️ محرك الحسابات الزلزالية الجزائري DZ-RPA Pro (كود RPA 99 / Version 2003)
> **المحرك الهندسي الرسمي لحساب قوى القص القاعدية وتوزيع الأحمال الزلزالية وفق الوثيقة الفنية DTR-BC 2-48**  
> *المسار: [`apps/engineering/dz-rpa/`](apps/engineering/dz-rpa/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/engineering/dz-rpa/)*

- **🏛️ كود الزلازل الجزائري الرسمي**: تطبيق كامل لمعادلات وثيقة DTR-BC 2-48 لحساب قوة القص القاعدية $V = \frac{A \cdot D \cdot Q}{R} \cdot W$.
- **🗺️ تصنيف الـ 58 ولاية وفق مناطق الخطر الزلزالي**: مطابقة تامة لمناطق الخطر (Zone 0 غير زلزالية، Zone I منخفضة، Zone IIa متوسطة، Zone IIb هامة، Zone III شديدة كالجزائر العاصمة وبومرداس والشلف وتيبازة والبليدة).
- **🏢 تصنيف التربة ومجموعات الاستخدام**: دعم تصنيفات التربة $S_1$ إلى $S_4$ مع الأدوار المميزة $T_1$ و $T_2$ وحساب معامل التخميد $\eta = \sqrt{7/(2+\xi)} \ge 0.7$.
- **📈 توزيع القوى الجانبية الطابقية $F_k$**: حساب القوة المركزة العلوية $F_t$ وتوزيع القوى وعزوم الانقلاب على جميع طوابق المبنى.
- **🐍 محرك بايثون أصلي سريع وواجهة CLI متكاملة**:
  ```bash
  # تشغيل المحرك الزلزالي عبر Python CLI
  npm run native:rpa -- --wilaya 16 --group 2 --soil S2 --weight 12000 --height 24 --stories 8
  ```

---

### 14. 📊 المحاسبة المالية الجزائرية وميزان المراجعة DZ-Compta SCF Pro
> **المحرك المحاسبي المالي السيادي المعتمد على النظام المحاسبي المالي الجزائري (SCF)**  
> *المسار: [`apps/finance-accounting/dz-compta/`](apps/finance-accounting/dz-compta/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/finance-accounting/dz-compta/)*

- **📑 مدونة الحسابات الوطنية SCF**: تطبيق المجموعات المحاسبية من الصنف 1 (رؤوس الأموال) إلى الصنف 7 (المنتوجات).
- **⚖️ دفتر اليومية العامة والقيد المزدوج**: تسجيل العمليات مع الوثائق التبريرية والتحقق الفوري من توازن المدين والدائن بدقة عشرية 100%.
- **🏛️ ميزان المراجعة بـ 6 أعمدة (Balance Générale)**: توليد فوري لميزان المراجعة (الأرصدة الافتتاحية، حركات الفترة، والأرصدة الختامية).
- **⚡ محرك C# .NET 10 عالي الدقة**: معالجة ملايين القيود المحاسبية بأعلى درجات الأداء الرياضي باستخدام نمط `decimal` الحقيقي.
  ```bash
  # تشغيل محرك المحاسبة الأصلي بلغة C#
  npm run native:compta
  ```

---

### 15. 👥 منظومة كشوف الأجور والضمان الاجتماعي DZ-Paie RH Pro
> **محرك حساب كشوف الرواتب والضمان الاجتماعي CNAS وقوانين الضرائب وسلم الـ IRG الجزائري**  
> *المسار: [`apps/finance-accounting/dz-paie/`](apps/finance-accounting/dz-paie/) • [🚀 تجربة البرنامج مباشرة (Try Now)](https://test-bit-sys.github.io/algerie-open-source/apps/finance-accounting/dz-paie/)*

- **🛡️ الضمان الاجتماعي CNAS**: حساب دقيق للاقتطاعات الاجتماعية (9% على عاتق العامل، 26% اشتراكات رب العمل).
- **📉 تطبيق سلم الـ IRG الرسمي (DGI)**: حساب الشرائح الضريبية (23%, 27%, 30%, 35%) مع التخفيض القانوني البالغ 40% (بين 1,000 و 1,500 دج) والإعفاء التام للرواتب الأدنى.
- **📄 كشف الراتب الرسمي المطبوع (Fiche de Paie)**: توليد كشوف فردية وجماعية تتضمن منحة الخبرة المهنية (IEP)، السلة، النقل، الساعات الإضافية، والتفقيط المالي بالدينار الجزائري.
- **⚡ محرك C# .NET 10 للموارد البشرية**:
  ```bash
  # تشغيل محرك كشف الرواتب الأصلي بلغة C#
  npm run native:paie
  ```

---

### 16. 📅 منظومة التقويم وجدولة المواعيد الوطنية DZ-Calendar
> **التقويم السيادي لإدارة المواعيد، التخطيط المؤسسي، والأعياد الوطنية والإسلامية في الجزائر**  
> *المنفذ: `:3027` • المسار: [`apps/collaboration/dz-calendar/`](apps/collaboration/dz-calendar/) • [🚀 تجربة البرنامج مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/collaboration/dz-calendar/)*

- **🇩🇿 محرك الأعياد والعطل الرسمية الجزائرية**: مدرج مسبقاً بالأعياد الوطنية المدنية (عيد الاستقلال 5 جويلية، عيد الثورة 1 نوفمبر، رأس السنة الميلادية، رأس السنة الأمازيغية يناير 12 جانفي، عيد العمال 1 ماي) والأعياد الدينية الهجرية (عيد الفطر، عيد الأضحى، المولد النبوي، أول محرم، وعاشوراء).
- **📆 أنماط عرض متعددة**: عرض شهري، أسبوعي، يومي، وقائمة أجندة مع تصنيفات لونية للأحداث (عمل، شخصي، اجتماعات، طارئ).
- **💾 استقلالية تامة وتصدير iCalendar**: استيراد وتصدير ملفات التقويم القياسية `.ics` والطباعة مع الحفظ التلقائي محلياً.

```bash
# تشغيل DZ-Calendar على المنفذ 3027
npm run start:calendar
```

---

### 17. 📚 الموسوعة وقواعد المعرفة السيادية DZ-Wiki
> **منصة التوثيق المعرفي الداخلي، تحرير الماركداون، وقوالب النصوص الإدارية الجزائرية**  
> *المنفذ: `:3028` • المسار: [`apps/productivity/dz-wiki/`](apps/productivity/dz-wiki/) • [🚀 تجربة البرنامج مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/productivity/dz-wiki/)*

- **📑 شجرة مستندات ومحرر ماركداون مباشر**: نافذة تقسيم ثنائية (محرر مباشر + معاينة آنية) مع توليد تلقائي لفهرس المحتويات وتلوين الأكواد.
- **🏛️ قوالب وثائق وطنية مدمجة**: قوالب جاهزة للقوانين الأساسية للشركات (Statuts SARL/EURL)، لوائح العمل الداخلي، وأدلة الإجراءات الإدارية.
- **🔍 بحث محلي سريع وتصدير شامل**: بحث فوري في محتوى المقالات وتصديرها كصفحات HTML مستقلة أو حزم Markdown أو ملفات PDF مطبوعة.

```bash
# تشغيل DZ-Wiki على المنفذ 3028
npm run start:wiki
```

---

### 18. 🤝 إدارة علاقات العملاء والصفقات DZ-CRM
> **المنظومة السيادية لإدارة الزبائن، مسار الصفقات التفاعلي، وتوزيع المناطق عبر الـ 58 ولاية**  
> *المنفذ: `:3029` • المسار: [`apps/business-enterprise/dz-crm/`](apps/business-enterprise/dz-crm/) • [🚀 تجربة البرنامج مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/business-enterprise/dz-crm/)*

- **🎯 مسار صفقات كانبان التفاعلي**: سحب وإفلات بطاقات الفرص البيعية عبر مراحل البيع (عميل جديد، تم الاتصال، إرسال العرض، التفاوض، صفقة ناجحة، أو ملغاة).
- **🇩🇿 مطابقة الهويات الجبائية الجزائرية**: تسجيل بطاقات الزبائن مع المعرفات الجبائية الرسمية (NIF, NIS, RC, رقم المادة) وتوزيعها حسب الـ 58 ولاية.
- **📊 مؤشرات أداء فورية (KPIs)**: حساب فوري للقيمة الإجمالية لمسار الصفقات بالدينار الجزائري (DZD)، ومعدل التحويل ونسب الفوز.

```bash
# تشغيل DZ-CRM على المنفذ 3029
npm run start:crm
```

---

### 19. 📦 إدارة المخزون والمستودعات والباركود DZ-Inventory
> **منظومة إدارة المخازن، قراءة الباركود، وتقييم المخزون المالي الجزائري (FIFO / PMP)**  
> *المنفذ: `:3030` • المسار: [`apps/business-enterprise/dz-inventory/`](apps/business-enterprise/dz-inventory/) • [🚀 تجربة البرنامج مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/business-enterprise/dz-inventory/)*

- **🏷️ دليل المنتجات والباركود**: كتالوج شامل مع الترقيم التسلسلي، باركود EAN-13، حدود الأمان، وتنبيهات إعادة الطلب التلقائية.
- **💰 التقييم المالي وفق المعايير الجزائرية**: تقييم قيمة المخزون الإجمالية بالدينار الجزائري وفق طريقة السعر المتوسط المرجح (PMP) وطريقة ما يدخل أولاً يخرج أولاً (FIFO).
- **📋 سجل حركات الدخول والخروج**: توثيق متكامل لسندات الاستلام (Bon de Réception) وسندات التسليم (Bon de Livraison) والتسويات.

```bash
# تشغيل DZ-Inventory على المنفذ 3030
npm run start:inventory
```

---

### 20. ⚡ استوديو واجهات البرمجة السيادي DZ-API Studio
> **بيئة اختبار واجهات برمجة التطبيقات REST & GraphQL وتوليد الشيفرات البرمجية محلياً**  
> *المنفذ: `:3031` • المسار: [`apps/developer-tools/dz-api/`](apps/developer-tools/dz-api/) • [🚀 تجربة البرنامج مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/developer-tools/dz-api/)*

- **🚀 دعم كامل لبروتوكول HTTP**: إرسال طلبات GET, POST, PUT, PATCH, DELETE مع ترويسات ومعاملات ومحرر نصوص JSON متقدم.
- **💻 مولد شيفرات برمجية متعدد اللغات**: تصدير مباشر للطلبات إلى لغات cURL و JavaScript (Fetch/Axios) و Python و Rust و PHP.
- **🛡️ أمان وسيادة مطلقة 100%**: لا يتم إرسال أي بيانات إلى خوادم خارجية؛ تخزين محلي لبيئات العمل والتاريخ.

```bash
# تشغيل DZ-API Studio على المنفذ 3031
npm run start:api
```

---

### 21. ♟️ حزمة الألعاب التراثية والذكاء الاصطناعي المحلي (DZ Games Suite)
> **ألعاب الطاولة والذكاء التراثية والعالمية، محركات ذكاء اصطناعي مدمجة، وتوليد صوتي محلي 100%**  
> *المنافذ: `:3012 - :3017` • المسار: [`apps/games-interactive/`](apps/games-interactive/) • [🚀 تجربة الألعاب مباشرة](https://test-bit-sys.github.io/algerie-open-source/apps/games-interactive/dz-chess/)*

حزمة سيادية متميزة تضم 6 ألعاب تراثية وفكرية بنيت دون أي مكتبات خارجية، مع توليد الأصوات التفاعلية عبر Web Audio API وعزل كامل لاتجاه الرقعة لمنع تشوه التخطيط:

- **♟️ شطرنج الجزائر DZ-Chess (`:3012`)**: قواعد الاتحاد الدولي للشطرنج FIDE، محرك Minimax مع تقليم Alpha-Beta، فحص دقيق لكش ملك والتعادل، وتأمين اتجاه الإحداثيات (`a1..h8`) لمنع انعكاس المربعات والقطع في بيئة الـ RTL.
- **🔴 دامة جزائرية DZ-Dama (`:3013`)**: قواعد الدامة الجزائرية الأصيلة (الأكل الإجباري، سلاسل القفز المتتالية، وترقية الملك الطائر) مع محاذاة رقعة دقيقة.
- **🀫 دومينو الجزائر DZ-Domino (`:3014`)**: طقم الدومينو الكلاسيكي ذو 28 حجرة (Double-Six)، فتح الجولة بأعلى مضاعف، ذكاء اصطناعي يعتمد احتساب النقاط، حل البلوك (Blocked)، وإخفاء زر الجولة التالية تلقائياً أثناء اللعب النشط.
- **🎲 طاولة 31 الجزائرية DZ-Tawla (`:3015`)**: لعبة الطاولة التقليدية بمثلثات مدببة حقيقية فائقة الجمال (`clip-path: polygon`) وتدرجات خشبية دافئة، بدء الرمي التلقائي عند دور الذكاء الاصطناعي، طرد القطع للبار، وخروج القطع (Bear-off).
- **🟡 قوة 4 DZ-Puissance4 (`:3016`)**: لعبة ربط 4 أقراص مع ذكاء اصطناعي Lookahead، إصلاح تطابق النقر مع الأعمدة 1:1 دون أي انحراف بالـ RTL، وتصحيح أصوات الفوز والخسارة.
- **⚪ أوتيلو ريفيرسي DZ-Othello (`:3017`)**: لعبة أوتيلو الاستراتيجية مع ذكاء اصطناعي يمنح الأولوية للزوايا، واستمرار دور الذكاء الاصطناعي تلقائياً دون تجمد عند تمرير دور اللاعب البشري.

```bash
# تشغيل أي لعبة من الألعاب التراثية:
npm run start:chess       # :3012
npm run start:dama        # :3013
npm run start:domino      # :3014
npm run start:tawla       # :3015
npm run start:puissance4  # :3016
npm run start:othello     # :3017

# تشغيل اختبارات الألعاب الـ 56 المؤتمتة:
npm run test:games
```

---

### 22. 🎙️ استوديو الصوت وتسجيل الشاشة (DZ-Audio & DZ-Recorder)
> **تسجيل شاشة الحاسوب عالي الدقة وهندسة الصوت الرقمي مباشرة داخل المتصفح**  
> *المنافذ: `:3018, :3019` • المسارات: [`apps/video-montage/dz-recorder/`](apps/video-montage/dz-recorder/) و [`apps/multimedia/dz-audio/`](apps/multimedia/dz-audio/)*

- **🎥 تسجيل الشاشة DZ-Recorder (`:3018`)**: تسجيل الشاشة، النوافذ، أو الكاميرا مع دمج صوت الميكروفون والنظام، وإيقاف مؤقت، وتصدير فوري بصيغة WebM.
- **🎛️ هندسة الصوت DZ-Audio (`:3019`)**: استوديو موجات صوتية متعدد المسارات، تحليل الترددات، معالجة الصوت، والتحويل بين الصيغ.

```bash
npm run start:recorder    # :3018
npm run start:audio       # :3019
```

---

### 23. 📝 الملاحظات، المهام والتوقيع الرقمي (DZ-Notes, Tasks, Signature)
> **المفكرة الذكية، إدارة المهام الفردية، وتوثيق التوقيعات الرقمية بالأختام الوطنية**  
> *المنافذ: `:3020, :3021, :3022`*

- **📒 المفكرة DZ-Notes (`:3020`)**: كتابة الملاحظات بتنسيق غني وماركداون، البحث الفوري، وتشفير المحتوى محلياً.
- **✅ قائمة المهام DZ-Tasks (`:3021`)**: تتبع المهام اليومية مع المهام الفرعية والتواريخ النهائية ووسوم الأولوية وإحصاءات الإنجاز.
- **✍️ التوقيع الرقمي DZ-Signature (`:3022`)**: منصة متخصصة للتوقيع الرقمي المتجهي وتوليد بصمة التوثيق والأختام الإدارية.

```bash
npm run start:notes       # :3020
npm run start:tasks       # :3021
npm run start:signature   # :3022
```

---

### 24. ⏱️ تتبع الوقت ومواقيت الصلاة ومحول الوحدات (DZ-Time, Convert, Prayer)
> **تتبع ساعات العمل وفق قانون العمل 90-11، محول الوحدات، ومواقيت الصلاة لـ 58 ولاية**  
> *المنافذ: `:3023, :3024, :3025`*

- **⏱️ تتبع الوقت DZ-Time (`:3023`)**: احتساب ساعات العمل مع مراعاة قانون العمل الجزائري 90-11 وساعات الراحة والساعات الإضافية.
- **🔄 محول الوحدات DZ-Convert (`:3024`)**: تحويل دقيق بين الوحدات المترية، الدولية، التقليدية، وأسعار الصرف الرسمية لبنك الجزائر.
- **🕌 مواقيت الصلاة DZ-Prayer (`:3025`)**: الحساب الفلكي الدقيق لمواقيت الصلاة الخمس عبر كافة بلديات ودوائر الـ 58 ولاية مع بوصلة القبلة.

```bash
npm run start:time        # :3023
npm run start:convert     # :3024
npm run start:prayer      # :3025
```

---

## 🗺️ دليل المسارات الـ 11 وجدول كافة أنواع البرمجيات

تم تقسيم المستودع إلى **11 مساراً قطاعياً متخصصاً** لتغطية كافة احتياجات الإدارة، المؤسسات، التعليم، والمهن في الجزائر:

```
algerie-open-source/
├── apps/
│   ├── office-suite/            # المسار 01: برمجيات المكتب والوثائق (Word, Sheets, Slides, PDF)
│   ├── business-enterprise/      # المسار 02: إدارة الأعمال، الفوترة، المخازن، نقاط البيع، ERP
│   ├── finance-accounting/       # المسار 03: المحاسبة SCF، تصريح G50، الأجور CNAS، الصكوك
│   ├── multimedia/               # المسار 04: مشغلات الوسائط، المونتاج، وهندسة الصوت
│   ├── creative-tools/           # المسار 05: التصميم المتجه، الخط العربي، وتعديل الصور
│   ├── collaboration/            # المسار 06: محادثات الفرق، لوحات كانبان، والاجتماعات المحلية
│   ├── productivity/             # المسار 07: أدوات الإنتاجية، النظام، وحقيبة المواطن
│   ├── engineering/              # المسار 08: برمجيات CAD، الزلازل RPA 99/2003، الخرسانة DTR
│   ├── developer-tools/          # المسار 09: حزم بوابات الدفع SATIM/CIB، ومكتبة 58 ولاية
│   ├── education-academia/       # المسار 10: كشوف النقاط، التوزيع الزمني، ومذكرات التخرج
│   └── games-interactive/        # المسار 11: الألعاب الشعبية، مسابقات الولايات، محرك Godot
```

---

## ⚙️ المعمارية السيادية متعددة اللغات (Polyglot Sovereign Architecture)

لتحقيق أقصى درجات الأداء الرياضي والهندسي والارتباط المباشر مع عتاد الحاسوب، تعتمد المنظومة معمارية متوازية ذكية:

1. **المستوى الأول - محركات الأنظمة والعتاد (Rust Systems)**:
   - `DZ-DiskTree`: مسح عناقيد القرص وحجم الملفات الفعلي (Cluster Allocation) في **3.08 مللي ثانية** بملف تنفيذي مدمج لا يتجاوز 215 كيلوبايت.
   - `DZ-Archive`: ضغط وتشفير وفحص CRC-32 واختبار العتاد المتعدد الأنوية بمعدل يتجاوز **7,000 ميغابايت/ثانية**.
   - `DZ-DevTools`: أداة سطر أوامر Rust مستقلة ومكتبة 58 ولاية وحسابات مفاتيح CCP والـ RIP.
2. **المستوى الثاني - المحركات الهندسية والوسائط (Python 3.14)**:
   - `DZ-RPA`: محرك الحساب الزلزالي الجزائري الرسمي المعتمد على كود RPA 99 / Version 2003 (DTR-BC 2-48).
   - `DZ-Photo`: معالجة وتعديل الصور النقطية المتعددة الطبقات باستخدام Pillow و NumPy مع مرشحات الجزائر.
   - `DZ-Player`: معالجة الإشارات الصوتية (DSP) وتضخيم الصوت 300% وترميم ملفات الترجمة العربية Windows-1256.
3. **المستوى الثالث - المنظومات المالية والمحاسبية والمؤسسية (C# .NET 10)**:
   - `DZ-Compta`: محاسبة مالية وجبائية وفق النظام المحاسبي المالي الجزائري (SCF) بدقة `decimal` متناهية لمنع أي أخطاء في الفوارق المئوية.
   - `DZ-Paie`: حساب كشوف الأجور وسلم ضريبة الـ IRG واشتراكات الضمان الاجتماعي CNAS.
4. **المستوى الرابع - واجهات الويب الخفيفة الصامتة (Vanilla JS)**:
   - تجربة فورية مباشرة بنقرة واحدة عبر المتصفح دون تثبيت أي برامج أو متطلبات تشغيل.

---

## 💻 التشغيل السريع والأوامر والمنافذ

### 1. تشغيل المحركات الأصلية (Native Engines)
```bash
# فحص مساحات الأقراص بلغة Rust
npm run native:disk-tree

# ضغط واختبار كفاءة العتاد بلغة Rust (7,000+ MB/s)
npm run native:archive

# أدوات المطورين والـ 58 ولاية بلغة Rust CLI
npm run native:devtools

# الحسابات الزلزالية الجزائرية بلغة Python (RPA 99/2003)
npm run native:rpa

# معالجة الصور بالطبقات بلغة Python
npm run native:photo

# مشغل الوسائط ومعالجة الصوت DSP بلغة Python
npm run native:player

# المحاسبة المالية SCF بلغة C# .NET 10
npm run native:compta

# كشوف الأجور والـ IRG بلغة C# .NET 10
npm run native:paie

# فحص واختبار كافة المحركات الأصلية في ثوانٍ
npm run test:native
```

### 2. تشغيل واجهات الويب وتجربتها محلياً
```bash
# تشغيل البوابة المركزية لكافة التطبيقات على المنفذ 3000
npm start

# أو تشغيل أي برمجية مستقلة عبر منفذها:
npm run start:dz-facture    # :3000 (الفوترة ونقاط البيع)
npm run start:disk-tree     # :3001 (فاحص مساحات القرص)
npm run start:archive       # :3002 (الأرشفة والضغط)
npm run start:player        # :3003 (مشغل الوسائط)
npm run start:pdf           # :3004 (محرر وموثق PDF)
npm run start:whiteboard    # :3005 (السبورة البيضاء التفاعلية)
npm run start:word          # :3006 (كاتب الجزائر ومعالج النصوص)
npm run start:calc          # :3007 (جداول وحسابات الجزائر)
npm run start:slides        # :3008 (استوديو العروض التقديمية)
npm run start:devtools      # :3009 (أدوات المطورين والـ 58 ولاية)
npm run start:photo         # :3010 (استوديو تعديل الصور)
npm run start:boards        # :3011 (لوحات كانبان وإدارة المشاريع)
npm run start:chess         # :3012 (شطرنج الجزائر الذكي)
npm run start:dama          # :3013 (الدامة الشعبية الجزائرية)
npm run start:domino        # :3014 (الدومينو الشعبي المزدوج)
npm run start:tawla         # :3015 (الطاولة التقليدية / المحبوسة)
npm run start:puissance4    # :3016 (لعبة صف 4 الاستراتيجية)
npm run start:othello       # :3017 (عطيل / ريفيرسي الاستراتيجية)
npm run start:recorder      # :3018 (استوديو تصوير الشاشة والمونتاج)
npm run start:audio         # :3019 (استوديو مونتاج الصوت الرقمي)
npm run start:notes         # :3020 (المفكرة والسبورة الرقمية)
npm run start:tasks         # :3021 (تخطيط وإدارة المهام والمشاريع)
npm run start:signature     # :3022 (التوقيع والتأشير الرقمي للأوراق الرسمية)
npm run start:time          # :3023 (تتبع الوقت وساعات العمل - قانون 90-11)
npm run start:convert       # :3024 (محول العملات، الأراضي ومواد البناء)
npm run start:prayer        # :3025 (مواقيت الصلاة والقبلة والتقويم الوطني الجزائري)
npm run start:calendar      # :3027 (التقويم وجدولة المواعيد الوطنية)
npm run start:wiki          # :3028 (الموسوعة وقواعد المعرفة السيادية)
npm run start:crm           # :3029 (إدارة علاقات العملاء ومسار الصفقات)
npm run start:inventory     # :3030 (إدارة المخزون والمستودعات والباركود)
npm run start:api           # :3031 (استوديو واجهات البرمجة السيادي REST & GraphQL)
```

---

## 🤝 دليل المساهمة وتطوير المشاريع

نرحب بمساهمات المطورين، المهندسين، المصممين، المحاسبين، ورجال القانون الجزائريين:

1. قم بعمل **Fork** للمستودع وأنشئ فرعاً لميزتك (`git checkout -b feat/اسم-الميزة`).
2. التزم بالمعيار الهندسي لمشروع **HeyPuter** (جافاسكربت صافية، متجهات SVG داخل البرامج).
3. اضمن الدعم الثلاثي الكامل للغات مع أولوية واجهة العربية (RTL).
4. تحقق من خلو الكود من الأخطاء عبر (`node --check <file>`).
5. أرسل طلب دمج تفصيلي (**Pull Request**).

للمزيد من الإرشادات، يرجى الاطلاع على [دليل المساهمة (CONTRIBUTING.md)](docs/CONTRIBUTING.md).

---

## 📜 الترخيص والسيادة البرمجية

هذا المشروع منشور تحت رخصة **MIT** المفتوحة والمجانية — انظر ملف [LICENSE](LICENSE) لمزيد من التفاصيل.

*صُنعت هذه المنظومة بأيدي وعقول جزائرية حرة، من أجل سيادة واستقلالية برمجية وطنية كاملة.*
