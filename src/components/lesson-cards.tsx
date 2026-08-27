import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, RotateCcw, Volume2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/mic-button";
import type { ListeningQuestion, Locale, SpeakingQuestion, VocabItem } from "@/lib/schema";
import { coachLine, createMicCapture, normalizeWords, speakEnglish, wordAccuracy, type MicCapture } from "@/lib/speech";
import { t } from "@/lib/i18n";
import { cn, formatTimestamp } from "@/lib/utils";

export function ListeningCard({
  item,
  locale,
  onPlayClip,
  onSaveWord,
  onSaveClip,
}: {
  item: ListeningQuestion;
  locale: Locale;
  onPlayClip: (start: number, end: number) => void | Promise<void>;
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onSaveClip: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const revealed = picked !== null;
  const correct = picked === item.answer;

  return (
    <article className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium tracking-wide text-muted">
        <span>LISTENING · {formatTimestamp(item.clip.startSec)}–{formatTimestamp(item.clip.endSec)}</span>
        <button type="button" className="text-muted hover:text-fg" onClick={onSaveClip} aria-label={t(locale, "saveClip")}>
          <Bookmark className="size-4" />
        </button>
      </div>
      <h3 className="mt-3 font-display text-lg font-medium">{item.prompt}</h3>
      <p className="mt-1 text-sm text-muted">{item.stem}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void onPlayClip(item.clip.startSec, item.clip.endSec)}>
          <Volume2 className="size-4" />
          {t(locale, "playClip")}
        </Button>
      </div>
      <ul className="mt-4 grid gap-2">
        {item.choices.map((choice) => {
          const isAnswer = choice === item.answer;
          const show = revealed && (choice === picked || isAnswer);
          return (
            <li key={choice}>
              <button
                type="button"
                disabled={revealed}
                onClick={() => setPicked(choice)}
                className={cn(
                  "w-full rounded-lg border border-border bg-elevated px-4 py-3 text-left text-sm transition-colors",
                  show && isAnswer && "border-ok text-ok",
                  show && choice === picked && !isAnswer && "border-accent text-accent",
                )}
              >
                {choice}
              </button>
            </li>
          );
        })}
      </ul>
      {revealed && (
        <p className="mt-4 text-sm text-muted">
          <span className="font-medium text-fg">{correct ? t(locale, "correct") : t(locale, "wrong")}. </span>
          {locale === "ko" ? item.explanationKo : item.explanationEn}
        </p>
      )}
      <VocabRow items={item.vocab} locale={locale} onSave={(v) => onSaveWord(v, { start: item.clip.startSec, end: item.clip.endSec })} />
    </article>
  );
}

type ShadowPhase = "ready" | "listen" | "countdown" | "shadow" | "done";

