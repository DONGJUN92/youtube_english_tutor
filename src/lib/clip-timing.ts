/** Captions often lag the audio. Play this many seconds earlier than stored start. */
export const CLIP_LEAD_SEC = 1;

export function playRange(start: number, end: number): { start: number; end: number } {
  const rawStart = Number(start) || 0;
  const rawEnd = Number(end) || rawStart + 8;
  const s = Math.max(0, rawStart - CLIP_LEAD_SEC);
  const e = Math.max(s + 0.6, rawEnd);
  return { start: s, end: e };
}
