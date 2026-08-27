import {
  buildCaptionWindows,
  sliceCaptions,
  windowAt,
  type CaptionWindow,
} from "@/lib/caption-windows";
import type { GeneratedLesson } from "@/lib/schema";
import { generateLessonWithOpenAI } from "./openai-lesson";
import { fetchCaptionBundle, fetchVideoMeta, type CaptionLine } from "./youtube-data";

export type WindowedLesson = GeneratedLesson & {
  windowStartSec: number;
  windowEndSec: number;
  durationSec: number;
  nextWindowStartSec: number | null;
  windows: CaptionWindow[];
};

export async function generateWindowedLesson(opts: {
  apiKey: string;
  model: string;
  videoId: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  ageBand: string;
  windowStartSec?: number;
}): Promise<
  | { ok: true; lesson: WindowedLesson }
  | { ok: false; error: "no_captions"; title: string }
> {
  const meta = await fetchVideoMeta(opts.videoId);
  const bundle = await fetchCaptionBundle(opts.videoId);
  const title = bundle.title || meta.title;
  if (bundle.captions.length === 0) {
    return { ok: false, error: "no_captions", title };
  }
  const durationSec = bundle.durationSec || lastCaptionEnd(bundle.captions);
  const plan = buildCaptionWindows(bundle.captions, durationSec);
  const window = windowAt(plan, opts.windowStartSec ?? 0) ?? plan[0];
  const captions = sliceCaptions(bundle.captions, window.startSec, window.endSec);
  const lesson = await generateLessonWithOpenAI({
    apiKey: opts.apiKey,
    model: opts.model,
    videoId: opts.videoId,
    title,
    captions,
    level: opts.level,
    ageBand: opts.ageBand,
    windowStartSec: window.startSec,
    windowEndSec: window.endSec,
  });
  return { ok: true, lesson: attachWindow(lesson, window, plan, durationSec) };
}

export function attachWindow(
  lesson: GeneratedLesson,
  window: CaptionWindow,
  plan: CaptionWindow[],
  durationSec: number,
): WindowedLesson {
  const idx = plan.findIndex((w) => Math.abs(w.startSec - window.startSec) < 1.5);
  const next = idx >= 0 ? plan[idx + 1] : undefined;
  return {
    ...lesson,
    windowStartSec: window.startSec,
    windowEndSec: window.endSec,
    durationSec,
    nextWindowStartSec: next ? next.startSec : null,
    windows: plan,
  };
}

export function windowSkill(startSec: number): string {
  return `w:${Math.floor(Math.max(0, startSec))}`;
}

export function skillToStart(skill: string): number | null {
  const match = /^w:(\d+)$/.exec(skill);
  return match ? Number(match[1]) : skill === "bundle" ? 0 : null;
}

function lastCaptionEnd(captions: CaptionLine[]): number {
  if (!captions.length) return 0;
  const last = captions[captions.length - 1];
  return last.start + Math.max(0.4, last.dur || 0);
}
