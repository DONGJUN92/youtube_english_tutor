import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptionLine } from "@/lib/caption-parse";
import { TARGET_WINDOW_SEC, WINDOW_SLACK_SEC } from "@/lib/caption-windows";
import { fetchPlayableAudio } from "./youtube-data";

const whisperCache = new Map<string, { at: number; captions: CaptionLine[]; durationSec: number }>();
const WHISPER_TTL_MS = 30 * 60 * 1000;
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

export async function transcribeVideoWindow(opts: {
  apiKey: string;
  videoId: string;
  windowStartSec: number;
  durationSec: number;
  audioUrl?: string;
}): Promise<{ captions: CaptionLine[]; durationSec: number }> {
  const windowStart = Math.max(0, opts.windowStartSec);
  const windowEnd =
    opts.durationSec > 0
      ? Math.min(opts.durationSec, windowStart + TARGET_WINDOW_SEC + WINDOW_SLACK_SEC)
      : windowStart + TARGET_WINDOW_SEC;
  const cacheKey = `${opts.videoId}:${Math.floor(windowStart)}`;
  const hit = whisperCache.get(cacheKey);
  if (hit && Date.now() - hit.at < WHISPER_TTL_MS) return { captions: hit.captions, durationSec: hit.durationSec };

  const audio =
    opts.audioUrl
      ? { url: opts.audioUrl, durationSec: opts.durationSec }
      : await fetchPlayableAudio(opts.videoId);
  if (!audio?.url) {
    console.info("[tubeshadow-captions] whisper no audio", opts.videoId);
    return { captions: [], durationSec: opts.durationSec };
  }

  const downloaded = await downloadAudio(audio.url);
  if (!downloaded) return { captions: [], durationSec: audio.durationSec || opts.durationSec };

  const durationSec = audio.durationSec || opts.durationSec;
  const clipWhole = durationSec > 0 && durationSec <= TARGET_WINDOW_SEC + WINDOW_SLACK_SEC + 30 && windowStart < 5;
  const clipped = clipWhole
    ? downloaded
    : (await clipAudio(downloaded, windowStart, Math.max(8, windowEnd - windowStart))) || downloaded;

  const segments = await whisperSegments(opts.apiKey, clipped.body, clipped.filename);
  const offset = clipWhole || clipped === downloaded ? 0 : windowStart;
  const captions = segments
    .map((seg) => ({
      start: seg.start + offset,
      dur: Math.max(0.4, seg.end - seg.start),
      text: seg.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.text.length > 1);

  console.info(
    "[tubeshadow-captions]",
    JSON.stringify({
      videoId: opts.videoId,
      source: "whisper",
      captionCount: captions.length,
      windowStart,
      audioBytes: downloaded.body.length,
    }),
  );

  if (captions.length >= 4) {
    whisperCache.set(cacheKey, { at: Date.now(), captions, durationSec: durationSec || lastEnd(captions) });
  }
  return { captions, durationSec: durationSec || lastEnd(captions) };
}

async function downloadAudio(url: string): Promise<{ body: Buffer; filename: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip", Accept: "*/*" },
      signal: AbortSignal.timeout(25000),
      redirect: "follow",
    });
    if (!res.ok) {
      console.info("[tubeshadow-captions] audio download", res.status);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000 || buf.length > MAX_AUDIO_BYTES) {
      console.info("[tubeshadow-captions] audio size", buf.length);
      return null;
    }
    const type = res.headers.get("content-type") || "";
    const filename = type.includes("mpeg") || type.includes("mp3") ? "audio.mp3" : "audio.m4a";
    return { body: buf, filename };
  } catch (err) {
    console.info("[tubeshadow-captions] audio download failed", err instanceof Error ? err.message : err);
    return null;
  }
}

async function clipAudio(
  file: { body: Buffer; filename: string },
  startSec: number,
  durationSec: number,
): Promise<{ body: Buffer; filename: string } | null> {
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "tubeshadow-"));
  const input = join(dir, file.filename);
  const output = join(dir, "clip.mp3");
  try {
    await writeFile(input, file.body);
    const ok = await runFfmpeg([
      "-y",
      "-ss",
      String(Math.max(0, startSec)),
      "-t",
      String(Math.max(8, durationSec)),
      "-i",
      input,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      output,
    ]);
    if (!ok) return null;
    const body = await readFile(output);
    if (body.length < 1000) return null;
    return { body, filename: "clip.mp3" };
  } catch (err) {
    console.info("[tubeshadow-captions] ffmpeg clip failed", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"]);
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 20000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function whisperSegments(
  apiKey: string,
  body: Buffer,
  filename: string,
): Promise<Array<{ start: number; end: number; text: string }>> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body)], { type: filename.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4" }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("language", "en");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const err = await res.text();
    console.info("[tubeshadow-captions] whisper failed", res.status, err.slice(0, 180).replace(/\s+/g, " "));
    return [];
  }
  const json = (await res.json()) as {
    text?: string;
    segments?: { start?: number; end?: number; text?: string }[];
  };
  const segments = (json.segments ?? [])
    .map((seg) => ({
      start: Number(seg.start) || 0,
      end: Number(seg.end) || (Number(seg.start) || 0) + 2,
      text: (seg.text ?? "").trim(),
    }))
    .filter((seg) => seg.text);
  if (segments.length) return segments;
  if (json.text?.trim()) return [{ start: 0, end: 8, text: json.text.trim() }];
  return [];
}

function lastEnd(captions: CaptionLine[]): number {
  if (!captions.length) return 0;
  const last = captions[captions.length - 1];
  return last.start + last.dur;
}
