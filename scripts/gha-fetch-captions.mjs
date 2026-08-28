/**
 * GitHub Actions worker: mint an ANDROID visitor, call InnerTube player,
 * download signed timedtext (timestamps included), POST to production.
 * Neon is a cache after a live fetch — not a bundled caption library.
 */
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const UA_IOS = "com.google.ios.youtube/20.20.1 (iPhone16,2; U; CPU iOS 18_4 like Mac OS X)";
const UA_TV = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version";
const POST_URL = process.env.CAPTION_POST_URL || "https://tubeshadow.vercel.app/api/captions";
const JOBS_URL = process.env.CAPTION_JOBS_URL || "https://tubeshadow.vercel.app/api/caption-jobs";

function videoIdOf(raw) {
  return String(raw || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 11);
}

function decodeEntities(raw) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return String(raw || "")
    .replace(/&([a-z]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseJson3(text) {
  try {
    const data = JSON.parse(text);
    const lines = [];
    for (const ev of data.events || []) {
      if (!ev || !ev.segs) continue;
      const t = decodeEntities(ev.segs.map((s) => (s && s.utf8) || "").join(""));
      if (!t || t === "♪" || /^\[(Music|Applause|Laughter)\]$/i.test(t)) continue;
      lines.push({
        start: (ev.tStartMs || 0) / 1000,
        dur: Math.max(0.4, (ev.dDurationMs || 2000) / 1000),
        text: t,
      });
    }
    return lines;
  } catch {
    return [];
  }
}

function parseSrv3(xml) {
  const lines = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = match[1] || "";
    const inner = decodeEntities((match[2] || "").replace(/<[^>]+>/g, " "));
    if (!inner) continue;
    const t = Number((/\bt="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    const d = Number((/\bd="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    lines.push({ start: t / 1000, dur: Math.max(0.4, d / 1000) || 2, text: inner });
  }
  return lines;
}

function parseVtt(text) {
  const lines = [];
  const blocks = String(text).replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const m = /(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/.exec(block);
    if (!m) continue;
    const toSec = (h, min, sec, ms) =>
      (h ? Number(h.slice(0, 2)) * 3600 : 0) + Number(min) * 60 + Number(sec) + Number(ms) / 1000;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const end = toSec(m[5], m[6], m[7], m[8]);
    const text = block
      .split("\n")
      .filter((row) => row && !row.includes("-->") && !/^WEBVTT/i.test(row) && !/^\d+$/.test(row))
      .join(" ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push({ start, dur: Math.max(0.4, end - start), text });
  }
  return lines;
}

function parseCaptions(body) {
  const trimmed = String(body || "").trim();
  if (!trimmed) return [];
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    const json3 = parseJson3(trimmed);
    if (json3.length) return json3;
  }
  if (/WEBVTT/i.test(trimmed)) return parseVtt(trimmed);
  return parseSrv3(trimmed);
}

async function mintAndroidVisitor() {
  const ctx = {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    androidSdkVersion: 34,
    hl: "en",
    gl: "US",
    osName: "Android",
    osVersion: "14",
    platform: "MOBILE",
  };
  for (const path of ["config", "guide"]) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA_ANDROID,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          "x-youtube-client-name": "3",
          "x-youtube-client-version": "20.10.38",
        },
        body: JSON.stringify({ context: { client: ctx } }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const visitor = data?.responseContext?.visitorData;
      if (visitor && visitor.length > 20) return visitor;
    } catch {
      /* next */
    }
  }
  return "";
}

async function playerRequest(videoId, client, visitor) {
  const hosts = ["https://www.youtube.com/youtubei/v1/player", "https://youtubei.googleapis.com/youtubei/v1/player"];
  let last = { play: "EMPTY", tracks: [], title: "", durationSec: 0 };
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}?key=${client.key}&prettyPrint=false`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": client.ua,
          "x-youtube-client-name": client.clientNameHeader,
          "x-youtube-client-version": client.clientVersion,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          ...(visitor ? { "x-goog-visitor-id": visitor } : {}),
        },
        body: JSON.stringify({
          context: { client: { ...client.context, ...(visitor ? { visitorData: visitor } : {}) } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) {
        last = { play: `HTTP_${res.status}`, tracks: [], title: "", durationSec: 0 };
        continue;
      }
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      last = {
        play: data?.playabilityStatus?.status || "OK",
        reason: data?.playabilityStatus?.reason,
        title: data?.videoDetails?.title || "",
        durationSec: Number(data?.videoDetails?.lengthSeconds) || 0,
        tracks,
      };
      if (last.play === "OK" || tracks.length) return last;
    } catch (err) {
      last = { play: String(err && err.message ? err.message : err), tracks: [], title: "", durationSec: 0 };
    }
  }
  return last;
}

async function downloadTimedtext(baseUrl, visitor) {
  const variants = [baseUrl];
  try {
    const parsed = new URL(baseUrl);
    for (const fmt of ["json3", "srv3", "vtt"]) {
      parsed.searchParams.set("fmt", fmt);
      variants.push(parsed.toString());
    }
  } catch {
    /* keep raw */
  }
  for (const url of variants) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": UA_ANDROID,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          accept: "*/*",
          ...(visitor ? { "x-goog-visitor-id": visitor } : {}),
        },
      });
      if (!res.ok) continue;
      const lines = parseCaptions(await res.text());
      if (lines.length >= 4) return lines;
    } catch {
      /* next */
    }
  }
  return [];
}

const CLIENTS = [
  {
    key: ANDROID_KEY,
    ua: UA_ANDROID,
    clientNameHeader: "3",
    clientVersion: "20.10.38",
    context: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      hl: "en",
      gl: "US",
      osName: "Android",
      osVersion: "14",
      platform: "MOBILE",
    },
  },
  {
    key: IOS_KEY,
    ua: UA_IOS,
    clientNameHeader: "5",
    clientVersion: "20.20.1",
    context: {
      clientName: "IOS",
      clientVersion: "20.20.1",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iOS",
      osVersion: "18.4.0",
      hl: "en",
      gl: "US",
    },
  },
  {
    key: ANDROID_KEY,
    ua: UA_TV,
    clientNameHeader: "7",
    clientVersion: "7.20240820.15.00",
    context: { clientName: "TVHTML5", clientVersion: "7.20240820.15.00", hl: "en", gl: "US" },
  },
];

async function viaInnertube(videoId) {
  const visitor = await mintAndroidVisitor();
  console.log("[gha-captions] visitor", JSON.stringify({ videoId, hasVisitor: Boolean(visitor), len: visitor.length }));
  let best = { play: "EMPTY", tracks: [], title: "", durationSec: 0 };
  for (const client of CLIENTS) {
    const player = await playerRequest(videoId, client, visitor);
    console.log(
      "[gha-captions] player",
      JSON.stringify({
        videoId,
        client: client.context.clientName,
        play: player.play,
        tracks: (player.tracks || []).length,
        reason: player.reason || "",
      }),
    );
    if ((player.tracks || []).length) {
      best = player;
      break;
    }
    best = player;
  }
  for (const track of best.tracks || []) {
    if (!track.baseUrl) continue;
    const captions = await downloadTimedtext(track.baseUrl, visitor);
    if (captions.length >= 4) {
      return { captions, title: best.title, durationSec: best.durationSec || 0, source: "gha" };
    }
  }
  return { captions: [], title: best.title, durationSec: best.durationSec || 0, play: best.play };
}

async function viaEmbedIntercept(videoId) {
  try {
    const { chromium } = await import("playwright");
    const { createServer } = await import("node:http");
    const html = `<!doctype html><html><body>
<div id="p"></div>
<script>
window.onYouTubeIframeAPIReady = function() {
  new YT.Player("p", {
    videoId: ${JSON.stringify(videoId)},
    width: 640, height: 360,
    playerVars: { enablejsapi: 1, cc_load_policy: 1, playsinline: 1, origin: location.origin, autoplay: 1, mute: 1 },
    events: {
      onReady: function(e) {
        try { e.target.mute(); e.target.playVideo(); e.target.loadModule("captions"); } catch (x) {}
      }
    }
  });
};
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const page = await browser.newPage();
      const hit = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 18000);
        page.on("response", async (res) => {
          const url = res.url();
          if (!url.includes("/api/timedtext") || !url.includes(videoId)) return;
          try {
            const body = await res.text();
            const captions = parseCaptions(body);
            if (captions.length >= 4) {
              clearTimeout(timer);
              resolve(captions);
            }
          } catch {
            /* keep waiting */
          }
        });
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      const captions = await hit;
      if (captions && captions.length >= 4) {
        console.log("[gha-captions] embed ok", JSON.stringify({ videoId, captionCount: captions.length }));
        return { captions, title: "", durationSec: 0, source: "gha" };
      }
    } finally {
      await browser.close().catch(() => {});
      await new Promise((resolve) => server.close(resolve));
    }
  } catch (err) {
    console.log("[gha-captions] embed failed", err instanceof Error ? err.message : err);
  }
  return { captions: [], title: "", durationSec: 0 };
}

