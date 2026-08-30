import { OPENAI_LESSON_JSON_SCHEMA, type CefrLevel, type GeneratedLesson, GeneratedLessonSchema } from "@/lib/schema";
import { enrichLesson } from "@/lib/lesson-pedagogy";
import { alignLessonWithHarness, buildLessonHarness, renderLessonHarnessPrompt } from "@/lib/lesson-harness";
import { evalChatModel, isReasoningModel, lessonChatModel } from "./openai-key";

const FORBIDDEN_MODELS = ["grok-4-1-fast", "grok-4-fast", "grok-4.1-fast", "grok-3-mini", "grok-2"];
export function assertAllowedModel(model: string) {
  const id = model.trim().toLowerCase();
  if (FORBIDDEN_MODELS.some((m) => id.includes(m) || id.startsWith("grok-"))) {
    throw new Error("This app does not use Grok models for question generation.");
  }
}

type ChatJson = {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      refusal?: string;
      parsed?: unknown;
    };
  }[];
};

async function chatCompletions(apiKey: string, body: Record<string, unknown>, timeoutMs = 28_000): Promise<Response> {
  const post = (payload: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

  const payload: Record<string, unknown> = { ...body };
  let lastErr = "OpenAI request failed";
  let lastStatus = 500;
  for (let i = 0; i < 2; i++) {
    let res: Response;
    try {
      res = await post(payload);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "openai_timeout";
      lastStatus = 504;
      break;
    }
    if (res.ok) return res;
    const errText = await res.text();
    lastErr = errText;
    lastStatus = res.status;
    if (res.status !== 400) break;
    let param = "";
    let message = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: { param?: string; message?: string } };
      param = parsed.error?.param ?? "";
      message = parsed.error?.message ?? errText;
    } catch {
      /* keep raw */
    }
    if (param === "max_tokens" || /max_completion_tokens/.test(message)) {
      const n = payload.max_tokens ?? payload.max_completion_tokens ?? 4096;
      delete payload.max_tokens;
      payload.max_completion_tokens = n;
      continue;
    }
    if (param === "temperature" || /'temperature'/.test(message) || /unsupported.*temperature/i.test(message)) {
      delete payload.temperature;
      continue;
    }
    if (/response_format|json_schema/.test(message)) {
      payload.response_format = { type: "json_object" };
      continue;
    }
    if (/reasoning_effort|verbosity/.test(message)) {
      if (payload.reasoning_effort != null) {
        delete payload.reasoning_effort;
        payload.reasoning = { effort: "none" };
        continue;
      }
      delete payload.reasoning;
      delete payload.verbosity;
      continue;
    }
    break;
  }
  return new Response(lastErr, { status: lastStatus });
}

function completionText(json: ChatJson): string {
  const msg = json.choices?.[0]?.message;
  if (!msg) return "";
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  if (msg.parsed && typeof msg.parsed === "object") return JSON.stringify(msg.parsed);
  return "";
}

function parseLessonJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty_completion");
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no_json_object");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error("truncated_json");
  }
}

function lessonBody(model: string, system: string, user: string, format: "schema" | "object"): Record<string, unknown> {
  const reasoning = isReasoningModel(model);
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format:
      format === "schema"
        ? { type: "json_schema", json_schema: OPENAI_LESSON_JSON_SCHEMA }
        : { type: "json_object" },
  };
  if (reasoning) {
    payload.reasoning_effort = "none";
    payload.verbosity = "low";
    payload.max_completion_tokens = 4500;
  } else {
    payload.temperature = 0.3;
    payload.max_tokens = 3500;
  }
  return payload;
}

type Caption = { start: number; dur: number; text: string };

export async function generateLessonWithOpenAI(opts: {
  apiKey: string;
  model: string;
  videoId: string;
  title: string;
  captions: Caption[];
  level: CefrLevel;
  ageBand: string;
  windowStartSec?: number;
  windowEndSec?: number;
}): Promise<GeneratedLesson> {
  assertAllowedModel(opts.model);
  const harness = buildLessonHarness(opts.captions, opts.level);
  console.info(
    "[tubeshadow-lesson] harness",
    JSON.stringify({
      videoId: opts.videoId,
      listen: harness.listening.length,
      speak: harness.speaking.length,
      model: lessonChatModel(opts.model),
      effort: isReasoningModel(opts.model) ? "none" : "n/a",
    }),
  );
  const { system, user } = renderLessonHarnessPrompt({
    videoId: opts.videoId,
    title: opts.title,
    ageBand: opts.ageBand,
    level: opts.level,
    windowStartSec: opts.windowStartSec,
    windowEndSec: opts.windowEndSec,
    harness,
  });

  const model = lessonChatModel(opts.model);
  assertAllowedModel(model);
  const firstFormat: "schema" | "object" = isReasoningModel(model) ? "schema" : "object";
  const formats: Array<"schema" | "object"> = [firstFormat, firstFormat === "schema" ? "object" : "schema"];
  let lastErr = "OpenAI returned empty JSON";

  for (const format of formats) {
    const res = await chatCompletions(opts.apiKey, lessonBody(model, system, user, format), 28_000);
    if (!res.ok) {
      const err = await res.text();
      lastErr = `OpenAI error ${res.status}: ${err.slice(0, 180)}`;
      console.info("[tubeshadow-lesson] openai fail", JSON.stringify({ model, format, status: res.status }));
      if (res.status === 401 || res.status === 429) throw new Error(summarizeOpenAiError(res.status, err));
      if (res.status === 404) break;
      continue;
    }
    const json = (await res.json()) as ChatJson;
    const text = completionText(json);
    const finish = json.choices?.[0]?.finish_reason ?? "";
    console.info(
      "[tubeshadow-lesson] openai",
      JSON.stringify({ model, format, finish, contentLen: text.length }),
    );
    if (!text) {
      lastErr = finish === "length" ? "truncated_json" : "empty_completion";
      continue;
    }
    try {
      const parsed = parseLessonJson(text);
      const aligned = alignLessonWithHarness(parsed, {
        videoId: opts.videoId,
        title: opts.title,
        ageBand: opts.ageBand,
        level: opts.level,
        harness,
      });
      return enrichLesson(
        GeneratedLessonSchema.parse({
          ...(aligned as object),
          videoId: opts.videoId,
          learnerAge: opts.ageBand,
          learnerLevel: opts.level,
        }),
        opts.captions,
      );
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "parse_failed";
    }
  }
  throw new Error(lastErr);
}

