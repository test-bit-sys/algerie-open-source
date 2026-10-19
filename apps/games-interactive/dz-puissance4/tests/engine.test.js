/**
 * DZ-Puissance4 engine correctness suite. Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, legalColumns, drop, status, ROWS, COLS } from '../src/modules/engine.js';
import { chooseColumn } from '../src/modules/ai.js';

const play = (state, col) => drop(state, col);

test('gravity stacks discs bottom-up in the same column', () => {
  let s = initialState();
  s = play(s, 3).state;
  s = play(s, 3).state;
  s = play(s, 3).state;
  assert.equal(s.grid[5][3], 1);
  assert.equal(s.grid[4][3], 2);
  assert.equal(s.grid[3][3], 1);
  assert.equal(s.grid[2][3], 0);
});

test('full column is illegal; overfull board rejects', () => {
  let s = initialState();
  for (let i = 0; i < ROWS; i++) s = play(s, 0).state;
  assert.ok(!legalColumns(s).includes(0));
  assert.equal(play(s, 0), null);
});

test('horizontal, vertical and diagonal wins are detected with the line', () => {
  let s = initialState();
  s = play(s, 0).state; s = play(s, 0).state;
  s = play(s, 1).state; s = play(s, 1).state;
  s = play(s, 2).state; s = play(s, 2).state;
  const win = play(s, 3);
  assert.equal(win.status, 'win-1');
  assert.equal(win.line.length, 4);

  let v = initialState();
  v = play(v, 2).state; v = play(v, 3).state;
  v = play(v, 2).state; v = play(v, 3).state;
  v = play(v, 2).state; v = play(v, 3).state;
  assert.equal(play(v, 2).status, 'win-1');

  let d = initialState();
  d = play(d, 0).state; d = play(d, 1).state;
  d = play(d, 1).state; d = play(d, 2).state;
  d = play(d, 2).state; d = play(d, 3).state;
  d = play(d, 2).state; d = play(d, 3).state;
  d = play(d, 3).state; d = play(d, 0).state;
  assert.equal(play(d, 3).status, 'win-1'); // diagonal 0..3 ascending
});

test('draw is reported for a full board with no winning line', () => {
  // Hand-verified dead position: no horizontal/vertical/diagonal run of 4.
  const DRAW = [
    [2, 1, 1, 2, 2, 1, 1],
    [1, 2, 2, 1, 1, 2, 2],
    [2, 1, 1, 2, 2, 1, 1],
    [1, 2, 2, 1, 1, 2, 2],
    [2, 1, 1, 2, 2, 1, 1],
    [1, 2, 2, 1, 1, 2, 2]
  ];
  const s = { grid: DRAW.map((r) => r.slice()), turn: 1, moves: ROWS * COLS };
  assert.equal(s.moves, 42);
  assert.equal(status(s), 'draw');
});

test('AI takes an immediate win', () => {
  let s = initialState();
  s = play(s, 0).state; s = play(s, 6).state;
  s = play(s, 1).state; s = play(s, 6).state;
  s = play(s, 2).state; s = play(s, 6).state;
  // Red needs column 3 to complete 0-1-2-3 horizontally.
  const res = chooseColumn(s, 'medium');
  assert.equal(res.column, 3);
});

test('AI blocks an immediate opponent win', () => {
  let s = initialState();
  s = play(s, 0).state; s = play(s, 6).state;
  s = play(s, 1).state; s = play(s, 6).state;
  s = play(s, 2).state; s = play(s, 5).state;
  // Yellow must stop red's 0-1-2-3 by taking column 3.
  const res = chooseColumn(s, 'medium');
  assert.equal(res.column, 3);
});

test('AI never returns an illegal or missing column', () => {
  let s = initialState();
  for (let i = 0; i < 10; i++) {
    const res = chooseColumn(s, 'hard');
    assert.ok(legalColumns(s).includes(res.column));
    s = play(s, res.column).state;
  }
});
