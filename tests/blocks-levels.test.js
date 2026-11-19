import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockGame, replayBlocks, PIECES, SIZE } from '../public/js/blocks.js';
import { getLevel, levelRecipe, LEVEL_COUNT } from '../public/js/levels.js';
import { TUNING } from '../public/js/level-tuning.js';
import { Game } from '../public/js/engine.js';
import { dayKey, weekKey, acceptableKeys, dailyConfig, deepConfig } from '../public/js/modes.js';

test('blocks: filling a row clears it and scores', () => {
  const g = new BlockGame({ seed: 1 });
  for (let c = 0; c < SIZE - 1; c++) g.board[0][c] = 2;
  g.tray[0] = { piece: 0, color: 1 }; // single cell
  const res = g.place(0, 0, SIZE - 1);
  assert.ok(res.ok);
  assert.deepEqual(res.rows, [0]);
  assert.equal(res.lines, 1);
  assert.ok(g.board[0].every((v) => v === -1));
  assert.ok(res.perfect, 'board empty → perfect clear');
  assert.equal(g.score, 1 + 10 + 300);
});

test('blocks: row+column at once, combos multiply', () => {
  const g = new BlockGame({ seed: 2 });
  for (let i = 1; i < SIZE; i++) { g.board[0][i] = 1; g.board[i][0] = 1; }
  g.board[5][5] = 3; // so no perfect clear
  g.tray[0] = { piece: 0, color: 0 };
  const res = g.place(0, 0, 0);
  assert.equal(res.lines, 2);
  assert.equal(res.points, 1 + 10 * 4 * 1);
  assert.equal(g.combo, 1);
});

test('blocks: cannot overlap or go off-board; tray refills after 3 pieces', () => {
  const g = new BlockGame({ seed: 3 });
  g.board[0][0] = 1;
  g.tray = [{ piece: 0, color: 0 }, { piece: 0, color: 0 }, { piece: 0, color: 0 }];
  assert.equal(g.place(0, 0, 0).ok, false);
  assert.equal(g.place(0, -1, 0).ok, false);
  assert.equal(g.place(0, 0, SIZE).ok, false);
  g.place(0, 1, 1); g.place(1, 2, 2);
  const r = g.place(2, 3, 3);
  assert.ok(r.refilled);
  assert.ok(g.tray.every(Boolean));
});

test('blocks: undo restores state once; replay matches; game over detected', () => {
  const g = new BlockGame({ seed: 4 });
  const before = g.saveState();
  const t = g.tray[0];
  let placed = false;
  for (let r = 0; r < SIZE && !placed; r++) for (let c = 0; c < SIZE && !placed; c++) if (g.canPlace(t.piece, r, c)) placed = g.place(0, r, c).ok;
  assert.ok(g.undo());
  assert.equal(g.saveState(), before);
  assert.equal(g.undo(), false, 'only one undo');

  for (let seed = 1; seed <= 30; seed++) {
    const b = new BlockGame({ seed });
    while (b.state === 'playing') {
      let done = false;
      for (let s = 0; s < 3 && !done; s++) {
        const tt = b.tray[s];
        if (!tt) continue;
        for (let r = 0; r < SIZE && !done; r++) for (let c = 0; c < SIZE && !done; c++) if (b.canPlace(tt.piece, r, c)) done = b.place(s, r, c).ok;
      }
      assert.ok(done || b.state === 'over');
    }
    const rp = replayBlocks(seed, b.log);
    assert.ok(rp.ok);
    assert.equal(rp.game.score, b.score);
    assert.equal(rp.game.state, 'over');
  }
  assert.equal(replayBlocks(1, [['p', 0, 99, 99]]).ok, false);
  assert.equal(replayBlocks(1, [['u']]).ok, false);
});

test('pieces are well-formed', () => {
  for (const p of PIECES) {
    assert.ok(p.cells.length >= 1 && p.cells.length <= 9);
    assert.ok(p.weight > 0);
    assert.equal(new Set(p.cells.map(([r, c]) => r * 10 + c)).size, p.cells.length);
  }
});

