import { createFileRoute } from "@tanstack/react-router";
import { looksLikeRealTimestamps, sanitizeCaptionLines } from "@/lib/caption-parse";
import { fetchYoutubeTimedtext } from "@/lib/server/youtube-data";

export const Route = createFileRoute("/api/timedtext")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let url = "";
        try {
          const json = (await request.json()) as { url?: unknown };
          url = typeof json.url === "string" ? json.url : "";
        } catch {
          return Response.json({ ok: false, error: "body", captions: [] }, { status: 400 });
        }
        const captions = sanitizeCaptionLines(await fetchYoutubeTimedtext(url));
        const timed = looksLikeRealTimestamps(captions);
        return Response.json({
          ok: captions.length >= 4 && timed,
          captionCount: captions.length,
          captions: timed ? captions : [],
        });
      },
    },
  },
});
