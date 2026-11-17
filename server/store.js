// Tiny JSON-file datastore with atomic, debounced writes. Plenty for a
// hobby-scale leaderboard; swap for SQLite/Postgres if you outgrow it.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'db.json');
  let db = { players: {}, boards: {} };
  if (existsSync(file)) {
    try {
      db = JSON.parse(readFileSync(file, 'utf8'));
      db.players ||= {};
      db.boards ||= {};
    } catch (e) {
      console.error('db.json unreadable, starting fresh (old file kept as db.json.bad)', e.message);
      try { renameSync(file, file + '.bad'); } catch { /* ignore */ }
    }
  }
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(db));
      renameSync(tmp, file);
    } catch (e) {
      console.error('could not save leaderboard data:', e.message); // keep serving; retry on next change
    }
  };
  const dirty = () => {
    if (!timer) {
      timer = setTimeout(flush, 1000);
      timer.unref?.();
    }
  };
  return { db, dirty, flush };
}