async function postCaptions(videoId, bundle) {
  const res = await fetch(POST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: videoId,
      captions: bundle.captions,
      title: bundle.title || undefined,
      durationSec: bundle.durationSec || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  console.log("[gha-captions] post", res.status, JSON.stringify({ videoId, ok: json.ok, captionCount: json.captionCount }));
  return Boolean(json.ok);
}

async function videoIdsFromEnv() {
  const direct = videoIdOf(process.env.VIDEO_ID);
  if (direct.length >= 8) return [direct];
  try {
    const payload = process.env.GITHUB_EVENT_PATH
      ? (await import("node:fs")).readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")
      : "";
    if (payload) {
      const ev = JSON.parse(payload);
      const fromEvent = videoIdOf(ev?.client_payload?.video_id || ev?.inputs?.video_id);
      if (fromEvent.length >= 8) return [fromEvent];
    }
  } catch {
    /* no event payload */
  }
  try {
    const res = await fetch(JOBS_URL, { cache: "no-store" });
    const json = await res.json();
    const ids = Array.isArray(json.videoIds) ? json.videoIds.map(videoIdOf).filter((id) => id.length >= 8) : [];
    return [...new Set(ids)].slice(0, 8);
  } catch (err) {
    console.log("[gha-captions] jobs failed", err instanceof Error ? err.message : err);
    return [];
  }
}

const ids = await videoIdsFromEnv();
console.log("[gha-captions] ids", JSON.stringify(ids));
if (!ids.length) process.exit(0);

let posted = 0;
for (const videoId of ids) {
  let bundle = { captions: [] };
  if (process.env.GHA_EMBED !== "1") {
    bundle = await viaInnertube(videoId);
  }
  if ((bundle.captions || []).length < 4 && process.env.GHA_EMBED !== "0") {
    bundle = await viaEmbedIntercept(videoId);
  }
  if ((bundle.captions || []).length >= 4) {
    if (await postCaptions(videoId, bundle)) posted += 1;
  } else {
    console.log("[gha-captions] empty", JSON.stringify({ videoId, play: bundle.play || "" }));
  }
}
console.log("[gha-captions] done", JSON.stringify({ posted, tried: ids.length }));
if (posted === 0 && ids.length) process.exitCode = 1;
