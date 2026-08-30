import type { CefrLevel, ListeningQuestion, SpeakingQuestion } from "./schema.ts";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1"];

export function nudgeCefr(level: CefrLevel, delta: number): CefrLevel {
  const i = CEFR_ORDER.indexOf(level);
  const next = Math.max(0, Math.min(CEFR_ORDER.length - 1, (i < 0 ? 1 : i) + delta));
  return CEFR_ORDER[next]!;
}

export function shadowPassScore(level: CefrLevel): number {
  if (level === "A1") return 55;
  if (level === "A2") return 62;
  if (level === "B1") return 70;
  if (level === "B2") return 78;
  return 85;
}

export function chunkShadowLine(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  const parts = clean
    .split(/(?<=[,;:!?])\s+|\s+(?=and |but |so |because |that |which |when )/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 4).join(" / ");
  const words = clean.split(" ");
  if (words.length < 10) return clean;
  const mid = Math.ceil(words.length / 2);
  return `${words.slice(0, mid).join(" ")} / ${words.slice(mid).join(" ")}`;
}

export function blankTwoWords(text: string): { blanked: string; hidden: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  const idxs = words
    .map((w, i) => ({ w, i, score: w.replace(/[^a-zA-Z]/g, "").length }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  if (!idxs.length) return { blanked: text, hidden: [] };
  const hidden: string[] = [];
  const out = words.map((w, i) => {
    if (!idxs.includes(i)) return w;
    hidden.push(w.replace(/[^a-zA-Z'-]/g, ""));
    return "______";
  });
  return { blanked: out.join(" "), hidden };
}

export function wrongListenExplain(locale: "ko" | "en", picked: string, answer: string): string {
  if (locale === "ko") return `고른 답은 “${picked}”입니다. 정답은 “${answer}”이고, 근거는 아래 문장입니다.`;
  return `You chose “${picked}”. The answer is “${answer}”. The evidence line is below.`;
}

export function listenToShadowItem(item: ListeningQuestion): SpeakingQuestion {
  return {
    skill: "speaking",
    level: item.level,
    videoId: item.videoId,
    clip: item.clip,
    prompt: "Shadow the line you missed in listening.",
    stem: "Say the evidence line in time with the clip.",
    target: item.clip.caption,
    rubric: ["connected speech", "timing"],
    explanationKo: "듣기에서 놓친 구간을 입으로 고정합니다.",
    explanationEn: "Lock in the listening miss by shadowing it.",
    vocab: item.vocab,
  };
}

export function expressionCounts(captions: string[], min = 2): { phrase: string; count: number }[] {
  const bag = new Map<string, number>();
  for (const raw of captions) {
    const words = raw.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      if (phrase.length < 7) continue;
      bag.set(phrase, (bag.get(phrase) ?? 0) + 1);
    }
  }
  return [...bag.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phrase, count]) => ({ phrase, count }));
}

export const TODAY_GOAL = 3;
