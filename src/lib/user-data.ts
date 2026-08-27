import * as server from "@/lib/server/fns";
import * as device from "@/lib/device/store";
import { computeDeviceMode } from "@/lib/device/mode";

export type { PublicProfile } from "@/lib/server/fns";

function deviceNow(): boolean {
  return typeof window !== "undefined" && computeDeviceMode();
}

export async function getMyProfile() {
  return deviceNow() ? device.getMyProfile() : server.getMyProfile();
}

export async function upsertOnboarding(opts: {
  data: { locale: "ko" | "en"; ageBand: "child" | "teen" | "college" | "adult" };
}) {
  return deviceNow() ? device.upsertOnboarding(opts.data) : server.upsertOnboarding(opts);
}

export async function savePlacementResult(opts: {
  data: { cefr: "A1" | "A2" | "B1" | "B2" | "C1"; listening: number; speaking: number; path: unknown };
}) {
  return deviceNow() ? device.savePlacementResult(opts.data) : server.savePlacementResult(opts);
}

export async function resetPlacement() {
  return deviceNow() ? device.resetPlacement() : server.resetPlacement();
}

export async function saveOpenAiSettings(opts: { data: { apiKey?: string; model: string } }) {
  return deviceNow() ? device.saveOpenAiSettings(opts.data) : server.saveOpenAiSettings(opts);
}

export async function pingOpenAiKey() {
  return deviceNow() ? device.pingOpenAiKey() : server.pingOpenAiKey();
}

export async function evaluateSpeakingTurn(opts: {
  data: { passage: string; partnerLine: string; said: string; ageBand: string };
}) {
  return deviceNow() ? device.evaluateSpeakingTurn(opts.data) : server.evaluateSpeakingTurn(opts);
}

export async function resolveVideo(opts: { data: { videoId: string } }) {
  return deviceNow() ? device.resolveVideo(opts.data) : server.resolveVideo(opts);
}

export async function loadOrGenerateLesson(opts: { data: { videoId: string } }) {
  return deviceNow() ? device.loadOrGenerateLesson(opts.data) : server.loadOrGenerateLesson(opts);
}

export async function saveVocab(opts: {
  data: {
    videoId?: string;
    word: string;
    meaningKo?: string;
    meaningEn?: string;
    ipa?: string;
    clipStart?: number;
    clipEnd?: number;
  };
}) {
  return deviceNow() ? device.saveVocab(opts.data) : server.saveVocab(opts);
}

export async function listVocab() {
  return deviceNow() ? device.listVocab() : server.listVocab();
}

export async function saveClipBookmark(opts: {
  data: { videoId: string; startSec: number; endSec: number; caption?: string; note?: string };
}) {
  return deviceNow() ? device.saveClipBookmark(opts.data) : server.saveClipBookmark(opts);
}

export async function listClipBookmarks() {
  return deviceNow() ? device.listClipBookmarks() : server.listClipBookmarks();
}

export async function saveProgress(opts: {
  data: { videoId: string; positionSec: number; title?: string; thumbnail?: string };
}) {
  return deviceNow() ? device.saveProgress(opts.data) : server.saveProgress(opts);
}

export async function listProgress() {
  return deviceNow() ? device.listProgress() : server.listProgress();
}

export async function saveSpeakingAttempt(opts: {
  data: { lessonId?: string; videoId?: string; target: string; transcript: string; accuracy: number };
}) {
  return deviceNow() ? device.saveSpeakingAttempt(opts.data) : server.saveSpeakingAttempt(opts);
}
