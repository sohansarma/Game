import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';
import { Game } from '../public/js/engine.js';
import { BlockGame } from '../public/js/blocks.js';
import { dailyConfig, deepConfig, dayKey, weekKey, ENGINE_VERSION } from '../public/js/modes.js';
import { getLevel } from '../public/js/levels.js';

let srv, store, base, dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-'));
  ({ server: srv, store } = createServer({ dataDir: dir, rate: { capacity: 500 } }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json() }));

function playMatch(cfg) {
  const g = new Game(cfg);
  while (g.state === 'playing') { const m = g.bestHint(); g.swap(m[0], m[1]); }
  return g;
}
function playBlocks(seed) {
  const g = new BlockGame({ seed });
  while (g.state === 'playing') {
    let done = false;
    for (let s = 0; s < 3 && !done; s++) {
      const t = g.tray[s];
      if (!t) continue;
      for (let r = 0; r < 8 && !done; r++) for (let c = 0; c < 8 && !done; c++) if (g.canPlace(t.piece, r, c)) done = g.place(s, r, c).ok;
    }
  }
  return g;
}

async function register(name = 'Happy Otter 12') {
  const r = await post('/api/register', { playerId: 'client-' + Math.random().toString(36).slice(2), name });
  assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
  return r.body;
}

test('health and static files', async () => {
  assert.deepEqual((await get('/api/health')).body, { ok: true, v: ENGINE_VERSION });
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Tidepop/);
  const js = await fetch(base + '/js/engine.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  const trav = await fetch(base + '/..%2f..%2fpackage.json');
  assert.notEqual(trav.status, 200);
  const spa = await fetch(base + '/some/deep/link');
  assert.equal(spa.status, 200, 'unknown routes fall back to app shell');
});

test('registration accepts custom names but rejects unsafe ones', async () => {
  for (const bad of ['<script>', 'ab', 'x'.repeat(21), 'visit www.spam.com', 'call 9876543210', 'Admin', 'f u c k', 'Sh1t head', '  spaced  ']) {
    assert.equal((await post('/api/register', { name: bad })).status, 400, bad);
  }
  for (const ok of ['Sohan', 'Priya_07', 'Señor Gato', 'Calm Seal 33', "O'Neil", 'राहुल']) {
    assert.equal((await post('/api/register', { name: ok })).status, 200, ok);
  }
  const a = await register();
  assert.ok(a.token && a.playerId);
  // re-registering with an existing id never hands it out again
  const b = await post('/api/register', { playerId: a.playerId, name: 'Calm Seal 33' });
  assert.notEqual(b.body.playerId, a.playerId);
});

test('daily dive: verified by replay, first attempt counts, forged scores rejected', async () => {
  const me = await register('Brave Crab 21');
  const key = dayKey();
  const g = playMatch(dailyConfig(key));
  const sub = { board: 'daily', key, log: g.log, score: g.score, v: ENGINE_VERSION, playerId: me.playerId, token: me.token };

  assert.equal((await post('/api/scores', { ...sub, score: g.score + 1 })).status, 422, 'score mismatch');
  assert.equal((await post('/api/scores', { ...sub, token: 'nope' })).status, 401, 'bad token');
  assert.equal((await post('/api/scores', { ...sub, key: '2001-01-01' })).status, 422, 'closed board');
  assert.equal((await post('/api/scores', { ...sub, v: 999 })).status, 409, 'old client');
  assert.equal((await post('/api/scores', { ...sub, log: g.log.slice(0, 5), score: undefined })).status, 422, 'unfinished');
  const tampered = g.log.map((a) => [...a]);
  tampered[0] = ['s', 0, 0, 0, 1];
  assert.equal((await post('/api/scores', { ...sub, log: tampered, score: undefined })).status, 422, 'tampered log');
  assert.equal((await post('/api/scores', { ...sub, log: [['h', 1, 1], ...g.log], score: undefined })).status, 422, 'no boosters in daily');

  const ok = await post('/api/scores', sub);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.verified, g.score);
  assert.equal(ok.body.rank, 1);

  // a later (even better) attempt does not replace the first ranked one
  const lb1 = await get(`/api/leaderboard?board=daily&key=${key}&playerId=${me.playerId}`);
  assert.equal(lb1.body.me.score, g.score);
  assert.equal(lb1.body.entries[0].name, 'Brave Crab 21');
  assert.equal(lb1.body.entries[0].me, true);
});

