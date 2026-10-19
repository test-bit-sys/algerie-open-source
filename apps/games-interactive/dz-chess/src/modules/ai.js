/**
 * DZ-Chess AI — negamax with alpha-beta pruning, MVV-LVA move ordering,
 * material + piece-square-table evaluation. Pure, Node-testable, no DOM.
 */

import { generateMoves, makeMove, gameStatus } from './engine.js';

const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Piece-square tables (white perspective; index 0 = a8).
// Reference: simplified evaluation tables from chessprogramming.org.
const PST = {
  P: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
  ],
  N: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
  ],
  B: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
  ],
  R: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0
  ],
  Q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
  ],
  K: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20
  ]
};

const mirror = (i) => ((i >> 3) ^ 7) * 8 + (i & 7);

/** Static evaluation from WHITE's perspective (centipawns). */
export function evaluate(state) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p === '') continue;
    const u = p.toUpperCase();
    const isWhite = p === u;
    const value = PIECE_VALUES[u] + PST[u][isWhite ? i : mirror(i)];
    score += isWhite ? value : -value;
  }
  return score;
}

function orderMoves(moves) {
  // MVV-LVA: most valuable victim, least valuable attacker first.
  return moves
    .map((m) => ({
      m,
      score:
        (m.captured ? 10 * PIECE_VALUES[m.captured.toUpperCase()] - PIECE_VALUES[m.piece.toUpperCase()] : 0) +
        (m.promotion ? PIECE_VALUES[m.promotion] : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

function negamax(state, depth, alpha, beta) {
  const moves = generateMoves(state);
  if (moves.length === 0) {
    // Mated (very bad, worse when it happens sooner) or stalemate (draw).
    return gameStatus(state) === 'checkmate' ? -(100000 + depth) : 0;
  }
  if (depth === 0) {
    const evalWhite = evaluate(state);
    return state.turn === 'w' ? evalWhite : -evalWhite;
  }

  let best = -Infinity;
  for (const move of orderMoves(moves)) {
    const score = -negamax(makeMove(state, move), depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Picks the best move for the side to move.
 * difficulty: 'easy' (depth 1, some randomness) | 'medium' (depth 2) | 'hard' (depth 3)
 * Returns { move, score } or null when no legal move exists.
 */
export function chooseMove(state, difficulty = 'medium') {
  const depth = difficulty === 'easy' ? 1 : difficulty === 'hard' ? 3 : 2;
  const moves = orderMoves(generateMoves(state));
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

  // 'easy' adds human imperfection: any near-best move may be played.
  const pool = difficulty === 'easy'
    ? moves.filter((m) => {
      const s = -negamax(makeMove(state, m), 0, -Infinity, Infinity);
      return s >= bestScore - 60;
    })
    : bestMoves;

  const move = pool[Math.floor(Math.random() * pool.length)];
  return { move, score: bestScore };
}
