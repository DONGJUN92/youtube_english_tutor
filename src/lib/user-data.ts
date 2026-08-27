import * as server from "@/lib/server/fns";

export type { PublicProfile } from "@/lib/server/fns";

export const getMyProfile = server.getMyProfile;
export const upsertOnboarding = server.upsertOnboarding;
export const saveLearnerSettings = server.saveLearnerSettings;
export const savePlacementResult = server.savePlacementResult;
export const resetPlacement = server.resetPlacement;
export const saveOpenAiSettings = server.saveOpenAiSettings;
export const pingOpenAiKey = server.pingOpenAiKey;
export const evaluateSpeakingTurn = server.evaluateSpeakingTurn;
export const resolveVideo = server.resolveVideo;
export const loadOrGenerateLesson = server.loadOrGenerateLesson;
export const saveVocab = server.saveVocab;
export const listVocab = server.listVocab;
export const saveClipBookmark = server.saveClipBookmark;
export const listClipBookmarks = server.listClipBookmarks;
export const saveProgress = server.saveProgress;
export const listProgress = server.listProgress;
export const saveSpeakingAttempt = server.saveSpeakingAttempt;
