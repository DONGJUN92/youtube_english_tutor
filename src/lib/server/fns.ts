import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { decryptSecret, encryptSecret, last4 } from "@/lib/encrypt";
import { AgeBandSchema, CefrSchema, LocaleSchema, type GeneratedLesson } from "@/lib/schema";
import { PLACEMENT_BANK_VERSION } from "@/data/placement-version";
import { fetchCaptions, fetchVideoMeta } from "./youtube-data";
import { assertAllowedModel, generateLessonWithOpenAI, pingOpenAI, evaluateSpeakingWithOpenAI } from "./openai-lesson";

const ProfileRow = z.object({
  user_id: z.string(),
  locale: z.string(),
  age_band: z.string(),
  display_name: z.string().nullable(),
  cefr_level: z.string().nullable(),
  listening_score: z.number().nullable(),
  speaking_score: z.number().nullable(),
  placement_completed_at: z.string().nullable(),
  openai_model: z.string(),
  openai_key_enc: z.string().nullable(),
  placement_path: z.unknown().nullable().optional(),
});

export type PublicProfile = {
  locale: "ko" | "en";
  ageBand: "child" | "teen" | "college" | "adult";
  cefrLevel: string | null;
  listeningScore: number | null;
  speakingScore: number | null;
  placementDone: boolean;
  openaiModel: string;
  hasOpenAiKey: boolean;
  openAiKeyLast4: string | null;
  placementBankVersion: number | null;
};

function toPublic(row: z.infer<typeof ProfileRow> | undefined): PublicProfile | null {
  if (!row) return null;
  return {
    locale: row.locale === "en" ? "en" : "ko",
    ageBand: (["child", "teen", "college", "adult"].includes(row.age_band)
      ? row.age_band
      : "adult") as PublicProfile["ageBand"],
    cefrLevel: row.cefr_level,
    listeningScore: row.listening_score,
    speakingScore: row.speaking_score,
    placementDone: Boolean(row.placement_completed_at),
    openaiModel: row.openai_model,
    hasOpenAiKey: Boolean(row.openai_key_enc),
    openAiKeyLast4: row.openai_key_enc ? "saved" : null,
    placementBankVersion: parseBankVersion(row.placement_path),
  };
}

function parseBankVersion(path: unknown): number | null {
  if (path && typeof path === "object" && !Array.isArray(path) && "v" in path) {
    const v = Number((path as { v: unknown }).v);
    return Number.isFinite(v) ? v : null;
  }
  if (Array.isArray(path)) return 1;
  return null;
}

async function loadProfile(userId: string) {
  const sql = await getSql();
  const rows = await sql<z.infer<typeof ProfileRow>>`
    select user_id, locale, age_band, display_name, cefr_level, listening_score,
           speaking_score, placement_completed_at::text, openai_model, openai_key_enc,
           placement_path
    from profiles where user_id = ${userId}
  `;
  return rows[0];
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const row = await loadProfile(context.userId);
    return toPublic(row);
  });

