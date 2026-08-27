/**
 * Grok-broker OIDC helper. Production Google sign-in no longer uses this path:
 * the grok_* client has no Vercel redirect URIs (exact-match), which surfaces
 * as `{"message":"Invalid redirect URI"}` on auth.grok.me. Device-mode Google
 * uses GIS in `./google.ts` instead. Kept for leftover `/oauth/callback` links.
 */
import { GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER, OAUTH_CALLBACK_PATH, OAUTH_STORAGE_KEY } from "./constants";

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export type OAuthStart = {
  verifier: string;
  state: string;
  idp: "google" | "twitter";
  redirectUri: string;
};

export async function startGrokOAuth(idp: "google" | "twitter"): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
  const payload: OAuthStart = { verifier, state, idp, redirectUri };
  sessionStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify(payload));
  const url = new URL(`${GROK_OAUTH_ISSUER}/api/auth/oauth2/authorize`);
  url.searchParams.set("idp", idp);
  url.searchParams.set("client_id", GROK_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  window.location.href = url.toString();
}

export function readOAuthStart(): OAuthStart | null {
  try {
    const raw = sessionStorage.getItem(OAUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OAuthStart;
  } catch {
    return null;
  }
}

export function clearOAuthStart(): void {
  try {
    sessionStorage.removeItem(OAUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
