import { useMemo, useState } from "react";
import { Volume2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/schema";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  buildVocabQuiz,
  extractUsefulSentences,
  extractVocabBank,
  type VocabEntry,
  type VocabQuizItem,
} from "@/lib/us-english";
import type { CaptionLine } from "@/lib/caption-parse";
import type { GeneratedLesson, VocabItem } from "@/lib/schema";

export function VocabStudyPanel({
  locale,
  lesson,
  captions,
  onSaveWord,
  onPlaySentence,
}: {
  locale: Locale;
  lesson: GeneratedLesson;
  captions: CaptionLine[];
  onSaveWord: (v: VocabItem, clip: { start: number; end: number }) => void;
  onPlaySentence: (start: number, end: number) => void | Promise<void>;
}) {
  const extra = useMemo(() => {
    const bag: VocabItem[] = [];
    for (const item of [...lesson.listening, ...lesson.speaking]) {
      bag.push(...item.vocab);
    }
    return bag;
  }, [lesson]);

  const bank = useMemo(
    () => extractVocabBank(captions.length ? captions : fallbackCaptions(lesson), extra, 16),
    [captions, extra, lesson],
  );
  const sentences = useMemo(
    () => extractUsefulSentences(captions.length ? captions : fallbackCaptions(lesson), 8),
    [captions, lesson],
  );

  const [known, setKnown] = useState<Record<string, boolean>>({});
  const [face, setFace] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"study" | "quiz" | "result">("study");
  const [thisVideoOnly, setThisVideoOnly] = useState(false);
  const [quiz, setQuiz] = useState<VocabQuizItem[]>([]);
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const knownCount = bank.filter((b) => known[b.word]).length;
  const ready = knownCount >= Math.min(4, bank.length) || knownCount === bank.length;
  const visible = thisVideoOnly ? bank.filter((b) => (b.example || "").length > 0).slice(0, 12) : bank;

  function startQuiz() {
    const q = buildVocabQuiz(bank, Math.min(10, Math.max(6, bank.length)));
    setQuiz(q);
    setQi(0);
    setPicked(null);
    setScore(0);
    setMode("quiz");
  }

  function pickChoice(choice: string) {
    if (picked) return;
    const item = quiz[qi];
    if (!item) return;
    setPicked(choice);
    if (choice === item.answer) setScore((s) => s + 1);
  }

  function nextQuiz() {
    if (qi + 1 >= quiz.length) {
      setMode("result");
      return;
    }
    setQi((n) => n + 1);
    setPicked(null);
  }

  if (!bank.length) {
    return (
      <article className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="font-display text-lg">{t(locale, "vocabTitle")}</h3>
        <p className="mt-2 text-sm text-muted">{t(locale, "vocabEmpty")}</p>
      </article>
    );
  }

  if (mode === "result") {
    const pct = quiz.length ? Math.round((score / quiz.length) * 100) : 0;
    return (
      <article className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="font-display text-lg">{t(locale, "vocabQuizDone")}</h3>
        <p className="mt-3 font-display text-3xl tabular-nums">{pct}%</p>
        <p className="mt-1 text-sm text-muted">
          {score} / {quiz.length} · {pct >= 80 ? t(locale, "vocabQuizPass") : t(locale, "vocabQuizRetry")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setMode("study")}>{t(locale, "vocabBackStudy")}</Button>
          <Button variant="secondary" onClick={startQuiz}>
            {t(locale, "vocabQuizAgain")}
          </Button>
        </div>
      </article>
    );
  }

  if (mode === "quiz") {
    const item = quiz[qi];
    if (!item) return null;
    const revealed = picked !== null;
    return (
      <article className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{t(locale, "vocabQuiz")}</span>
          <span className="tabular-nums">
            {qi + 1} / {quiz.length}
          </span>
        </div>
        <p className="mt-2 text-xs text-subtle">{item.promptKo}</p>
        <h3 className="mt-2 font-display text-lg leading-snug break-words">{item.prompt}</h3>
        {item.hint && <p className="mt-1 text-xs text-muted">{item.hint}</p>}
        <ul className="mt-4 grid gap-2">
          {item.choices.map((choice) => {
            const ok = choice === item.answer;
            const show = revealed && (choice === picked || ok);
            return (
              <li key={choice}>
                <button
                  type="button"
                  disabled={revealed}
                  onClick={() => pickChoice(choice)}
                  className={cn(
                    "min-h-11 w-full rounded-lg border border-border bg-elevated px-4 py-3 text-left text-sm",
                    show && ok && "border-ok text-ok",
                    show && choice === picked && !ok && "border-accent text-accent",
                  )}
                >
                  {choice}
                </button>
              </li>
            );
          })}
        </ul>
        {revealed && (
          <Button className="mt-4 w-full" onClick={nextQuiz}>
            {qi + 1 >= quiz.length ? t(locale, "vocabSeeResult") : t(locale, "nextItem")}
          </Button>
        )}
      </article>
    );
  }

  return (
    <div className="grid gap-4">
      <article className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg">{t(locale, "vocabTitle")}</h3>
            <p className="mt-1 text-sm text-muted">{t(locale, "vocabBody")}</p>
          </div>
          <p className="text-xs tabular-nums text-muted">
            {knownCount}/{bank.length}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={cn("rounded-full border px-3 py-1 text-xs", !thisVideoOnly ? "border-accent text-fg" : "border-border text-muted")}
            onClick={() => setThisVideoOnly(false)}
          >
            {t(locale, "allVocab")}
          </button>
          <button
            type="button"
            className={cn("rounded-full border px-3 py-1 text-xs", thisVideoOnly ? "border-accent text-fg" : "border-border text-muted")}
            onClick={() => setThisVideoOnly(true)}
          >
            {t(locale, "thisVideoOnly")}
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-ok transition-all"
            style={{ width: `${bank.length ? (knownCount / bank.length) * 100 : 0}%` }}
          />
        </div>
        <ul className="mt-4 grid gap-2">
          {visible.map((entry) => (
            <VocabFlash
              key={entry.word}
              entry={entry}
              locale={locale}
              face={face[entry.word] ?? 0}
              known={Boolean(known[entry.word])}
              onFlip={() => setFace((m) => ({ ...m, [entry.word]: ((m[entry.word] ?? 0) + 1) % 3 }))}
              onKnown={() => setKnown((m) => ({ ...m, [entry.word]: true }))}
              onAgain={() => setKnown((m) => ({ ...m, [entry.word]: false }))}
              onPlay={() => {
                const hit = captions.find((c) => c.text.toLowerCase().includes(entry.word.toLowerCase()));
                const start = hit?.start ?? lesson.windowStartSec ?? 0;
                void onPlaySentence(start, start + 2);
              }}
              onSave={() =>
                onSaveWord(
                  {
                    word: entry.word,
                    meaningKo: entry.meaningKo,
                    meaningEn: entry.meaningEn,
                    ipa: entry.ipa,
                  },
                  { start: lesson.windowStartSec ?? 0, end: lesson.windowEndSec ?? 12 },
                )
              }
            />
          ))}
        </ul>
        <Button className="mt-4 w-full" disabled={!ready} onClick={startQuiz}>
          {t(locale, "vocabStartQuiz")}
        </Button>
        {!ready && <p className="mt-2 text-xs text-subtle">{t(locale, "vocabNeedKnown")}</p>}
      </article>
      {sentences.length > 0 && (
        <article className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="font-display text-lg">{t(locale, "vocabSentences")}</h3>
          <p className="mt-1 text-sm text-muted">{t(locale, "vocabSentencesBody")}</p>
          <ul className="mt-3 grid gap-2">
            {sentences.map((s) => (
              <li key={`${s.startSec}-${s.text.slice(0, 24)}`} className="rounded-xl border border-border bg-elevated px-4 py-3">
                <p className="text-sm leading-relaxed">{s.text}</p>
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs text-muted"
                  onClick={() => void onPlaySentence(s.startSec, s.endSec)}
                >
                  <Volume2 className="size-3.5" />
                  {t(locale, "playClip")}
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

function VocabFlash({
  entry,
  locale,
  face,
  known,
  onFlip,
  onKnown,
  onAgain,
  onSave,
  onPlay,
}: {
  entry: VocabEntry;
  locale: Locale;
  face: number;
  known: boolean;
  onFlip: () => void;
  onKnown: () => void;
  onAgain: () => void;
  onSave: () => void;
  onPlay: () => void;
}) {
  const meaning = locale === "ko" ? entry.meaningKo : entry.meaningEn || entry.meaningKo;
  const label = face === 0 ? t(locale, "cardEn") : face === 1 ? t(locale, "cardMeaning") : t(locale, "cardExample");
  const body = face === 0 ? entry.word : face === 1 ? meaning : entry.example || entry.word;
  return (
    <li className={cn("rounded-xl border border-border bg-elevated px-4 py-3", known && "border-ok/40")}>
      <button type="button" onClick={onFlip} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-subtle">{label}</p>
          {entry.kind === "phrase" && (
            <span className="text-[10px] uppercase tracking-wider text-subtle">{t(locale, "vocabPhrase")}</span>
          )}
        </div>
        <p className="mt-1 font-display text-base">{body}</p>
      </button>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="text-xs text-muted" onClick={onPlay}>
          <Volume2 className="mr-1 inline size-3.5" />
          {t(locale, "replay")}
        </button>
        <button type="button" className="text-xs text-muted" onClick={onSave}>
          {t(locale, "saveWord")}
        </button>
        <button type="button" className="text-xs text-ok" onClick={onKnown}>
          {t(locale, "vocabKnow")}
        </button>
        <button type="button" className="text-xs text-muted" onClick={onAgain}>
          {t(locale, "vocabAgain")}
        </button>
      </div>
    </li>
  );
}

function fallbackCaptions(lesson: GeneratedLesson): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const item of [...lesson.listening, ...lesson.speaking]) {
    out.push({
      start: item.clip.startSec,
      dur: Math.max(0.6, item.clip.endSec - item.clip.startSec),
      text: "target" in item ? item.target : item.clip.caption,
    });
  }
  return out;
}
