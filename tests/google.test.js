import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';
import { createGoogleVerifier, verifyGoogleIdToken } from '../server/google.js';

const CID = 'tidepop-test.apps.googleusercontent.com';
const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const evil = generateKeyPairSync('rsa', { modulusLength: 2048 });
const getKey = async (kid) => (kid === 'k1' ? good.publicKey : null);
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function idToken(over = {}, { key = good.privateKey, header = {} } = {}) {
  const t = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: CID, sub: 'g-1001', iat: t, exp: t + 3600, email: 'someone@example.com', name: 'Someone', ...over };
  const head = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...header };
  const input = b64(head) + '.' + b64(claims);
  const sig = createSign('RSA-SHA256').update(input).sign(key).toString('base64url');
  return input + '.' + sig;
}

const opts = { clientIds: [CID], getKey };
const rejects = (tok, re) => assert.rejects(verifyGoogleIdToken(tok, opts), re);

test('a correctly signed, current token for our client id is accepted – only the id comes out', async () => {
  const r = await verifyGoogleIdToken(idToken(), opts);
  assert.deepEqual(r, { sub: 'g-1001' });
});

test('tokens that are forged, for another app, expired or malformed are refused', async () => {
  await rejects(idToken({}, { key: evil.privateKey }), /bad signature/);
  await rejects(idToken({ aud: 'someone-elses-app' }), /wrong audience/);
  await rejects(idToken({ iss: 'https://evil.example' }), /wrong issuer/);
  await rejects(idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), /expired/);
  await rejects(idToken({ iat: Math.floor(Date.now() / 1000) + 3600 }), /future/);
  await rejects(idToken({}, { header: { kid: 'unknown' } }), /unknown signing key/);
  await rejects(idToken({}, { header: { alg: 'none' } }), /bad token/);
  await rejects(idToken({ sub: '' }), /bad token/);
  await rejects('not.a.jwt', /bad token/);
  await rejects('x', /bad token/);
  await assert.rejects(verifyGoogleIdToken(idToken(), { clientIds: [], getKey }), /not set up/);
});

let srv, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tidepop-g-'));
  ({ server: srv } = createServer({ dataDir: dir, rate: { capacity: 5000 }, google: createGoogleVerifier({ clientIds: [CID], getKey }) }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });

const acc = (op, body) => fetch(`${base}/api/account/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('health tells the app Google sign-in is on (the client id is public by design)', async () => {
  const h = await fetch(base + '/api/health').then((r) => r.json());
  assert.equal(h.google, CID);
});

test('Google sign-in: creates a friendly, id-only account for 13+, reuses it next time', async () => {
  assert.equal((await acc('google', { idToken: idToken() })).status, 403, 'no age answer → no new account');
  assert.equal((await acc('google', { idToken: idToken(), age: 'u13' })).status, 403, 'under 13 → no new account');
  const a = await acc('google', { idToken: idToken(), age: '13+' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.created, true);
  assert.match(a.body.username, /^[a-z]+\d{4}$/);
  assert.equal(a.body.recovery, undefined, 'Google is the recovery – no code to lose');
  assert.equal(a.body.google, true);
  assert.equal(a.body.password, false);
  const again = await acc('google', { idToken: idToken() }); // a second device: no age needed for an existing account
  assert.equal(again.body.created, false);
  assert.equal(again.body.username, a.body.username);
  assert.equal(again.body.playerId, a.body.playerId, 'same leaderboard player on every device');
  assert.notEqual(again.body.session, a.body.session);
  const stored = JSON.stringify(JSON.parse(JSON.stringify(await fetch(base + '/api/health').then((r) => r.json()))));
  assert.ok(!stored.includes('someone@example.com'));
});

test('the Google account can save and load, cannot use a password, and a forged token gets nowhere', async () => {
  const { body: a } = await acc('google', { idToken: idToken({ sub: 'g-2002' }), age: '13+' });
  const put = await acc('save', { session: a.session, op: 'put', baseRev: 0, save: { v: 1, shells: 5 } });
  assert.equal(put.status, 200);
  assert.equal((await acc('save', { session: a.session, op: 'get' })).body.save.shells, 5);
  assert.equal((await acc('login', { username: a.username, password: 'anything-at-all' })).status, 401);
  assert.equal((await acc('recover', { username: a.username, code: '0000-0000-0000-0000-0000', password: 'new-pass-123' })).status, 401);
  assert.equal((await acc('password', { session: a.session, current: 'x', password: 'new-pass-123' })).status, 400);
  assert.equal((await acc('google', { idToken: idToken({ sub: 'g-2002' }, { key: evil.privateKey }), age: '13+' })).status, 401);
});

test('linking Google to a password account, conflicts, unlinking and deleting', async () => {
  const pw = (await acc('signup', { age: '13+', username: 'linker', password: 'blue-harbour-7' })).body;
  const linked = await acc('google-link', { session: pw.session, idToken: idToken({ sub: 'g-3003' }) });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.google, true);
  assert.equal(linked.body.password, true);
  // signing in with Google now opens that same account
  const viaG = await acc('google', { idToken: idToken({ sub: 'g-3003' }) });
  assert.equal(viaG.body.username, 'linker');
  // that Google account can't be attached to a second Tidepop account
  const other = (await acc('signup', { age: '13+', username: 'otherone', password: 'green-harbour-7' })).body;
  assert.equal((await acc('google-link', { session: other.session, idToken: idToken({ sub: 'g-3003' }) })).status, 409);
  // a Google-only account can't unlink (it would lock itself out); a password account can
  const gOnly = (await acc('google', { idToken: idToken({ sub: 'g-4004' }), age: '13+' })).body;
  assert.equal((await acc('google-unlink', { session: gOnly.session })).status, 400);
  assert.equal((await acc('google-unlink', { session: pw.session })).status, 200);
  assert.equal((await acc('google', { idToken: idToken({ sub: 'g-3003' }), age: '13+' })).body.created, true, 'after unlinking, that Google id is no longer tied to "linker"');
  // deleting a Google-only account needs a fresh sign-in from that same Google account
  assert.equal((await acc('delete', { session: gOnly.session, idToken: idToken({ sub: 'g-9999' }) })).status, 401);
  assert.equal((await acc('delete', { session: gOnly.session, idToken: idToken({ sub: 'g-4004' }) })).status, 200);
  assert.equal((await acc('me', { session: gOnly.session })).status, 401);
});

test('without GOOGLE_CLIENT_IDS the server says so instead of guessing', async () => {
  const d2 = mkdtempSync(path.join(tmpdir(), 'tidepop-g2-'));
  const { server: s2 } = createServer({ dataDir: d2, google: createGoogleVerifier({ clientIds: [], getKey }) });
  await new Promise((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const r = await fetch(`${b2}/api/account/google`, { method: 'POST', body: JSON.stringify({ idToken: idToken(), age: '13+' }) });
  assert.equal(r.status, 503);
  assert.equal((await fetch(b2 + '/api/health').then((x) => x.json())).google, undefined);
  s2.close(); rmSync(d2, { recursive: true, force: true });
});
