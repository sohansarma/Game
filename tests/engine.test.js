import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, replay, SPECIAL } from '../public/js/engine.js';
import { Rng, hashString } from '../public/js/rng.js';

const base = { rows: 6, cols: 6, colors: 5, moves: 20, seed: 1, mode: 'level', objectives: [{ type: 'score', target: 1 }], stars: [1, 2, 3] };

// Build a game and overwrite the board with a layout. Digits = colours,
// letters: h/v = line specials (colour 0), b = bomb (colour 0), p = pearl,
// '#' = crate, ' ' = hole.
function board(rows, extra = {}) {
  const g = new Game({ ...base, rows: rows.length, cols: rows[0].length, ...extra });
  rows.forEach((line, r) => [...line].forEach((ch, c) => {
    g.hole[r][c] = ch === ' ';
    g.crate[r][c] = ch === '#' ? 1 : 0;
    if (ch === ' ' || ch === '#') { g.gems[r][c] = null; return; }
    if (ch === 'p') g.gems[r][c] = g.newGem(-1, SPECIAL.RAINBOW);
    else if (ch === 'h') g.gems[r][c] = g.newGem(0, SPECIAL.LINE_H);
    else if (ch === 'v') g.gems[r][c] = g.newGem(0, SPECIAL.LINE_V);
    else if (ch === 'b') g.gems[r][c] = g.newGem(0, SPECIAL.BOMB);
    else g.gems[r][c] = g.newGem(Number(ch));
  }));
  g.crateTotal = g.countCrates();
  return g;
}

test('rng is deterministic and seed-dependent', () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c.next()));
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('initial boards have no matches and at least one move', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = new Game({ ...base, rows: 9, cols: 9, colors: 6, seed });
    assert.equal(g.findMatchGroups().length, 0, `seed ${seed} has a match`);
    assert.ok(g.findMove(), `seed ${seed} has no move`);
  }
});

test('invalid swaps are rejected and cost nothing', () => {
  const g = board(['012', '120', '201']);
  const r = g.swap([0, 0], [0, 1]);
  assert.equal(r.ok, false);
  assert.equal(g.movesLeft, 20);
  assert.equal(g.log.length, 0);
  assert.equal(g.swap([0, 0], [2, 2]).ok, false, 'non-adjacent');
});

test('match of 3 clears, scores and refills', () => {
  const g = board(['0012', '1203', '2310', '3021']);
  const r = g.swap([1, 1], [0, 2]); // not adjacent → rejected
  assert.equal(r.ok, false);
  const ok = g.swap([0, 2], [1, 2]); // 0 moves up into row 0 → 000
  assert.equal(ok.ok, true);
  assert.ok(g.score >= 180);
  assert.equal(g.movesLeft, 19);
  for (let r2 = 0; r2 < 4; r2++) for (let c = 0; c < 4; c++) assert.ok(g.gems[r2][c], 'board refilled');
  assert.ok(ok.steps.some((s) => s.type === 'fall'));
});

test('match of 4 makes a line special; L shape makes a bomb; 5 makes a pearl', () => {
  let g = board(['0010', '2201', '3132', '1323']);
  let res = g.swap([1, 2], [0, 2]); // row 0 → 0 0 0 0
  assert.ok(res.ok);
  assert.ok(res.steps.find((s) => s.type === 'clear').upgraded.some((u) => u.special === SPECIAL.LINE_H), 'line special created');

  g = board(['01212', '02343', '40034', '03121']);
  res = g.swap([3, 0], [2, 0]); // column 0 + row 2 → L
  assert.ok(res.ok);
  assert.ok(res.steps.find((s) => s.type === 'clear').upgraded.some((u) => u.special === SPECIAL.BOMB), 'bomb created');

  g = board(['00100', '23032', '31213', '12321']);
  res = g.swap([1, 2], [0, 2]); // row 0 → five in a row
  assert.ok(res.ok);
  assert.ok(res.steps.find((s) => s.type === 'clear').upgraded.some((u) => u.special === SPECIAL.RAINBOW), 'pearl created');
});

test('pearl swapped with a colour clears all of that colour', () => {
  const g = board(['p1234', '12341', '23412', '34123']);
  const ones = g.snapshot().filter((x) => x.color === 1).length;
  const res = g.swap([0, 0], [0, 1]);
  assert.ok(res.ok);
  const clear = res.steps.find((s) => s.type === 'clear');
  assert.ok(clear.cleared.filter((x) => x.color === 1).length >= ones);
});

test('two line specials make a cross; pearl + pearl clears everything', () => {
  let g = board(['h1234', 'v2341', '23412', '34123', '41234']);
  let res = g.swap([0, 0], [1, 0]);
  assert.ok(res.ok);
  let clear = res.steps.find((s) => s.type === 'clear');
  assert.ok(clear.cleared.length >= 9, 'row + column cleared');

  g = board(['pp123', '12341', '23412', '34123']);
  res = g.swap([0, 0], [0, 1]);
  clear = res.steps.find((s) => s.type === 'clear');
  assert.equal(clear.cleared.length, 20, 'whole board cleared');
});

