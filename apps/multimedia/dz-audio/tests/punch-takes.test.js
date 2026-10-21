import { describe, it, expect } from 'vitest';
import { punchTakes } from '../src/multitrack/recorder.js';

describe('punch-in takes', () => {
  it('keeps the punch range after the pre-roll', () => {
    expect(punchTakes(1000, 200, 500, false)).toEqual([{ start: 200, length: 500 }]);
    // Stopped early: what was recorded of the range.
    expect(punchTakes(500, 200, 500, false)).toEqual([{ start: 200, length: 300 }]);
    expect(punchTakes(150, 200, 500, false)).toEqual([]);
  });

  it('splits loop recording into complete passes', () => {
    expect(punchTakes(200 + 3 * 400 + 100, 200, 400, true)).toEqual([
      { start: 200, length: 400 },
      { start: 600, length: 400 },
      { start: 1000, length: 400 },
    ]);
    // No pass completed: keep the partial one.
    expect(punchTakes(450, 200, 400, true)).toEqual([{ start: 200, length: 250 }]);
  });
});
