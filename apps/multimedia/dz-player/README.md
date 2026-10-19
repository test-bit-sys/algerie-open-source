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

- **Algerian Open Media Library**: Built-in 100% offline WebAudio procedural synthesizers for immediate testing:
  - Kassaman National Anthem (Instrumental Synth with auto-synchronized Arabic lyrics)
  - Andalusian Classical Nuba (Traditional Maqam Hijaz)
  - 4K / 60FPS Broadcast Video & Audio Sync Test Pattern with SMPTE bars and 1kHz reference tone
- **Subtitle Studio & Cues Editor**: In-app subtitle visual customizer (font size, color, background, outline, vertical offset) plus interactive cue search, inline editing, and instant export to `.srt` / `.vtt`.
- **4-Mode Real-Time Audio Visualizer**: Frequency bars with color gradient, Oscilloscope waveform, Radial circular spectrum, and dual-channel Stereo VU Meter.
- **Standalone Desktop Launcher**: Run natively via `run-player.bat` in app mode without browser URL bars.

### Running DZ-Player
```bash
# 1-Click Desktop App (Windows)
run-player.bat

# Or launch via npm
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
1. **واجهة وقوائم VLC الأصلية**: شريط قوائم علوي كامل (`Media`, `Playback`, `Audio`, `Video`, `Subtitle`, `Tools`, `View`, `Help`)، شاشة عرض داكنة بشعار المخروط، وشريط تحكم سفلي احترافي مع إخفاء تلقائي عند ملء الشاشة.
2. **تضخيم الصوت الفائق حتى 300%**: شريط صوت بمؤشر رقمي حقيقي يتجاوز الحدود التقليدية ليصل إلى **300%** لمعالجة المقاطع الضعيفة عبر عقدة `GainNode` مع تنبيهات لونية مرئية.
3. **نافذة المؤثرات والمرشحات الموحدة (Ctrl+E)**:
   - **معادل صوتي 10 حزم (Graphic Equalizer)**: ترددات قياسية (من 60Hz إلى 16kHz) مع 17 قالباً جاهزاً (Rock, Pop, Classical, Flat, Full Bass, Voice, ...).
   - **محلل ترددات بـ 4 أنماط**: أعمدة التردد المتدرجة، ومخطط الموجة (Oscilloscope)، والمخطط الدائري، ومقياس VU للاستريو.
   - **ضاغط الصوت الديناميكي (Audio Compressor)**: تنظيم احترافي لعتبة الصوت (Threshold)، النسبة (Ratio)، والحدة (Attack/Release).
   - **هندسة وألوان الفيديو**: تدوير الفيديو بـ 90°/180°/270°، الانعكاس الأفقي والرأسي، ونسب الأبعاد (Auto, 16:9, 4:3, 21:9, Cover, Fill).
   - **تزامن الصوت والترجمة**: معالجة التأخير أو التقديم بالمللي ثانية لضمان التزامن السمعي البصري المثالي.
4. **حل معضلة ترميز الترجمة العربية واستوديو التحرير**:
   - كشف تلقائي ذكي لترميز الحواسيب القديمة `Windows-1256 / CP-1256` وتحويلها لخط عربي واضح.
   - استوديو الترجمة: تخصيص الحجم، واللون، ونمط الخلفية (ظل، صندوق، شريط)، مع جدول تفاعلي للبحث وتعديل وتصدير نصوص SRT وVTT.
5. **المكتبة النموذجية للوسائط الجزائرية (Offline Media)**:
   - النشيد الوطني الجزائري (قسماً) بنغمات ونحاسيات توليدية مدمجة مع الأبيات الشعرية.
   - نوبة أندلسية جزائرية ومقامات العود التراثية.
   - مقطع اختبار ومزامنة الصوت والصورة بدقة 60fps ونغمة 1000Hz القياسية.
6. **حلقة التكرار A-B Loop والإشارات المرجعية (Ctrl+B)**: تحديد علامات البداية والنهاية على شريط التمرير مع حفظ اللحظات الهامة.
7. **التقاط الإطارات (Snapshots)**: حفظ لقطات شاشة نقية للإطار المعروض بدقته الأصلية كصورة PNG مع تطبيق التدوير والتأثيرات.

### التشغيل المباشر
```bash
# تشغيل نافذة سطح المكتب المستقلة (Windows)
run-player.bat

# أو عبر npm
npm run start:player
```
افتح المتصفح على: **[http://localhost:3003](http://localhost:3003)**

---

<a name="fr"></a>
## Documentation en Français (French Documentation)

### Vue d'ensemble
**DZ-Player** est une alternative libre, moderne et performante à **VLC Media Player**. Conçu selon le standard **HeyPuter/everything**, il fonctionne de manière 100% hors-ligne (Offline-First) avec une interface trilingue (Arabe, Français, Anglais), sans aucun emoji et avec des icônes vectorielles SVG épurées.

### Fonctionnalités Clés
- **Interface Authentique VLC** : Barre de menus complète, viewport sombre avec cône emblématique et barre de contrôle de lecture avec masquage automatique en plein écran.
- **Super-Amplification jusqu'à 300%** : Traitement via `GainNode` permettant de porter le volume sonore à 300% avec alertes visuelles.
- **Panneau Unifié des Effets (Ctrl+E)** :
  - Égaliseur 10 bandes (60Hz à 16kHz) avec 17 profils préconfigurés.
  - Visualiseur 4 modes : Barres de fréquences, Oscilloscope, Spectre radial et VU-mètre stéréo.
  - Compresseur audio dynamique avec régulation du seuil et du ratio.
  - Géométrie vidéo (rotation 90°/180°/270°, miroir) et étalonnage des couleurs.
  - Synchronisation audio et sous-titres au millième de seconde.
- **Bibliothèque Multimédia Algérienne Intégrée** : Synthèse procédurale WebAudio de l'Hymne National Kassaman, Nuba Andalouse, et mire de test vidéo 60fps.
- **Détection Automatique & Studio des Sous-Titres Arabes** : Détection intelligente des encodages `Windows-1256` et `UTF-8`, éditeur de répliques et export SRT/VTT.
- **Boucle A-B & Snapshots** : Répétition de segment avec drapeaux de repères et capture d'image haute définition en un clic.

### Lancement
```bash
# Lanceur bureau 1-clic Windows
run-player.bat

# Ou via npm
npm run start:player
```
Disponible sur : **[http://localhost:3003](http://localhost:3003)**

