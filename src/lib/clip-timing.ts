/** Captions often lag the audio. Play this many seconds earlier than stored start. */
export const CLIP_LEAD_SEC = 1;

/** Finite non-negative seconds. Keeps YouTube fractional timestamps (340.32). */
export function asSeconds(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** INTEGER columns cannot store "340.32" — round at the write boundary. */
export function asIntSeconds(value: unknown, fallback = 0): number {
  return Math.max(0, Math.round(asSeconds(value, fallback)));
}

export function playRange(start: number, end: number): { start: number; end: number } {
  const rawStart = asSeconds(start);
  const rawEnd = asSeconds(end, rawStart + 8);
  const s = Math.max(0, rawStart - CLIP_LEAD_SEC);
  const e = Math.max(s + 0.6, rawEnd);
  return { start: s, end: e };
}
