import type { Env } from "./index.js";

// Minimal OpenAI-compatible chat-completions client via direct fetch — no SDK
// dependency, keeps the bundle small. The provider is configuration, not code:
// LLM_BASE_URL and LLM_MODEL come from [vars] in wrangler.toml and LLM_API_KEY
// is a secret, so switching vendor/model is a config change (no code edit).
// The provider must support OpenAI-format tool calling (tools / tool_calls).

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatCompletionChoice {
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
}

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class NonRetryableOpenAIError extends Error {}

// Bounded retry with backoff for transient failures (rate limits, 5xx, network
// errors). Non-retryable errors (e.g. 400/401 — bad request or bad API key)
// throw immediately since retrying can't fix them.
export async function chatCompletion(
  env: Env,
  messages: ChatMessage[],
  tools: unknown[],
): Promise<ChatCompletionResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${env.LLM_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          messages,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const message = `LLM API responded ${res.status}: ${body}`;
        throw RETRYABLE_STATUS.has(res.status) ? new Error(message) : new NonRetryableOpenAIError(message);
      }

      return (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      if (err instanceof NonRetryableOpenAIError) throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 500);
    }
  }
  throw lastError;
}
