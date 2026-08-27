import { createFileRoute } from "@tanstack/react-router";
import { fetchCaptionBundle } from "@/lib/server/youtube-data";

export const Route = createFileRoute("/api/caption-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const videoId = new URL(request.url).searchParams.get("v")?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11) ?? "";
        if (videoId.length < 8) {
          return Response.json({ ok: false, error: "videoId" }, { status: 400 });
        }
        const bundle = await fetchCaptionBundle(videoId);
        return Response.json({
          ok: bundle.captions.length >= 4,
          source: bundle.source,
          captionCount: bundle.captions.length,
          title: bundle.title ?? "",
          first: bundle.captions[0]?.text ?? "",
          durationSec: Math.round(bundle.durationSec),
        });
      },
    },
  },
});
