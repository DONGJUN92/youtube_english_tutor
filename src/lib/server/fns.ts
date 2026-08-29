import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/encrypt";
import { AgeBandSchema, CefrSchema, LocaleSchema, normalizeAgeBand, isReusableLesson, type GeneratedLesson, type LearnerAge } from "@/lib/schema";
import { PLACEMENT_BANK_VERSION } from "@/data/placement-version";
import { appAuthMiddleware } from "./app-auth";
import { hasOperatorOpenAiKey, operatorEnvFlags, operatorKeyLooksValid, operatorOpenAiKey, operatorOpenAiModel } from "./openai-key";
import { sanitizeCaptionLines } from "@/lib/caption-parse";
import { fetchVideoMeta } from "./youtube-data";
import { assertAllowedModel, pingOpenAI, evaluateSpeakingWithOpenAI } from "./openai-lesson";
import { lessonLevelFromSettings, lessonMatchesLearner } from "@/lib/learner-brief";
import { generateWindowedLesson, windowSkill, skillToStart } from "./window-lesson";

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
  playback_speed: z.number().nullable().optional(),
  show_ko_hints: z.boolean().nullable().optional(),
  preferred_cefr: z.string().nullable().optional(),
  lessons_started: z.number().nullable().optional(),
});

export type PublicProfile = {
  locale: "ko" | "en";
  ageBand: LearnerAge;
  displayName: string | null;
  cefrLevel: string | null;
  listeningScore: number | null;
  speakingScore: number | null;
  placementDone: boolean;
  openaiModel: string;
  hasOpenAiKey: boolean;
  openAiKeyLast4: string | null;
  placementBankVersion: number | null;
  playbackSpeed: number;
  showKoHints: boolean;
  preferredCefr: string | null;
  lessonsStarted: number;
};

