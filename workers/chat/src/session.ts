import type { Env } from "./index.js";
import { chatCompletion, type ChatMessage } from "./openai.js";
import { argsToFilters, executeToolCall, getTools, type ListingHit } from "./tools.js";

// Per-conversation Durable Object: owns message history + accumulated search
// filters. A session_id maps 1:1 to a DO instance via idFromName, so multi-turn
// conversations keep state without a KV store.

export interface SessionFilters {
  priceMin?: number;
  priceMax?: number;
  area?: string;
  gender?: string;
  facilities?: string[];
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface SessionState {
  messages: SessionMessage[];
  filters: SessionFilters;
  createdAt: string;
  lastActiveAt: string;
}

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 4;

const SYSTEM_PROMPT = `Kamu adalah asisten yang membantu pengguna mencari kost di Jakarta (dan sekitarnya) melalui Mamikos. Jawab dalam Bahasa Indonesia kecuali pengguna menulis dalam bahasa lain.
Gunakan tool pencarian untuk mencari listing sungguhan saat pengguna bertanya tentang pilihan kost atau mengungkapkan preferensi. Setelah mendapat hasil, rangkum beberapa kandidat terbaik (nama, harga, area) dan tawarkan untuk mempersempit lebih lanjut.
Jika pengguna memberi kriteria konkret (harga, area, khusus putra/putri, fasilitas), pakai search_listings_structured. Jika preferensinya samar/konseptual ("deket kampus UI", "tenang", "adem"), pakai search_listings_semantic.
JANGAN pernah mengarang listing yang tidak ada di hasil tool. Jika tidak ada hasil, katakan jujur bahwa tidak ada yang cocok dan sarankan menyesuaikan kriteria.`;

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export class ChatSession {
  private state: DurableObjectState;
  private env: Env;
  private data: SessionState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async load(): Promise<SessionState> {
    if (this.data) return this.data;
    const stored = await this.state.storage.get<SessionState>("state");
    const now = new Date().toISOString();
    this.data = stored ?? { messages: [], filters: {}, createdAt: now, lastActiveAt: now };
    return this.data;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put("state", this.data);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/chat") {
      return json({ error: "not_found" }, 404);
    }

    const data = await this.load();

    let body: { message?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "malformed JSON body" }, 400);
    }

    const message = body?.message;
    if (typeof message !== "string" || message.length === 0) {
      return json({ error: "missing required field: message" }, 400);
    }

    try {
      const result = await this.runChatTurn(message);
      return json(result, 200);
    } catch (err) {
      // An OpenAI/tool failure shouldn't surface as a raw platform 500 (which
      // index.ts's handleChat can't parse as JSON and would itself throw on).
      // Deliberately don't persist state here: the in-progress `conversation`
      // array may contain a dangling tool_call the model never got an answer
      // to, and persisting that would corrupt the next turn's message chain.
      // The user's current message is lost from history, but the session
      // otherwise stays valid.
      console.error("[ChatSession] chat turn failed", err);
      return json(
        { reply: "Maaf, lagi ada gangguan teknis. Coba tanya lagi sebentar lagi ya.", listings: [] },
        200,
      );
    }
  }

  // One chat turn: run the OpenAI tool-calling loop (bounded), persist state,
  // and return the final reply + the listings surfaced by any search tool.
  private async runChatTurn(
    message: string,
  ): Promise<{ reply: string; listings: ListingHit[]; filters: SessionFilters }> {
    const data = await this.load();

    const history: ChatMessage[] = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls !== undefined ? { tool_calls: m.tool_calls as ChatMessage["tool_calls"] } : {}),
    }));

    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    let listings: ListingHit[] = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const completion = await chatCompletion(this.env, conversation, getTools());
      const choice = completion.choices?.[0];
      if (!choice) throw new Error("OpenAI returned no choices");

      const assistantMessage = choice.message;
      conversation.push(assistantMessage);

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const call of assistantMessage.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(call.function.arguments ?? "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          const result = await executeToolCall(this.env, call.function.name, args, data.filters);
          if (result.listings.length > 0) listings = result.listings;
          if (call.function.name.startsWith("search_listings_")) {
            data.filters = { ...data.filters, ...argsToFilters(args) };
          }
          conversation.push({ role: "tool", tool_call_id: call.id, content: result.content });
        }
        continue;
      }

      const reply = assistantMessage.content ?? "";
      await this.commitConversation(conversation);
      return { reply, listings, filters: data.filters };
    }

    // Iteration cap reached — return the last assistant text if one exists.
    const fallback =
      [...conversation].reverse().find((m) => m.role === "assistant" && m.content)?.content ??
      "Maaf, jawaban saya belum selesai — coba tanya lagi ya.";
    await this.commitConversation(conversation);
    return { reply: fallback, listings, filters: data.filters };
  }

  private async commitConversation(conversation: ChatMessage[]): Promise<void> {
    const data = this.data;
    if (!data) return;
    data.messages = conversation
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as SessionMessage["role"],
        content: m.content ?? "",
        ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls !== undefined ? { tool_calls: m.tool_calls } : {}),
      }));
    if (data.messages.length > MAX_HISTORY_MESSAGES) {
      data.messages = data.messages.slice(-MAX_HISTORY_MESSAGES);
    }
    data.lastActiveAt = new Date().toISOString();
    await this.persist();
  }
}
