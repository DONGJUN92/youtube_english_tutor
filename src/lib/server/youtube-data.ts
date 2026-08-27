export type CaptionLine = { start: number; dur: number; text: string };

export type VideoMeta = {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
};

export type CaptionBundle = {
  captions: CaptionLine[];
  durationSec: number;
  title?: string;
  author?: string;
  source: "youtubei" | "android_vr" | "html";
};

const UA_WEB =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_VR =
  "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/102.0.5005.61)";

const bundleCache = new Map<string, { at: number; bundle: CaptionBundle }>();
const BUNDLE_TTL_MS = 10 * 60 * 1000;

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return {
      videoId,
      title: "YouTube video",
      author: "",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
  const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  return {
    videoId,
    title: data.title ?? "YouTube video",
    author: data.author_name ?? "",
    thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

export async function fetchCaptions(videoId: string): Promise<CaptionLine[]> {
  const bundle = await fetchCaptionBundle(videoId);
  return bundle.captions;
}

export async function fetchCaptionBundle(videoId: string): Promise<CaptionBundle> {
  const hit = bundleCache.get(videoId);
  if (hit && Date.now() - hit.at < BUNDLE_TTL_MS) return hit.bundle;

  const bundle = await fetchCaptionBundleUncached(videoId);
  if (bundle.captions.length > 0) {
    bundleCache.set(videoId, { at: Date.now(), bundle });
  }
  console.info(
    "[tubeshadow-captions]",
    JSON.stringify({
      videoId,
      source: bundle.source,
      captionCount: bundle.captions.length,
      durationSec: Math.round(bundle.durationSec),
    }),
  );
  return bundle;
}

async function fetchCaptionBundleUncached(videoId: string): Promise<CaptionBundle> {
  const fromYoutubei = await fetchViaYoutubei(videoId);
  if (fromYoutubei.captions.length > 0) return fromYoutubei;

  const fromVr = await fetchViaAndroidVr(videoId);
  if (fromVr.captions.length > 0) return fromVr;

  const fromHtml = await fetchViaWatchHtml(videoId);
  if (fromHtml.captions.length > 0) return fromHtml;

  return fromYoutubei.durationSec
    ? fromYoutubei
    : fromVr.durationSec
      ? fromVr
      : fromHtml;
}

async function fetchViaYoutubei(videoId: string): Promise<CaptionBundle> {
  const clients: Array<string | undefined> = [undefined, "ANDROID_VR"];
  let last: CaptionBundle = { captions: [], durationSec: 0, source: "youtubei" };
  for (const client of clients) {
    try {
      const tube = await getInnertube(client);
      const info = await tube.getInfo(videoId);
      const play = (info as { playability_status?: { status?: string } }).playability_status?.status;
      if (play && play !== "OK") {
        innertubeByClient.delete(client ?? "WEB");
      }
      const durationSec = Number(info.basic_info?.duration ?? 0) || 0;
      const title = info.basic_info?.title;
      const author =
        typeof info.basic_info?.author === "string"
          ? info.basic_info.author
          : (info.basic_info?.author as { name?: string } | undefined)?.name;
      const tracks = (info.captions?.caption_tracks ?? []) as CaptionTrack[];
      const track = pickTrack(tracks);
      const url = trackUrl(track);
      last = { captions: [], durationSec, title, author, source: "youtubei" };
      if (!url) continue;
      const captions = await downloadTimedtext(url, UA_WEB);
      if (captions.length > 0) {
        return { captions, durationSec, title, author, source: "youtubei" };
      }
      console.info("[tubeshadow-captions] youtubei track empty", JSON.stringify({ videoId, client: client ?? "WEB", exp: url.includes("exp=") }));
    } catch (err) {
      innertubeByClient.delete(client ?? "WEB");
      console.info("[tubeshadow-captions] youtubei failed", client ?? "WEB", err instanceof Error ? err.message : err);
    }
  }
  return last;
}

type InnertubeApi = {
  create: (opts: {
    cache?: unknown;
    generate_session_locally?: boolean;
    retrieve_player?: boolean;
    client_type?: string;
  }) => Promise<{
    getInfo: (id: string) => Promise<{
      basic_info?: { duration?: number; title?: string; author?: string | { name?: string } };
      captions?: { caption_tracks?: CaptionTrack[] };
      playability_status?: { status?: string };
    }>;
  }>;
};

const innertubeByClient = new Map<string, Promise<Awaited<ReturnType<InnertubeApi["create"]>>>>();

async function getInnertube(clientType?: string) {
  const key = clientType ?? "WEB";
  const existing = innertubeByClient.get(key);
  if (existing) return existing;
  const mod = (await import("youtubei.js")) as {
    Innertube: InnertubeApi;
    UniversalCache: new (persistent: boolean) => unknown;
    ClientType?: Record<string, string>;
  };
  const created = mod.Innertube.create({
    cache: new mod.UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: false,
    ...(clientType ? { client_type: mod.ClientType?.[clientType] ?? clientType } : {}),
  }).catch((err) => {
    innertubeByClient.delete(key);
    throw err;
  });
  innertubeByClient.set(key, created);
  return created;
}

function trackUrl(track: CaptionTrack | undefined): string | undefined {
  return track?.base_url || track?.baseUrl;
}

type CaptionTrack = {
  base_url?: string;
  baseUrl?: string;
  language_code?: string;
  languageCode?: string;
  kind?: string;
};

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  if (!tracks.length) return undefined;
  const lang = (t: CaptionTrack) => (t.language_code || t.languageCode || "").toLowerCase();
  const scored = [...tracks]
    .filter((t) => trackUrl(t))
    .sort((a, b) => scoreTrack(a, lang(a), trackUrl(a) ?? "") - scoreTrack(b, lang(b), trackUrl(b) ?? ""));
  return scored[0];
}

function scoreTrack(t: CaptionTrack, language: string, url: string): number {
  let s = 50;
  if (language === "en" || language.startsWith("en-") || language.startsWith("en_")) s -= 20;
  if (t.kind === "asr") s += 4;
  if (language.startsWith("en") && t.kind !== "asr") s -= 6;
  if (!url.includes("exp=")) s -= 8;
  return s;
}

async function fetchViaAndroidVr(videoId: string): Promise<CaptionBundle> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA_VR },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: "1.60.19",
            androidSdkVersion: 32,
            hl: "en",
            gl: "US",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    if (!res.ok) return { captions: [], durationSec: 0, source: "android_vr" };
    const player = (await res.json()) as PlayerResponse;
    const status = player.playabilityStatus?.status;
    if (status && status !== "OK") {
      return { captions: [], durationSec: Number(player.videoDetails?.lengthSeconds) || 0, source: "android_vr" };
    }
    return bundleFromPlayer(player, "android_vr", UA_VR);
  } catch (err) {
    console.info("[tubeshadow-captions] android_vr failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "android_vr" };
  }
}

