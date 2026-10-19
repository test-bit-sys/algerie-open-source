# DZ-Puissance4 (الرباعية — Puissance 4 — Connect Four)

**DZ Open Suite** — Track 11: Games & Interactive Media

الرباعية بثلاث لغات وبدون مكتبات: قواعد الجاذبية الكاملة، كشف الفوز أفقي/رأسي/قطري مع توهيج الخط الرابح، التعادل عند امتلاء الرقعة، ذكاء اصطناعي **negamax مع تقليم ألفا-بيتا وعمق حتى 8** (يحسم الربح الفوري ويصد الخطر دائماً)، تراجع، اختصارات لوحة المفاتيح 1-7، وضع ليلي، وثلاث لغات — 100% بدون إنترنت.

## Quick Start
```bash
cd apps/games-interactive/dz-puissance4
npm start        # http://localhost:3016
npm test         # engine + AI test suite (no dependencies)
```

## Features
- 7×6 board with strict gravity rules (full column = illegal)
- Win detection in all four directions with the winning line highlighted
- Draw detection on a full board (hand-verified dead position in tests)
- AI: window-based evaluation + center-control, alpha-beta pruning,
  difficulty easy (depth 2 + noise) / medium (5) / hard (8)
- Undo (AI plies included), keyboard 1-7, local 2-player mode, play Red/Yellow
- Trilingual (AR/FR/EN) RTL/LTR, dark mode, WebAudio SFX

## Architecture
```text
dz-puissance4/
├── index.html
├── server.js              # hardened shared static server
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable
│   ├── modules/ai.js      # negamax AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # rules + AI correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
