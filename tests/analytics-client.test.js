import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// a tiny browser: localStorage + fetch/sendBeacon capture, set up before the modules load
const sent = [];
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } }, configurable: true });
globalThis.fetch = async (url, opts) => { sent.push({ url, body: opts?.body }); return { ok: true }; };

const { load, update } = await import('../public/js/storage.js');
const an = await import('../public/js/analytics.js');
an.configure({ base: '/api', off: () => false });

const bodies = async () => Promise.all(sent.map(async (x) => JSON.parse(x.body ?? (await x.blob.text()))));
beforeEach(() => { sent.length = 0; mem.clear(); an.flush(); sent.length = 0; });

test('nothing is sent until the age screen is answered, then the held events go out', async () => {
  update((d) => { delete d.ageBand; });
  an.track('open', 'd0');
  an.flush();
  assert.equal(sent.length, 0);
  update((d) => { d.ageBand = '13+'; });
  an.ageAnswered();
  const [b] = await bodies();
  assert.equal(b.aud, 'a');
  assert.deepEqual(b.list, [{ e: 'open', b: 'd0' }]);
});

test('an adult gets a random install id that is reused; it is not part of the save', async () => {
  update((d) => { d.ageBand = '13+'; d.settings.analytics = true; });
  an.track('start', 'chess'); an.flush();
  an.track('end', 'chess', 61.6); an.flush();
  const [a, b] = await bodies();
  assert.match(a.iid, /^[a-f0-9]{32}$/);
  assert.equal(a.iid, b.iid);
  assert.deepEqual(b.list, [{ e: 'end', b: 'chess', n: 62 }]);
  assert.ok(!JSON.stringify(load()).includes(a.iid), 'the id never enters the save (and so never reaches an account)');
});

test('a child never sends or keeps an install id', async () => {
  mem.set('tidepop-iid', 'f'.repeat(32)); // left over from before the age answer
  update((d) => { d.ageBand = 'u13'; d.settings.analytics = true; });
  an.track('open', 'later'); an.flush();
  const [b] = await bodies();
  assert.equal(b.aud, 'c');
  assert.equal('iid' in b, false);
  assert.equal(mem.has('tidepop-iid'), false, 'any old id is wiped');
});

test('with usage counts off nothing is queued or sent', async () => {
  update((d) => { d.ageBand = '13+'; d.settings.analytics = false; });
  an.track('open', 'd0'); an.flush();
  assert.equal(sent.length, 0);
});

test('forgetUsage deletes the local id and asks the server to erase it', async () => {
  update((d) => { d.ageBand = '13+'; d.settings.analytics = true; });
  an.track('open', 'd0'); an.flush();
  const id = (await bodies())[0].iid;
  sent.length = 0;
  an.forgetUsage();
  assert.equal(mem.has('tidepop-iid'), false);
  assert.deepEqual(await bodies(), [{ iid: id }]);
  assert.match(sent[0].url, /\/events\/forget$/);
});

test('buckets are cleaned and the number is clamped', async () => {
  update((d) => { d.ageBand = '13+'; d.settings.analytics = true; });
  an.track('funnel', 'Sign Up <b>!', 999999); an.flush();
  const [b] = await bodies();
  assert.deepEqual(b.list, [{ e: 'funnel', b: 'signupb', n: 86400 }]);
});
