/**
 * DZ-Tawla AI — greedy sequence planner over turnMoves with a positional
 * evaluation (pip race, hits, made points, blot exposure). Pure, testable.
 */

import { clone, applyMove, turnMoves, pipCount } from './engine.js';

function evaluateFor(state, color) {
  const foe = color === 'w' ? 'b' : 'w';
  let score = pipCount(state, foe) - pipCount(state, color);

  // Borne-off checkers and enemy checkers on the bar are strong.
  score += 30 * state.off[color] - 30 * state.off[foe];
  score += 8 * state.bar[foe];

  // Made points (2+ checkers) strengthen the structure; blots are risky.
  for (let p = 1; p <= 24; p++) {
    const v = state.points[p];
    if (color === 'w' && v >= 2) score += 4 + (p <= 6 ? 2 : 0);
    if (color === 'b' && v <= -2) score += 4 + (p >= 19 ? 2 : 0);
    if (color === 'w' && v === 1 && p > 6) score -= 3;
    if (color === 'b' && v === -1 && p < 19) score -= 3;
  }
  return score;
}

/**
 * Plans the full current turn: a list of single moves to play in order.
 * easy: greedy with noise | medium: greedy | hard: greedy + 1-step lookahead.
 * Returns [] when there is nothing to play.
 */
export function chooseTurnMoves(state, difficulty = 'medium') {
  let s = clone(state);
  const plan = [];
  let guard = 0;

  while (guard++ < 8) {
    const moves = turnMoves(s);
    if (moves.length === 0) break;

    let best = moves[0];
    if (difficulty === 'easy') {
      best = moves[Math.floor(Math.random() * moves.length)];
    } else {
      let bestScore = -Infinity;
      for (const m of moves) {
        const next = clone(s);
        applyMove(next, m);
        let score = evaluateFor(next, s.turn);
        if (difficulty === 'hard') {
          // 1-step lookahead: reply that maximizes the opponent's gain.
          const replies = turnMoves({ ...next, turn: next.turn === 'w' ? 'b' : 'w' });
          let worst = 0;
          for (const r of replies.slice(0, 12)) {
            const after = clone(next);
            after.turn = next.turn;
            applyMove(after, r);
            worst = Math.max(worst, evaluateFor({ ...after, turn: s.turn }, s.turn));
          }
          score -= 0.4 * worst;
        }
        if (difficulty === 'easy' || difficulty === 'medium') {
          score += Math.random() * (difficulty === 'easy' ? 30 : 4);
        }
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
    }

    plan.push(best);
    applyMove(s, best);
  }
  return plan;
}
