import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// minimal browser + a fake Android bridge
const mem = new Map(), sent = [];
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: (u, blob) => { sent.push(blob); return true; } }, configurable: true });
globalThis.fetch = async (url, opts) => { sent.push(new Blob([opts.body])); return { ok: true }; };

const { update } = await import('../public/js/storage.js');
const an = await import('../public/js/analytics.js');
an.configure({ base: '/api', off: () => false });

let calls, outcome, consent;
function installBridge() {
  calls = [];
  window.TidepopNative = { ads: {
    configure: async (c) => { calls.push(['configure', c]); },
    requestConsent: async () => { calls.push(['consent']); return consent; },
    showPrivacyOptions: async () => { calls.push(['options']); },
    showRewarded: async (o) => { calls.push(['rewarded', o]); return outcome; },
  } };
}

// import fresh each time: ads.js keeps a per-launch "ready" promise
let n = 0;
const freshAds = () => import(`../public/js/ads.js?${n++}`);
const events = async () => (await Promise.all(sent.map((b) => b.text()))).flatMap((t) => JSON.parse(t).list.map((x) => x.e + ':' + x.b));

beforeEach(() => { mem.clear(); sent.length = 0; delete window.TidepopNative; consent = 'granted'; outcome = 'rewarded'; update((d) => { d.settings.analytics = true; delete d.adsConsent; delete d.ageBand; }); });

test('no native bridge (the website) or no age answer: no ads at all', async () => {
  const ads = await freshAds();
  update((d) => { d.ageBand = '13+'; });
  assert.equal(ads.adsAvailable(), false, 'website');
  installBridge();
  update((d) => { delete d.ageBand; });
  assert.equal(ads.adsAvailable(), false, 'age not answered');
  assert.deepEqual(await ads.showRewarded(), { rewarded: false, reason: 'unavailable' });
  assert.equal(calls.length, 0);
});

test('a child: no consent form, child-directed treatment, rating G, no personalisation', async () => {
  installBridge();
  update((d) => { d.ageBand = 'u13'; });
  const ads = await freshAds();
  assert.equal(await ads.initAds(), true);
  assert.deepEqual(calls, [['configure', { mode: 'child', childDirected: true, underAge: true, maxRating: 'G' }]]);
  assert.equal(ads.canChangeAdChoices(), false);
});

test('an adult: consent form first; the answer sets personalised or not', async () => {
  for (const [c, mode] of [['granted', 'personalized'], ['notrequired', 'personalized'], ['denied', 'non-personalized']]) {
    installBridge();
    consent = c;
    update((d) => { d.ageBand = '13+'; delete d.adsConsent; });
    const ads = await freshAds();
    await ads.initAds();
    assert.equal(calls[0][0], 'consent');
    assert.deepEqual(calls[1], ['configure', { mode, childDirected: false, underAge: false, maxRating: 'PG' }]);
  }
});

test('a consent failure falls back to non-personalised, never to personalised', async () => {
  installBridge();
  window.TidepopNative.ads.requestConsent = async () => { throw new Error('no network'); };
  update((d) => { d.ageBand = '13+'; });
  const ads = await freshAds();
  await ads.initAds();
  assert.equal(calls.find((c) => c[0] === 'configure')[1].mode, 'non-personalized');
});

test('a rewarded ad: only a finished ad pays, and every outcome is counted', async () => {
  update((d) => { d.ageBand = '13+'; });
  const ads = await freshAds();
  for (const [out, rewarded, ev] of [['rewarded', true, 'ad:done'], ['closed', false, 'ad:skip'], ['noad', false, 'ad:nofill'], ['failed', false, 'ad:fail']]) {
    installBridge(); outcome = out; sent.length = 0;
    const res = await ads.showRewarded('endgame');
    assert.equal(res.rewarded, rewarded, out + ' ' + JSON.stringify(res) + JSON.stringify(calls));
    an.flush();
    const ev2 = await events();
    assert.ok(ev2.includes('ad:start') && ev2.includes(ev), `${out}: ${ev2}`);
  }
});

test('the offer is counted and Ad choices re-runs setup for adults only', async () => {
  installBridge();
  update((d) => { d.ageBand = '13+'; });
  const ads = await freshAds();
  ads.noteOffer(); an.flush();
  assert.ok((await events()).includes('ad:offer'));
  assert.equal(ads.canChangeAdChoices(), true);
  await ads.changeAdChoices();
  assert.ok(calls.some((c) => c[0] === 'options'));
});

test('revive has its own funnel next to the end-of-game bonus', async () => {
  update((d) => { d.ageBand = '13+'; });
  const ads = await freshAds();
  installBridge(); outcome = 'rewarded'; sent.length = 0;
  ads.noteOffer('revive');
  assert.equal((await ads.showRewarded('revive')).rewarded, true);
  outcome = 'closed';
  await ads.showRewarded('revive');
  an.flush();
  const ev = await events();
  for (const e of ['ad:offer-revive', 'ad:start-revive', 'ad:done-revive', 'ad:skip-revive']) assert.ok(ev.includes(e), e + ' in ' + ev);
  assert.ok(!ev.includes('ad:start'), 'the bonus funnel is untouched');
});
