import { bundledCaptionBundle } from "@/data/caption-bundles";
import {
  extractTimedLinesFromUnknown,
  parseCaptionBody,
  parseTimedtextList,
  sanitizeCaptionLines,
  scoreTimedtextTrack,
  type CaptionLine,
} from "@/lib/caption-parse";

export type { CaptionLine };

export type VideoMeta = {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
};

export type CaptionSource =
  | "youtubei"
  | "android"
  | "android_vr"
  | "ios"
  | "html"
  | "timedtext"
  | "transcript"
  | "invidious"
  | "whisper"
  | "client"
  | "kome"
  | "bundle"
  | "store";

export type CaptionBundle = {
  captions: CaptionLine[];
  durationSec: number;
  title?: string;
  author?: string;
  source: CaptionSource;
  audioUrl?: string;
};

const UA_WEB =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_VR =
  "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/102.0.5005.61)";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const UA_IOS = "com.google.ios.youtube/20.20.1 (iPhone16,2; U; CPU iOS 18_4 like Mac OS X)";

const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const WEB_VERSION = "2.20260826.01.00";

const bundleCache = new Map<string, { at: number; bundle: CaptionBundle }>();
const BUNDLE_TTL_MS = 10 * 60 * 1000;
let visitorMemo: { at: number; visitor: string } | null = null;
const VISITOR_TTL_MS = 25 * 60 * 1000;

async function getVisitorData(): Promise<string | undefined> {
  if (visitorMemo && Date.now() - visitorMemo.at < VISITOR_TTL_MS && visitorMemo.visitor.length > 20) {
    return visitorMemo.visitor;
  }
  try {
    const res = await fetch("https://www.youtube.com/", {
      headers: {
        "User-Agent": UA_WEB,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const visitor =
      /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ||
      /"visitorData":"([^"]+)"/.exec(html)?.[1];
    if (visitor && visitor.length > 20) {
      visitorMemo = { at: Date.now(), visitor };
      return visitor;
    }
  } catch (err) {
    console.info("[tubeshadow-captions] visitor failed", err instanceof Error ? err.message : err);
  }
  return visitorMemo?.visitor;
}

const INVIDIOUS_HOSTS = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.protokolla.fi",
  "https://vid.puffyan.us",
  "https://iv.melmac.space",
  "https://invidious.fdn.fr",
];

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

export async function fetchCaptionBundle(videoId: string, durationHintSec?: number): Promise<CaptionBundle> {
  const hit = bundleCache.get(videoId);
  if (hit && Date.now() - hit.at < BUNDLE_TTL_MS) return hit.bundle;

  const bundle = await fetchCaptionBundleUncached(videoId, durationHintSec);
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
      hasAudio: Boolean(bundle.audioUrl),
    }),
  );
  return bundle;
}

export function captionBundleFromClient(
  captions: CaptionLine[],
  meta: { title?: string; author?: string; durationSec?: number },
): CaptionBundle {
  const clean = sanitizeCaptionLines(captions);
  const durationSec = meta.durationSec && meta.durationSec > 0 ? meta.durationSec : lastCaptionEnd(clean);
  return {
    captions: clean,
    durationSec,
    title: meta.title,
    author: meta.author,
    source: "client",
  };
}

export async function fetchPlayableAudio(videoId: string): Promise<{
  url: string;
  durationSec: number;
  title?: string;
  author?: string;
} | null> {
  const android = await fetchViaAndroidPlayer(videoId);
  if (android.audioUrl) {
    return { url: android.audioUrl, durationSec: android.durationSec, title: android.title, author: android.author };
  }
  const ios = await fetchViaIosPlayer(videoId);
  if (ios.audioUrl) {
    return { url: ios.audioUrl, durationSec: ios.durationSec, title: ios.title, author: ios.author };
  }
  const inv = await fetchInvidiousAudio(videoId);
  if (inv) return inv;
  return null;
}

