import {
  CEFR_FROM_DIFFICULTY,
  getItem,
  PLACEMENT_BY_ID,
  PLACEMENT_START,
  type AgeBand,
  type PlacementItem,
  type PlacementSkill,
} from "@/data/placement-bank";
import type { CefrLevel } from "./schema";

export const PLACEMENT_MAX_STEPS = 8;
export const SPEAKING_TURNS = 4;

export type PlacementStep = {
  itemId: string;
  correct: boolean;
  difficulty: number;
  timedOut?: boolean;
};

export function startIdForAge(age: AgeBand): string {
  return PLACEMENT_START[age];
}

export function resolveNext(
  item: PlacementItem,
  correct: boolean,
  visited: Set<string>,
  age: AgeBand,
  prefer?: PlacementSkill,
): string {
  const preferred = correct ? item.nextCorrect : item.nextWrong;
  if (preferred === "END") return "END";
  return walk(preferred, visited, age, correct ? 1 : -1, prefer);
}

function walk(
  fromId: string,
  visited: Set<string>,
  age: AgeBand,
  direction: 1 | -1,
  prefer?: PlacementSkill,
): string {
  const seen = new Set<string>();
  let id: string | undefined = fromId;
  let fallback: string | undefined;
  while (id && id !== "END" && !seen.has(id)) {
    seen.add(id);
    const node: PlacementItem | undefined = PLACEMENT_BY_ID[id];
    if (!node) return "END";
    if (!visited.has(id) && node.ages.includes(age)) {
      if (!prefer || node.skill === prefer) return id;
      fallback ??= id;
    }
    id = direction > 0 ? node.nextCorrect : node.nextWrong;
  }
  if (fallback) return fallback;
  const any = Object.values(PLACEMENT_BY_ID).find(
    (it) => !visited.has(it.id) && it.ages.includes(age) && (!prefer || it.skill === prefer),
  );
  return any?.id ?? "END";
}

export function scorePlacement(steps: PlacementStep[]): {
  cefr: CefrLevel;
  listening: number;
  speaking: number;
  avgDifficulty: number;
} {
  if (steps.length === 0) {
    return { cefr: "A1", listening: 40, speaking: 40, avgDifficulty: 1 };
  }
  const tail = steps.slice(-5);
  const avg = tail.reduce((s, x) => s + x.difficulty, 0) / tail.length;
  const correctRate = steps.filter((s) => s.correct).length / steps.length;
  const listeningSteps = steps.filter((s) => getItem(s.itemId)?.skill === "listening");
  const listenRate =
    listeningSteps.length === 0 ? correctRate : listeningSteps.filter((s) => s.correct).length / listeningSteps.length;
  const cefr = CEFR_FROM_DIFFICULTY(Math.round(avg));
  const listening = Math.round(35 + listenRate * 50 + avg * 1.5);
  const speaking = Math.round(30 + correctRate * 45 + avg * 1.8);
  return {
    cefr,
    listening: Math.min(99, listening),
    speaking: Math.min(99, speaking),
    avgDifficulty: Number(avg.toFixed(2)),
  };
}
