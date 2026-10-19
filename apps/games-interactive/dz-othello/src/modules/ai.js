/**
 * DZ-Othello AI — minimax with alpha-beta pruning, positional weights,
 * mobility and exact disc-count endgame for the final 8 empties.
 */

import { legalMoves, countDiscs, SIZE } from './engine.js';

// Classic positional weights (corners best, X/C squares dangerous).
const W = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120
];
const weightAt = (r, c) => W[r * SIZE + c];

export function evaluate(state) {
  const { black, white } = countDiscs(state);
  const empties = 64 - black - white;

  // Exact endgame: raw disc difference decides.
  if (empties <= 8) return black - white;

  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = state.grid[r][c];
      if (v === 1) score += weightAt(r, c);
      else if (v === 2) score -= weightAt(r, c);
    }
  }
  // Mobility: more legal moves is better.
  const mine = legalMoves(state).length;
  const theirs = legalMoves({ ...state, turn: state.turn === 1 ? 2 : 1 }).length;
  score += 8 * (mine - theirs);
  return score; // black-positive
}

function negamax(state, depth, alpha, beta) {
  if (state.gameOver || depth === 0) {
    const e = evaluate(state);
    return state.turn === 1 ? e : -e;
  }
  const moves = legalMoves(state);
  if (moves.length === 0) {
    // Should not normally happen (makeMove auto-passes), defensive:
    return -negamax({ ...state, turn: state.turn === 1 ? 2 : 1 }, depth - 1, -beta, -alpha);
  }
  let best = -Infinity;
  for (const move of moves) {
    const next = makeMoveAI(state, move);
    const score = -negamax(next, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const makeMoveAI = (state, move) => {
  // Reuse engine semantics without importing makeMove (avoids circular naming):
  const grid = state.grid.map((r) => r.slice());
  grid[move.row][move.col] = state.turn;
  for (const [r, c] of move.flips) grid[r][c] = state.turn;
  let turn = state.turn === 1 ? 2 : 1;
  let passes = 0;
  let gameOver = grid.every((row) => row.every((v) => v !== 0));
  if (!gameOver && legalMoves({ grid, turn, passes, moves: state.moves + 1 }).length === 0) {
    turn = state.turn;
    passes = state.passes + 1;
    gameOver = passes >= 2;
  }
  return { grid, turn, passes, moves: state.moves + 1, gameOver };
};

/**
 * difficulty: 'easy' (depth 1, random) | 'medium' (3) | 'hard' (5)
 * Returns { move, score } or null when no legal move exists.
 */
export function chooseMove(state, difficulty = 'medium') {
  const depth = { easy: 1, medium: 3, hard: 5 }[difficulty] ?? 3;
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (difficulty === 'easy') {
    return { move: moves[Math.floor(Math.random() * moves.length)] };
  }

  let best = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  for (const move of moves) {
    const next = makeMoveAI(state, move);
    const score = -negamax(next, depth - 1, -Infinity, -alpha);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
    if (score > alpha) alpha = score;
  }
  return { move: best, score: bestScore };
}