async function fetchCaptionBundleUncached(videoId: string, durationHintSec?: number): Promise<CaptionBundle> {
  const bundled = bundledCaptionBundle(videoId);
  if (bundled && bundled.captions.length >= 4) {
    console.info("[tubeshadow-captions]", JSON.stringify({ videoId, source: "bundle", captionCount: bundled.captions.length }));
    return bundled;
  }
  const stored = await readStoredCaptions(videoId);
  if (stored && stored.captions.length >= 4) {
    console.info("[tubeshadow-captions]", JSON.stringify({ videoId, source: "store", captionCount: stored.captions.length }));
    return stored;
  }

  const android = await fetchViaAndroidPlayer(videoId);
  if (android.captions.length >= 4) {
    void persistCaptions(videoId, android);
    return android;
  }

  const second = await mergeBundles(
    await Promise.all([
      Promise.resolve(android),
      fetchViaGetTranscript(videoId),
      fetchViaTimedtextDirect(videoId),
      fetchViaIosPlayer(videoId),
      fetchViaYoutubei(videoId),
      fetchViaWatchHtml(videoId),
      fetchViaInvidious(videoId),
      fetchViaAndroidVr(videoId),
    ]),
  );
  const result = {
    ...second,
    audioUrl: second.audioUrl || android.audioUrl,
  };
  if (result.captions.length >= 4) {
    void persistCaptions(videoId, result);
    return result;
  }
  return {
    captions: [],
    durationSec: second.durationSec || android.durationSec,
    title: second.title || android.title,
    author: second.author || android.author,
    source: second.source || android.source,
    audioUrl: second.audioUrl || android.audioUrl,
  };
}

async function readStoredCaptions(videoId: string): Promise<CaptionBundle | null> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      source: string;
      title: string | null;
      duration_sec: number | string;
      captions: CaptionLine[] | string;
    }>`
      select source, title, duration_sec, captions
      from video_captions
      where video_id = ${videoId}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const raw = typeof row.captions === "string" ? JSON.parse(row.captions) : row.captions;
    const captions = sanitizeCaptionLines(raw);
    if (captions.length < 4) return null;
    return {
      captions,
      durationSec: Number(row.duration_sec) || 0,
      title: row.title || undefined,
      source: "store",
    };
  } catch {
    return null;
  }
}

async function persistCaptions(videoId: string, bundle: CaptionBundle) {
  const captions = sanitizeCaptionLines(bundle.captions);
  if (captions.length < 4) return;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into video_captions (video_id, source, title, duration_sec, captions, updated_at)
      values (
        ${videoId},
        ${bundle.source},
        ${bundle.title ?? null},
        ${bundle.durationSec},
        ${JSON.stringify(captions)}::jsonb,
        now()
      )
      on conflict (video_id) do update set
        source = excluded.source,
        title = coalesce(excluded.title, video_captions.title),
        duration_sec = excluded.duration_sec,
        captions = excluded.captions,
        updated_at = now()
    `;
  } catch (err) {
    console.info("[tubeshadow-captions] persist failed", err instanceof Error ? err.message : err);
  }
}

function mergeBundles(bundles: CaptionBundle[]): CaptionBundle {
  const hit = bundles.find((b) => b.captions.length >= 4);
  if (hit) {
    return { ...hit, audioUrl: hit.audioUrl || bundles.find((b) => b.audioUrl)?.audioUrl };
  }
  const ranked = [...bundles].sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0));
  const best = ranked[0] ?? { captions: [], durationSec: 0, source: "android" as const };
  return {
    ...best,
    title: bundles.find((b) => b.title)?.title,
    author: bundles.find((b) => b.author)?.author,
    audioUrl: bundles.find((b) => b.audioUrl)?.audioUrl,
  };
}

