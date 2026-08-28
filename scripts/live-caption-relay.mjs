/**
 * Live caption relay: poll production pending jobs, fetch YouTube ASR
 * captions with timestamps from this IP, POST them back. Neon is a cache.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const JOBS_URL = process.env.CAPTION_JOBS_URL || "https://tubeshadow.vercel.app/api/caption-jobs";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "gha-fetch-captions.mjs");
const INTERVAL_MS = Number(process.env.RELAY_INTERVAL_MS) || 15000;

async function pendingIds() {
  try {
    const res = await fetch(JOBS_URL, { cache: "no-store" });
    const json = await res.json();
    return Array.isArray(json.videoIds) ? json.videoIds.filter((id) => typeof id === "string" && id.length >= 8) : [];
  } catch (err) {
    console.log("[caption-relay] jobs", err instanceof Error ? err.message : err);
    return [];
  }
}

function runFetch(videoId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, VIDEO_ID: videoId, GHA_EMBED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => {
      out += String(c);
    });
    child.stderr.on("data", (c) => {
      out += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(1);
    }, 40000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const lines = out.trim().split("\n").slice(-6);
      console.log("[caption-relay]", videoId, "exit", code ?? 1, lines.join(" | "));
      resolve(code ?? 1);
    });
  });
}

async function tick() {
  const ids = [...new Set(await pendingIds())].slice(0, 4);
  if (!ids.length) return;
  console.log("[caption-relay] pending", JSON.stringify(ids));
  for (const id of ids) await runFetch(id);
}

console.log("[caption-relay] start", JSON.stringify({ jobs: JOBS_URL, intervalMs: INTERVAL_MS }));
await tick();
setInterval(() => {
  void tick();
}, INTERVAL_MS);
