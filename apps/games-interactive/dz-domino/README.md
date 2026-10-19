# DZ-Domino (دومينو — Dominos)

**DZ Open Suite** — Track 11: Games & Interactive Media

لعبة الدومينو الجزائرية بثلاث لغات وبدون أي مكتبات خارجية: مجموعة Double-Six كاملة (28 حجراً)، من 2 إلى 4 لاعبين (بشر أو حاسوب)، القواعد الرسمية للدومينو بالسحب (Draw): من يملك أعلى دبل يفتتح، السحب من البنك عند عدم وجود رقعة مناسبة، الحجب يُحسم بأخف يد، ونقاط كل جولة = مجموع نقارات أيادي الخصوم حتى بلوغ الهدف (100 نقطة قابلة للتعديل).

## Quick Start
```bash
cd apps/games-interactive/dz-domino
npm start        # http://localhost:3014
npm test         # engine rules test suite (no dependencies)
```

## Rules implemented (Draw Dominoes)
- 28-tile double-six deck; 7 tiles per player; remaining tiles form the boneyard.
- Opening: the holder of the highest double plays it first (fallback: heaviest tile).
- A tile must match an open end; unmatched turns must DRAW from the boneyard
  (one tile per move, drawing repeats until a playable tile appears).
- When the boneyard is empty and no tile matches, the turn is a PASS.
- Round ends when a player empties their hand («Domino!») or the game is blocked
  (every player passed consecutively). The winner scores the sum of the
  opponents' remaining pips; a blocked round is won by the lightest hand
  (a tie scores nothing).
- First player to reach the target score (default 100) wins the match.

## Architecture
```text
dz-domino/
├── index.html
├── server.js              # hardened shared static server
├── src/
│   ├── styles.css
│   ├── i18n.js            # AR/FR/EN dictionary
│   ├── audio.js           # WebAudio SFX (zero files)
│   ├── modules/engine.js  # pure rules engine — Node-testable
│   ├── modules/ai.js      # heuristic AI — Node-testable
│   └── app.js             # UI controller
└── tests/engine.test.js   # rules correctness (node:test)
```

## License
MIT — Algeria Open Source Initiative.
