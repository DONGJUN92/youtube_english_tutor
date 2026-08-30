import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { ListeningCard, SpeakingCard } from "@/components/lesson-cards";
import { VocabStudyPanel } from "@/components/vocab-study";
import { playClip, YoutubePlayer, type YtPlayer } from "@/components/youtube-player";
import { t, useLocaleStore } from "@/lib/i18n";
import { formatClock, type CaptionWindow } from "@/lib/caption-windows";
import { fetchCaptionsInBrowser, captionsFromYoutubePlayer, attachYoutubeCaptionHarvest, loadCaptionsFromApi, captionsWithPoToken, captionsFromYtEdge, persistClientCaptions, lastCaptionPoToken, pollCaptionsFromApi } from "@/lib/client-captions";
import { sanitizeCaptionLines, type CaptionLine } from "@/lib/caption-parse";
import { enrichLesson, listenItemKey, speakItemKey } from "@/lib/lesson-pedagogy";
import { listenToShadowItem } from "@/lib/learner-practice";
import {
  getMyProfile,
  listProgress,
  loadOrGenerateLesson,
  resolveVideo,
  saveClipBookmark,
  saveProgress,
  saveSpeakingAttempt,
  saveVocab,
} from "@/lib/user-data";
import type { PublicProfile } from "@/lib/server/fns";
import type { GeneratedLesson, ListeningQuestion, Locale, VocabItem } from "@/lib/schema";
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
  const durationRef = useRef<number | null>(null);
  const captionsRef = useRef<CaptionLine[] | null>(null);
  const statusRef = useRef<"loading" | "ready" | "missing_key" | "no_captions" | "error">("loading");
  const poTokenRef = useRef<string | undefined>(undefined);
  const [tab, setTab] = useState<"listening" | "speaking" | "vocab">("listening");
  const [meta, setMeta] = useState<{ title: string; hasCaptions: boolean; hasSeededLesson: boolean; captionCount: number; durationSec?: number } | null>(null);
  const [lesson, setLesson] = useState<GeneratedLesson | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing_key" | "no_captions" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [genStep, setGenStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [windows, setWindows] = useState<CaptionWindow[]>([]);
  const [readyStarts, setReadyStarts] = useState<number[]>([0]);
  const [activeStart, setActiveStart] = useState(0);
  const [nextStart, setNextStart] = useState<number | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [captionNote, setCaptionNote] = useState<string | null>(null);
  const [listenPicks, setListenPicks] = useState<Record<string, string>>({});
  const [captionLines, setCaptionLines] = useState<CaptionLine[]>([]);
  const [listenRetry, setListenRetry] = useState(false);
  const [extraSpeak, setExtraSpeak] = useState<GeneratedLesson["speaking"]>([]);
  const levelNudgeRef = useRef(0);
  const loadGenRef = useRef(0);

  function setWatchStatus(next: "loading" | "ready" | "missing_key" | "no_captions" | "error") {
    statusRef.current = next;
    setStatus(next);
  }

  function applyLessonResult(res: {
    ok: true;
    lesson: GeneratedLesson;
    nudgePlacement?: boolean;
    nextWindowStartSec?: number | null;
    durationSec?: number | null;
    windows?: CaptionWindow[];
    readyWindowStarts?: number[];
  }) {
    setLesson(enrichLesson(res.lesson, captionsRef.current ?? []));
    setWatchStatus("ready");
    setItemIndex(0);
    setListenPicks({});
    setListenRetry(false);
    setExtraSpeak([]);
    if (res.nudgePlacement) setNudge(true);
    const plan = res.windows?.length ? res.windows : res.lesson.windows ?? [];
    if (plan.length) setWindows(plan);
    const start = res.lesson.windowStartSec ?? 0;
    setActiveStart(start);
    setNextStart(res.nextWindowStartSec ?? res.lesson.nextWindowStartSec ?? null);
    if (res.readyWindowStarts?.length) {
      setReadyStarts((prev) => [...new Set([...prev, ...res.readyWindowStarts!, start])].sort((a, b) => a - b));
    } else {
      setReadyStarts((prev) => [...new Set([...prev, start])].sort((a, b) => a - b));
    }
  }

  function applyCaptions(lines: CaptionLine[]) {
    const clean = sanitizeCaptionLines(lines);
    if (clean.length < 4) return clean;
    captionsRef.current = clean;
    setCaptionLines(clean);
    setCaptionNote(t(locale, "captionTimed").replace("{n}", String(clean.length)));
    return clean;
  }

  async function hydrateCaptions() {
    if (captionsRef.current && captionsRef.current.length >= 4) return;
    const [store, edge] = await Promise.all([
      loadCaptionsFromApi(videoId, { peek: true }),
      captionsFromYtEdge(videoId),
    ]);
    const incoming = edge.length >= 4 ? edge : store;
    if (incoming.length >= 4) applyCaptions(incoming);
  }

  async function resolveCaptions(): Promise<CaptionLine[] | null> {
    if (captionsRef.current && captionsRef.current.length >= 4) return captionsRef.current;
    const [store, edge] = await Promise.all([
      loadCaptionsFromApi(videoId, { peek: true }),
      captionsFromYtEdge(videoId),
    ]);
    const quick = edge.length >= store.length ? edge : store;
    if (quick.length >= 4) return applyCaptions(quick);
    const started = Date.now();
    while (!playerRef.current && Date.now() - started < 2500) {
      await new Promise((r) => window.setTimeout(r, 150));
    }
    const fromPlayer = await captionsFromYoutubePlayer(playerRef.current, videoId);
    if (fromPlayer.length >= 4) {
      const clean = applyCaptions(fromPlayer);
      void persistClientCaptions(videoId, clean, { title: meta?.title, durationSec: durationRef.current ?? undefined });
      return clean;
    }
    const fromPot = await captionsWithPoToken(videoId);
    poTokenRef.current = lastCaptionPoToken();
    if (fromPot.length >= 4) return applyCaptions(fromPot);
    const fetched = sanitizeCaptionLines(await fetchCaptionsInBrowser(videoId));
    if (fetched.length >= 4) {
      applyCaptions(fetched);
      void persistClientCaptions(videoId, fetched, { title: meta?.title, durationSec: durationRef.current ?? undefined });
      return fetched;
    }
    const polled = sanitizeCaptionLines(await pollCaptionsFromApi(videoId, 12_000));
    if (polled.length >= 4) return applyCaptions(polled);
    return null;
  }

  function loadLesson(windowStartSec = 0, keepLesson = false, refetchCaptions = false) {
    const gen = ++loadGenRef.current;
    const alive = () => gen === loadGenRef.current;
    setWatchStatus("loading");
    if (!keepLesson) setLesson(null);
    setMessage(null);
    setNudge(false);
    setGenStep(0);
    setElapsed(0);
    setActiveStart(windowStartSec);
    if (refetchCaptions) captionsRef.current = null;
    void (async () => {
      void fetch("/api/caption-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: videoId }),
        cache: "no-store",
      }).catch(() => {});
      const peek = await loadOrGenerateLesson({
        data: {
          videoId,
          windowStartSec,
          durationSec: durationRef.current ?? undefined,
          reuseOnly: true,
          levelNudge: levelNudgeRef.current,
        },
      });
      if (!alive()) return;
      if (peek.ok) {
        applyLessonResult(peek);
        void hydrateCaptions();
        return;
      }
      const captions = await resolveCaptions();
      if (!alive()) return;
      const res = await loadOrGenerateLesson({
        data: {
          videoId,
          windowStartSec,
          captions: captions ?? undefined,
          durationSec: durationRef.current ?? playerRef.current?.getDuration() ?? undefined,
          poToken: poTokenRef.current,
          levelNudge: levelNudgeRef.current,
        },
      });
      if (!alive()) return;
      if (res.ok) {
        applyLessonResult(res);
        return;
      }
      if (res.error === "missing_key") setWatchStatus("missing_key");
      else if (res.error === "no_captions" || res.error === "need_generate") {
        setWatchStatus("no_captions");
        if (!captionsRef.current?.length) setCaptionNote(t(locale, "captionMissing"));
      } else {
        setWatchStatus("error");
        setMessage(t(locale, "openaiFailed"));
      }
    })().catch((err: Error) => {
      if (!alive()) return;
      setWatchStatus("error");
      const raw = err.message || "";
      setMessage(/deployment|timed out|timeout|504|Failed to fetch|NetworkError/i.test(raw) ? t(locale, "openaiFailed") : raw);
    });
  }

  useEffect(() => {
    let cancelled = false;
    attachYoutubeCaptionHarvest();
    captionsRef.current = null;
    setCaptionLines([]);
    setCaptionNote(t(locale, "captionReading"));
    setWatchStatus("loading");
    setLesson(null);
    void getMyProfile().then(setProfile).catch(() => setProfile(null));
    void resolveVideo({ data: { videoId } }).then(setMeta).catch(() => setMeta(null));
    void (async () => {
      try {
        const rows = await listProgress();
        if (cancelled) return;
        const row = rows.find((r) => r.video_id === videoId);
        levelNudgeRef.current = row ? Number(row.level_delta) || 0 : 0;
      } catch {
        if (cancelled) return;
        levelNudgeRef.current = 0;
      }
      if (!cancelled) loadLesson();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (status !== "loading") return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const e = Math.floor((Date.now() - started) / 1000);
      setElapsed(e);
      setGenStep(Math.floor(e / 4) % 3);
    }, 250);
    return () => window.clearInterval(id);
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
        exampleText: captionLines.find((c) => c.start >= clip.start - 0.4 && c.start <= clip.end)?.text,
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
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <section className="min-w-0 lg:sticky lg:top-4">
          <YoutubePlayer
            videoId={videoId}
            playbackRate={profile?.playbackSpeed ?? 1}
            onReady={(p) => {
              playerRef.current = p;
              try {
                const dur = p.getDuration();
                if (Number.isFinite(dur) && dur > 0) durationRef.current = dur;
              } catch {
                /* player not ready */
              }
              const params = new URLSearchParams(window.location.search);
              const start = Number(params.get("t"));
              const end = Number(params.get("end"));
              if (Number.isFinite(start) && start >= 0) {
                void playClip(p, start, Number.isFinite(end) && end > start ? end : start + 30, videoId);
              }
              if (!captionsRef.current?.length) {
                void captionsFromYoutubePlayer(p, videoId).then((lines) => {
                  const clean = sanitizeCaptionLines(lines);
                  if (clean.length < 4) return;
                  captionsRef.current = clean;
                  setCaptionLines(clean);
                  setCaptionNote(t(locale, "captionTimed").replace("{n}", String(clean.length)));
                  void persistClientCaptions(videoId, clean, { title: meta?.title, durationSec: durationRef.current ?? undefined });
                  if (statusRef.current === "no_captions" || statusRef.current === "error") {
                    loadLesson(activeStart, true);
                  }
                });
              }
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
          {captionNote && (
            <p className={cn("mt-2 text-xs", captionNote.includes("못 읽") || captionNote.includes("not available") ? "text-warn" : captionNote.includes("읽는 중") || captionNote.includes("Reading") ? "text-muted" : "text-ok")}>
              {captionNote}
            </p>
          )}
        </section>
        <section>
          <div className="flex rounded-full border border-border p-1">
            <button
              type="button"
              className={cn("h-9 flex-1 rounded-full text-sm", tab === "listening" && "bg-elevated")}
              onClick={() => {
                setTab("listening");
                setItemIndex(0);
              }}
            >
              {t(locale, "listen")}
            </button>
            <button
              type="button"
              className={cn("h-9 flex-1 rounded-full text-sm", tab === "speaking" && "bg-elevated")}
              onClick={() => {
                setTab("speaking");
                setItemIndex(0);
              }}
            >
              {t(locale, "speak")}
            </button>
            <button
              type="button"
              className={cn("h-9 flex-1 rounded-full text-sm", tab === "vocab" && "bg-elevated")}
              onClick={() => setTab("vocab")}
            >
              {t(locale, "vocab")}
            </button>
          </div>
          {lesson && (
            <p className="mt-2 text-[11px] text-subtle">{t(locale, "flowHint")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {(["listening", "speaking", "vocab"] as const).map((id) => (
              <span
                key={id}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px]",
                  tab === id ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                )}
              >
                {id === "listening" ? t(locale, "flowListen") : id === "speaking" ? t(locale, "flowShadow") : t(locale, "flowVocab")}
              </span>
            ))}
            {extraSpeak.length > 0 && (
              <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">{t(locale, "flowShadowWrong")}</span>
            )}
          </div>
          <SegmentBar
            locale={locale}
            windows={windows}
            readyStarts={readyStarts}
            activeStart={activeStart}
            nextStart={nextStart}
            loading={status === "loading"}
            onSelect={(start) => loadLesson(start, true)}
            onNext={() => {
              if (nextStart == null) return;
              loadLesson(nextStart, true);
            }}
          />
          <div className="mt-4 grid gap-4">
            {status === "loading" && <GeneratingPanel locale={locale} step={genStep} elapsed={elapsed} />}
            {status === "missing_key" && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="font-display text-lg">{t(locale, "engineOffTitle")}</h2>
                <p className="mt-2 text-sm text-muted">{t(locale, "engineOffBody")}</p>
                <Button className="mt-4" variant="secondary" onClick={() => loadLesson(0, false, true)}>
                  {t(locale, "generatingRetry")}
                </Button>
              </div>
            )}
            {status === "no_captions" && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-sm text-muted">{t(locale, "noCaptions")}</p>
                <Button className="mt-4" variant="secondary" onClick={() => loadLesson(activeStart, true, true)}>
                  {t(locale, "generatingRetry")}
                </Button>
              </div>
            )}
            {status === "error" && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-sm text-accent">{message}</p>
                <Button className="mt-4" variant="secondary" onClick={() => loadLesson(0, false, true)}>
                  {t(locale, "generatingRetry")}
                </Button>
              </div>
            )}
            {lesson && tab === "listening" && (
              <ListenBlock
                locale={locale}
                lesson={lesson}
                itemIndex={itemIndex}
                setItemIndex={setItemIndex}
                listenPicks={listenPicks}
                setListenPicks={setListenPicks}
                listenRetry={listenRetry}
                setListenRetry={setListenRetry}
                onPlay={handlePlay}
                onSaveWord={handleSaveWord}
                onSaveClip={handleSaveClip}
                onShadowMiss={(item) => {
                  setExtraSpeak((prev) => {
                    const next = listenToShadowItem(item);
                    if (prev.some((p) => p.clip.startSec === next.clip.startSec)) return prev;
                    return [next, ...prev];
                  });
                  setTab("speaking");
                  setItemIndex(0);
                }}
              />
            )}
            {lesson && tab === "speaking" && (
              <SpeakBlock
                locale={locale}
                lesson={lesson}
                extraSpeak={extraSpeak}
                itemIndex={itemIndex}
                setItemIndex={setItemIndex}
                level={(profile?.preferredCefr as GeneratedLesson["listening"][0]["level"]) || (profile?.cefrLevel as GeneratedLesson["listening"][0]["level"]) || "A2"}
                onPlay={handlePlay}
                onSaveWord={handleSaveWord}
                onSaveClip={handleSaveClip}
                videoId={videoId}
              />
            )}
            {lesson && tab === "vocab" && (
              <VocabStudyPanel
                locale={locale}
                lesson={lesson}
                captions={captionLines}
                onSaveWord={handleSaveWord}
                onPlaySentence={handlePlay}
              />
            )}
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

function QuestionDeck({
  locale,
  index,
  total,
  onIndex,
  onPlayCurrent,
  autoPlay = false,
  children,
}: {
  locale: Locale;
  index: number;
  total: number;
  onIndex: (n: number) => void;
  onPlayCurrent: () => void;
  autoPlay?: boolean;
  children: ReactNode;
}) {
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, total - 1));
  useEffect(() => {
    if (autoPlay && total > 0) onPlayCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, total, autoPlay]);
  if (total <= 0) return null;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{t(locale, "oneItemHint")}</p>
        <p className="text-xs font-medium tabular-nums text-muted">
          {t(locale, "itemProgress").replace("{n}", String(safeIndex + 1)).replace("{m}", String(total))}
        </p>
      </div>
      {children}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={safeIndex <= 0}
          onClick={() => onIndex(safeIndex - 1)}
        >
          {t(locale, "prevItem")}
        </Button>
        <Button
          disabled={safeIndex >= total - 1}
          onClick={() => onIndex(safeIndex + 1)}
        >
          {t(locale, "nextItem")}
        </Button>
      </div>
    </div>
  );
}

