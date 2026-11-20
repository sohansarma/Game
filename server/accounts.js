// Player accounts + cloud saves.
//
// • Username + password (scrypt, per-user salt). No email needed; a one-time
//   recovery code (shown at sign-up) resets a forgotten password.
// • Sessions are random tokens; only their SHA-256 is stored. 180-day expiry.
// • Wrong passwords lock the account for a growing delay (per account), on
//   top of the per-IP rate limit in api.js.
// • One cloud save per account with a revision number, so two devices can't
//   silently overwrite each other (the client merges on a 409).
// • An account owns one leaderboard player; each signed-in device gets its own
//   player token, so scores from every device land on the same name.

import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { nameProblem, cleanName, ANIMALS } from '../public/js/storage.js';

const scrypt = promisify(scryptCb);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const SESSION_DAYS = 180;
const MAX_SESSIONS = 20;
const MAX_DEVICE_TOKENS = 20;
export const MAX_SAVE_BYTES = 200 * 1024;

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export function usernameProblem(u) {
  if (typeof u !== 'string') return 'Pick a username';
  const n = u.trim().toLowerCase();
  if (!USERNAME_RE.test(n)) return 'Usernames are 3–20 letters, numbers, _ or .';
  if (/^[._]|[._]$|\.\./.test(n)) return "Usernames can't start or end with . or _";
  return nameProblem(n.replace(/[._]/g, ' ')) && nameProblem(n.replace(/[._]/g, ' ')) !== 'Include at least one letter' ? 'Please pick a different username' : null;
}
export function passwordProblem(p, username = '') {
  if (typeof p !== 'string' || p.length < 8) return 'Use at least 8 characters';
  if (p.length > 128) return 'That password is too long';
  if (username && p.toLowerCase().includes(username.toLowerCase())) return "Don't use your username in the password";
  if (/^(.)\1+$/.test(p) || ['password', '12345678', '123456789', 'qwertyui', 'iloveyou', 'tidepop1'].includes(p.toLowerCase())) return 'That password is too easy to guess';
  return null;
}

async function hashPassword(password, salt) {
  return (await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
}
const recoveryCode = () => randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g).join('-'); // XXXX-XXXX-XXXX-XXXX-XXXX

