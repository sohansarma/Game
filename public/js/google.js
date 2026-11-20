// Sign in with Google (adults only – see policy.js).
//
// Web: Google's own "Sign in with Google" button (Google Identity Services).
// Its script is loaded only when an adult opens the account form, never at
// page load, and never for children.
// Android app: the native wrapper provides window.TidepopNative.googleIdToken()
// (Credential Manager) and we use that instead.
//
// Either way we only get an ID token; the server verifies it (server/google.js)
// and keeps nothing but Google's account id.

import { policy } from './policy.js';
import * as api from './api.js';

let gsi = null;

const native = () => (typeof window !== 'undefined' && typeof window.TidepopNative?.googleIdToken === 'function' ? window.TidepopNative : null);

/** Is "Continue with Google" something we can offer right now? */
export function googleSupported() {
  if (!policy().googleSignIn || api.inArtifact()) return false;
  return !!(native() || api.googleClientId());
}

export const usesNativeGoogle = () => !!native();

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  return (gsi ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.onload = () => resolve(window.google);
    el.onerror = () => { gsi = null; reject(new Error("Couldn't reach Google – check your connection")); };
    document.head.appendChild(el);
  }));
}

/** Android app: ask the system for a Google ID token. Resolves with the token or rejects (cancelled / failed). */
export async function nativeGoogleToken() {
  return native().googleIdToken(api.googleClientId());
}

/** Web: draw Google's button in `container`; `onToken(idToken)` runs when the person finishes. */
export async function renderGoogleButton(container, onToken, onError) {
  try {
    const g = await loadGsi();
    g.accounts.id.initialize({ client_id: api.googleClientId(), callback: (r) => onToken(r.credential), auto_select: false, use_fedcm_for_prompt: true });
    container.textContent = '';
    g.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 260 });
  } catch (e) {
    onError?.(e);
  }
}
