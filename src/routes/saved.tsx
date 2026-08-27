import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { t, useLocaleStore } from "@/lib/i18n";
import { listClipBookmarks, listVocab } from "@/lib/server/fns";
import { formatTimestamp } from "@/lib/utils";
import { thumbnailUrl } from "@/lib/youtube";
import { speakEnglish } from "@/lib/speech";

export const Route = createFileRoute("/saved")({ component: SavedPage });

function SavedPage() {
  return (
    <AppShell>
      <AuthGate>
        <SavedLists />
      </AuthGate>
    </AppShell>
  );
}

function SavedLists() {
  const locale = useLocaleStore((s) => s.locale);
  const [words, setWords] = useState<Awaited<ReturnType<typeof listVocab>>>([]);
  const [clips, setClips] = useState<Awaited<ReturnType<typeof listClipBookmarks>>>([]);

  useEffect(() => {
    void listVocab().then(setWords).catch(() => setWords([]));
    void listClipBookmarks().then(setClips).catch(() => setClips([]));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 pb-24">
      <h1 className="font-display text-3xl font-medium">{t(locale, "saved")}</h1>
      {words.length === 0 && clips.length === 0 && (
        <p className="mt-6 text-muted">{t(locale, "emptySaved")}</p>
      )}
      <section className="mt-8">
        <h2 className="text-sm font-medium tracking-wide text-muted">{t(locale, "words")}</h2>
        <ul className="mt-3 grid gap-2">
          {words.map((w) => (
            <li key={w.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
              <div>
                <p className="font-medium">{w.word}</p>
                <p className="text-sm text-muted">
                  {locale === "ko" ? w.meaning_ko : w.meaning_en || w.meaning_ko}
                  {w.ipa ? ` · ${w.ipa}` : ""}
                </p>
              </div>
              <button type="button" className="text-sm text-muted" onClick={() => speakEnglish(w.word)}>
                {t(locale, "replay")}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-10">
        <h2 className="text-sm font-medium tracking-wide text-muted">{t(locale, "clips")}</h2>
        <ul className="mt-3 grid gap-2">
          {clips.map((c) => (
            <li key={c.id}>
              <Link
                to="/watch/$videoId"
                params={{ videoId: c.video_id }}
                className="flex gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <img src={thumbnailUrl(c.video_id)} alt="" className="h-16 w-28 rounded-md object-cover" />
                <div>
                  <p className="text-sm font-medium">
                    {formatTimestamp(c.start_sec)}–{formatTimestamp(c.end_sec)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{c.caption}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
