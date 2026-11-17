// Leaderboard API. Every score is re-computed on the server by replaying the
// player's action log through the shared game engine, so a modified client
// cannot simply post a high number.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { replay } from '../public/js/engine.js';
import { replayBlocks } from '../public/js/blocks.js';
import { getLevel, MAX_LEVEL } from '../public/js/levels.js';
import { BOARDS, acceptableKeys, dayKey, weekKey, dailyConfig, deepConfig, blocksSeed, ENGINE_VERSION } from '../public/js/modes.js';
import { ADJECTIVES, ANIMALS } from '../public/js/storage.js';

const MAX_BODY = 64 * 1024;
const LIMITS = { daily: 60, deep: 600, blocksDaily: 3000, blocks: 5000, stars: 400 };
const TOP_N = 50;
const KEEP_PER_BOARD = 1000;

const NAME_RE = new RegExp(`^(${ADJECTIVES.join('|')}) (${ANIMALS.join('|')}) ([1-9][0-9])$`);

export function validName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

function send(res, code, body, origin) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Per-IP token bucket kept only in memory (IPs are never written to disk).
function rateLimiter({ capacity = 40, refillPerSec = 0.5 } = {}) {
  const buckets = new Map();
  return (ip) => {
    const t = Date.now();
    let b = buckets.get(ip);
    if (!b) { b = { tokens: capacity, t }; buckets.set(ip, b); }
    b.tokens = Math.min(capacity, b.tokens + ((t - b.t) / 1000) * refillPerSec);
    b.t = t;
    if (buckets.size > 10000) buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  };
}

