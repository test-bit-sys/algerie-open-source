/**
 * DZ-Dama AI — negamax with alpha-beta pruning, capture-first ordering,
 * material + advancement + structure evaluation. Pure, Node-testable.
 */

import { generateMoves, makeMove, colorOf, isKing, sqRank, sqFile, gameStatus } from './engine.js';

export function evaluate(state) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p === '') continue;
    const white = colorOf(p) === 'w';
    const r = sqRank(i);
    const f = sqFile(i);

    let v = isKing(p) ? 240 : 100;
    if (!isKing(p)) v += (white ? 7 - r : r) * 4; // advancement
    if (r === (white ? 7 : 0)) v += 14;            // back-row guard
    if (f >= 2 && f <= 5) v += 4;                  // central files

    score += white ? v : -v;
  }
  return score; // white-perspective centipawns
}

function negamax(state, depth, alpha, beta) {
  const moves = generateMoves(state);
  if (moves.length === 0) return -(10000 + depth); // side to move has lost
  if (depth === 0) {
    const e = evaluate(state);
    return state.turn === 'w' ? e : -e;
  }
  moves.sort((a, b) => b.captured.length - a.captured.length);
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(makeMove(state, m), depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * difficulty: 'easy' (depth 1, human-like randomness) | 'medium' (3) | 'hard' (5)
 * Returns { move, score } or null when no legal move exists.
 */
export function chooseMove(state, difficulty = 'medium') {
  const depth = { easy: 1, medium: 3, hard: 5 }[difficulty] ?? 3;
  const moves = generateMoves(state);
  if (moves.length === 0) return null;

  let bestScore = -Infinity;
  let bestMoves = [];
  let alpha = -Infinity;

  for (const move of moves) {
    const score = -negamax(makeMove(state, move), depth - 1, -Infinity, -alpha);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
    if (score > alpha) alpha = score;
  }

  const pool = difficulty === 'easy'
    ? moves.filter((m) => {
      const s = -negamax(makeMove(state, m), 0, -Infinity, Infinity);
      return s >= bestScore - 60;
    })
    : bestMoves;

  return { move: pool[Math.floor(Math.random() * pool.length)], score: bestScore };
}
