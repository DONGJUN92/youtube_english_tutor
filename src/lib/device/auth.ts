import type { AppUser } from "@/lib/auth/use-current-user";
import { SESSION_STORAGE_KEY } from "./constants";
import {
  getAllByIndex,
  getById,
  newId,
  putRow,
  type AccountRow,
} from "./db";

function b64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: Uint8Array.from(salt), iterations: 120_000, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toAppUser(row: AccountRow): AppUser {
  return {
    id: row.id,
    displayName: row.name || row.email,
    primaryEmail: row.email,
    profileImageUrl: row.image,
    isDevFallback: false,
  };
}

export function readStoredUser(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUser;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredUser(user: AppUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export async function signUpEmail(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  if (!email || input.password.length < 8) {
    throw new Error("Email and a password of 8+ characters are required.");
  }
  const existing = await getAllByIndex<AccountRow>("accounts", "email", email);
  if (existing.some((row) => row.passwordHash)) {
    throw new Error("An account with this email already exists.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(input.password, salt);
  const row: AccountRow = {
    id: existing[0]?.id ?? newId("usr"),
    email,
    name: input.name.trim() || email.split("@")[0],
    image: existing[0]?.image ?? null,
    passwordSalt: b64(salt),
    passwordHash: b64(hash),
    googleSub: existing[0]?.googleSub ?? null,
    xSub: existing[0]?.xSub ?? null,
    createdAt: existing[0]?.createdAt ?? new Date().toISOString(),
  };
  await putRow("accounts", row);
  const user = toAppUser(row);
  writeStoredUser(user);
  return user;
}

export async function signInEmail(input: { email: string; password: string }): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const matches = await getAllByIndex<AccountRow>("accounts", "email", email);
  const row = matches.find((r) => r.passwordHash && r.passwordSalt);
  if (!row?.passwordHash || !row.passwordSalt) {
    throw new Error("Invalid email or password.");
  }
  const hash = await pbkdf2(input.password, fromB64(row.passwordSalt));
  if (!timingSafeEqual(hash, fromB64(row.passwordHash))) {
    throw new Error("Invalid email or password.");
  }
  const user = toAppUser(row);
  writeStoredUser(user);
  return user;
}

export async function upsertOAuthAccount(input: {
  provider: "google" | "twitter";
  sub: string;
  email: string | null;
  name: string | null;
  image: string | null;
}): Promise<AppUser> {
  const sub = input.sub.trim();
  if (!sub) throw new Error("OAuth identity was missing.");
  const index = input.provider === "google" ? "googleSub" : "xSub";
  const bySub = (await getAllByIndex<AccountRow>("accounts", index, sub))[0];
  const email = (input.email ?? `${sub}@${input.provider}.oauth`).trim().toLowerCase();
  const byEmail = email ? (await getAllByIndex<AccountRow>("accounts", "email", email))[0] : undefined;
  const base = bySub ?? byEmail;
  const row: AccountRow = {
    id: base?.id ?? newId("usr"),
    email: base?.email || email,
    name: input.name?.trim() || base?.name || email.split("@")[0],
    image: input.image || base?.image || null,
    passwordSalt: base?.passwordSalt ?? null,
    passwordHash: base?.passwordHash ?? null,
    googleSub: input.provider === "google" ? sub : (base?.googleSub ?? null),
    xSub: input.provider === "twitter" ? sub : (base?.xSub ?? null),
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
  await putRow("accounts", row);
  const user = toAppUser(row);
  writeStoredUser(user);
  return user;
}

export async function loadAccount(userId: string): Promise<AccountRow | undefined> {
  return getById<AccountRow>("accounts", userId);
}

export function signOutDevice(): void {
  writeStoredUser(null);
}
