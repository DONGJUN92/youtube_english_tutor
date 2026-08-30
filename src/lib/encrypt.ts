import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

function secretKey() {
  const secret =
    process.env.APP_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    (process.env.VERCEL ? "" : "tubeshadow-preview-wrap-v1");
  if (!secret) {
    throw new Error("APP_SECRET is not configured");
  }
  return scryptSync(secret, "tubeshadow-openai-key", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function last4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 4) return "••••";
  return trimmed.slice(-4);
}
