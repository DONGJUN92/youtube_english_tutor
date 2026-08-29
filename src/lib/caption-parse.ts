export type CaptionLine = { start: number; dur: number; text: string };

const MAX_LINES = 4000;
const MAX_TEXT = 500;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function codePointToChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0) return " ";
  if (code < 32 && code !== 9 && code !== 10 && code !== 13) return " ";
  if (code > 0xffff) return " ";
  return String.fromCharCode(code);
}

/**
 * Decode YouTube timedtext entities via a name map (gt, quot, amp, ...).
 * Do not write named-entity literals in regex replacements; HTML-aware
 * editors turn them into no-ops.
 */
export function decodeHtmlEntities(raw: string): string {
  if (!raw.includes("&") && !raw.includes("\\u")) return raw;
  let out = raw.replace(/\\u([0-9a-f]{4})/gi, (_m, hex: string) => codePointToChar(parseInt(hex, 16)));
  for (let pass = 0; pass < 3; pass++) {
    const next = out
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => codePointToChar(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, n: string) => codePointToChar(Number(n)))
      .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** YouTube interview captions mark a new speaker with leading `>>`. */
export function isSpeakerChangeLine(raw: string): boolean {
  return /^>{2,}/.test(decodeHtmlEntities(raw).trim());
}

const SKIP_NOISE = /^(laughter|applause|music|cheers|\(laughter\)|\(applause\))$/i;
const LEFTOVER_ENTITY = /&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi;

/** Spoken caption: entities decoded, speaker marks and leftover encodings gone. */
export function cleanCaptionText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/>{2,}/g, " ")
    .replace(LEFTOVER_ENTITY, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(laughter|applause|music|cheers|clears throat)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function polishCaptionText(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
}

function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Merge YouTube rolling ASR windows that share a word suffix/prefix. */
function mergeRollingText(prev: string, next: string): string | null {
  const a = tokenizeWords(prev);
  const b = tokenizeWords(next);
  if (!a.length || !b.length) return null;
  const aJoin = a.join(" ").toLowerCase();
  const bJoin = b.join(" ").toLowerCase();
  if (aJoin.includes(bJoin) && b.length >= 2) return prev;
  if (bJoin.includes(aJoin) && a.length >= 2) return next;
  const max = Math.min(a.length, b.length, 12);
  for (let k = max; k >= 2; k--) {
    if (a.slice(-k).join(" ").toLowerCase() === b.slice(0, k).join(" ").toLowerCase()) {
      return `${a.join(" ")} ${b.slice(k).join(" ")}`.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function endsSentence(text: string): boolean {
  return /[.!?…]"?$/.test(text.trim());
}

/**
 * YouTube ASR is a rolling on-screen window, not a linear transcript.
 * Reconstruct utterances: merge overlapping windows, split on `>>` speakers.
 */
export function stitchOverlappingCaptions(lines: CaptionLine[]): CaptionLine[] {
  const prepared = lines
    .map((l) => ({
      start: l.start,
      dur: Math.max(0.35, l.dur || 0),
      speaker: isSpeakerChangeLine(l.text),
      text: cleanCaptionText(l.text),
    }))
    .filter((l) => l.text && !SKIP_NOISE.test(l.text) && !/^[\s♪.]+$/.test(l.text))
    .sort((a, b) => a.start - b.start || a.dur - b.dur);

  const out: { start: number; end: number; text: string }[] = [];
  for (const line of prepared) {
    const end = line.start + line.dur;
    if (!out.length) {
      out.push({ start: line.start, end, text: line.text });
      continue;
    }
    const prev = out[out.length - 1]!;
    if (line.speaker) {
      out.push({ start: line.start, end, text: line.text });
      continue;
    }
    const overlap = line.start < prev.end - 0.08;
    const gap = line.start - prev.end;
    const nextLower = /^[a-z]/.test(line.text);
    const joinedLen = tokenizeWords(prev.text).length + tokenizeWords(line.text).length;

    if (overlap) {
      const merged = mergeRollingText(prev.text, line.text);
      if (merged && tokenizeWords(merged).length <= 48) {
        prev.text = merged;
        prev.end = Math.max(prev.end, end);
        continue;
      }
      const sentencesInPrev = (prev.text.match(/[.!?]/g) ?? []).length;
      if (!endsSentence(prev.text) && nextLower && joinedLen <= 36 && sentencesInPrev < 2) {
        prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, " ").trim();
        prev.end = Math.max(prev.end, end);
        continue;
      }
    } else if (gap < 0.35 && !endsSentence(prev.text) && nextLower && joinedLen <= 36) {
      prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, " ").trim();
      prev.end = Math.max(prev.end, end);
      continue;
    }
    out.push({ start: line.start, end, text: line.text });
  }

  return out.map((l) => ({
    start: Number(l.start.toFixed(3)),
    dur: Number(Math.max(0.4, l.end - l.start).toFixed(3)),
    text: l.text,
  }));
}

export function normalizeCaptionLines(raw: CaptionLine[]): CaptionLine[] {
  const polished: CaptionLine[] = [];
  for (const line of raw.slice(0, MAX_LINES)) {
    const start = Number(line.start);
    const dur = Number(line.dur);
    if (!Number.isFinite(start) || start < 0 || start > 86400) continue;
    if (!Number.isFinite(dur) || dur < 0 || dur > 180) continue;
    if (typeof line.text !== "string") continue;
    const text = polishCaptionText(line.text);
    if (!text || text.length > MAX_TEXT) continue;
    if (/^[\s♪]+$/.test(text)) continue;
    polished.push({ start, dur: dur || 2, text });
  }
  if (polished.length < 2) {
    return polished
      .map((l) => ({ ...l, text: cleanCaptionText(l.text) }))
      .filter((l) => l.text);
  }
  const stitched = stitchOverlappingCaptions(polished).filter((l) => l.text && l.text.length <= MAX_TEXT);
  const minKeep = Math.min(8, Math.max(2, Math.floor(polished.length * 0.2)));
  if (stitched.length >= minKeep) return stitched.slice(0, MAX_LINES);
  return polished
    .map((l) => ({ ...l, text: cleanCaptionText(l.text) }))
    .filter((l) => l.text)
    .slice(0, MAX_LINES);
}

function finishLines(lines: CaptionLine[]): CaptionLine[] {
  return normalizeCaptionLines(lines);
}

export function parseCaptionBody(body: string): CaptionLine[] {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<!DOCTYPE") || /^<html[\s>]/i.test(trimmed)) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json: unknown = JSON.parse(trimmed);
      const json3 = parseJson3(json as Json3Body);
      if (json3.length) return finishLines(json3);
      const walked = extractTimedLinesFromUnknown(json);
      if (walked.length) return walked;
    } catch {
      return [];
    }
  }
  if (/WEBVTT/i.test(trimmed) || /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/m.test(trimmed)) {
    const vtt = parseVtt(trimmed);
    if (vtt.length) return finishLines(vtt);
  }
  if (trimmed.includes("<text") || trimmed.includes("<p ") || trimmed.includes("<p>")) {
    return finishLines(parseTimedtextXml(trimmed));
  }
  return [];
}

