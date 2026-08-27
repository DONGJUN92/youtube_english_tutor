/** Free browser Web Speech — TTS + STT. No paid model. */

export function speakEnglish(text: string, rate = 0.92) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith("en") && /google|natural|premium/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en-US")) ??
    voices.find((v) => v.lang.startsWith("en"));
  if (preferred) u.voice = preferred;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}

type Rec = SpeechRecognition;

export function getSpeechRecognition(): Rec | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.SpeechRecognition ||
    (window as Window & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = true;
  return rec;
}

export type MicCapture = {
  start: () => Promise<void>;
  stop: () => string;
  isRunning: () => boolean;
};

/**
 * Press-to-start / press-to-stop capture.
 * Keeps the mic stream alive and restarts Web Speech if Chrome drops the session.
 */
export function createMicCapture(handlers: {
  onTranscript: (text: string) => void;
  onError: (key: "micDenied" | "noSpeech" | "other", detail?: string) => void;
  onState: (recording: boolean) => void;
}): MicCapture {
  let rec: Rec | null = null;
  let stream: MediaStream | null = null;
  let keep = false;
  let finals: string[] = [];
  let interim = "";

  function emit() {
    const text = [...finals, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    handlers.onTranscript(text);
  }

  function stopTracks() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function attachRec() {
    const next = getSpeechRecognition();
    if (!next) return false;
    rec = next;
    rec.onresult = (ev) => {
      let nextInterim = "";
      const committed: string[] = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0]?.transcript ?? "";
        if (ev.results[i].isFinal) committed.push(piece);
        else nextInterim += piece;
      }
      if (committed.length) finals = [...finals, ...committed];
      interim = nextInterim;
      emit();
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      if (ev.error === "not-allowed") {
        keep = false;
        handlers.onState(false);
        stopTracks();
        handlers.onError("micDenied");
        return;
      }
      handlers.onError("other", ev.error);
    };
    rec.onend = () => {
      if (!keep) return;
      window.setTimeout(() => {
        if (!keep) return;
        try {
          attachRec();
          rec?.start();
        } catch {
          /* already started */
        }
      }, 80);
    };
    return true;
  }

  return {
    async start() {
      if (keep) return;
      stopSpeaking();
      finals = [];
      interim = "";
      handlers.onTranscript("");
      keep = true;
      handlers.onState(true);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        keep = false;
        handlers.onState(false);
        handlers.onError("micDenied");
        return;
      }
      if (!attachRec()) {
        handlers.onError("noSpeech");
        return;
      }
      try {
        rec?.start();
      } catch {
        handlers.onError("other");
      }
    },
    stop() {
      keep = false;
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
      rec = null;
      stopTracks();
      handlers.onState(false);
      const text = [...finals, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      handlers.onTranscript(text);
      return text;
    },
    isRunning() {
      return keep;
    },
  };
}

export function wordAccuracy(target: string, said: string): number {
  const a = normalizeWords(target);
  const b = normalizeWords(said);
  if (a.length === 0) return 0;
  if (b.length === 0) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.round((1 - dist / maxLen) * 100);
}

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function coachLine(accuracy: number, locale: "ko" | "en"): string {
  if (accuracy >= 90) return locale === "ko" ? "거의 그대로입니다. 리듬만 한 번 더." : "Almost exact. One more pass on the rhythm.";
  if (accuracy >= 75) return locale === "ko" ? "잘 따라왔습니다. 약한 음절을 조금 더 또렷하게." : "Strong shadow. Make the weak syllables a bit clearer.";
  if (accuracy >= 55) return locale === "ko" ? "핵심 단어는 맞았습니다. 클립을 한 번 더 듣고 따라 하세요." : "Key words are there. Replay the clip once, then shadow again.";
  return locale === "ko" ? "문장을 다시 듣고, 짧게 끊어서 따라 말해 보세요." : "Replay, then shadow in two shorter chunks.";
}

declare global {
  interface Window {
    SpeechRecognition?: typeof SpeechRecognition;
    webkitSpeechRecognition?: typeof SpeechRecognition;
  }
}
