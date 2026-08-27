import { getItem, type PlacementItem } from "@/data/placement-bank";
import type { CefrLevel } from "./schema";
import type { PlacementStep } from "./placement-engine";

export type SkillKey = "listening" | "speaking" | "vocab" | "sentence";
export type SkillTier = "low" | "mid" | "high";

export type SkillBand = {
  key: SkillKey;
  score: number;
  tier: SkillTier;
  nameKo: string;
  nameEn: string;
  labelKo: string;
  labelEn: string;
};

export type Persona = {
  id: string;
  portrait: string;
  titleKo: string;
  titleEn: string;
  blurbKo: string;
  blurbEn: string;
};

export type PlacementReport = {
  cefr: CefrLevel;
  persona: Persona;
  skills: SkillBand[];
  listening: number;
  speaking: number;
  oneLinerKo: string;
  oneLinerEn: string;
};

export const TIER_KO: Record<SkillTier, string> = { low: "초급", mid: "중급", high: "고급" };
export const TIER_EN: Record<SkillTier, string> = { low: "Beginner", mid: "Intermediate", high: "Advanced" };

const SKILL_NAME_KO: Record<SkillKey, string> = {
  listening: "듣기",
  speaking: "말하기",
  vocab: "어휘",
  sentence: "문장 이해",
};
const SKILL_NAME_EN: Record<SkillKey, string> = {
  listening: "Listening",
  speaking: "Speaking",
  vocab: "Vocabulary",
  sentence: "Sentences",
};

