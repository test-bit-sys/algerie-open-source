/**
 * DZ-Domino engine correctness suite. Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE_SET, newGameState, legalMoves, makeMove, ends, pipsOf,
  nextRound, clone, tilePips
} from '../src/modules/engine.js';
import { chooseMove } from '../src/modules/ai.js';

// rng() -> 0.9999 keeps the deck in id order, making deals fully predictable.
const ORDERED = () => 0.9999;

const fixture = (players = 2) => {
  const s = newGameState({ players, rng: ORDERED });
  s.chain = [{ a: 3, b: 5, id: 99 }];
  s.hands = Array.from({ length: players }, () => []);
  s.hands[0] = [
    { id: 1, a: 3, b: 0 },
    { id: 2, a: 5, b: 5 },
    { id: 3, a: 2, b: 2 }
  ];
  s.hands[1] = [{ id: 4, a: 6, b: 4 }, { id: 5, a: 1, b: 1 }];
  s.boneyard = [];
  s.turn = 0;
  s.passed = 0;
  s.scores = new Array(players).fill(0);
  s.log = [];
  return s;
};

test('complete 28-tile double-six deck totalling 168 pips', () => {
  assert.equal(TILE_SET.length, 28);
  assert.equal(new Set(TILE_SET.map((t) => `${t.a}-${t.b}`)).size, 28);
  assert.equal(pipsOf(TILE_SET), 168);
});

test('deals 7 tiles per player, opening tile auto-played, boneyard exact', () => {
  const four = newGameState({ players: 4, rng: ORDERED });
  four.hands.forEach((h) => assert.ok(h.length === 6 || h.length === 7)); // opener already played
  assert.equal(four.boneyard.length, 0);
  assert.equal(four.chain.length, 1);

  const two = newGameState({ players: 2 });
  assert.equal(two.hands[0].length + two.hands[1].length + two.boneyard.length, 27);
  assert.equal(two.chain.length, 1);
});

test('the holder of the highest double opens with it', () => {
  // Ordered deck: seat 3 receives (6,6) among ids 21-27.
  const s = newGameState({ players: 4, rng: ORDERED });
  assert.equal(s.chain[0].a, 6);
  assert.equal(s.chain[0].b, 6);
  assert.equal(s.turn, 0); // (opener 3 + 1) % 4
});

test('placements must match the open ends and orient correctly', () => {
  const s = fixture();
  const moves = legalMoves(s);
  assert.equal(moves.length, 2); // (3-0) on the left end, (5-5) on the right end

  const left = makeMove(clone(s), moves.find((m) => m.tileId === 1));
  assert.deepEqual(ends(left), { left: 0, right: 5 });

  const right = makeMove(clone(s), moves.find((m) => m.tileId === 2));
  assert.deepEqual(ends(right), { left: 3, right: 5 });
  assert.equal(right.hands[0].length, 2);
});

test('must draw until a playable tile appears, one tile per move', () => {
  const s = fixture();
  s.chain = [{ a: 3, b: 3, id: 98 }];
  s.hands[0] = [{ id: 1, a: 0, b: 0 }];
  s.boneyard = [{ id: 4, a: 5, b: 3 }, { id: 3, a: 4, b: 4 }, { id: 2, a: 6, b: 6 }];

  for (let i = 0; i < 3; i++) {
    const moves = legalMoves(s);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].type, 'draw');
    makeMove(s, moves[0]);
  }
  assert.equal(s.hands[0].length, 4);
  assert.ok(legalMoves(s).some((m) => m.type === 'place'));
});

test('passing is only legal with an empty boneyard; a full cycle blocks', () => {
  const s = fixture(); // boneyard empty
  s.hands[0] = [{ id: 1, a: 0, b: 0 }];
  s.hands[1] = [{ id: 2, a: 0, b: 0 }];

  const m0 = legalMoves(s);
  assert.equal(m0.length, 1);
  assert.equal(m0[0].type, 'pass');
  makeMove(s, m0[0]); // P0 passes
  assert.equal(s.turn, 1);
  makeMove(s, legalMoves(s)[0]); // P1 passes -> blocked (2 players)
  assert.equal(s.roundResult.blocked, true);
});

test('blocked round: lightest hand wins the opponents pip total', () => {
  const s = fixture();
  s.hands[0] = [{ id: 1, a: 2, b: 0 }];        // 2 pips
  s.hands[1] = [{ id: 2, a: 6, b: 6 }, { id: 3, a: 4, b: 0 }]; // 16 pips
  makeMove(s, legalMoves(s)[0]); // P0 pass
  makeMove(s, legalMoves(s)[0]); // P1 pass -> blocked
  assert.equal(s.roundResult.winner, 0);
  assert.equal(s.roundResult.points, 16);
  assert.equal(s.scores[0], 16);
});

test('domino: emptying the hand wins the opponents pip total', () => {
  const s = fixture();
  s.hands[0] = [{ id: 1, a: 3, b: 0 }];
  s.hands[1] = [{ id: 2, a: 6, b: 4 }, { id: 3, a: 1, b: 1 }]; // 12 pips
  makeMove(s, legalMoves(s)[0]);
  assert.equal(s.roundResult.blocked, false);
  assert.equal(s.roundResult.winner, 0);
  assert.equal(s.roundResult.points, 12);
  assert.equal(s.hands[0].length, 0);
});

test('game over at target score; nextRound carries the scores', () => {
  const s = fixture();
  s.target = 20;
  s.hands[0] = [{ id: 1, a: 3, b: 0 }];
  s.hands[1] = [{ id: 2, a: 6, b: 4 }, { id: 3, a: 1, b: 1 }];
  makeMove(s, legalMoves(s)[0]);
  assert.equal(s.scores[0], 12);
  assert.equal(s.gameOver, false);

  s.roundResult = null;
  s.chain = [{ a: 6, b: 4, id: 100 }];
  s.turn = 1;
  s.hands[0] = [{ id: 5, a: 6, b: 5 }]; // 11 pips
  s.hands[1] = [{ id: 6, a: 4, b: 2 }];
  makeMove(s, legalMoves(s)[0]); // P1 places (4-2) on the right -> domino
  assert.equal(s.roundResult.winner, 1);
  assert.equal(s.scores[1], 11);
  assert.equal(s.gameOver, false); // 11 < 20

  // Directly crossing the target:
  s.scores[0] = 95;
  s.roundResult = null;
  s.hands[0] = [{ id: 7, a: 5, b: 5 }];
  s.hands[1] = [{ id: 8, a: 6, b: 6 }];
  s.chain = [{ a: 5, b: 5, id: 101 }];
  s.turn = 0;
  makeMove(s, legalMoves(s)[0]); // P0 empties hand, wins 12 -> 107 >= target
  assert.equal(s.gameOver, true);
});

test('AI obeys legality and dumps heavy tiles first (medium)', () => {
  const s = fixture();
  s.hands[0] = [{ id: 10, a: 5, b: 0 }, { id: 11, a: 6, b: 5 }];
  const res = chooseMove(s, 'medium');
  assert.equal(res.move.type, 'place');
  assert.equal(res.move.tileId, 11); // 11 pips beats 5
  assert.ok(tilePips({ a: 6, b: 5 }) > tilePips({ a: 5, b: 0 }));
});
