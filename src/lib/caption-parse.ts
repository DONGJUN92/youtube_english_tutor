export type CaptionLine = { start: number; dur: number; text: string };

const MAX_LINES = 4000;
const MAX_TEXT = 500;

export function parseCaptionBody(body: string): CaptionLine[] {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<!DOCTYPE") || /^<html[\s>]/i.test(trimmed)) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json: unknown = JSON.parse(trimmed);
      const json3 = parseJson3(json as Json3Body);
      if (json3.length) return json3;
      const walked = extractTimedLinesFromUnknown(json);
      if (walked.length) return walked;
    } catch {
      return [];
    }
  }
  if (/WEBVTT/i.test(trimmed) || /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/m.test(trimmed)) {
    const vtt = parseVtt(trimmed);
    if (vtt.length) return vtt;
  }
  if (trimmed.includes("<text") || trimmed.includes("<p ") || trimmed.includes("<p>")) {
    return parseTimedtextXml(trimmed);
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

export function looksLikeRealTimestamps(lines: CaptionLine[]): boolean {
  if (lines.length < 8) return false;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(lines.length, 80); i++) {
    const d = lines[i].start - lines[i - 1].start;
    if (d < -0.05) return false;
    deltas.push(d);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (mean < 0.2 || mean > 10) return false;
  let varSum = 0;
  for (const d of deltas) varSum += (d - mean) ** 2;
  const stdev = Math.sqrt(varSum / deltas.length);
  return stdev > 0.45;
}

export function sanitizeCaptionLines(raw: unknown): CaptionLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptionLine[] = [];
  for (const row of raw.slice(0, MAX_LINES)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { start?: unknown; dur?: unknown; text?: unknown };
    const start = Number(rec.start);
    const dur = Number(rec.dur);
    const text = typeof rec.text === "string" ? rec.text.replace(/\s+/g, " ").trim() : "";
    if (!Number.isFinite(start) || start < 0 || start > 86400) continue;
    if (!Number.isFinite(dur) || dur < 0 || dur > 180) continue;
    if (!text || text.length > MAX_TEXT) continue;
    if (/^[\s♪]+$/.test(text)) continue;
    out.push({ start, dur: dur || 2, text });
  }
  return out;
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
  return lines.slice(0, MAX_LINES);
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
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
};

function parseJson3(body: Json3Body): CaptionLine[] {
  return (body.events ?? [])
    .map((ev) => {
      const text = (ev.segs ?? [])
        .map((s) => s.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return {
        start: (ev.tStartMs ?? 0) / 1000,
        dur: (ev.dDurationMs ?? 2000) / 1000,
        text,
      };
    })
    .filter((l) => l.text.length > 0 && !/^[\s♪]+$/.test(l.text));
}

function parseTimedtextXml(xml: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const re = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const attrs = match[2] ?? "";
    const text = decodeEntities(match[3] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
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

function decodeEntities(value: string): string {
  return value
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
