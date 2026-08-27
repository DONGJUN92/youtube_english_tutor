import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_CLIENT_JSON_PATH,
  GOOGLE_CLIENT_STORAGE_KEY,
  GOOGLE_WEB_CLIENT_ID,
  OAUTH_CALLBACK_PATH,
} from "./constants";
import { b64url, pkceS256, writeOAuthStart } from "./oauth";

const CLIENT_RE = /^\d{10,}-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

export function isGoogleClientId(value: string): boolean {
  return CLIENT_RE.test(value.trim());
}

export function readLocalGoogleClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(GOOGLE_CLIENT_STORAGE_KEY)?.trim() ?? "";
    return isGoogleClientId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLocalGoogleClientId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOOGLE_CLIENT_STORAGE_KEY, id.trim());
}

function bakedGoogleClientId(): string | null {
  const value = GOOGLE_WEB_CLIENT_ID.trim();
  return isGoogleClientId(value) ? value : null;
}

export async function resolveGoogleClientId(): Promise<string | null> {
  const baked = bakedGoogleClientId();
  if (baked) return baked;
  const local = readLocalGoogleClientId();
  if (local) return local;
  try {
    const res = await fetch(GOOGLE_CLIENT_JSON_PATH, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { clientId?: string };
    const id = json.clientId?.trim() ?? "";
    if (!isGoogleClientId(id)) return null;
    writeLocalGoogleClientId(id);
    return id;
  } catch {
    return null;
  }
}

export class GoogleClientMissingError extends Error {
  constructor() {
    super("NO_GOOGLE_CLIENT");
    this.name = "GoogleClientMissingError";
  }
}

/** Authorization-code + PKCE S256 against Google. Redirects the current tab. */
export async function startGooglePkce(): Promise<void> {
  const clientId = await resolveGoogleClientId();
  if (!clientId) throw new GoogleClientMissingError();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await pkceS256(verifier);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
  writeOAuthStart({
    verifier,
    state,
    idp: "google",
    redirectUri,
    issuer: "google",
    clientId,
  });
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("include_granted_scopes", "true");
  window.location.href = url.toString();
}
