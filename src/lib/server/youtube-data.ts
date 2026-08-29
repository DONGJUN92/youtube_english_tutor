import { bundledCaptionBundle } from "@/data/caption-bundles";
import {
  extractTimedLinesFromUnknown,
  parseCaptionBody,
  parseTimedtextList,
  sanitizeCaptionLines,
  scoreTimedtextTrack,
  timedtextFetchVariants,
  isYoutubeTimedtextUrl,
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
  | "store"
  | "pending"
  | "gha"
  | "edge";

export type CaptionBundle = {
  captions: CaptionLine[];
  durationSec: number;
  title?: string;
  author?: string;
  source: CaptionSource;
  audioUrl?: string;
  trackUrls?: string[];
};

const UA_WEB =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_VR =
  "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/102.0.5005.61)";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const UA_IOS = "com.google.ios.youtube/20.20.1 (iPhone16,2; U; CPU iOS 18_4 like Mac OS X)";
const UA_TV = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version";

const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const WEB_VERSION = "2.20260826.01.00";

const bundleCache = new Map<string, { at: number; bundle: CaptionBundle }>();
const BUNDLE_TTL_MS = 10 * 60 * 1000;
let visitorMemo: { at: number; visitor: string; cookie?: string } | null = null;
const VISITOR_TTL_MS = 25 * 60 * 1000;

async function mintAndroidVisitor(): Promise<string | undefined> {
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: "config", body: {} },
    { path: "guide", body: {} },
  ];
  for (const { path, body } of bodies) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA_ANDROID,
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
          "X-YouTube-Client-Name": "3",
          "X-YouTube-Client-Version": "20.10.38",
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: "20.10.38",
              androidSdkVersion: 34,
              hl: "en",
              gl: "US",
              osName: "Android",
              osVersion: "14",
            },
          },
          ...body,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { responseContext?: { visitorData?: string } };
      const visitor = json.responseContext?.visitorData;
      if (visitor && visitor.length > 20) return visitor;
    } catch (err) {
      console.info("[tubeshadow-captions] android visitor", path, err instanceof Error ? err.message : err);
    }
  }
  return undefined;
}

