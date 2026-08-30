import { createServerFn } from "@tanstack/react-start";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { GOOGLE_USERINFO_URL, GOOGLE_WEB_CLIENT_ID, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER } from "@/lib/device/constants";
import { getSql } from "@/lib/db";
import { appAuthMiddleware } from "./app-auth";

type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password_salt: string | null;
  password_hash: string | null;
  google_sub: string | null;
  x_sub: string | null;
};

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

function verifyPassword(password: string, saltB64: string, hashB64: string): boolean {
  const hash = scryptSync(password, Buffer.from(saltB64, "base64"), 32);
  const expected = Buffer.from(hashB64, "base64");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

async function findAccount(opts: { id?: string; email?: string; googleSub?: string; xSub?: string }) {
  const sql = await getSql();
  if (opts.id) {
    const rows = await sql<AccountRow>`select * from cloud_accounts where id = ${opts.id} limit 1`;
    if (rows[0]) return rows[0];
  }
  if (opts.googleSub) {
    const rows = await sql<AccountRow>`
      select * from cloud_accounts where google_sub = ${opts.googleSub} limit 1
    `;
    if (rows[0]) return rows[0];
  }
  if (opts.xSub) {
    const rows = await sql<AccountRow>`
      select * from cloud_accounts where x_sub = ${opts.xSub} limit 1
    `;
    if (rows[0]) return rows[0];
  }
  if (opts.email) {
    const rows = await sql<AccountRow>`select * from cloud_accounts where email = ${opts.email} limit 1`;
    if (rows[0]) return rows[0];
  }
  return undefined;
}

async function upsertGoogleAccount(profile: {
  sub: string;
  email: string;
  name: string | null;
  image: string | null;
}): Promise<AccountRow> {
  const sql = await getSql();
  const email = profile.email.trim().toLowerCase();
  const existing = (await findAccount({ googleSub: profile.sub })) ?? (await findAccount({ email }));
  const id = existing?.id ?? `g:${profile.sub}`;
  const name = profile.name?.trim() || existing?.name || email.split("@")[0];
  const image = profile.image || existing?.image || null;
  await sql`
    insert into cloud_accounts (id, email, name, image, google_sub)
    values (${id}, ${email}, ${name}, ${image}, ${profile.sub})
    on conflict (id) do update set
      email = excluded.email,
      name = coalesce(excluded.name, cloud_accounts.name),
      image = coalesce(excluded.image, cloud_accounts.image),
      google_sub = excluded.google_sub
  `;
  const row = await findAccount({ id });
  if (!row) throw new Error("Could not save account");
  return row;
}

export const completeGoogleSignIn = createServerFn({ method: "POST" })
  .validator((input: { accessToken: string }) => ({
    accessToken: input.accessToken.slice(0, 4096),
  }))
  .handler(async ({ data }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(data.accessToken)}`,
    );
    const tokenInfo = (await tokenInfoRes.json()) as { aud?: string; sub?: string; error?: string };
    if (!tokenInfoRes.ok || tokenInfo.aud !== GOOGLE_WEB_CLIENT_ID || !tokenInfo.sub) {
      throw new Error("Google sign-in could not be verified.");
    }
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    if (!userRes.ok) throw new Error("Google profile failed");
    const profile = (await userRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    const sub = profile.sub || tokenInfo.sub;
    if (!sub) throw new Error("Google profile missing id");
    const email = (profile.email ?? `${sub}@google.oauth`).trim().toLowerCase();
    const row = await upsertGoogleAccount({
      sub,
      email,
      name: profile.name ?? null,
      image: profile.picture ?? null,
    });
    const { writeCloudSession } = await import("./cloud-session.server");
    return writeCloudSession({
      userId: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
    });
  });

export const completeXSignIn = createServerFn({ method: "POST" })
  .validator((input: { code: string; verifier: string; redirectUri: string }) => ({
    code: input.code.slice(0, 2048),
    verifier: input.verifier.slice(0, 256),
    redirectUri: input.redirectUri.slice(0, 512),
  }))
  .handler(async ({ data }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: data.redirectUri,
      client_id: GROK_OAUTH_CLIENT_ID,
      code_verifier: data.verifier,
    });
    const secret = process.env.GROK_OAUTH_CLIENT_SECRET?.trim() || process.env.GROK_AUTH_CLIENT_SECRET?.trim();
    if (secret) body.set("client_secret", secret);
    const tokenRes = await fetch(`${GROK_OAUTH_ISSUER}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) throw new Error(tokenText.slice(0, 400) || `token ${tokenRes.status}`);
    let tokenJson: { access_token?: string; error?: string; error_description?: string };
    try {
      tokenJson = JSON.parse(tokenText) as typeof tokenJson;
    } catch {
      throw new Error("Invalid token response");
    }
    const access = tokenJson.access_token;
    if (!access) throw new Error(tokenJson.error_description || tokenJson.error || "No access token");
    const userRes = await fetch(`${GROK_OAUTH_ISSUER}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const userText = await userRes.text();
    if (!userRes.ok) throw new Error(userText.slice(0, 400) || `userinfo ${userRes.status}`);
    let profile: { sub?: string; id?: string; email?: string; name?: string; picture?: string; image?: string };
    try {
      profile = JSON.parse(userText) as typeof profile;
    } catch {
      throw new Error("Invalid userinfo response");
    }
    const sub = (profile.sub || profile.id || "").trim();
    if (!sub) throw new Error("X profile missing id");
    const sql = await getSql();
    const existing = await findAccount({ xSub: sub });
    const id = existing?.id ?? `x:${sub}`.slice(0, 180);
    const email = existing?.email || `${sub}@x.oauth`.toLowerCase();
    const name = profile.name || existing?.name || "X";
    const image = profile.picture || profile.image || existing?.image || null;
    await sql`
      insert into cloud_accounts (id, email, name, image, x_sub)
      values (${id}, ${email}, ${name}, ${image}, ${sub})
      on conflict (id) do update set
        name = coalesce(excluded.name, cloud_accounts.name),
        image = coalesce(excluded.image, cloud_accounts.image),
        x_sub = excluded.x_sub
    `;
    const row = await findAccount({ id });
    if (!row) throw new Error("Could not save X account");
    const { writeCloudSession } = await import("./cloud-session.server");
    return writeCloudSession({
      userId: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
    });
  });

export const signUpEmailCloud = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string; name: string }) => ({
    email: input.email.trim().toLowerCase().slice(0, 180),
    password: input.password.slice(0, 200),
    name: input.name.trim().slice(0, 80),
  }))
  .handler(async ({ data }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    if (!data.email || data.password.length < 8) {
      throw new Error("Email and a password of 8+ characters are required.");
    }
    const existing = await findAccount({ email: data.email });
    if (existing?.password_hash) throw new Error("An account with this email already exists.");
    const { salt, hash } = hashPassword(data.password);
    const id = existing?.id ?? `e:${randomBytes(12).toString("hex")}`;
    const name = data.name || data.email.split("@")[0];
    const sql = await getSql();
    await sql`
      insert into cloud_accounts (id, email, name, password_salt, password_hash)
      values (${id}, ${data.email}, ${name}, ${salt}, ${hash})
      on conflict (id) do update set
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        name = coalesce(cloud_accounts.name, excluded.name)
    `;
    const row = await findAccount({ id });
    if (!row) throw new Error("Could not create account");
    const { writeCloudSession } = await import("./cloud-session.server");
    return writeCloudSession({
      userId: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
    });
  });

export const signInEmailCloud = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => ({
    email: input.email.trim().toLowerCase().slice(0, 180),
    password: input.password.slice(0, 200),
  }))
  .handler(async ({ data }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const row = await findAccount({ email: data.email });
    if (!row?.password_hash || !row.password_salt) {
      throw new Error("Invalid email or password.");
    }
    if (!verifyPassword(data.password, row.password_salt, row.password_hash)) {
      throw new Error("Invalid email or password.");
    }
    const { writeCloudSession } = await import("./cloud-session.server");
    return writeCloudSession({
      userId: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
    });
  });

export const getCloudSession = createServerFn({ method: "GET" }).handler(async () => {
  const { readCloudSession, toAppUser } = await import("./cloud-session.server");
  const session = await readCloudSession();
  return session ? toAppUser(session) : null;
});

export const signOutCloud = createServerFn({ method: "POST" }).handler(async () => {
  const { clearCloudSession } = await import("./cloud-session.server");
  clearCloudSession();
  return { ok: true as const };
});

export const importDeviceSnapshot = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: {
    profile?: {
      locale?: "ko" | "en";
      ageBand?: "child" | "teen" | "college" | "adult";
      cefrLevel?: string | null;
      listeningScore?: number | null;
      speakingScore?: number | null;
      placementDone?: boolean;
    } | null;
    vocab?: {
      videoId?: string | null;
      word: string;
      meaningKo?: string | null;
      meaningEn?: string | null;
      ipa?: string | null;
      clipStart?: number | null;
      clipEnd?: number | null;
    }[];
    bookmarks?: {
      videoId: string;
      startSec: number;
      endSec: number;
      caption?: string | null;
      note?: string | null;
    }[];
    progress?: {
      videoId: string;
      positionSec: number;
      title?: string | null;
      thumbnail?: string | null;
    }[];
  }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const userId = context.userId;
    if (data.profile) {
      await sql`
        insert into profiles (
          user_id, locale, age_band, cefr_level, listening_score, speaking_score,
          placement_completed_at, updated_at
        )
        values (
          ${userId},
          ${data.profile.locale ?? "ko"},
          ${data.profile.ageBand === "child" || data.profile.ageBand === "teen" ? data.profile.ageBand : "adult"},
          ${data.profile.cefrLevel ?? null},
          ${data.profile.listeningScore ?? null},
          ${data.profile.speakingScore ?? null},
          ${data.profile.placementDone ? new Date().toISOString() : null},
          now()
        )
        on conflict (user_id) do update set
          locale = coalesce(excluded.locale, profiles.locale),
          age_band = coalesce(excluded.age_band, profiles.age_band),
          cefr_level = coalesce(profiles.cefr_level, excluded.cefr_level),
          listening_score = coalesce(profiles.listening_score, excluded.listening_score),
          speaking_score = coalesce(profiles.speaking_score, excluded.speaking_score),
          placement_completed_at = coalesce(profiles.placement_completed_at, excluded.placement_completed_at),
          updated_at = now()
      `;
    }
    for (const v of data.vocab ?? []) {
      await sql`
        insert into vocab_saves (user_id, video_id, word, meaning_ko, meaning_en, ipa, clip_start, clip_end)
        values (
          ${userId}, ${v.videoId ?? null}, ${v.word},
          ${v.meaningKo ?? null}, ${v.meaningEn ?? null}, ${v.ipa ?? null},
          ${v.clipStart ?? null}, ${v.clipEnd ?? null}
        )
      `;
    }
    for (const b of data.bookmarks ?? []) {
      await sql`
        insert into clip_bookmarks (user_id, video_id, start_sec, end_sec, caption, note)
        values (${userId}, ${b.videoId}, ${b.startSec}, ${b.endSec}, ${b.caption ?? null}, ${b.note ?? null})
      `;
    }
    for (const p of data.progress ?? []) {
      await sql`
        insert into watch_progress (user_id, video_id, position_sec, title, thumbnail, updated_at)
        values (${userId}, ${p.videoId}, ${p.positionSec}, ${p.title ?? null}, ${p.thumbnail ?? null}, now())
        on conflict (user_id, video_id) do update set
          position_sec = excluded.position_sec,
          title = coalesce(excluded.title, watch_progress.title),
          thumbnail = coalesce(excluded.thumbnail, watch_progress.thumbnail),
          updated_at = now()
      `;
    }
    return { ok: true as const };
  });
