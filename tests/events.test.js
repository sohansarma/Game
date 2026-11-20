import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';

let srv, events, base, dir, clock = new Date('2026-03-01T12:00:00Z');
const IID_A = 'a'.repeat(32), IID_B = 'b'.repeat(32);

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-ev-'));
  ({ server: srv, events } = createServer({ dataDir: dir, now: () => new Date(clock), rate: { capacity: 5000 } }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
  process.env.ADMIN_KEY = 'team-key';
});
after(() => { delete process.env.ADMIN_KEY; srv.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const report = (days = 30, key = 'team-key') => fetch(base + '/api/admin/report?days=' + days, { headers: { 'x-admin-key': key } }).then(async (r) => ({ status: r.status, body: await r.json() }));
const batch = (list, meta = {}) => post('/api/events', { aud: 'a', plat: 'web', iid: IID_A, list, ...meta });

test('the event store is on (node:sqlite) on this Node', () => {
  assert.equal(events.enabled, true);
});

test('batches are validated: known events, safe buckets, a size cap', async () => {
  assert.equal((await batch([{ e: 'start', b: 'chess' }, { e: 'end', b: 'chess', n: 120 }])).status, 200);
  assert.equal((await batch([{ e: 'nope', b: 'x' }])).status, 400);
  assert.equal((await batch([{ e: 'start', b: '<script>' }])).status, 400);
  assert.equal((await batch([{ e: 'end', b: 'chess', n: -5 }])).status, 400);
  assert.equal((await batch([{ e: 'end', b: 'chess', n: 1e9 }])).status, 400);
  assert.equal((await batch([])).status, 400);
  assert.equal((await batch(Array.from({ length: 26 }, () => ({ e: 'start', b: 'x' })))).status, 400);
});

test('children never get an install id stored, even if the client sends one', async () => {
  await post('/api/events', { aud: 'c', iid: IID_B, plat: 'web', list: [{ e: 'open', b: 'later' }] });
  await post('/api/events', { iid: IID_B, list: [{ e: 'open', b: 'later' }] }); // no audience → treated as a child
  await post('/api/event', { e: 'open', b: 'later' }); // legacy single-event form
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'analytics.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events WHERE iid = ?').get(IID_B).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM installs WHERE iid = ?').get(IID_B).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events WHERE aud = 'c'").get().c, 3);
  db.close();
});

test('admin report: team key only, counts audiences apart', async () => {
  assert.equal((await report(30, 'wrong')).status, 403);
  assert.equal((await fetch(base + '/api/admin/report')).status, 403);
  const { status, body } = await report();
  assert.equal(status, 200);
  const d = body.report.perDay['2026-03-01'];
  assert.equal(d.open.c, 3);
  assert.equal(d.start.a, 1);
  assert.equal(body.report.games.chess.start, 1);
  assert.equal(body.report.games.chess.finishRate, 1);
  assert.equal(body.report.dau['2026-03-01'], 1);
});

test('retention: installs that return on day 1 and day 7 are counted once each', async () => {
  const day = (n) => { clock = new Date(Date.UTC(2026, 2, 1 + n, 12)); };
  const IID_C = 'c'.repeat(32), IID_D = 'd'.repeat(32);
  day(2);
  await batch([{ e: 'open', b: 'd0' }], { iid: IID_C });
  await batch([{ e: 'open', b: 'd0' }], { iid: IID_D });
  day(3);
  await batch([{ e: 'open', b: 'later' }], { iid: IID_C }); // C returns on day 1
  day(9);
  await batch([{ e: 'open', b: 'later' }], { iid: IID_C }); // and on day 7
  await batch([{ e: 'open', b: 'later' }], { iid: IID_C }); // twice that day: still one
  day(10);
  const r = (await report()).body.report;
  const c = r.retention['2026-03-03'];
  assert.deepEqual({ size: c.size, d1: c.d1, d7: c.d7, d30: c.d30 }, { size: 2, d1: 1, d7: 1, d30: 0 });
});

test('"delete my usage data" removes an install\'s events', async () => {
  assert.equal((await post('/api/events/forget', { iid: 'nope' })).status, 400);
  await post('/api/events/forget', { iid: IID_A });
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'analytics.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events WHERE iid = ?').get(IID_A).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM installs WHERE iid = ?').get(IID_A).c, 0);
  db.close();
});

test('old events are pruned after the retention window', async () => {
  clock = new Date('2026-12-01T12:00:00Z');
  events.prune();
  const r = (await report(90)).body.report;
  assert.equal(r.totals.events, 0);
});

test('the dashboard page is served without data and is not indexed', async () => {
  const r = await fetch(base + '/admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.match(await r.text(), /team dashboard/);
});

test('app-ads.txt is served only when the AdMob publisher id is set', async () => {
  assert.equal((await fetch(base + '/app-ads.txt')).status, 404);
  process.env.ADMOB_PUBLISHER_ID = 'pub-1234567890123456';
  const r = await fetch(base + '/app-ads.txt');
  delete process.env.ADMOB_PUBLISHER_ID;
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  process.env.ADMOB_PUBLISHER_ID = 'not-an-id';
  assert.equal((await fetch(base + '/app-ads.txt')).status, 404);
  delete process.env.ADMOB_PUBLISHER_ID;
});
