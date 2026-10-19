/**
 * DZ-Tawla engine correctness suite. Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, rollDice, clone, applyMove, allSingleMoves, turnMoves,
  gameStatus, pipCount
} from '../src/modules/engine.js';
import { chooseTurnMoves } from '../src/modules/ai.js';

const fixture = (opts = {}) => {
  const s = initialState();
  s.points = new Array(25).fill(0);
  Object.assign(s, {
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: 'w',
    dice: null,
    remaining: [],
    rolled: true
  }, opts);
  if (opts.points) Object.assign(s.points, opts.points);
  return s;
};

test('initial position: 15 checkers each, 167 pips each', () => {
  const s = initialState();
  assert.equal(pipCount(s, 'w'), 167);
  assert.equal(pipCount(s, 'b'), 167);
  assert.equal(s.points.reduce((n, v) => n + Math.max(0, v), 0), 15);
  assert.equal(s.points.reduce((n, v) => n + Math.max(0, -v), 0), 15);
});

test('doubles roll four dice; distinct dice roll two', () => {
  const s = fixture();
  rollDice(s, () => 0.5); // both dice land on 4
  assert.equal(s.remaining.length, 4);
  assert.deepEqual(s.dice, [4, 4]);

  const s2 = fixture();
  s2.dice = [6, 3];
  s2.remaining = [6, 3];
  assert.equal(s2.remaining.length, 2);
});

test('bar entry is mandatory and closed points refuse entry', () => {
  const s = fixture({ bar: { w: 1, b: 0 } });
  s.points[22] = -2; // two black on 22 -> die 3 entry blocked
  s.dice = [3, 5];
  s.remaining = [3, 5];

  const moves = allSingleMoves(s);
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.kind === 'enter'));
  assert.ok(!moves.some((m) => m.to === 22), 'closed 22 refuses entry');

  const enter5 = moves.find((m) => m.to === 20);
  assert.ok(enter5, 'die 5 enters on 20');
  applyMove(s, enter5);
  assert.equal(s.bar.w, 0);
  assert.equal(s.points[20], 1);
});

test('landing on a blot hits it to the bar', () => {
  const s = fixture();
  s.points[10] = 1;   // white mover
  s.points[7] = -1;  // black blot
  s.dice = [3, 3];
  s.remaining = [3, 3];

  const hit = allSingleMoves(s).find((m) => m.from === 10 && m.to === 7);
  assert.ok(hit && hit.hit);
  applyMove(s, hit);
  assert.equal(s.bar.b, 1);
  assert.equal(s.points[7], 1);
});

test('closed points block regular moves', () => {
  const s = fixture();
  s.points[20] = 1;
  s.points[16] = -2;
  s.dice = [4, 4];
  s.remaining = [4];
  assert.ok(!allSingleMoves(s).some((m) => m.from === 20 && m.to === 16));
});

test('bear-off: exact die, higher-die shortcut, and no shortcut over farther men', () => {
  const s = fixture(); // white all home: 2 on 6, 1 on 3
  s.points[6] = 2;
  s.points[3] = 1;

  s.remaining = [6];
  assert.ok(allSingleMoves(s).some((m) => m.kind === 'off' && m.from === 6));

  s.remaining = [3];
  assert.ok(allSingleMoves(s).some((m) => m.kind === 'off' && m.from === 3));

  s.remaining = [5]; // checker still on 6: no bear-off possible with 5
  assert.equal(allSingleMoves(s).filter((m) => m.kind === 'off').length, 0);
  assert.ok(allSingleMoves(s).some((m) => m.from === 6 && m.to === 1));

  s.points[6] = 0; // now the 3-checker is farthest: higher die bears it off
  s.remaining = [5];
  assert.ok(allSingleMoves(s).some((m) => m.kind === 'off' && m.from === 3));
});

test('turnMoves keeps every first move that allows the second die', () => {
  const s = fixture();
  s.points[24] = 2;   // two white checkers
  s.points[15] = -2; // black closes 15 only
  s.dice = [6, 4];
  s.remaining = [6, 4];

  const forced = turnMoves(s);
  assert.ok(forced.length > 0);
  for (const m of forced) {
    const next = clone(s);
    applyMove(next, m);
    assert.equal(next.remaining.length, 1);
    assert.ok(turnMoves(next).length > 0, 'the second die must remain playable');
  }
});

test('the higher die is forced when only one of two can ever be played', () => {
  // White checker on 24. Black closes 14.
  //   die 6: 24->18 OK, then die 4: 18->14 blocked  -> only one die total.
  //   die 4: 24->20 OK, then die 6: 20->14 blocked  -> only one die total.
  // Both dice are playable alone => the higher (6) is forced.
  const s = fixture();
  s.points[24] = 1;
  s.points[14] = -2;
  s.dice = [6, 4];
  s.remaining = [6, 4];

  assert.ok(allSingleMoves(s).some((m) => m.die === 6 && m.to === 18));
  assert.ok(allSingleMoves(s).some((m) => m.die === 4 && m.to === 20));

  const forced = turnMoves(s);
  assert.equal(forced.length, 1);
  assert.equal(forced[0].die, 6);
});

test('a fully blocked turn offers no moves at all', () => {
  const s = fixture();
  s.points[24] = 2;
  s.points[18] = -2;
  s.points[19] = -2;
  s.dice = [6, 5];
  s.remaining = [6, 5];
  assert.equal(allSingleMoves(s).length, 0);
  assert.equal(turnMoves(s).length, 0);
});

test('gammon and backgammon scoring values', () => {
  const s = fixture({ off: { w: 15, b: 0 } });
  assert.deepEqual(gameStatus(s), { over: true, winner: 'w', value: 2 });

  const deep = fixture({ off: { w: 15, b: 0 } });
  deep.bar.b = 1;
  assert.equal(gameStatus(deep).value, 3);

  const normal = fixture({ off: { w: 15, b: 3 } });
  assert.equal(gameStatus(normal).value, 1);

  const ongoing = fixture();
  assert.deepEqual(gameStatus(ongoing), { over: false, winner: null, value: 0 });
});

test('AI plans only legal moves and consumes all playable dice', () => {
  const s = fixture();
  s.points[24] = 2;
  s.points[13] = 5;
  s.points[8] = 3;
  s.points[6] = 5;
  s.dice = [6, 5];
  s.remaining = [6, 5];

  const plan = chooseTurnMoves(s, 'medium');
  assert.ok(plan.length >= 1 && plan.length <= 2);

  const sim = clone(s);
  for (const m of plan) {
    const legal = turnMoves(sim);
    assert.ok(
      legal.some((x) => x.die === m.die && x.from === m.from && x.to === m.to),
      'every AI move must be legal'
    );
    applyMove(sim, m);
  }
  assert.equal(sim.remaining.length, 0);

  // Checker conservation for white: 15 in total.
  const whites =
    sim.points.reduce((n, v) => n + Math.max(0, v), 0) + sim.off.w + sim.bar.w;
  assert.equal(whites, 15);
});

