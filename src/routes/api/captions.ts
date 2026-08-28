import { createFileRoute } from "@tanstack/react-router";
import { looksLikeRealTimestamps, sanitizeCaptionLines } from "@/lib/caption-parse";
import { fetchCaptionBundle } from "@/lib/server/youtube-data";

export const Route = createFileRoute("/api/captions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const videoId = new URL(request.url).searchParams.get("v")?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11) ?? "";
        if (videoId.length < 8) {
          return Response.json({ ok: false, error: "videoId", captions: [] }, { status: 400 });
        }
        const bundle = await fetchCaptionBundle(videoId);
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
