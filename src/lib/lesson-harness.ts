import { isSpeakerChangeLine, cleanCaptionText, type CaptionLine } from "./caption-parse.ts";
import type { CefrLevel } from "./schema.ts";
import { learnerItemBrief } from "./learner-brief.ts";
import {
  maxSecForLevel,
  maxWordsForLevel,
  minWordsForLevel,
  wordCount,
} from "./lesson-pedagogy.ts";

const SKIP_LINE = /^(laughter|applause|music|cheers|\(laughter\)|\(applause\))$/i;
const DETAIL_MARK = /\b(\d+|percent|%|million|billion|because|so that|that's why|specifically|exactly|named|called|years?|dollars?)\b/i;
const INFER_MARK = /\b(think|thought|feel|believe|actually|kind of|sort of|maybe|perhaps|should|would|seems?|guess|probably|unfortunately|honestly)\b/i;
const STOP = new Set(
  "the a an of to and in is it you we they that this for on with as be at by or from not but if so just about can will was were are have has had do did i me my your our their".split(" "),
);

export type HarnessClip = {
  id: string;
  role: "gist" | "detail" | "inference" | "shadow";
  startSec: number;
  endSec: number;
  caption: string;
};

export type LessonHarness = {
  listening: HarnessClip[];
  speaking: HarnessClip[];
  vocabHints: string[];
  transcript: string;
};

type Line = { start: number; dur: number; text: string };

function usableLines(captions: CaptionLine[]): Line[] {
  return captions
    .map((c) => ({
      start: c.start,
      dur: Math.max(0.4, c.dur || 0),
      text: cleanCaptionText(c.text),
    }))
    .filter((c) => c.text.length >= 3 && !SKIP_LINE.test(c.text) && !isSpeakerChangeLine(c.text));
}

function joinTexts(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function spanFrom(lines: Line[], i: number, minSec: number, maxSec: number, minWords: number, maxWords: number) {
  const first = lines[i];
  if (!first) return null;
  const parts = [first.text];
  let end = first.start + first.dur;
  for (let k = i + 1; k < lines.length; k++) {
    const line = lines[k];
    if (line.start - end > 1.25) break;
    const nextEnd = line.start + line.dur;
    const nextText = joinTexts([...parts, line.text]);
    if (nextEnd - first.start > maxSec || wordCount(nextText) > maxWords) break;
    parts.push(line.text);
    end = nextEnd;
    if (end - first.start >= minSec && wordCount(nextText) >= minWords) break;
  }
  const caption = joinTexts(parts);
  const dur = end - first.start;
  if (wordCount(caption) < 6 || dur < minSec * 0.6) return null;
  return {
    startSec: Number(first.start.toFixed(2)),
    endSec: Number(end.toFixed(2)),
    caption,
    words: wordCount(caption),
    dur,
  };
}

function overlap(a: { startSec: number; endSec: number }, b: { startSec: number; endSec: number }) {
  const left = Math.max(a.startSec, b.startSec);
  const right = Math.min(a.endSec, b.endSec);
  return Math.max(0, right - left);
}

function pickListening(lines: Line[]): HarnessClip[] {
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const span = spanFrom(lines, i, 8, 22, 8, 60);
    if (!span) continue;
    candidates.push(span);
  }
  if (!candidates.length) return [];
  const windowEnd = lines[lines.length - 1]!.start + lines[lines.length - 1]!.dur;
  const scored = candidates.map((c) => {
    const mid = (c.startSec + c.endSec) / 2;
    const early = 1 - mid / Math.max(1, windowEnd);
    const gist = c.dur * 0.4 + c.words * 0.2 + early * 8;
    const detail = (DETAIL_MARK.test(c.caption) ? 12 : 0) + c.words * 0.15;
    const inference = (INFER_MARK.test(c.caption) ? 14 : 0) + (1 - early) * 4;
    return { ...c, gist, detail, inference };
  });
  const roles: Array<"gist" | "detail" | "inference"> = ["gist", "detail", "inference"];
  const picked: HarnessClip[] = [];
  for (const role of roles) {
    const ranked = [...scored].sort((a, b) => b[role] - a[role]);
    const next = ranked.find((c) => picked.every((p) => overlap(p, c) < 4)) ?? ranked[0];
    if (!next) continue;
    picked.push({
      id: `L${picked.length + 1}`,
      role,
      startSec: next.startSec,
      endSec: next.endSec,
      caption: next.caption,
    });
  }
  return picked;
}

function pickSpeaking(lines: Line[], level: CefrLevel): HarnessClip[] {
  const minWords = minWordsForLevel(level);
  const maxWords = maxWordsForLevel(level);
  const maxSec = Math.min(38, maxSecForLevel(level));
  const spans: HarnessClip[] = [];
  let i = 0;
  while (i < lines.length && spans.length < 3) {
    const span = spanFrom(lines, i, 12, maxSec, minWords, maxWords);
    if (!span) {
      i += 1;
      continue;
    }
    if (spans.every((p) => overlap(p, span) < 3)) {
      spans.push({
        id: `S${spans.length + 1}`,
        role: "shadow",
        startSec: span.startSec,
        endSec: span.endSec,
        caption: span.caption,
      });
      while (i < lines.length && lines[i]!.start < span.endSec - 0.2) i += 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return spans;
}

function vocabHints(clips: HarnessClip[]): string[] {
  const bag = new Map<string, number>();
  for (const clip of clips) {
    const words = clip.caption.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (w.length >= 4 && !STOP.has(w)) bag.set(w, (bag.get(w) ?? 0) + 2);
      const bigram = `${w} ${words[i + 1] ?? ""}`.trim();
      if (words[i + 1] && !STOP.has(w) && bigram.length >= 7) bag.set(bigram, (bag.get(bigram) ?? 0) + 3);
    }
  }
  return [...bag.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .filter((w, i, all) => all.findIndex((x) => x === w) === i)
    .slice(0, 10);
}

export function buildLessonHarness(captions: CaptionLine[], level: CefrLevel): LessonHarness {
  const lines = usableLines(captions).slice(0, 80);
  const listening = pickListening(lines);
  const speaking = pickSpeaking(lines, level);
  const transcript = lines
    .slice(0, 24)
    .map((c) => `[${c.start.toFixed(1)}-${(c.start + c.dur).toFixed(1)}] ${c.text}`)
    .join("\n")
    .slice(0, 1800);
  return {
    listening,
    speaking,
    vocabHints: vocabHints([...listening, ...speaking]),
    transcript,
  };
}

function clipLine(clip: HarnessClip): string {
  return `${clip.id} ${clip.role} ${clip.startSec.toFixed(1)}-${clip.endSec.toFixed(1)} :: ${clip.caption}`;
}

export function renderLessonHarnessPrompt(opts: {
  videoId: string;
  title: string;
  ageBand: string;
  level: CefrLevel;
  windowStartSec?: number;
  windowEndSec?: number;
  harness: LessonHarness;
}): { system: string; user: string } {
  const brief = learnerItemBrief(opts.ageBand, opts.level);
  const windowNote =
    opts.windowStartSec != null && opts.windowEndSec != null
      ? `Window ${opts.windowStartSec.toFixed(1)}–${opts.windowEndSec.toFixed(1)}s.`
      : "Use harvest timestamps only.";
  const system = `You are a JSON item-writer. Do not reason step by step. Copy harvest timestamps and captions exactly. Fill stems, 4 choices, answer, explanations, and vocab for the learner profile. Output JSON only.
Rules:
- listening[0] = gist using L1. listening[1] = detail using L2. listening[2] = inference using L3.
- Stem is a listening purpose only. Never put the answer in the stem.
- speaking[i] copies Si target and clip. Keep the exact spoken words.
- answer must be one of the 4 choices.
- Vocab: 4–6 spoken American-English words or chunks per item. Prefer harvest vocab hints when they fit.
- ${windowNote}
Learner settings (authoritative):
${brief}`;

  const listenBlock = opts.harness.listening.map(clipLine).join("\n") || "(none — invent 3 short clips from the transcript title, start 0)";
  const speakBlock = opts.harness.speaking.map(clipLine).join("\n") || "(none — build 3 connected-speech lines from the transcript)";
  const user = `Video id: ${opts.videoId}
Title: ${opts.title}
Age band: ${opts.ageBand}
Practice CEFR: ${opts.level}

HARVEST listening
${listenBlock}

HARVEST speaking
${speakBlock}

VOCAB HINTS
${opts.harness.vocabHints.join(", ") || "(none)"}

TRANSCRIPT
${opts.harness.transcript || `(no captions — still return 3 short items for CEFR ${opts.level} and age ${opts.ageBand})`}`;
  return { system, user };
}

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clipOf(value: unknown, harvest?: HarnessClip): { startSec: number; endSec: number; caption: string } {
  const rec = asRecord(value);
  const start = Number(rec.startSec);
  const end = Number(rec.endSec);
  const startSec = harvest?.startSec ?? (Number.isFinite(start) ? start : 0);
  const endSec = harvest?.endSec ?? (Number.isFinite(end) && end > startSec ? end : startSec + 8);
  return {
    startSec,
    endSec,
    caption: harvest?.caption || textOf(rec.caption, harvest?.caption ?? ""),
  };
}

function vocabOf(value: unknown, hints: string[], caption: string) {
  const items = asList(value)
    .map((item) => {
      const rec = asRecord(item);
      const word = textOf(rec.word);
      if (!word) return null;
      return {
        word: word.slice(0, 48),
        meaningKo: textOf(rec.meaningKo, word),
        meaningEn: textOf(rec.meaningEn, word),
        ipa: textOf(rec.ipa),
      };
    })
    .filter((item): item is { word: string; meaningKo: string; meaningEn: string; ipa: string } => Boolean(item));
  if (items.length >= 4) return items.slice(0, 6);
  const extra = [...hints, ...caption.toLowerCase().split(/[^a-z']+/).filter((w) => w.length >= 4 && !STOP.has(w))];
  for (const word of extra) {
    if (items.length >= 4) break;
    if (items.some((v) => v.word.toLowerCase() === word.toLowerCase())) continue;
    items.push({ word, meaningKo: word, meaningEn: word, ipa: "" });
  }
  while (items.length < 4) {
    items.push({ word: `word${items.length + 1}`, meaningKo: "핵심 표현", meaningEn: "key expression", ipa: "" });
  }
  return items.slice(0, 6);
}

function choicesOf(value: unknown, answer: string, caption: string): { choices: string[]; answer: string } {
  const raw = asList(value).map((c) => textOf(c)).filter(Boolean);
  let answerText = answer.trim() || raw[0] || caption.slice(0, 80) || "The speaker's main point";
  const choices = [...raw];
  if (!choices.includes(answerText)) choices.unshift(answerText);
  const fillers = [
    "A different topic is being discussed",
    "The speaker does not mention this",
    "This happens at another time",
    caption.slice(0, 42) || "A side detail",
  ];
  for (const fill of fillers) {
    if (choices.length >= 4) break;
    if (!choices.includes(fill)) choices.push(fill);
  }
  const unique = [...new Set(choices)].slice(0, 4);
  if (!unique.includes(answerText)) {
    unique[0] = answerText;
  }
  while (unique.length < 2) unique.push("Not mentioned");
  return { choices: unique, answer: unique.includes(answerText) ? answerText : unique[0]! };
}

const ROLE_PROMPT: Record<HarnessClip["role"], { prompt: string; stem: string }> = {
  gist: { prompt: "What is the speaker mainly talking about?", stem: "Listen for the overall point." },
  detail: { prompt: "Which detail does the speaker give?", stem: "Listen for a specific fact." },
  inference: { prompt: "What can we infer from this part?", stem: "Listen for attitude or implied meaning." },
  shadow: { prompt: "Shadow this connected-speech line.", stem: "Stay with the speaker." },
};

/**
 * Keep harvest timestamps/captions authoritative and coerce a messy model
 * payload into something the lesson schema will accept — one OpenAI call,
 * no second generation.
 */
export function alignLessonWithHarness(
  raw: unknown,
  opts: {
    videoId: string;
    title: string;
    ageBand: string;
    level: CefrLevel;
    harness: LessonHarness;
  },
): unknown {
  const obj = asRecord(raw);
  const listeningIn = asList(obj.listening);
  const speakingIn = asList(obj.speaking);
  if (!listeningIn.length && !speakingIn.length) return raw;

  const listening = opts.harness.listening.map((harvest, i) => {
    const rec = asRecord(listeningIn[i] ?? listeningIn[0]);
    const clip = clipOf(rec.clip, harvest);
    const answer = textOf(rec.answer);
    const coerced = choicesOf(rec.choices, answer, harvest.caption);
    const role = ROLE_PROMPT[harvest.role];
    return {
      skill: "listening" as const,
      level: opts.level,
      videoId: opts.videoId,
      clip,
      prompt: textOf(rec.prompt, role.prompt),
      stem: textOf(rec.stem, role.stem),
      choices: coerced.choices,
      answer: coerced.answer,
      explanationKo: textOf(rec.explanationKo, "영상에서 방금 들린 내용입니다."),
      explanationEn: textOf(rec.explanationEn, harvest.caption),
      vocab: vocabOf(rec.vocab, opts.harness.vocabHints, harvest.caption),
    };
  });

  const speaking = opts.harness.speaking.map((harvest, i) => {
    const rec = asRecord(speakingIn[i] ?? speakingIn[0]);
    const clip = clipOf(rec.clip, harvest);
    return {
      skill: "speaking" as const,
      level: opts.level,
      videoId: opts.videoId,
      clip,
      prompt: textOf(rec.prompt, ROLE_PROMPT.shadow.prompt),
      stem: textOf(rec.stem, ROLE_PROMPT.shadow.stem),
      target: harvest.caption,
      rubric: asList(rec.rubric).map((r) => textOf(r)).filter(Boolean).slice(0, 4).concat(["connected speech"]).slice(0, 4),
      explanationKo: textOf(rec.explanationKo, "자막과 같은 말로 따라 말하세요."),
      explanationEn: textOf(rec.explanationEn, "Shadow the exact connected speech."),
      vocab: vocabOf(rec.vocab, opts.harness.vocabHints, harvest.caption),
    };
  });

  return {
    videoId: opts.videoId,
    title: textOf(obj.title, opts.title) || opts.title,
    listening: listening.length ? listening : listeningIn,
    speaking: speaking.length ? speaking : speakingIn,
    learnerAge: opts.ageBand,
    learnerLevel: opts.level,
  };
}