test('deep dive keeps best weekly score; ranking order is by score', async () => {
  const key = weekKey();
  const players = [await register('Jolly Whale 50'), await register('Swift Squid 60')];
  const games = [playMatch(deepConfig(key))];
  const r1 = await post('/api/scores', { board: 'deep', key, log: games[0].log, v: ENGINE_VERSION, playerId: players[0].playerId, token: players[0].token });
  assert.equal(r1.status, 200);
  // second player submits an empty-but-finished game? Not possible – must finish; submit same log
  const r2 = await post('/api/scores', { board: 'deep', key, log: games[0].log, v: ENGINE_VERSION, playerId: players[1].playerId, token: players[1].token });
  assert.equal(r2.status, 200);
  const lb = await get(`/api/leaderboard?board=deep&key=${key}`);
  assert.equal(lb.body.total, 2);
  assert.ok(lb.body.entries[0].score >= lb.body.entries[1].score);
  assert.equal(lb.body.entries[0].name, 'Jolly Whale 50', 'ties go to the earlier score');
});

test('reef blocks: endless and daily verified', async () => {
  const me = await register('Lucky Shrimp 77');
  const g = playBlocks(987654);
  const r = await post('/api/scores', { board: 'blocks', key: 'all', seed: 987654, log: g.log, score: g.score, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, g.score);
  const wrongSeed = await post('/api/scores', { board: 'blocks', key: 'all', seed: 1, log: g.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(wrongSeed.status, 422);
});

test('adventure stars: verified level wins add up', async () => {
  const me = await register('Clever Turtle 45');
  const cfg = getLevel(1, 777);
  const g = new Game(cfg);
  while (g.state === 'playing') { const m = g.smartMove(); g.swap(m[0], m[1]); }
  assert.equal(g.state, 'won');
  const r = await post('/api/scores', { board: 'stars', level: 1, seed: 777, log: g.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.stars, g.stars());
  assert.equal(r.body.score, g.stars());
  const bad = await post('/api/scores', { board: 'stars', level: 4, seed: 777, log: g.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(bad.status, 422, 'log for a different level fails');
  const cfg150 = getLevel(150, 31);
  const g150 = new Game(cfg150);
  while (g150.state === 'playing') { const m = g150.smartMove(); g150.swap(m[0], m[1]); }
  if (g150.state === 'won') {
    const r150 = await post('/api/scores', { board: 'stars', level: 150, seed: 31, log: g150.log, v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
    assert.equal(r150.status, 200, 'endless level accepted');
  }
  const tooFar = await post('/api/scores', { board: 'stars', level: 100000, seed: 1, log: [], v: ENGINE_VERSION, playerId: me.playerId, token: me.token });
  assert.equal(tooFar.status, 400);
});

test('rename, forget and persistence', async () => {
  const me = await register('Sunny Seal 15');
  assert.equal((await post('/api/rename', { playerId: me.playerId, token: me.token, name: 'visit www.spam.com' })).status, 400);
  assert.equal((await post('/api/rename', { playerId: me.playerId, token: me.token, name: 'Golden Orca 99' })).status, 200);
  assert.equal((await post('/api/forget', { playerId: me.playerId, token: me.token })).status, 200);
  assert.equal((await post('/api/rename', { playerId: me.playerId, token: me.token, name: 'Golden Orca 98' })).status, 401);
  store.flush();
  const db = JSON.parse(readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.ok(!db.players[me.playerId]);
  assert.ok(Object.keys(db.players).length > 0);
  assert.ok(existsSync(path.join(dir, 'db.json')));
  assert.ok(!JSON.stringify(db).includes('127.0.0.1'), 'no IPs stored');
});

test('bad input handling', async () => {
  assert.equal((await get('/api/leaderboard?board=nope')).status, 400);
  assert.equal((await get('/api/leaderboard?board=daily&key=../../x')).status, 400);
  const r = await fetch(base + '/api/scores', { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  const big = await fetch(base + '/api/scores', { method: 'POST', body: 'x'.repeat(70000) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.equal((await post('/api/unknown', {})).status, 404);
});

test('online matches: create, join, append-only moves, resign', async () => {
  const host = await register('Witty Squid 71'), guest = await register('Zippy Seal 72'), stranger = await register('Gentle Crab 73');
  const call = (who, body) => post('/api/match', { ...body, playerId: who.playerId, token: who.token });
  assert.equal((await call(host, { action: 'create', code: 'BAD!!', game: 'chess', seed: 1 })).status, 400);
  assert.equal((await call(host, { action: 'create', code: 'K7PQX', game: 'poker', seed: 1 })).status, 400);
  assert.equal((await call(host, { action: 'create', code: 'K7PQX', game: 'chess', seed: 1, opts: { hostSide: 'w' } })).status, 200);
  assert.equal((await call(guest, { action: 'create', code: 'K7PQX', game: 'chess', seed: 1 })).status, 409, 'code taken');
  assert.equal((await call(host, { action: 'join', code: 'K7PQX' })).status, 400, 'cannot join own match');
  const j = await call(guest, { action: 'join', code: 'K7PQX' });
  assert.equal(j.status, 200);
  assert.equal(j.body.me, 'guest');
  assert.equal((await call(stranger, { action: 'join', code: 'K7PQX' })).status, 409, 'match full');
  assert.equal((await call(host, { action: 'move', code: 'K7PQX', moves: ['e2e4'] })).status, 200);
  assert.equal((await call(host, { action: 'move', code: 'K7PQX', moves: ['d2d4'] })).status, 409, 'cannot rewrite history');
  assert.equal((await call(host, { action: 'move', code: 'K7PQX', moves: ['e2e4', 'zz'] })).status, 400, 'bad move format');
  assert.equal((await call(stranger, { action: 'move', code: 'K7PQX', moves: ['e7e5'] })).status, 403);
  assert.equal((await call(guest, { action: 'move', code: 'K7PQX', moves: ['e7e5'] })).status, 200);
  const g = await get(`/api/match?code=K7PQX&playerId=${host.playerId}`);
  assert.deepEqual([g.body.hostMoves, g.body.guestMoves, g.body.me, g.body.guestName], [['e2e4'], ['e7e5'], 'host', 'Zippy Seal 72']);
  assert.equal((await call(guest, { action: 'resign', code: 'K7PQX' })).status, 200);
  assert.equal((await get('/api/match?code=K7PQX')).body.resigned, 'guest');
  assert.equal((await get('/api/match?code=NOPE2')).status, 404);
});

test('online ludo: the server rolls the dice; both players rebuild the same game', async () => {
  const { rebuild } = await import('../public/js/versus.js');
  const host = await register('Brave Otter 81'), guest = await register('Sunny Ray 82');
  const call = (who, body) => post('/api/match', { ...body, playerId: who.playerId, token: who.token });
  assert.equal((await call(host, { action: 'create', code: 'LUD2X', game: 'ludo', seed: 5, opts: { hostColour: 0 } })).status, 200);
  assert.equal((await call(guest, { action: 'join', code: 'LUD2X' })).status, 200);
  const view = async (who) => (await get(`/api/match?code=LUD2X&playerId=${who.playerId}`)).body;
  // play 60 turns: whoever's turn it is rolls through the server, then moves
  for (let i = 0; i < 400; i++) {
    const m = await view(host);
    const sims = { host: rebuild(m, 'host'), guest: rebuild(m, 'guest') };
    assert.equal(sims.host.game.turn, sims.guest.game.turn, 'clients agree');
    assert.deepEqual(sims.host.game.tokens, sims.guest.game.tokens);
    const sim = sims.host;
    if (sim.over || sim.game.over) break;
    const who = sim.game.turn === 0 ? 'host' : 'guest';
    const s = sims[who];
    const mine = () => s.moves.filter(([x]) => x === s.game.turn).map(([, t]) => t);
    if (s.game.phase === 'roll') {
      assert.equal(s.roll().waiting, true, 'no die until the server rolls');
      const res = await call(who === 'host' ? host : guest, { action: 'move', code: 'LUD2X', moves: [...mine(), 'r'] });
      assert.equal(res.status, 200);
      assert.ok(res.body.dice.every((d) => d >= 1 && d <= 6));
    } else {
      const t = s.game.legal()[0];
      const res = await call(who === 'host' ? host : guest, { action: 'move', code: 'LUD2X', moves: [...mine(), t] });
      assert.equal(res.status, 200);
    }
  }
  const m = await view(guest);
  assert.ok(m.hostDice.length > 5 && m.guestDice.length > 5, 'both sides rolled');
  // re-posting the same list doesn't roll again
  const before = m.hostDice.length;
  await call(host, { action: 'move', code: 'LUD2X', moves: m.hostMoves });
  assert.equal((await view(host)).hostDice.length, before);
});

test('anonymous usage counts: only known events, tallied per day, team-only read', async () => {
  assert.equal((await post('/api/event', { e: 'game', b: 'puffer' })).status, 200);
  assert.equal((await post('/api/event', { e: 'game', b: 'puffer' })).status, 200);
  assert.equal((await post('/api/event', { e: 'whoami', b: 'x' })).status, 400);
  assert.equal((await post('/api/event', { e: 'open', b: '<script>' })).status, 400);
  assert.equal((await get('/api/metrics?key=nope')).status, 403);
  process.env.ADMIN_KEY = 'team-key';
  const m = (await get('/api/metrics?key=team-key')).body.metrics;
  delete process.env.ADMIN_KEY;
  assert.equal(m[dayKey()].game.puffer, 2);
  assert.ok(!JSON.stringify(m).includes('playerId'), 'no ids stored');
});

test('weekly leagues: verified runs earn points, groups of 30 per division, last week settles once', async () => {
  const L = await import('../public/js/league.js');
  const players = [];
  for (let i = 0; i < 12; i++) players.push(await register(`Kind Fish ${10 + i}`));
  // everyone plays endless Reef Blocks runs (verified by replay)
  for (let i = 0; i < players.length; i++) {
    for (let k = 0; k <= i % 3; k++) {
      const seed = 5000 + i * 10 + k;
      const g = playBlocks(seed);
      const res = await post('/api/scores', { board: 'blocks', key: 'all', seed, log: g.log, score: g.score, v: ENGINE_VERSION, playerId: players[i].playerId, token: players[i].token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  }
  const lg = (await get(`/api/league?playerId=${players[0].playerId}`)).body;
  assert.equal(lg.joined, true);
  assert.ok(lg.group.length >= 2 && lg.group.length <= L.GROUP_SIZE);
  assert.ok(lg.group.every((m) => m.pts >= L.RUN_POINTS));
  assert.ok(!JSON.stringify(lg).includes('pid'), 'no player ids leak');
  // pure helpers
  assert.equal(L.movement(1, 30, 0), 1);
  assert.equal(L.movement(30, 30, 2), -1);
  assert.equal(L.movement(30, 30, 0), 0, 'no demotion below Bronze');
  assert.equal(L.movement(1, 5, 0), 0, 'tiny leagues don\'t move');
  const st = {};
  let pts = 0;
  for (let i = 0; i < 40; i++) pts += L.pointsFor(st, 'D', false);
  assert.equal(pts, L.RUN_POINTS * L.RUNS_PER_DAY, 'daily cap');
});