export type TimedtextTrack = { lang: string; kind?: string; name?: string };

export function parseTimedtextList(xml: string): TimedtextTrack[] {
  const tracks: TimedtextTrack[] = [];
  const re = /<track\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[1] ?? "";
    const lang = /lang_code="([^"]+)"/i.exec(attrs)?.[1];
    if (!lang) continue;
    const kind = /kind="([^"]*)"/i.exec(attrs)?.[1] || undefined;
    const name = /name="([^"]*)"/i.exec(attrs)?.[1] || undefined;
    tracks.push({ lang, kind: kind || undefined, name: name || undefined });
  }
  return tracks;
}

export function scoreTimedtextTrack(track: TimedtextTrack): number {
  const lang = track.lang.toLowerCase();
  let s = 50;
  if (lang === "en" || lang.startsWith("en-") || lang.startsWith("en_") || lang === "a.en") s -= 20;
  if (lang.startsWith("en") && track.kind !== "asr") s -= 6;
  if (track.kind === "asr") s += 4;
  return s;
}

export function timedtextCandidateUrls(videoId: string, tracks: TimedtextTrack[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const guesses: TimedtextTrack[] = [
    { lang: "en", kind: "asr" },
    { lang: "en" },
    { lang: "en-US", kind: "asr" },
    { lang: "en-GB" },
    { lang: "a.en" },
    { lang: "ko", kind: "asr" },
    { lang: "ko" },
  ];
  const ordered = [...tracks].sort((a, b) => scoreTimedtextTrack(a) - scoreTimedtextTrack(b));
  const list = [...ordered, ...guesses].slice(0, 8);

  for (const track of list) {
    const kind = track.kind ? `&kind=${encodeURIComponent(track.kind)}` : "";
    const name = track.name ? `&name=${encodeURIComponent(track.name)}` : "";
    for (const fmt of ["json3", "srv3", "vtt"] as const) {
      add(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(track.lang)}${kind}${name}&fmt=${fmt}&xoaf=5`,
      );
    }
  }
  return urls;
}

export function isYoutubeTimedtextUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "youtube-nocookie.com" && host !== "video.google.com") return false;
    return parsed.pathname.includes("timedtext");
  } catch {
    return false;
  }
}

/** Prefer json3/vtt: browsers get CORS when Origin is set. Strip pot/exp so signed tracks still fetch. */
export function timedtextFetchVariants(baseUrl: string): string[] {
  const abs = baseUrl.startsWith("http") ? baseUrl : `https://www.youtube.com${baseUrl.startsWith("/") ? "" : "/"}${baseUrl}`;
  const decoded = abs.replace(/\\u0026/g, "&");
  const urls: string[] = [];
  const push = (url: string) => {
    if (isYoutubeTimedtextUrl(url) && !urls.includes(url)) urls.push(url);
  };
  try {
    const parsed = new URL(decoded);
    const signed = parsed.searchParams.has("signature") || parsed.searchParams.has("sparams") || parsed.searchParams.has("sig");
    if (signed) {
      parsed.searchParams.delete("pot");
      parsed.searchParams.delete("potc");
      parsed.searchParams.delete("exp");
    }
    const lang = (parsed.searchParams.get("lang") || "").toLowerCase();
    const addTlang = lang && !lang.startsWith("en") && !parsed.searchParams.get("tlang");
    for (const fmt of ["json3", "vtt", "srv3"] as const) {
      parsed.searchParams.set("fmt", fmt);
      parsed.searchParams.delete("tlang");
      push(parsed.toString());
      if (addTlang) {
        parsed.searchParams.set("tlang", "en");
        push(parsed.toString());
      }
    }
  } catch {
    push(decoded);
  }
  return urls;
}

/** Walk player postMessage / tracklist / iframe payloads for signed timedtext URLs. */
export function collectTimedtextUrls(data: unknown, into: Set<string>, depth = 0, seen?: WeakSet<object>) {
  if (data == null || depth > 14) return;
  if (typeof data === "string") {
    if (data.startsWith("{") || data.startsWith("[") || data.startsWith("(")) {
      try {
        collectTimedtextUrls(JSON.parse(data), into, depth + 1, seen);
      } catch {
        /* not json */
      }
    }
    const matches = data.match(/https:\\?\/\\?\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/api\/timedtext[^"'\\\s]*/g);
    for (const raw of matches ?? []) {
      const url = raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(new RegExp("&" + "amp;", "g"), "&");
      if (isYoutubeTimedtextUrl(url)) into.add(url);
    }
    if (data.includes("timedtext") && data.startsWith("http")) {
      const url = data.replace(/\\u0026/g, "&");
      if (isYoutubeTimedtextUrl(url)) into.add(url);
    }
    return;
  }
  if (typeof data !== "object") return;
  const seenSet = seen ?? new WeakSet<object>();
  if (seenSet.has(data as object)) return;
  seenSet.add(data as object);
  if (Array.isArray(data)) {
    for (const item of data) collectTimedtextUrls(item, into, depth + 1, seenSet);
    return;
  }
  const rec = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(rec)) {
    if ((key === "baseUrl" || key === "base_url" || key === "url") && typeof value === "string" && value.includes("timedtext")) {
      const url = value.replace(/\\u0026/g, "&");
      if (isYoutubeTimedtextUrl(url)) into.add(url);
    }
    collectTimedtextUrls(value, into, depth + 1, seenSet);
  }
}

export function looksLikeRealTimestamps(lines: CaptionLine[]): boolean {
  if (lines.length < 4) return false;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(lines.length, 80); i++) {
    const d = lines[i].start - lines[i - 1].start;
    if (d < -0.05) return false;
    deltas.push(d);
  }
  if (!deltas.length) return lines.length >= 4;
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (mean < 0.15 || mean > 14) return false;
  let varSum = 0;
  for (const d of deltas) varSum += (d - mean) ** 2;
  const stdev = Math.sqrt(varSum / deltas.length);
  return stdev > 0.35;
}

export function sanitizeCaptionLines(raw: unknown): CaptionLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptionLine[] = [];
  for (const row of raw.slice(0, MAX_LINES)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { start?: unknown; dur?: unknown; text?: unknown };
    const start = Number(rec.start);
    const dur = Number(rec.dur);
    const text = typeof rec.text === "string" ? rec.text : "";
    if (!Number.isFinite(start) || start < 0 || start > 86400) continue;
    if (!Number.isFinite(dur) || dur < 0 || dur > 180) continue;
    if (!text) continue;
    out.push({ start, dur: dur || 2, text });
  }
  return normalizeCaptionLines(out);
}

/** Walk InnerTube get_transcript / next JSON for timed cue objects. */
export function extractTimedLinesFromUnknown(data: unknown): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 18) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const cue = (rec.transcriptSegmentRenderer || rec.transcriptCueRenderer || rec.cueGroupRenderer || rec) as Record<
      string,
      unknown
    >;
    const text = cueText(cue) || cueText(rec);
    const startMs = asNumber(cue.startMs ?? cue.start_ms ?? cue.startOffsetMs ?? rec.startMs ?? rec.startOffsetMs);
    const endMs = asNumber(cue.endMs ?? cue.end_ms ?? cue.endOffsetMs ?? rec.endMs);
    const durMs = asNumber(cue.durationMs ?? rec.durationMs ?? rec.dDurationMs);
    if (text && startMs != null && startMs >= 0) {
      const start = startMs > 10000 || startMs === 0 ? startMs / 1000 : startMs / 1000;
      const end = endMs != null ? (endMs > 10 ? endMs / 1000 : endMs / 1000) : start + (durMs != null ? durMs / 1000 : 2);
      const dur = Math.max(0.4, end - start);
      const key = `${start.toFixed(2)}:${text}`;
      if (!seen.has(key) && text.length <= MAX_TEXT && !/^[\s♪]+$/.test(text)) {
        seen.add(key);
        lines.push({ start, dur, text });
      }
    }
    for (const value of Object.values(rec)) visit(value, depth + 1);
  };

  visit(data, 0);
  lines.sort((a, b) => a.start - b.start);
  return finishLines(lines);
}