test('bomb clears 3x3 and damages crates; jelly is cleaned', () => {
  const g = board(['12312', '23#23', '30b41', '12102', '23123'], { jelly: [[1, 1, 1]] });
  assert.equal(g.jelly[1][1], 1);
  const res = g.swap([3, 3], [2, 3]); // 0 b 0 in row 2 → bomb fires around (2,2)
  assert.ok(res.ok);
  assert.ok(res.steps.some((s) => s.type === 'clear' && s.effects.some((e) => e.kind === 'bomb')));
  assert.equal(g.crate[1][2], 0, 'crate broken');
  assert.equal(g.jelly[1][1], 0, 'jelly cleaned');
});

test('gravity respects holes and crates; every open cell gets filled', () => {
  for (let seed = 1; seed < 30; seed++) {
    const g = new Game({ ...base, rows: 8, cols: 8, seed, holes: [[0, 0], [4, 4]], crates: [[3, 3, 2], [3, 4, 1]] });
    for (let i = 0; i < 15 && g.state === 'playing'; i++) {
      const m = g.findMove();
      g.swap(m[0], m[1]);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (g.isOpen(r, c)) assert.ok(g.gems[r][c], `open cell ${r},${c} empty`);
        else assert.equal(g.gems[r][c], null, `blocked cell ${r},${c} has gem`);
      }
      assert.equal(g.findMatchGroups().length, 0, 'board settled');
    }
  }
});

test('deadlocked board is reshuffled into a playable one', () => {
  const g = board(['0123', '1230', '2301', '3012'], { colors: 4 });
  assert.equal(g.findMove(), null);
  const steps = [];
  g.shuffle(steps);
  assert.ok(g.findMove());
  assert.equal(g.findMatchGroups().length, 0);
  assert.equal(steps[0].type, 'shuffle');
});

test('level ends: lost when moves run out, won with finale when goals met', () => {
  const g = new Game({ ...base, rows: 8, cols: 8, moves: 3, objectives: [{ type: 'collect', color: 0, count: 999 }] });
  for (let i = 0; i < 3; i++) { const m = g.findMove(); g.swap(m[0], m[1]); }
  assert.equal(g.state, 'lost');
  assert.equal(g.stars(), 0);
  assert.equal(g.swap([0, 0], [0, 1]).ok, false, 'no moves after end');
  g.addMoves(5);
  assert.equal(g.state, 'playing');

  const w = new Game({ ...base, rows: 8, cols: 8, moves: 30, objectives: [{ type: 'collect', color: 0, count: 3 }], stars: [100, 200, 300] });
  while (w.state === 'playing') { const m = w.smartMove(); w.swap(m[0], m[1]); }
  assert.equal(w.state, 'won');
  assert.ok(w.stars() >= 1);
  assert.equal(w.movesLeft, 0, 'leftover moves consumed by finale');
});

test('replay reproduces score exactly and rejects tampering', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const cfg = { ...base, rows: 9, cols: 9, colors: 6, moves: 25, seed, mode: 'daily', objectives: [] };
    const g = new Game(cfg);
    let i = 0;
    while (g.state === 'playing') {
      if (i++ === 5) g.hammer(4, 4);
      const m = g.bestHint();
      g.swap(m[0], m[1]);
    }
    const r = replay(cfg, g.log);
    assert.ok(r.ok);
    assert.equal(r.game.score, g.score);
    assert.equal(replay(cfg, g.log, { maxBoosters: 0 }).ok, false, 'boosters refused when not allowed');
  }
  const cfg = { ...base, seed: 9 };
  assert.equal(replay(cfg, [['s', 0, 0, 0, 1], ['s', 0, 0, 0, 1], ['s', 0, 0, 5, 5]]).ok, false);
  assert.equal(replay(cfg, [['z']]).ok, false);
  assert.equal(replay(cfg, ['nope']).ok, false);
});

test('smartMove does not change the real game', () => {
  const g = new Game({ ...base, rows: 9, cols: 9, seed: 5, jelly: [[4, 4, 1]], objectives: [{ type: 'jelly' }] });
  const before = JSON.stringify([g.snapshot(), g.score, g.rng.s, g.jelly, g.movesLeft]);
  g.smartMove();
  assert.equal(JSON.stringify([g.snapshot(), g.score, g.rng.s, g.jelly, g.movesLeft]), before);
});

test('endless mode awards bonus moves for specials', () => {
  let earned = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = new Game({ ...base, rows: 9, cols: 9, colors: 6, seed, moves: 20, mode: 'endless', objectives: [], bonusMoves: true });
    while (g.state === 'playing') { const m = g.smartMove(); g.swap(m[0], m[1]); }
    earned += g.stats.bonusMovesEarned;
    assert.equal(g.movesMade, 20 + g.stats.bonusMovesEarned);
  }
  assert.ok(earned > 0);
});

test('tide levels: a wave sweeps the bottom row every N moves; replays stay exact', async () => {
  const { getLevel, tideOf } = await import('../public/js/levels.js');
  const n = [12, 15, 18, 21].find((k) => tideOf(k));
  assert.ok(n, 'some level is a tide level');
  const cfg = { ...getLevel(n, 4242), moves: 30, objectives: [{ type: 'score', target: 1e9 }] };
  assert.equal(cfg.tideEvery, tideOf(n));
  const g = new Game(cfg);
  let tides = 0;
  while (g.state === 'playing') {
    const m = g.smartMove();
    if (!m) break;
    const r = g.swap(m[0], m[1]);
    tides += r.steps.filter((s) => s.type === 'tide').length;
  }
  assert.ok(tides >= 1, `waves happened (${tides})`);
  const rp = replay(cfg, g.log);
  assert.ok(rp.ok);
  assert.equal(rp.game.score, g.score);
});
