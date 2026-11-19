import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEMPLATES, sanitize, starterSpec, createSim, replay, cleanText } from '../public/js/maker/engine.js';
import { createServer } from '../server/server.js';
import { ENGINE_VERSION } from '../public/js/modes.js';
import { Rng } from '../public/js/rng.js';

function botPlay(spec, seed) {
  const sim = createSim(spec, seed);
  const r = new Rng(seed);
  if (spec.template === 'flap') sim.flap();
  for (let g = 0; g < 60 * 60 * 4 && !sim.over; g++) {
    if (spec.template === 'catch') { const o = sim.objs.filter((x) => x.good).sort((a, b) => b.y - a.y)[0]; if (o && sim.tick % 3 === 0) sim.input(o.x + (r.next() - 0.5) * 20, 135); }
    if (spec.template === 'flap') { const w = sim.objs.find((o) => o.kind === 'wall' && o.x > 18); if (w && sim.hy > w.gy + 3 && sim.vy > 0 && r.next() < 0.95) sim.flap(); }
    if (spec.template === 'tap') { const o = sim.objs.find((x) => x.good && sim.tick - x.born > 20 + r.int(30)); if (o) sim.tap(o.x, o.y); }
    if (spec.template === 'arena') { const o = sim.objs.find((x) => x.good); if (o && sim.tick % 5 === 0) sim.input(o.x, o.y); }
    sim.step();
  }
  if (!sim.over) sim.quit();
  return sim;
}

for (const t of Object.keys(TEMPLATES)) {
  test(`maker template ${t}: playable, terminates, replay-exact`, () => {
    const spec = sanitize({ ...starterSpec(t), title: `My ${t} game` });
    let total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const sim = botPlay(spec, seed);
      assert.ok(sim.over);
      const r = replay(spec, seed, sim.log);
      assert.ok(r.ok, r.reason);
      assert.equal(r.sim.score, sim.score);
      total += sim.score;
    }
    assert.ok(total > 0, 'bot scores in this template');
  });
}

test('maker spec validation: clamps, allowlists and rejects', () => {
  assert.throws(() => sanitize(null));
  assert.throws(() => sanitize({ template: 'nope', title: 'abc' }), /template/);
  assert.throws(() => sanitize({ ...starterSpec('catch'), title: 'ab' }), /title/);
  assert.throws(() => sanitize({ ...starterSpec('catch'), title: 'fuck this' }), /friendlier/);
  assert.throws(() => sanitize({ ...starterSpec('arena'), title: 'Good game', bad: [] }), /hazard/);
  assert.throws(() => sanitize({ ...starterSpec('arena'), title: 'Good game', good: [] }), /goodie/);
  const s = sanitize({ ...starterSpec('tap'), title: ' <b>Hi</b>   there ', hero: '<img src=x>', palette: 99, rules: { speed: 100, duration: 3 }, good: [{ e: 'evil', pts: 1e9 }, { e: '⭐' }, { e: '💎' }, { e: '🍎' }] });
  assert.equal(s.title, 'bHi/b there');
  assert.ok(!s.hero.includes('<'));
  assert.equal(s.palette, 7);
  assert.equal(s.rules.speed, 5);
  assert.equal(s.rules.duration, 20);
  assert.equal(s.good.length, 3);
  assert.equal(s.good[0].e, '⭐');
  assert.equal(s.good[0].pts, 100);
  assert.equal(cleanText('hello\u0000world<script>', 50), 'helloworldscript');
});

let srv, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-ugc-'));
  ({ server: srv } = createServer({ dataDir: dir, rate: { capacity: 500 } }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));

