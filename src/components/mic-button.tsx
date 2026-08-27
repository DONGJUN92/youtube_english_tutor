import { useEffect, useRef, useState } from "react";
import { Mic } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { createMicCapture, type MicCapture } from "@/lib/speech";
import { t, type MessageKey } from "@/lib/i18n";
import type { Locale } from "@/lib/schema";
import { cn } from "@/lib/utils";

export function MicButton({
  locale,
  onTranscript,
  onStop,
  disabled,
  size = "md",
  className,
}: {
  locale: Locale;
  onTranscript: (text: string) => void;
  onStop?: (text: string) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const liveRef = useRef("");
  const cap = useRef<MicCapture | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onStopRef = useRef(onStop);
  onTranscriptRef.current = onTranscript;
  onStopRef.current = onStop;

  useEffect(() => {
    cap.current = createMicCapture({
      onTranscript: (text) => {
        liveRef.current = text;
        onTranscriptRef.current(text);
      },
      onError: (key) => {
        const map: Record<string, MessageKey> = { micDenied: "micDenied", noSpeech: "noSpeech", other: "micDenied" };
        setError(t(locale, map[key] ?? "micDenied"));
      },
      onState: setRecording,
    });
    return () => {
      cap.current?.stop();
    };
  }, [locale]);

  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 200);
    return () => window.clearInterval(id);
  }, [recording]);

  async function toggle() {
    setError(null);
    if (recording) {
      const text = cap.current?.stop() ?? liveRef.current;
      onStopRef.current?.(text);
      return;
    }
    await cap.current?.start();
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Button
        size={size}
        variant={recording ? "primary" : "outline"}
        disabled={disabled}
        onClick={() => void toggle()}
        className={cn("w-full", recording && "animate-pulse")}
        aria-pressed={recording}
      >
        <Mic className="size-4" />
        {recording
          ? `${t(locale, "recOn")} · ${elapsed}s`
          : t(locale, "recOff")}
      </Button>
      {error && <p className="mt-2 text-xs text-accent">{error}</p>}
    </div>
  );
}