export function createAccounts({ store, now, fail, players, google = { enabled: false } }) {
  const { db } = store;
  db.accounts ||= {};
  db.sessions ||= {};
  db.googleIndex ||= {}; // Google account id (sub) → username. Only the id is kept: no e-mail, name or picture.
  const DUMMY_SALT = randomBytes(16).toString('hex');

  function newSession(username) {
    const token = randomBytes(32).toString('hex');
    const t = now().getTime();
    db.sessions[sha(token)] = { user: username, at: t, last: t };
    // keep at most MAX_SESSIONS per account
    const mine = Object.entries(db.sessions).filter(([, s]) => s.user === username).sort((a, b) => a[1].last - b[1].last);
    for (const [k] of mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS))) delete db.sessions[k];
    store.dirty();
    return token;
  }

  function session(body) {
    const tok = typeof body.session === 'string' ? body.session : '';
    const s = tok && db.sessions[sha(tok)];
    const t = now().getTime();
    if (!s || t - s.last > SESSION_DAYS * 86400000 || !db.accounts[s.user]) {
      if (s) delete db.sessions[sha(tok)];
      throw fail(401, 'Please log in again');
    }
    s.last = t;
    return { acc: db.accounts[s.user], key: sha(tok) };
  }

  /** A fresh player token for this device, on the account's leaderboard player. */
  function deviceToken(acc) {
    const p = players[acc.playerId];
    if (!p) return null;
    const token = randomBytes(24).toString('hex');
    p.tokenHashes = [...(p.tokenHashes || []), sha(token)].slice(-MAX_DEVICE_TOKENS);
    store.dirty();
    return token;
  }

  function view(acc) {
    return { username: acc.display, playerId: acc.playerId, name: players[acc.playerId]?.name || null, saveRev: acc.saveRev || 0, saveAt: acc.saveAt || null, google: !!acc.google, password: !!acc.hash };
  }

  /** Link this device's leaderboard player to a new account, or make a fresh one. */
  function linkPlayer(body, display) {
    let playerId = null, token = null;
    const p = typeof body.playerId === 'string' && players[body.playerId];
    const owned = p && typeof body.token === 'string' && (p.tokenHash === sha(body.token) || p.tokenHashes?.includes(sha(body.token)));
    if (owned && !Object.values(db.accounts).some((a) => a.playerId === body.playerId)) playerId = body.playerId;
    else {
      const name = typeof body.name === 'string' && !nameProblem(body.name) ? cleanName(body.name) : display;
      playerId = randomUUID();
      token = randomBytes(24).toString('hex');
      players[playerId] = { name, tokenHash: sha(token), created: now().getTime(), levels: {} };
    }
    return { playerId, token };
  }

  async function signup(body) {
    // the client only offers accounts after the age screen said 13+; the server won't create one otherwise
    if (body.age !== '13+') throw fail(403, 'Accounts are for players 13 and older');
    const display = typeof body.username === 'string' ? body.username.trim() : '';
    const u = display.toLowerCase();
    const up = usernameProblem(display);
    if (up) throw fail(400, up);
    const pp = passwordProblem(body.password, u);
    if (pp) throw fail(400, pp);
    if (db.accounts[u]) throw fail(409, 'That username is taken');
    const { playerId, token } = linkPlayer(body, display);
    const salt = randomBytes(16).toString('hex');
    const recovery = recoveryCode();
    db.accounts[u] = {
      display, salt, hash: await hashPassword(body.password, salt), playerId, created: now().getTime(),
      recSalt: salt, recHash: sha(salt + recovery), fails: 0, lockUntil: 0, save: null, saveRev: 0, saveAt: null,
    };
    store.dirty();
    return { session: newSession(u), recovery, token, ...view(db.accounts[u]) };
  }

  async function checkPassword(acc, password) {
    const t = now().getTime();
    if (acc && acc.lockUntil > t) throw fail(429, `Too many tries – wait ${Math.ceil((acc.lockUntil - t) / 1000)} s and try again`);
    const h = await hashPassword(typeof password === 'string' ? password : '', acc?.salt || DUMMY_SALT);
    const ok = !!acc && !!acc.hash && timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(acc.hash, 'hex')); // Google-only accounts have no password
    if (acc) {
      if (ok) { acc.fails = 0; acc.lockUntil = 0; }
      else {
        acc.fails = (acc.fails || 0) + 1;
        if (acc.fails >= 5) acc.lockUntil = t + Math.min(15 * 60000, 30000 * 2 ** (acc.fails - 5));
      }
      store.dirty();
    }
    return ok;
  }

  async function login(body) {
    const u = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const acc = db.accounts[u];
    if (!(await checkPassword(acc, body.password))) throw fail(401, 'Wrong username or password');
    return { session: newSession(u), token: deviceToken(acc), ...view(acc) };
  }

  async function recover(body) {
    const u = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const acc = db.accounts[u];
    const t = now().getTime();
    if (acc && acc.lockUntil > t) throw fail(429, `Too many tries – wait ${Math.ceil((acc.lockUntil - t) / 1000)} s and try again`);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().replace(/[^0-9A-F]/g, '').match(/.{1,4}/g)?.join('-') || '' : '';
    if (!acc || sha(acc.recSalt + code) !== acc.recHash) {
      if (acc) { acc.fails = (acc.fails || 0) + 1; if (acc.fails >= 5) acc.lockUntil = t + Math.min(15 * 60000, 30000 * 2 ** (acc.fails - 5)); store.dirty(); }
      throw fail(401, "That recovery code doesn't match");
    }
    const pp = passwordProblem(body.password, u);
    if (pp) throw fail(400, pp);
    acc.salt = randomBytes(16).toString('hex');
    acc.hash = await hashPassword(body.password, acc.salt);
    const recovery = recoveryCode();
    acc.recSalt = randomBytes(16).toString('hex');
    acc.recHash = sha(acc.recSalt + recovery);
    acc.fails = 0; acc.lockUntil = 0;
    for (const [k, s] of Object.entries(db.sessions)) if (s.user === u) delete db.sessions[k]; // sign out everywhere
    store.dirty();
    return { session: newSession(u), token: deviceToken(acc), recovery, ...view(acc) };
  }

  // ---- Sign in with Google (adults only). The account is keyed by Google's stable id; nothing else is stored.
  async function googleId(idToken) {
    if (!google.enabled) throw fail(503, 'Google sign-in is not available here');
    try { return (await google.verify(idToken)).sub; } catch { throw fail(401, "Google couldn't confirm that sign-in – please try again"); }
  }

  function friendlyUsername() {
    for (let i = 0; i < 50; i++) {
      const u = `${ANIMALS[randomInt(ANIMALS.length)].toLowerCase()}${randomInt(1000, 10000)}`;
      if (!db.accounts[u] && !usernameProblem(u)) return u;
    }
    return `tide${randomBytes(4).toString('hex')}`;
  }

  /** Sign in with Google: opens the linked account, or creates one (13+ only). No recovery code – Google is the recovery. */
  async function googleSignIn(body) {
    const sub = await googleId(body.idToken);
    const known = db.googleIndex[sub];
    if (known && db.accounts[known]) {
      const acc = db.accounts[known];
      return { session: newSession(known), token: deviceToken(acc), created: false, ...view(acc) };
    }
    if (body.age !== '13+') throw fail(403, 'Accounts are for players 13 and older');
    const u = friendlyUsername();
    const { playerId, token } = linkPlayer(body, u);
    db.accounts[u] = { display: u, salt: null, hash: null, google: sub, playerId, created: now().getTime(), recSalt: null, recHash: null, fails: 0, lockUntil: 0, save: null, saveRev: 0, saveAt: null };
    db.googleIndex[sub] = u;
    store.dirty();
    return { session: newSession(u), token, created: true, ...view(db.accounts[u]) };
  }

  /** Add Google as another way into the signed-in account. */
  async function googleLink(body) {
    const { acc } = session(body);
    const sub = await googleId(body.idToken);
    const owner = db.googleIndex[sub];
    if (owner && owner !== acc.display.toLowerCase() && db.accounts[owner]) throw fail(409, 'That Google account is already linked to another Tidepop account');
    if (acc.google && acc.google !== sub) throw fail(409, 'This account is already linked to a different Google account');
    acc.google = sub;
    db.googleIndex[sub] = acc.display.toLowerCase();
    store.dirty();
    return view(acc);
  }

  /** Remove Google from an account – only if a password remains, so nobody gets locked out. */
  function googleUnlink(body) {
    const { acc } = session(body);
    if (!acc.hash) throw fail(400, 'Set a password first – otherwise you could not get back in');
    if (acc.google) delete db.googleIndex[acc.google];
    delete acc.google;
    store.dirty();
    return view(acc);
  }

  async function handle(op, body) {
    switch (op) {
      case 'signup': return signup(body);
      case 'login': return login(body);
      case 'google': return googleSignIn(body);
      case 'google-link': return googleLink(body);
      case 'google-unlink': return googleUnlink(body);
      case 'recover': return recover(body);
      case 'me': return view(session(body).acc);
      case 'logout': {
        const tok = typeof body.session === 'string' ? body.session : '';
        delete db.sessions[sha(tok)];
        store.dirty();
        return { ok: true };
      }
      case 'save': {
        const { acc } = session(body);
        if (body.op === 'get') return { save: acc.save, rev: acc.saveRev || 0, at: acc.saveAt };
        if (body.op !== 'put') throw fail(400, 'bad op');
        const save = body.save;
        if (!save || typeof save !== 'object' || Array.isArray(save) || save.v !== 1) throw fail(400, 'not a Tidepop save');
        if (JSON.stringify(save).length > MAX_SAVE_BYTES) throw fail(413, 'save too large');
        if (Number(body.baseRev) !== (acc.saveRev || 0)) return { conflict: true, save: acc.save, rev: acc.saveRev || 0, at: acc.saveAt };
        acc.save = save;
        acc.saveRev = (acc.saveRev || 0) + 1;
        acc.saveAt = now().getTime();
        store.dirty();
        return { rev: acc.saveRev, at: acc.saveAt };
      }
      case 'password': {
        const { acc, key } = session(body);
        if (!acc.hash) throw fail(400, 'This account signs in with Google – there is no password to change');
        if (!(await checkPassword(acc, body.current))) throw fail(401, 'Your current password is wrong');
        const u = acc.display.toLowerCase();
        const pp = passwordProblem(body.password, u);
        if (pp) throw fail(400, pp);
        acc.salt = randomBytes(16).toString('hex');
        acc.hash = await hashPassword(body.password, acc.salt);
        for (const [k, s] of Object.entries(db.sessions)) if (s.user === u && k !== key) delete db.sessions[k]; // other devices sign in again
        store.dirty();
        return { ok: true };
      }
      case 'delete': {
        const { acc } = session(body);
        // password accounts confirm with the password; Google-only accounts with a fresh Google sign-in
        if (acc.hash) { if (!(await checkPassword(acc, body.password))) throw fail(401, 'Wrong password'); }
        else if ((await googleId(body.idToken)) !== acc.google) throw fail(401, 'That is a different Google account');
        const u = acc.display.toLowerCase();
        if (acc.google) delete db.googleIndex[acc.google];
        for (const [k, s] of Object.entries(db.sessions)) if (s.user === u) delete db.sessions[k];
        const playerId = acc.playerId;
        delete db.accounts[u];
        store.dirty();
        return { ok: true, playerId };
      }
      default:
        throw fail(404, 'not found');
    }
  }

  return { handle };
}
