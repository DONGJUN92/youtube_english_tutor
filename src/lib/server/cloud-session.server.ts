import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import { jwtVerify, SignJWT } from "jose";
import type { AppUser } from "@/lib/auth/use-current-user";

export const CLOUD_SESSION_COOKIE = "tubeshadow_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

type Claims = {
  uid: string;
  email: string;
  name: string;
  img: string;
};

function secretKey(): Uint8Array {
  const raw = (
    process.env.BETTER_AUTH_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "tubeshadow-preview-session"
  ).padEnd(32, "0");
  return new TextEncoder().encode(raw);
}

export function toAppUser(claims: Claims): AppUser {
  return {
    id: claims.uid,
    displayName: claims.name || claims.email,
    primaryEmail: claims.email,
    profileImageUrl: claims.img || null,
    isDevFallback: false,
  };
}

export async function signCloudToken(input: {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
}): Promise<string> {
  return new SignJWT({
    uid: input.userId,
    email: input.email,
    name: input.name ?? "",
    img: input.image ?? "",
  } satisfies Claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secretKey());
}

export async function readCloudSession(): Promise<Claims | null> {
  const token = getCookie(CLOUD_SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const uid = typeof payload.uid === "string" ? payload.uid : "";
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!uid) return null;
    return {
      uid,
      email,
      name: typeof payload.name === "string" ? payload.name : "",
      img: typeof payload.img === "string" ? payload.img : "",
    };
  } catch {
    return null;
  }
}

export async function writeCloudSession(input: {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
}): Promise<AppUser> {
  const token = await signCloudToken(input);
  setCookie(CLOUD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getRequestProtocol() === "https",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return toAppUser({
    uid: input.userId,
    email: input.email,
    name: input.name ?? "",
    img: input.image ?? "",
  });
}

export function clearCloudSession(): void {
  deleteCookie(CLOUD_SESSION_COOKIE, { path: "/" });
}
