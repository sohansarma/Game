// "What's still missing before I can ship?"   npm run preflight
// Prints a checklist. Exit code 1 if anything marked ❌ is open (use in CI or before uploading to Play).
// Server settings are read from the environment, so run it where the server runs (or pass them inline):
//   ADMIN_KEY=… GOOGLE_CLIENT_IDS=… ADMOB_PUBLISHER_ID=pub-… npm run preflight

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), 'utf8') : null);

/** Returns [{ ok, level: 'block'|'warn', area, text, how }] */
export function runChecks({ env = process.env, node = process.versions.node } = {}) {
  const out = [];
  const add = (ok, level, area, text, how) => out.push({ ok, level, area, text, how });

  // --- repository content
  const priv = read('public/privacy.html') || '';
  const open = [...priv.matchAll(/\[([^\]]*to be completed[^\]]*)\]/gi)].map((m) => m[1]);
  add(open.length === 0, 'block', 'Privacy page', open.length ? `${open.length} placeholders still open in public/privacy.html: ${open.join(' | ')}` : 'No placeholders left',
    'Fill in the operator name and address, the privacy contact email and the hosting provider/region, then have the page reviewed.');
  add(!!read('public/delete-account.html'), 'block', 'Play Store', 'Account-deletion page exists (public/delete-account.html)', 'Play needs a public web link where people can request account deletion.');
  const cap = JSON.parse(read('android-app/capacitor.config.json') || '{}');
  add(cap.appId && cap.appId !== 'app.tidepop.arcade', 'block', 'Android app', cap.appId === 'app.tidepop.arcade' ? 'Package name is still the placeholder app.tidepop.arcade' : 'Package name set: ' + cap.appId,
    'Pick a package name from a domain you own in android-app/capacitor.config.json AND applicationId/namespace in android-app/android/app/build.gradle (re-run `npx cap sync android`). It is permanent once uploaded to Play.');
  add(existsSync(path.join(root, 'android-app/android/app/build.gradle')), 'block', 'Android app', 'Android project generated (android-app/android)', 'cd android-app && npm install && npx cap add android');
  add(/^\*\.keystore/m.test(read('android-app/android/.gitignore') || ''), 'block', 'Security', 'Signing keys are git-ignored', 'Make sure *.jks, *.keystore and keystore.properties are in android-app/android/.gitignore.');
  add(!!read('store/listing.md'), 'warn', 'Play Store', 'Store listing text is ready (store/listing.md)', 'Run the store asset steps in docs/play-store.md.');

  // --- server settings
  add(Number(node.split('.')[0]) >= 22, 'block', 'Server', `Node ${node} (needs 22.5+)`, 'Use Node 22 or newer.');
  add(!!env.ADMIN_KEY && env.ADMIN_KEY.length >= 16, 'block', 'Server', env.ADMIN_KEY ? 'ADMIN_KEY set' : 'ADMIN_KEY not set (the /admin dashboard and moderation are locked)', 'Set a long random ADMIN_KEY (16+ characters) on the server.');
  add(!!env.DATA_DIR && env.DATA_DIR !== './data', 'warn', 'Server', env.DATA_DIR ? `DATA_DIR=${env.DATA_DIR}` : 'DATA_DIR not set (data is lost on redeploy unless it is on a persistent disk)', 'Mount a persistent disk and point DATA_DIR at it (see render.yaml).');
  add(!!env.GOOGLE_CLIENT_IDS, 'warn', 'Google sign-in', env.GOOGLE_CLIENT_IDS ? 'GOOGLE_CLIENT_IDS set' : 'GOOGLE_CLIENT_IDS not set (Google sign-in stays hidden)', 'Google Cloud Console → Credentials → create a Web OAuth client; set its client id here. See android-app/README.md.');
  add(/^pub-\d{10,20}$/.test(env.ADMOB_PUBLISHER_ID || ''), 'block', 'AdMob', env.ADMOB_PUBLISHER_ID ? 'ADMOB_PUBLISHER_ID set' : 'ADMOB_PUBLISHER_ID not set (/app-ads.txt is off, AdMob will not verify the app)', 'admob.google.com → Settings → Account info → Publisher ID (pub-…). Serve it from the site you list as developer website in Play Console.');

  // --- build settings (GitHub variables / local env)
  add(/^https:\/\//.test(env.TIDEPOP_API_URL || ''), 'warn', 'Android build', env.TIDEPOP_API_URL ? 'TIDEPOP_API_URL set' : 'TIDEPOP_API_URL not set here (set it as a GitHub Actions variable, or inline when building)', 'The https:// address of your deployed server.');
  add(/^ca-app-pub-\d+~\d+$/.test(env.ADMOB_APP_ID || ''), 'warn', 'AdMob', env.ADMOB_APP_ID ? 'ADMOB_APP_ID set' : 'ADMOB_APP_ID not set (release builds refuse to build with Google\'s sample id)', 'AdMob → Apps → App settings → App ID (ca-app-pub-…~…).');
  add(/^ca-app-pub-\d+\/\d+$/.test(env.ADMOB_REWARDED_ID || ''), 'warn', 'AdMob', env.ADMOB_REWARDED_ID ? 'ADMOB_REWARDED_ID set' : 'ADMOB_REWARDED_ID not set (debug builds use Google\'s test ad)', 'AdMob → Apps → Ad units → add a Rewarded unit (ca-app-pub-…/…).');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runChecks();
  let blocked = 0;
  for (const r of res) {
    const icon = r.ok ? '✅' : r.level === 'block' ? '❌' : '⚠️ ';
    console.log(`${icon} [${r.area}] ${r.text}`);
    if (!r.ok) console.log(`     → ${r.how}`);
    if (!r.ok && r.level === 'block') blocked++;
  }
  const warns = res.filter((r) => !r.ok && r.level === 'warn').length;
  console.log(`\n${blocked ? `${blocked} blocker${blocked > 1 ? 's' : ''}` : 'No blockers'}${warns ? `, ${warns} to set before release` : ''}.`);
  process.exit(blocked ? 1 : 0);
}
