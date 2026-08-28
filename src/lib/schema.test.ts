import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_PIPELINE,
  isReusableLesson,
  lessonLooksGarbled,
  type GeneratedLesson,
  type ListeningQuestion,
  type SpeakingQuestion,
} from "./schema.ts";

const GT = "&" + "gt;";
const QUOT = "&" + "quot;";

function listen(over: Partial<ListeningQuestion> = {}): ListeningQuestion {
  return {
    skill: "listening",
    level: "B1",
    videoId: "abc",
    clip: { startSec: 1, endSec: 4, caption: "We grew our business." },
    prompt: "What happened?",
    stem: "Listen",
    choices: ["Growth", "Loss"],
    answer: "Growth",
    explanationKo: "성장",
    explanationEn: "Growth",
    vocab: [],
    ...over,
  };
}

function speak(over: Partial<SpeakingQuestion> = {}): SpeakingQuestion {
  return {
    skill: "speaking",
    level: "B1",
    videoId: "abc",
    clip: { startSec: 1, endSec: 8, caption: "We grew our business 93 percent." },
    prompt: "Shadow",
    stem: "Repeat",
    target: "We grew our business 93 percent.",
    rubric: ["clear"],
    explanationKo: "따라 말하세요",
    explanationEn: "Shadow",
    vocab: [],
    ...over,
  };
}

function lesson(over: Partial<GeneratedLesson> = {}): GeneratedLesson {
  return {
    videoId: "abc",
    title: "Clip",
    listening: [listen()],
    speaking: [speak()],
    captionSource: "client",
    captionPipeline: CAPTION_PIPELINE,
    ...over,
  };
}

test("old cached lessons without the linear pipeline are not reused", () => {
  assert.equal(isReusableLesson(lesson({ captionPipeline: undefined })), false);
  assert.equal(isReusableLesson(lesson({ captionSource: "kome" })), false);
  assert.equal(isReusableLesson(lesson()), true);
});

test("lessons that still contain YouTube entities or speaker marks regenerate", () => {
  const dirtySpeak = lesson({
    speaking: [speak({ target: `${GT}${GT} Better than what analysts were expecting` })],
  });
  assert.equal(lessonLooksGarbled(dirtySpeak), true);
  assert.equal(isReusableLesson(dirtySpeak), false);

  const quoted = lesson({
    speaking: [speak({ clip: { startSec: 1, endSec: 4, caption: `say, ${QUOT}Is the revolution` } })],
  });
  assert.equal(lessonLooksGarbled(quoted), true);
  assert.equal(isReusableLesson(quoted), false);
});
