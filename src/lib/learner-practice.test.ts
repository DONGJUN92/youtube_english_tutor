import assert from "node:assert/strict";
import test from "node:test";
import {
  blankTwoWords,
  chunkShadowLine,
  expressionCounts,
  listenToShadowItem,
  nudgeCefr,
  shadowPassScore,
} from "./learner-practice.ts";

test("CEFR nudge stays on the scale", () => {
  assert.equal(nudgeCefr("B1", -1), "A2");
  assert.equal(nudgeCefr("A1", -1), "A1");
  assert.equal(nudgeCefr("C1", 1), "C1");
});

test("pass score rises with CEFR", () => {
  assert.ok(shadowPassScore("A1") < shadowPassScore("B1"));
  assert.ok(shadowPassScore("B1") < shadowPassScore("C1"));
});

test("chunk and blank helpers keep spoken words", () => {
  const line = "You know, people often talk about eliminating poverty.";
  assert.match(chunkShadowLine(line), /\//);
  const blank = blankTwoWords(line);
  assert.match(blank.blanked, /______/);
  assert.ok(blank.hidden.length >= 1);
});

test("listening miss becomes a shadowing item with the same clip", () => {
  const item = listenToShadowItem({
    skill: "listening",
    level: "B1",
    videoId: "abc",
    clip: { startSec: 8, endSec: 16, caption: "I think the real issue is energy." },
    prompt: "p",
    stem: "s",
    choices: ["a", "b", "c", "d"],
    answer: "a",
    explanationKo: "k",
    explanationEn: "e",
    vocab: [],
  });
  assert.equal(item.skill, "speaking");
  assert.equal(item.clip.startSec, 8);
  assert.match(item.target, /energy/);
});

test("repeated two-word chunks are counted", () => {
  const counts = expressionCounts(["kind of waiting", "kind of slow", "sort of ok", "kind of waiting"], 2);
  assert.ok(counts.length >= 1);
  assert.ok(counts.some((c) => c.phrase.includes("kind") && c.count >= 2));
});
