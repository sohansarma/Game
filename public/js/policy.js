// One place that decides what a player may be shown or asked to do, based on
// the age band they chose on the neutral "How old are you?" screen
// (storage: ageBand = 'u13' | '13+').
//
//   • Under 13 is a child. So is anyone who hasn't answered yet – we ask first
//     and never guess the permissive way.
//   • Children: no accounts, no Google sign-in, no custom names or publishing,
//     no install id in analytics, and only child-safe, non-personalised ads
//     (no advertising id) from Families-certified networks.
//   • Everyone else: all of the above, with personalised ads only after the
//     consent flow said yes (or said it isn't required where they live).
//
// Every feature that touches accounts, ads or analytics must ask this file
// rather than read ageBand itself.

import { load } from './storage.js';

export const CHILD_BAND = 'u13';
export const ADULT_BAND = '13+';

/** 'child' | 'adult'. Unanswered counts as child. */
export function audience(s = load()) {
  return s?.ageBand === ADULT_BAND ? 'adult' : 'child';
}

export const ageKnown = (s = load()) => s?.ageBand === CHILD_BAND || s?.ageBand === ADULT_BAND;

/** What the ad SDK should be told. 'child' → child-directed treatment, rating G, no ad id. */
export function adMode(s = load()) {
  if (audience(s) !== 'adult') return 'child';
  const c = s.adsConsent; // set by the consent flow (ads.js): 'granted' | 'denied' | 'notrequired'
  return c === 'granted' || c === 'notrequired' ? 'personalized' : 'non-personalized';
}

export function policy(s = load()) {
  const adult = audience(s) === 'adult';
  return {
    audience: adult ? 'adult' : 'child',
    isChild: !adult,
    ageKnown: ageKnown(s),
    accounts: adult, // username/password accounts and cloud save
    googleSignIn: adult,
    customName: adult, // children get a random friendly name
    publishing: adult, // Creator Studio
    ads: ageKnown(s), // never show an ad before the age screen was answered
    adMode: adMode(s),
    installId: adult && s?.settings?.analytics !== false, // random id for retention; never for children
    analyticsAud: adult ? 'a' : 'c', // sent with analytics so the server can drop ids for children
  };
}
