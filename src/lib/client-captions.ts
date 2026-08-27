import {
  parseCaptionBody,
  parseTimedtextList,
  timedtextCandidateUrls,
  type CaptionLine,
} from "@/lib/caption-parse";

const BROWSER_BUDGET_MS = 9000;

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Timedtext is CORS-open. Fetch from the user's IP — Vercel datacenter IPs are blocked. */
export async function fetchCaptionsInBrowser(videoId: string): Promise<CaptionLine[]> {
  if (!videoId || videoId.length < 8) return [];
  const started = Date.now();
  try {
    const listXml = await fetchText(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`, 4500);
    const tracks = parseTimedtextList(listXml);
    const urls = timedtextCandidateUrls(videoId, tracks);
    for (const batch of chunk(urls, 4)) {
      if (Date.now() - started > BROWSER_BUDGET_MS) break;
      const bodies = await Promise.all(batch.map((url) => fetchText(url, 4500).catch(() => "")));
      for (const body of bodies) {
        const lines = parseCaptionBody(body);
        if (lines.length >= 4) {
          console.info("[tubeshadow-captions] browser", JSON.stringify({ videoId, captionCount: lines.length }));
          return lines;
        }
      }
    }
    console.info(
      "[tubeshadow-captions] browser empty",
      JSON.stringify({ videoId, tracks: tracks.length, elapsedMs: Date.now() - started }),
    );
  } catch (err) {
    console.info("[tubeshadow-captions] browser failed", err instanceof Error ? err.message : err);
  }
  return [];
}
