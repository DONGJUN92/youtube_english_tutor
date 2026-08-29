import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTimedLinesFromUnknown,
  parseCaptionBody,
  parseTimedtextList,
  sanitizeCaptionLines,
  timedtextCandidateUrls,
  timedtextFetchVariants,
  collectTimedtextUrls,
  isYoutubeTimedtextUrl,
  looksLikeRealTimestamps,
  decodeHtmlEntities,
  isSpeakerChangeLine,
  cleanCaptionText,
  stitchOverlappingCaptions,
} from "./caption-parse.ts";

const GT = "&" + "gt;";
const QUOT = "&" + "quot;";
const AMP = "&" + "amp;";
const APOS = "&#39;";

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

test("parses srv3 word-level s tags without smashing tokens", () => {
  const lines = parseCaptionBody(
    `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="2100"><s t="0">We</s><s t="200">grew</s><s t="400">our</s><s t="700">business</s></p></body></timedtext>`,
  );
  assert.equal(lines[0]?.text, "We grew our business");
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

test("decodes YouTube HTML entities and double-encoded amp", () => {
  assert.equal(decodeHtmlEntities(`${GT}${GT} Better than what analysts were`), ">> Better than what analysts were");
  assert.equal(decodeHtmlEntities(`say, ${QUOT}Is the revolution`), 'say, "Is the revolution');
  assert.equal(decodeHtmlEntities(`${AMP}gt; Okay`), "> Okay");
  assert.equal(decodeHtmlEntities(`I${APOS}m here`), "I'm here");
  assert.equal(isSpeakerChangeLine(`${GT}${GT} Okay, that's not`), true);
  assert.equal(isSpeakerChangeLine("We grew our business 93%."), false);
});

test("sanitize decodes bundled Karp captions and stitches ASR windows", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(new URL("../data/caption-cache/8t9kLTJfIn8.json", import.meta.url), "utf8"));
  const lines = sanitizeCaptionLines(raw.captions);
  assert.ok(lines.length >= 40, `stitched ${lines.length}`);
  assert.equal(lines[0]?.start, 0);
  assert.ok(looksLikeRealTimestamps(lines));
  const blob = lines.map((l) => l.text).join("\n");
  assert.equal(blob.includes(GT), false, "named gt entity must be decoded");
  assert.equal(blob.includes(QUOT), false, "named quot entity must be decoded");
  assert.doesNotMatch(blob, />>/);
  assert.match(blob, /Better than what analysts were expecting/);
  assert.match(blob, /say, "Is the revolution/);
  assert.match(lines[0]?.text ?? "", /We grew our business 93%/);
});

test("bundled Upstage captions keep real timestamps", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(new URL("../data/caption-cache/_oU3NKm6L2g.json", import.meta.url), "utf8"));
  const lines = sanitizeCaptionLines(raw.captions);
  assert.ok(lines.length >= 40, `upstage ${lines.length}`);
  assert.ok(looksLikeRealTimestamps(lines));
  assert.match(lines.map((l) => l.text).join(" "), /hello, Lisa/i);
});

test("stitches rolling ASR windows and splits on speaker change", () => {
  const stitched = stitchOverlappingCaptions([
    { start: 0, dur: 2.5, text: "Hello there everyone" },
    { start: 1.0, dur: 2.5, text: "there everyone today" },
    { start: 2.4, dur: 1.8, text: `${GT}${GT} What do you think` },
  ]);
  assert.equal(stitched[0]?.text, "Hello there everyone today");
  assert.equal(stitched[1]?.text, "What do you think");
  assert.equal(stitched.length, 2);
});

test("TED-style quotes decode and professional cues stay many lines", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(new URL("../data/caption-cache/8jPQjjsBbIc.json", import.meta.url), "utf8"));
  const lines = sanitizeCaptionLines(raw.captions);
  assert.ok(lines.length >= 80, `ted lines ${lines.length}`);
  const blob = lines.map((l) => l.text).join("\n");
  assert.equal(blob.includes(QUOT), false);
  assert.match(blob, /"I just got your lab work back/);
  assert.equal(cleanCaptionText(`${GT}${GT} Okay`), "Okay");
});

test("collects signed timedtext URLs from player payloads", () => {
  const into = new Set<string>();
  collectTimedtextUrls(
    {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              languageCode: "en",
              kind: "asr",
              baseUrl:
                "https://www.youtube.com/api/timedtext?v=_oU3NKm6L2g&kind=asr&lang=en&signature=abc&fmt=srv3",
            },
          ],
        },
      },
    },
    into,
  );
  collectTimedtextUrls(
    '{"baseUrl":"https://www.youtube.com/api/timedtext?v=_oU3NKm6L2g\\u0026kind=asr\\u0026signature=xyz"}',
    into,
  );
  assert.ok([...into].some((u) => u.includes("signature=abc")));
  assert.ok([...into].some((u) => u.includes("signature=xyz")));
  assert.equal(isYoutubeTimedtextUrl("https://evil.example/api/timedtext"), false);
});

test("timedtext variants prefer json3 and vtt for browser CORS", () => {
  const urls = timedtextFetchVariants(
    "https://www.youtube.com/api/timedtext?v=_oU3NKm6L2g&kind=asr&lang=en&signature=abc&fmt=srv3&pot=drop",
  );
  assert.ok(urls[0]?.includes("fmt=json3"));
  assert.ok(urls.some((u) => u.includes("fmt=vtt")));
  assert.equal(urls.some((u) => u.includes("pot=")), false);
});

test("unsigned timedtext keeps proof-of-origin token", () => {
  const urls = timedtextFetchVariants(
    "https://www.youtube.com/api/timedtext?v=_oU3NKm6L2g&lang=en&kind=asr&fmt=json3&pot=KEEPME&potc=1&c=WEB",
  );
  assert.ok(urls.some((u) => u.includes("pot=KEEPME") && u.includes("fmt=json3")));
  assert.ok(urls.some((u) => u.includes("potc=1")));
});

test("signed non-english timedtext also requests an English translation", () => {
  const urls = timedtextFetchVariants(
    "https://www.youtube.com/api/timedtext?v=abc&lang=es&kind=asr&signature=1&sparams=ip",
  );
  assert.ok(urls.some((u) => u.includes("fmt=json3") && !u.includes("tlang=")));
  assert.ok(urls.some((u) => u.includes("fmt=json3") && u.includes("tlang=en")));
  const en = timedtextFetchVariants(
    "https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&signature=1&sparams=ip",
  );
  assert.ok(en.every((u) => !u.includes("tlang=")));
});
