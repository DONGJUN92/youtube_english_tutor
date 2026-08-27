/** Operator-provided OpenAI key. Never expose this to the client. */
export function operatorOpenAiKey(): string | undefined {
  const value =
    (typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined)?.trim() ||
    (typeof process !== "undefined" ? process.env.OPENAI_KEY : undefined)?.trim();
  return value || undefined;
}

export function operatorOpenAiModel(fallback = "gpt-4.1-mini"): string {
  const value =
    (typeof process !== "undefined" ? process.env.OPENAI_MODEL : undefined)?.trim();
  return value || fallback;
}

export function hasOperatorOpenAiKey(): boolean {
  return Boolean(operatorOpenAiKey());
}
