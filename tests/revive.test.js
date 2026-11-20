import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';
import { BlockGame, replayBlocks } from '../public/js/blocks.js';
import { ARCADE_BY_ID, verifyArcade } from '../public/js/arcade/index.js';
import { dayKey, ENGINE_VERSION } from '../public/js/modes.js';

/** Greedy Reef Blocks bot; revives once when offered. Returns the game. */
function playBlocks(seed, { revive = true } = {}) {
  const g = new BlockGame({ seed });
  for (let guard = 0; guard < 5000; guard++) {
    if (g.state !== 'playing') {
      if (revive && g.canRevive()) { assert.equal(g.revive(), true); continue; }
      break;
    }
    let done = false;
    for (let s = 0; s < 3 && !done; s++) {
      const t = g.tray[s];
      if (!t) continue;
      for (let r = 0; r < 8 && !done; r++) for (let c = 0; c < 8 && !done; c++) if (g.canPlace(t.piece, r, c)) done = g.place(s, r, c).ok;
    }
  }
  return g;
}

/** Shell Merge bot: rotates directions until the board locks up, revives once if allowed. */
function playMerge(seed, { revive = true } = {}) {
  const sim = ARCADE_BY_ID.merge.create(seed);
  for (let i = 0; i < 20000; i++) {
    if (sim.over) {
      if (revive && sim.canRevive()) { assert.equal(sim.revive(), true); continue; }
      break;
    }
    for (let k = 0; k < 4 && !sim.over; k++) if (sim.move('udlr'[(i + k) % 4]).ok) break;
  }
  return sim;
}

test('Reef Blocks: a run that ran out of room can be revived exactly once, and the log replays', () => {
  const plain = playBlocks(4242, { revive: false });
  assert.equal(plain.state, 'over');
  assert.equal(plain.canRevive(), true);
  const g = playBlocks(4242);
  assert.equal(g.revived, true);
  assert.ok(g.log.some((a) => a[0] === 'r'));
  assert.equal(g.log.filter((a) => a[0] === 'r').length, 1);
  assert.ok(g.score > plain.score, 'playing on after the revive scores more');
  assert.equal(g.canRevive(), false, 'only once');
  assert.equal(g.revive(), false);
  const r = replayBlocks(4242, g.log);
  assert.equal(r.ok, true);
  assert.equal(r.game.score, g.score);
  assert.equal(r.game.state, 'over');
});

test('Reef Blocks: revive clears space, costs no points, and never starts a dead board', () => {
  const g = playBlocks(99, { revive: false });
  const before = g.board.flat().filter((v) => v !== -1).length, score = g.score;
  assert.equal(g.revive(), true);
  assert.equal(g.score, score, 'no points for the free space');
  assert.ok(g.board.flat().filter((v) => v !== -1).length < before);
  assert.equal(g.state, 'playing');
  assert.ok(g.tray.some((t) => t && g.fitsAnywhere(t.piece)));
});

test('Reef Blocks: no revive while playing, in rescue levels, or in a Daily replay', () => {
  const live = new BlockGame({ seed: 1 });
  assert.equal(live.canRevive(), false);
  assert.equal(live.revive(), false);
  const g = playBlocks(4242);
  assert.equal(replayBlocks(4242, g.log, { noRevive: true }).ok, false);
  assert.equal(replayBlocks(4242, [['r']]).ok, false, 'a revive with nothing to revive is invalid');
  const forged = [...playBlocks(4242, { revive: false }).log, ['r'], ['r']];
  assert.equal(replayBlocks(4242, forged).ok, false, 'a second revive is rejected');
});

test('Shell Merge: one revive, deterministic, replays; refused on the Daily board', () => {
  const plain = playMerge(7, { revive: false });
  assert.equal(plain.over, true);
  assert.equal(plain.canRevive(), true);
  const sim = playMerge(7);
  assert.equal(sim.revived, true);
  assert.equal(sim.log.filter((a) => a[0] === 'r').length, 1);
  assert.ok(sim.score >= plain.score);
  const ok = verifyArcade('merge', 'all', 7, sim.log);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.score, sim.score);
  assert.equal(verifyArcade('mergeDaily', dayKey(), 0, sim.log).ok, false, 'no revive in the daily run');
  assert.equal(verifyArcade('merge', 'all', 7, [...sim.log, ['r']]).ok, false, 'no second revive');
  const cashed = ARCADE_BY_ID.merge.create(7);
  cashed.quit();
  assert.equal(cashed.canRevive(), false, 'cashing out is not a game over to revive');
});

let srv, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-rv-'));
  ({ server: srv } = createServer({ dataDir: dir, rate: { capacity: 5000 } }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the server accepts a revived all-time run and refuses one on the Daily board', async () => {
  const me = (await post('/api/register', { playerId: 'rv-' + Math.random().toString(36).slice(2), name: 'Happy Otter 77' })).body;
  const g = playBlocks(31337);
  const base1 = { board: 'blocks', key: 'all', seed: 31337, log: g.log, score: g.score, v: ENGINE_VERSION, playerId: me.playerId, token: me.token };
  const ok = await post('/api/scores', base1);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.verified, g.score);
  const dayCfg = await post('/api/scores', { ...base1, board: 'blocksDaily', key: dayKey() });
  assert.equal(dayCfg.status, 422, 'a revive in a daily log never verifies');
  // merge on the server
  const m = playMerge(5);
  const mr = await post('/api/scores', { board: 'merge', key: 'all', seed: 5, log: m.log, score: m.score, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(mr.status, 200, JSON.stringify(mr.body));
});
