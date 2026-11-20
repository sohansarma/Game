// Renames the Android package (application id) everywhere it appears. Do this BEFORE the first upload to Play:
// the package name is permanent afterwards.
//   node scripts/set-package.mjs com.yourdomain.tidepop
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const next = process.argv[2];
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(next || '')) {
  console.error('Usage: node scripts/set-package.mjs com.yourdomain.tidepop   (lowercase, at least three parts, e.g. com.example.tidepop)');
  process.exit(1);
}
const cfgPath = path.join(app, 'capacitor.config.json');
const prev = JSON.parse(readFileSync(cfgPath, 'utf8')).appId;
if (prev === next) { console.log('Already ' + next); process.exit(0); }

const sub = (file) => {
  const p = path.join(app, file);
  if (!existsSync(p)) return;
  const s = readFileSync(p, 'utf8');
  writeFileSync(p, s.split(prev).join(next));
};
sub('capacitor.config.json');
sub('android/app/build.gradle');
sub('android/app/src/main/res/values/strings.xml');

// move MainActivity into the new package folder
const java = path.join(app, 'android/app/src/main/java');
const from = path.join(java, ...prev.split('.')), to = path.join(java, ...next.split('.'));
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const src = path.join(from, f), dst = path.join(to, f);
    writeFileSync(dst, readFileSync(src, 'utf8').split(prev).join(next));
    rmSync(src);
  }
  // remove now-empty old folders
  let dir = from;
  while (dir !== java && existsSync(dir) && readdirSync(dir).length === 0) { rmSync(dir, { recursive: true }); dir = path.dirname(dir); }
}
console.log(`Package renamed ${prev} → ${next}. Now run: npm run sync`);