async function fetchViaWatchHtml(videoId: string): Promise<CaptionBundle> {
  try {
    const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": UA_WEB, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!watch.ok) return { captions: [], durationSec: 0, source: "html" };
    const html = await watch.text();
    const player = extractJsonObject(html, "ytInitialPlayerResponse");
    if (!player) return { captions: [], durationSec: 0, source: "html" };
    return bundleFromPlayer(player as PlayerResponse, "html", UA_WEB);
  } catch (err) {
    console.info("[tubeshadow-captions] html failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "html" };
  }
}

type PlayerResponse = {
  playabilityStatus?: { status?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string | number };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
    };
  };
};

async function bundleFromPlayer(
  player: PlayerResponse,
  source: CaptionBundle["source"],
  ua: string,
): Promise<CaptionBundle> {
  const durationSec = Number(player.videoDetails?.lengthSeconds) || 0;
  const title = player.videoDetails?.title;
  const author = player.videoDetails?.author;
  const raw = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: CaptionTrack[] = raw.map((t) => ({
    base_url: t.baseUrl,
    language_code: t.languageCode,
    kind: t.kind,
  }));
  const track = pickTrack(tracks);
  const url = track?.base_url;
  if (!url) return { captions: [], durationSec, title, author, source };
  const captions = await downloadTimedtext(url, ua);
  if (captions.length === 0) {
    console.info(
      "[tubeshadow-captions] timedtext empty",
      JSON.stringify({ source, durationSec, exp: url.includes("exp="), lang: track?.language_code || track?.languageCode }),
    );
  }
  return { captions, durationSec, title, author, source };
}

async function downloadTimedtext(baseUrl: string, ua: string): Promise<CaptionLine[]> {
  const urls = [baseUrl, baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": ua,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.youtube.com/",
        },
      });
      if (!res.ok) continue;
      const body = await res.text();
      const lines = parseCaptionBody(body);
      if (lines.length > 0) return lines;
    } catch {
      /* try next format */
    }
  }
  return [];
}

function parseCaptionBody(body: string): CaptionLine[] {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return [];
  if (trimmed.startsWith("{")) {
    try {
      return parseJson3(JSON.parse(trimmed) as Json3Body);
    } catch {
      return [];
    }
  }
  if (trimmed.includes("<text") || trimmed.includes("<p ") || trimmed.includes("<p>")) {
    return parseTimedtextXml(trimmed);
  }
  return [];
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

function extractJsonObject(html: string, marker: string): unknown | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;
  const start = html.indexOf("{", eq);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
