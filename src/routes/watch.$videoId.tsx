import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { ListeningCard, SpeakingCard } from "@/components/lesson-cards";
import { playClip, YoutubePlayer, type YtPlayer } from "@/components/youtube-player";
import { t, useLocaleStore } from "@/lib/i18n";
import {
  getMyProfile,
  loadOrGenerateLesson,
  resolveVideo,
  saveClipBookmark,
  saveProgress,
  saveSpeakingAttempt,
  saveVocab,
} from "@/lib/user-data";
import type { PublicProfile } from "@/lib/server/fns";
import type { GeneratedLesson, Locale, VocabItem } from "@/lib/schema";
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
  const navigate = useNavigate();
  const playerRef = useRef<YtPlayer | null>(null);
  const lastSaveRef = useRef(0);
  const [tab, setTab] = useState<"listening" | "speaking">("listening");
  const [meta, setMeta] = useState<{ title: string; hasCaptions: boolean; hasSeededLesson: boolean; captionCount: number } | null>(null);
  const [lesson, setLesson] = useState<GeneratedLesson | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing_key" | "no_captions" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [genStep, setGenStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  function loadLesson() {
    setStatus("loading");
    setLesson(null);
    setMessage(null);
    setNudge(false);
    setGenStep(0);
    setElapsed(0);
    void loadOrGenerateLesson({ data: { videoId } }).then((res) => {
      if (res.ok) {
        setLesson(res.lesson);
        setStatus("ready");
        if (res.nudgePlacement) setNudge(true);
        return;
      }
      if (res.error === "missing_key") setStatus("missing_key");
      else if (res.error === "no_captions") setStatus("no_captions");
      else {
        setStatus("error");
        setMessage("message" in res ? String(res.message) : "error");
      }
    }).catch((err: Error) => {
      setStatus("error");
      setMessage(err.message);
    });
  }

  useEffect(() => {
    void getMyProfile().then(setProfile).catch(() => setProfile(null));
    void resolveVideo({ data: { videoId } }).then(setMeta).catch(() => setMeta(null));
    loadLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (status !== "loading") return;
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
      setGenStep((s) => (s + 1) % 3);
    }, 4000);
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [status, videoId]);

  useEffect(() => {
    const rate = profile?.playbackSpeed ?? 1;
    try {
      playerRef.current?.setPlaybackRate(rate);
    } catch {
      /* player not ready */
    }
  }, [profile?.playbackSpeed]);

  function flash(text: string) {
    setSavedFlash(text);
    window.setTimeout(() => setSavedFlash(null), 1600);
  }

  function handlePlay(start: number, end: number, opts?: { rate?: number }) {
    try {
      const rate = opts?.rate ?? profile?.playbackSpeed ?? 1;
      playerRef.current?.setPlaybackRate(rate);
    } catch {
      /* player not ready */
    }
    return playClip(playerRef.current, start, end, videoId);
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
            playbackRate={profile?.playbackSpeed ?? 1}
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
            {status === "loading" && <GeneratingPanel locale={locale} step={genStep} elapsed={elapsed} />}
            {status === "missing_key" && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="font-display text-lg">{t(locale, "engineOffTitle")}</h2>
                <p className="mt-2 text-sm text-muted">{t(locale, "engineOffBody")}</p>
                <Button className="mt-4" variant="secondary" onClick={loadLesson}>
                  {t(locale, "generatingRetry")}
                </Button>
              </div>
            )}
            {status === "no_captions" && (
              <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">{t(locale, "noCaptions")}</div>
            )}
            {status === "error" && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-sm text-accent">{message}</p>
                <Button className="mt-4" variant="secondary" onClick={loadLesson}>
                  {t(locale, "generatingRetry")}
                </Button>
              </div>
            )}
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
      {nudge && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
            <h2 className="font-display text-2xl">{t(locale, "placementNudgeTitle")}</h2>
            <p className="mt-3 text-sm text-muted">{t(locale, "placementNudgeBody")}</p>
            <div className="mt-6 grid gap-2">
              <Button
                className="w-full"
                onClick={() => {
                  setNudge(false);
                  void navigate({ to: "/placement" });
                }}
              >
                {t(locale, "takePlacement")}
              </Button>
              <Button className="w-full" variant="secondary" onClick={() => setNudge(false)}>
                {t(locale, "later")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function GeneratingPanel({
  locale,
  step,
  elapsed,
}: {
  locale: Locale;
  step: number;
  elapsed: number;
}) {
  const stages = [t(locale, "generatingCaption"), t(locale, "generatingItems"), t(locale, "generatingAlmost")];
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <span className="size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <div>
          <h2 className="font-display text-lg">{t(locale, "generatingTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{stages[step] ?? stages[0]}</p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.min(92, 12 + elapsed * 2.2)}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-subtle">
        {t(locale, "generatingWait")} · {elapsed}s
      </p>
    </div>
  );
}
