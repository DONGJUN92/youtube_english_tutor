import { importDeviceSnapshot } from "@/lib/server/cloud-auth";
import { readStoredUser } from "./auth";
import { getAllByIndex, getById, type BookmarkRow, type ProfileRow, type ProgressRow, type VocabRow } from "./db";

export async function migrateLocalToCloud(): Promise<void> {
  const user = readStoredUser();
  if (!user) return;
  const profile = await getById<ProfileRow>("profiles", user.id);
  const vocab = await getAllByIndex<VocabRow>("vocab", "userId", user.id).catch(() => [] as VocabRow[]);
  const bookmarks = await getAllByIndex<BookmarkRow>("bookmarks", "userId", user.id).catch(() => [] as BookmarkRow[]);
  const progress = await getAllByIndex<ProgressRow>("progress", "userId", user.id).catch(() => [] as ProgressRow[]);
  if (!profile && vocab.length === 0 && bookmarks.length === 0 && progress.length === 0) return;
  await importDeviceSnapshot({
    data: {
      profile: profile
        ? {
            locale: profile.locale,
            ageBand: profile.ageBand,
            cefrLevel: profile.cefrLevel,
            listeningScore: profile.listeningScore,
            speakingScore: profile.speakingScore,
            placementDone: profile.placementDone,
          }
        : null,
      vocab: vocab.map((v) => ({
        videoId: v.video_id,
        word: v.word,
        meaningKo: v.meaning_ko,
        meaningEn: v.meaning_en,
        ipa: v.ipa,
        clipStart: v.clip_start,
        clipEnd: v.clip_end,
      })),
      bookmarks: bookmarks.map((b) => ({
        videoId: b.video_id,
        startSec: b.start_sec,
        endSec: b.end_sec,
        caption: b.caption,
        note: b.note,
      })),
      progress: progress.map((p) => ({
        videoId: p.video_id,
        positionSec: p.position_sec,
        title: p.title,
        thumbnail: p.thumbnail,
      })),
    },
  });
}
