<div align="center">

# DZ-Player
### High-Performance Open-Source Media Player & Advanced Audio/Video Effects Suite
**1:1 Desktop Alternative to VLC Media Player • 100% Offline-First • 300% Volume Super-Boost**

[![License: MIT](https://img.shields.io/badge/License-MIT-008744.svg?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](../../../LICENSE)
[![Architecture: HeyPuter Vanilla JS](https://img.shields.io/badge/Architecture-HeyPuter_Vanilla_JS-1e293b.svg?style=for-the-badge&logo=javascript&logoColor=F7DF1E)](#technical-architecture)
[![Port: 3003](https://img.shields.io/badge/Port-3003-0284c7.svg?style=for-the-badge)](#running-dz-player)
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
**DZ-Player** is a 100% offline-first, desktop-grade alternative to **VLC Media Player**. Engineered to the **HeyPuter/everything** standard using native Vanilla JavaScript ES Modules, the Web Audio API, and hardware-accelerated video filters, it reproduces the iconic VLC desktop experience without external frameworks or telemetry.

### Key Reverse Engineering (REA) Insights
Binary investigation of VLC Media Player (`vlc.exe`, `libvlccore.dll`, and filter modules) established the functional baseline for DZ-Player:
- **Audio Processing Pipeline**: Implementing an interactive multi-node Web Audio graph consisting of a 10-band biquad filter bank, a dynamic range compressor node, a variable gain amplification node capable of clean 300% boost, and a stereo balance panner.
- **Arabic Subtitle Auto-Detection**: Eliminating historical character corruption (`ãÑÍÈÇ Èßã` / `Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©`) by dynamically detecting `Windows-1256 / CP-1256` byte sequences versus `UTF-8` and rendering Arabic text with native right-to-left (RTL) alignment.
- **Temporal Synchronization**: Millisecond-accurate audio delay/advance and subtitle drift adjustment.

### Production Features
- **Authentic VLC Desktop Layout**: Classic menu bar (`Media`, `Playback`, `Audio`, `Video`, `Subtitle`, `Tools`, `View`, `Help`), dark high-contrast video viewport with orange cone emblem, and bottom control bar.
- **300% Volume Super-Boost**: Custom `GainNode` pipeline capable of clean amplification up to 300% with a live percentage indicator badge.
- **Unified "Adjustments and Effects" Window (Ctrl+E)**:
  - **10-Band Graphic Equalizer**: Standard frequencies (60Hz, 170Hz, 310Hz, 600Hz, 1kHz, 3kHz, 6kHz, 12kHz, 14kHz, 16kHz) with presets (Rock, Pop, Classical, Flat, Full Bass, Voice).
  - **Audio Compressor**: Full dynamic range regulation (`DynamicsCompressorNode`) with Threshold, Knee, Ratio, Attack, and Release controls.
  - **Video Geometry & Colors**: Real-time 90°/180°/270° rotation, horizontal flip, brightness, contrast, saturation, and hue rotation.
  - **Synchronization**: Sub-millisecond audio and subtitle track synchronization delay/advance controls.
- **Playback Control**: A-B repeat looping, frame-by-frame snapshot capture, and network stream playback (HTTP/HTTPS/HLS).

### Running DZ-Player
```bash
# Launch from repository root
npm run start:player

# Or run directly from app directory
cd apps/multimedia/dz-player
node server.js
```
Open **[http://localhost:3003](http://localhost:3003)** in your browser.

---

<a name="ar"></a>
## التوثيق باللغة العربية (Arabic Documentation)

### نظرة عامة
**DZ-Player** هو مشغل وسائط متعددة عالي الأداء، مفتوح المصدر بنسبة 100% وبديل متطابق لبرنامج **VLC Media Player**. صُمم وفق معايير مشروع **HeyPuter/everything** بالاعتماد الحصري على JavaScript الصافي (Modern ES Modules) وواجهات المتصفح الحديثة (Web Audio API, Canvas 2D) دون أي مكتبات ثقيلة أو اتصال خارجي (Offline-First).

### قدرات وخصائص البرنامج المكتملة 1:1
1. **واجهة وقوائم VLC الأصلية**: شريط قوائم علوي كامل (`Media`, `Playback`, `Audio`, `Video`, `Subtitle`, `Tools`, `View`, `Help`)، شاشة عرض داكنة بشعار المخروط، وشريط تحكم سفلي احترافي.
2. **تضخيم الصوت الفائق حتى 300%**: شريط صوت بمؤشر رقمي حقيقي يتجاوز الحدود التقليدية ليصل إلى **300%** لمعالجة المقاطع الضعيفة عبر عقدة `GainNode`.
3. **نافذة المؤثرات والمرشحات الموحدة (Ctrl+E)**:
   - **معادل صوتي 10 حزم (Graphic Equalizer)**: ترددات قياسية (من 60Hz إلى 16kHz) مع قوالب جاهزة (Rock, Pop, Classical, Flat, Full Bass, Voice).
   - **ضاغط الصوت الديناميكي (Audio Compressor)**: تنظيم احترافي لعتبة الصوت (Threshold)، النسبة (Ratio)، والحدة (Attack/Release).
   - **هندسة وألوان الفيديو**: تدوير الفيديو بـ 90°/180°/270°، الانعكاس الأفقي، وضبط السطوع والتباين والتشبع ودرجة اللون.
   - **تزامن الصوت والترجمة**: معالجة التأخير أو التقديم بالمللي ثانية لضمان التزامن السمعي البصري المثالي.
4. **حل معضلة ترميز الترجمة العربية**: محرك ذكي يتعرف تلقائياً على بايتات الحروف العربية بترميز `Windows-1256 / CP-1256` أو `UTF-8` ويقوم بفك تشفيرها وإظهارها فوراً بخط عربي واضح مع محاذاة تلقائية لليمين (RTL).
5. **حلقة التكرار A-B Loop**: إعادة تشغيل مقطع محدد تلقائياً عبر تحديد نقطتي البداية والنهاية.
6. **التقاط الإطارات (Snapshots)**: حفظ لقطات شاشة نقية للإطار المعروض بدقته الأصلية كصورة PNG.

### التشغيل المباشر
```bash
npm run start:player
```
افتح المتصفح على: **[http://localhost:3003](http://localhost:3003)**

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-Player** est une alternative libre, moderne et performante à **VLC Media Player**. Conçu selon le standard **HeyPuter/everything**, il fonctionne de manière 100% hors-ligne (Offline-First) avec une interface trilingue (Arabe, Français, Anglais), sans aucun emoji et avec des icônes vectorielles SVG épurées.

### Fonctionnalités Clés
- **Interface Authentique VLC** : Barre de menus complète, viewport sombre avec cône emblématique et barre de contrôle de lecture.
- **Super-Amplification jusqu'à 300%** : Traitement via `GainNode` permettant de porter le volume sonore à 300%.
- **Panneau Unifié des Effets (Ctrl+E)** :
  - Égaliseur 10 bandes (60Hz à 16kHz) avec profils préconfigurés.
  - Compresseur audio dynamique avec régulation du seuil et du ratio.
  - Géométrie vidéo (rotation 90°/180°/270°, miroir) et étalonnage des couleurs.
  - Synchronisation audio et sous-titres au millième de seconde.
- **Détection Automatique des Sous-Titres Arabes** : Détection intelligente des encodages `Windows-1256` et `UTF-8`.
- **Boucle A-B & Snapshots** : Répétition de segment et capture d'image haute définition en un clic.

### Lancement
```bash
npm run start:player
```
Disponible sur : **[http://localhost:3003](http://localhost:3003)**
