import { FEATURED_LESSONS } from "@/data/featured-lessons";
import { PLACEMENT_BANK_VERSION } from "@/data/placement-version";
import type { PublicProfile } from "@/lib/server/fns";
import type { GeneratedLesson } from "@/lib/schema";
import {
  evaluateSpeakingWithKey,
  generateLessonWithKey,
  pingOpenAiWithKey,
  resolveVideoPublic,
} from "@/lib/server/device-ai";
import { readStoredUser } from "./auth";
import {
  getAllByIndex,
  getById,
  newId,
  putRow,
  type BookmarkRow,
  type LessonRow,
  type ProfileRow,
  type ProgressRow,
  type VocabRow,
} from "./db";

function last4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 4) return "••••";
  return trimmed.slice(-4);
}

function requireUserId(): string {
  const user = readStoredUser();
  if (!user) throw new Error("Unauthorized");
  return user.id;
}

function toPublic(row: ProfileRow | undefined): PublicProfile | null {
  if (!row) return null;
  return {
    locale: row.locale,
    ageBand: row.ageBand === "child" || row.ageBand === "teen" ? row.ageBand : "adult",
    displayName: null,
    cefrLevel: row.cefrLevel,
    listeningScore: row.listeningScore,
    speakingScore: row.speakingScore,
    placementDone: row.placementDone,
    openaiModel: row.openaiModel,
    hasOpenAiKey: Boolean(row.openaiKey),
    openAiKeyLast4: row.openaiKey ? last4(row.openaiKey) : null,
    placementBankVersion: row.placementBankVersion,
    playbackSpeed: 1,
    showKoHints: true,
    preferredCefr: null,
    lessonsStarted: 0,
  };
}

function emptyProfile(userId: string): ProfileRow {
  return {
    userId,
    locale: "ko",
    ageBand: "adult",
    cefrLevel: null,
    listeningScore: null,
    speakingScore: null,
    placementDone: false,
    placementPath: null,
    placementBankVersion: null,
    openaiModel: "gpt-4.1-mini",
    openaiKey: null,
    updatedAt: new Date().toISOString(),
  };
}

async function loadProfile(userId: string): Promise<ProfileRow | undefined> {
  return getById<ProfileRow>("profiles", userId);
}

export async function getMyProfile(): Promise<PublicProfile | null> {
  return toPublic(await loadProfile(requireUserId()));
}

export async function upsertOnboarding(data: {
  locale: "ko" | "en";
  ageBand: "child" | "teen" | "college" | "adult";
}): Promise<PublicProfile | null> {
  const userId = requireUserId();
  const current = (await loadProfile(userId)) ?? emptyProfile(userId);
  const next: ProfileRow = {
    ...current,
    locale: data.locale,
    ageBand: data.ageBand === "child" || data.ageBand === "teen" ? data.ageBand : "adult",
    updatedAt: new Date().toISOString(),
  };
  await putRow("profiles", next);
  return toPublic(next);
}

