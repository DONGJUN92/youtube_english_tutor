import {
  parseCaptionBody,
  parseTimedtextList,
  timedtextCandidateUrls,
  timedtextFetchVariants,
  looksLikeRealTimestamps,
  sanitizeCaptionLines,
  collectTimedtextUrls,
  isYoutubeTimedtextUrl,
  type CaptionLine,
} from "@/lib/caption-parse";
import type { YtPlayer } from "@/components/youtube-player";

const BROWSER_BUDGET_MS = 14000;
const harvestedCaptionUrls = new Set<string>();
let harvestAttached = false;

export function attachYoutubeCaptionHarvest() {
  if (typeof window === "undefined" || harvestAttached) return;
  harvestAttached = true;
  window.addEventListener("message", onYoutubeMessage);
}

function onYoutubeMessage(event: MessageEvent) {
  const origin = String(event.origin);
  if (!origin.includes("youtube.com") && !origin.includes("youtube-nocookie.com")) return;
  collectTimedtextUrls(event.data, harvestedCaptionUrls);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function usable(lines: CaptionLine[]): CaptionLine[] {
  const clean = sanitizeCaptionLines(lines);
  return looksLikeRealTimestamps(clean) ? clean : [];
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

async function fetchViaProxy(url: string): Promise<CaptionLine[]> {
  try {
    const res = await fetch("/api/timedtext", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; captions?: unknown };
    return json.ok ? usable(sanitizeCaptionLines(json.captions)) : [];
  } catch {
    return [];
  }
}

async function linesFromBodies(bodies: string[]): Promise<CaptionLine[]> {
  for (const body of bodies) {
    if (!body) continue;
    const lines = usable(parseCaptionBody(typeof body === "string" ? body : JSON.stringify(body)));
    if (lines.length) return lines;
  }
  return [];
}

/** Fetch signed YouTube timedtext in the browser (CORS echoes our Origin) then via our proxy. */
export async function fetchSignedTimedtext(urls: string[]): Promise<CaptionLine[]> {
  const expanded = [...new Set(urls.flatMap((url) => timedtextFetchVariants(url)))].slice(0, 18);
  for (const batch of chunk(expanded, 3)) {
    const bodies = await Promise.all(batch.map((url) => fetchText(url, 5000).catch(() => "")));
    const lines = await linesFromBodies(bodies);
    if (lines.length) {
      console.info("[tubeshadow-captions] signed timedtext", lines.length);
      return lines;
    }
    for (const url of batch) {
      const proxied = await fetchViaProxy(url);
      if (proxied.length) {
        console.info("[tubeshadow-captions] timedtext proxy", proxied.length);
        return proxied;
      }
    }
  }
  return [];
}

type CaptionApiJson = {
  ok?: boolean;
  source?: string;
  captions?: unknown;
  trackUrls?: unknown;
};

function trackUrlList(json: CaptionApiJson): string[] {
  return Array.isArray(json.trackUrls) ? json.trackUrls.filter((u): u is string => typeof u === "string") : [];
}

async function linesFromCaptionJson(json: CaptionApiJson): Promise<CaptionLine[]> {
  const lines = usable(sanitizeCaptionLines(json.captions));
  if (lines.length) return lines;
  const urls = trackUrlList(json);
  if (urls.length) return fetchSignedTimedtext(urls);
  return [];
}

export async function loadCaptionsFromApi(
  videoId: string,
  opts?: { poToken?: string },
): Promise<CaptionLine[]> {
  try {
    if (opts?.poToken) {
      const res = await fetch("/api/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ v: videoId, poToken: opts.poToken }),
      });
      if (res.ok) {
        const json = (await res.json()) as CaptionApiJson;
        const lines = await linesFromCaptionJson(json);
        if (lines.length) return lines;
      }
    } else {
      const res = await fetch(`/api/captions?v=${encodeURIComponent(videoId)}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as CaptionApiJson;
        const lines = await linesFromCaptionJson(json);
        if (lines.length) return lines;
      }
    }
  } catch {
    /* network */
  }
  return [];
}

export async function persistClientCaptions(videoId: string, captions: CaptionLine[], meta?: { title?: string; durationSec?: number }) {
  if (captions.length < 4) return;
  try {
    await fetch("/api/captions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: videoId, captions, title: meta?.title, durationSec: meta?.durationSec }),
      cache: "no-store",
    });
  } catch {
    /* ignore */
  }
}

let lastPoToken: string | undefined;

export function lastCaptionPoToken(): string | undefined {
  return lastPoToken;
}

export async function captionsWithPoToken(videoId: string): Promise<CaptionLine[]> {
  if (typeof window === "undefined") return [];
  try {
    const { mintYoutubePoToken } = await import("@/lib/yt-pot");
    const poToken = await mintYoutubePoToken(videoId);
    lastPoToken = poToken;
    const lines = await loadCaptionsFromApi(videoId, { poToken });
    if (lines.length) {
      console.info("[tubeshadow-captions] pot captions", lines.length);
      void persistClientCaptions(videoId, lines);
      return lines;
    }
  } catch (err) {
    console.info("[tubeshadow-captions] pot failed", err instanceof Error ? err.message : err);
  }
  return [];
}

function harvestFromPlayer(player: YtPlayer) {
  try {
    player.loadModule?.("captions");
    player.loadModule?.("cc");
  } catch {
    /* older embeds */
  }
  collectTimedtextUrls(player.getOption?.("captions", "tracklist"), harvestedCaptionUrls);
  collectTimedtextUrls(player.getOption?.("cc", "tracklist"), harvestedCaptionUrls);
  try {
    const modules = player.getOptions?.() ?? [];
    for (const mod of modules) {
      collectTimedtextUrls(player.getOption?.(mod, "tracklist"), harvestedCaptionUrls);
      collectTimedtextUrls(player.getOption?.(mod, "track"), harvestedCaptionUrls);
    }
  } catch {
    /* ignore */
  }
  try {
    collectTimedtextUrls(player.getIframe?.()?.src, harvestedCaptionUrls);
  } catch {
    /* ignore */
  }
  try {
    collectTimedtextUrls(player as unknown as Record<string, unknown>, harvestedCaptionUrls);
  } catch {
    /* circular player proxy */
  }
}

async function wakeCaptionModule(player: YtPlayer) {
  let state = -1;
  try {
    state = player.getPlayerState();
  } catch {
    state = -1;
  }
  try {
    player.mute?.();
  } catch {
    /* no mute */
  }
  try {
    player.setOption?.("captions", "reload", true);
  } catch {
    /* no setOption */
  }
  try {
    const list = player.getOption?.("captions", "tracklist");
    if (Array.isArray(list) && list[0]) player.setOption?.("captions", "track", list[0]);
  } catch {
    /* no track */
  }
  const alreadyPlaying = state === 1;
  if (!alreadyPlaying) {
    try {
      player.playVideo();
    } catch {
      /* autoplay blocked */
    }
    await new Promise((r) => window.setTimeout(r, 1600));
    try {
      player.pauseVideo();
    } catch {
      /* ignore */
    }
  } else {
    await new Promise((r) => window.setTimeout(r, 400));
  }
  try {
    player.unMute?.();
  } catch {
    /* ignore */
  }
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
      const data = await fetchJsonp(url, 3500);
      const lines = usable(parseCaptionBody(typeof data === "string" ? data : JSON.stringify(data)));
      if (lines.length) return lines;
    } catch {
      /* next url */
    }
  }
  return [];
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
      const timer = window.setTimeout(() => finish([]), 3000);
      track.addEventListener("load", () => {
        window.clearTimeout(timer);
        const list = video.textTracks[0];
        if (list) list.mode = "hidden";
        const cues = usable(
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
    if (lines.length) return lines;
  }
  return [];
}

/** Pull signed timedtext URLs out of the YouTube iframe, then download cues. */
export async function captionsFromYoutubePlayer(player: YtPlayer | null, videoId: string): Promise<CaptionLine[]> {
  attachYoutubeCaptionHarvest();
  const potTask = captionsWithPoToken(videoId);
  if (!player || typeof window === "undefined") {
    const pot = await potTask;
    if (pot.length) return pot;
    return fetchCaptionsInBrowser(videoId);
  }
  harvestFromPlayer(player);
  await wakeCaptionModule(player);
  harvestFromPlayer(player);
  await new Promise((r) => window.setTimeout(r, 1200));
  harvestFromPlayer(player);
  const harvested = [...harvestedCaptionUrls].filter((url) => url.includes(videoId) || isYoutubeTimedtextUrl(url));
  if (harvested.length) {
    const lines = await fetchSignedTimedtext(harvested);
    if (lines.length) {
      console.info("[tubeshadow-captions] player urls", harvested.length, lines.length);
      void persistClientCaptions(videoId, lines);
      return lines;
    }
  }
  const pot = await potTask;
  if (pot.length) return pot;
  return fetchCaptionsInBrowser(videoId);
}

/** Timedtext is CORS-open for signed tracks. Unsigned guesses are empty; still try, then list tracks. */
export async function fetchCaptionsInBrowser(videoId: string): Promise<CaptionLine[]> {
  attachYoutubeCaptionHarvest();
  if (!videoId || videoId.length < 8 || typeof window === "undefined") return [];
  const started = Date.now();
  try {
    const already = [...harvestedCaptionUrls];
    if (already.length) {
      const signed = await fetchSignedTimedtext(already);
      if (signed.length) return signed;
    }
    const jsonp = await captionsFromJsonp(videoId);
    if (jsonp.length) {
      console.info("[tubeshadow-captions] browser jsonp", jsonp.length);
      return jsonp;
    }
    const track = await captionsFromTrack(videoId);
    if (track.length) {
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
      JSON.stringify({ videoId, tracks: tracks.length, harvested: harvestedCaptionUrls.size, elapsedMs: Date.now() - started }),
    );
  } catch (err) {
    console.info("[tubeshadow-captions] browser failed", err instanceof Error ? err.message : err);
  }
  return [];
}

if (typeof window !== "undefined") attachYoutubeCaptionHarvest();