async function fetchViaAndroidPlayer(videoId: string): Promise<CaptionBundle> {
  const visitor = await getVisitorData();
  const versions = [
    { version: "20.10.38", sdk: 34 },
    { version: "19.47.53", sdk: 30 },
    { version: "18.48.39", sdk: 30 },
  ];
  let last: CaptionBundle = { captions: [], durationSec: 0, source: "android" };
  for (const { version, sdk } of versions) {
    try {
      const player = await innertubePlayer({
        videoId,
        clientName: "ANDROID",
        clientVersion: version,
        apiKey: ANDROID_KEY,
        ua: UA_ANDROID,
        clientNameHeader: "3",
        visitor,
        extraClient: { androidSdkVersion: sdk, osName: "Android", osVersion: "14", platform: "MOBILE", hl: "en", gl: "US" },
      });
      const bundle = await bundleFromPlayer(player, "android", UA_ANDROID, visitor);
      last = mergeAudio(bundle, player);
      if (last.captions.length >= 4) return last;
      const status = player.playabilityStatus?.status;
      if (status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") break;
    } catch (err) {
      console.info("[tubeshadow-captions] android failed", version, err instanceof Error ? err.message : err);
    }
  }
  return last;
}

async function fetchViaIosPlayer(videoId: string): Promise<CaptionBundle> {
  try {
    const visitor = await getVisitorData();
    const player = await innertubePlayer({
      videoId,
      clientName: "IOS",
      clientVersion: "20.20.1",
      apiKey: IOS_KEY,
      ua: UA_IOS,
      clientNameHeader: "5",
      visitor,
      extraClient: {
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iOS",
        osVersion: "18.4.0",
        hl: "en",
        gl: "US",
      },
    });
    return mergeAudio(await bundleFromPlayer(player, "ios", UA_IOS, visitor), player);
  } catch (err) {
    console.info("[tubeshadow-captions] ios failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "ios" };
  }
}

async function fetchViaGetTranscript(videoId: string): Promise<CaptionBundle> {
  try {
    const visitor = await getVisitorData();
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const nextRes = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA_WEB,
        Origin: "https://www.youtube.com",
        Referer: watchUrl,
        ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: WEB_VERSION,
            hl: "en",
            gl: "US",
            originalUrl: watchUrl,
            platform: "DESKTOP",
            ...(visitor ? { visitorData: visitor } : {}),
          },
        },
        videoId,
      }),
    });
    if (!nextRes.ok) return { captions: [], durationSec: 0, source: "transcript" };
    const next = (await nextRes.json()) as Record<string, unknown>;
    const fromNextVisitor = asString((next.responseContext as { visitorData?: string } | undefined)?.visitorData);
    const sessionVisitor = fromNextVisitor || visitor;
    const packed = JSON.stringify(next);
    const params = /"getTranscriptEndpoint":\{"params":"([^"]+)"/.exec(packed)?.[1];
    const click = /"clickTrackingParams":"([^"]+)"/.exec(packed)?.[1];
    if (!params) return { captions: extractTimedLinesFromUnknown(next), durationSec: 0, source: "transcript" };

    const variants = [params, decodeURIComponent(params)];
    for (const p of variants) {
      const res = await fetch("https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA_WEB,
          Origin: "https://www.youtube.com",
          Referer: watchUrl,
          "X-Goog-Visitor-Id": sessionVisitor || "",
          "X-Youtube-Client-Name": "1",
          "X-Youtube-Client-Version": WEB_VERSION,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: WEB_VERSION,
              hl: "en",
              gl: "US",
              visitorData: sessionVisitor,
              originalUrl: watchUrl,
              platform: "DESKTOP",
            },
            clickTracking: click ? { clickTrackingParams: click } : undefined,
            user: { lockedSafetyMode: false },
          },
          params: p,
        }),
      });
      const body = await res.text();
      if (!res.ok) {
        console.info("[tubeshadow-captions] get_transcript", res.status, body.slice(0, 120).replace(/\s+/g, " "));
        continue;
      }
      const captions = parseCaptionBody(body);
      if (captions.length >= 4) {
        return { captions, durationSec: lastCaptionEnd(captions), source: "transcript" };
      }
    }
    const fromNext = extractTimedLinesFromUnknown(next);
    return { captions: fromNext, durationSec: lastCaptionEnd(fromNext), source: "transcript" };
  } catch (err) {
    console.info("[tubeshadow-captions] get_transcript failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "transcript" };
  }
}

