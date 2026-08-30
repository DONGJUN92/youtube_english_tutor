import { CefrSchema, normalizeAgeBand, type CefrLevel, type LearnerAge } from "./schema.ts";

const AGE_GUIDE: Record<LearnerAge, { label: string; topics: string; register: string }> = {
  child: {
    label: "young children / early elementary",
    topics: "home, school, animals, play, family, food — no adult finance, politics, or dating",
    register: "concrete everyday words, short clauses, no sarcasm or dense idiom",
  },
  teen: {
    label: "teenagers",
    topics: "school, friends, hobbies, sports, simple news, first jobs",
    register: "natural teen speech; light idiom is fine; no dense academic jargon",
  },
  adult: {
    label: "college students and working adults",
    topics: "work, study, interviews, news, daily life",
    register: "natural adult speech including campus and workplace language",
  },
};

const LEVEL_GUIDE: Record<CefrLevel, { listening: string; speaking: string }> = {
  A1: {
    listening: "one clear fact; only high-frequency words",
    speaking: "two short sentences, about 12–24 words, present/past simple",
  },
  A2: {
    listening: "a reason or simple detail; common spoken chunks",
    speaking: "two to three sentences, about 16–32 words",
  },
  B1: {
    listening: "attitude or a specific reason; some phrasal verbs",
    speaking: "two to four connected sentences, about 22–40 words",
  },
  B2: {
    listening: "inference and stance; natural interview speech",
    speaking: "connected thought, about 24–45 words, including a discourse marker",
  },
  C1: {
    listening: "implied meaning, hedging, or professional nuance",
    speaking: "fluent multi-clause shadowing, about 28–48 words",
  },
};

export function lessonLevelFromSettings(opts: {
  preferredCefr?: string | null;
  cefrLevel?: string | null;
}): CefrLevel {
  const raw = opts.preferredCefr || opts.cefrLevel || "A2";
  const parsed = CefrSchema.safeParse(raw);
  return parsed.success ? parsed.data : "A2";
}

export function learnerItemBrief(ageBand: string, level: CefrLevel): string {
  const ageId = normalizeAgeBand(ageBand);
  const age = AGE_GUIDE[ageId];
  const lv = LEVEL_GUIDE[level];
  return [
    `Learner age band (from app settings, do not ignore): ${ageId} — ${age.label}.`,
    `Practice CEFR (from app settings, do not ignore): ${level}.`,
    `Topics: ${age.topics}.`,
    `Register: ${age.register}.`,
    `Listening items: ${lv.listening}.`,
    `Speaking/shadowing items: ${lv.speaking}.`,
    "Write every item for THIS age band and THIS CEFR only. Do not default to adult or A2 if the settings differ.",
  ].join("\n");
}

export function shouldServeSeededLesson(windowStartSec: number, levelNudge = 0): boolean {
  return windowStartSec < 1 && Math.round(Number(levelNudge) || 0) === 0;
}

export function lessonMatchesLearner(
  lesson: { learnerAge?: string; learnerLevel?: string; listening?: { level?: string }[] },
  ageBand: string,
  level: CefrLevel,
): boolean {
  const ageId = normalizeAgeBand(ageBand);
  const storedAge = lesson.learnerAge ? normalizeAgeBand(lesson.learnerAge) : null;
  const storedLevel = lesson.learnerLevel || lesson.listening?.[0]?.level || null;
  if (!storedAge || storedAge !== ageId) return false;
  if (!storedLevel || storedLevel !== level) return false;
  return true;
}
