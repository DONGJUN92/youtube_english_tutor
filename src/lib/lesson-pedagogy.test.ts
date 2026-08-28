import assert from "node:assert/strict";
import test from "node:test";
import type { CaptionLine } from "./caption-parse.ts";
import type { SpeakingQuestion } from "./schema.ts";
import {
  expandSpeakingFromCaptions,
  listenFocusForIndex,
  listenItemKey,
  wordCount,
} from "./lesson-pedagogy.ts";
import { buildVocabQuiz, extractVocabBank } from "./us-english.ts";

const captions: CaptionLine[] = [
  { start: 13.24, dur: 2.56, text: "A few years ago, I broke into my own house." },
  { start: 16.88, dur: 1.216, text: "I had just driven home," },
  { start: 18.12, dur: 2.536, text: "it was around midnight in the dead of Montreal winter," },
  { start: 20.68, dur: 2.296, text: "I had been visiting my friend, Jeff, across town," },
  { start: 23, dur: 4.776, text: "and the thermometer on the front porch read minus 40 degrees --" },
];

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