async function fetchViaYoutubei(videoId: string): Promise<CaptionBundle> {
  const clients: Array<string | undefined> = [undefined, "ANDROID", "ANDROID_VR"];
  let last: CaptionBundle = { captions: [], durationSec: 0, source: "youtubei" };
  for (const client of clients) {
    try {
      const tube = await getInnertube(client);
      const info = await tube.getBasicInfo(videoId);
      const play = (info as { playability_status?: { status?: string } }).playability_status?.status;
      if (play && play !== "OK") {
        innertubeByClient.delete(client ?? "WEB");
        console.info("[tubeshadow-captions] youtubei playability", JSON.stringify({ videoId, client: client ?? "WEB", play }));
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
      const captions = await downloadTimedtext(url, UA_WEB, await getVisitorData());
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
    getBasicInfo: (id: string) => Promise<{
      basic_info?: { duration?: number; title?: string; author?: string | { name?: string } };
      captions?: { caption_tracks?: CaptionTrack[] };
      playability_status?: { status?: string };
    }>;
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
    const visitor = await getVisitorData();
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA_VR,
        Origin: "https://www.youtube.com",
        ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: "1.60.19",
            androidSdkVersion: 32,
            hl: "en",
            gl: "US",
            ...(visitor ? { visitorData: visitor } : {}),
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
    return mergeAudio(await bundleFromPlayer(player, "android_vr", UA_VR, visitor), player);
  } catch (err) {
    console.info("[tubeshadow-captions] android_vr failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "android_vr" };
  }
}

async function fetchViaWatchHtml(videoId: string): Promise<CaptionBundle> {
  const uas = [UA_WEB, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"];
  for (const ua of uas) {
    try {
      const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9" },
      });
      if (!watch.ok) continue;
      const html = await watch.text();
      const player = extractJsonObject(html, "ytInitialPlayerResponse") as PlayerResponse | null;
      const data = extractJsonObject(html, "ytInitialData");
      const fromData = data ? extractTimedLinesFromUnknown(data) : [];
      if (fromData.length >= 4) {
        const durationSec = Number(player?.videoDetails?.lengthSeconds) || lastCaptionEnd(fromData);
        return {
          captions: fromData,
          durationSec,
          title: player?.videoDetails?.title,
          author: player?.videoDetails?.author,
          source: "html",
        };
      }
      if (player) {
        const bundle = await bundleFromPlayer(player, "html", ua, await getVisitorData());
        if (bundle.captions.length >= 4) return bundle;
      }
    } catch (err) {
      console.info("[tubeshadow-captions] html failed", err instanceof Error ? err.message : err);
    }
  }
  return { captions: [], durationSec: 0, source: "html" };
}

async function fetchViaTimedtextDirect(videoId: string): Promise<CaptionBundle> {
  try {
    const visitor = await getVisitorData();
    const headers: Record<string, string> = {
      "User-Agent": UA_ANDROID,
      Referer: "https://www.youtube.com/",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.youtube.com",
    };
    if (visitor) headers["X-Goog-Visitor-Id"] = visitor;
    const listRes = await fetch(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`, { headers });
    const listXml = listRes.ok ? await listRes.text() : "";
    const tracks = [...parseTimedtextList(listXml)].sort((a, b) => scoreTimedtextTrack(a) - scoreTimedtextTrack(b));
    const guesses = tracks.length
      ? tracks
      : [
          { lang: "en", kind: "asr" },
          { lang: "en" },
          { lang: "ko" },
        ];
    for (const track of guesses.slice(0, 6)) {
      const kind = track.kind ? `&kind=${encodeURIComponent(track.kind)}` : "";
      const name = track.name ? `&name=${encodeURIComponent(track.name)}` : "";
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(track.lang)}${kind}${name}&fmt=srv3`;
      const captions = await downloadTimedtext(url, UA_ANDROID, visitor);
      if (captions.length > 0) {
        return { captions, durationSec: lastCaptionEnd(captions), source: "timedtext" };
      }
    }
  } catch (err) {
    console.info("[tubeshadow-captions] timedtext direct failed", err instanceof Error ? err.message : err);
  }
  return { captions: [], durationSec: 0, source: "timedtext" };
}

async function fetchViaInvidious(videoId: string): Promise<CaptionBundle> {
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const listRes = await fetch(`${host}/api/v1/captions/${videoId}`, {
        headers: { Accept: "application/json", "User-Agent": UA_WEB },
        signal: AbortSignal.timeout(8000),
      });
      if (!listRes.ok) continue;
      const listed = (await listRes.json()) as {
        captions?: { label?: string; languageCode?: string; url?: string }[];
      };
      const tracks = listed.captions ?? [];
      const ordered = [...tracks].sort((a, b) => {
        const la = (a.languageCode || "").toLowerCase();
        const lb = (b.languageCode || "").toLowerCase();
        return Number(lb.startsWith("en")) - Number(la.startsWith("en"));
      });
      for (const track of ordered.slice(0, 4)) {
        if (!track.url) continue;
        const capUrl = track.url.startsWith("http") ? track.url : `${host}${track.url}`;
        const captions = await downloadCaptionUrl(capUrl, UA_WEB);
        if (captions.length >= 4) {
          return { captions, durationSec: lastCaptionEnd(captions), source: "invidious" };
        }
      }
    } catch (err) {
      console.info("[tubeshadow-captions] invidious failed", host, err instanceof Error ? err.message : err);
    }
  }
  return { captions: [], durationSec: 0, source: "invidious" };
}

