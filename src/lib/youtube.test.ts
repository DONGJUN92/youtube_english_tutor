import assert from "node:assert/strict";
import test from "node:test";
import { isFeaturedCatalogVideo, safeLoginNext } from "./youtube.ts";

test("featured catalog is guest-open, other videos are not", () => {
  assert.equal(isFeaturedCatalogVideo("jNQXAC9IVRw"), true);
  assert.equal(isFeaturedCatalogVideo("8jPQjjsBbIc"), true);
  assert.equal(isFeaturedCatalogVideo("dQw4w9WgXcQ"), false);
});

test("safeLoginNext only allows in-app watch paths", () => {
  assert.equal(safeLoginNext("/watch/jNQXAC9IVRw"), "/watch/jNQXAC9IVRw");
  assert.equal(safeLoginNext("/watch/jNQXAC9IVRw?t=12"), "/watch/jNQXAC9IVRw?t=12");
  assert.equal(safeLoginNext("//evil.example/watch/jNQXAC9IVRw"), undefined);
  assert.equal(safeLoginNext("https://example.com/watch/jNQXAC9IVRw"), undefined);
  assert.equal(safeLoginNext("/login"), undefined);
});
