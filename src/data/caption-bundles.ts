import { looksLikeRealTimestamps, sanitizeCaptionLines, type CaptionLine } from "@/lib/caption-parse";
import ted from "./caption-cache/8jPQjjsBbIc.json";
import karp from "./caption-cache/8t9kLTJfIn8.json";

type BundleFile = {
  videoId?: string;
  source?: string;
  title?: string;
  durationSec?: number;
  captions?: CaptionLine[];
};

const FILES: Record<string, BundleFile> = {
  "8t9kLTJfIn8": karp as BundleFile,
  "8jPQjjsBbIc": ted as BundleFile,
};

export function bundledCaptionBundle(videoId: string): {
  captions: CaptionLine[];
  durationSec: number;
  title?: string;
  source: "bundle";
} | null {
  const file = FILES[videoId];
  if (!file) return null;
  const captions = sanitizeCaptionLines(file.captions);
  if (captions.length < 8 || !looksLikeRealTimestamps(captions)) return null;
  const last = captions[captions.length - 1];
  return {
    captions,
    durationSec: Number(file.durationSec) || last.start + Math.max(0.4, last.dur || 0),
    title: file.title,
    source: "bundle",
  };
}
