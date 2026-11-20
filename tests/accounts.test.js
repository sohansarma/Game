import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';
import { mergeSaves, defaultSave } from '../public/js/storage.js';

let srv, base, dir, store;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-acc-'));
  ({ server: srv, store } = createServer({ dataDir: dir, rate: { capacity: 1000 } }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const acc = (op, body) => post('/api/account/' + op, body);

test('sign up validates username and password', async () => {
  assert.equal((await acc('signup', { username: 'olderkid', password: 'goodpass1' })).status, 403, 'no age answer → no account');
  assert.equal((await acc('signup', { age: 'u13', username: 'olderkid', password: 'goodpass1' })).status, 403, 'under 13 → no account');
  assert.equal((await acc('signup', { age: '13+', username: 'ab', password: 'goodpass1' })).status, 400);
  assert.equal((await acc('signup', { age: '13+', username: 'Admin', password: 'goodpass1' })).status, 400);
  assert.equal((await acc('signup', { age: '13+', username: 'sohan', password: 'short' })).status, 400);
  assert.equal((await acc('signup', { age: '13+', username: 'sohan', password: 'password' })).status, 400);
  assert.equal((await acc('signup', { age: '13+', username: 'sohan', password: 'mysohanpw' })).status, 400, 'username inside password');
});

test('sign up links this device, log in elsewhere, scores land on one player', async () => {
  const reg = (await post('/api/register', { name: 'Night Owl' })).body;
  const s = await acc('signup', { age: '13+', username: 'Sohan_28', password: 'rainy-nights-42', playerId: reg.playerId, token: reg.token });
  assert.equal(s.status, 200, s.body.error);
  assert.equal(s.body.playerId, reg.playerId, 'existing leaderboard player kept');
  assert.match(s.body.recovery, /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  assert.equal((await acc('signup', { age: '13+', username: 'sohan_28', password: 'another-pass-9' })).status, 409, 'usernames are case-insensitive');
  // second device
  const l = await acc('login', { username: 'SOHAN_28', password: 'rainy-nights-42' });
  assert.equal(l.status, 200);
  assert.equal(l.body.playerId, reg.playerId);
  assert.ok(l.body.token && l.body.token !== reg.token, 'device gets its own player token');
  // both tokens can rename (= submit as) the same player
  assert.equal((await post('/api/rename', { playerId: reg.playerId, token: l.body.token, name: 'Sleepy Sohan' })).status, 200);
  assert.equal((await post('/api/rename', { playerId: reg.playerId, token: reg.token, name: 'Sleepy Sohan' })).status, 200);
  const me = await acc('me', { session: l.body.session });
  assert.equal(me.body.name, 'Sleepy Sohan');
  // passwords are never stored in clear
  store.flush();
  const raw = readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes('rainy-nights-42') && !raw.includes(l.body.session) && !raw.includes(s.body.recovery));
});

test('cloud save: revisions stop silent overwrites', async () => {
  const a = (await acc('signup', { age: '13+', username: 'savetester', password: 'cloudy-day-77' })).body;
  const b = (await acc('login', { username: 'savetester', password: 'cloudy-day-77' })).body;
  assert.deepEqual((await acc('save', { session: a.session, op: 'get' })).body, { save: null, rev: 0, at: null });
  const save1 = { ...defaultSave(), shells: 120 };
  const p1 = await acc('save', { session: a.session, op: 'put', save: save1, baseRev: 0 });
  assert.equal(p1.body.rev, 1);
  // device B still thinks rev 0 -> conflict, gets the newer save back
  const p2 = await acc('save', { session: b.session, op: 'put', save: { ...defaultSave(), shells: 5 }, baseRev: 0 });
  assert.equal(p2.body.conflict, true);
  assert.equal(p2.body.save.shells, 120);
  assert.equal((await acc('save', { session: b.session, op: 'put', save: { ...save1, shells: 130 }, baseRev: 1 })).body.rev, 2);
  assert.equal((await acc('save', { session: a.session, op: 'put', save: { v: 2 }, baseRev: 2 })).status, 400);
  assert.equal((await acc('save', { session: 'nope', op: 'get' })).status, 401);
  const huge = { ...defaultSave(), junk: 'x'.repeat(260 * 1024) };
  const big = await fetch(base + '/api/account/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: a.session, op: 'put', save: huge, baseRev: 2 }) }).catch(() => ({ status: 413 }));
  assert.ok(big.status === 413 || big.status === 400);
});

test('wrong passwords lock the account for a while', async () => {
  await acc('signup', { age: '13+', username: 'locktest', password: 'safe-harbour-1' });
  for (let i = 0; i < 5; i++) assert.equal((await acc('login', { username: 'locktest', password: 'wrong-guess-' + i })).status, 401);
  const locked = await acc('login', { username: 'locktest', password: 'safe-harbour-1' });
  assert.equal(locked.status, 429, 'even the right password waits during the lock');
  assert.equal((await acc('login', { username: 'nobody-here', password: 'whatever-123' })).status, 401);
});

test('recovery code resets the password and signs out other devices', async () => {
  const s = (await acc('signup', { age: '13+', username: 'forgetful', password: 'first-pass-11' })).body;
  assert.equal((await acc('recover', { username: 'forgetful', code: 'AAAA-BBBB-CCCC-DDDD-EEEE', password: 'second-pass-22' })).status, 401);
  const r = await acc('recover', { username: 'forgetful', code: s.recovery.toLowerCase(), password: 'second-pass-22' });
  assert.equal(r.status, 200, r.body.error);
  assert.notEqual(r.body.recovery, s.recovery, 'a new recovery code is issued');
  assert.equal((await acc('me', { session: s.session })).status, 401, 'old session revoked');
  assert.equal((await acc('login', { username: 'forgetful', password: 'second-pass-22' })).status, 200);
  assert.equal((await acc('recover', { username: 'forgetful', code: s.recovery, password: 'third-pass-33' })).status, 401, 'old code is used up');
});

test('change password, log out, delete account', async () => {
  const s = (await acc('signup', { age: '13+', username: 'tidyuser', password: 'orig-pass-55' })).body;
  const other = (await acc('login', { username: 'tidyuser', password: 'orig-pass-55' })).body;
  assert.equal((await acc('password', { session: s.session, current: 'nope-nope-1', password: 'new-pass-66x' })).status, 401);
  assert.equal((await acc('password', { session: s.session, current: 'orig-pass-55', password: 'new-pass-66x' })).status, 200);
  assert.equal((await acc('me', { session: other.session })).status, 401, 'other devices must sign in again');
  assert.equal((await acc('me', { session: s.session })).status, 200);
  assert.equal((await acc('logout', { session: s.session })).status, 200);
  assert.equal((await acc('me', { session: s.session })).status, 401);
  const again = (await acc('login', { username: 'tidyuser', password: 'new-pass-66x' })).body;
  assert.equal((await acc('delete', { session: again.session, password: 'wrong-one-1' })).status, 401);
  assert.equal((await acc('delete', { session: again.session, password: 'new-pass-66x' })).status, 200);
  assert.equal((await acc('login', { username: 'tidyuser', password: 'new-pass-66x' })).status, 401);
});

test('merging two saves keeps the best progress from both', () => {
  const a = defaultSave(), b = defaultSave();
  a.levels = { 1: { stars: 3, best: 900 }, 2: { stars: 1, best: 200 } };
  b.levels = { 2: { stars: 2, best: 150 }, 3: { stars: 1, best: 80 } };
  a.arcade = { cube: { best: 500, games: 4, daily: { '2026-11-18': 300 } } };
  b.arcade = { cube: { best: 700, games: 2, daily: { '2026-11-17': 100 } }, ludo: { best: 50, games: 1, daily: {} } };
  a.achievements = { first: 1 }; b.achievements = { combo: 2 };
  a.shells = 10; a.updatedAt = 1000; b.shells = 99; b.updatedAt = 2000;
  const m = mergeSaves(a, b);
  assert.deepEqual(m.levels[1], { stars: 3, best: 900 });
  assert.deepEqual(m.levels[2], { stars: 2, best: 200 });
  assert.deepEqual(m.levels[3], { stars: 1, best: 80 });
  assert.equal(m.arcade.cube.best, 700);
  assert.equal(m.arcade.cube.games, 4);
  assert.deepEqual(m.arcade.cube.daily, { '2026-11-18': 300, '2026-11-17': 100 });
  assert.ok(m.arcade.ludo);
  assert.deepEqual(m.achievements, { first: 1, combo: 2 });
  assert.equal(m.shells, 99, 'wallet comes from the newer save');
  // a brand-new device logging in must not wipe the wallet with its default 50 shells
  const cloud = { ...defaultSave(), shells: 777, updatedAt: 1000 }, fresh = { ...defaultSave(), updatedAt: 5000 };
  assert.equal(mergeSaves(cloud, fresh, { firstMerge: true }).shells, 777);
  // Tide Pool items are never lost between devices; layout follows the newer save
  const p1 = { ...defaultSave(), updatedAt: 10, pool: { owned: { towel: 1, palm: 1 }, placed: { rug: 'towel', plantL: 'palm' } } };
  const p2 = { ...defaultSave(), updatedAt: 20, pool: { owned: { towel: 1, kite: 1 }, placed: { sky: 'kite' } } };
  const pm = mergeSaves(p1, p2);
  assert.deepEqual(Object.keys(pm.pool.owned).sort(), ['kite', 'palm', 'towel']);
  assert.deepEqual(pm.pool.placed, { sky: 'kite' });
});
