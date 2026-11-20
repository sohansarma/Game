// Rewarded ads (Android app only). The website never shows ads.
//
// Rules this file enforces (the policy comes from policy.js):
//   • No ad before the age screen was answered.
//   • Under 13 (and unanswered): child-directed treatment, max rating G, no
//     personalisation, no advertising id – and only Families-certified
//     networks may be mediated in the AdMob console.
//   • Adults: Google's consent form (UMP) runs first; personalised ads only if
//     it said yes (or isn't required where they live), otherwise non-personalised.
//   • Rewarded only, always started by the player's tap. Never during a game.
//
// The native Android wrapper provides window.TidepopNative.ads (see
// native-bridge.js and android-app/README.md):
//   configure({ mode, childDirected, underAge, maxRating })
//   requestConsent()          → 'granted' | 'denied' | 'notrequired'
//   showPrivacyOptions()      → opens the "Ad choices" form again (EEA/UK)
//   showRewarded({ placement }) → 'rewarded' | 'closed' | 'noad' | 'failed'

import { load, update } from './storage.js';
import { policy } from './policy.js';
import { track } from './analytics.js';

const bridge = () => (typeof window !== 'undefined' ? window.TidepopNative?.ads : null) || null;
let ready = null;

/** Can this player be offered an ad at all right now? (Android app, age answered.) */
export const adsAvailable = () => !!bridge() && policy().ads;

/** Adults in regions that need it can reopen Google's consent form from Settings. */
export const canChangeAdChoices = () => adsAvailable() && !policy().isChild && typeof bridge()?.showPrivacyOptions === 'function';

/** Sets up the ad SDK for this player's audience. Safe to call often; runs once per launch. */
export function initAds() {
  if (!adsAvailable()) return Promise.resolve(false);
  return (ready ||= (async () => {
    const b = bridge();
    let p = policy();
    if (!p.isChild) {
      // asked on every launch (the form only appears when the law needs it); the answer decides personalisation
      let c = 'denied';
      try { c = await b.requestConsent(); } catch { /* treat as denied: non-personalised */ }
      update((d) => { d.adsConsent = c; });
      track('consent', c);
      p = policy();
    }
    const child = p.adMode === 'child';
    await b.configure({ mode: p.adMode, childDirected: child, underAge: child, maxRating: child ? 'G' : 'PG' });
    return true;
  })().catch(() => { ready = null; return false; }));
}

/** Re-open the consent form, then apply the new choice. */
export async function changeAdChoices() {
  if (!canChangeAdChoices()) return;
  try { await bridge().showPrivacyOptions(); } catch { /* ignore */ }
  ready = null;
  await initAds();
}

// every spot counts its own funnel: the end-of-game bonus is offer/start/done, revive is offer-revive/start-revive/done-revive
const tag = (b, placement) => (placement && placement !== 'endgame' ? `${b}-${placement}` : b);

/** Counted when an ad button is shown, so the dashboard can show offer → start → done per spot. */
export const noteOffer = (placement = 'endgame') => track('ad', tag('offer', placement));

/**
 * Show a rewarded ad the player asked for. Resolves { rewarded } – grant the reward only when true.
 * Every outcome is counted: start, done, skip (closed early), nofill, fail.
 */
export async function showRewarded(placement = 'endgame') {
  if (!adsAvailable() || !(await initAds())) return { rewarded: false, reason: 'unavailable' };
  track('ad', tag('start', placement));
  let r = 'failed';
  try { r = await bridge().showRewarded({ placement }); } catch { r = 'failed'; }
  if (r === 'rewarded') { track('ad', tag('done', placement)); return { rewarded: true }; }
  track('ad', tag(r === 'closed' ? 'skip' : r === 'noad' ? 'nofill' : 'fail', placement));
  return { rewarded: false, reason: r };
}

export const consentState = () => load().adsConsent || null;
