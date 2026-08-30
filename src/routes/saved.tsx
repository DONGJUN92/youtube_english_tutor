import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { t, useLocaleStore } from "@/lib/i18n";
import { listClipBookmarks, listVocab, scheduleClipReview } from "@/lib/user-data";
import { formatTimestamp } from "@/lib/utils";
import { thumbnailUrl } from "@/lib/youtube";
import { speakEnglish } from "@/lib/speech";
import { expressionCounts } from "@/lib/learner-practice";

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

  const exprs = useMemo(
    () => expressionCounts(clips.map((c) => c.caption || "").filter(Boolean), 2),
    [clips],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 pb-24">
      <h1 className="font-display text-3xl font-medium">{t(locale, "saved")}</h1>
      {words.length === 0 && clips.length === 0 && (
        <p className="mt-6 text-muted">{t(locale, "emptySaved")}</p>
      )}
      {exprs.length > 0 && (
        <p className="mt-4 text-xs text-muted">
          {t(locale, "exprCount")}: {exprs.map((e) => `${e.phrase} · ${e.count}`).join("  ")}
        </p>
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
                {w.example_text && <p className="mt-1 text-xs text-subtle">“{w.example_text}”</p>}
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
          {clips.map((c) => {
            const due = c.review_at && Date.parse(c.review_at) <= Date.now();
            const end = Math.floor(Math.min(c.end_sec, c.start_sec + 30));
            return (
              <li key={c.id} className="rounded-xl border border-border bg-surface p-3">
                <a
                  href={`/watch/${c.video_id}?t=${Math.floor(c.start_sec)}&end=${end}`}
                  className="flex gap-3"
                >
                  <img src={thumbnailUrl(c.video_id)} alt="" className="h-16 w-28 rounded-md object-cover" />
                  <div>
                    <p className="text-sm font-medium">
                      {formatTimestamp(c.start_sec)}–{formatTimestamp(c.end_sec)}
                      {due ? ` · ${t(locale, "reviewDue")}` : ""}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{c.caption}</p>
                  </div>
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={`/watch/${c.video_id}?t=${Math.floor(c.start_sec)}&end=${end}`}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted"
                  >
                    {t(locale, "review30")}
                  </a>
                  <button
                    type="button"
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted"
                    onClick={() => {
                      void scheduleClipReview({ data: { id: c.id } }).then(() =>
                        listClipBookmarks().then(setClips),
                      );
                    }}
                  >
                    {t(locale, "reviewTomorrow")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
