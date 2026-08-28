import { OPENAI_LESSON_JSON_SCHEMA, type CefrLevel, type GeneratedLesson, GeneratedLessonSchema } from "@/lib/schema";
import { cleanCaptionText } from "@/lib/lesson-pedagogy";

const FORBIDDEN_MODELS = ["grok-4-1-fast", "grok-4-fast", "grok-4.1-fast", "grok-3-mini", "grok-2"];
const FALLBACK_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"];

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

function isReasoningModel(model: string) {
  const id = model.toLowerCase();
  return /gpt-5|o1|o3|o4|luna|reasoning/.test(id);
}

async function chatCompletions(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  const post = (payload: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

  const payload: Record<string, unknown> = { ...body };
  let lastErr = "OpenAI request failed";
  let lastStatus = 500;
  for (let i = 0; i < 5; i++) {
    const res = await post(payload);
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
    payload.max_completion_tokens = 8192;
  } else {
    payload.temperature = 0.4;
    payload.max_tokens = 6000;
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
  const slices = opts.captions.slice(0, 80).map((c) => {
    const a = c.start.toFixed(1);
    const b = (c.start + c.dur).toFixed(1);
    return `[${a}-${b}] ${cleanCaptionText(c.text)}`;
  });
  const transcript = slices.join("\n").slice(0, 8000);
  const windowNote =
    opts.windowStartSec != null && opts.windowEndSec != null
      ? `Only use timestamps between ${opts.windowStartSec.toFixed(1)} and ${opts.windowEndSec.toFixed(1)} seconds. This is a ~5 minute slice of a longer video.`
      : "Use timestamps that exist in the transcript.";
  const system = `You are an English-teaching item writer. Fill the given JSON schema only.
Rules:
- listening and speaking items MUST use timestamps that exist in the transcript.
- ${windowNote}
- Listening pedagogy (Vandergrift & Goh metacognitive cycle):
  * Item 1 = gist (main idea). Item 2 = specific detail. Item 3 = inference/attitude.
  * Do NOT put the answer in the stem. Stem is only a listening purpose ("Listen for the reason").
  * clip duration 8 to 22 seconds. After answering, the caption is the evidence line.
- Speaking / shadowing pedagogy (Hamada 2016; Kadota connected-speech shadowing):
  * Each target MUST be 2 to 4 consecutive transcript sentences (18–45 words), NOT a single short sentence.
  * clip duration 12 to 38 seconds. Copy the exact words from the transcript.
  * A1 children may use 12–24 words but still at least two clauses or two short sentences.
- answer must be exactly one of the choices.
- Match CEFR ${opts.level} and learner age ${opts.ageBand}.
- Do not invent captions; copy from the transcript.
- Copy spoken words only. Strip speaker-change marks (leading >>). Never emit HTML entities.
- Vocab: 4–6 useful American-English words or chunks per item (high-frequency spoken US English: phrasal verbs, discourse markers, collocations).
- Never output markdown.`;

  const user = `Video id: ${opts.videoId}
Title: ${opts.title}
Level: ${opts.level}
Age: ${opts.ageBand}
Transcript with timestamps:
${transcript || "(no captions — use only if you can still form A1 shadow lines from the title; otherwise still return 3 short items with startSec 0 endSec 10 and caption from the title)"}`;

  const models = [opts.model, ...FALLBACK_MODELS.filter((m) => m !== opts.model)];
  const formats: Array<"schema" | "object"> = ["schema", "object"];
  let lastErr = "OpenAI returned empty JSON";

  for (const model of models) {
    try {
      assertAllowedModel(model);
    } catch {
      continue;
    }
    for (const format of formats) {
      const res = await chatCompletions(opts.apiKey, lessonBody(model, system, user, format));
      if (!res.ok) {
        const err = await res.text();
        lastErr = `OpenAI error ${res.status}: ${err.slice(0, 180)}`;
        console.info("[tubeshadow-lesson] openai fail", JSON.stringify({ model, format, status: res.status }));
        if (res.status === 401 || res.status === 429) throw new Error(summarizeOpenAiError(res.status, err));
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
        return GeneratedLessonSchema.parse({
          ...(parsed as object),
          videoId: opts.videoId,
        });
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "parse_failed";
      }
    }
  }
  throw new Error(lastErr);
}

async function openaiFetch(apiKey: string, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers ?? {}),
    },
  });
}

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
  try {
    const modelsRes = await openaiFetch(apiKey, "https://api.openai.com/v1/models");
    if (!modelsRes.ok) {
      const err = await modelsRes.text();
      return {
        ok: false,
        status: modelsRes.status,
        model,
        message: summarizeOpenAiError(modelsRes.status, err),
      };
    }
    const chosen = model.trim() || "gpt-4.1-mini";
    const chatOnce = (id: string) =>
      chatCompletions(apiKey, {
        model: id,
        temperature: isReasoningModel(id) ? undefined : 0,
        ...(isReasoningModel(id) ? { max_completion_tokens: 32 } : { max_tokens: 8 }),
        messages: [{ role: "user", content: "Reply with the single word pong." }],
      });
    let chat = await chatOnce(chosen);
    let used = chosen;
    if (!chat.ok && (chat.status === 404 || chat.status === 400) && chosen !== "gpt-4o-mini") {
      const retry = await chatOnce("gpt-4o-mini");
      if (retry.ok) {
        chat = retry;
        used = "gpt-4o-mini";
        const json = (await chat.json()) as ChatJson;
        const text = completionText(json).trim();
        return {
          ok: true,
          status: 200,
          model: used,
          message: `${chosen} 모델을 찾을 수 없어 gpt-4o-mini로 확인했습니다.${text ? "" : " (empty completion)"} 설정에서 모델명을 gpt-4o-mini로 바꿔 주세요.`,
        };
      }
    }
    if (!chat.ok) {
      const err = await chat.text();
      return {
        ok: false,
        status: chat.status,
        model: chosen,
        message: summarizeOpenAiError(chat.status, err),
      };
    }
    const json = (await chat.json()) as ChatJson;
    const text = completionText(json).trim();
    return {
      ok: true,
      status: 200,
      model: used,
      message: text ? `ok · ${used}` : `ok · ${used} (empty completion)`,
    };
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
  assertAllowedModel(opts.model);
  const reasoning = isReasoningModel(opts.model);
  const body: Record<string, unknown> = {
    model: opts.model,
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
  };
  if (reasoning) body.max_completion_tokens = 800;
  else {
    body.temperature = 0.3;
    body.max_tokens = 400;
  }
  const res = await chatCompletions(opts.apiKey, body);
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
