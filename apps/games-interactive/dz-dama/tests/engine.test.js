/**
 * DZ-Dama engine correctness suite. Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, generateMoves, makeMove, gameStatus, moveToLabel, sq
} from '../src/modules/engine.js';
import { chooseMove } from '../src/modules/ai.js';

const custom = (pieces, turn = 'w', forced = true) => ({
  board: (() => {
    const b = new Array(64).fill('');
    for (const [idx, p] of pieces) b[idx] = p;
    return b;
  })(),
  turn,
  forcedCaptures: forced,
  quiet: 0
});

test('opening position offers exactly the 7 classic first moves', () => {
  const moves = generateMoves(initialState());
  assert.equal(moves.length, 7);
  assert.ok(moves.every((m) => m.captured.length === 0));
  assert.equal(initialState().board.filter((p) => p === 'w').length, 12);
  assert.equal(initialState().board.filter((p) => p === 'b').length, 12);
});

test('forced capture: only the capture is generated', () => {
  const s = custom([[sq(5, 2), 'w'], [sq(4, 3), 'b']]);
  const moves = generateMoves(s);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].captured.length, 1);
  const next = makeMove(s, moves[0]);
  assert.equal(next.board[sq(4, 3)], '');
  assert.equal(next.board[sq(3, 4)], 'w');
  assert.equal(moveToLabel(moves[0]), 'c3\u00D7e5');
});

test('forced captures can be disabled for casual play', () => {
  const s = custom([[sq(5, 2), 'w'], [sq(4, 3), 'b']], 'w', false);
  const moves = generateMoves(s);
  assert.equal(moves.length, 2); // one capture + one quiet step
  assert.equal(moves.filter((m) => m.captured.length).length, 1);
});

test('multi-jump chains capture every jumped piece and must continue', () => {
  const s = custom([[sq(5, 2), 'w'], [sq(4, 3), 'b'], [sq(2, 3), 'b']]);
  const moves = generateMoves(s);
  assert.equal(moves.length, 1, 'only the full chain is legal');
  assert.equal(moves[0].captured.length, 2);
  const next = makeMove(s, moves[0]);
  assert.equal(next.board[sq(4, 3)], '');
  assert.equal(next.board[sq(2, 3)], '');
  assert.equal(next.board[sq(1, 2)], 'w');
});

test('men capture forward only; kings capture in all four diagonals', () => {
  const manState = custom([[sq(3, 4), 'w'], [sq(4, 5), 'b']]);
  assert.equal(generateMoves(manState).filter((m) => m.captured.length).length, 0);

  const kingState = custom([[sq(3, 4), 'W'], [sq(4, 5), 'b']]);
  const caps = generateMoves(kingState).filter((m) => m.captured.length);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].to, sq(5, 6));
});

test('kings chain captures across changing directions', () => {
  const s = custom([[sq(3, 2), 'W'], [sq(4, 3), 'b'], [sq(4, 5), 'b']]);
  const chain = generateMoves(s).find((m) => m.captured.length === 2);
  assert.ok(chain, 'two-jump king chain must exist');
  const next = makeMove(s, chain);
  assert.equal(next.board[sq(3, 6)], 'W');
  assert.equal(next.board[sq(4, 3)], '');
  assert.equal(next.board[sq(4, 5)], '');
});

test('promotion via capture crowns the piece on the last row', () => {
  const s = custom([[sq(2, 3), 'w'], [sq(1, 4), 'b']]);
  const moves = generateMoves(s);
  assert.equal(moves.length, 1);
  const next = makeMove(s, moves[0]);
  assert.equal(next.board[sq(0, 5)], 'W');
});

test('side with no legal move loses; quiet plies lead to a draw', () => {
  const noBlack = custom([[sq(5, 2), 'w']], 'b');
  assert.equal(gameStatus(noBlack), 'win-w');

  const quiet = { ...custom([[sq(5, 2), 'w'], [sq(0, 1), 'b']]), quiet: 60 };
  assert.equal(gameStatus(quiet), 'draw');
});

test('AI obeys forced captures at every difficulty', () => {
  const s = custom([[sq(5, 2), 'w'], [sq(4, 3), 'b']]);
  for (const level of ['easy', 'medium', 'hard']) {
    const res = chooseMove(s, level);
    assert.equal(res.move.captured.length, 1);
  }
});
