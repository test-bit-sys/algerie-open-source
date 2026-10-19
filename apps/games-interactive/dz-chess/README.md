# DZ-Chess (شطرنج — Échecs — Chess)

**DZ Open Suite** — Track 11: Games & Interactive Media

منظومة شطرنج جزائرية مفتوحة المصدر، 100% بدون إنترنت وبلا أي مكتبات خارجية: قواعد **FIDE كاملة** (التبييت، الأخذ بالتجاوز، الترقية، الكش، الكش مات، التعادل بالجمود/التكرار/الخمسون نقلة/عدم كفاية المواد)، ذكاء اصطناعي Minimax مع تقليم ألفا-بيتا وثلاث مستويات صعوبة، ترقيم جبري SAN، وواجهة ثلاثية اللغات (عربية RTL / فرنسية / إنجليزية) مع وضع ليلي.

## Quick Start
```bash
cd apps/games-interactive/dz-chess
npm start        # http://localhost:3012
npm test         # perft engine correctness suite (no dependencies)
```

## Features
- Full legal-move generation (pinned pieces, check filtering) — validated by standard **perft** positions (Kiwipete etc.)
- Castling (short/long) with every legality condition, en passant, promotion picker (Q/R/B/N)
- Checkmate / stalemate / 50-move / threefold repetition / insufficient-material draws
- Move list in SAN, undo, board flip, captured-material tracker, last-move & legal-move highlights
- AI: negamax + alpha-beta, MVV-LVA ordering, piece-square tables — 3 difficulty levels
- Local two-player mode or play White/Black vs the machine
- Trilingual UI (AR/FR/EN), RTL/LTR, dark mode, WebAudio sound effects — all offline

## Architecture
```text
dz-chess/
├── index.html
├── server.js              # hardened shared static server (tools/static-server.js)
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable, no DOM
│   ├── modules/ai.js      # negamax + alpha-beta AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # perft + rules correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
