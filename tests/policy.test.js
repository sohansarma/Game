import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policy, audience, adMode, ageKnown } from '../public/js/policy.js';
import { mergeSaves } from '../public/js/storage.js';

const kid = { ageBand: 'u13', settings: { analytics: true } };
const adult = { ageBand: '13+', settings: { analytics: true } };

test('under 13 and unanswered are both children', () => {
  assert.equal(audience(kid), 'child');
  assert.equal(audience({}), 'child');
  assert.equal(audience({ ageBand: 'garbage' }), 'child');
  assert.equal(audience(adult), 'adult');
  assert.equal(ageKnown({}), false);
  assert.equal(ageKnown(kid), true);
});

test('a child gets no accounts, no sign-in, no install id and child-mode ads', () => {
  const p = policy(kid);
  assert.deepEqual([p.accounts, p.googleSignIn, p.customName, p.publishing, p.installId], [false, false, false, false, false]);
  assert.equal(p.adMode, 'child');
  assert.equal(p.analyticsAud, 'c');
  assert.equal(p.ads, true);
});

test('before the age screen is answered: restricted everywhere, and no ads at all', () => {
  const p = policy({});
  assert.equal(p.isChild, true);
  assert.equal(p.accounts, false);
  assert.equal(p.installId, false);
  assert.equal(p.ads, false);
  assert.equal(p.adMode, 'child');
});

test('an adult gets accounts and sign-in; personalised ads only after consent', () => {
  const p = policy(adult);
  assert.deepEqual([p.accounts, p.googleSignIn, p.customName, p.publishing, p.installId], [true, true, true, true, true]);
  assert.equal(p.analyticsAud, 'a');
  assert.equal(adMode(adult), 'non-personalized', 'no consent answer yet');
  assert.equal(adMode({ ...adult, adsConsent: 'denied' }), 'non-personalized');
  assert.equal(adMode({ ...adult, adsConsent: 'granted' }), 'personalized');
  assert.equal(adMode({ ...adult, adsConsent: 'notrequired' }), 'personalized');
  assert.equal(adMode({ ...kid, adsConsent: 'granted' }), 'child', 'consent never loosens a child');
});

test('an adult who switched usage counts off gets no install id', () => {
  assert.equal(policy({ ageBand: '13+', settings: { analytics: false } }).installId, false);
});

test('merging devices never loosens the age answer', () => {
  const a = { v: 1, ageBand: '13+', updatedAt: 5 };
  const b = { v: 1, ageBand: 'u13', updatedAt: 1 };
  assert.equal(mergeSaves(a, b).ageBand, 'u13');
  assert.equal(mergeSaves(b, a).ageBand, 'u13');
  assert.equal(mergeSaves({ v: 1, ageBand: '13+', updatedAt: 1 }, { v: 1, updatedAt: 2 }).ageBand, '13+');
});