export async function savePlacementResult(data: {
  cefr: "A1" | "A2" | "B1" | "B2" | "C1";
  listening: number;
  speaking: number;
  path: unknown;
}): Promise<PublicProfile | null> {
  const userId = requireUserId();
  const current = (await loadProfile(userId)) ?? emptyProfile(userId);
  if (current.placementDone) return toPublic(current);
  const next: ProfileRow = {
    ...current,
    cefrLevel: data.cefr,
    listeningScore: Math.round(data.listening),
    speakingScore: Math.round(data.speaking),
    placementDone: true,
    placementPath: { v: PLACEMENT_BANK_VERSION, steps: data.path },
    placementBankVersion: PLACEMENT_BANK_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await putRow("profiles", next);
  return toPublic(next);
}

export async function resetPlacement(): Promise<PublicProfile | null> {
  const userId = requireUserId();
  const current = await loadProfile(userId);
  if (!current) return null;
  const next: ProfileRow = {
    ...current,
    placementDone: false,
    placementPath: null,
    updatedAt: new Date().toISOString(),
  };
  await putRow("profiles", next);
  return toPublic(next);
}

export async function saveOpenAiSettings(data: {
  apiKey?: string;
  model: string;
}): Promise<PublicProfile & { openAiKeyLast4: string | null }> {
  const userId = requireUserId();
  const current = (await loadProfile(userId)) ?? emptyProfile(userId);
  const incoming = data.apiKey?.trim() ?? "";
  const openaiKey = incoming.startsWith("sk-") ? incoming : current.openaiKey;
  const next: ProfileRow = {
    ...current,
    openaiModel: data.model.trim() || "gpt-4.1-mini",
    openaiKey,
    updatedAt: new Date().toISOString(),
  };
  await putRow("profiles", next);
  const pub = toPublic(next)!;
  return {
    ...pub,
    openAiKeyLast4: openaiKey ? last4(openaiKey) : null,
  };
}

export async function pingOpenAiKey() {
  const userId = requireUserId();
  const row = await loadProfile(userId);
  if (!row?.openaiKey) {
    return { ok: false as const, status: 0, model: "", message: "missing_key" };
  }
  return pingOpenAiWithKey({ data: { apiKey: row.openaiKey, model: row.openaiModel || "gpt-4.1-mini" } });
}

export async function evaluateSpeakingTurn(data: {
  passage: string;
  partnerLine: string;
  said: string;
  ageBand: string;
}) {
  const userId = requireUserId();
  const row = await loadProfile(userId);
  if (!row?.openaiKey) {
    return { ok: false as const, error: "missing_key" as const, fallback: heuristicSpeak(data.said) };
  }
  return evaluateSpeakingWithKey({
    data: {
      apiKey: row.openaiKey,
      model: row.openaiModel || "gpt-4.1-mini",
      ...data,
    },
  });
}

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

export async function resolveVideo(data: { videoId: string }) {
  return resolveVideoPublic({ data });
}

export async function loadOrGenerateLesson(data: {
  videoId: string;
  windowStartSec?: number;
  captions?: { start: number; dur: number; text: string }[];
  durationSec?: number;
}) {
  const userId = requireUserId();
  const windowStart = Math.max(0, Number(data.windowStartSec) || 0);
  const seeded = FEATURED_LESSONS[data.videoId];
  if (seeded) {
    return {
      ok: true as const,
      source: "seed" as const,
      lesson: seeded,
      nextWindowStartSec: null as number | null,
      durationSec: seeded.durationSec ?? null,
      windows: seeded.windows ?? [],
      readyWindowStarts: [0],
    };
  }
  const cached = await getAllByIndex<LessonRow>("lessons", "userVideo", [userId, data.videoId]);
  const readyWindowStarts = [
    ...new Set(
      cached
        .map((row) => {
          const payload = row.payload as GeneratedLesson | undefined;
          return payload?.windowStartSec ?? 0;
        })
        .filter((n) => Number.isFinite(n)),
    ),
  ].sort((a, b) => a - b);
  const latest = cached
    .filter((row) => {
      const payload = row.payload as GeneratedLesson | undefined;
      const start = payload?.windowStartSec ?? 0;
      return Math.abs(start - windowStart) < 1.5 || (windowStart === 0 && payload?.windowStartSec == null);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest?.payload) {
    const lesson = latest.payload as GeneratedLesson;
    return {
      ok: true as const,
      source: "cache" as const,
      lesson,
      nextWindowStartSec: lesson.nextWindowStartSec ?? null,
      durationSec: lesson.durationSec ?? null,
      windows: lesson.windows ?? [],
      readyWindowStarts,
    };
  }
  const profile = await loadProfile(userId);
  if (!profile?.openaiKey) return { ok: false as const, error: "missing_key" as const };
  const result = await generateLessonWithKey({
    data: {
      apiKey: profile.openaiKey,
      model: profile.openaiModel || "gpt-4.1-mini",
      videoId: data.videoId,
      level: (profile.cefrLevel as "A1" | "A2" | "B1" | "B2" | "C1") || "A2",
      ageBand: profile.ageBand || "adult",
      windowStartSec: windowStart,
      captions: data.captions,
      durationSec: data.durationSec,
    },
  });
  if (result.ok) {
    const row: LessonRow = {
      id: newId("les"),
      userId,
      videoId: data.videoId,
      payload: result.lesson,
      createdAt: new Date().toISOString(),
    };
    await putRow("lessons", row);
  }
  return result;
}

export async function saveVocab(data: {
  videoId?: string;
  word: string;
  meaningKo?: string;
  meaningEn?: string;
  ipa?: string;
  clipStart?: number;
  clipEnd?: number;
}) {
  const userId = requireUserId();
  const row: VocabRow = {
    id: Date.now(),
    userId,
    video_id: data.videoId ?? null,
    word: data.word,
    meaning_ko: data.meaningKo ?? null,
    meaning_en: data.meaningEn ?? null,
    ipa: data.ipa ?? null,
    clip_start: data.clipStart ?? null,
    clip_end: data.clipEnd ?? null,
    created_at: new Date().toISOString(),
  };
  await putRow("vocab", row);
  return { ok: true as const };
}

export async function listVocab() {
  const userId = requireUserId();
  const rows = await getAllByIndex<VocabRow>("vocab", "userId", userId);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function saveClipBookmark(data: {
  videoId: string;
  startSec: number;
  endSec: number;
  caption?: string;
  note?: string;
}) {
  const userId = requireUserId();
  const row: BookmarkRow = {
    id: Date.now(),
    userId,
    video_id: data.videoId,
    start_sec: data.startSec,
    end_sec: data.endSec,
    caption: data.caption ?? null,
    note: data.note ?? null,
    created_at: new Date().toISOString(),
  };
  await putRow("bookmarks", row);
  return { ok: true as const };
}

export async function listClipBookmarks() {
  const userId = requireUserId();
  const rows = await getAllByIndex<BookmarkRow>("bookmarks", "userId", userId);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function saveProgress(data: {
  videoId: string;
  positionSec: number;
  title?: string;
  thumbnail?: string;
}) {
  const userId = requireUserId();
  const id = `${userId}:${data.videoId}`;
  const prev = await getById<ProgressRow>("progress", id);
  const row: ProgressRow = {
    id,
    userId,
    video_id: data.videoId,
    position_sec: data.positionSec,
    title: data.title ?? prev?.title ?? null,
    thumbnail: data.thumbnail ?? prev?.thumbnail ?? null,
    updated_at: new Date().toISOString(),
  };
  await putRow("progress", row);
  return { ok: true as const };
}

export async function listProgress() {
  const userId = requireUserId();
  const rows = await getAllByIndex<ProgressRow>("progress", "userId", userId);
  return rows
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(({ video_id, position_sec, title, thumbnail, updated_at }) => ({
      video_id,
      position_sec,
      title,
      thumbnail,
      updated_at,
    }));
}

export async function saveSpeakingAttempt(data: {
  lessonId?: string;
  videoId?: string;
  target: string;
  transcript: string;
  accuracy: number;
}) {
  const userId = requireUserId();
  await putRow("speaking", {
    id: Date.now(),
    userId,
    lessonId: data.lessonId ?? null,
    videoId: data.videoId ?? null,
    target: data.target,
    transcript: data.transcript,
    accuracy: data.accuracy,
    createdAt: new Date().toISOString(),
  });
  return { ok: true as const };
}