async function getVisitorSession(): Promise<{ visitor?: string; cookie?: string }> {
  if (visitorMemo && Date.now() - visitorMemo.at < VISITOR_TTL_MS && visitorMemo.visitor.length > 20) {
    return { visitor: visitorMemo.visitor, cookie: visitorMemo.cookie };
  }
  const androidVisitor = await mintAndroidVisitor();
  if (androidVisitor) {
    visitorMemo = { at: Date.now(), visitor: androidVisitor };
    return { visitor: androidVisitor };
  }
  try {
    const res = await fetch("https://www.youtube.com/", {
      headers: {
        "User-Agent": UA_ANDROID,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const visitor =
      /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ||
      /"visitorData":"([^"]+)"/.exec(html)?.[1];
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ") || undefined;
    if (visitor && visitor.length > 20) {
      visitorMemo = { at: Date.now(), visitor, cookie };
      return { visitor, cookie };
    }
    if (cookie) return { visitor: visitorMemo?.visitor, cookie };
  } catch (err) {
    console.info("[tubeshadow-captions] visitor failed", err instanceof Error ? err.message : err);
  }
  return { visitor: visitorMemo?.visitor, cookie: visitorMemo?.cookie };
}


export async function getVisitorData(): Promise<string | undefined> {
  const session = await getVisitorSession();
  return session.visitor;
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

export type CaptionFetchOpts = {
  poToken?: string;
  visitorData?: string;
};

export async function fetchCaptionBundle(videoId: string, durationHintSec?: number, opts?: CaptionFetchOpts): Promise<CaptionBundle> {

  const hit = bundleCache.get(videoId);
  if (hit && Date.now() - hit.at < BUNDLE_TTL_MS && !opts?.poToken) return hit.bundle;

  const bundle = await fetchCaptionBundleUncached(videoId, durationHintSec, opts);
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
      pot: Boolean(opts?.poToken),
      tracks: bundle.trackUrls?.length ?? 0,
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

export async function storeClientCaptions(
  videoId: string,
  captions: CaptionLine[],
  meta?: { title?: string; durationSec?: number },
): Promise<CaptionBundle> {
  const bundle = captionBundleFromClient(captions, meta ?? {});
  if (bundle.captions.length >= 4) {
    bundleCache.set(videoId, { at: Date.now(), bundle });
    await persistCaptions(videoId, bundle);
  }
  return bundle;
}

export async function peekCaptionBundle(videoId: string): Promise<CaptionBundle | null> {
  const hit = bundleCache.get(videoId);
  if (hit && Date.now() - hit.at < BUNDLE_TTL_MS && hit.bundle.captions.length >= 4) return hit.bundle;
  const stored = await readStoredCaptions(videoId);
  if (stored && stored.captions.length >= 4) return stored;
  return null;
}

export async function enqueueCaptionJob(videoId: string): Promise<void> {
  if (!videoId || videoId.length < 8) return;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into video_captions (video_id, source, title, duration_sec, captions, updated_at)
      values (${videoId}, 'pending', null, 0, '[]'::jsonb, now())
      on conflict (video_id) do update set
        updated_at = now()
      where video_captions.source = 'pending'
    `;
  } catch (err) {
    console.info("[tubeshadow-captions] enqueue failed", err instanceof Error ? err.message : err);
  }
  void kickCaptionWorker(videoId);
}

export async function listPendingCaptionJobs(): Promise<string[]> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ video_id: string }>`
      select video_id
      from video_captions
      where source = 'pending' and updated_at > now() - interval '40 minutes'
      order by updated_at asc
      limit 12
    `;
    return rows.map((row) => row.video_id);
  } catch {
    return [];
  }
}

async function kickCaptionWorker(videoId: string) {
  const token = process.env.GITHUB_CAPTIONS_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token || token.length < 12) return;
  const repo = process.env.GITHUB_REPOSITORY || "DONGJUN92/youtube_english_tutor";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "tubeshadow",
      },
      body: JSON.stringify({ event_type: "fetch-captions", client_payload: { video_id: videoId } }),
      signal: AbortSignal.timeout(8000),
    });
    console.info("[tubeshadow-captions] gha dispatch", res.status, videoId);
  } catch (err) {
    console.info("[tubeshadow-captions] gha dispatch failed", err instanceof Error ? err.message : err);
  }
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

async function fetchCaptionBundleUncached(videoId: string, durationHintSec?: number, opts?: CaptionFetchOpts): Promise<CaptionBundle> {
  void enqueueCaptionJob(videoId);

  const android = await fetchViaAndroidPlayer(videoId, opts);
  if (android.captions.length >= 4) {
    void persistCaptions(videoId, android);
    return android;
  }

  if (process.env.VERCEL) {
    const edge = await fetchViaVercelEdge(videoId);
    if (edge.captions.length >= 4) {
      void persistCaptions(videoId, edge);
      return edge;
    }
    const storedFast = await readStoredCaptions(videoId);
    if (storedFast && storedFast.captions.length >= 4) return storedFast;
    void enqueueCaptionJob(videoId);
    return {
      captions: [],
      durationSec: android.durationSec,
      title: android.title,
      author: android.author,
      source: android.source,
      audioUrl: android.audioUrl,
      trackUrls: android.trackUrls,
    };
  }

  const ios = await fetchViaIosPlayer(videoId);
  if (ios.captions.length >= 4) {
    void persistCaptions(videoId, ios);
    return ios;
  }

  const stored = await readStoredCaptions(videoId);
  if (stored && stored.captions.length >= 4) {
    console.info("[tubeshadow-captions]", JSON.stringify({ videoId, source: "store", captionCount: stored.captions.length }));
    return stored;
  }

  const second = await mergeBundles(
    await Promise.all([
      Promise.resolve(android),
      Promise.resolve(ios),
      opts?.poToken ? fetchViaWebPlayer(videoId, opts) : Promise.resolve({ captions: [], durationSec: 0, source: "youtubei" as const }),
      fetchViaGetTranscript(videoId),
      fetchViaTimedtextDirect(videoId),
      fetchViaYoutubei(videoId),
      fetchViaWatchHtml(videoId),
      fetchViaInvidious(videoId),
      fetchViaAndroidVr(videoId),
    ]),
  );
  const result = {
    ...second,
    audioUrl: second.audioUrl || android.audioUrl,
    trackUrls: second.trackUrls?.length ? second.trackUrls : android.trackUrls,
  };
  if (result.captions.length >= 4) {
    void persistCaptions(videoId, result);
    return result;
  }

  const bundled = bundledCaptionBundle(videoId);
  if (bundled && bundled.captions.length >= 4) {
    console.info("[tubeshadow-captions]", JSON.stringify({ videoId, source: "bundle", captionCount: bundled.captions.length }));
    return bundled;
  }

  void enqueueCaptionJob(videoId);
  return {
    captions: [],
    durationSec: second.durationSec || android.durationSec || ios.durationSec,
    title: second.title || android.title || ios.title,
    author: second.author || android.author,
    source: second.source || android.source,
    audioUrl: second.audioUrl || android.audioUrl,
    trackUrls: result.trackUrls,
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
  let lastErr = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
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
      console.info("[tubeshadow-captions] persist ok", JSON.stringify({ videoId, captionCount: captions.length, attempt }));
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.info("[tubeshadow-captions] persist failed", attempt, lastErr);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  console.info("[tubeshadow-captions] persist gave up", videoId, lastErr);
}

function mergeBundles(bundles: CaptionBundle[]): CaptionBundle {
  const hit = bundles.find((b) => b.captions.length >= 4);
  if (hit) {
    return {
      ...hit,
      audioUrl: hit.audioUrl || bundles.find((b) => b.audioUrl)?.audioUrl,
      trackUrls: hit.trackUrls?.length ? hit.trackUrls : bundles.find((b) => b.trackUrls?.length)?.trackUrls,
    };
  }
  const ranked = [...bundles].sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0));
  const best = ranked[0] ?? { captions: [], durationSec: 0, source: "android" as const };
  return {
    ...best,
    title: bundles.find((b) => b.title)?.title,
    author: bundles.find((b) => b.author)?.author,
    audioUrl: bundles.find((b) => b.audioUrl)?.audioUrl,
    trackUrls: bundles.find((b) => b.trackUrls?.length)?.trackUrls,
  };
}

const edgeInflight = new Set<string>();

async function fetchViaVercelEdge(videoId: string): Promise<CaptionBundle> {
  if (!process.env.VERCEL) return { captions: [], durationSec: 0, source: "edge" };
  if (edgeInflight.has(videoId)) return { captions: [], durationSec: 0, source: "edge" };
  const hosts = [
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    "https://tubeshadow.vercel.app",
  ].filter((host, index, all) => host && all.indexOf(host) === index);
  edgeInflight.add(videoId);
  try {
    for (const host of hosts) {
      try {
        const res = await fetch(`${host}/api/yt-edge?v=${encodeURIComponent(videoId)}`, {
          headers: { Accept: "application/json", "x-ts-edge": "1" },
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          ok?: boolean;
          source?: string;
          play?: string;
          title?: string;
          durationSec?: number;
          captions?: CaptionLine[];
          trackUrls?: string[];
        };
        const captions = sanitizeCaptionLines(json.captions);
        console.info(
          "[tubeshadow-captions] edge",
          JSON.stringify({
            videoId,
            play: json.play,
            captionCount: captions.length,
            tracks: json.trackUrls?.length ?? 0,
            host: host.replace("https://", ""),
          }),
        );
        if (captions.length >= 4) {
          return {
            captions,
            durationSec: Number(json.durationSec) || lastCaptionEnd(captions),
            title: json.title,
            source: "edge",
            trackUrls: Array.isArray(json.trackUrls) ? json.trackUrls.filter((u): u is string => typeof u === "string") : [],
          };
        }
      } catch (err) {
        console.info("[tubeshadow-captions] edge failed", host, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    edgeInflight.delete(videoId);
  }
  return { captions: [], durationSec: 0, source: "edge" };
}

async function fetchViaAndroidPlayer(videoId: string, opts?: CaptionFetchOpts): Promise<CaptionBundle> {
  let visitor = opts?.visitorData || (await getVisitorData());
  const versions = [
    { version: "20.10.38", sdk: 34 },
    { version: "19.47.53", sdk: 30 },
    { version: "18.48.39", sdk: 30 },
  ];
  let last: CaptionBundle = { captions: [], durationSec: 0, source: "android" };
  let refreshedVisitor = false;
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
        poToken: opts?.poToken,
        extraClient: { androidSdkVersion: sdk, osName: "Android", osVersion: "14", platform: "MOBILE", hl: "en", gl: "US" },
      });
      const bundle = await bundleFromPlayer(player, "android", UA_ANDROID, visitor);
      last = mergeAudio(bundle, player);
      if (last.captions.length >= 4) return last;
      const status = player.playabilityStatus?.status;
      if ((status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") && !refreshedVisitor && !opts?.visitorData) {
        visitorMemo = null;
        visitor = (await mintAndroidVisitor()) || (await getVisitorData());
        refreshedVisitor = true;
        continue;
      }
    } catch (err) {
      console.info("[tubeshadow-captions] android failed", version, err instanceof Error ? err.message : err);
    }
  }
  return last;
}

async function fetchViaWebPlayer(videoId: string, opts?: CaptionFetchOpts): Promise<CaptionBundle> {
  try {
    const visitor = opts?.visitorData || (await getVisitorData());
    const player = await innertubePlayer({
      videoId,
      clientName: "WEB",
      clientVersion: WEB_VERSION,
      apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      ua: UA_WEB,
      clientNameHeader: "1",
      visitor,
      poToken: opts?.poToken,
      extraClient: { hl: "en", gl: "US", platform: "DESKTOP" },
    });
    return mergeAudio(await bundleFromPlayer(player, "youtubei", UA_WEB, visitor), player);
  } catch (err) {
    console.info("[tubeshadow-captions] web+pot failed", err instanceof Error ? err.message : err);
    return { captions: [], durationSec: 0, source: "youtubei" };
  }
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
      last = { captions: [], durationSec, title, author, source: "youtubei", trackUrls: tracks.map((t) => trackUrl(t)).filter((u): u is string => Boolean(u)) };
      const captions = await captionsFromTracks(tracks, UA_WEB, await getVisitorData());
      if (captions.length >= 4) {
        return { captions, durationSec, title, author, source: "youtubei", trackUrls: last.trackUrls };
      }
      console.info("[tubeshadow-captions] youtubei track empty", JSON.stringify({ videoId, client: client ?? "WEB", tracks: tracks.length }));
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
  isTranslatable?: boolean;
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
      captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string; isTranslatable?: boolean }[];
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
  poToken?: string;
}): Promise<PlayerResponse> {
  const hosts = [
    "https://www.youtube.com/youtubei/v1/player",
    "https://youtubei.googleapis.com/youtubei/v1/player",
  ];
  let last: PlayerResponse = { playabilityStatus: { status: "EMPTY" } };
  const session = await getVisitorSession();
  const visitor = opts.visitor ?? session.visitor;
  for (const host of hosts) {
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
          ...(session.cookie ? { Cookie: session.cookie } : {}),
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
          ...(opts.poToken ? { serviceIntegrityDimensions: { poToken: opts.poToken } } : {}),
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
          JSON.stringify({
            host: host.replace("https://", ""),
            status: status ?? "OK",
            tracks,
            client: opts.clientName,
            pot: Boolean(opts.poToken),
          }),
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
    isTranslatable: t.isTranslatable,
  }));
  const trackUrls = tracks.map((t) => t.base_url).filter((u): u is string => Boolean(u));
  const captions = await captionsFromTracks(tracks, ua, visitor);
  if (captions.length === 0) {
    console.info(
      "[tubeshadow-captions] timedtext empty",
      JSON.stringify({ source, durationSec, tracks: trackUrls.length, langs: tracks.map((t) => t.language_code || t.languageCode) }),
    );
  }
  return { captions, durationSec, title, author, source, trackUrls };
}

export async function fetchYoutubeTimedtext(url: string): Promise<CaptionLine[]> {
  if (!isYoutubeTimedtextUrl(url)) return [];
  return downloadTimedtext(url, UA_WEB, await getVisitorData());
}

async function captionsFromTracks(tracks: CaptionTrack[], ua: string, visitor?: string): Promise<CaptionLine[]> {
  const ordered = [...tracks]
    .filter((t) => trackUrl(t))
    .sort((a, b) => scoreTrack(a, (a.language_code || a.languageCode || "").toLowerCase(), trackUrl(a) ?? "") - scoreTrack(b, (b.language_code || b.languageCode || "").toLowerCase(), trackUrl(b) ?? ""));
  for (const track of ordered.slice(0, 8)) {
    const url = trackUrl(track);
    if (!url) continue;
    const captions = await downloadTimedtext(url, ua, visitor);
    if (captions.length >= 4) return captions;
  }
  return [];
}

async function downloadTimedtext(baseUrl: string, ua: string, visitor?: string): Promise<CaptionLine[]> {
  const urls = timedtextVariants(baseUrl);
  for (const url of urls) {
    const lines = await downloadCaptionUrl(url, ua, visitor);
    if (lines.length >= 4) return lines;
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
  return timedtextFetchVariants(baseUrl);
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
