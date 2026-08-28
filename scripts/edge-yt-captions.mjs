import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Standalone Vercel Edge handler: ANDROID Innertube from Cloudflare IPs. */
const EDGE_SOURCE = `const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const AND_CTX = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 34,
  hl: "en",
  gl: "US",
  osName: "Android",
  osVersion: "14",
  platform: "MOBILE",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function videoIdOf(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
}

function decodeEntities(raw) {
  return String(raw || "")
    .replace(/&#39;|'/g, "'")
    .replace(/"/g, '"')
    .replace(/>/g, ">")
    .replace(/</g, "<")
    .replace(/&/g, "&")
    .replace(/\\s+/g, " ")
    .trim();
}

function parseJson3(text) {
  try {
    const data = JSON.parse(text);
    const lines = [];
    for (const ev of data.events || []) {
      if (!ev || !ev.segs) continue;
      const t = decodeEntities(ev.segs.map((s) => (s && s.utf8) || "").join(""));
      if (!t || t === "♪" || /^\\[(Music|Applause|Laughter)\\]$/i.test(t)) continue;
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
  const re = /<p\\b([^>]*)>([\\s\\S]*?)<\\/p>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = match[1] || "";
    const inner = decodeEntities((match[2] || "").replace(/<[^>]+>/g, " "));
    if (!inner) continue;
    const t = Number((/\\bt="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    const d = Number((/\\bd="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    lines.push({ start: t / 1000, dur: Math.max(0.4, d / 1000) || 2, text: inner });
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
  return parseSrv3(trimmed);
}

async function mintVisitor() {
  for (const path of ["config", "guide"]) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/" + path + "?prettyPrint=false", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA_ANDROID,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          "x-youtube-client-name": "3",
          "x-youtube-client-version": "20.10.38",
        },
        body: JSON.stringify({ context: { client: AND_CTX } }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const visitor = data && data.responseContext && data.responseContext.visitorData;
      if (visitor && visitor.length > 20) return visitor;
    } catch {
      /* next */
    }
  }
  return "";
}

async function playerRequest(videoId, visitor) {
  const hosts = [
    "https://www.youtube.com/youtubei/v1/player",
    "https://youtubei.googleapis.com/youtubei/v1/player",
  ];
  let last = { play: "EMPTY", tracks: [] };
  for (const host of hosts) {
    try {
      const res = await fetch(host + "?key=" + ANDROID_KEY + "&prettyPrint=false", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA_ANDROID,
          "x-youtube-client-name": "3",
          "x-youtube-client-version": "20.10.38",
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          ...(visitor ? { "x-goog-visitor-id": visitor } : {}),
        },
        body: JSON.stringify({
          context: { client: { ...AND_CTX, ...(visitor ? { visitorData: visitor } : {}) } },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) {
        last = { play: "HTTP_" + res.status, tracks: [] };
        continue;
      }
      const data = await res.json();
      const tracks = (((data.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
      const play = ((data.playabilityStatus || {}).status) || "OK";
      last = {
        play,
        reason: (data.playabilityStatus || {}).reason,
        title: (data.videoDetails || {}).title,
        durationSec: Number((data.videoDetails || {}).lengthSeconds) || 0,
        tracks,
      };
      if (play === "OK" || tracks.length) return last;
    } catch (err) {
      last = { play: String(err && err.message ? err.message : err), tracks: [] };
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

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }
  let videoId = "";
  try {
    const url = new URL(request.url);
    videoId = videoIdOf(url.searchParams.get("v"));
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!videoId) videoId = videoIdOf(body.v);
    }
  } catch {
    return json({ ok: false, error: "url" }, 400);
  }
  if (videoId.length < 8) return json({ ok: false, error: "videoId", captions: [], trackUrls: [] }, 400);

  const visitor = await mintVisitor();
  const player = await playerRequest(videoId, visitor);
  console.log("[tubeshadow-captions] edge player", JSON.stringify({
    videoId,
    play: player.play,
    tracks: (player.tracks || []).length,
    visitor: Boolean(visitor),
  }));

  const trackUrls = (player.tracks || []).map((t) => t.baseUrl).filter(Boolean);
  let captions = [];
  for (const trackUrl of trackUrls.slice(0, 4)) {
    captions = await downloadTimedtext(trackUrl, visitor);
    if (captions.length >= 4) break;
  }

  return json({
    ok: captions.length >= 4,
    source: "edge",
    play: player.play || "",
    reason: player.reason || "",
    title: player.title || "",
    durationSec: Math.round(player.durationSec || 0),
    captionCount: captions.length,
    captions,
    trackUrls,
  });
}
`;

export function writeEdgeYtCaptions(outputRoot) {
  const funcDir = join(outputRoot, "functions/api/yt-edge.func");
  mkdirSync(funcDir, { recursive: true });
  writeFileSync(join(funcDir, "index.js"), EDGE_SOURCE);
  writeFileSync(
    join(funcDir, ".vc-config.json"),
    JSON.stringify({ runtime: "edge", entrypoint: "index.js" }),
  );
  const configPath = join(outputRoot, "config.json");
  if (!existsSync(configPath)) return;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const routes = Array.isArray(config.routes) ? config.routes : [];
  const filtered = routes.filter((r) => r.src !== "/api/yt-edge" && r.dest !== "/api/yt-edge");
  const route = { src: "/api/yt-edge", dest: "/api/yt-edge" };
  const catchAll = filtered.findIndex((r) => r.src === "/(.*)" && r.dest === "/__server");
  if (catchAll >= 0) filtered.splice(catchAll, 0, route);
  else filtered.unshift(route);
  config.routes = filtered;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.info("[edge-yt-captions] wrote", funcDir);
}