test('all 60 levels are valid, tuned and solvable from the start', () => {
  assert.equal(Object.keys(TUNING).length, LEVEL_COUNT);
  let prevWorld = 0;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const cfg = getLevel(n, 123);
    const r = levelRecipe(n);
    assert.ok(r.world >= prevWorld);
    prevWorld = r.world;
    assert.ok(cfg.moves >= 7 && cfg.moves <= 45, `level ${n} moves ${cfg.moves}`);
    assert.ok(cfg.stars[0] < cfg.stars[1] && cfg.stars[1] < cfg.stars[2], `level ${n} stars`);
    assert.ok(cfg.objectives.length >= 1);
    for (const o of cfg.objectives) {
      if (o.type === 'collect') assert.ok(o.count > 0 && o.color < cfg.colors);
      if (o.type === 'score') assert.ok(o.target > 0);
    }
    const g = new Game(cfg);
    assert.ok(g.findMove(), `level ${n} starts with a move`);
    if (cfg.objectives.some((o) => o.type === 'jelly')) assert.ok(g.jellyTotal > 0, `level ${n} has algae`);
    if (cfg.objectives.some((o) => o.type === 'crate')) assert.ok(g.crateTotal > 0, `level ${n} has crates`);
  }
});

test('a goal-aware bot can beat every level (sampled)', () => {
  for (let n = 1; n <= LEVEL_COUNT; n += 1) {
    let wins = 0;
    const tries = 6;
    for (let s = 0; s < tries; s++) {
      const g = new Game(getLevel(n, 5000 + s * 31));
      while (g.state === 'playing') { const m = g.smartMove(); g.swap(m[0], m[1]); }
      if (g.state === 'won') wins++;
    }
    assert.ok(wins >= 1, `level ${n}: bot won ${wins}/${tries}`);
  }
});

test('mode keys and configs are stable', () => {
  const d = new Date(Date.UTC(2026, 10, 17, 12));
  assert.equal(dayKey(d), '2026-11-17');
  assert.equal(weekKey(d), '2026-W47');
  assert.equal(weekKey(new Date(Date.UTC(2027, 0, 1))), '2026-W53');
  assert.deepEqual(acceptableKeys('daily', d), ['2026-11-17']);
  assert.deepEqual(acceptableKeys('daily', new Date(Date.UTC(2026, 10, 18, 1))), ['2026-11-18', '2026-11-17']);
  assert.deepEqual(dailyConfig('2026-11-17'), dailyConfig('2026-11-17'));
  assert.notEqual(dailyConfig('2026-11-17').seed, dailyConfig('2026-11-18').seed);
  assert.equal(deepConfig('2026-W47').bonusMoves, true);
});

test('endless levels (61+) are valid, mirrored remixes and keep boss rhythm', async () => {
  const { worldOf, MAX_LEVEL } = await import('../public/js/levels.js');
  for (const n of [61, 70, 75, 90, 91, 150, 333, 1000, 5000, MAX_LEVEL]) {
    const cfg = getLevel(n, 42);
    assert.equal(cfg.level, n);
    assert.equal(cfg.boss, n % 10 === 0);
    assert.ok(cfg.moves >= 10 && cfg.moves <= 45, `level ${n} moves`);
    assert.ok(cfg.stars[0] < cfg.stars[1] && cfg.stars[1] < cfg.stars[2], `level ${n} stars`);
    for (const [r, c] of [...cfg.holes, ...cfg.jelly, ...cfg.crates]) assert.ok(r >= 0 && c >= 0 && r < cfg.rows && c < cfg.cols);
    for (const o of cfg.objectives) if (o.type === 'collect') assert.ok(o.color >= 0 && o.color < cfg.colors);
    const g = new Game(cfg);
    assert.ok(g.findMove(), `level ${n} starts with a move`);
    assert.ok(worldOf(n).name.length > 0);
  }
  assert.equal(worldOf(61).name, 'Sunny Shallows II');
  assert.equal(worldOf(1).name, 'Sunny Shallows');
  assert.deepEqual(getLevel(150, 7), getLevel(150, 7), 'deterministic');
});

test('endless levels stay winnable for the bot (sampled)', () => {
  for (const n of [61, 78, 100, 133, 148, 190, 208, 264, 301]) {
    let wins = 0;
    for (let s = 0; s < 6; s++) {
      const g = new Game(getLevel(n, 9000 + s * 13));
      while (g.state === 'playing') { const m = g.smartMove(); g.swap(m[0], m[1]); }
      if (g.state === 'won') wins++;
    }
    assert.ok(wins >= 2, `level ${n}: bot won ${wins}/6`);
  }
});
