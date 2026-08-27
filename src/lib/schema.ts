import { z } from "zod";

export const AgeBandSchema = z.enum(["child", "teen", "college", "adult"]);
export type AgeBand = z.infer<typeof AgeBandSchema>;

export const LearnerAgeSchema = z.enum(["child", "teen", "adult"]);
export type LearnerAge = z.infer<typeof LearnerAgeSchema>;
export const LEARNER_AGES: LearnerAge[] = ["child", "teen", "adult"];

/** College is treated as adult everywhere in the product. */
export function normalizeAgeBand(age: string | null | undefined): LearnerAge {
  if (age === "child" || age === "teen") return age;
  return "adult";
}

export const LocaleSchema = z.enum(["ko", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const CefrSchema = z.enum(["A1", "A2", "B1", "B2", "C1"]);
export type CefrLevel = z.infer<typeof CefrSchema>;

export const SkillSchema = z.enum(["listening", "speaking"]);
export type Skill = z.infer<typeof SkillSchema>;

export const ClipSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  caption: z.string(),
});
export type LessonClip = z.infer<typeof ClipSchema>;

export const VocabItemSchema = z.object({
  word: z.string().min(1),
  meaningKo: z.string(),
  meaningEn: z.string().optional().default(""),
  ipa: z.string().optional(),
});
export type VocabItem = z.infer<typeof VocabItemSchema>;

export const ListeningQuestionSchema = z.object({
  skill: z.literal("listening"),
  level: CefrSchema,
  videoId: z.string(),
  clip: ClipSchema,
  prompt: z.string(),
  stem: z.string(),
  choices: z.array(z.string()).min(2).max(6),
  answer: z.string(),
  explanationKo: z.string(),
  explanationEn: z.string(),
  vocab: z.array(VocabItemSchema),
});
export type ListeningQuestion = z.infer<typeof ListeningQuestionSchema>;

export const SpeakingQuestionSchema = z.object({
  skill: z.literal("speaking"),
  level: CefrSchema,
  videoId: z.string(),
  clip: ClipSchema,
  prompt: z.string(),
  stem: z.string(),
  target: z.string(),
  rubric: z.array(z.string()),
  explanationKo: z.string(),
  explanationEn: z.string(),
  vocab: z.array(VocabItemSchema),
});
export type SpeakingQuestion = z.infer<typeof SpeakingQuestionSchema>;

export const GeneratedLessonSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  listening: z.array(ListeningQuestionSchema).min(1).max(6),
  speaking: z.array(SpeakingQuestionSchema).min(1).max(6),
  windowStartSec: z.number().optional(),
  windowEndSec: z.number().optional(),
  durationSec: z.number().optional(),
  nextWindowStartSec: z.number().nullable().optional(),
  windows: z.array(z.object({ startSec: z.number(), endSec: z.number() })).optional(),
});

export type GeneratedLesson = z.infer<typeof GeneratedLessonSchema>;

export const OPENAI_LESSON_JSON_SCHEMA = {
  name: "youtube_english_lesson",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["videoId", "title", "listening", "speaking"],
    properties: {
      videoId: { type: "string" },
      title: { type: "string" },
      listening: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "skill",
            "level",
            "videoId",
            "clip",
            "prompt",
            "stem",
            "choices",
            "answer",
            "explanationKo",
            "explanationEn",
            "vocab",
          ],
          properties: {
            skill: { type: "string", enum: ["listening"] },
            level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1"] },
            videoId: { type: "string" },
            clip: {
              type: "object",
              additionalProperties: false,
              required: ["startSec", "endSec", "caption"],
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                caption: { type: "string" },
              },
            },
            prompt: { type: "string" },
            stem: { type: "string" },
            choices: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
            answer: { type: "string" },
            explanationKo: { type: "string" },
            explanationEn: { type: "string" },
            vocab: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["word", "meaningKo", "meaningEn", "ipa"],
                properties: {
                  word: { type: "string" },
                  meaningKo: { type: "string" },
                  meaningEn: { type: "string" },
                  ipa: { type: "string" },
                },
              },
            },
          },
        },
      },
      speaking: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "skill",
            "level",
            "videoId",
            "clip",
            "prompt",
            "stem",
            "target",
            "rubric",
            "explanationKo",
            "explanationEn",
            "vocab",
          ],
          properties: {
            skill: { type: "string", enum: ["speaking"] },
            level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1"] },
            videoId: { type: "string" },
            clip: {
              type: "object",
              additionalProperties: false,
              required: ["startSec", "endSec", "caption"],
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                caption: { type: "string" },
              },
            },
            prompt: { type: "string" },
            stem: { type: "string" },
            target: { type: "string" },
            rubric: { type: "array", items: { type: "string" } },
            explanationKo: { type: "string" },
            explanationEn: { type: "string" },
            vocab: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["word", "meaningKo", "meaningEn", "ipa"],
                properties: {
                  word: { type: "string" },
                  meaningKo: { type: "string" },
                  meaningEn: { type: "string" },
                  ipa: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
