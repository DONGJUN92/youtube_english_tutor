import { createFileRoute } from "@tanstack/react-router";
import { looksLikeRealTimestamps, sanitizeCaptionLines } from "@/lib/caption-parse";
import {
  fetchCaptionBundle,
  getVisitorData,
  peekCaptionBundle,
  storeClientCaptions,
} from "@/lib/server/youtube-data";

export const Route = createFileRoute("/api/captions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const videoId = url.searchParams.get("v")?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11) ?? "";
        if (videoId.length < 8) {
          return Response.json({ ok: false, error: "videoId", captions: [] }, { status: 400 });
        }
        const peek = url.searchParams.get("peek") === "1";
        const [bundle, visitorData] = await Promise.all([
          peek ? peekCaptionBundle(videoId) : fetchCaptionBundle(videoId),
          peek ? Promise.resolve(undefined) : getVisitorData().catch(() => undefined),
        ]);
        const captions = sanitizeCaptionLines(bundle?.captions);
        const timed = looksLikeRealTimestamps(captions);
        return Response.json({
          ok: captions.length >= 4 && timed,
          source: bundle?.source ?? "android",
          captionCount: captions.length,
          timed,
          title: bundle?.title ?? "",
          durationSec: Math.round(bundle?.durationSec ?? 0),
          captions: timed ? captions : [],
          trackUrls: bundle?.trackUrls ?? [],
          visitorData: visitorData ?? "",
        });
      },
      POST: async ({ request }) => {
        let body: {
          v?: unknown;
          poToken?: unknown;
          visitorData?: unknown;
          captions?: unknown;
          title?: unknown;
          durationSec?: unknown;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, error: "body", captions: [] }, { status: 400 });
        }
        const videoId = String(body.v ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
        if (videoId.length < 8) {
          return Response.json({ ok: false, error: "videoId", captions: [] }, { status: 400 });
        }
        const uploaded = sanitizeCaptionLines(body.captions);
        if (uploaded.length >= 4 && looksLikeRealTimestamps(uploaded)) {
          const stored = await storeClientCaptions(videoId, uploaded, {
            title: typeof body.title === "string" ? body.title : undefined,
            durationSec: Number(body.durationSec) > 0 ? Number(body.durationSec) : undefined,
          });
          return Response.json({
            ok: true,
            source: "client",
            captionCount: stored.captions.length,
            timed: true,
            title: stored.title ?? "",
            durationSec: Math.round(stored.durationSec),
            captions: stored.captions,
            trackUrls: [],
          });
        }
        const poToken = typeof body.poToken === "string" && body.poToken.length > 20 ? body.poToken : undefined;
        const visitorData =
          typeof body.visitorData === "string" && body.visitorData.length > 10 ? body.visitorData : undefined;
        const bundle = await fetchCaptionBundle(videoId, undefined, { poToken, visitorData });
        const captions = sanitizeCaptionLines(bundle.captions);
        const timed = looksLikeRealTimestamps(captions);
        return Response.json({
          ok: captions.length >= 4 && timed,
          source: bundle.source,
          captionCount: captions.length,
          timed,
          title: bundle.title ?? "",
          durationSec: Math.round(bundle.durationSec),
          captions: timed ? captions : [],
          trackUrls: bundle.trackUrls ?? [],
        });
      },
    },
  },
});
