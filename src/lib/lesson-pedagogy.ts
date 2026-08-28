import { isSpeakerChangeLine, decodeHtmlEntities, type CaptionLine } from "./caption-parse.ts";
import type { GeneratedLesson, ListeningQuestion, SpeakingQuestion } from "./schema.ts";

export type ListenFocus = "gist" | "detail" | "inference";

export function listenItemKey(item: Pick<ListeningQuestion, "prompt" | "clip">): string {
  return `L:${item.clip.startSec.toFixed(2)}:${item.prompt}`;
}

export function speakItemKey(item: Pick<SpeakingQuestion, "target" | "clip">): string {
  return `S:${item.clip.startSec.toFixed(2)}:${item.target.slice(0, 48)}`;
}

export function listenFocusForIndex(index: number): ListenFocus {
  if (index % 3 === 0) return "gist";
  if (index % 3 === 1) return "detail";
  return "inference";
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const LEFTOVER_ENTITY = /&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi;

export function cleanCaptionText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/>{2,}/g, " ")
    .replace(LEFTOVER_ENTITY, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(laughter|applause|music|cheers|clears throat)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SKIP_LINE = /^(laughter|applause|music|cheers|\(laughter\)|\(applause\))$/i;

function minWordsForLevel(level: string): number {
  if (level === "A1") return 12;
  if (level === "A2") return 16;
  return 22;
}

function maxWordsForLevel(level: string): number {
  if (level === "A1") return 28;
  if (level === "A2") return 36;
  return 48;
}

function maxSecForLevel(level: string): number {
  if (level === "A1") return 20;
  if (level === "A2") return 28;
  return 40;
}

function sentenceMarks(text: string): number {
  return (text.match(/[.!?]/g) ?? []).length;
}

function joinCaptionParts(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    if (!out) {
      out = next;
      continue;
    }
    if (out.toLowerCase().includes(next.toLowerCase()) && next.length >= 8) continue;
    const max = Math.min(40, out.length, next.length);
    let overlap = 0;
    for (let n = max; n >= 6; n--) {
      if (out.slice(-n).toLowerCase() === next.slice(0, n).toLowerCase()) {
        overlap = n;
        break;
      }
    }
    out = overlap ? `${out}${next.slice(overlap)}` : `${out} ${next}`;
    out = out.replace(/\s+/g, " ").trim();
  }
  return out;
}

function withCleanedSpeech(item: SpeakingQuestion, text: string): SpeakingQuestion {
  const cleaned = cleanCaptionText(text);
  if (!cleaned) return { ...item, target: cleanCaptionText(item.target), clip: { ...item.clip, caption: cleanCaptionText(item.clip.caption) } };
  return {
    ...item,
    target: cleaned,
    clip: { ...item.clip, caption: cleaned },
  };
}

/**
 * Hamada (2016) and Kadota: shadowing works on connected speech, not isolated
 * citation lines. Stretch a one-liner into 2–4 idea-units from nearby captions.
 * Never cross a YouTube `>>` speaker change, and never leave HTML entities in.
 */
export function expandSpeakingFromCaptions(
  item: SpeakingQuestion,
  captions: CaptionLine[],
): SpeakingQuestion {
  const minWords = minWordsForLevel(item.level);
  const maxWords = maxWordsForLevel(item.level);
  const maxSec = maxSecForLevel(item.level);
  const cleanedTarget = cleanCaptionText(item.target || item.clip.caption);
  const currentWords = wordCount(cleanedTarget);
  const currentDur = item.clip.endSec - item.clip.startSec;

  // Curated 2-sentence stretches (featured clips) stay as the spoken line.
  if (sentenceMarks(cleanedTarget) >= 2 && currentWords >= 10 && currentDur >= 6) {
    return withCleanedSpeech(item, cleanedTarget);
  }
  if (currentWords >= minWords && currentDur >= 10) {
    return withCleanedSpeech(item, cleanedTarget);
  }

  const seed = cleanedTarget;
  const start = Math.max(0, item.clip.startSec - 0.35);
  const nearby = captions
    .map((c) => ({
      start: c.start,
      dur: c.dur,
      raw: c.text,
      speakerChange: isSpeakerChangeLine(c.text),
      text: cleanCaptionText(c.text),
    }))
    .filter((c) => c.text && !SKIP_LINE.test(c.text))
    .filter((c) => c.start >= start - 2.5 && c.start <= start + maxSec + 4)
    .sort((a, b) => a.start - b.start);

  if (!nearby.length) return withCleanedSpeech(item, seed || item.target);

  let i = nearby.findIndex((c) => c.start >= start - 1.4);
  if (i < 0) i = 0;
  const seedIdx = nearby.findIndex(
    (c) => seed && c.text && seed.toLowerCase().includes(c.text.toLowerCase().slice(0, 24)),
  );
  if (seedIdx >= 0 && seedIdx <= i) i = seedIdx;

  const parts: { start: number; dur: number; text: string }[] = [];
  let words = 0;
  for (let k = i; k < nearby.length; k++) {
    const line = nearby[k];
    if (line.speakerChange && parts.length) break;
    const nextWords = words + wordCount(line.text);
    const end = line.start + Math.max(0.4, line.dur || 0);
    const spanStart = parts[0]?.start ?? line.start;
    if (parts.length && (nextWords > maxWords || end - spanStart > maxSec)) break;
    parts.push(line);
    words = nextWords;
    const joined = joinCaptionParts(parts.map((p) => p.text));
    const sentences = sentenceMarks(joined);
    if (words >= minWords && (sentences >= 2 || words >= minWords + 6)) break;
  }

  if (!parts.length) return withCleanedSpeech(item, seed || item.target);
  let text = joinCaptionParts(parts.map((p) => p.text));
  if (seed && !text.toLowerCase().startsWith(seed.toLowerCase().slice(0, 18)) && wordCount(seed) >= 6) {
    text = joinCaptionParts([seed, text]);
  }
  if (wordCount(text) < currentWords) return withCleanedSpeech(item, seed || item.target);
  const last = parts[parts.length - 1]!;
  const first = parts[0]!;
  const endSec = last.start + Math.max(0.4, last.dur || 0);
  return {
    ...item,
    target: text,
    clip: {
      startSec: Number(Math.min(item.clip.startSec, first.start).toFixed(2)),
      endSec: Number(Math.max(endSec, item.clip.startSec + 6).toFixed(2)),
      caption: text,
    },
  };
}

function cleanListening(item: ListeningQuestion): ListeningQuestion {
  return {
    ...item,
    clip: { ...item.clip, caption: cleanCaptionText(item.clip.caption) },
  };
}

export function enrichLesson(lesson: GeneratedLesson, captions: CaptionLine[]): GeneratedLesson {
  const listening = lesson.listening.map(cleanListening);
  if (!captions.length) {
    return {
      ...lesson,
      listening,
      speaking: lesson.speaking.map((item) => withCleanedSpeech(item, item.target || item.clip.caption)),
    };
  }
  return {
    ...lesson,
    listening,
    speaking: lesson.speaking.map((item) => expandSpeakingFromCaptions(item, captions)),
  };
}