async function fetchViaKome(videoId: string, durationHintSec = 0): Promise<CaptionBundle> {
  try {
    const res = await fetch("https://kome.ai/api/transcript", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": UA_WEB,
      },
      body: JSON.stringify({ video_id: videoId, format: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.info("[tubeshadow-captions] kome", res.status);
      return { captions: [], durationSec: 0, source: "kome" };
    }
    const json = (await res.json()) as { transcript?: string };
    const text = typeof json.transcript === "string" ? json.transcript.trim() : "";
    if (text.length < 40) return { captions: [], durationSec: 0, source: "kome" };
    const captions = timedFromPlainTranscript(text, durationHintSec);
    console.info(
      "[tubeshadow-captions] kome",
      JSON.stringify({ videoId, captionCount: captions.length, chars: text.length }),
    );
    return { captions, durationSec: durationHintSec || lastCaptionEnd(captions), source: "kome" };
  } catch (err) {
    console.info("[tubeshadow-captions] kome failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "kome" };
  }
}

function timedFromPlainTranscript(text: string, durationSec: number): CaptionLine[] {
  const parts = text
    .split(/\n+|>>/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 8);
  const chunks: string[] = [];
  for (const part of parts) {
    const words = part.split(" ");
    if (words.length <= 16) {
      chunks.push(part);
      continue;
    }
    for (let i = 0; i < words.length; i += 12) {
      const slice = words.slice(i, i + 12).join(" ");
      if (slice.length > 8) chunks.push(slice);
    }
  }
  if (chunks.length < 4) return [];
  const weights = chunks.map((c) => Math.max(4, c.split(" ").length));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = durationSec > 30 ? durationSec : Math.max(60, total / 2.4);
  let t = 0;
  return chunks.map((c, i) => {
    const dur = Math.max(1.4, (weights[i] / total) * span);
    const line = { start: t, dur, text: c };
    t += dur;
    return line;
  });
}

async function fetchInvidiousAudio(videoId: string): Promise<{ url: string; durationSec: number; title?: string } | null> {
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const res = await fetch(`${host}/latest_version?id=${videoId}&itag=140`, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": UA_WEB },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        return { url: loc, durationSec: 0 };
      }
      const video = await fetch(`${host}/api/v1/videos/${videoId}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!video.ok) continue;
      const json = (await video.json()) as {
        title?: string;
        lengthSeconds?: number;
        adaptiveFormats?: { url?: string; type?: string; itag?: string | number }[];
      };
      const audio = (json.adaptiveFormats ?? []).find((f) => String(f.type || "").includes("audio") && f.url);
      if (audio?.url) {
        const url = audio.url.startsWith("http") ? audio.url : `${host}${audio.url}`;
        return { url, durationSec: Number(json.lengthSeconds) || 0, title: json.title };
      }
    } catch {
      /* next instance */
    }
  }
  return null;
}

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string | number };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
    };
  };
  streamingData?: {
    adaptiveFormats?: { url?: string; mimeType?: string; bitrate?: number; audioSampleRate?: string }[];
    formats?: { url?: string; mimeType?: string; bitrate?: number }[];
  };
};

async function innertubePlayer(opts: {
  videoId: string;
  clientName: string;
  clientVersion: string;
  apiKey: string;
  ua: string;
  clientNameHeader: string;
  extraClient?: Record<string, unknown>;
  visitor?: string;
}): Promise<PlayerResponse> {
  const hosts = [
    "https://youtubei.googleapis.com/youtubei/v1/player",
    "https://www.youtube.com/youtubei/v1/player",
  ];
  let last: PlayerResponse = { playabilityStatus: { status: "EMPTY" } };
  for (const host of hosts) {
    const needsVisitor = host.includes("www.youtube.com");
    const visitor = needsVisitor ? (opts.visitor ?? (await getVisitorData())) : undefined;
    try {
      const res = await fetch(`${host}?key=${opts.apiKey}&prettyPrint=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": opts.ua,
          "X-YouTube-Client-Name": opts.clientNameHeader,
          "X-YouTube-Client-Version": opts.clientVersion,
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
          ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: opts.clientName,
              clientVersion: opts.clientVersion,
              hl: "en",
              gl: "US",
              ...opts.extraClient,
              ...(visitor ? { visitorData: visitor } : {}),
            },
          },
          videoId: opts.videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        last = { playabilityStatus: { status: `HTTP_${res.status}` } };
        continue;
      }
      const json = (await res.json()) as PlayerResponse;
      const tracks = json.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0;
      const status = json.playabilityStatus?.status;
      if (status === "OK" || tracks > 0) {
        console.info(
          "[tubeshadow-captions] player host",
          JSON.stringify({ host: host.replace("https://", ""), status: status ?? "OK", tracks, client: opts.clientName }),
        );
        return json;
      }
      last = json;
    } catch (err) {
      last = { playabilityStatus: { status: err instanceof Error ? err.message : "fetch_failed" } };
    }
  }
  return last;
}

