// Verifies a "Sign in with Google" ID token on the server (no dependencies).
//
//   GOOGLE_CLIENT_IDS=<web client id>[,<other client ids>]   (the token's "aud" must be one of them)
//
// We check the RS256 signature against Google's published keys, then the
// issuer, audience and expiry. Only the stable account id (`sub`) is used:
// the e-mail, name and picture in the token are ignored and never stored.

import { createPublicKey, createVerify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_S = 60;

const b64 = (s) => Buffer.from(s, 'base64url');
const json = (s) => JSON.parse(b64(s).toString('utf8'));

/** Google's signing keys, cached for as long as Google says, refetched at most once a minute on an unknown key id. */
export function googleKeys({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  let keys = new Map(), expires = 0, lastTry = 0;
  async function load() {
    lastTry = now();
    const res = await fetchImpl(CERTS_URL);
    if (!res.ok) throw new Error('could not load Google keys');
    const body = await res.json();
    keys = new Map((body.keys || []).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
    const maxAge = /max-age=(\d+)/.exec(res.headers?.get?.('cache-control') || '')?.[1];
    expires = now() + (maxAge ? Number(maxAge) : 3600) * 1000;
  }
  return async (kid) => {
    if (now() > expires) await load();
    else if (!keys.has(kid) && now() - lastTry > 60000) await load();
    return keys.get(kid) || null;
  };
}

/**
 * Returns { sub } for a valid token, or throws an Error with a short reason.
 * `getKey(kid)` resolves a KeyObject; `clientIds` is the list of accepted audiences.
 */
export async function verifyGoogleIdToken(idToken, { clientIds, getKey, now = () => Date.now() }) {
  if (!clientIds?.length) throw new Error('Google sign-in is not set up on this server');
  if (typeof idToken !== 'string' || idToken.length > 4096) throw new Error('bad token');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  let header, claims;
  try { header = json(parts[0]); claims = json(parts[1]); } catch { throw new Error('bad token'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('bad token');
  const key = await getKey(header.kid);
  if (!key) throw new Error('unknown signing key');
  const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(key, b64(parts[2]));
  if (!ok) throw new Error('bad signature');
  const t = Math.floor(now() / 1000);
  if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer');
  if (!clientIds.includes(claims.aud)) throw new Error('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < t) throw new Error('token expired');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > t) throw new Error('token from the future');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('bad token');
  return { sub: claims.sub };
}

/** The verifier the server uses: real Google keys and the client ids from the environment. */
export function createGoogleVerifier({ clientIds = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean), getKey = googleKeys(), now } = {}) {
  return {
    enabled: clientIds.length > 0,
    clientIds,
    verify: (idToken) => verifyGoogleIdToken(idToken, { clientIds, getKey, now }),
  };
}