export const upsertOnboarding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { locale: "ko" | "en"; ageBand: "child" | "teen" | "college" | "adult" }) => ({
    locale: LocaleSchema.parse(input.locale),
    ageBand: AgeBandSchema.parse(input.ageBand),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into profiles (user_id, locale, age_band, updated_at)
      values (${context.userId}, ${data.locale}, ${data.ageBand}, now())
      on conflict (user_id) do update set
        locale = excluded.locale,
        age_band = excluded.age_band,
        updated_at = now()
    `;
    return toPublic(await loadProfile(context.userId));
  });

export const savePlacementResult = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    cefr: "A1" | "A2" | "B1" | "B2" | "C1";
    listening: number;
    speaking: number;
    path: unknown;
  }) => ({
    cefr: CefrSchema.parse(input.cefr),
    listening: Math.round(input.listening),
    speaking: Math.round(input.speaking),
    path: input.path,
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await loadProfile(context.userId);
    if (existing?.placement_completed_at) {
      return toPublic(existing);
    }
    await sql`
      insert into profiles (
        user_id, cefr_level, listening_score, speaking_score,
        placement_completed_at, placement_path, updated_at
      ) values (
        ${context.userId}, ${data.cefr}, ${data.listening}, ${data.speaking},
        now(), ${JSON.stringify({ v: PLACEMENT_BANK_VERSION, steps: data.path })}::jsonb, now()
      )
      on conflict (user_id) do update set
        cefr_level = excluded.cefr_level,
        listening_score = excluded.listening_score,
        speaking_score = excluded.speaking_score,
        placement_completed_at = now(),
        placement_path = excluded.placement_path,
        updated_at = now()
      where profiles.placement_completed_at is null
    `;
    return toPublic(await loadProfile(context.userId));
  });

export const resetPlacement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`
      update profiles
      set placement_completed_at = null,
          placement_path = null,
          updated_at = now()
      where user_id = ${context.userId}
    `;
    return toPublic(await loadProfile(context.userId));
  });

export const saveOpenAiSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { apiKey?: string; model: string }) => ({
    apiKey: input.apiKey?.trim() ?? "",
    model: input.model.trim() || "gpt-4.1-mini",
  }))
  .handler(async ({ context, data }) => {
    assertAllowedModel(data.model);
    const sql = await getSql();
    const current = await loadProfile(context.userId);
    const enc = data.apiKey.startsWith("sk-") ? encryptSecret(data.apiKey) : current?.openai_key_enc ?? null;
    await sql`
      insert into profiles (user_id, openai_model, openai_key_enc, updated_at)
      values (${context.userId}, ${data.model}, ${enc}, now())
      on conflict (user_id) do update set
        openai_model = excluded.openai_model,
        openai_key_enc = coalesce(excluded.openai_key_enc, profiles.openai_key_enc),
        updated_at = now()
    `;
    const row = await loadProfile(context.userId);
    const pub = toPublic(row);
    return {
      ...pub,
      openAiKeyLast4: data.apiKey.startsWith("sk-") ? last4(data.apiKey) : row?.openai_key_enc ? "saved" : null,
    } as PublicProfile & { openAiKeyLast4: string | null };
  });

export const pingOpenAiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const row = await loadProfile(context.userId);
    if (!row?.openai_key_enc) {
      return { ok: false as const, status: 0, model: "", message: "missing_key" };
    }
    const apiKey = decryptSecret(row.openai_key_enc);
    const model = row.openai_model || "gpt-4.1-mini";
    const result = await pingOpenAI(apiKey, model);
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        "/tmp/openai-ping.json",
        JSON.stringify({ ts: Date.now(), ok: result.ok, status: result.status, model: result.model, message: result.message }),
      );
    } catch {
      /* ignore */
    }
    return result;
  });

export const evaluateSpeakingTurn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { passage: string; partnerLine: string; said: string; ageBand: string }) => ({
    passage: input.passage.slice(0, 800),
    partnerLine: input.partnerLine.slice(0, 400),
    said: input.said.slice(0, 800),
    ageBand: input.ageBand,
  }))
  .handler(async ({ context, data }) => {
    const row = await loadProfile(context.userId);
    if (!row?.openai_key_enc) {
      return { ok: false as const, error: "missing_key" as const, fallback: heuristicSpeak(data.said) };
    }
    try {
      const evald = await evaluateSpeakingWithOpenAI({
        apiKey: decryptSecret(row.openai_key_enc),
        model: row.openai_model || "gpt-4.1-mini",
        passage: data.passage,
        partnerLine: data.partnerLine,
        said: data.said,
        ageBand: data.ageBand,
      });
      return { ok: true as const, eval: evald };
    } catch (err) {
      return {
        ok: false as const,
        error: "openai_failed" as const,
        message: err instanceof Error ? err.message : "OpenAI failed",
        fallback: heuristicSpeak(data.said),
      };
    }
  });

function heuristicSpeak(said: string) {
  const words = said.trim().split(/\s+/).filter(Boolean);
  const english = words.filter((w) => /[a-z]/i.test(w)).length;
  const score = Math.max(20, Math.min(72, english * 9 + Math.min(20, words.length)));
  return {
    score,
    appropriate: english >= 3,
    commentKo: english >= 3 ? "영어 단어가 보여서 의도는 전달됩니다. AI 키가 있으면 더 자세히 봐 줍니다." : "영어 한두 문장으로 다시 말해 보세요.",
    commentEn: english >= 3 ? "The idea comes through. A saved API key gives a fuller note." : "Try one or two English sentences.",
    betterLine: "Sure — I can do that.",
  };
}

export const resolveVideo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { videoId: string }) => ({
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
  }))
  .handler(async ({ data }) => {
    const meta = await fetchVideoMeta(data.videoId);
    const captions = await fetchCaptions(data.videoId);
    const { FEATURED_LESSONS } = await import("@/data/featured-lessons");
    return {
      ...meta,
      captionCount: captions.length,
      hasCaptions: captions.length > 0,
      hasSeededLesson: Boolean(FEATURED_LESSONS[data.videoId]),
    };
  });

export const loadOrGenerateLesson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { videoId: string }) => ({
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { FEATURED_LESSONS } = await import("@/data/featured-lessons");
    const seeded = FEATURED_LESSONS[data.videoId];
    if (seeded) {
      return { ok: true as const, source: "seed" as const, lesson: seeded };
    }
    const cached = await sql<{ payload: GeneratedLesson }>`
      select payload from lessons
      where user_id = ${context.userId} and video_id = ${data.videoId}
      order by created_at desc
      limit 1
    `;
    if (cached[0]?.payload) {
      return { ok: true as const, source: "cache" as const, lesson: cached[0].payload };
    }
    const profile = await loadProfile(context.userId);
    const keyEnc = profile?.openai_key_enc;
    if (!keyEnc) {
      return { ok: false as const, error: "missing_key" as const };
    }
    const apiKey = decryptSecret(keyEnc);
    const model = profile.openai_model || "gpt-4.1-mini";
    const meta = await fetchVideoMeta(data.videoId);
    const captions = await fetchCaptions(data.videoId);
    if (captions.length === 0) {
      return { ok: false as const, error: "no_captions" as const, title: meta.title };
    }
    try {
      const lesson = await generateLessonWithOpenAI({
        apiKey,
        model,
        videoId: data.videoId,
        title: meta.title,
        captions,
        level: (profile.cefr_level as "A1" | "A2" | "B1" | "B2" | "C1") || "A2",
        ageBand: profile.age_band || "adult",
      });
      await sql`
        insert into lessons (id, user_id, video_id, skill, payload)
        values (${`${context.userId}:${data.videoId}:${Date.now()}`}, ${context.userId}, ${data.videoId}, 'bundle', ${JSON.stringify(lesson)}::jsonb)
      `;
      return { ok: true as const, source: "openai" as const, lesson };
    } catch (err) {
      return {
        ok: false as const,
        error: "openai_failed" as const,
        message: err instanceof Error ? err.message : "OpenAI failed",
      };
    }
  });

export const saveVocab = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    videoId?: string;
    word: string;
    meaningKo?: string;
    meaningEn?: string;
    ipa?: string;
    clipStart?: number;
    clipEnd?: number;
  }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into vocab_saves (user_id, video_id, word, meaning_ko, meaning_en, ipa, clip_start, clip_end)
      values (
        ${context.userId}, ${data.videoId ?? null}, ${data.word},
        ${data.meaningKo ?? null}, ${data.meaningEn ?? null}, ${data.ipa ?? null},
        ${data.clipStart ?? null}, ${data.clipEnd ?? null}
      )
    `;
    return { ok: true as const };
  });

