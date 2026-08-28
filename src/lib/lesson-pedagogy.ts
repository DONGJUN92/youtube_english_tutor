import type { CaptionLine } from "./caption-parse.ts";
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

export function cleanCaptionText(raw: string): string {
  return raw
    .replace(/>+/gi, " ")
    .replace(/"/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&/gi, "&")
    .replace(/>>/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(laughter|applause|music|cheers)[^)]*\)/gi, " ")
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

/**
 * Hamada (2016) and Kadota: shadowing works on connected speech, not isolated
 * citation lines. Stretch a one-liner into 2–4 idea-units from nearby captions.
 */
export function expandSpeakingFromCaptions(
  item: SpeakingQuestion,
  captions: CaptionLine[],
): SpeakingQuestion {
  const minWords = minWordsForLevel(item.level);
  const maxWords = maxWordsForLevel(item.level);
  const maxSec = maxSecForLevel(item.level);
  const currentWords = wordCount(item.target);
  const currentDur = item.clip.endSec - item.clip.startSec;
  if (currentWords >= minWords && currentDur >= 10) return item;

  const seed = cleanCaptionText(item.target || item.clip.caption);
  const start = Math.max(0, item.clip.startSec - 0.35);
  const nearby = captions
    .map((c) => ({ ...c, text: cleanCaptionText(c.text) }))
    .filter((c) => c.text && !SKIP_LINE.test(c.text))
    .filter((c) => c.start >= start - 2.5 && c.start <= start + maxSec + 4)
    .sort((a, b) => a.start - b.start);

  if (!nearby.length) {
    if (wordCount(seed) > currentWords) {
      return {
        ...item,
        target: seed,
        clip: { ...item.clip, caption: seed },
      };
    }
    return item;
  }

  let i = nearby.findIndex((c) => c.start >= start - 1.4);
  if (i < 0) i = 0;
  // Prefer the line that actually contains the original target.
  const seedIdx = nearby.findIndex((c) => seed && c.text && seed.toLowerCase().includes(c.text.toLowerCase().slice(0, 24)));
  if (seedIdx >= 0 && seedIdx <= i) i = seedIdx;

  const parts: CaptionLine[] = [];
  let words = 0;
  for (let k = i; k < nearby.length; k++) {
    const line = nearby[k];
    const nextWords = words + wordCount(line.text);
    const end = line.start + Math.max(0.4, line.dur || 0);
    const spanStart = parts[0]?.start ?? line.start;
    if (parts.length && (nextWords > maxWords || end - spanStart > maxSec)) break;
    parts.push(line);
    words = nextWords;
    const joined = parts.map((p) => p.text).join(" ");
    const sentences = (joined.match(/[.!?]/g) ?? []).length;
    if (words >= minWords && (sentences >= 2 || words >= minWords + 6)) break;
  }

  if (!parts.length) return item;
  let text = parts
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (seed && !text.toLowerCase().startsWith(seed.toLowerCase().slice(0, 18)) && wordCount(seed) >= 6) {
    text = `${seed} ${text}`.replace(/\s+/g, " ").trim();
  }
  if (wordCount(text) < currentWords) return item;
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

export function enrichLesson(lesson: GeneratedLesson, captions: CaptionLine[]): GeneratedLesson {
  if (!captions.length) {
    return {
      ...lesson,
      speaking: lesson.speaking.map((item) => {
        const fromClip = cleanCaptionText(item.clip.caption);
        if (wordCount(fromClip) > wordCount(item.target)) {
          return { ...item, target: fromClip, clip: { ...item.clip, caption: fromClip } };
        }
        return item;
      }),
    };
  }
  return {
    ...lesson,
    speaking: lesson.speaking.map((item) => expandSpeakingFromCaptions(item, captions)),
  };
}
