import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const plain = (o) => JSON.parse(JSON.stringify(o)); // objects made inside the VM have another prototype

// Runs the real native-bridge.js against a fake Capacitor and checks what the AdMob plugin receives.
function load({ native = true } = {}) {
  const calls = [];
  const listeners = {};
  const AdMob = {
    initialize: async (o) => calls.push(['initialize', o]),
    requestConsentInfo: async () => ({ status: 'OBTAINED', canRequestAds: true, isConsentFormAvailable: true }),
    showConsentForm: async () => calls.push(['form']),
    prepareRewardVideoAd: async (o) => { calls.push(['prepare', o]); },
    showRewardVideoAd: async () => { calls.push(['show']); listeners.onRewardedVideoAdReward?.(); listeners.onRewardedVideoAdDismissed?.(); },
    addListener: async (name, fn) => { listeners[name] = fn; return { remove() {} }; },
  };
  const SocialLogin = { initialize: async (o) => calls.push(['sl-init', o]), login: async (o) => { calls.push(['sl-login', o]); return { provider: 'google', result: { idToken: 'tok' } }; } };
  const window = { Capacitor: { isNativePlatform: () => native, Plugins: { AdMob, SocialLogin } }, TIDEPOP_ADMOB: { testing: true, rewarded: 'unit-1' } };
  vm.runInNewContext(readFileSync(new URL('../public/js/native-bridge.js', import.meta.url), 'utf8'), { window, setTimeout: () => 0 });
  return { N: window.TidepopNative, calls };
}

test('on the website the bridge does nothing', () => {
  assert.equal(load({ native: false }).N, undefined);
});

test('ratings go to the plugin as words, child flags are passed through', async () => {
  const { N, calls } = load();
  await N.ads.configure({ mode: 'child', childDirected: true, underAge: true, maxRating: 'G' });
  assert.deepEqual(plain(calls[0][1]), { initializeForTesting: true, tagForChildDirectedTreatment: true, tagForUnderAgeOfConsent: true, maxAdContentRating: 'General' });
  await N.ads.configure({ mode: 'personalized', childDirected: false, underAge: false, maxRating: 'PG' });
  assert.equal(calls[1][1].maxAdContentRating, 'ParentalGuidance');
});

test('a rewarded ad resolves "rewarded" only after the reward event, and asks for non-personalised unless personalised', async () => {
  const { N, calls } = load();
  await N.ads.configure({ mode: 'non-personalized', childDirected: false, underAge: false, maxRating: 'PG' });
  assert.equal(await N.ads.showRewarded({ placement: 'endgame' }), 'rewarded');
  assert.deepEqual(plain(calls.find((c) => c[0] === 'prepare')[1]), { adId: 'unit-1', isTesting: true, npa: true });
});

test('consent maps to granted / denied / notrequired and Google sign-in returns the ID token', async () => {
  const { N } = load();
  assert.equal(await N.ads.requestConsent(), 'granted');
  assert.equal(await N.googleIdToken('web-client'), 'tok');
});
