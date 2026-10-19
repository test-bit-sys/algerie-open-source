/**
 * DZ-Domino AI — heuristic placement engine. Pure, Node-testable.
 * easy: random legal placement | medium: dump heavy tiles & doubles |
 * hard: + end-control heuristics (keep playable ends, starve opponents).
 */

import { legalMoves, ends, tilePips } from './engine.js';

export function chooseMove(state, difficulty = 'medium') {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves[0].type !== 'place') return { move: moves[0] };
  if (difficulty === 'easy') {
    return { move: moves[Math.floor(Math.random() * moves.length)] };
  }

  const seat = state.turn;
  const hand = state.hands[seat];
  const e = ends(state);

  let best = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    const tile = hand.find((t) => t.id === move.tileId);
    let score = tilePips(tile);            // dump heavy tiles first
    if (tile.a === tile.b) score += 6;     // doubles are inflexible: shed them

    if (difficulty === 'hard') {
      const newLeft = move.end === 'left'
        ? (tile.b === e.left ? tile.a : tile.b)
        : e.left;
      const newRight = move.end === 'right'
        ? (tile.a === e.right ? tile.b : tile.a)
        : e.right;
      const remaining = hand.filter((t) => t.id !== tile.id);
      const values = new Set(remaining.flatMap((t) => [t.a, t.b]));
      if (values.has(newLeft)) score += 4;   // keep a playable end for ourselves
      if (values.has(newRight)) score += 4;
      if (!values.has(newLeft) && !values.has(newRight)) score += 3; // starve the table
    }

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return { move: best, score: bestScore };
}
