# Games & Interactive Media (الألعاب والترفيه التفاعلي)
## DZ Games — Interactive Culture, Educational & Indie Games Track

[English](README.md) • [العربية](../../README.ar.md) • [Français](../../README.fr.md)

---

### Mission
Provide open-source game engines, assets, and games celebrating Algerian history, folklore, geography, and language, while offering Algerian indie game developers an open community to collaborate.

---

### Operational Board Games Suite (6 complete games — zero dependencies)

| Game | Port | Features |
| :--- | :--: | :--- |
| **`dz-chess`** (شطرنج) | 3012 | Full FIDE rules engine **verified by perft** (Kiwipete etc.), castling, en passant, promotion picker, SAN move list, threefold/50-move/insufficient-material draws, negamax α-β AI (3 levels), trilingual RTL UI, dark mode. |
| **`dz-dama`** (داما) | 3013 | English-draughts rules, forced captures (toggleable), multi-jump chains, mid-chain promotion stop, kings, minimax AI, trilingual UI. |
| **`dz-domino`** (دومينو) | 3014 | 28-tile double-six Draw Dominoes, 2-4 players vs AI, auto opening by highest double, draw-until-playable, blocked-round resolution, round scoring to target, heuristic AI. |
| **`dz-tawla`** (طاولة) | 3015 | Full Backgammon: bar re-entry, blots, closed points, must-play-dice + higher-die rules, doubles, bear-off with overshoot rule, PIP counter, Gammon/Backgammon scoring, AI planner. |
| **`dz-puissance4`** (رباعية) | 3016 | Connect Four with gravity, win-line highlight, draw detection, negamax AI to depth 8 (always wins/blocks), keyboard 1-7, trilingual UI. |
| **`dz-othello`** (أوثيلو) | 3017 | Reversi with full flip rules, forced passes, exact endgame solver for the last 8 empties, positional minimax AI, live counters. |

All games share the same architecture: **pure Node-testable engines** (`src/modules/engine.js`),
**pure AI** (`src/modules/ai.js`), trilingual dictionaries (AR/FR/EN + RTL/LTR), WebAudio
sound effects synthesized at runtime (zero files), dark mode, persisted preferences, and the
hardened shared static server (`tools/static-server.js`).
**56 automated tests** validate every engine: `npm test` inside each game folder.

### Planned Project Blueprints

| Project Identifier | Target Application | Key Features |
| :--- | :--- | :--- |
| **`dz-quiz-geo`** | **DZ-Geomania (تحدي الولايات)** | Interactive educational game testing knowledge of 58 Wilayas, historical monuments, culinary heritage, and Algerian geography. |
| **`dz-history`** | **DZ-Chronicles (ألعاب تاريخية تعليمية)** | Narrative interactive adventures exploring rich Algerian history (Numidia, Ottoman era, National Liberation War). |
| **`dz-ronda`** | **DZ-Ronda (روندة)** | The beloved Algerian card game — rondas, tringas and table sweeps. |
| **`dz-game-kit`** | **DZ Game Asset Starter Kit** | Free 2D/3D sprite packs, textures, traditional architectural models, and audio soundscapes for Algerian game developers (Godot / Unity). |

