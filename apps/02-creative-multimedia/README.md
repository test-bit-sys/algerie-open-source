# 🎬 Track 02: Creative & Multimedia Software
## قسم برمجيات المونتاج، الوسائط والتصميم

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### 🎯 Overview
This track addresses the urgent need among Algerian digital creators, students, and media agencies for lightweight, accessible, and modern open-source media editing tools that run smoothly on standard consumer laptops without high subscription fees or cracked software risks.

---

### 📋 Planned Projects & Specifications

| Program ID | Algerian Target Application | Proprietary Alternative Replaced | Key Features |
| :--- | :--- | :--- | :--- |
| **`dz-video`** | **DZ-Studio Cut (مونتاج الفيديو)** | Adobe Premiere Pro, CapCut PC | Lightweight non-linear video editor (NLE) based on FFmpeg & WebGPU, timeline multi-track editing, Arabic subtitle auto-align (RTL without letter reversal), hardware acceleration. |
| **`dz-photo`** | **DZ-Design Photo (تعديل الصور والتصميم)** | Adobe Photoshop, Canva Pro | Layer-based raster & vector design, preset templates for Algerian social media (Facebook/Instagram store posts, billboard dimensions), Arabic calligraphic text support. |
| **`dz-audio`** | **DZ-Sound Studio (هندسة الصوت والبودكاست)** | Adobe Audition, FL Studio | Multi-track audio recording, noise removal, podcast mastering, voiceover leveling, MP3/WAV/AAC export. |
| **`dz-screen`** | **DZ-Capture (تسجيل الشاشة والدروس)** | Camtasia, Bandicam | Ultra-light screen and webcam recorder for Algerian teachers and online course creators with live cursor spotlight and one-click compression. |

---

### 🏗️ Technical Architecture
* **Core Processing Engine:** Rust + FFmpeg / WebCodecs / WebGPU
* **UI Layer:** Native responsive canvas with bi-directional Arabic/French typography support