export function SpeakingCard({
  item,
  locale,
  onPlayClip,
  onSaveWord,
  onSaveClip,
  onScored,
}: {
  item: SpeakingQuestion;
  locale: Locale;
  onPlayClip: (start: number, end: number, opts?: { rate?: number }) => void | Promise<void>;
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onSaveClip: () => void;
  onScored: (payload: { target: string; transcript: string; accuracy: number }) => void;
}) {
  const [phase, setPhase] = useState<ShadowPhase>("ready");
  const [count, setCount] = useState(3);
  const [transcript, setTranscript] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [hits, setHits] = useState<{ word: string; hit: boolean }[]>([]);
  const [karaokeIdx, setKaraokeIdx] = useState(-1);
  const scoredRef = useRef(false);
  const liveRef = useRef("");
  const cap = useRef<MicCapture | null>(null);
  const cancelled = useRef(false);
  const words = item.target.split(/\s+/).filter(Boolean);

  useEffect(() => {
    cancelled.current = false;
    cap.current = createMicCapture({
      onTranscript: (text) => {
        liveRef.current = text;
        setTranscript(text);
      },
      onError: () => {
        /* mic button path still available */
      },
      onState: () => {},
    });
    return () => {
      cancelled.current = true;
      cap.current?.stop();
    };
  }, [item.target]);

  function applySaid(text: string) {
    const said = text.trim();
    setTranscript(said);
    const heard = new Set(normalizeWords(said));
    const nextHits = words.map((word) => ({
      word,
      hit: heard.has(normalizeWords(word)[0] ?? ""),
    }));
    setHits(nextHits);
    if (!said) {
      setAccuracy(0);
      return;
    }
    const acc = wordAccuracy(item.target, said);
    setAccuracy(acc);
    if (!scoredRef.current) {
      scoredRef.current = true;
      onScored({ target: item.target, transcript: said, accuracy: acc });
    }
  }

  function sleep(ms: number) {
    return new Promise((r) => window.setTimeout(r, ms));
  }

  async function runListen() {
    setPhase("listen");
    setKaraokeIdx(-1);
    await Promise.resolve(onPlayClip(item.clip.startSec, item.clip.endSec));
    if (!cancelled.current) setPhase("ready");
  }

  async function runShadow(rate?: number) {
    scoredRef.current = false;
    setAccuracy(null);
    setTranscript("");
    setHits([]);
    liveRef.current = "";
    setKaraokeIdx(-1);
    setPhase("countdown");
    for (let n = 3; n >= 1; n--) {
      if (cancelled.current) return;
      setCount(n);
      await sleep(650);
    }
    if (cancelled.current) return;
    setPhase("shadow");
    const dur = Math.max(1.2, item.clip.endSec - item.clip.startSec) / (rate && rate > 0 ? rate : 1);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const p = (Date.now() - started) / (dur * 1000);
      setKaraokeIdx(Math.min(words.length - 1, Math.floor(p * words.length)));
    }, 70);
    await cap.current?.start();
    await Promise.resolve(onPlayClip(item.clip.startSec, item.clip.endSec, rate ? { rate } : undefined));
    window.clearInterval(tick);
    const text = cap.current?.stop() ?? liveRef.current;
    if (cancelled.current) return;
    applySaid(text);
    setPhase("done");
  }

  function reset() {
    cap.current?.stop();
    setPhase("ready");
    setAccuracy(null);
    setTranscript("");
    setHits([]);
    setKaraokeIdx(-1);
    scoredRef.current = false;
  }

  const busy = phase === "listen" || phase === "countdown" || phase === "shadow";

  return (
    <article className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between text-xs font-medium tracking-wide text-muted">
        <span>SHADOWING · {formatTimestamp(item.clip.startSec)}–{formatTimestamp(item.clip.endSec)}</span>
        <button type="button" className="text-muted hover:text-fg" onClick={onSaveClip} aria-label={t(locale, "saveClip")}>
          <Bookmark className="size-4" />
        </button>
      </div>

      {phase === "ready" && accuracy === null && (
        <div className="mt-3 rounded-xl border border-border bg-elevated px-4 py-3">
          <p className="text-sm font-medium">{t(locale, "shadowHow")}</p>
          <p className="mt-1 text-xs text-muted">{t(locale, "shadowHowBody")}</p>
        </div>
      )}

      <p className="mt-3 text-sm text-muted">
        {phase === "listen"
          ? t(locale, "listeningNow")
          : phase === "shadow" || phase === "countdown"
            ? t(locale, "shadowingNow")
            : phase === "done"
              ? t(locale, "readyToShadow")
              : t(locale, "targetLine")}
      </p>
      <blockquote className="mt-1 font-display text-xl leading-snug">
        {words.map((w, i) => (
          <span
            key={`${w}-${i}`}
            className={cn(
              "mr-[0.3em] inline-block transition-colors",
              phase === "shadow" && i <= karaokeIdx && "text-accent",
              phase === "done" && hits[i] && (hits[i].hit ? "text-ok" : "text-accent underline decoration-accent/70"),
            )}
          >
            {w}
          </span>
        ))}
      </blockquote>
      <p className="mt-2 text-sm text-muted">{item.prompt}</p>

      {phase === "countdown" && (
        <div className="mt-4 grid h-20 place-items-center rounded-xl bg-elevated font-display text-5xl text-accent">
          {count}
        </div>
      )}
      {phase === "shadow" && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-elevated px-4 py-3 text-sm text-accent">
          {t(locale, "shadowingNow")}
        </div>
      )}
      {phase === "listen" && (
        <div className="mt-4 rounded-xl border border-border bg-elevated px-4 py-3 text-sm text-muted">
          {t(locale, "listeningNow")}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runListen()}>
          <Volume2 className="size-4" />
          {t(locale, "listenFirst")}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void runShadow()}>
          {t(locale, "shadowAlong")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runShadow(0.75)}>
          {t(locale, "slowerShadow")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => speakEnglish(item.target, 0.88)}>
          {t(locale, "replay")}
        </Button>
        {phase === "done" && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw className="size-4" />
            {t(locale, "tryAgain")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-subtle">{t(locale, "headphoneHint")}</p>

      {transcript && (
        <p className="mt-3 text-sm text-muted">“{transcript}”</p>
      )}
      {accuracy !== null && (
        <div className="mt-4 flex items-center gap-4">
          <div
            className="score-ring grid size-16 place-items-center rounded-full p-[3px]"
            style={{ ["--p" as string]: accuracy }}
          >
            <div className="grid size-full place-items-center rounded-full bg-surface text-sm font-medium tabular-nums">
              {accuracy}%
            </div>
          </div>
          <div>
            <p className="text-sm text-muted">{coachLine(accuracy, locale)}</p>
            {hits.some((h) => !h.hit) && (
              <p className="mt-1 text-xs text-muted">
                {t(locale, "missedWords")}:{" "}
                {hits.filter((h) => !h.hit).map((h) => h.word).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
      {phase === "ready" && (
        <div className="mt-3">
          <MicButton
            locale={locale}
            size="sm"
            onTranscript={(text) => {
              liveRef.current = text;
              setTranscript(text);
            }}
            onStop={(text) => applySaid(text)}
          />
        </div>
      )}
      <VocabRow items={item.vocab} locale={locale} onSave={(v) => onSaveWord(v, { start: item.clip.startSec, end: item.clip.endSec })} />
    </article>
  );
}

function VocabRow({
  items,
  locale,
  onSave,
}: {
  items: VocabItem[];
  locale: Locale;
  onSave: (v: VocabItem) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((v) => (
        <button
          key={v.word}
          type="button"
          onClick={() => onSave(v)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-fg"
        >
          <Check className="size-3 text-muted" />
          <span className="font-medium">{v.word}</span>
          <span className="text-muted">{locale === "ko" ? v.meaningKo : v.meaningEn || v.meaningKo}</span>
        </button>
      ))}
    </div>
  );
}