function SegmentBar({
  locale,
  windows,
  readyStarts,
  activeStart,
  nextStart,
  loading,
  onSelect,
  onNext,
}: {
  locale: Locale;
  windows: CaptionWindow[];
  readyStarts: number[];
  activeStart: number;
  nextStart: number | null;
  loading: boolean;
  onSelect: (start: number) => void;
  onNext: () => void;
}) {
  if (loading && windows.length === 0) return null;
  if (!loading && windows.length <= 1 && nextStart == null) return null;
  const visible = windows.length
    ? windows.filter((w) => readyStarts.some((s) => Math.abs(s - w.startSec) < 1.5) || Math.abs(w.startSec - activeStart) < 1.5)
    : [];
  const current = windows.find((w) => Math.abs(w.startSec - activeStart) < 1.5);
  return (
    <div className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {t(locale, "segmentNow")}
          {current ? ` · ${formatClock(current.startSec)}–${formatClock(current.endSec)}` : ""}
        </p>
        {nextStart == null && !loading && visible.length > 0 ? (
          <span className="text-xs text-muted">{t(locale, "lastSegment")}</span>
        ) : null}
      </div>
      {visible.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {visible.map((w) => {
            const active = Math.abs(w.startSec - activeStart) < 1.5;
            return (
              <button
                key={w.startSec}
                type="button"
                disabled={loading}
                onClick={() => onSelect(w.startSec)}
                className={cn(
                  "h-8 rounded-full px-3 text-xs",
                  active ? "bg-accent text-white" : "bg-elevated text-muted",
                )}
              >
                {formatClock(w.startSec)}–{formatClock(w.endSec)}
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-xs text-subtle">{t(locale, "nextSegmentHint")}</p>
      {nextStart != null && (
        <Button className="mt-3 w-full" variant="secondary" disabled={loading} onClick={onNext}>
          {t(locale, "nextSegment")}
        </Button>
      )}
      <Link to="/" className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-full text-sm text-muted">
        {t(locale, "endWindow")}
      </Link>
    </div>
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

function ListenBlock({
  locale,
  lesson,
  itemIndex,
  setItemIndex,
  listenPicks,
  setListenPicks,
  listenRetry,
  setListenRetry,
  onPlay,
  onSaveWord,
  onSaveClip,
  onShadowMiss,
}: {
  locale: Locale;
  lesson: GeneratedLesson;
  itemIndex: number;
  setItemIndex: (n: number) => void;
  listenPicks: Record<string, string>;
  setListenPicks: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  listenRetry: boolean;
  setListenRetry: (v: boolean) => void;
  onPlay: (start: number, end: number) => void | Promise<void>;
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onSaveClip: (start: number, end: number, caption: string) => void;
  onShadowMiss: (item: ListeningQuestion) => void;
}) {
  const misses = lesson.listening.filter((it) => {
    const p = listenPicks[listenItemKey(it)];
    return Boolean(p) && p !== it.answer;
  });
  const items = listenRetry ? misses : lesson.listening;
  const current = items[Math.min(itemIndex, Math.max(0, items.length - 1))];
  const answered = lesson.listening.filter((it) => listenPicks[listenItemKey(it)]).length;
  if (!current) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">{t(locale, "retryWrong")}</p>
        <Button className="mt-3" variant="secondary" onClick={() => setListenRetry(false)}>
          {t(locale, "listen")}
        </Button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {lesson.listening.map((it, i) => {
          const key = listenItemKey(it);
          const pick = listenPicks[key];
          return (
            <span
              key={key}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px]",
                i === lesson.listening.indexOf(current) ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
              )}
            >
              {i === 0 ? t(locale, "listenGist") : i === 1 ? t(locale, "listenDetail") : t(locale, "listenInference")}
              {pick ? (pick === it.answer ? " · ok" : " · x") : ""}
            </span>
          );
        })}
      </div>
      <QuestionDeck
        locale={locale}
        index={itemIndex}
        total={items.length}
        onIndex={setItemIndex}
        onPlayCurrent={() => void onPlay(current.clip.startSec, current.clip.endSec)}
      >
        <ListeningCard
          item={current}
          locale={locale}
          index={lesson.listening.indexOf(current)}
          picked={listenPicks[listenItemKey(current)] ?? null}
          onPick={(choice) =>
            setListenPicks((prev) => ({ ...prev, [listenItemKey(current)]: choice }))
          }
          onPlayClip={onPlay}
          onSaveWord={onSaveWord}
          onSaveClip={() => onSaveClip(current.clip.startSec, current.clip.endSec, current.clip.caption)}
          onShadowMiss={() => onShadowMiss(current)}
        />
      </QuestionDeck>
      {answered === lesson.listening.length && misses.length > 0 && !listenRetry && (
        <Button className="mt-3 w-full" variant="secondary" onClick={() => { setListenRetry(true); setItemIndex(0); }}>
          {t(locale, "retryWrong")} · {misses.length}
        </Button>
      )}
    </div>
  );
}

function SpeakBlock({
  locale,
  lesson,
  extraSpeak,
  itemIndex,
  setItemIndex,
  level,
  onPlay,
  onSaveWord,
  onSaveClip,
  videoId,
}: {
  locale: Locale;
  lesson: GeneratedLesson;
  extraSpeak: GeneratedLesson["speaking"];
  itemIndex: number;
  setItemIndex: (n: number) => void;
  level: GeneratedLesson["listening"][0]["level"];
  onPlay: (start: number, end: number, opts?: { rate?: number }) => void | Promise<void>;
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onSaveClip: (start: number, end: number, caption: string) => void;
  videoId: string;
}) {
  const items = [...extraSpeak, ...lesson.speaking];
  const current = items[Math.min(itemIndex, Math.max(0, items.length - 1))];
  if (!current) return null;
  return (
    <QuestionDeck
      locale={locale}
      index={itemIndex}
      total={items.length}
      onIndex={setItemIndex}
      onPlayCurrent={() => void onPlay(current.clip.startSec, current.clip.endSec)}
    >
      <SpeakingCard
        item={current}
        locale={locale}
        level={level}
        onPlayClip={onPlay}
        onSaveWord={onSaveWord}
        onSaveClip={() => onSaveClip(current.clip.startSec, current.clip.endSec, current.target)}
        onScored={(payload) => {
          void saveSpeakingAttempt({
            data: { videoId, target: payload.target, transcript: payload.transcript, accuracy: payload.accuracy },
          });
        }}
      />
    </QuestionDeck>
  );
}

