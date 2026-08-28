import assert from "node:assert/strict";
import test from "node:test";
import type { CaptionLine } from "./caption-parse.ts";
import type { SpeakingQuestion } from "./schema.ts";
import {
  cleanCaptionText,
  expandSpeakingFromCaptions,
  listenFocusForIndex,
  listenItemKey,
  wordCount,
} from "./lesson-pedagogy.ts";
import { buildVocabQuiz, extractUsefulSentences, extractVocabBank } from "./us-english.ts";

const captions: CaptionLine[] = [
  { start: 13.24, dur: 2.56, text: "A few years ago, I broke into my own house." },
  { start: 16.88, dur: 1.216, text: "I had just driven home," },
  { start: 18.12, dur: 2.536, text: "it was around midnight in the dead of Montreal winter," },
  { start: 20.68, dur: 2.296, text: "I had been visiting my friend, Jeff, across town," },
  { start: 23, dur: 4.776, text: "and the thermometer on the front porch read minus 40 degrees --" },
];

const GT = "&" + "gt;";
const QUOT = "&" + "quot;";

function shortItem(): SpeakingQuestion {
  return {
    skill: "speaking",
    level: "B1",
    videoId: "8jPQjjsBbIc",
    clip: {
      startSec: 15,
      endSec: 20,
      caption: "A few years ago, I broke into my own house.",
    },
    prompt: "Shadow the opening line.",
    stem: "Keep the joke dry.",
    target: "A few years ago, I broke into my own house.",
    rubric: ["Clear broke into"],
    explanationKo: "또렷하게",
    explanationEn: "Land broke into",
    vocab: [],
  };
}

test("listening keys stay unique so answers cannot leak across items", () => {
  const a = listenItemKey({ prompt: "What did he do?", clip: { startSec: 15, endSec: 20, caption: "x" } });
  const b = listenItemKey({ prompt: "What does cortisol do?", clip: { startSec: 146, endSec: 153, caption: "y" } });
  assert.notEqual(a, b);
  const picks: Record<string, string> = { [a]: "He broke into his own house" };
  assert.equal(picks[b], undefined);
});

test("listen focus cycles gist → detail → inference", () => {
  assert.equal(listenFocusForIndex(0), "gist");
  assert.equal(listenFocusForIndex(1), "detail");
  assert.equal(listenFocusForIndex(2), "inference");
});

test("short shadowing stretches into connected speech from captions", () => {
  const expanded = expandSpeakingFromCaptions(shortItem(), captions);
  assert.ok(wordCount(expanded.target) >= 18, expanded.target);
  assert.match(expanded.target, /broke into my own house/i);
  assert.match(expanded.target, /midnight/i);
  assert.ok(expanded.clip.endSec - expanded.clip.startSec > 5);
});

test("vocab bank prefers US high-frequency chunks that appear in the script", () => {
  const bank = extractVocabBank(captions, [{ word: "broke into", meaningKo: "침입하다", meaningEn: "entered by force", ipa: "/x/" }]);
  const words = bank.map((b) => b.word.toLowerCase());
  assert.ok(words.includes("broke into") || words.includes("a few years"));
  assert.ok(bank.some((b) => /midnight|winter|house|around/.test(b.word)));
  const quiz = buildVocabQuiz(bank, 6);
  assert.ok(quiz.length >= 3);
  for (const q of quiz) {
    assert.equal(q.choices.length, 4);
    assert.ok(q.choices.includes(q.answer));
    const unique = new Set(q.choices);
    assert.equal(unique.size, 4);
  }
});

test("cleanCaptionText decodes entities and strips speaker marks", () => {
  assert.equal(cleanCaptionText(`${GT}${GT} Better than what analysts were`), "Better than what analysts were");
  assert.equal(
    cleanCaptionText(`then you would say, ${QUOT}Is the revolution`),
    'then you would say, "Is the revolution',
  );
  assert.equal(cleanCaptionText(`${GT}${GT} Okay, that's not Nobody Okay, great.`), "Okay, that's not Nobody Okay, great.");
  assert.doesNotMatch(cleanCaptionText(`${GT}${GT} So the response has been very positive`), /&[a-z]+;/);
});

test("shadowing does not glue interviewer >> lines onto a curated two-sentence target", () => {
  const karpCaptions: CaptionLine[] = [
    { start: 0, dur: 3.6, text: "We grew our business 93% 93." },
    { start: 2.88, dur: 1.2, text: `${GT}${GT} Better than what analysts were` },
    { start: 3.6, dur: 2.36, text: "expecting." },
    { start: 4.08, dur: 4.36, text: `${GT}${GT} Okay, that's not Nobody Okay, great.` },
    { start: 5.96, dur: 4.28, text: "Forget Kim sensors. No business in to my" },
  ];
  const item: SpeakingQuestion = {
    skill: "speaking",
    level: "B1",
    videoId: "8t9kLTJfIn8",
    clip: { startSec: 0, endSec: 8, caption: "We grew our business 93%. Better than what analysts were expecting." },
    prompt: "Shadow the growth line.",
    stem: "Hit 93%.",
    target: "We grew our business 93%. Better than what analysts were expecting.",
    rubric: [],
    explanationKo: "",
    explanationEn: "",
    vocab: [],
  };
  const expanded = expandSpeakingFromCaptions(item, karpCaptions);
  assert.equal(expanded.target, "We grew our business 93%. Better than what analysts were expecting.");
  assert.doesNotMatch(expanded.target, /&[a-z]+;/);
  assert.doesNotMatch(expanded.target, />>/);
  assert.doesNotMatch(expanded.target, /Forget Kim/);
});

test("useful sentences never keep HTML entities or speaker marks", () => {
  const dirty: CaptionLine[] = [
    { start: 17.76, dur: 3.16, text: `then you would say, ${QUOT}Is the revolution` },
    { start: 19.32, dur: 4.08, text: `growing in a way that's profitable?${QUOT} Our` },
    { start: 20.92, dur: 4.4, text: "adjusted free cash flow margins are 63%." },
    { start: 65, dur: 3.28, text: `${GT}${GT} So the response has been very positive` },
    { start: 66.4, dur: 4.08, text: "since 4 weeks ago when you talked about" },
    { start: 68.28, dur: 3.4, text: "the AI sovereignty debate, customers" },
    { start: 70.48, dur: 3.28, text: "have been responding positively." },
  ];
  const sentences = extractUsefulSentences(dirty, 8);
  assert.ok(sentences.length >= 1, JSON.stringify(sentences));
  for (const s of sentences) {
    assert.doesNotMatch(s.text, /&[a-z]+;/);
    assert.doesNotMatch(s.text, />>/);
  }
  assert.ok(sentences.some((s) => /free cash flow margins are 63%/.test(s.text)));
});
