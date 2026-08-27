export function extractYoutubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
        const id = parts[1].slice(0, 11);
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function thumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function watchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export type CatalogClip = {
  videoId: string;
  titleKo: string;
  titleEn: string;
  ages: Array<"child" | "teen" | "adult">;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  reasonKo: string;
  reasonEn: string;
};

export const FEATURED_CATALOG: CatalogClip[] = [
  {
    videoId: "8jPQjjsBbIc",
    titleKo: "스트레스가 올 것을 알 때 침착하는 법",
    titleEn: "How to stay calm when you know you'll be stressed",
    ages: ["adult", "teen"],
    level: "B2",
    reasonKo: "TED · 실용 조언, 쉐도잉에 좋은 리듬",
    reasonEn: "TED talk with clear, practical English",
  },
  {
    videoId: "arj7oStGLkU",
    titleKo: "프로크래스티네이터의 머릿속",
    titleEn: "Inside the mind of a master procrastinator",
    ages: ["teen", "adult"],
    level: "B1",
    reasonKo: "이야기체 TED · 듣기 부담이 낮음",
    reasonEn: "Storytelling TED — easier to follow",
  },
  {
    videoId: "M7lc1UVf-VE",
    titleKo: "YouTube API 소개",
    titleEn: "YouTube IFrame API demo",
    ages: ["adult", "teen"],
    level: "A2",
    reasonKo: "짧고 명확한 발표 영어",
    reasonEn: "Short, clear presenter English",
  },
  {
    videoId: "jNQXAC9IVRw",
    titleKo: "동물원에서",
    titleEn: "Me at the zoo",
    ages: ["child", "teen"],
    level: "A1",
    reasonKo: "아주 짧은 첫 유튜브 영상 · 초급",
    reasonEn: "The first YouTube video — tiny A1 clip",
  },
  {
    videoId: "XqZsoesa55w",
    titleKo: "Baby Shark (따라 부르기)",
    titleEn: "Baby Shark",
    ages: ["child"],
    level: "A1",
    reasonKo: "영유아 리듬 · 반복 문장",
    reasonEn: "Repetition and rhythm for young children",
  },
];
