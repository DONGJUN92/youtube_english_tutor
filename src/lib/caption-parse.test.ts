import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTimedLinesFromUnknown,
  parseCaptionBody,
  parseTimedtextList,
  sanitizeCaptionLines,
  timedtextCandidateUrls,
  looksLikeRealTimestamps,
} from "./caption-parse.ts";

test("parses json3 caption events", () => {
  const lines = parseCaptionBody(
    JSON.stringify({
      events: [
        { tStartMs: 1200, dDurationMs: 1800, segs: [{ utf8: "Hello " }, { utf8: "there" }] },
        { tStartMs: 4000, dDurationMs: 900, segs: [{ utf8: "♪" }] },
      ],
    }),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, "Hello there");
  assert.equal(lines[0]?.start, 1.2);
});

test("parses timedtext xml and list tracks", () => {
  const lines = parseCaptionBody(
    `<transcript><text start="1.5" dur="2.0">We're live</text></transcript>`,
  );
  assert.equal(lines[0]?.text, "We're live");
  assert.equal(lines[0]?.start, 1.5);
  const tracks = parseTimedtextList(
    `<transcript_list><track lang_code="en" kind="asr" name=""/><track lang_code="ko" name="Korean"/></transcript_list>`,
  );
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0]?.lang, "en");
  assert.equal(tracks[0]?.kind, "asr");
});

test("parses srv3 timedtext used by the Android player", () => {
  const lines = parseCaptionBody(
    `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1500" d="2100">Hello there</p><p t="4000" d="900">Okay</p></body></timedtext>`,
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.text, "Hello there");
  assert.equal(lines[0]?.start, 1.5);
  assert.equal(lines[0]?.dur, 2.1);
});

test("parses vtt and sanitizes client payloads", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Good morning

00:00:04.000 --> 00:00:06.000
<c>everyone</c>`;
  const lines = parseCaptionBody(vtt);
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.text, "everyone");
  const clean = sanitizeCaptionLines([
    { start: 1, dur: 2, text: "  ok  " },
    { start: -1, dur: 2, text: "bad" },
    { start: 1, dur: 2, text: "♪" },
    { start: 1, dur: 2, text: "x".repeat(600) },
  ]);
  assert.deepEqual(clean, [{ start: 1, dur: 2, text: "ok" }]);
});

test("extracts innertube transcript segments", () => {
  const lines = extractTimedLinesFromUnknown({
    actions: [
      {
        updateEngagementPanelAction: {
          content: {
            transcriptRenderer: {
              body: {
                transcriptSegmentListRenderer: {
                  initialSegments: [
                    {
                      transcriptSegmentRenderer: {
                        startMs: "1500",
                        endMs: "3200",
                        snippet: { runs: [{ text: "We grew " }, { text: "the business" }] },
                      },
                    },
                    {
                      transcriptSegmentRenderer: {
                        startMs: "4000",
                        endMs: "6100",
                        snippet: { simpleText: "Okay great" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.text, "We grew the business");
  assert.equal(lines[0]?.start, 1.5);
  assert.equal(lines[1]?.text, "Okay great");
});

test("builds browser timedtext urls for auto english tracks", () => {
  const urls = timedtextCandidateUrls("8t9kLTJfIn8", [{ lang: "en", kind: "asr" }]);
  assert.ok(urls.some((u) => u.includes("lang=en") && u.includes("kind=asr") && u.includes("fmt=json3")));
  assert.ok(urls.some((u) => u.includes("fmt=srv3")));
});

test("rejects evenly spaced fake timestamps", () => {
  const fake = Array.from({ length: 20 }, (_, i) => ({ start: i * 1.8, dur: 1.7, text: `line ${i} hello world` }));
  assert.equal(looksLikeRealTimestamps(fake), false);
  const real = [
    0.2, 2.1, 3.0, 7.4, 8.1, 12.8, 13.4, 18.9, 21.0, 21.6, 26.3, 29.9, 30.4, 35.1,
  ].map((start, i) => ({ start, dur: 1.2, text: `cue ${i} something said` }));
  assert.equal(looksLikeRealTimestamps(real), true);
});

test("karp bundled captions have real irregular timestamps", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(new URL("../data/caption-cache/8t9kLTJfIn8.json", import.meta.url), "utf8"));
  const lines = sanitizeCaptionLines(raw.captions);
  assert.ok(lines.length >= 100);
  assert.equal(lines[0]?.start, 0);
  assert.ok((lines[1]?.start ?? 0) > 2);
  assert.ok(looksLikeRealTimestamps(lines));
});
