import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { Clock, Download, Volume2 } from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/mic-button";
import { speakingTurnsFor, type SpeakTurn } from "@/data/speaking-prompts";
import {
  getItem,
  PLACEMENT_BANK_VERSION,
  type PlacementItem,
  type ItemPart,
} from "@/data/placement-bank";
import { t, useLocaleStore, type MessageKey } from "@/lib/i18n";
import {
  PLACEMENT_MAX_STEPS,
  resolveNext,
  scorePlacement,
  startIdForAge,
  type PlacementStep,
} from "@/lib/placement-engine";
import { buildReport, downloadReportCard, personaPortrait, TIER_EN, TIER_KO, type PlacementReport } from "@/lib/placement-report";
import { evaluateSpeakingTurn, getMyProfile, resetPlacement, savePlacementResult } from "@/lib/user-data";
import { speakEnglish, stopSpeaking } from "@/lib/speech";
import { cn, formatTimestamp } from "@/lib/utils";
import type { AgeBand } from "@/lib/schema";
import type { SpeakingEval } from "@/lib/server/openai-lesson";

export const Route = createFileRoute("/placement")({ component: PlacementPage });

const PART_KEY: Record<ItemPart, MessageKey> = {
  part2: "part2",
  part3: "part3",
  part4: "part4",
  part5: "part5",
  part6: "part6",
  part7: "part7",
};

const DIRECTIONS: Record<ItemPart, { ko: string; en: string }> = {
  part2: {
    ko: "질문을 듣고 이어질 말로 가장 알맞은 것을 고르세요.",
    en: "Listen and choose the best response.",
  },
  part3: {
    ko: "대화를 듣고 문제에 답하세요. 문제와 보기는 영어입니다.",
    en: "Listen to the conversation and answer.",
  },
  part4: {
    ko: "안내를 듣고 문제에 답하세요. 문제와 보기는 영어입니다.",
    en: "Listen to the announcement and answer.",
  },
  part5: {
    ko: "빈칸에 들어갈 말로 가장 알맞은 것을 고르세요.",
    en: "Choose the word or phrase that best completes the sentence.",
  },
  part6: {
    ko: "글의 빈칸에 들어갈 말로 가장 알맞은 것을 고르세요.",
    en: "Choose the word or phrase that best completes the text.",
  },
  part7: {
    ko: "글을 읽고 문제에 답하세요. 문제와 보기는 영어입니다.",
    en: "Read the passage and answer the question.",
  },
};

const LETTERS = ["A", "B", "C", "D"] as const;

type Phase = "intro" | "mcq" | "speak" | "done";

function PlacementPage() {
  return (
    <AppShell>
      <AuthGate>
        <PlacementFlow />
      </AuthGate>
    </AppShell>
  );
}