const pingCache = new Map<string, { at: number; result: { ok: boolean; status: number; model: string; message: string } }>();
const PING_TTL_MS = 10 * 60 * 1000;

export async function pingOpenAI(
  apiKey: string,
  model: string,
): Promise<{
  ok: boolean;
  status: number;
  model: string;
  message: string;
}> {
  try {
    assertAllowedModel(model);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      model,
      message: err instanceof Error ? err.message : "model not allowed",
    };
  }
  const cacheKey = `${apiKey.slice(-10)}:${model.trim()}`;
  const hit = pingCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PING_TTL_MS) return hit.result;
  try {
    const chosen = lessonChatModel(model) || "gpt-4.1-mini";
    const probe = evalChatModel(chosen);
    const chat = await chatCompletions(
      apiKey,
      {
        model: probe,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with the single word pong." }],
      },
      12_000,
    );
    if (!chat.ok) {
      const err = await chat.text();
      const result = {
        ok: false,
        status: chat.status,
        model: chosen,
        message: summarizeOpenAiError(chat.status, err),
      };
      if (chat.status === 401 || chat.status === 429) pingCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }
    const json = (await chat.json()) as ChatJson;
    const text = completionText(json).trim();
    const result = {
      ok: true,
      status: 200,
      model: chosen,
      message: text ? `ok · ${chosen}` : `ok · ${chosen} (empty completion)`,
    };
    pingCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (err) {
    return {
      ok: false,
      status: 0,
      model,
      message: err instanceof Error ? `네트워크 오류: ${err.message}` : "네트워크 오류",
    };
  }
}

export type SpeakingEval = {
  score: number;
  appropriate: boolean;
  commentKo: string;
  commentEn: string;
  betterLine: string;
};

export async function evaluateSpeakingWithOpenAI(opts: {
  apiKey: string;
  model: string;
  passage: string;
  partnerLine: string;
  said: string;
  ageBand: string;
}): Promise<SpeakingEval> {
  const model = evalChatModel(opts.model);
  assertAllowedModel(model);
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a kind English conversation coach for Korean learners. There is NO single correct answer. Judge whether the learner's reply is appropriate for the situation (meaning, politeness, enough information). Be encouraging. Never mock. Return JSON only.",
      },
      {
        role: "user",
        content: `Age band: ${opts.ageBand}
Situation: ${opts.passage}
Partner said: ${opts.partnerLine}
Learner said: ${opts.said || "(silent)"}

JSON keys: score (0-100 integer), appropriate (boolean), commentKo, commentEn, betterLine (one natural English reply).`,
      },
    ],
    response_format: { type: "json_object" as const },
    temperature: 0.3,
    max_tokens: 280,
  };
  const res = await chatCompletions(opts.apiKey, body, 12_000);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(summarizeOpenAiError(res.status, err));
  }
  const json = (await res.json()) as ChatJson;
  const parsed = parseLessonJson(completionText(json) || "{}") as Partial<SpeakingEval>;
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  return {
    score,
    appropriate: Boolean(parsed.appropriate),
    commentKo: String(parsed.commentKo || "상황에 맞는 말이었습니다."),
    commentEn: String(parsed.commentEn || "That works in this situation."),
    betterLine: String(parsed.betterLine || opts.partnerLine),
  };
}

export function summarizeOpenAiError(status: number, body: string): string {
  const slice = body.slice(0, 280);
  if (status === 401) return "키가 거부되었습니다. 키를 다시 저장해 주세요.";
  if (status === 429) return "요청이 많거나 크레딧이 부족합니다. Billing을 확인해 주세요.";
  if (status === 404) return "모델 이름을 찾을 수 없습니다. gpt-4.1-mini 또는 gpt-4o-mini로 바꿔 보세요.";
  return `OpenAI ${status}: ${slice}`;
}
