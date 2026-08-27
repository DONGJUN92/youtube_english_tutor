import type { AppUser } from "@/lib/auth/use-current-user";
import { upsertOAuthAccount } from "./auth";
import {
  GOOGLE_CLIENT_JSON_PATH,
  GOOGLE_CLIENT_STORAGE_KEY,
  GOOGLE_WEB_CLIENT_ID,
} from "./constants";

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

let gsiPromise: Promise<void> | null = null;

export function preloadGoogleGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-tubeshadow-gsi='1']");
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google script failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.tubeshadowGsi = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script failed to load"));
    document.head.appendChild(script);
  });
  return gsiPromise;
}

export class GoogleClientMissingError extends Error {
  constructor() {
    super("NO_GOOGLE_CLIENT");
    this.name = "GoogleClientMissingError";
  }
}

export async function signInWithGoogle(): Promise<AppUser> {
  const clientId = await resolveGoogleClientId();
  if (!clientId) throw new GoogleClientMissingError();
  await preloadGoogleGis();
  const accessToken = await requestAccessToken(clientId);
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new Error("Google profile failed");
  const profile = (await userRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!profile.sub) throw new Error("Google profile missing id");
  return upsertOAuthAccount({
    provider: "google",
    sub: profile.sub,
    email: profile.email ?? null,
    name: profile.name ?? null,
    image: profile.picture ?? null,
  });
}

function requestAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) {
      reject(new Error("Google script missing"));
      return;
    }
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      prompt: "select_account",
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Google cancelled"));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || err?.type || "Google popup closed"));
      },
    });
    client.requestAccessToken();
  });
}
