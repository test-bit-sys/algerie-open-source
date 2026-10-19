# DZ-Othello (أوثيلو — Othello/Reversi)

**DZ Open Suite** — Track 11: Games & Interactive Media

أوثيلو بثلاث لغات وبدون مكتبات: قواعد الانقلاب الكاملة (الحركة القانونية تلزم انقلاباً واحداً على الأقل)، التمرير الإجباري عند انعدام الحركات، إنهاء اللعبة بامتلاء الرقعة أو مرور الطرفين، عدّ النهاية وتحديد الفائز، ذكاء اصطناعي **minimax موضعي مع حسم نهائي دقيق** في آخر 8 خانات فاضية — 100% بدون إنترنت.

## Quick Start
```bash
cd apps/games-interactive/dz-othello
npm start        # http://localhost:3017
npm test         # engine + AI test suite (no dependencies)
```

## Rules implemented
- 8×8 board, standard opening (4 centre discs), Black moves first.
- A move must flip at least one opponent line in any of the 8 directions.
- A player with no legal move PASSES automatically; the game ends when
  both players pass or the board fills. Highest disc count wins.

## Architecture
```text
dz-othello/
├── index.html
├── server.js              # hardened shared static server
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable
│   ├── modules/ai.js      # minimax AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # rules + AI correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
