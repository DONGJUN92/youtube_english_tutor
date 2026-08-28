import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Standalone Vercel Edge handler: ANDROID/IOS InnerTube from Cloudflare IPs. */
const EDGE_SOURCE = `const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const UA_IOS = "com.google.ios.youtube/20.20.1 (iPhone16,2; U; CPU iOS 18_4 like Mac OS X)";

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

function parseJson3(text) {
  try {
    const data = JSON.parse(text);
    const lines = [];
    for (const ev of data.events || []) {
      if (!ev || !ev.segs) continue;
      const t = ev.segs.map((s) => (s && s.utf8) || "").join("").replace(/\\n/g, " ").replace(/\\s+/g, " ").trim();
      if (!t || t === "♪" || t === "[Music]") continue;
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

async function playerRequest(videoId, client) {
  const hosts = [
    "https://www.youtube.com/youtubei/v1/player",
    "https://youtubei.googleapis.com/youtubei/v1/player",
  ];
  let last = { play: "EMPTY", tracks: [] };
  for (const host of hosts) {
    try {
      const res = await fetch(host + "?key=" + client.key + "&prettyPrint=false", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": client.ua,
          "x-youtube-client-name": client.clientNameHeader,
          "x-youtube-client-version": client.clientVersion,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
        },
        body: JSON.stringify({
          context: { client: client.context },
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
      if (tracks.length) return last;
    } catch (err) {
      last = { play: String(err && err.message ? err.message : err), tracks: [] };
    }
  }
  return last;
}

async function downloadJson3(baseUrl) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");
    const res = await fetch(url.toString(), {
      headers: {
        "user-agent": UA_ANDROID,
        origin: "https://www.youtube.com",
        referer: "https://www.youtube.com/",
        accept: "*/*",
      },
    });
    if (!res.ok) return [];
    return parseJson3(await res.text());
  } catch {
    return [];
  }
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
    key: ANDROID_KEY,
    ua: "com.google.android.youtube/19.47.53 (Linux; U; Android 14) gzip",
    clientNameHeader: "3",
    clientVersion: "19.47.53",
    context: {
      clientName: "ANDROID",
      clientVersion: "19.47.53",
      androidSdkVersion: 30,
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
];

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

  let best = { play: "EMPTY", tracks: [] };
  for (const client of CLIENTS) {
    const player = await playerRequest(videoId, client);
    console.log("[tubeshadow-captions] edge player", JSON.stringify({
      videoId,
      client: client.context.clientName,
      version: client.clientVersion,
      play: player.play,
      tracks: (player.tracks || []).length,
    }));
    if ((player.tracks || []).length) {
      best = player;
      break;
    }
    best = player;
  }

  const trackUrls = (best.tracks || []).map((t) => t.baseUrl).filter(Boolean);
  let captions = [];
  for (const trackUrl of trackUrls.slice(0, 3)) {
    captions = await downloadJson3(trackUrl);
    if (captions.length >= 4) break;
  }

  return json({
    ok: captions.length >= 4 || trackUrls.length > 0,
    source: "edge",
    play: best.play || "",
    reason: best.reason || "",
    title: best.title || "",
    durationSec: Math.round(best.durationSec || 0),
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
  const already = routes.some((r) => r.dest === "/api/yt-edge" || r.src === "/api/yt-edge");
  if (!already) {
    const route = { src: "/api/yt-edge", dest: "/api/yt-edge" };
    const catchAll = routes.findIndex((r) => r.src === "/(.*)" && r.dest === "/__server");
    if (catchAll >= 0) routes.splice(catchAll, 0, route);
    else routes.push(route);
    config.routes = routes;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  console.info("[edge-yt-captions] wrote", funcDir);
}
