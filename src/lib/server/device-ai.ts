import { createServerFn } from "@tanstack/react-start";
import { GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL, GOOGLE_WEB_CLIENT_ID } from "@/lib/device/constants";
import { FEATURED_LESSONS } from "@/data/featured-lessons";
import { sanitizeCaptionLines } from "@/lib/caption-parse";
import { shouldServeSeededLesson } from "@/lib/learner-brief";
import {
  assertAllowedModel,
  evaluateSpeakingWithOpenAI,
  pingOpenAI,
} from "./openai-lesson";
import { fetchVideoMeta } from "./youtube-data";
import { generateWindowedLesson } from "./window-lesson";

export const exchangeGrokOAuth = createServerFn({ method: "POST" })
  .validator((input: { code: string; verifier: string; redirectUri: string }) => ({
    code: input.code.slice(0, 2048),
    verifier: input.verifier.slice(0, 256),
    redirectUri: input.redirectUri.slice(0, 512),
  }))
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: data.redirectUri,
      client_id: GROK_OAUTH_CLIENT_ID,
      code_verifier: data.verifier,
    });
    const secret = process.env.GROK_OAUTH_CLIENT_SECRET?.trim() || process.env.GROK_AUTH_CLIENT_SECRET?.trim();
    if (secret) body.set("client_secret", secret);
    const tokenRes = await fetch(`${GROK_OAUTH_ISSUER}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return { ok: false as const, error: tokenText.slice(0, 400) || `token ${tokenRes.status}` };
    }
    let tokenJson: { access_token?: string; id_token?: string; error?: string; error_description?: string };
    try {
      tokenJson = JSON.parse(tokenText) as typeof tokenJson;
    } catch {
      return { ok: false as const, error: "Invalid token response" };
    }
    const access = tokenJson.access_token;
    if (!access) {
      return { ok: false as const, error: tokenJson.error_description || tokenJson.error || "No access token" };
    }
    const userRes = await fetch(`${GROK_OAUTH_ISSUER}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
    });
    const userText = await userRes.text();
    if (!userRes.ok) {
      return { ok: false as const, error: userText.slice(0, 400) || `userinfo ${userRes.status}` };
    }
    let profile: {
      sub?: string;
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
      image?: string;
    };
    try {
      profile = JSON.parse(userText) as typeof profile;
    } catch {
      return { ok: false as const, error: "Invalid userinfo response" };
    }
    const sub = profile.sub || profile.id;
    if (!sub) return { ok: false as const, error: "OAuth profile was missing an id" };
    return {
      ok: true as const,
      sub,
      email: profile.email ?? null,
      name: profile.name ?? null,
      image: profile.picture ?? profile.image ?? null,
    };
  });

export const exchangeGooglePkce = createServerFn({ method: "POST" })
  .validator((input: { code: string; verifier: string; redirectUri: string; clientId: string }) => ({
    code: input.code.slice(0, 2048),
    verifier: input.verifier.slice(0, 256),
    redirectUri: input.redirectUri.slice(0, 512),
    clientId: input.clientId.slice(0, 128),
  }))
  .handler(async ({ data }) => {
    const clientId = data.clientId.trim() || GOOGLE_WEB_CLIENT_ID;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: data.code,
      redirect_uri: data.redirectUri,
      client_id: clientId,
      code_verifier: data.verifier,
    });
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return { ok: false as const, error: tokenText.slice(0, 400) || `token ${tokenRes.status}` };
    }
    let tokenJson: {
      access_token?: string;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    try {
      tokenJson = JSON.parse(tokenText) as typeof tokenJson;
    } catch {
      return { ok: false as const, error: "Invalid token response" };
    }
    const access = tokenJson.access_token;
    if (!access) {
      return { ok: false as const, error: tokenJson.error_description || tokenJson.error || "No access token" };
    }
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
    });
    const userText = await userRes.text();
    if (!userRes.ok) {
      return { ok: false as const, error: userText.slice(0, 400) || `userinfo ${userRes.status}` };
    }
    let profile: {
      sub?: string;
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    try {
      profile = JSON.parse(userText) as typeof profile;
    } catch {
      return { ok: false as const, error: "Invalid userinfo response" };
    }
    const sub = profile.sub || profile.id;
    if (!sub) return { ok: false as const, error: "Google profile was missing an id" };
    return {
      ok: true as const,
      sub,
      email: profile.email ?? null,
      name: profile.name ?? null,
      image: profile.picture ?? null,
    };
  });

export const pingOpenAiWithKey = createServerFn({ method: "POST" })
  .validator((input: { apiKey: string; model: string }) => ({
    apiKey: input.apiKey.trim(),
    model: input.model.trim() || "gpt-4.1-mini",
  }))
  .handler(async ({ data }) => {
    if (!data.apiKey.startsWith("sk-")) {
      return { ok: false as const, status: 0, model: data.model, message: "missing_key" };
    }
    return pingOpenAI(data.apiKey, data.model);
  });

