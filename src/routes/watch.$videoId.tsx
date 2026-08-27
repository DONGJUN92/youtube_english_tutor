import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { ListeningCard, SpeakingCard } from "@/components/lesson-cards";
import { playClip, YoutubePlayer, type YtPlayer } from "@/components/youtube-player";
import { t, useLocaleStore } from "@/lib/i18n";
import {
  loadOrGenerateLesson,
  resolveVideo,
  saveClipBookmark,
  saveProgress,
  saveSpeakingAttempt,
  saveVocab,
} from "@/lib/server/fns";
import type { GeneratedLesson, VocabItem } from "@/lib/schema";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/watch/$videoId")({ component: WatchPage });

function WatchPage() {
  return (
    <AppShell>
      <AuthGate>
        <WatchStudio />
      </AuthGate>
    </AppShell>
  );
}

function WatchStudio() {
  const { videoId } = Route.useParams();
  const locale = useLocaleStore((s) => s.locale);
  const playerRef = useRef<YtPlayer | null>(null);
  const lastSaveRef = useRef(0);
  const [tab, setTab] = useState<"listening" | "speaking">("listening");
  const [meta, setMeta] = useState<{ title: string; hasCaptions: boolean; hasSeededLesson: boolean; captionCount: number } | null>(null);
  const [lesson, setLesson] = useState<GeneratedLesson | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing_key" | "no_captions" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  useEffect(() => {
    setStatus("loading");
    setLesson(null);
    void resolveVideo({ data: { videoId } }).then(setMeta).catch(() => setMeta(null));
    void loadOrGenerateLesson({ data: { videoId } }).then((res) => {
      if (res.ok) {
        setLesson(res.lesson);
        setStatus("ready");
        return;
      }
      if (res.error === "missing_key") setStatus("missing_key");
      else if (res.error === "no_captions") setStatus("no_captions");
      else {
        setStatus("error");
        setMessage("message" in res ? res.message : "error");
      }
    });
  }, [videoId]);

  function flash(text: string) {
    setSavedFlash(text);
    window.setTimeout(() => setSavedFlash(null), 1600);
  }

  function handlePlay(start: number, end: number) {
    playClip(playerRef.current, start, end, videoId);
  }

  function handleSaveWord(v: VocabItem, clip: { start: number; end: number }) {
    void saveVocab({
      data: {
        videoId,
        word: v.word,
        meaningKo: v.meaningKo,
        meaningEn: v.meaningEn,
        ipa: v.ipa,
        clipStart: clip.start,
        clipEnd: clip.end,
      },
    }).then(() => flash(t(locale, "saveWord")));
  }

  function handleSaveClip(start: number, end: number, caption: string) {
    void saveClipBookmark({
      data: { videoId, startSec: start, endSec: end, caption },
    }).then(() => flash(t(locale, "saveClip")));
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 pb-24">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/" className="text-sm text-muted">
          ← {t(locale, "home")}
        </Link>
        {savedFlash && <span className="text-sm text-ok">{savedFlash}</span>}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section>
          <YoutubePlayer
            videoId={videoId}
            onReady={(p) => {
              playerRef.current = p;
            }}
            onTime={(sec) => {
              const now = Date.now();
              if (now - lastSaveRef.current < 8000) return;
              lastSaveRef.current = now;
              void saveProgress({
                data: {
                  videoId,
                  positionSec: Math.floor(sec),
                  title: meta?.title,
                },
              });
            }}
          />
          <h1 className="mt-4 font-display text-2xl">{meta?.title ?? "YouTube"}</h1>
        </section>
        <section>
          <div className="flex rounded-full border border-border p-1">
            <button
              type="button"
              className={cn("h-9 flex-1 rounded-full text-sm", tab === "listening" && "bg-elevated")}
              onClick={() => setTab("listening")}
            >
              {t(locale, "listen")}
            </button>
            <button
              type="button"
              className={cn("h-9 flex-1 rounded-full text-sm", tab === "speaking" && "bg-elevated")}
              onClick={() => setTab("speaking")}
            >
              {t(locale, "speak")}
            </button>
          </div>
          <div className="mt-4 grid gap-4">
            {status === "loading" && (
              <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">{t(locale, "generating")}</div>
            )}
            {status === "missing_key" && (
              <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
                {t(locale, "needKey")}{" "}
                <Link to="/settings" className="text-fg underline">
                  {t(locale, "settings")}
                </Link>
              </div>
            )}
            {status === "no_captions" && (
              <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">{t(locale, "noCaptions")}</div>
            )}
            {status === "error" && <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-accent">{message}</div>}
            {lesson && tab === "listening" &&
              lesson.listening.map((item, i) => (
                <ListeningCard
                  key={`${item.stem}-${i}`}
                  item={item}
                  locale={locale}
                  onPlayClip={handlePlay}
                  onSaveWord={handleSaveWord}
                  onSaveClip={() => handleSaveClip(item.clip.startSec, item.clip.endSec, item.clip.caption)}
                />
              ))}
            {lesson && tab === "speaking" &&
              lesson.speaking.map((item, i) => (
                <SpeakingCard
                  key={`${item.target}-${i}`}
                  item={item}
                  locale={locale}
                  onPlayClip={handlePlay}
                  onSaveWord={handleSaveWord}
                  onSaveClip={() => handleSaveClip(item.clip.startSec, item.clip.endSec, item.clip.caption)}
                  onScored={(payload) => {
                    void saveSpeakingAttempt({ data: { ...payload, videoId } });
                  }}
                />
              ))}
          </div>
        </section>
      </div>
    </main>
  );
}
