import assert from "node:assert/strict";
import test from "node:test";
import { buildLessonHarness, renderLessonHarnessPrompt } from "./lesson-harness.ts";

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
