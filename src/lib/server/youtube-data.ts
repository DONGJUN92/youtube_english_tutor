export type CaptionLine = { start: number; dur: number; text: string };

export type VideoMeta = {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
};

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return {
      videoId,
      title: "YouTube video",
      author: "",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
  const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  return {
    videoId,
    title: data.title ?? "YouTube video",
    author: data.author_name ?? "",
    thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

export async function fetchCaptions(videoId: string): Promise<CaptionLine[]> {
  try {
    const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!watch.ok) return [];
    const html = await watch.text();
    const matched = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
    if (!matched?.[1]) return [];
    const player = JSON.parse(matched[1]) as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: { baseUrl?: string; languageCode?: string }[];
        };
      };
    };
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const en =
      tracks.find((t) => t.languageCode?.startsWith("en")) ??
      tracks[0];
    if (!en?.baseUrl) return [];
    const timed = await fetch(`${en.baseUrl}&fmt=json3`);
    if (!timed.ok) return [];
    const body = (await timed.json()) as {
      events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
    };
    return (body.events ?? [])
      .map((ev) => {
        const text = (ev.segs ?? [])
          .map((s) => s.utf8 ?? "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        return {
          start: (ev.tStartMs ?? 0) / 1000,
          dur: (ev.dDurationMs ?? 2000) / 1000,
          text,
        };
      })
      .filter((l) => l.text.length > 0);
  } catch {
    return [];
  }
}
