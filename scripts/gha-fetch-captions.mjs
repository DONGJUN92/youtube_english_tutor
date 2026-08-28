/**
 * GitHub Actions worker: fetch YouTube auto-captions from a non-AWS IP
 * and POST them to the production store.
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

function parseJson3(text) {
  try {
    const data = JSON.parse(text);
    const lines = [];
    for (const ev of data.events || []) {
      if (!ev || !ev.segs) continue;
      const t = ev.segs
        .map((s) => (s && s.utf8) || "")
        .join("")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

function parseVtt(text) {
  const lines = [];
  const blocks = String(text).replace(/\r/g, "").split(/\n\n+/);
  for (const block of blocks) {
    const m = /(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/.exec(block);
    if (!m) continue;
    const toSec = (h, min, sec, ms) => (h ? Number(h.slice(0, 2)) * 3600 : 0) + Number(min) * 60 + Number(sec) + Number(ms) / 1000;
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

async function playerRequest(videoId, client) {
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
        },
        body: JSON.stringify({
          context: { client: client.context },
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
      if (tracks.length) return last;
    } catch (err) {
      last = { play: String(err && err.message ? err.message : err), tracks: [], title: "", durationSec: 0 };
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
  let best = { play: "EMPTY", tracks: [], title: "", durationSec: 0 };
  for (const client of CLIENTS) {
    const player = await playerRequest(videoId, client);
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
    const captions = await downloadJson3(track.baseUrl);
    if (captions.length >= 4) {
      return { captions, title: best.title, durationSec: best.durationSec || 0, source: "gha" };
    }
  }
  return { captions: [], title: best.title, durationSec: best.durationSec || 0, play: best.play };
}

async function viaYtDlp(videoId) {
  const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "gha-cap-"));
  try {
    const code = await new Promise((resolve) => {
      const child = spawn(
        "yt-dlp",
        [
          "--skip-download",
          "--write-auto-sub",
          "--write-sub",
          "--sub-langs",
          "en.*,en",
          "--sub-format",
          "json3/vtt/best",
          "--no-warnings",
          "-o",
          join(dir, videoId),
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let err = "";
      child.stderr.on("data", (c) => {
        err += String(c);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(1);
      }, 50000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(127);
      });
      child.on("exit", (n) => {
        clearTimeout(timer);
        if (n !== 0) console.log("[gha-captions] yt-dlp", n, err.slice(0, 400).replace(/\s+/g, " "));
        resolve(n ?? 1);
      });
    });
    if (code === 127) return { captions: [], title: "", durationSec: 0 };
    const files = await readdir(dir);
    for (const name of files) {
      const body = await readFile(join(dir, name), "utf8");
      const captions = name.endsWith(".json3") || body.trim().startsWith("{") ? parseJson3(body) : parseVtt(body);
      if (captions.length >= 4) {
        console.log("[gha-captions] yt-dlp ok", JSON.stringify({ videoId, file: name, captionCount: captions.length }));
        return { captions, title: "", durationSec: 0, source: "gha" };
      }
    }
  } catch (err) {
    console.log("[gha-captions] yt-dlp failed", err instanceof Error ? err.message : err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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
    const payload = process.env.GITHUB_EVENT_PATH ? (await import("node:fs")).readFileSync(process.env.GITHUB_EVENT_PATH, "utf8") : "";
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
  let bundle = await viaInnertube(videoId);
  if ((bundle.captions || []).length < 4) bundle = await viaYtDlp(videoId);
  if ((bundle.captions || []).length >= 4) {
    if (await postCaptions(videoId, bundle)) posted += 1;
  } else {
    console.log("[gha-captions] empty", JSON.stringify({ videoId, play: bundle.play || "" }));
  }
}
console.log("[gha-captions] done", JSON.stringify({ posted, tried: ids.length }));
if (posted === 0 && ids.length) process.exitCode = 1;
