import assert from "node:assert/strict";
import test from "node:test";
import { asIntSeconds, asSeconds, playRange } from "./clip-timing.ts";

test("asSeconds keeps YouTube fractional duration 340.32", () => {
  assert.equal(asSeconds(340.32), 340.32);
  assert.equal(asSeconds("340.32"), 340.32);
  assert.equal(asSeconds(-1), 0);
  assert.equal(asSeconds("nope", 12), 12);
});

test("asIntSeconds rounds 340.32 so INTEGER columns do not reject it", () => {
  assert.equal(asIntSeconds(340.32), 340);
  assert.equal(asIntSeconds("340.32"), 340);
  assert.equal(asIntSeconds(undefined), 0);
});

test("playRange still leads the clip start", () => {
  const range = playRange(13.2, 23.1);
  assert.ok(range.start < 13.2);
  assert.ok(range.end >= 23.1);
});
