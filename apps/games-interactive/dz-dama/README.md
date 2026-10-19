# DZ-Dama (داما — Jeu de dames — Checkers)

**DZ Open Suite** — Track 11: Games & Interactive Media

لعبة الداما الجزائرية بثلاث لغات وبدون أي مكتبات خارجية: قواعد English draughts الكاملة (الأخذ الإجباري قابل للتبديل، سلاسل الأخذ المتعددة، الترقية للداما، منع الأخذ للخلف للبيادق العادية)، ذكاء اصطناعي minimax بثلاث مستويات، تراجع، وضع ليلي، ومؤثرات صوتية — 100% بدون إنترنت.

## Quick Start
```bash
cd apps/games-interactive/dz-dama
npm start        # http://localhost:3013
npm test         # engine rules test suite (no dependencies)
```

## Rules implemented (English draughts)
- 8×8 board, 12 pieces each on dark squares; White opens.
- Men move one step diagonally forward; they capture by jumping forward only.
- Kings (pieces reaching the last row) move and capture in all 4 diagonals.
- Captures chain: a piece keeps jumping while further captures exist.
- A man promoted mid-chain STOPS its move immediately (official rule).
- Forced captures (default ON) can be toggled off for casual play.
- Win: the opponent has no legal move. Draw: 60 plies with no capture/promotion.

## Architecture
```text
dz-dama/
├── index.html
├── server.js              # hardened shared static server
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable
│   ├── modules/ai.js      # minimax AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # rules correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
