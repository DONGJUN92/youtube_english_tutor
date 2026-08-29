import assert from "node:assert/strict";
import test from "node:test";
import { learnerItemBrief, lessonLevelFromSettings, lessonMatchesLearner } from "./learner-brief.ts";
import { relativeTimeFrom } from "./i18n.ts";

test("practice CEFR from settings beats placement when both exist", () => {
  assert.equal(lessonLevelFromSettings({ preferredCefr: "B1", cefrLevel: "A2" }), "B1");
  assert.equal(lessonLevelFromSettings({ preferredCefr: null, cefrLevel: "C1" }), "C1");
  assert.equal(lessonLevelFromSettings({}), "A2");
});

test("item brief names the actual age band and CEFR from settings", () => {
  const child = learnerItemBrief("child", "A1");
  assert.match(child, /age band[\s\S]*child/i);
  assert.match(child, /CEFR[\s\S]*A1/);
  assert.doesNotMatch(child, /\badult\b.*do not ignore/i);
  const adult = learnerItemBrief("adult", "B2");
  assert.match(adult, /adult/);
  assert.match(adult, /B2/);
});

test("cached lessons miss when settings changed", () => {
  const lesson = { learnerAge: "teen", learnerLevel: "A2", listening: [{ level: "A2" }] };
  assert.equal(lessonMatchesLearner(lesson, "teen", "A2"), true);
  assert.equal(lessonMatchesLearner(lesson, "adult", "A2"), false);
  assert.equal(lessonMatchesLearner(lesson, "teen", "B1"), false);
  assert.equal(lessonMatchesLearner({ listening: [{ level: "A2" }] }, "teen", "A2"), false);
});

test("relative time is from the saved timestamp, not clip seconds", () => {
  const now = Date.parse("2026-08-30T00:00:00Z");
  assert.equal(relativeTimeFrom("2026-08-29T23:59:30Z", "ko", now), "방금");
  assert.equal(relativeTimeFrom("2026-08-29T21:00:00Z", "ko", now), "3시간 전");
  assert.equal(relativeTimeFrom("2026-08-28T00:00:00Z", "ko", now), "2일 전");
  assert.equal(relativeTimeFrom("2026-06-30T00:00:00Z", "ko", now), "2달 전");
  assert.equal(relativeTimeFrom("2026-08-29T21:00:00Z", "en", now), "3h ago");
});
