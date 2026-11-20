import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../scripts/preflight.js';

const find = (res, re) => res.find((r) => re.test(r.text));

test('preflight flags the open placeholders and missing accounts, and passes the finished settings', () => {
  const empty = runChecks({ env: {}, node: '22.5.0' });
  assert.equal(find(empty, /ADMIN_KEY/).ok, false);
  assert.equal(find(empty, /ADMOB_PUBLISHER_ID/).ok, false);
  assert.equal(find(empty, /Package name/).ok, false, 'the placeholder package name must be replaced before upload');
  assert.equal(find(empty, /Account-deletion page/).ok, true);
  assert.equal(find(empty, /Android project generated/).ok, true);
  assert.equal(find(empty, /Signing keys are git-ignored/).ok, true);
  const env = { ADMIN_KEY: 'x'.repeat(20), DATA_DIR: '/data', GOOGLE_CLIENT_IDS: 'a.apps.googleusercontent.com', ADMOB_PUBLISHER_ID: 'pub-1234567890123456', TIDEPOP_API_URL: 'https://t.example', ADMOB_APP_ID: 'ca-app-pub-1234567890123456~1234567890', ADMOB_REWARDED_ID: 'ca-app-pub-1234567890123456/1234567890' };
  const done = runChecks({ env, node: '22.5.0' });
  for (const re of [/ADMIN_KEY/, /DATA_DIR/, /GOOGLE_CLIENT_IDS/, /ADMOB_PUBLISHER_ID/, /TIDEPOP_API_URL/, /ADMOB_APP_ID/, /ADMOB_REWARDED_ID/]) assert.equal(find(done, re).ok, true, String(re));
  assert.equal(find(runChecks({ env, node: '20.1.0' }), /Node/).ok, false);
});