function toPublic(row: z.infer<typeof ProfileRow> | undefined): PublicProfile | null {
  if (!row) return null;
  const operator = hasOperatorOpenAiKey();
  return {
    locale: row.locale === "en" ? "en" : "ko",
    ageBand: normalizeAgeBand(row.age_band),
    displayName: row.display_name,
    cefrLevel: row.cefr_level,
    listeningScore: row.listening_score,
    speakingScore: row.speaking_score,
    placementDone: Boolean(row.placement_completed_at),
    openaiModel: operatorOpenAiModel(row.openai_model),
    hasOpenAiKey: operator || Boolean(row.openai_key_enc),
    openAiKeyLast4: operator ? "server" : row.openai_key_enc ? "saved" : null,
    placementBankVersion: parseBankVersion(row.placement_path),
    playbackSpeed: Number(row.playback_speed) > 0 ? Number(row.playback_speed) : 1,
    showKoHints: row.show_ko_hints !== false,
    preferredCefr: row.preferred_cefr ?? null,
    lessonsStarted: Number(row.lessons_started) || 0,
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

function lessonLevel(row: z.infer<typeof ProfileRow> | undefined): "A1" | "A2" | "B1" | "B2" | "C1" {
  return lessonLevelFromSettings({ preferredCefr: row?.preferred_cefr, cefrLevel: row?.cefr_level });
}

function lessonCredentials(row: z.infer<typeof ProfileRow> | undefined) {
  const operator = operatorOpenAiKey();
  if (operator) {
    return { apiKey: operator, model: operatorOpenAiModel(row?.openai_model) };
  }
  if (row?.openai_key_enc) {
    return { apiKey: decryptSecret(row.openai_key_enc), model: row.openai_model || "gpt-4.1-mini" };
  }
  return null;
}

async function loadProfile(userId: string) {
  const sql = await getSql();
  const rows = await sql<z.infer<typeof ProfileRow>>`
    select user_id, locale, age_band, display_name, cefr_level, listening_score,
           speaking_score, placement_completed_at::text, openai_model, openai_key_enc,
           placement_path, playback_speed, show_ko_hints, preferred_cefr, lessons_started
    from profiles where user_id = ${userId}
  `;
  return rows[0];
}

async function noteStudy(userId: string, videoId: string): Promise<boolean> {
  const sql = await getSql();
  await sql`
    insert into profiles (user_id, updated_at)
    values (${userId}, now())
    on conflict (user_id) do nothing
  `;
  const inserted = await sql<{ video_id: string }>`
    insert into study_starts (user_id, video_id)
    values (${userId}, ${videoId})
    on conflict (user_id, video_id) do nothing
    returning video_id
  `;
  if (!inserted[0]) return false;
  await sql`
    update profiles
    set lessons_started = coalesce(lessons_started, 0) + 1, updated_at = now()
    where user_id = ${userId}
  `;
  const row = await loadProfile(userId);
  const count = Number(row?.lessons_started) || 0;
  return !row?.placement_completed_at && count > 0 && count % 3 === 0;
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([appAuthMiddleware])
  .handler(async ({ context }) => {
    const row = await loadProfile(context.userId);
    return toPublic(row);
  });

export const upsertOnboarding = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: { locale: "ko" | "en"; ageBand: "child" | "teen" | "college" | "adult" }) => ({
    locale: LocaleSchema.parse(input.locale),
    ageBand: normalizeAgeBand(AgeBandSchema.parse(input.ageBand)),
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

export const saveLearnerSettings = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: {
    locale: "ko" | "en";
    ageBand: "child" | "teen" | "college" | "adult";
    displayName?: string;
    playbackSpeed: number;
    showKoHints: boolean;
    preferredCefr?: "A1" | "A2" | "B1" | "B2" | "C1" | "";
  }) => ({
    locale: LocaleSchema.parse(input.locale),
    ageBand: normalizeAgeBand(AgeBandSchema.parse(input.ageBand)),
    displayName: (input.displayName ?? "").trim().slice(0, 40),
    playbackSpeed: [0.75, 1, 1.25, 1.5].includes(input.playbackSpeed) ? input.playbackSpeed : 1,
    showKoHints: Boolean(input.showKoHints),
    preferredCefr: input.preferredCefr ? CefrSchema.parse(input.preferredCefr) : null,
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into profiles (
        user_id, locale, age_band, display_name, playback_speed, show_ko_hints, preferred_cefr, updated_at
      ) values (
        ${context.userId}, ${data.locale}, ${data.ageBand}, ${data.displayName || null},
        ${data.playbackSpeed}, ${data.showKoHints}, ${data.preferredCefr}, now()
      )
      on conflict (user_id) do update set
        locale = excluded.locale,
        age_band = excluded.age_band,
        display_name = excluded.display_name,
        playback_speed = excluded.playback_speed,
        show_ko_hints = excluded.show_ko_hints,
        preferred_cefr = excluded.preferred_cefr,
        updated_at = now()
    `;
    return toPublic(await loadProfile(context.userId));
  });

export const savePlacementResult = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
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
        user_id, cefr_level, preferred_cefr, listening_score, speaking_score,
        placement_completed_at, placement_path, updated_at
      ) values (
        ${context.userId}, ${data.cefr}, ${data.cefr}, ${data.listening}, ${data.speaking},
        now(), ${JSON.stringify({ v: PLACEMENT_BANK_VERSION, steps: data.path })}::jsonb, now()
      )
      on conflict (user_id) do update set
        cefr_level = excluded.cefr_level,
        preferred_cefr = excluded.preferred_cefr,
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
  .middleware([appAuthMiddleware])
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
  .middleware([appAuthMiddleware])
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
    return toPublic(await loadProfile(context.userId));
  });

export const pingOpenAiKey = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .handler(async ({ context }) => {
    const row = await loadProfile(context.userId);
    const creds = lessonCredentials(row);
    if (!creds) {
      return {
        ok: false as const,
        status: 0,
        model: operatorOpenAiModel(),
        message: "missing_key",
        names: operatorEnvFlags(),
        keyLooksValid: false,
      };
    }
    const ping = await pingOpenAI(creds.apiKey, creds.model);
    return { ...ping, names: operatorEnvFlags(), keyLooksValid: operatorKeyLooksValid() };
  });

export const getLessonEngineStatus = createServerFn({ method: "GET" })
  .middleware([appAuthMiddleware])
  .handler(async () => {
    const hasKey = hasOperatorOpenAiKey();
    return {
      hasKey,
      model: operatorOpenAiModel(),
      keyLooksValid: operatorKeyLooksValid(),
      names: operatorEnvFlags(),
    };
  });

export const evaluateSpeakingTurn = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: { passage: string; partnerLine: string; said: string; ageBand: string }) => ({
    passage: input.passage.slice(0, 800),
    partnerLine: input.partnerLine.slice(0, 400),
    said: input.said.slice(0, 800),
    ageBand: input.ageBand,
  }))
  .handler(async ({ context, data }) => {
    const row = await loadProfile(context.userId);
    const creds = lessonCredentials(row);
    if (!creds) {
      return { ok: false as const, error: "missing_key" as const, fallback: heuristicSpeak(data.said) };
    }
    try {
      const evald = await evaluateSpeakingWithOpenAI({
        apiKey: creds.apiKey,
        model: creds.model,
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
    commentKo: english >= 3 ? "영어 단어가 보여서 의도는 전달됩니다." : "영어 한두 문장으로 다시 말해 보세요.",
    commentEn: english >= 3 ? "The idea comes through." : "Try one or two English sentences.",
    betterLine: "Sure — I can do that.",
  };
}

export const resolveVideo = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: { videoId: string }) => ({
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
  }))
  .handler(async ({ data }) => {
    const meta = await fetchVideoMeta(data.videoId);
    const { FEATURED_LESSONS } = await import("@/data/featured-lessons");
    return {
      ...meta,
      captionCount: 0,
      hasCaptions: true,
      hasSeededLesson: Boolean(FEATURED_LESSONS[data.videoId]),
    };
  });

export const loadOrGenerateLesson = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: {
    videoId: string;
    windowStartSec?: number;
    captions?: { start: number; dur: number; text: string }[];
    durationSec?: number;
    reuseOnly?: boolean;
    poToken?: string;
  }) => ({
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
    windowStartSec: Math.max(0, Number(input.windowStartSec) || 0),
    captions: sanitizeCaptionLines(input.captions),
    durationSec: Number(input.durationSec) > 0 ? Number(input.durationSec) : undefined,
    reuseOnly: Boolean(input.reuseOnly),
    poToken: typeof input.poToken === "string" && input.poToken.length > 20 ? input.poToken.slice(0, 400) : undefined,
  }))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const level = lessonLevel(profile);
    const ageBand = normalizeAgeBand(profile?.age_band);
    const { FEATURED_LESSONS } = await import("@/data/featured-lessons");
    const creds = lessonCredentials(profile);
    const seeded = FEATURED_LESSONS[data.videoId];
    if (seeded && data.windowStartSec < 1 && !creds) {
      const nudgePlacement = await noteStudy(context.userId, data.videoId);
      return {
        ok: true as const,
        source: "seed" as const,
        lesson: seeded,
        nudgePlacement,
        nextWindowStartSec: seeded.nextWindowStartSec ?? null,
        durationSec: seeded.durationSec ?? null,
        windows: seeded.windows ?? [],
        readyWindowStarts: [0],
      };
    }
    const skill = windowSkill(data.windowStartSec);
    const cached = await sql<{ payload: GeneratedLesson; skill: string }>`
      select payload, skill from lessons
      where user_id = ${context.userId} and video_id = ${data.videoId}
        and (skill = ${skill} or (${data.windowStartSec} = 0 and skill = 'bundle'))
      order by created_at desc
      limit 1
    `;
    const readyRows = await sql<{ skill: string }>`
      select skill from lessons
      where user_id = ${context.userId} and video_id = ${data.videoId}
    `;
    const readyWindowStarts = [
      ...new Set(readyRows.map((r) => skillToStart(r.skill)).filter((n): n is number => n != null)),
    ].sort((a, b) => a - b);
    if (cached[0]?.payload && isReusableLesson(cached[0].payload) && lessonMatchesLearner(cached[0].payload, ageBand, level)) {
      const nudgePlacement = await noteStudy(context.userId, data.videoId);
      const lesson = cached[0].payload;
      return {
        ok: true as const,
        source: "cache" as const,
        lesson,
        nudgePlacement,
        nextWindowStartSec: lesson.nextWindowStartSec ?? null,
        durationSec: lesson.durationSec ?? null,
        windows: lesson.windows ?? [],
        readyWindowStarts,
      };
    }
    if (data.reuseOnly) {
      return { ok: false as const, error: "need_generate" as const };
    }
    console.info(
      "[tubeshadow-lesson]",
      JSON.stringify({
        videoId: data.videoId,
        windowStartSec: data.windowStartSec,
        hasKey: Boolean(creds),
        model: creds?.model ?? "",
        keyLooksValid: operatorKeyLooksValid(),
        names: operatorEnvFlags(),
        level,
        ageBand,
      }),
    );
    if (!creds) {
      return {
        ok: false as const,
        error: "missing_key" as const,
        names: operatorEnvFlags(),
      };
    }
    try {
      const generated = await generateWindowedLesson({
        apiKey: creds.apiKey,
        model: creds.model,
        videoId: data.videoId,
        level,
        ageBand,
        windowStartSec: data.windowStartSec,
        captions: data.captions,
        durationSec: data.durationSec,
        poToken: data.poToken,
      });
      if (!generated.ok) {
        return { ok: false as const, error: "no_captions" as const, title: generated.title };
      }
      const lesson = generated.lesson;
      await sql`
        insert into lessons (id, user_id, video_id, skill, payload)
        values (
          ${`${context.userId}:${data.videoId}:${windowSkill(lesson.windowStartSec)}:${Date.now()}`},
          ${context.userId},
          ${data.videoId},
          ${windowSkill(lesson.windowStartSec)},
          ${JSON.stringify(lesson)}::jsonb
        )
      `;
      const nudgePlacement = await noteStudy(context.userId, data.videoId);
      return {
        ok: true as const,
        source: "openai" as const,
        lesson,
        nudgePlacement,
        nextWindowStartSec: lesson.nextWindowStartSec,
        durationSec: lesson.durationSec,
        windows: lesson.windows,
        readyWindowStarts: [...new Set([...readyWindowStarts, Math.floor(lesson.windowStartSec)])].sort(
          (a, b) => a - b,
        ),
      };
    } catch (err) {
      return {
        ok: false as const,
        error: "openai_failed" as const,
        message: err instanceof Error ? err.message : "OpenAI failed",
      };
    }
  });

export const saveVocab = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
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
  .middleware([appAuthMiddleware])
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
  .middleware([appAuthMiddleware])
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
  .middleware([appAuthMiddleware])
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
  .middleware([appAuthMiddleware])
  .validator((input: { videoId: string; positionSec: number; title?: string; thumbnail?: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into watch_progress (user_id, video_id, position_sec, title, thumbnail, first_seen_at, updated_at)
      values (${context.userId}, ${data.videoId}, ${data.positionSec}, ${data.title ?? null}, ${data.thumbnail ?? null}, now(), now())
      on conflict (user_id, video_id) do update set
        position_sec = excluded.position_sec,
        title = coalesce(excluded.title, watch_progress.title),
        thumbnail = coalesce(excluded.thumbnail, watch_progress.thumbnail),
        first_seen_at = coalesce(watch_progress.first_seen_at, now()),
        updated_at = now()
    `;
    return { ok: true as const };
  });

export const listProgress = createServerFn({ method: "GET" })
  .middleware([appAuthMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      video_id: string;
      position_sec: number;
      title: string | null;
      thumbnail: string | null;
      updated_at: string;
      first_seen_at: string;
    }>`
      select video_id, position_sec, title, thumbnail, updated_at::text,
             coalesce(first_seen_at, updated_at)::text as first_seen_at
      from watch_progress where user_id = ${context.userId}
      order by updated_at desc
    `;
  });

export const saveSpeakingAttempt = createServerFn({ method: "POST" })
  .middleware([appAuthMiddleware])
  .validator((input: { lessonId?: string; videoId?: string; target: string; transcript: string; accuracy: number }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into speaking_attempts (user_id, lesson_id, video_id, target, transcript, accuracy)
      values (${context.userId}, ${data.lessonId ?? null}, ${data.videoId ?? null}, ${data.target}, ${data.transcript}, ${data.accuracy})
    `;
    return { ok: true as const };
  });
