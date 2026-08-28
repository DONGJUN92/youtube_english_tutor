import {
  parseCaptionBody,
  parseTimedtextList,
  timedtextCandidateUrls,
  looksLikeRealTimestamps,
  sanitizeCaptionLines,
  type CaptionLine,
} from "@/lib/caption-parse";
import type { YtPlayer } from "@/components/youtube-player";

const BROWSER_BUDGET_MS = 10000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function collectTimedtextUrls(data: unknown, into: Set<string>) {
  if (data == null) return;
  if (typeof data === "string") {
    if (data.startsWith("{") || data.startsWith("[")) {
      try {
        collectTimedtextUrls(JSON.parse(data), into);
      } catch {
        /* ignore */
      }
    }
    const matches = data.match(/https:\/\/(?:www\.)?youtube\.com\/api\/timedtext[^"'\\\s]*/g);
    for (const raw of matches ?? []) {
      into.add(raw.replace(/\\u0026/g, "&").replace(new RegExp("&" + "amp;", "g"), "&"));
    }
    return;
  }
  if (typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const item of data) collectTimedtextUrls(item, into);
    return;
  }
  const rec = data as Record<string, unknown>;
  if (typeof rec.baseUrl === "string" && rec.baseUrl.includes("timedtext")) into.add(rec.baseUrl);
  for (const value of Object.values(rec)) collectTimedtextUrls(value, into);
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  for (const credentials of ["omit", "include"] as const) {
    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (body && !/^<!DOCTYPE/i.test(body) && !/^<html/i.test(body)) return body;
    } catch {
      /* try the other credentials mode */
    }
  }
  return "";
}

function fetchJsonp(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__tsCap_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      try {
        delete (window as unknown as Record<string, unknown>)[cb];
      } catch {
        (window as unknown as Record<string, unknown>)[cb] = undefined;
      }
    };
    (window as unknown as Record<string, unknown>)[cb] = (data: unknown) => {
      cleanup();
      resolve(data);
    };
    script.src = `${url}${url.includes("?") ? "&" : "?"}jsonp=${cb}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("jsonp"));
    };
    document.head.appendChild(script);
  });
}

async function linesFromBodies(bodies: string[]): Promise<CaptionLine[]> {
  for (const body of bodies) {
    const lines = sanitizeCaptionLines(parseCaptionBody(typeof body === "string" ? body : JSON.stringify(body)));
    if (looksLikeRealTimestamps(lines)) return lines;
  }
  return [];
}

async function captionsFromJsonp(videoId: string): Promise<CaptionLine[]> {
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3&xoaf=5`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&xoaf=5`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&kind=asr&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=a.en&fmt=json3`,
  ];
  for (const url of urls) {
    try {
      const data = await fetchJsonp(url, 4000);
      const lines = sanitizeCaptionLines(parseCaptionBody(typeof data === "string" ? data : JSON.stringify(data)));
      if (looksLikeRealTimestamps(lines)) return lines;
    } catch {
      /* next url */
    }
  }
  return [];
}

async function captionsFromTrack(videoId: string): Promise<CaptionLine[]> {
  if (typeof document === "undefined") return [];
  const urls = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=vtt&xoaf=5`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=vtt&xoaf=5`,
  ];
  for (const src of urls) {
    const lines = await new Promise<CaptionLine[]>((resolve) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.preload = "none";
      const track = document.createElement("track");
      track.kind = "captions";
      track.default = true;
      track.src = src;
      video.appendChild(track);
      video.style.display = "none";
      document.body.appendChild(video);
      const finish = (cues: CaptionLine[]) => {
        video.remove();
        resolve(cues);
      };
      const timer = window.setTimeout(() => finish([]), 4000);
      track.addEventListener("load", () => {
        window.clearTimeout(timer);
        const list = video.textTracks[0];
        if (list) list.mode = "hidden";
        const cues = sanitizeCaptionLines(
          [...(list?.cues ?? [])].map((cue) => {
            const c = cue as VTTCue;
            return {
              start: c.startTime,
              dur: Math.max(0.4, c.endTime - c.startTime),
              text: c.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            };
          }),
        );
        finish(cues);
      });
      track.addEventListener("error", () => {
        window.clearTimeout(timer);
        finish([]);
      });
    });
    if (looksLikeRealTimestamps(lines)) return lines;
  }
  return [];
}

async function captionsFromUrlSet(urls: string[]): Promise<CaptionLine[]> {
  for (const batch of chunk(urls.slice(0, 12), 3)) {
    const bodies = await Promise.all(batch.map((url) => fetchText(url, 4500).catch(() => "")));
    const lines = await linesFromBodies(bodies);
    if (lines.length) return lines;
  }
  return [];
}

/** Pull timedtext URLs out of the YouTube iframe player, then download cues. */
export async function captionsFromYoutubePlayer(player: YtPlayer | null, videoId: string): Promise<CaptionLine[]> {
  if (!player || typeof window === "undefined") return [];
  const urls = new Set<string>();
  const onMsg = (event: MessageEvent) => {
    if (!String(event.origin).includes("youtube.com")) return;
    collectTimedtextUrls(event.data, urls);
  };
  window.addEventListener("message", onMsg);
  try {
    player.loadModule?.("captions");
    player.loadModule?.("cc");
    collectTimedtextUrls(player.getOption?.("captions", "tracklist"), urls);
    collectTimedtextUrls(player.getOption?.("cc", "tracklist"), urls);
    const iframe = player.getIframe?.();
    if (iframe?.src) collectTimedtextUrls(iframe.src, urls);
  } catch {
    /* player internals differ by version */
  }
  await new Promise((r) => window.setTimeout(r, 1600));
  window.removeEventListener("message", onMsg);
  const harvested = [...urls];
  if (harvested.length) {
    const lines = await captionsFromUrlSet(harvested);
    if (lines.length) {
      console.info("[tubeshadow-captions] player urls", harvested.length, lines.length);
      return lines;
    }
  }
  return fetchCaptionsInBrowser(videoId);
}

/** Timedtext is CORS-open. Fetch from the user's IP — Vercel datacenter IPs are blocked. */
export async function fetchCaptionsInBrowser(videoId: string): Promise<CaptionLine[]> {
  if (!videoId || videoId.length < 8 || typeof window === "undefined") return [];
  const started = Date.now();
  try {
    const jsonp = await captionsFromJsonp(videoId);
    if (looksLikeRealTimestamps(jsonp)) {
      console.info("[tubeshadow-captions] browser jsonp", jsonp.length);
      return jsonp;
    }
    const track = await captionsFromTrack(videoId);
    if (looksLikeRealTimestamps(track)) {
      console.info("[tubeshadow-captions] browser track", track.length);
      return track;
    }

    const listXml = await fetchText(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`, 4500);
    const tracks = parseTimedtextList(listXml);
    const urls = timedtextCandidateUrls(videoId, tracks);
    for (const batch of chunk(urls, 4)) {
      if (Date.now() - started > BROWSER_BUDGET_MS) break;
      const bodies = await Promise.all(batch.map((url) => fetchText(url, 4500).catch(() => "")));
      const lines = await linesFromBodies(bodies);
      if (lines.length) {
        console.info("[tubeshadow-captions] browser", JSON.stringify({ videoId, captionCount: lines.length }));
        return lines;
      }
    }
    console.info(
      "[tubeshadow-captions] browser empty",
      JSON.stringify({ videoId, tracks: tracks.length, elapsedMs: Date.now() - started }),
    );
  } catch (err) {
    console.info("[tubeshadow-captions] browser failed", err instanceof Error ? err.message : err);
  }
  return [];
}
