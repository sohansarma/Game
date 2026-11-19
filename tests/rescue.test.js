import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockGame, RESCUE_LEVELS, RESCUE_SEEDS, rescueLevel, replayBlocks, PIECES, SIZE } from '../public/js/blocks.js';

function greedy(g) {
  let best = null;
  for (let s = 0; s < 3; s++) {
    const t = g.tray[s];
    if (!t) continue;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (!g.canPlace(t.piece, r, c)) continue;
      const b = g.board.map((x) => x.slice());
      for (const [dr, dc] of PIECES[t.piece].cells) b[r + dr][c + dc] = 0;
      let v = 0;
      for (let i = 0; i < SIZE; i++) {
        const row = b[i].every((x) => x !== -1), col = b.every((x) => x[i] !== -1);
        for (const f of g.fish) { const [fr, fc] = f.split(',').map(Number); if ((row && fr === i) || (col && fc === i)) v += 100; }
        if (row) v += 10;
        if (col) v += 10;
      }
      for (const [dr, dc] of PIECES[t.piece].cells) for (const f of g.fish) { const [fr, fc] = f.split(',').map(Number); if (r + dr === fr || c + dc === fc) v += 4; }
      if (!best || v > best.v) best = { v, s, r, c };
    }
  }
  return best && g.place(best.s, best.r, best.c).ok;
}

test('rescue levels: fish start trapped (never in the top rows, no full lines), budgets and tides grow', () => {
  for (let n = 1; n <= RESCUE_LEVELS; n++) {
    const g = new BlockGame({ seed: RESCUE_SEEDS[n - 1], rescue: n });
    assert.ok(g.fish.size >= 1, `level ${n} has fish`);
    for (const f of g.fish) { const [r, c] = f.split(',').map(Number); assert.ok(r >= 3); assert.notEqual(g.board[r][c], -1); }
    for (let i = 0; i < SIZE; i++) { assert.ok(!g.board[i].every((v) => v !== -1)); assert.ok(!g.board.every((row) => row[i] !== -1)); }
    assert.equal(g.piecesLeft, rescueLevel(n).pieces);
  }
  assert.equal(rescueLevel(1).tideEvery, 0);
  assert.ok(rescueLevel(12).tideEvery > 0);
});

test('rescue: freeing every fish wins; replays are exact; losing a fish to the tide ends it', () => {
  let wins = 0;
  for (let n = 1; n <= 6; n++) {
    const g = new BlockGame({ seed: RESCUE_SEEDS[n - 1], rescue: n });
    while (g.state === 'playing' && greedy(g));
    if (g.state === 'won') wins++;
    const r = replayBlocks(RESCUE_SEEDS[n - 1], g.log, { rescue: n });
    assert.equal(r.game.score, g.score);
    assert.equal(r.game.state, g.state);
  }
  assert.ok(wins >= 3, `early levels are winnable (${wins}/6)`);
  const g = new BlockGame({ seed: 1, rescue: 8 });
  g.fish = new Set(['0,3']);
  g.tidePush();
  assert.equal(g.state, 'over');
});
