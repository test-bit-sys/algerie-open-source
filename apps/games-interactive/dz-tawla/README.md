# DZ-Tawla (طاولة — Backgammon)

**DZ Open Suite** — Track 11: Games & Interactive Media

الطاولة الجزائرية بثلاث لغات وبدون أي مكتبات: **قواعد Backgammon الكاملة** — الدخول من البار أولاً، ضرب المفرادات وإرجاعها، منع الهبوط على نقطة مغلقة (قطرتان فأكثر)، قاعدة لعب النردتين معاً ما أمكن ووجوب الأكبر عند التعذر، الدوبلي أربع حركات، الإخراج Bear-off بقواعده الدقيقة (الاستخدام الأعلى مسموح عند عدم وجود قطع أبعد)، احتساب PIP، وحسم الفوز العادي/**الغمر Gammon ×2**/**الفوز الكامل Backgammon ×3** — مع ذكاء اصطناعي تقييمي وواجهة ثلاثية اللغات، 100% بدون إنترنت.

## Quick Start
```bash
cd apps/games-interactive/dz-tawla
npm start        # http://localhost:3015
npm test         # engine + AI test suite (no dependencies)
```

## Rules implemented
- Standard 24-point board, 15 checkers per side, White: 2-24, 5-13, 3-8, 5-6.
- White marches 24 → 1 then bears off from home (1-6); Black mirrors.
- Entering from the bar is mandatory before any other move.
- Closed points (2+ opponents) block; landing on a blot hits it to the bar.
- Doubles are played as four moves.
- You must play both dice when possible; when only one can ever be
  played, the higher die is forced (turnMoves enforces both rules).
- Bear-off: exact die, or a higher die when no farther checkers remain.
- Win: 15 borne off first. Gammon (×2) when the loser bore off none;
  Backgammon (×3) when the loser also has a checker on the bar or in the
  winner's home board. (Casual play: no doubling cube — by design.)

## Architecture
```text
dz-tawla/
├── index.html
├── server.js              # hardened shared static server
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable
│   ├── modules/ai.js      # heuristic AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # rules + AI correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
