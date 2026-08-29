import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Standalone Vercel Edge handler: live YouTube ASR captions with timestamps. */
const EDGE_SOURCE = `const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRvzeohXFxM3HQQoLxEwM";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
const UA_IOS = "com.google.ios.youtube/20.20.1 (iPhone16,2; U; CPU iOS 18_4 like Mac OS X)";
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_TV = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version";
const WEB_VERSION = "2.20260826.01.00";

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
    clientNameHeader: "85",
    clientVersion: "2.0",
    context: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
      gl: "US",
    },
  },
  {
    key: WEB_KEY,
    ua: UA_WEB,
    clientNameHeader: "56",
    clientVersion: WEB_VERSION,
    context: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: WEB_VERSION,
      hl: "en",
      gl: "US",
      platform: "DESKTOP",
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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
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
  var named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return String(raw || "")
    .replace(/&([a-z]+);/gi, function (match, name) {
      var key = String(name).toLowerCase();
      return named[key] != null ? named[key] : match;
    })
    .replace(/&#(\\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\s+/g, " ")
    .trim();
}

function parseJson3(text) {
  try {
    var data = JSON.parse(text);
    var lines = [];
    var events = data.events || [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev || !ev.segs) continue;
      var t = decodeEntities(ev.segs.map(function (s) { return (s && s.utf8) || ""; }).join(""));
      if (!t || t === "♪" || /^\\[(Music|Applause|Laughter)\\]$/i.test(t)) continue;
      lines.push({
        start: (ev.tStartMs || 0) / 1000,
        dur: Math.max(0.4, (ev.dDurationMs || 2000) / 1000),
        text: t,
      });
    }
    return lines;
  } catch (e) {
    return [];
  }
}

function parseSrv3(xml) {
  var lines = [];
  var re = /<p\\b([^>]*)>([\\s\\S]*?)<\\/p>/gi;
  var match;
  while ((match = re.exec(xml))) {
    var attrs = match[1] || "";
    var inner = decodeEntities((match[2] || "").replace(/<[^>]+>/g, " "));
    if (!inner) continue;
    var t = Number((/\\bt="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    var d = Number((/\\bd="([^"]+)"/i.exec(attrs) || [])[1] || 0);
    lines.push({ start: t / 1000, dur: Math.max(0.4, d / 1000) || 2, text: inner });
  }
  return lines;
}

function parseCaptions(body) {
  var trimmed = String(body || "").trim();
  if (!trimmed) return [];
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    var json3 = parseJson3(trimmed);
    if (json3.length) return json3;
  }
  return parseSrv3(trimmed);
}

function scoreTrack(t) {
  var lang = String(t.languageCode || "").toLowerCase();
  var s = 50;
  if (lang === "en" || lang.indexOf("en-") === 0 || lang.indexOf("en_") === 0) s -= 20;
  if (lang.indexOf("en") === 0 && t.kind !== "asr") s -= 6;
  if (t.kind === "asr") s += 2;
  if (String(t.baseUrl || "").indexOf("exp=") < 0) s -= 8;
  return s;
}

function orderedTracks(tracks) {
  return (tracks || []).filter(function (t) { return t && t.baseUrl; }).slice().sort(function (a, b) {
    return scoreTrack(a) - scoreTrack(b);
  });
}

async function mintVisitor() {
  var ctx = CLIENTS[0].context;
  for (var i = 0; i < 2; i++) {
    var path = i === 0 ? "config" : "guide";
    try {
      var res = await fetch("https://www.youtube.com/youtubei/v1/" + path + "?prettyPrint=false", {
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
      var data = await res.json();
      var visitor = data && data.responseContext && data.responseContext.visitorData;
      if (visitor && visitor.length > 20) return visitor;
    } catch (e) {}
  }
  return "";
}

async function playerRequest(videoId, client, visitor) {
  var hosts = ["https://www.youtube.com/youtubei/v1/player", "https://youtubei.googleapis.com/youtubei/v1/player"];
  var last = { play: "EMPTY", tracks: [], title: "", durationSec: 0, client: client.context.clientName };
  for (var h = 0; h < hosts.length; h++) {
    try {
      var res = await fetch(hosts[h] + "?key=" + client.key + "&prettyPrint=false", {
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
          context: { client: Object.assign({}, client.context, visitor ? { visitorData: visitor } : {}) },
          videoId: videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) {
        last = { play: "HTTP_" + res.status, tracks: [], title: "", durationSec: 0, client: client.context.clientName };
        continue;
      }
      var data = await res.json();
      var tracks = (((data.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
      last = {
        play: ((data.playabilityStatus || {}).status) || "OK",
        reason: (data.playabilityStatus || {}).reason,
        title: (data.videoDetails || {}).title,
        durationSec: Number((data.videoDetails || {}).lengthSeconds) || 0,
        tracks: tracks,
        client: client.context.clientName,
      };
      if (last.play === "OK" || tracks.length) return last;
    } catch (err) {
      last = { play: String(err && err.message ? err.message : err), tracks: [], title: "", durationSec: 0, client: client.context.clientName };
    }
  }
  return last;
}

async function downloadTimedtext(baseUrl, visitor, ua) {
  var variants = [baseUrl];
  try {
    var parsed = new URL(baseUrl);
    var fmts = ["json3", "srv3", "vtt"];
    for (var i = 0; i < fmts.length; i++) {
      parsed.searchParams.set("fmt", fmts[i]);
      variants.push(parsed.toString());
    }
  } catch (e) {}
  for (var v = 0; v < variants.length; v++) {
    try {
      var res = await fetch(variants[v], {
        headers: {
          "user-agent": ua || UA_ANDROID,
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          accept: "*/*",
          ...(visitor ? { "x-goog-visitor-id": visitor } : {}),
        },
      });
      if (!res.ok) continue;
      var lines = parseCaptions(await res.text());
      if (lines.length >= 4) return lines;
    } catch (e) {}
  }
  return [];
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }
  var videoId = "";
  try {
    var url = new URL(request.url);
    videoId = videoIdOf(url.searchParams.get("v"));
    if (request.method === "POST") {
      var body = await request.json().catch(function () { return {}; });
      if (!videoId) videoId = videoIdOf(body.v);
    }
  } catch (e) {
    return json({ ok: false, error: "url" }, 400);
  }
  if (videoId.length < 8) return json({ ok: false, error: "videoId", captions: [], trackUrls: [] }, 400);

  var visitor = await mintVisitor();
  var best = { play: "EMPTY", tracks: [], title: "", durationSec: 0, client: "" };
  for (var c = 0; c < CLIENTS.length; c++) {
    var player = await playerRequest(videoId, CLIENTS[c], visitor);
    if ((player.tracks || []).length) {
      best = player;
      break;
    }
    best = player;
  }

  var tracks = orderedTracks(best.tracks);
  var trackUrls = tracks.map(function (t) { return t.baseUrl; });
  var captions = [];
  for (var t = 0; t < Math.min(tracks.length, 6); t++) {
    captions = await downloadTimedtext(tracks[t].baseUrl, visitor, UA_ANDROID);
    if (captions.length >= 4) break;
  }

  return json({
    ok: captions.length >= 4,
    source: "edge",
    play: best.play || "",
    reason: best.reason || "",
    client: best.client || "",
    title: best.title || "",
    durationSec: Math.round(best.durationSec || 0),
    captionCount: captions.length,
    captions: captions,
    trackUrls: trackUrls,
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
