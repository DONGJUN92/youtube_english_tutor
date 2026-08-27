import { useRef, useState } from "react";
import { Bookmark, Check, RotateCcw, Volume2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/mic-button";
import type { ListeningQuestion, Locale, SpeakingQuestion, VocabItem } from "@/lib/schema";
import { coachLine, speakEnglish, wordAccuracy } from "@/lib/speech";
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
  onPlayClip: (start: number, end: number) => void;
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
        <Button size="sm" variant="secondary" onClick={() => onPlayClip(item.clip.startSec, item.clip.endSec)}>
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
  onPlayClip: (start: number, end: number) => void;
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onSaveClip: () => void;
  onScored: (payload: { target: string; transcript: string; accuracy: number }) => void;
}) {
  const [transcript, setTranscript] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const scoredRef = useRef(false);

  function applySaid(text: string, done: boolean) {
    setTranscript(text);
    if (!done || !text.trim()) return;
    const acc = wordAccuracy(item.target, text);
    setAccuracy(acc);
    if (!scoredRef.current) {
      scoredRef.current = true;
      onScored({ target: item.target, transcript: text, accuracy: acc });
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between text-xs font-medium tracking-wide text-muted">
        <span>SPEAKING · {formatTimestamp(item.clip.startSec)}–{formatTimestamp(item.clip.endSec)}</span>
        <button type="button" className="text-muted hover:text-fg" onClick={onSaveClip} aria-label={t(locale, "saveClip")}>
          <Bookmark className="size-4" />
        </button>
      </div>
      <p className="mt-3 text-sm text-muted">{t(locale, "targetLine")}</p>
      <blockquote className="mt-1 font-display text-xl leading-snug">{item.target}</blockquote>
      <p className="mt-2 text-sm text-muted">{item.prompt}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => onPlayClip(item.clip.startSec, item.clip.endSec)}>
          <Volume2 className="size-4" />
          {t(locale, "playClip")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => speakEnglish(item.target, 0.88)}>
          {t(locale, "replay")}
        </Button>
        <MicButton
          locale={locale}
          size="sm"
          onTranscript={(text) => applySaid(text, false)}
          onStop={(text) => applySaid(text, true)}
        />
        {accuracy !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAccuracy(null);
              setTranscript("");
              scoredRef.current = false;
            }}
          >
            <RotateCcw className="size-4" />
            {t(locale, "tryAgain")}
          </Button>
        )}
      </div>
      {transcript && <p className="mt-3 text-sm text-muted">“{transcript}”</p>}
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
          <p className="text-sm text-muted">{coachLine(accuracy, locale)}</p>
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
