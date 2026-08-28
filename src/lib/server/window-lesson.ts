import {
  buildCaptionWindows,
  sliceCaptions,
  windowAt,
  type CaptionWindow,
} from "@/lib/caption-windows";
import { looksLikeRealTimestamps, type CaptionLine } from "@/lib/caption-parse";
import { CAPTION_PIPELINE, type GeneratedLesson } from "@/lib/schema";
import { generateLessonWithOpenAI } from "./openai-lesson";
import { transcribeVideoWindow } from "./whisper-captions";
import { captionBundleFromClient, fetchCaptionBundle, fetchVideoMeta } from "./youtube-data";

export type WindowedLesson = GeneratedLesson & {
  windowStartSec: number;
  windowEndSec: number;
  durationSec: number;
  nextWindowStartSec: number | null;
  windows: CaptionWindow[];
  captionSource?: string;
};

export async function generateWindowedLesson(opts: {
  apiKey: string;
  model: string;
  videoId: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  ageBand: string;
  windowStartSec?: number;
  captions?: CaptionLine[];
  durationSec?: number;
  poToken?: string;
}): Promise<
  | { ok: true; lesson: WindowedLesson }
  | { ok: false; error: "no_captions"; title: string }
> {
  const meta = await fetchVideoMeta(opts.videoId);
  let bundle = opts.captions && opts.captions.length >= 4
    ? captionBundleFromClient(opts.captions, {
        title: meta.title,
        author: meta.author,
        durationSec: opts.durationSec,
      })
    : await fetchCaptionBundle(opts.videoId, opts.durationSec, opts.poToken ? { poToken: opts.poToken } : undefined);
  const title = bundle.title || meta.title;
  if (bundle.source === "kome" || (bundle.captions.length >= 4 && !looksLikeRealTimestamps(bundle.captions))) {
    console.info("[tubeshadow-captions] dropping untimed captions", bundle.source, bundle.captions.length);
    bundle = { ...bundle, captions: [] };
  }
  console.info(
    "[tubeshadow-captions]",
    JSON.stringify({
      videoId: opts.videoId,
      source: bundle.source,
      captionCount: bundle.captions.length,
      windowStartSec: opts.windowStartSec ?? 0,
      clientProvided: Boolean(opts.captions?.length),
    }),
  );
  if (bundle.captions.length < 4) {
    const whispered = await transcribeVideoWindow({
      apiKey: opts.apiKey,
      videoId: opts.videoId,
      windowStartSec: opts.windowStartSec ?? 0,
      durationSec: bundle.durationSec || opts.durationSec || 0,
      audioUrl: bundle.audioUrl,
    });
    if (whispered.captions.length >= 4) {
      bundle = {
        captions: whispered.captions,
        durationSec: whispered.durationSec || bundle.durationSec,
        title,
        author: bundle.author || meta.author,
        source: "whisper",
      };
    }
  }
  if (bundle.captions.length < 4) {
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
  return { ok: true, lesson: attachWindow(lesson, window, plan, durationSec, bundle.source) };
}

export function attachWindow(
  lesson: GeneratedLesson,
  window: CaptionWindow,
  plan: CaptionWindow[],
  durationSec: number,
  captionSource?: string,
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
    captionSource,
    captionPipeline: CAPTION_PIPELINE,
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