test('server: publish, version, play, rate, report, verified scores', async () => {
  const maker = (await post('/api/register', { name: 'Clever Octopus 11' })).body;
  const fan = (await post('/api/register', { name: 'Jolly Penguin 22' })).body;
  const as = (who, body) => post('/api/ugc', { ...body, playerId: who.playerId, token: who.token });
  const spec = { ...starterSpec('catch'), title: 'Shell Storm' };
  assert.equal((await as(maker, { action: 'publish', id: 'BAD', spec })).status, 400);
  assert.equal((await as(maker, { action: 'publish', id: 'abcd2345', spec: { ...spec, title: 'x' } })).status, 400);
  const p1 = await as(maker, { action: 'publish', id: 'abcd2345', spec, note: 'First!' });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.version, 1);
  assert.equal((await as(fan, { action: 'publish', id: 'abcd2345', spec })).status, 403, "can't overwrite someone else's game");

  // a fan plays v1 and posts a verified score
  const v1 = sanitize(spec);
  const sim = botPlay(v1, 77);
  const sc = await post('/api/scores', { board: 'ugc', key: 'abcd2345-1', seed: 77, log: sim.log, score: sim.score, v: ENGINE_VERSION, playerId: fan.playerId, token: fan.token });
  assert.equal(sc.status, 200, sc.body.error);
  assert.equal(sc.body.verified, sim.score);
  const forged = await post('/api/scores', { board: 'ugc', key: 'abcd2345-1', seed: 77, log: sim.log, score: sim.score + 1, v: ENGINE_VERSION, playerId: fan.playerId, token: fan.token });
  assert.equal(forged.status, 422);
  assert.equal((await post('/api/scores', { board: 'ugc', key: 'abcd2345-9', seed: 77, log: sim.log, v: ENGINE_VERSION, playerId: fan.playerId, token: fan.token })).status, 404);

  assert.equal((await as(fan, { action: 'play', id: 'abcd2345' })).status, 200);
  assert.equal((await as(fan, { action: 'rate', id: 'abcd2345', stars: 4 })).status, 200);
  assert.equal((await as(fan, { action: 'rate', id: 'abcd2345', stars: 9 })).status, 400);

  // update to v2 – v1 scores stay verifiable, v2 gets its own board
  const p2 = await as(maker, { action: 'publish', id: 'abcd2345', spec: { ...spec, rules: { ...spec.rules, speed: 5 } }, note: 'Faster!' });
  assert.equal(p2.body.version, 2);
  const g = await get(`/api/ugc?id=abcd2345&playerId=${fan.playerId}`);
  assert.equal(g.body.version, 2);
  assert.equal(g.body.spec.rules.speed, 5);
  assert.equal(g.body.history.at(-1).note, 'Faster!');
  assert.equal(g.body.rating, 4);
  assert.equal(g.body.myRating, 4);
  assert.equal(g.body.plays, 1);
  assert.equal(g.body.owner, 'Clever Octopus 11');
  assert.equal((await get('/api/leaderboard?board=ugc&key=abcd2345-1')).body.entries[0].score, sim.score);

  // fair ratings: the maker can't rate their own game; you must play before rating or reporting
  assert.equal((await as(maker, { action: 'play', id: 'abcd2345' })).status, 200);
  assert.equal((await as(maker, { action: 'rate', id: 'abcd2345', stars: 5 })).status, 403);
  const lurker = (await post('/api/register', { name: 'Shy Crab 20' })).body;
  assert.equal((await as(lurker, { action: 'play', id: 'abcd2345', seed: 1, log: [['zz']], version: 1 })).status, 422, 'forged play rejected');
  assert.equal((await as(lurker, { action: 'rate', id: 'abcd2345', stars: 1 })).status, 403);
  assert.equal((await as(lurker, { action: 'report', id: 'abcd2345' })).status, 403);

  // reports from players hold a version for review (off the shelves, the maker is told)
  for (let i = 0; i < 3; i++) {
    const r = (await post('/api/register', { name: `Calm Seal ${30 + i}` })).body;
    await as(r, { action: 'play', id: 'abcd2345' });
    assert.equal((await as(r, { action: 'report', id: 'abcd2345' })).status, 403, 'a bare play ping is not enough');
    const run = botPlay(v1, 300 + i);
    assert.equal((await as(r, { action: 'play', id: 'abcd2345', seed: 300 + i, log: run.log, version: 1 })).status, 200);
    assert.equal((await as(r, { action: 'report', id: 'abcd2345' })).status, 200);
  }
  assert.equal((await get(`/api/ugc?playerId=${fan.playerId}`)).body.games.length, 0, 'held after 3 reports');
  const mine = (await get(`/api/ugc?playerId=${maker.playerId}`)).body.games;
  assert.equal(mine.length, 1, 'maker still sees it');
  assert.equal(mine[0].underReview, true, 'and is told it is under review');
  // only a moderator can clear it
  assert.equal((await as(fan, { action: 'moderate', id: 'abcd2345', decision: 'clear', admin: 'nope' })).status, 403);
  process.env.ADMIN_KEY = 'test-admin-key';
  assert.equal((await as(fan, { action: 'moderate', id: 'abcd2345', decision: 'clear', admin: 'test-admin-key' })).status, 200);
  delete process.env.ADMIN_KEY;
  assert.equal((await get(`/api/ugc?playerId=${fan.playerId}`)).body.games.length, 1, 'cleared by a moderator');

  assert.equal((await as(fan, { action: 'delete', id: 'abcd2345' })).status, 403);
  assert.equal((await as(maker, { action: 'delete', id: 'abcd2345' })).status, 200);
  assert.equal((await get('/api/ugc?id=abcd2345')).status, 404);
});
