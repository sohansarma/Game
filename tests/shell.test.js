import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// The service worker precaches an explicit list so the game works offline.
// A module missing from that list would break offline play after an update.
const root = path.resolve(import.meta.dirname, '..', 'public');
const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
const shell = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('every JavaScript file the app loads is in the offline cache list', () => {
  const files = walk(path.join(root, 'js')).map((p) => path.relative(root, p).split(path.sep).join('/'));
  const missing = files.filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], 'add these to SHELL in public/sw.js (and bump VERSION)');
});

test('the cache list points at files that exist', () => {
  const bad = [...shell].filter((f) => /\.(js|css|html|png|svg|webmanifest)$/.test(f)).filter((f) => { try { statSync(path.join(root, f)); return false; } catch { return true; } });
  assert.deepEqual(bad, []);
});
