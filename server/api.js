// Leaderboard API. Every score is re-computed on the server by replaying the
// player's action log through the shared game engine, so a modified client
// cannot simply post a high number.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { replay } from '../public/js/engine.js';
import { replayBlocks } from '../public/js/blocks.js';
import { getLevel, MAX_LEVEL } from '../public/js/levels.js';
import { BOARDS, acceptableKeys, dayKey, weekKey, dailyConfig, deepConfig, blocksSeed, ENGINE_VERSION } from '../public/js/modes.js';
import { cleanName, nameProblem } from '../public/js/storage.js';
import { verifyArcade } from '../public/js/arcade/index.js';
import { sanitize as ugcSanitize, replay as ugcReplay } from '../public/js/maker/engine.js';

const MAX_BODY = 64 * 1024;
const LIMITS = { daily: 60, deep: 600, blocksDaily: 3000, blocks: 5000, stars: 400, ugc: 40000 };
const TOP_N = 50;
const KEEP_PER_BOARD = 1000;

/** Same rules as the game uses (public/js/storage.js), stored in cleaned form. */
export function validName(name) {
  return typeof name === 'string' && cleanName(name) === name && !nameProblem(name);
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

export function createApi(store, { now = () => new Date(), origin = process.env.ALLOWED_ORIGIN || '*', rate = {} } = {}) {
  const { db } = store;
  const limit = rateLimiter(rate);
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

  // ---- community games (Creator Studio)
  function ugcSummary(rec, me) {
    const spec = rec.specs[rec.version];
    const rs = Object.values(rec.ratings || {});
    const week = Date.now() - 7 * 86400000;
    return {
      id: rec.id, version: rec.version, title: spec.title, description: spec.description, template: spec.template, hero: spec.hero, palette: spec.palette,
      owner: db.players[rec.owner]?.name || 'Creator', mine: rec.owner === me, createdAt: rec.createdAt, updatedAt: rec.updatedAt, history: rec.history,
      rating: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, ratings: rs.length,
      plays: Object.values(rec.plays || {}).reduce((a, b) => a + b, 0), players: Object.keys(rec.plays || {}).length,
      recentPlays: Object.values(rec.playedAt || {}).filter((t) => t > week).length, reports: Object.keys(rec.reports || {}).length,
      myRating: rec.ratings?.[me] || 0, mePlayed: !!rec.plays?.[me],
    };
  }
  function handleUgc(body) {
    auth(body);
    db.creations ||= {};
    const id = body.id;
    if (typeof id !== 'string' || !/^[a-z0-9]{8}$/.test(id)) throw fail(400, 'bad id');
    const rec = db.creations[id];
    const t = now().getTime();
    switch (body.action) {
      case 'publish': {
        if (rec && rec.owner !== body.playerId) throw fail(403, "That's someone else's game");
        let spec;
        try { spec = ugcSanitize(body.spec); } catch (e) { throw fail(400, e.message); }
        if (!rec && Object.values(db.creations).filter((r) => r.owner === body.playerId).length >= 20) throw fail(400, 'You can publish up to 20 games');
        if (!rec && Object.keys(db.creations).length >= 5000) throw fail(503, 'Studio is full right now');
        const r = rec || { id, owner: body.playerId, version: 0, specs: {}, history: [], createdAt: t, ratings: {}, plays: {}, playedAt: {}, reports: {} };
        r.version++;
        r.specs[r.version] = spec;
        for (const v of Object.keys(r.specs)) if (Number(v) <= r.version - 10) delete r.specs[v];
        r.history = [...r.history, { v: r.version, at: t, note: String(body.note || '').slice(0, 120) || (r.version === 1 ? 'First release' : 'Updated') }].slice(-20);
        r.updatedAt = t;
        db.creations[id] = r;
        store.dirty();
        return { ok: true, version: r.version };
      }
      case 'delete': {
        if (!rec) return { ok: true };
        if (rec.owner !== body.playerId) throw fail(403, "That's someone else's game");
        delete db.creations[id];
        for (const bid of Object.keys(db.boards)) if (bid.startsWith(`ugc:${id}-`)) delete db.boards[bid];
        store.dirty();
        return { ok: true };
      }
      case 'rate':
      case 'play':
      case 'report': {
        if (!rec) throw fail(404, 'That game was removed');
        if (body.action === 'rate') {
          const s = Math.round(Number(body.stars));
          if (!(s >= 1 && s <= 5)) throw fail(400, 'stars must be 1-5');
          (rec.ratings ||= {})[body.playerId] = s;
        } else if (body.action === 'play') {
          (rec.plays ||= {})[body.playerId] = Math.min(99999, (rec.plays[body.playerId] || 0) + 1);
          (rec.playedAt ||= {})[body.playerId] = t;
        } else (rec.reports ||= {})[body.playerId] = true;
        store.dirty();
        return { ok: true };
      }
      default:
        throw fail(400, 'unknown action');
    }
  }

  // ---- online matches (chess / ludo): each player only writes their own moves
  const MATCH_CODE = /^[A-HJ-NP-Z2-9]{5}$/;
  const MATCH_GAMES = { chess: 400, ludo: 6000 };
  function matchView(m, playerId) {
    return {
      code: m.code, game: m.game, seed: m.seed, opts: m.opts,
      hostName: db.players[m.host.pid]?.name || 'Host', guestName: m.guest ? db.players[m.guest.pid]?.name || 'Guest' : null,
      hostMoves: m.host.moves, guestMoves: m.guest?.moves || [], joined: !!m.guest,
      resigned: m.resigned || null, me: playerId === m.host.pid ? 'host' : m.guest && playerId === m.guest.pid ? 'guest' : null,
    };
  }
  function handleMatch(body) {
    const p = auth(body);
    void p;
    db.matches ||= {};
    const now = Date.now();
    for (const [k, m] of Object.entries(db.matches)) if (now - m.at > 7 * 86400000) delete db.matches[k];
    const code = body.code;
    if (!MATCH_CODE.test(code || '')) throw fail(400, 'bad code');
    const m = db.matches[code];
    switch (body.action) {
      case 'create': {
        if (m) throw fail(409, 'code already used');
        if (!MATCH_GAMES[body.game]) throw fail(400, 'unknown game');
        const seed = Number(body.seed);
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw fail(400, 'bad seed');
        const hc = Number(body.opts?.hostColour);
        const opts = body.game === 'chess' ? { hostSide: body.opts?.hostSide === 'b' ? 'b' : 'w' } : { bots: !!body.opts?.bots, hostColour: Number.isInteger(hc) && hc >= 0 && hc < 4 ? hc : 0 };
        if (Object.keys(db.matches).length > 5000) throw fail(503, 'too many open matches');
        db.matches[code] = { code, game: body.game, seed, opts, host: { pid: body.playerId, moves: [] }, guest: null, at: now };
        store.dirty();
        return { ok: true };
      }
      case 'join': {
        if (!m) throw fail(404, 'No match with that code');
        if (m.host.pid === body.playerId) throw fail(400, "That's your own match – share the code with a friend");
        if (m.guest && m.guest.pid !== body.playerId) throw fail(409, 'That match already has two players');
        if (!m.guest) { m.guest = { pid: body.playerId, moves: [] }; m.at = now; store.dirty(); }
        return matchView(m, body.playerId);
      }
      case 'move': {
        if (!m) throw fail(404, 'No match with that code');
        const side = m.host.pid === body.playerId ? m.host : m.guest?.pid === body.playerId ? m.guest : null;
        if (!side) throw fail(403, 'not in this match');
        const mv = body.moves;
        const okMove = m.game === 'chess' ? (x) => typeof x === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) : (x) => x === 'r' || (Number.isInteger(x) && x >= 0 && x < 4);
        if (!Array.isArray(mv) || mv.length > MATCH_GAMES[m.game] || !mv.every(okMove)) throw fail(400, 'bad moves');
        // moves are append-only: the new list must extend the stored one
        if (mv.length < side.moves.length || side.moves.some((x, i) => x !== mv[i])) throw fail(409, 'moves out of sync');
        side.moves = mv;
        m.at = now;
        store.dirty();
        return { ok: true };
      }
      case 'resign': {
        if (!m) throw fail(404, 'No match with that code');
        const role = m.host.pid === body.playerId ? 'host' : m.guest?.pid === body.playerId ? 'guest' : null;
        if (!role) throw fail(403, 'not in this match');
        m.resigned ||= role;
        store.dirty();
        return { ok: true };
      }
      default:
        throw fail(400, 'unknown action');
    }
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
    if (board === 'ugc') {
      const [id, v] = key.split('-');
      const rec = db.creations?.[id];
      const spec = rec?.specs?.[Number(v)];
      if (!spec) throw fail(404, 'unknown game version');
      const seed = Number(body.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw fail(400, 'bad seed');
      const r = ugcReplay(spec, seed, log);
      if (!r.ok) throw fail(422, 'replay failed: ' + r.reason);
      if (typeof body.score === 'number' && body.score !== r.sim.score) throw fail(422, 'score mismatch');
      return { ok: true, ...record(boardId('ugc', key), body.playerId, r.sim.score), verified: r.sim.score };
    }
    if (!acceptableKeys(board, now()).includes(key)) throw fail(422, 'this board is closed');

    let score;
    if (BOARDS[board].arcade) {
      const v = verifyArcade(board, key, Number(body.seed), log);
      if (!v.ok) throw fail(422, 'replay failed: ' + v.reason);
      score = v.score;
    } else if (board === 'daily' || board === 'deep') {
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
    // endless arcade runs also count towards this week's tournament
    if (BOARDS[board].arcade && !BOARDS[board].daily) {
      const wk = record(boardId(board + 'Week', weekKey(now())), body.playerId, score);
      res.weekRank = wk.rank;
    }
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
      if (req.method === 'GET' && url.pathname === '/api/ugc') {
        const me = url.searchParams.get('playerId');
        const id = url.searchParams.get('id');
        if (id) {
          const rec = db.creations?.[id];
          if (!rec) throw fail(404, 'That game was removed');
          return send(res, 200, { ...ugcSummary(rec, me), specs: rec.specs, spec: rec.specs[rec.version] }, origin);
        }
        const games = Object.values(db.creations || {}).map((r) => ugcSummary(r, me)).filter((g) => g.reports < 3 || g.mine);
        return send(res, 200, { games }, origin);
      }
      if (req.method === 'GET' && url.pathname === '/api/match') {
        const code = url.searchParams.get('code');
        const m = typeof code === 'string' && db.matches?.[code];
        if (!m) throw fail(404, 'No match with that code');
        return send(res, 200, matchView(m, url.searchParams.get('playerId')), origin);
      }
      if (req.method !== 'POST') throw fail(404, 'not found');
      if (!limit(ip)) throw fail(429, 'slow down a little');
      const body = await readBody(req);

      switch (url.pathname) {
        case '/api/register': {
          if (!validName(body.name)) throw fail(400, nameProblem(body.name) || 'invalid name');
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
          if (!validName(body.name)) throw fail(400, nameProblem(body.name) || 'invalid name');
          p.name = body.name;
          store.dirty();
          return send(res, 200, { ok: true }, origin);
        }
        case '/api/forget': {
          auth(body);
          delete db.players[body.playerId];
          for (const b of Object.values(db.boards)) delete b[body.playerId];
          for (const [cid, r] of Object.entries(db.creations || {})) {
            if (r.owner === body.playerId) delete db.creations[cid];
            else for (const k of ['ratings', 'plays', 'playedAt', 'reports']) if (r[k]) delete r[k][body.playerId];
          }
          store.dirty();
          return send(res, 200, { ok: true }, origin);
        }
        case '/api/match':
          return send(res, 200, handleMatch(body), origin);
        case '/api/ugc':
          return send(res, 200, handleUgc(body), origin);
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