function cueText(rec: Record<string, unknown>): string {
  const snippet = rec.snippet ?? rec.cue ?? rec.headline ?? rec.title;
  const fromSnippet = runsText(snippet);
  if (fromSnippet) return fromSnippet;
  if (typeof rec.text === "string") return rec.text.replace(/\s+/g, " ").trim();
  return "";
}

function runsText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  if (typeof rec.simpleText === "string") return rec.simpleText.replace(/\s+/g, " ").trim();
  if (Array.isArray(rec.runs)) {
    return rec.runs
      .map((run) => (run && typeof run === "object" && "text" in run ? String((run as { text?: unknown }).text ?? "") : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type Json3Body = {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
};

function parseJson3(body: Json3Body): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const ev of body.events ?? []) {
    const joined = (ev.segs ?? []).map((s) => s.utf8 ?? "").join("");
    const start = (ev.tStartMs ?? 0) / 1000;
    const dur = (ev.dDurationMs ?? 2000) / 1000;
    for (const chunk of joined.split(/\n+/)) {
      const text = chunk.replace(/\s+/g, " ").trim();
      if (!text || /^[\s♪]+$/.test(text)) continue;
      out.push({ start, dur, text });
    }
  }
  return out;
}

function innerCueText(html: string): string {
  const segs: string[] = [];
  const re = /<s\b[^>]*>([\s\S]*?)<\/s>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) segs.push(match[1] ?? "");
  const raw = segs.length ? segs.join(" ") : html;
  return decodeHtmlEntities(raw)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimedtextXml(xml: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const re = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[2] ?? "";
    const text = innerCueText(match[3] ?? "");
    if (!text) continue;
    const startAttr = /(?:\bstart|\bt)="([^"]+)"/i.exec(attrs)?.[1];
    const durAttr = /(?:\bdur|\bd)="([^"]+)"/i.exec(attrs)?.[1];
    let start = Number(startAttr ?? 0);
    let dur = Number(durAttr ?? 0);
    const usesMs = /\bt="/i.test(attrs) && !/\bstart="/i.test(attrs);
    if (usesMs) {
      start /= 1000;
      dur /= 1000;
    }
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(dur) || dur <= 0) dur = 2;
    lines.push({ start, dur, text });
  }
  return lines.filter((l) => l.text.length > 0);
}

function parseVtt(body: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const blocks = body.replace(/^\uFEFF/, "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const rows = block.split(/\r?\n/).filter((row) => row.trim() && !/^WEBVTT/i.test(row) && !row.startsWith("NOTE"));
    const timeRow = rows.find((row) => row.includes("-->"));
    if (!timeRow) continue;
    const times = timeRow.match(/(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}/g);
    if (!times || times.length < 2) continue;
    const start = parseClock(times[0]);
    const end = parseClock(times[1]);
    const text = rows
      .filter((row) => row !== timeRow && !/^\d+$/.test(row.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    lines.push({ start, dur: Math.max(0.4, end - start), text });
  }
  return lines;
}

function parseClock(ts: string): number {
  const clean = ts.trim().replace(",", ".");
  const parts = clean.split(":");
  const sec = Number(parts.pop());
  const min = Number(parts.pop() ?? 0);
  const hr = Number(parts.pop() ?? 0);
  if (![hr, min, sec].every(Number.isFinite)) return 0;
  return hr * 3600 + min * 60 + sec;
}