function pickAudioUrl(player: PlayerResponse): string | undefined {
  const formats = [...(player.streamingData?.adaptiveFormats ?? []), ...(player.streamingData?.formats ?? [])];
  const audio = formats
    .filter((f) => f.url && /audio/i.test(f.mimeType || ""))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return audio[0]?.url || formats.find((f) => f.url)?.url;
}

function mergeAudio(bundle: CaptionBundle, player: PlayerResponse): CaptionBundle {
  const audioUrl = pickAudioUrl(player);
  return audioUrl ? { ...bundle, audioUrl } : bundle;
}

async function bundleFromPlayer(
  player: PlayerResponse,
  source: CaptionBundle["source"],
  ua: string,
  visitor?: string,
): Promise<CaptionBundle> {
  const durationSec = Number(player.videoDetails?.lengthSeconds) || 0;
  const title = player.videoDetails?.title;
  const author = player.videoDetails?.author;
  const status = player.playabilityStatus?.status;
  if (status && status !== "OK") {
    console.info("[tubeshadow-captions] player", JSON.stringify({ source, status, reason: player.playabilityStatus?.reason }));
  }
  const raw = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: CaptionTrack[] = raw.map((t) => ({
    base_url: t.baseUrl,
    language_code: t.languageCode,
    kind: t.kind,
  }));
  const track = pickTrack(tracks);
  const url = track?.base_url;
  if (!url) return { captions: [], durationSec, title, author, source };
  const captions = await downloadTimedtext(url, ua, visitor);
  if (captions.length === 0) {
    console.info(
      "[tubeshadow-captions] timedtext empty",
      JSON.stringify({ source, durationSec, exp: url.includes("exp="), lang: track?.language_code || track?.languageCode }),
    );
  }
  return { captions, durationSec, title, author, source };
}

async function downloadTimedtext(baseUrl: string, ua: string, visitor?: string): Promise<CaptionLine[]> {
  const urls = timedtextVariants(baseUrl);
  for (const url of urls) {
    const lines = await downloadCaptionUrl(url, ua, visitor);
    if (lines.length > 0) return lines;
  }
  return [];
}

async function downloadCaptionUrl(url: string, ua: string, visitor?: string): Promise<CaptionLine[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.youtube.com/",
        Origin: "https://www.youtube.com",
        ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    return parseCaptionBody(await res.text());
  } catch {
    return [];
  }
}

function timedtextVariants(baseUrl: string): string[] {
  const abs = baseUrl.startsWith("http") ? baseUrl : `https://www.youtube.com${baseUrl.startsWith("/") ? "" : "/"}${baseUrl}`;
  const urls: string[] = [];
  const push = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  try {
    const parsed = new URL(abs);
    parsed.searchParams.delete("pot");
    parsed.searchParams.delete("potc");
    parsed.searchParams.delete("exp");
    for (const fmt of ["srv3", "json3", "vtt"]) {
      parsed.searchParams.set("fmt", fmt);
      push(parsed.toString());
    }
  } catch {
    push(`${abs}${abs.includes("?") ? "&" : "?"}fmt=srv3`);
    push(`${abs}${abs.includes("?") ? "&" : "?"}fmt=json3`);
  }
  return urls;
}

function lastCaptionEnd(captions: CaptionLine[]): number {
  if (!captions.length) return 0;
  const last = captions[captions.length - 1];
  return last.start + Math.max(0.4, last.dur || 0);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
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
