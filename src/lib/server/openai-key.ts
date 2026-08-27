/** Operator-provided OpenAI key. Never expose this to the client. */

const KEY_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "OPEN_AI_API_KEY",
  "OPENAI_SECRET_KEY",
  "OPENAI_SECRET",
  "OPENAI_TOKEN",
] as const;

const MODEL_NAMES = ["OPENAI_MODEL", "OPENAI_MODEL_NAME", "OPENAI_CHAT_MODEL"] as const;

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  const value = process.env[name]?.trim();
  return value || undefined;
}

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return undefined;
}

export function operatorOpenAiKey(): string | undefined {
  return firstEnv(KEY_NAMES);
}

export function operatorOpenAiModel(fallback = "gpt-4.1-mini"): string {
  return firstEnv(MODEL_NAMES) || fallback;
}

export function hasOperatorOpenAiKey(): boolean {
  return Boolean(operatorOpenAiKey());
}

/** Which known env names are set — booleans only, never values. */
export function operatorEnvFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const name of [...KEY_NAMES, ...MODEL_NAMES]) {
    flags[name] = Boolean(readEnv(name));
  }
  return flags;
}

export function operatorKeyLooksValid(): boolean {
  const key = operatorOpenAiKey();
  if (!key) return false;
  return key.startsWith("sk-") && key.length >= 20;
}