export function createApi(store, { now = () => new Date(), origin = process.env.ALLOWED_ORIGIN || '*' } = {}) {
  const { db } = store;
  const limit = rateLimiter();
  const fail = (status, error) => Object.assign(new Error(error), { status });

  function auth(body) {
    const p = typeof body.playerId === 'string' && db.players[body.playerId];
    if (!p || typeof body.token !== 'string' || p.tokenHash !== sha(body.token)) throw fail(401, 'unknown player');
    return p;
  }

  function boardId(board, key) {
    return `${board}:${key}`;
  }

  function prune() {
    // keep daily boards 30 days, weekly boards 12 weeks
    const t = now().getTime();
    const cutoffDay = dayKey(new Date(t - 30 * 86400000));
    const cutoffWeek = weekKey(new Date(t - 84 * 86400000));
    for (const id of Object.keys(db.boards)) {
      const [board, key] = id.split(':');
      const period = BOARDS[board]?.period;
      if ((period === 'day' && key < cutoffDay) || (period === 'week' && key < cutoffWeek)) delete db.boards[id];
    }
  }

  function ranking(id) {
    const entries = Object.entries(db.boards[id] || {});
    entries.sort((a, b) => b[1].score - a[1].score || a[1].at - b[1].at);
    return entries;
  }

  function record(id, playerId, score, { keepFirst = false } = {}) {
    const board = (db.boards[id] ||= {});
    const prev = board[playerId];
    let improved = false;
    if (!prev || (!keepFirst && score > prev.score)) {
      board[playerId] = { score, at: now().getTime() };
      improved = true;
    }
    // cap board size
    const keys = Object.keys(board);
    if (keys.length > KEEP_PER_BOARD * 1.2) {
      for (const [pid] of ranking(id).slice(KEEP_PER_BOARD)) delete board[pid];
    }
    store.dirty();
    const rank = ranking(id).findIndex(([pid]) => pid === playerId) + 1;
    return { score: board[playerId]?.score ?? score, best: board[playerId]?.score, rank, improved };
  }

  async function handleScore(body) {
    const p = auth(body);
    const { board } = body;
    if (!BOARDS[board]) throw fail(400, 'unknown board');
    if (body.v !== ENGINE_VERSION) throw fail(409, 'please update the game');
    const log = body.log;
    if (!Array.isArray(log) || log.length > LIMITS[board]) throw fail(400, 'bad log');

    if (board === 'stars') {
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw fail(400, 'bad level');
      const seed = Number(body.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw fail(400, 'bad seed');
      const r = replay(getLevel(level, seed), log, { maxBoosters: 8 });
      if (!r.ok) throw fail(422, 'replay failed: ' + r.reason);
      if (r.game.state !== 'won') throw fail(422, 'level not completed');
      const stars = r.game.stars();
      p.levels ||= {};
      p.levels[level] = Math.max(p.levels[level] || 0, stars);
      const total = Object.values(p.levels).reduce((a, b) => a + b, 0);
      const id = boardId('stars', 'all');
      const prev = db.boards[id]?.[body.playerId];
      if (!prev || total > prev.score) {
        (db.boards[id] ||= {})[body.playerId] = { score: total, at: now().getTime() };
      }
      store.dirty();
      const rank = ranking(id).findIndex(([pid]) => pid === body.playerId) + 1;
      return { ok: true, stars, score: total, rank };
    }

    const key = String(body.key || '');
    if (!acceptableKeys(board, now()).includes(key)) throw fail(422, 'this board is closed');

    let score;
    if (board === 'daily' || board === 'deep') {
      const cfg = board === 'daily' ? dailyConfig(key) : deepConfig(key);
      const r = replay(cfg, log, { maxBoosters: 0 });
      if (!r.ok) throw fail(422, 'replay failed: ' + r.reason);
      if (r.game.state === 'playing') throw fail(422, 'game not finished');
      score = r.game.score;
    } else {
      const seed = Number(body.seed);
      if (board === 'blocks' && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw fail(400, 'bad seed');
      const r = replayBlocks(blocksSeed(board, key, seed), log);
      if (!r.ok) throw fail(422, 'replay failed: ' + r.reason);
      if (r.game.state !== 'over') throw fail(422, 'game not finished');
      score = r.game.score;
    }
    if (typeof body.score === 'number' && body.score !== score) throw fail(422, 'score mismatch');
    // Daily Dive: only the first finished attempt of the day is ranked.
    const res = record(boardId(board, key), body.playerId, score, { keepFirst: board === 'daily' });
    return { ok: true, ...res, verified: score };
  }

  async function handle(req, res, url) {
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
    const ip = req.socket.remoteAddress || 'x';
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, v: ENGINE_VERSION }, origin);
      }
      if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
        const board = url.searchParams.get('board');
        if (!BOARDS[board]) throw fail(400, 'unknown board');
        const key = url.searchParams.get('key') || 'all';
        if (!/^[0-9A-Za-z-]{1,12}$/.test(key)) throw fail(400, 'bad key');
        const me = url.searchParams.get('playerId');
        const ranked = ranking(boardId(board, key));
        const entries = ranked.slice(0, TOP_N).map(([pid, e], i) => ({
          rank: i + 1, name: db.players[pid]?.name || 'Mystery Fish', score: e.score, me: pid === me,
        }));
        const myIdx = me ? ranked.findIndex(([pid]) => pid === me) : -1;
        return send(res, 200, {
          board, key, total: ranked.length, entries,
          me: myIdx >= 0 ? { rank: myIdx + 1, score: ranked[myIdx][1].score } : null,
        }, origin);
      }
      if (req.method !== 'POST') throw fail(404, 'not found');
      if (!limit(ip)) throw fail(429, 'slow down a little');
      const body = await readBody(req);

      switch (url.pathname) {
        case '/api/register': {
          if (!validName(body.name)) throw fail(400, 'pick a name from the list');
          let playerId = typeof body.playerId === 'string' && /^[\w-]{8,64}$/.test(body.playerId) ? body.playerId : randomUUID();
          if (db.players[playerId]) playerId = randomUUID(); // never hand out someone else's id
          const token = randomBytes(24).toString('hex');
          db.players[playerId] = { name: body.name, tokenHash: sha(token), created: now().getTime(), levels: {} };
          store.dirty();
          prune();
          return send(res, 200, { playerId, token }, origin);
        }
        case '/api/rename': {
          const p = auth(body);
          if (!validName(body.name)) throw fail(400, 'pick a name from the list');
          p.name = body.name;
          store.dirty();
          return send(res, 200, { ok: true }, origin);
        }
        case '/api/forget': {
          auth(body);
          delete db.players[body.playerId];
          for (const b of Object.values(db.boards)) delete b[body.playerId];
          store.dirty();
          return send(res, 200, { ok: true }, origin);
        }
        case '/api/scores':
          return send(res, 200, await handleScore(body), origin);
        default:
          throw fail(404, 'not found');
      }
    } catch (e) {
      return send(res, e.status || 500, { error: e.status ? e.message : 'server error' }, origin);
    }
  }

  return { handle };
}
