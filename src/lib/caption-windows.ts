export const TARGET_WINDOW_SEC = 300;
export const WINDOW_SLACK_SEC = 45;
export const MIN_TAIL_SEC = 55;

export type TimedLine = { start: number; dur: number; text: string };

export type CaptionWindow = {
  startSec: number;
  endSec: number;
};

export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isSentenceEnd(text: string): boolean {
  return /[.!?…。！？]["'”’)\]]?\s*$/.test(text.trim());
}

function lineEnd(line: TimedLine): number {
  return line.start + Math.max(0.4, line.dur || 0);
}

function findWindowEnd(captions: TimedLine[], fromSec: number, durationSec: number): number {
  const target = fromSec + TARGET_WINDOW_SEC;
  const hardMax = Math.min(durationSec, fromSec + TARGET_WINDOW_SEC + WINDOW_SLACK_SEC);
  const inRange = captions.filter((c) => c.start >= fromSec - 0.05 && c.start <= hardMax + 0.2);
  if (inRange.length === 0) return Math.min(durationSec, target);

  const near = inRange.filter((c) => c.start >= target - 25);
  const sentence = [...near].reverse().find((c) => isSentenceEnd(c.text));
  if (sentence) return Math.min(durationSec, Math.max(sentence.start + 0.5, lineEnd(sentence)));

  for (let i = 0; i < inRange.length; i++) {
    const line = inRange[i];
    if (line.start < target - 20) continue;
    const next = captions.find((c) => c.start > line.start + 0.05);
    const gap = next ? next.start - lineEnd(line) : 99;
    if (gap >= 0.55) return Math.min(durationSec, lineEnd(line));
  }

  const last = inRange[inRange.length - 1];
  return Math.min(durationSec, lineEnd(last));
}

export function buildCaptionWindows(captions: TimedLine[], durationSec: number): CaptionWindow[] {
  const duration = Math.max(
    durationSec,
    captions.length ? lineEnd(captions[captions.length - 1]) : 0,
  );
  if (duration <= 0) return [];
  if (captions.length === 0) return [{ startSec: 0, endSec: duration }];

  const windows: CaptionWindow[] = [];
  let start = captions[0].start > 15 ? 0 : Math.max(0, captions[0].start - 0.5);
  const lastEnd = lineEnd(captions[captions.length - 1]);
  const videoEnd = Math.max(duration, lastEnd);

  while (start < videoEnd - 1) {
    let end = findWindowEnd(captions, start, videoEnd);
    if (end <= start + 8) end = Math.min(videoEnd, start + TARGET_WINDOW_SEC);
    if (videoEnd - end < MIN_TAIL_SEC) end = videoEnd;
    windows.push({ startSec: Math.max(0, start), endSec: Math.max(start + 1, end) });
    if (end >= videoEnd - 0.5) break;
    start = end;
    if (windows.length > 48) break;
  }
  return windows.length ? windows : [{ startSec: 0, endSec: videoEnd }];
}

export function windowAt(windows: CaptionWindow[], startSec: number): CaptionWindow | undefined {
  const wanted = Math.max(0, startSec);
  return (
    windows.find((w) => Math.abs(w.startSec - wanted) < 1.5) ??
    windows.find((w) => wanted >= w.startSec - 0.5 && wanted < w.endSec - 0.5) ??
    windows[0]
  );
}

export function sliceCaptions(captions: TimedLine[], startSec: number, endSec: number): TimedLine[] {
  const sliced = captions.filter((c) => c.start >= startSec - 0.35 && c.start < endSec - 0.05);
  if (sliced.length >= 8) return sliced;
  const looser = captions.filter((c) => c.start >= startSec - 1 && c.start <= endSec + 8);
  return looser.length ? looser : captions.slice(0, 40);
}