function PlacementFlow() {
  const locale = useLocaleStore((s) => s.locale);
  const navigate = useNavigate();
  const [age, setAge] = useState<AgeBand>("adult");
  const [phase, setPhase] = useState<Phase>("intro");
  const [item, setItem] = useState<PlacementItem | null>(null);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<PlacementStep[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<ReturnType<typeof scorePlacement> | null>(null);
  const [report, setReport] = useState<PlacementReport | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [retakeBusy, setRetakeBusy] = useState(false);
  const [speakIdx, setSpeakIdx] = useState(0);
  const [speakSaid, setSpeakSaid] = useState("");
  const [speakEval, setSpeakEval] = useState<SpeakingEval | null>(null);
  const [speakBusy, setSpeakBusy] = useState(false);
  const [speakScores, setSpeakScores] = useState<number[]>([]);
  const [speakNote, setSpeakNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const locking = useRef(false);
  const itemRef = useRef<PlacementItem | null>(null);
  itemRef.current = item;

  const inProgress = phase === "mcq" || phase === "speak";
  const blocker = useBlocker({
    shouldBlockFn: () => inProgress,
    withResolver: true,
    enableBeforeUnload: inProgress,
  });

  const turns = useMemo(() => speakingTurnsFor(age), [age]);
  const turn: SpeakTurn | undefined = turns[speakIdx];

  useEffect(() => {
    if (phase !== "speak" || !turn) return;
    setShowScript(false);
    setShowHint(false);
    speakEnglish(turn.partnerLine, 0.9);
    return () => stopSpeaking();
  }, [phase, speakIdx, turn]);

  function begin(band: AgeBand) {
    setAge(band);
    setBlocked(false);
    setPhase("intro");
    setResult(null);
    setReport(null);
    setSteps([]);
    setVisited(new Set());
    setPicked(null);
    setSpeakIdx(0);
    setSpeakSaid("");
    setSpeakEval(null);
    setSpeakScores([]);
    setSpeakNote(null);
    setShowScript(false);
    setShowHint(false);
    setItem(getItem(startIdForAge(band)) ?? null);
  }

  useEffect(() => {
    void getMyProfile().then((p) => {
      const band = p?.ageBand ?? "adult";
      const current = p?.placementBankVersion === PLACEMENT_BANK_VERSION;
      if (p?.placementDone && current) {
        setAge(band);
        setBlocked(true);
        return;
      }
      if (p?.placementDone && !current) {
        void resetPlacement().then((fresh) => begin(fresh?.ageBand ?? band));
        return;
      }
      begin(band);
    });
  }, []);

  useEffect(() => {
    if (phase !== "mcq" || !item || picked !== null) return;
    setRemaining(item.timeLimitSec);
    setTimedOut(false);
    locking.current = false;
    if (item.audioText) speakEnglish(item.audioText, item.part === "part2" ? 0.92 : 0.88);
    const startedAt = Date.now();
    const limit = item.timeLimitSec;
    const id = window.setInterval(() => {
      const left = Math.max(0, limit - Math.floor((Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        commitAnswer(-1, true);
      }
    }, 200);
    return () => {
      window.clearInterval(id);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item?.id]);

  const pathPreview = useMemo(() => steps.map((s) => (s.correct ? "up" : "down")), [steps]);

  function finishAll(nextSteps: PlacementStep[], scores: number[]) {
    const scored = scorePlacement(nextSteps);
    const built = buildReport(nextSteps, scores, scored.cefr);
    setResult(scored);
    setReport(built);
    setPhase("done");
    void savePlacementResult({
      data: {
        cefr: scored.cefr,
        listening: built.listening,
        speaking: built.speaking,
        path: { steps: nextSteps, speaking: scores, persona: built.persona.id },
      },
    });
  }

  function commitAnswer(index: number, fromTimer: boolean) {
    const current = itemRef.current;
    if (!current || locking.current) return;
    locking.current = true;
    stopSpeaking();
    setPicked(index);
    if (fromTimer) setTimedOut(true);
    const correct = index === current.answerIndex;
    const nextVisited = new Set(visited);
    nextVisited.add(current.id);
    const nextSteps: PlacementStep[] = [
      ...steps,
      { itemId: current.id, correct, difficulty: current.difficulty, timedOut: fromTimer },
    ];
    setVisited(nextVisited);
    setSteps(nextSteps);

    window.setTimeout(() => {
      const shouldEnd = nextSteps.length >= PLACEMENT_MAX_STEPS;
      const prefer = nextSteps.length < 4 ? ("listening" as const) : undefined;
      const nxt = shouldEnd ? "END" : resolveNext(current, correct, nextVisited, age, prefer);
      if (nxt === "END" || shouldEnd) {
        locking.current = false;
        setPhase("speak");
        setSpeakIdx(0);
        setSpeakSaid("");
        setSpeakEval(null);
        return;
      }
      locking.current = false;
      setItem(getItem(nxt) ?? null);
      setPicked(null);
      setTimedOut(false);
    }, 700);
  }

  async function submitSpeak() {
    if (!turn || speakBusy) return;
    setSpeakBusy(true);
    const res = await evaluateSpeakingTurn({
      data: {
        passage: "",
        partnerLine: turn.partnerLine,
        said: speakSaid,
        ageBand: age,
      },
    });
    const evald: SpeakingEval = res.ok ? res.eval : res.fallback;
    setSpeakEval(evald);
    setSpeakNote(
      res.ok
        ? null
        : res.error === "missing_key"
          ? locale === "ko"
            ? "저장된 OpenAI 키가 없어 간단한 평가만 했습니다."
            : "No saved OpenAI key — used a simple check."
          : locale === "ko"
            ? `AI 평가를 쓰지 못했습니다. ${"message" in res ? res.message : ""}`
            : `AI scoring unavailable. ${"message" in res ? res.message : ""}`,
    );
    setSpeakBusy(false);
  }

  function nextSpeak() {
    if (!speakEval) return;
    const scores = [...speakScores, speakEval.score];
    setSpeakScores(scores);
    if (speakIdx + 1 >= turns.length) {
      finishAll(steps, scores);
      return;
    }
    setSpeakIdx(speakIdx + 1);
    setSpeakSaid("");
    setSpeakEval(null);
    setSpeakNote(null);
    setShowScript(false);
    setShowHint(false);
  }

  if (blocked) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-3xl">{t(locale, "placementDone")}</h1>
        <p className="mt-3 text-muted">{t(locale, "placementOnce")}</p>
        <Button className="mt-8 w-full" size="lg" onClick={() => navigate({ to: "/" })}>
          {t(locale, "watchCta")}
        </Button>
        <Button
          className="mt-3 w-full"
          variant="secondary"
          disabled={retakeBusy}
          onClick={() => {
            setRetakeBusy(true);
            void resetPlacement()
              .then((p) => begin(p?.ageBand ?? age))
              .finally(() => setRetakeBusy(false));
          }}
        >
          {locale === "ko" ? "다시 측정" : "Retake"}
        </Button>
      </main>
    );
  }

  if (phase === "done" && report && result) {
    return (
      <ResultView
        locale={locale}
        report={report}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          await downloadReportCard(report, locale);
          setSaving(false);
        }}
        onHome={() => navigate({ to: "/" })}
      />
    );
  }

  if (!item) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
      </main>
    );
  }

  if (phase === "intro") {
    return (
      <main className="mx-auto max-w-lg px-4 py-12 pb-24">
        <p className="text-sm text-muted">{t(locale, "placement")}</p>
        <h1 className="mt-2 font-display text-4xl">{t(locale, "placementIntro")}</h1>
        <p className="mt-4 text-muted">{t(locale, "placementIntroBody")}</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm">{t(locale, "flowCorrect")}</div>
          <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">{t(locale, "flowWrong")}</div>
        </div>
        <ul className="mt-6 grid gap-2 text-sm text-muted">
          <li className="rounded-xl border border-border bg-surface px-4 py-3">{t(locale, "mcqPhase")} · 8</li>
          <li className="rounded-xl border border-border bg-surface px-4 py-3">{t(locale, "speakTurns")}</li>
        </ul>
        <p className="mt-4 text-xs text-subtle">{t(locale, "originalItems")}</p>
        <p className="mt-2 text-xs text-subtle">{t(locale, "leaveBody")}</p>
        <Button className="mt-8 w-full" size="lg" onClick={() => setPhase("mcq")}>
          {t(locale, "startTest")}
        </Button>
      </main>
    );
  }

  if (phase === "speak" && turn) {
    return (
      <>
        <LeaveModal locale={locale} blocker={blocker} />
        <main className="mx-auto max-w-lg px-4 py-10 pb-24">
          <p className="text-sm text-muted">
            {t(locale, "speakPhase")} · {speakIdx + 1} / {turns.length}
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full bg-ok"
              style={{ width: `${((speakIdx + (speakEval ? 1 : 0)) / turns.length) * 100}%` }}
            />
          </div>
          <h1 className="mt-8 font-display text-2xl leading-snug">{t(locale, "listenThenReply")}</h1>
          <div className="mt-6 grid gap-2">
            <Button variant="secondary" className="w-full" onClick={() => speakEnglish(turn.partnerLine, 0.9)}>
              <Volume2 className="size-4" />
              {t(locale, "replayAudio")}
            </Button>
            <MicButton locale={locale} onTranscript={setSpeakSaid} onStop={setSpeakSaid} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setShowScript((v) => !v)}>
                {t(locale, showScript ? "hideScript" : "showScript")}
              </Button>
              <Button variant="ghost" onClick={() => setShowHint((v) => !v)}>
                {t(locale, showHint ? "hideHint" : "showHint")}
              </Button>
            </div>
          </div>
          {showScript && (
            <p className="mt-4 rounded-xl border border-border bg-elevated px-4 py-3 text-sm leading-relaxed">
              “{turn.partnerLine}”
            </p>
          )}
          {showHint && (
            <p className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              {locale === "ko" ? turn.hintKo : turn.hintEn}
            </p>
          )}
          <label className="mt-6 block text-sm text-muted">{t(locale, "typeInstead")}</label>
          <textarea
            value={speakSaid}
            onChange={(e) => setSpeakSaid(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-border bg-elevated px-4 py-3 text-sm"
          />
          {!speakEval ? (
            <Button className="mt-4 w-full" size="lg" disabled={speakBusy || !speakSaid.trim()} onClick={() => void submitSpeak()}>
              {t(locale, "sendReply")}
            </Button>
          ) : (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="font-display text-3xl tabular-nums">{speakEval.score}</p>
              <p className="mt-2 text-sm text-muted">{locale === "ko" ? speakEval.commentKo : speakEval.commentEn}</p>
              {speakNote && <p className="mt-2 text-xs text-subtle">{speakNote}</p>}
              <Button className="mt-5 w-full" size="lg" onClick={nextSpeak}>
                {speakIdx + 1 >= turns.length ? t(locale, "resultTitle") : t(locale, "next")}
              </Button>
            </div>
          )}
        </main>
      </>
    );
  }

  const ratio = item.timeLimitSec > 0 ? remaining / item.timeLimitSec : 0;
  const urgent = remaining <= 15;
  const direction = DIRECTIONS[item.part][locale];
  const showKoHelper =
    locale === "ko" &&
    item.promptKo &&
    item.promptKo !== item.promptEn &&
    (item.part === "part3" || item.part === "part4" || item.part === "part7");

  return (
    <>
      <LeaveModal locale={locale} blocker={blocker} />
      <main className="mx-auto max-w-lg px-4 py-10 pb-24">
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {t(locale, PART_KEY[item.part])} · {steps.length + 1} / {PLACEMENT_MAX_STEPS}
          </span>
          <span className={cn("inline-flex items-center gap-1.5 tabular-nums", urgent && "text-warn")}>
            <Clock className="size-3.5" />
            {formatTimestamp(remaining)}
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className={cn("h-full rounded-full transition-[width] duration-200", urgent ? "bg-warn" : "bg-ok")}
            style={{ width: `${Math.max(0, ratio) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex gap-1">
          {Array.from({ length: PLACEMENT_MAX_STEPS }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < steps.length ? (pathPreview[i] === "up" ? "bg-ok" : "bg-accent") : "bg-elevated",
              )}
            />
          ))}
        </div>
        <p className="mt-8 rounded-xl border border-border bg-elevated px-4 py-3 text-sm leading-relaxed text-muted">
          {direction}
        </p>
        {item.audioText && (
          <Button
            className="mt-4"
            variant="secondary"
            size="sm"
            onClick={() => speakEnglish(item.audioText ?? "", item.part === "part2" ? 0.92 : 0.88)}
          >
            <Volume2 className="size-4" />
            {t(locale, "replayAudio")}
          </Button>
        )}
        {item.passage && (
          <pre className="mt-5 overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-elevated p-4 font-sans text-sm leading-relaxed">
            {item.passage}
          </pre>
        )}
        {item.stem && <h2 className="mt-5 font-display text-2xl leading-snug">{item.stem}</h2>}
        {!item.stem && (item.part === "part3" || item.part === "part4" || item.part === "part7") && (
          <h2 className="mt-5 font-display text-xl leading-snug">{item.promptEn}</h2>
        )}
        {showKoHelper && <p className="mt-2 text-sm text-muted">{item.promptKo}</p>}
        {timedOut && picked !== null && <p className="mt-4 text-sm text-warn">{t(locale, "timedOut")}</p>}
        <ul className="mt-6 grid gap-2">
          {item.choices.map((choice, idx) => {
            const show = picked !== null;
            const isAnswer = idx === item.answerIndex;
            const isPick = picked === idx;
            return (
              <li key={`${item.id}-${idx}`}>
                <button
                  type="button"
                  disabled={picked !== null}
                  onClick={() => commitAnswer(idx, false)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left text-sm",
                    show && isAnswer && "border-ok bg-ok/10",
                    show && isPick && !isAnswer && "border-accent bg-accent/10",
                  )}
                >
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-elevated text-xs text-muted">
                    {LETTERS[idx]}
                  </span>
                  <span>{choice}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

function LeaveModal({
  locale,
  blocker,
}: {
  locale: "ko" | "en";
  blocker: { status: string; proceed?: () => void; reset?: () => void };
}) {
  if (blocker.status !== "blocked") return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-2xl">{t(locale, "leaveTitle")}</h2>
        <p className="mt-3 text-sm text-muted">{t(locale, "leaveBody")}</p>
        <div className="mt-6 grid gap-2">
          <Button className="w-full" size="lg" onClick={() => blocker.reset?.()}>
            {t(locale, "leaveStay")}
          </Button>
          <Button className="w-full" variant="secondary" onClick={() => blocker.proceed?.()}>
            {t(locale, "leaveGo")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultView({
  locale,
  report,
  saving,
  onSave,
  onHome,
}: {
  locale: "ko" | "en";
  report: PlacementReport;
  saving: boolean;
  onSave: () => void;
  onHome: () => void;
}) {
  return (
    <main className="mx-auto max-w-lg px-4 py-10 pb-28">
      <article className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex">
          <div className="w-1.5 shrink-0 bg-accent" />
          <div className="min-w-0 flex-1 p-5 sm:p-7">
            <p className="text-xs tracking-wide text-subtle">TubeShadow · {t(locale, "placement")}</p>
            <div className="mt-5 flex items-center gap-4">
              <img
                src={personaPortrait(report.persona.id)}
                alt=""
                width={112}
                height={112}
                className="size-24 shrink-0 rounded-xl object-cover sm:size-28"
              />
              <div className="min-w-0">
                <p className="text-sm text-muted">{t(locale, "yourPersona")}</p>
                <h1 className="mt-1 font-display text-2xl leading-tight sm:text-3xl">
                  {locale === "ko" ? report.persona.titleKo : report.persona.titleEn}
                </h1>
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted">
              {locale === "ko" ? report.persona.blurbKo : report.persona.blurbEn}
            </p>
            <p className="mt-4 text-xs tracking-wide text-subtle">
              {report.skills
                .map((s) => `${locale === "ko" ? s.nameKo : s.nameEn} ${locale === "ko" ? TIER_KO[s.tier] : TIER_EN[s.tier]}`)
                .join("  ·  ")}
            </p>
          </div>
        </div>
      </article>
      <ul className="mt-5 grid grid-cols-2 gap-2">
        {report.skills.map((s) => (
          <li key={s.key} className="rounded-xl border border-border bg-surface px-4 py-4">
            <p className="text-xs text-muted">{locale === "ko" ? s.nameKo : s.nameEn}</p>
            <p className="mt-1 font-display text-xl leading-tight">
              {locale === "ko" ? TIER_KO[s.tier] : TIER_EN[s.tier]}
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-accent" style={{ width: `${s.score}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-8 grid gap-3">
        <Button className="w-full" size="lg" disabled={saving} onClick={onSave}>
          <Download className="size-4" />
          {t(locale, "downloadCard")}
        </Button>
        <Button className="w-full" variant="secondary" size="lg" onClick={onHome}>
          {t(locale, "watchCta")}
        </Button>
        <Link to="/" className="inline-flex h-11 items-center text-sm text-muted">
          {t(locale, "home")}
        </Link>
      </div>
    </main>
  );
}
