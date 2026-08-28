import { createFileRoute } from "@tanstack/react-router";
import { listPendingCaptionJobs, enqueueCaptionJob } from "@/lib/server/youtube-data";

export const Route = createFileRoute("/api/caption-jobs")({
  server: {
    handlers: {
      GET: async () => {
        const videoIds = await listPendingCaptionJobs();
        return Response.json({ ok: true, videoIds });
      },
      POST: async ({ request }) => {
        let videoId = "";
        try {
          const url = new URL(request.url);
          videoId = url.searchParams.get("v")?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11) ?? "";
          if (videoId.length < 8) {
            const body = (await request.json().catch(() => ({}))) as { v?: unknown };
            videoId = String(body.v ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
          }
        } catch {
          videoId = "";
        }
        if (videoId.length < 8) {
          return Response.json({ ok: false, error: "videoId" }, { status: 400 });
        }
        await enqueueCaptionJob(videoId);
        return Response.json({ ok: true, videoId });
      },
    },
  },
});
