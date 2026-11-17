import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARCADE, verifyArcade, arcadeSeed } from '../public/js/arcade/index.js';
import { BOARDS, dayKey, ENGINE_VERSION } from '../public/js/modes.js';
import { createServer } from '../server/server.js';
import { Rng } from '../public/js/rng.js';
import { BOTS } from './arcade-bots.js';

function play(game, seed, botSeed = 1) {
  const sim = game.create(seed);
  const rng = new Rng(botSeed);
  const bot = BOTS[game.id];
  for (let i = 0; i < 200000 && !sim.over; i++) bot(sim, rng);
  if (!sim.over) sim.quit();
  return sim;
}

test('every arcade game has a bot, boards and metadata', () => {
  for (const g of ARCADE) {
    assert.ok(BOTS[g.id], `bot for ${g.id}`);
    assert.ok(BOARDS[g.id] && BOARDS[g.id + 'Daily'], `boards for ${g.id}`);
    for (const k of ['title', 'icon', 'tagline', 'color', 'maxLog', 'shellsPer', 'milestone']) assert.ok(g[k], `${g.id}.${k}`);
  }
});

for (const g of ARCADE) {
  test(`${g.title}: runs end, replay is exact, tampering is rejected`, () => {
    const scores = [];
    for (let seed = 1; seed <= 25; seed++) {
      const sim = play(g, seed, seed * 7);
      assert.ok(sim.over, 'run finished');
      assert.ok(sim.log.length <= g.maxLog, `log within limit (${sim.log.length})`);
      const v = verifyArcade(g.id, 'all', seed, sim.log);
      assert.ok(v.ok, v.reason);
      assert.equal(v.score, sim.score);
      scores.push(sim.score);
      // wrong seed or garbage actions must not verify to the same score
      const other = verifyArcade(g.id, 'all', seed + 1, sim.log);
      assert.ok(!other.ok || other.score !== sim.score || sim.score === 0);
    }
    assert.ok(Math.max(...scores) > 0, 'bot scores points');
    assert.equal(verifyArcade(g.id, 'all', 1, [['zz']]).ok, false);
    assert.equal(verifyArcade(g.id, 'all', 1, 'nope').ok, false);
    assert.equal(verifyArcade(g.id, 'all', -5, []).ok, false);
    // daily seed ignores the client seed
    assert.equal(arcadeSeed(g.id, true, '2026-11-17', 1), arcadeSeed(g.id, true, '2026-11-17', 999));
  });
}

let srv, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-arcade-'));
  ({ server: srv } = createServer({ dataDir: dir }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('server verifies arcade submissions (endless + daily)', async () => {
  const reg = await post('/api/register', { name: 'Swift Orca 21' });
  const me = reg.body;
  const key = dayKey();
  for (const g of ARCADE) {
    const sim = play(g, 4242, 3);
    const ok = await post('/api/scores', { board: g.id, key: 'all', seed: 4242, log: sim.log, score: sim.score, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
    assert.equal(ok.status, 200, `${g.id}: ${ok.body.error}`);
    assert.equal(ok.body.verified, sim.score);
    const forged = await post('/api/scores', { board: g.id, key: 'all', seed: 4242, log: sim.log, score: sim.score + 10, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
    assert.equal(forged.status, 422, `${g.id} forged score rejected`);
    const daily = play(g, arcadeSeed(g.id, true, key, 0), 5);
    const d = await post('/api/scores', { board: g.id + 'Daily', key, seed: 0, log: daily.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
    assert.equal(d.status, 200, `${g.id} daily: ${d.body.error}`);
    const closed = await post('/api/scores', { board: g.id + 'Daily', key: '2001-01-01', seed: 0, log: daily.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
    assert.equal(closed.status, 422);
  }
});
