// Analytics event store (SQLite on the same DATA_DIR volume as db.json).
//
// What is stored per event: a timestamp, an event name, a coarse bucket, the
// audience ('c' = child under 13, 'a' = everyone else), the platform and – for
// adults who left usage counts on – a random install id. NEVER an IP address,
// name, account, e-mail or advertising id. Children's events never carry an
// install id (the API drops it; see api.js), so they only add to tallies.
//
// Uses node:sqlite (Node 22+). If it isn't there the store is a no-op and the
// server keeps working with the simple daily tallies in db.json.

import path from 'node:path';
import { mkdirSync } from 'node:fs';

export const RETAIN_DAYS = 180;
const DAY = 86400000;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function createEvents(dir, { now = () => new Date() } = {}) {
  let DatabaseSync;
  try {
    DatabaseSync = process.getBuiltinModule?.('node:sqlite')?.DatabaseSync;
    if (!DatabaseSync) throw new Error('missing');
  } catch {
    console.warn('analytics: node:sqlite is unavailable (needs Node 22+) – detailed events are off, daily tallies still work');
    return noopEvents();
  }
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'analytics.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS events (
      id    INTEGER PRIMARY KEY,
      ts    INTEGER NOT NULL,
      day   TEXT NOT NULL,
      name  TEXT NOT NULL,
      bucket TEXT NOT NULL,
      n     INTEGER,
      aud   TEXT NOT NULL,
      plat  TEXT NOT NULL,
      iid   TEXT
    );
    CREATE INDEX IF NOT EXISTS events_day_name ON events (day, name);
    CREATE INDEX IF NOT EXISTS events_iid_day ON events (iid, day);
    CREATE TABLE IF NOT EXISTS installs (
      iid TEXT PRIMARY KEY,
      first_day TEXT NOT NULL,
      plat TEXT NOT NULL
    );
  `);
  const insEvent = db.prepare('INSERT INTO events (ts, day, name, bucket, n, aud, plat, iid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insInstall = db.prepare('INSERT OR IGNORE INTO installs (iid, first_day, plat) VALUES (?, ?, ?)');
  let lastPrune = 0;

  function add(list, { aud, plat, iid }) {
    const t = now().getTime();
    const day = dayOf(t);
    db.exec('BEGIN');
    try {
      if (iid) insInstall.run(iid, day, plat);
      for (const ev of list) insEvent.run(t, day, ev.e, ev.b, ev.n ?? null, aud, plat, iid || null);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already closed */ }
      throw e;
    }
    if (t - lastPrune > DAY) { lastPrune = t; prune(); }
  }

  function prune() {
    db.prepare('DELETE FROM events WHERE day < ?').run(dayOf(now().getTime() - RETAIN_DAYS * DAY));
  }

  /** Delete everything stored for one install id (the player's "delete my usage data"). */
  function forget(iid) {
    db.prepare('DELETE FROM events WHERE iid = ?').run(iid);
    db.prepare('DELETE FROM installs WHERE iid = ?').run(iid);
  }

  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const days = (n) => {
    const t = now().getTime();
    return Array.from({ length: n }, (_, i) => dayOf(t - (n - 1 - i) * DAY));
  };

  /** Everything the admin dashboard shows, for the last `n` days (UTC). */
  function report(n = 30) {
    n = Math.max(1, Math.min(RETAIN_DAYS, Math.floor(n) || 30));
    const dl = days(n);
    const from = dl[0];

    // daily counts of every event, for adults and children together (and split)
    const perDay = {};
    for (const r of all('SELECT day, name, aud, COUNT(*) c FROM events WHERE day >= ? GROUP BY day, name, aud', from)) {
      const d = (perDay[r.day] ||= {});
      const e = (d[r.name] ||= { a: 0, c: 0 });
      e[r.aud] = r.c;
    }

    // active installs per day (adults who left counts on) and brand-new installs
    const dau = Object.fromEntries(all('SELECT day, COUNT(DISTINCT iid) c FROM events WHERE day >= ? AND iid IS NOT NULL GROUP BY day', from).map((r) => [r.day, r.c]));
    const fresh = Object.fromEntries(all('SELECT first_day day, COUNT(*) c FROM installs WHERE first_day >= ? GROUP BY first_day', from).map((r) => [r.day, r.c]));

    // retention: of the installs first seen on day X, how many came back on X+1, X+7, X+30
    const active = new Set(all('SELECT DISTINCT iid || \'|\' || day k FROM events WHERE iid IS NOT NULL AND day >= ?', from).map((r) => r.k));
    const cohorts = all('SELECT iid, first_day FROM installs WHERE first_day >= ?', from);
    const today = dayOf(now().getTime());
    const retention = {};
    for (const { iid, first_day } of cohorts) {
      const c = (retention[first_day] ||= { size: 0, d1: 0, d7: 0, d30: 0 });
      c.size++;
      for (const k of [1, 7, 30]) {
        const target = dayOf(Date.parse(first_day) + k * DAY);
        if (target <= today && active.has(iid + '|' + target)) c['d' + k]++;
      }
    }

    // per-game plays, finishes and abandon rate
    const games = {};
    for (const r of all("SELECT name, bucket, aud, COUNT(*) c FROM events WHERE day >= ? AND name IN ('start','end','game') GROUP BY name, bucket, aud", from)) {
      const g = (games[r.bucket] ||= { start: 0, end: 0, game: 0 });
      g[r.name] += r.c;
    }
    for (const g of Object.values(games)) g.finishRate = g.start ? Math.min(1, g.end / g.start) : null;

    // funnel steps, errors, ads, consent, installs, platforms
    const byBucket = (name) => Object.fromEntries(all('SELECT bucket, COUNT(*) c FROM events WHERE day >= ? AND name = ? GROUP BY bucket ORDER BY c DESC', from, name).map((r) => [r.bucket, r.c]));
    const plat = Object.fromEntries(all('SELECT plat, aud, COUNT(DISTINCT COALESCE(iid, id)) c FROM events WHERE day >= ? AND name = \'open\' GROUP BY plat, aud', from).map((r) => [r.plat + ':' + r.aud, r.c]));

    return {
      from, to: today, days: dl, perDay, dau, newInstalls: fresh, retention,
      games, funnel: byBucket('funnel'), errors: byBucket('err'), ads: byBucket('ad'),
      consent: byBucket('consent'), links: byBucket('link'), perf: byBucket('perf'), opens: plat,
      totals: all('SELECT COUNT(*) events, COUNT(DISTINCT iid) installs FROM events WHERE day >= ?', from)[0],
    };
  }

  return { enabled: true, add, forget, report, prune, close: () => { try { db.close(); } catch { /* already closed */ } } };
}

export function noopEvents() {
  return { enabled: false, add() {}, forget() {}, report: () => null, prune() {}, close() {} };
}
