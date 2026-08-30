import assert from "node:assert/strict";
import test from "node:test";
import { alignLessonWithHarness, buildLessonHarness, renderLessonHarnessPrompt } from "./lesson-harness.ts";

const CAPTIONS = [
  { start: 1, dur: 3.2, text: "You know, people often talk about eliminating poverty." },
  { start: 4.4, dur: 3.5, text: "I think the real issue is actually energy and food." },
  { start: 8.1, dur: 4.0, text: "Because we spent 40 percent of the budget on that." },
  { start: 12.2, dur: 3.8, text: "So that is why Jensen and I are in the same room." },
  { start: 16.4, dur: 4.2, text: "We should probably move faster than last year." },
  { start: 21.0, dur: 3.6, text: "It seems like the market is kind of waiting." },
  { start: 25.0, dur: 4.5, text: "Honestly I believe this will take maybe two years." },
  { start: 30.0, dur: 3.2, text: "Called it the solar launch in 2025." },
  { start: 34.0, dur: 4.0, text: "That's why we named the project after the city." },
  { start: 38.5, dur: 3.5, text: "We can ship this if we stay specific." },
];

test("harness preselects gist, detail, inference, and shadow clips", () => {
  const h = buildLessonHarness(CAPTIONS, "B1");
  assert.equal(h.listening.length, 3);
  assert.deepEqual(h.listening.map((c) => c.role), ["gist", "detail", "inference"]);
  assert.ok(h.speaking.length >= 1);
  assert.ok(h.listening.every((c) => c.caption.split(" ").length >= 6 && c.endSec > c.startSec));
  assert.ok(h.vocabHints.length >= 3);
});

test("harness prompt injects settings and harvest slots, not a hardcoded adult A2", () => {
  const h = buildLessonHarness(CAPTIONS, "A1");
  const { system, user } = renderLessonHarnessPrompt({
    videoId: "rOkUAYkBWV0",
    title: "Elon and Jensen",
    ageBand: "teen",
    level: "A1",
    windowStartSec: 0,
    windowEndSec: 300,
    harness: h,
  });
  assert.match(system, /teen/);
  assert.match(system, /A1/);
  assert.match(system, /L1/);
  assert.match(user, /HARVEST listening/);
  assert.match(user, /Practice CEFR: A1/);
  assert.match(user, /Age band: teen/);
});

test("alignLessonWithHarness copies harvest clips and coerces 4 choices", () => {
  const h = buildLessonHarness(CAPTIONS, "B1");
  const aligned = alignLessonWithHarness(
    {
      title: "Talk",
      listening: [
        {
          prompt: "Main idea?",
          stem: "Listen",
          choices: ["Energy and food"],
          answer: "Energy and food",
          explanationKo: "에너지",
          explanationEn: "energy",
          vocab: [{ word: "energy" }],
        },
      ],
      speaking: [{ prompt: "Shadow" }],
    },
    {
      videoId: "rOkUAYkBWV0",
      title: "Elon and Jensen",
      ageBand: "teen",
      level: "A2",
      harness: h,
    },
  ) as {
    listening: Array<{ clip: { caption: string; startSec: number }; choices: string[]; answer: string; vocab: unknown[] }>;
    speaking: Array<{ target: string; clip: { caption: string } }>;
    learnerLevel: string;
  };
  assert.equal(aligned.listening.length, h.listening.length);
  assert.equal(aligned.listening[0]!.clip.caption, h.listening[0]!.caption);
  assert.equal(aligned.listening[0]!.clip.startSec, h.listening[0]!.startSec);
  assert.equal(aligned.listening[0]!.choices.length, 4);
  assert.ok(aligned.listening[0]!.choices.includes(aligned.listening[0]!.answer));
  assert.ok(aligned.listening[0]!.vocab.length >= 4);
  assert.equal(aligned.speaking[0]!.target, h.speaking[0]!.caption);
  assert.equal(aligned.learnerLevel, "A2");
});

test("alignLessonWithHarness leaves empty completions alone so the writer is retried", () => {
  const h = buildLessonHarness(CAPTIONS, "B1");
  const empty = alignLessonWithHarness(
    { title: "x" },
    { videoId: "rOkUAYkBWV0", title: "T", ageBand: "adult", level: "B1", harness: h },
  );
  assert.deepEqual(empty, { title: "x" });
});
