// Cloud save: keeps a player's progress in sync across phones, tablets and
// computers. Two backends:
//   • 'server' – a Tidepop account (username + password) on the game server
//   • 'claude' – inside the claude.ai artifact, the viewer's Claude account;
//                the save lives in a private per-person database document
// Sync = download, merge (best progress of both), upload. It runs on start,
// a few seconds after any change, and when the app goes to the background.

import { load, save, update, replaceSave, mergeSaves, cloudCopy, onSaveChange, LOCAL_ONLY } from './storage.js';
import { accountCall, claudeSaveDoc, inArtifact } from './api.js';
import { policy, ADULT_BAND } from './policy.js';

const listeners = new Set();
let timer = null;
let busy = null;
let status = { state: 'idle', error: null }; // idle | syncing | error

export function onCloudChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (merged = false) => { for (const fn of listeners) { try { fn(status, merged); } catch { /* ignore */ } } };

/** Who is signed in: { mode: 'server', username } | { mode: 'claude' } | null */
export function cloudAccount() {
  const c = load().cloud;
  if (c?.mode === 'server' && c.session) return { mode: 'server', username: c.username, syncedAt: c.syncedAt || null, google: !!c.google, password: c.password !== false };
  if (c?.mode === 'claude' && !c.off) return { mode: 'claude', syncedAt: c.syncedAt || null };
  return null;
}
export function cloudStatus() {
  return status;
}

function setCloud(patch) {
  const s = load();
  s.cloud = { ...(s.cloud || {}), ...patch };
  save(); // not update(): bookkeeping must not trigger another sync
}

/** Merge a downloaded save into this device, keeping device-only fields. */
function adopt(remote, firstMerge = false) {
  const local = load();
  const merged = remote ? mergeSaves(remote, cloudCopy(local), { firstMerge }) : cloudCopy(local);
  const keep = {};
  for (const k of LOCAL_ONLY) if (k in local) keep[k] = local[k];
  const changed = JSON.stringify(cloudCopy({ ...merged, ...keep })) !== JSON.stringify(cloudCopy(local));
  replaceSave({ ...merged, ...keep });
  return { merged, changed };
}

/** Download + merge + upload. Safe to call any time; calls are coalesced. */
export function syncNow() {
  if (busy) return busy;
  const acc = cloudAccount();
  if (!acc) return Promise.resolve(false);
  status = { state: 'syncing', error: null };
  emit();
  busy = (acc.mode === 'server' ? syncServer() : syncClaude())
    .then((changed) => {
      setCloud({ syncedAt: Date.now() });
      status = { state: 'idle', error: null };
      emit(changed);
      return true;
    })
    .catch((e) => {
      if (e.status === 401 && acc.mode === 'server') signOutLocal('Your session expired – log in again to keep syncing');
      status = { state: 'error', error: e.message || 'Could not reach the cloud' };
      emit();
      return false;
    })
    .finally(() => { busy = null; });
  return busy;
}

async function syncServer() {
  const session = load().cloud.session;
  const got = await accountCall('save', { session, op: 'get' });
  const first = !load().cloud.merged;
  let { changed } = adopt(got.save, first);
  if (first) setCloud({ merged: true });
  let base = got.rev;
  for (let attempt = 0; attempt < 3; attempt++) {
    const put = await accountCall('save', { session, op: 'put', save: cloudCopy(), baseRev: base });
    if (!put.conflict) { setCloud({ rev: put.rev }); return changed; }
    // another device saved in between: merge theirs and try again
    changed = adopt(put.save).changed || changed;
    base = put.rev;
  }
  throw new Error('Too many devices saving at once – try again');
}

async function syncClaude() {
  const ref = await claudeSaveDoc();
  if (!ref) throw new Error('Sign in to Claude to save your progress');
  const snap = await ref.get();
  let remote = null;
  if (snap.exists) {
    try { remote = JSON.parse(snap.data().json); } catch { remote = null; }
  }
  const first = !load().cloud.merged;
  const { changed } = adopt(remote, first);
  if (first) setCloud({ merged: true });
  await ref.set({ json: JSON.stringify(cloudCopy()), at: Date.now() });
  return changed;
}

/** Sync a few seconds after the player changes something. */
function schedule() {
  if (!cloudAccount()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 4000);
}

let started = false;
/** Call once at startup. Turns on Claude-account saving inside the artifact. */
export async function startCloud() {
  if (started) return;
  started = true;
  onSaveChange(schedule);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden && cloudAccount()) { clearTimeout(timer); syncNow(); } });
  }
  if (inArtifact() && !load().cloud?.off && load().cloud?.mode !== 'server') {
    const ref = await claudeSaveDoc();
    if (ref) setCloud({ mode: 'claude' });
  }
  if (cloudAccount()) await syncNow();
}

// ---------------------------------------------------------------- account actions (server)
function applyLogin(r) {
  update((d) => {
    d.cloud = { mode: 'server', username: r.username, session: r.session, rev: 0, syncedAt: null, google: !!r.google, password: r.password !== false };
    // this device now plays as the account's leaderboard player
    if (r.playerId) d.playerId = r.playerId;
    if (r.token) d.token = r.token;
    if (r.name) d.name = r.name;
  });
}

export async function signUp(username, password) {
  const s = load();
  if (!policy(s).accounts) throw Object.assign(new Error('Accounts are for players 13 and older'), { status: 403 });
  const r = await accountCall('signup', { username, password, age: ADULT_BAND, playerId: s.playerId, token: s.token, name: s.name });
  applyLogin(r);
  await syncNow();
  return r; // includes the one-time recovery code
}

/** Sign in with a Google ID token (adults only). Creates the account the first time. */
export async function googleSignIn(idToken) {
  const s = load();
  if (!policy(s).googleSignIn) throw Object.assign(new Error('Accounts are for players 13 and older'), { status: 403 });
  const r = await accountCall('google', { idToken, age: ADULT_BAND, playerId: s.playerId, token: s.token, name: s.name });
  applyLogin(r);
  await syncNow();
  return r; // r.created tells a brand-new account from a returning one
}

/** Add Google as another way into the signed-in account. */
export async function linkGoogle(idToken) {
  const r = await accountCall('google-link', { session: load().cloud.session, idToken });
  setCloud({ google: true });
  return r;
}

export async function unlinkGoogle() {
  const r = await accountCall('google-unlink', { session: load().cloud.session });
  setCloud({ google: false });
  return r;
}

export async function logIn(username, password) {
  const r = await accountCall('login', { username, password });
  applyLogin(r);
  await syncNow();
  return r;
}

export async function recoverAccount(username, code, password) {
  const r = await accountCall('recover', { username, code, password });
  applyLogin(r);
  await syncNow();
  return r;
}

export async function changePassword(current, password) {
  return accountCall('password', { session: load().cloud.session, current, password });
}

function signOutLocal(reason) {
  const s = load();
  s.cloud = inArtifact() ? { mode: 'claude', off: true } : null;
  save();
  status = { state: 'idle', error: reason || null };
  emit();
}

export async function logOut() {
  const c = load().cloud;
  await syncNow().catch(() => {});
  if (c?.session) accountCall('logout', { session: c.session }).catch(() => {});
  signOutLocal();
}

export async function deleteAccount(password, idToken) {
  const c = load().cloud;
  await accountCall('delete', { session: c.session, ...(idToken ? { idToken } : { password }) });
  signOutLocal();
}

/** Artifact: turn Claude-account saving on/off for this device. */
export async function setClaudeSync(on) {
  setCloud({ mode: 'claude', off: !on });
  if (on) await syncNow();
  emit();
}