function tierOf(score: number): SkillTier {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function bit(score: number): 0 | 1 {
  return score >= 55 ? 1 : 0;
}

/**
 * 16 MECE types from 듣기×말하기×어휘×문장이해 (each 약/강).
 * Order: LSVG as a 4-bit index 0..15.
 */
const TYPES: Persona[] = [
  {
    id: "t0000",
    portrait: "menu",
    titleKo: "메뉴판을 손가락으로 고르는 사람",
    titleEn: "The photo-menu pointer",
    blurbKo: "네 칸이 아직 워밍업입니다. 사진과 손짓으로도 한 끼는 해결합니다.",
    blurbEn: "All four skills are warming up. A photo and a point still get lunch.",
  },
  {
    id: "t0001",
    portrait: "gate",
    titleKo: "빈칸은 맞히고 대화는 멈추는 사람",
    titleEn: "Fills the blank, freezes in talk",
    blurbKo: "문장 구조는 보이는데, 귀와 입이 따라오지 않습니다.",
    blurbEn: "Sentence shape is there. Ear and mouth are still catching up.",
  },
  {
    id: "t0010",
    portrait: "gate",
    titleKo: "단어는 아는데 문장이 안 나오는 사람",
    titleEn: "Knows the word, misses the sentence",
    blurbKo: "낱말은 모입니다. 연결만 한 박자 늦습니다.",
    blurbEn: "Words collect. The join arrives one beat late.",
  },
  {
    id: "t0011",
    portrait: "gate",
    titleKo: "책은 읽히고 귀는 아직인 사람",
    titleEn: "Reads it, does not yet hear it",
    blurbKo: "어휘와 문장은 됩니다. 실제 말의 속도만 남았습니다.",
    blurbEn: "Vocab and grammar hold. Live speed is the next hill.",
  },
  {
    id: "t0100",
    portrait: "dinner",
    titleKo: "입은 열리는데 알아듣지는 못하는 사람",
    titleEn: "Talks first, hears later",
    blurbKo: "용기는 이미 있습니다. 상대 말만 한 번 더 들어 보세요.",
    blurbEn: "Courage is there. The other person's line needs one more listen.",
  },
  {
    id: "t0101",
    portrait: "dinner",
    titleKo: "문법 들고 먼저 말하는 사람",
    titleEn: "Leads with grammar",
    blurbKo: "입과 문장은 됩니다. 듣기와 어휘를 붙이면 대화가 길어집니다.",
    blurbEn: "Mouth and structure work. Listening and vocab make the turn last.",
  },
  {
    id: "t0110",
    portrait: "dinner",
    titleKo: "단어 들고 분위기부터 살리는 사람",
    titleEn: "Saves the room with a word",
    blurbKo: "말은 나갑니다. 문장만 조금 구겨져도 자리는 살아 있습니다.",
    blurbEn: "The line goes out. Even a crumpled sentence can keep the room.",
  },
  {
    id: "t0111",
    portrait: "dinner",
    titleKo: "말은 되는데 자막이 필요한 사람",
    titleEn: "Speaks fine, still needs captions",
    blurbKo: "생산은 됩니다. 귀만 열리면 자막을 꺼도 됩니다.",
    blurbEn: "Output works. Open the ear and the captions can go.",
  },
  {
    id: "t1000",
    portrait: "subtitles",
    titleKo: "귀는 열렸는데 입이 안 떨어지는 사람",
    titleEn: "Hears it, cannot send it back",
    blurbKo: "이해는 됩니다. 한 줄만 밖으로 내보내면 됩니다.",
    blurbEn: "Comprehension is there. One line out is the next step.",
  },
  {
    id: "t1001",
    portrait: "subtitles",
    titleKo: "듣고 읽기는 되고 대답만 늦는 사람",
    titleEn: "Gets it, answers a beat late",
    blurbKo: "입력은 됩니다. 입만 따라오면 대화가 됩니다.",
    blurbEn: "Input works. When the mouth catches up, it becomes a talk.",
  },
  {
    id: "t1010",
    portrait: "subtitles",
    titleKo: "단어는 들리는데 문장이 안 붙는 사람",
    titleEn: "Catches words, drops the sentence",
    blurbKo: "듣기와 어휘는 됩니다. 문장만 꿰면 됩니다.",
    blurbEn: "Listening and vocab are in. Thread the sentence.",
  },
  {
    id: "t1011",
    portrait: "subtitles",
    titleKo: "이해는 되고 입이 준비 중인 사람",
    titleEn: "Understands, mouth still warming",
    blurbKo: "세 칸이 열려 있습니다. 말하기만 무대에 올리면 됩니다.",
    blurbEn: "Three doors are open. Speaking just needs the stage.",
  },
  {
    id: "t1100",
    portrait: "live",
    titleKo: "분위기는 살리는데 단어가 도망가는 사람",
    titleEn: "Keeps the room, loses the word",
    blurbKo: "듣고 말하는 리듬은 있습니다. 어휘와 문장만 두껍게.",
    blurbEn: "The listen-speak rhythm is there. Thicken vocab and structure.",
  },
  {
    id: "t1101",
    portrait: "live",
    titleKo: "말은 통하는데 어휘가 얇은 사람",
    titleEn: "Gets through, vocabulary runs thin",
    blurbKo: "대화는 됩니다. 단어만 조금 더 늘리면 농담까지 옵니다.",
    blurbEn: "The talk works. A thicker word bank brings the joke.",
  },
  {
    id: "t1110",
    portrait: "live",
    titleKo: "말은 되는데 문장이 구겨지는 사람",
    titleEn: "Gets it out, crumples the sentence",
    blurbKo: "듣기·말하기·어휘는 됩니다. 문장만 펴면 됩니다.",
    blurbEn: "Listen, speak, vocab: in. Smooth the sentence.",
  },
  {
    id: "t1111",
    portrait: "live",
    titleKo: "미드 드립을 실시간으로 받는 사람",
    titleEn: "Catches the sitcom punchline live",
    blurbKo: "네 칸이 열려 있습니다. 유튜브는 공부가 아니라 취미에 가깝습니다.",
    blurbEn: "All four doors are open. YouTube is closer to a hobby than homework.",
  },
];

function rate(steps: PlacementStep[], pred: (it: PlacementItem) => boolean): number {
  const subset = steps.filter((s) => {
    const it = getItem(s.itemId);
    return it ? pred(it) : false;
  });
  if (subset.length === 0) return 50;
  const avgDiff = subset.reduce((n, s) => n + s.difficulty, 0) / subset.length;
  const acc = subset.filter((s) => s.correct).length / subset.length;
  return Math.round(Math.min(99, 28 + acc * 48 + avgDiff * 2.4));
}

function skill(key: SkillKey, score: number): SkillBand {
  const tier = tierOf(score);
  return {
    key,
    score,
    tier,
    nameKo: SKILL_NAME_KO[key],
    nameEn: SKILL_NAME_EN[key],
    labelKo: `${SKILL_NAME_KO[key]} · ${TIER_KO[tier]}`,
    labelEn: `${SKILL_NAME_EN[key]} · ${TIER_EN[tier]}`,
  };
}

export function buildReport(
  steps: PlacementStep[],
  speakingScores: number[],
  cefr: CefrLevel,
): PlacementReport {
  const listening = rate(steps, (it) => it.skill === "listening");
  const vocab = rate(steps, (it) => it.skill === "vocab");
  const sentence = rate(steps, (it) => it.skill === "grammar" || it.skill === "reading");
  const speakAvg =
    speakingScores.length === 0
      ? Math.round(listening * 0.7)
      : Math.round(speakingScores.reduce((a, b) => a + b, 0) / speakingScores.length);

  const skills: SkillBand[] = [
    skill("listening", listening),
    skill("speaking", speakAvg),
    skill("vocab", vocab),
    skill("sentence", sentence),
  ];

  const idx =
    (bit(listening) << 3) | (bit(speakAvg) << 2) | (bit(vocab) << 1) | bit(sentence);
  const persona = TYPES[idx] ?? TYPES[0];
  const codeKo = skills.map((s) => s.labelKo).join(" · ");
  const codeEn = skills.map((s) => s.labelEn).join(" · ");

  return {
    cefr,
    persona,
    skills,
    listening,
    speaking: speakAvg,
    oneLinerKo: `${persona.titleKo}. ${codeKo}.`,
    oneLinerEn: `${persona.titleEn}. ${codeEn}.`,
  };
}

export function personaPortrait(idOrPortrait: string) {
  const portrait =
    TYPES.find((t) => t.id === idOrPortrait)?.portrait ??
    (["menu", "gate", "subtitles", "dinner", "live"].includes(idOrPortrait) ? idOrPortrait : "menu");
  return `/personas/${portrait}.jpg`;
}

const CARD_W = 1080;
const CARD_H = 1350;
const PAGES = 4;
const RED = "#e50914";
const BG = "#141416";
const FG = "#fafafa";
const MUTED = "#a1a1aa";
const ELEV = "#1c1c20";
const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const latin = /[A-Za-z]/.test(text) && text.includes(" ");
  if (latin) {
    let line = "";
    for (const w of text.split(/\s+/)) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function loadPortrait(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("portrait"));
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

function drawChrome(ctx: CanvasRenderingContext2D, locale: "ko" | "en") {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 28, CARD_H);
  ctx.fillStyle = MUTED;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(locale === "ko" ? "TubeShadow · 레벨 테스트" : "TubeShadow · Placement", 72, 72);
}

function drawPage(
  ctx: CanvasRenderingContext2D,
  report: PlacementReport,
  locale: "ko" | "en",
  page: number,
  portrait: HTMLImageElement | null,
) {
  drawChrome(ctx, locale);
  const ko = locale === "ko";
  const title = ko ? report.persona.titleKo : report.persona.titleEn;
  const blurb = ko ? report.persona.blurbKo : report.persona.blurbEn;

  if (page === 0) {
    ctx.save();
    round(ctx, 72, 200, 360, 360, 36);
    ctx.clip();
    if (portrait) ctx.drawImage(portrait, 72, 200, 360, 360);
    else {
      ctx.fillStyle = ELEV;
      ctx.fillRect(72, 200, 360, 360);
    }
    ctx.restore();

    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(ko ? "지금 이런 영어" : "Your English, right now", 460, 230);

    ctx.fillStyle = FG;
    ctx.font = `600 48px ${FONT}`;
    const titleLines = wrap(ctx, title, 540);
    let ty = 300;
    for (const line of titleLines.slice(0, 5)) {
      ctx.fillText(line, 460, ty);
      ty += 62;
    }

    ctx.fillStyle = MUTED;
    ctx.font = `400 32px ${FONT}`;
    const blurbLines = wrap(ctx, blurb, 936);
    let by = 640;
    for (const line of blurbLines.slice(0, 5)) {
      ctx.fillText(line, 72, by);
      by += 48;
    }

    ctx.fillStyle = ELEV;
    round(ctx, 72, 980, 936, 240, 28);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(ko ? "네 칸의 영어" : "Four skills", 104, 1036);
    ctx.fillStyle = FG;
    ctx.font = `600 28px ${FONT}`;
    const code = report.skills.map((s) => (ko ? `${s.nameKo} ${TIER_KO[s.tier]}` : `${s.nameEn} ${TIER_EN[s.tier]}`)).join("  ·  ");
    const codeLines = wrap(ctx, code, 860);
    let cy = 1090;
    for (const line of codeLines.slice(0, 3)) {
      ctx.fillText(line, 104, cy);
      cy += 42;
    }
    return;
  }

  if (page === 1) {
    ctx.fillStyle = FG;
    ctx.font = `600 52px ${FONT}`;
    ctx.fillText(ko ? "네 칸, 세 단계" : "Four skills, three bands", 72, 220);
    ctx.fillStyle = MUTED;
    ctx.font = `400 28px ${FONT}`;
    ctx.fillText(ko ? "초급 · 중급 · 고급이 서로 독립입니다." : "Beginner, intermediate, advanced — independent.", 72, 280);

    const cells = [
      { x: 72, y: 360 },
      { x: 552, y: 360 },
      { x: 72, y: 820 },
      { x: 552, y: 820 },
    ];
    report.skills.forEach((s, i) => {
      const c = cells[i]!;
      ctx.fillStyle = ELEV;
      round(ctx, c.x, c.y, 456, 420, 32);
      ctx.fill();
      ctx.fillStyle = MUTED;
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(ko ? s.nameKo : s.nameEn, c.x + 36, c.y + 72);
      ctx.fillStyle = FG;
      ctx.font = `600 64px ${FONT}`;
      ctx.fillText(ko ? TIER_KO[s.tier] : TIER_EN[s.tier], c.x + 36, c.y + 180);
      ctx.fillStyle = "#2a2a30";
      round(ctx, c.x + 36, c.y + 320, 384, 16, 8);
      ctx.fill();
      ctx.fillStyle = RED;
      round(ctx, c.x + 36, c.y + 320, Math.max(16, (384 * s.score) / 100), 16, 8);
      ctx.fill();
    });
    return;
  }

  if (page === 2) {
    ctx.fillStyle = FG;
    ctx.font = `600 52px ${FONT}`;
    const head = ko ? "한 줄로 말하면" : "In one line";
    ctx.fillText(head, 72, 220);
    ctx.fillStyle = FG;
    ctx.font = `600 40px ${FONT}`;
    const one = ko ? report.oneLinerKo : report.oneLinerEn;
    let oy = 320;
    for (const line of wrap(ctx, one, 936).slice(0, 6)) {
      ctx.fillText(line, 72, oy);
      oy += 56;
    }
    ctx.fillStyle = ELEV;
    round(ctx, 72, 760, 936, 420, 32);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(ko ? "다음에 붙일 것" : "What to add next", 108, 832);
    ctx.fillStyle = FG;
    ctx.font = `400 32px ${FONT}`;
    const lows = report.skills.filter((s) => s.tier !== "high");
    const tip =
      lows.length === 0
        ? ko
          ? "네 칸이 열려 있습니다. 자막 없이 한 편 가 보세요."
          : "All four are open. Try one episode without captions."
        : ko
          ? lows.map((s) => `${s.nameKo}을 한 칸 올리기`).join(". ") + "."
          : "Raise " + lows.map((s) => s.nameEn.toLowerCase()).join(", ") + " by one band.";
    let ty = 900;
    for (const line of wrap(ctx, tip, 860).slice(0, 5)) {
      ctx.fillText(line, 108, ty);
      ty += 48;
    }
    return;
  }

  ctx.fillStyle = FG;
  ctx.font = `600 48px ${FONT}`;
  let fy = 280;
  for (const line of wrap(ctx, title, 936).slice(0, 4)) {
    ctx.fillText(line, 72, fy);
    fy += 64;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `400 32px ${FONT}`;
  const cta = ko ? "유튜브로 듣고, 따라 말하고, 영어가 는다." : "Listen. Shadow. Speak — from real YouTube.";
  let cy2 = fy + 40;
  for (const line of wrap(ctx, cta, 936)) {
    ctx.fillText(line, 72, cy2);
    cy2 += 48;
  }
  ctx.fillStyle = RED;
  round(ctx, 72, 1080, 420, 88, 44);
  ctx.fill();
  ctx.fillStyle = FG;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText("TubeShadow", 148, 1136);
}

export async function downloadReportCard(report: PlacementReport, locale: "ko" | "en") {
  if (typeof document !== "undefined") {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }
  const portrait = await loadPortrait(personaPortrait(report.persona.id));
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H * PAGES;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  for (let i = 0; i < PAGES; i++) {
    ctx.save();
    ctx.translate(0, i * CARD_H);
    drawPage(ctx, report, locale, i, portrait);
    ctx.restore();
  }
  const slug = (locale === "ko" ? report.persona.titleKo : report.persona.titleEn)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `tubeshadow-${slug || report.persona.id}.png`;
  a.click();
}