export const evaluateSpeakingWithKey = createServerFn({ method: "POST" })
  .validator((input: {
    apiKey: string;
    model: string;
    passage: string;
    partnerLine: string;
    said: string;
    ageBand: string;
  }) => ({
    apiKey: input.apiKey.trim(),
    model: input.model.trim() || "gpt-4.1-mini",
    passage: input.passage.slice(0, 800),
    partnerLine: input.partnerLine.slice(0, 400),
    said: input.said.slice(0, 800),
    ageBand: input.ageBand,
  }))
  .handler(async ({ data }) => {
    if (!data.apiKey.startsWith("sk-")) {
      return { ok: false as const, error: "missing_key" as const, fallback: heuristicSpeak(data.said) };
    }
    try {
      const evald = await evaluateSpeakingWithOpenAI({
        apiKey: data.apiKey,
        model: data.model,
        passage: data.passage,
        partnerLine: data.partnerLine,
        said: data.said,
        ageBand: data.ageBand,
      });
      return { ok: true as const, eval: evald };
    } catch (err) {
      return {
        ok: false as const,
        error: "openai_failed" as const,
        message: err instanceof Error ? err.message : "OpenAI failed",
        fallback: heuristicSpeak(data.said),
      };
    }
  });

function heuristicSpeak(said: string) {
  const words = said.trim().split(/\s+/).filter(Boolean);
  const english = words.filter((w) => /[a-z]/i.test(w)).length;
  const score = Math.max(20, Math.min(72, english * 9 + Math.min(20, words.length)));
  return {
    score,
    appropriate: english >= 3,
    commentKo: english >= 3 ? "영어 단어가 보여서 의도는 전달됩니다. AI 키가 있으면 더 자세히 봐 줍니다." : "영어 한두 문장으로 다시 말해 보세요.",
    commentEn: english >= 3 ? "The idea comes through. A saved API key gives a fuller note." : "Try one or two English sentences.",
    betterLine: "Sure — I can do that.",
  };
}

export const resolveVideoPublic = createServerFn({ method: "POST" })
  .validator((input: { videoId: string }) => ({
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
  }))
  .handler(async ({ data }) => {
    const meta = await fetchVideoMeta(data.videoId);
    return {
      ...meta,
      captionCount: 0,
      hasCaptions: true,
      hasSeededLesson: Boolean(FEATURED_LESSONS[data.videoId]),
    };
  });

export const generateLessonWithKey = createServerFn({ method: "POST" })
  .validator((input: {
    apiKey: string;
    model: string;
    videoId: string;
    level: "A1" | "A2" | "B1" | "B2" | "C1";
    ageBand: string;
    windowStartSec?: number;
    captions?: { start: number; dur: number; text: string }[];
    durationSec?: number;
  }) => ({
    apiKey: input.apiKey.trim(),
    model: input.model.trim() || "gpt-4.1-mini",
    videoId: input.videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11),
    level: input.level,
    ageBand: input.ageBand,
    windowStartSec: Math.max(0, Number(input.windowStartSec) || 0),
    captions: sanitizeCaptionLines(input.captions),
    durationSec: Number(input.durationSec) > 0 ? Number(input.durationSec) : undefined,
  }))
  .handler(async ({ data }) => {
    assertAllowedModel(data.model);
    if (!data.apiKey.startsWith("sk-")) {
      return { ok: false as const, error: "missing_key" as const };
    }
    const seeded = FEATURED_LESSONS[data.videoId];
    if (seeded && shouldServeSeededLesson(data.windowStartSec)) {
      return {
        ok: true as const,
        source: "seed" as const,
        lesson: seeded,
        nextWindowStartSec: seeded.nextWindowStartSec ?? null,
        durationSec: seeded.durationSec ?? null,
        windows: seeded.windows ?? [],
      };
    }
    try {
      const generated = await generateWindowedLesson({
        apiKey: data.apiKey,
        model: data.model,
        videoId: data.videoId,
        level: data.level,
        ageBand: data.ageBand,
        windowStartSec: data.windowStartSec,
        captions: data.captions,
        durationSec: data.durationSec,
      });
      if (!generated.ok) {
        return { ok: false as const, error: "no_captions" as const, title: generated.title };
      }
      return {
        ok: true as const,
        source: "openai" as const,
        lesson: generated.lesson,
        nextWindowStartSec: generated.lesson.nextWindowStartSec,
        durationSec: generated.lesson.durationSec,
        windows: generated.lesson.windows,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: "openai_failed" as const,
        message: err instanceof Error ? err.message : "OpenAI failed",
      };
    }
  });