export const listVocab = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: number;
      video_id: string | null;
      word: string;
      meaning_ko: string | null;
      meaning_en: string | null;
      ipa: string | null;
      clip_start: number | null;
      clip_end: number | null;
      created_at: string;
    }>`
      select id, video_id, word, meaning_ko, meaning_en, ipa, clip_start, clip_end, created_at::text
      from vocab_saves where user_id = ${context.userId}
      order by created_at desc
    `;
  });

export const saveClipBookmark = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { videoId: string; startSec: number; endSec: number; caption?: string; note?: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into clip_bookmarks (user_id, video_id, start_sec, end_sec, caption, note)
      values (${context.userId}, ${data.videoId}, ${data.startSec}, ${data.endSec}, ${data.caption ?? null}, ${data.note ?? null})
    `;
    return { ok: true as const };
  });

export const listClipBookmarks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: number;
      video_id: string;
      start_sec: number;
      end_sec: number;
      caption: string | null;
      note: string | null;
      created_at: string;
    }>`
      select id, video_id, start_sec, end_sec, caption, note, created_at::text
      from clip_bookmarks where user_id = ${context.userId}
      order by created_at desc
    `;
  });

export const saveProgress = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { videoId: string; positionSec: number; title?: string; thumbnail?: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into watch_progress (user_id, video_id, position_sec, title, thumbnail, updated_at)
      values (${context.userId}, ${data.videoId}, ${data.positionSec}, ${data.title ?? null}, ${data.thumbnail ?? null}, now())
      on conflict (user_id, video_id) do update set
        position_sec = excluded.position_sec,
        title = coalesce(excluded.title, watch_progress.title),
        thumbnail = coalesce(excluded.thumbnail, watch_progress.thumbnail),
        updated_at = now()
    `;
    return { ok: true as const };
  });

export const listProgress = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      video_id: string;
      position_sec: number;
      title: string | null;
      thumbnail: string | null;
      updated_at: string;
    }>`
      select video_id, position_sec, title, thumbnail, updated_at::text
      from watch_progress where user_id = ${context.userId}
      order by updated_at desc
    `;
  });

export const saveSpeakingAttempt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { lessonId?: string; videoId?: string; target: string; transcript: string; accuracy: number }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into speaking_attempts (user_id, lesson_id, video_id, target, transcript, accuracy)
      values (${context.userId}, ${data.lessonId ?? null}, ${data.videoId ?? null}, ${data.target}, ${data.transcript}, ${data.accuracy})
    `;
    return { ok: true as const };
  });
