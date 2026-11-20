// Copies the web app into www/ and points it at the real API and ad units.
//   TIDEPOP_API_URL=https://your-server.example   (required, no trailing slash)
//   ADMOB_REWARDED_ID=ca-app-pub-XXXX/YYYY         (your rewarded ad unit; omit to keep Google's test ad)
//   ADMOB_TESTING=false                             (only for the release build)
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.resolve(here, '..', 'www');
const api = (process.env.TIDEPOP_API_URL || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(api)) {
  console.error('Set TIDEPOP_API_URL to your server, e.g. TIDEPOP_API_URL=https://tidepop.onrender.com');
  process.exit(1);
}
const testing = process.env.ADMOB_TESTING !== 'false';
const rewarded = process.env.ADMOB_REWARDED_ID || 'ca-app-pub-3940256099942544/5224354917'; // Google's public test unit
if (!testing && !process.env.ADMOB_REWARDED_ID) {
  console.error('A release build (ADMOB_TESTING=false) needs your own ADMOB_REWARDED_ID.');
  process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(path.resolve(here, '..', '..', 'public'), www, { recursive: true });
writeFileSync(path.join(www, 'config.js'), `window.TIDEPOP_API = ${JSON.stringify(api)};
window.TIDEPOP_ADMOB = ${JSON.stringify({ testing, rewarded })};
`);
console.log(`www/ ready – API ${api}, ads ${testing ? 'TEST mode' : 'LIVE'}`);
