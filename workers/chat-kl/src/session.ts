import type { Env } from "./index.js";
import { chatCompletion, type ChatMessage } from "./openai.js";
import { argsToFilters, executeToolCall, getTools, type ListingHit } from "./tools.js";

// Per-conversation Durable Object: owns message history + accumulated search
// filters (parallel of the Jakarta chat worker's session.ts).

export interface SessionFilters {
  priceMin?: number;
  priceMax?: number;
  area?: string;
  gender?: string;
  roomType?: string;
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

// Bahasa Melayu prompt for the KL deployment. Note: the assistant surfaces
// tenant_preference_raw read-only when relevant but must never treat it as a
// filter/search criterion (ADR-0004) — the tool schema already enforces this;
// the prompt reinforces the intent.
const SYSTEM_PROMPT = `Kamu adalah asisten yang membantu pengguna mencari bilik sewa (room for rent) di Lembah Klang (Kuala Lumpur, Petaling Jaya, Ampang Jaya, Subang Jaya, Shah Alam, Bangi, Putrajaya) melalui Mudah.my. Jawab dalam Bahasa Melayu kecuali pengguna menulis dalam bahasa lain.
Gunakan tool pencarian untuk mencari listing sebenar apabila pengguna bertanya tentang pilihan bilik atau menyatakan keutamaan. Selepas mendapat hasil, ringkaskan beberapa calon terbaik (nama, harga, kawasan) dan tawarkan untuk mengecilkan carian.
Jika pengguna memberi kriteria konkrit (harga, kawasan, khusus lelaki/perempuan, jenis bilik, fasiliti), guna search_listings_structured. Jika preferensi samar/konseptual ("tenang", "dekat LRT", "selesa"), guna search_listings_semantic.
JANGAN sesekali mengarang listing yang tiada dalam hasil tool. Jika tiada hasil, beritahu dengan jujur bahawa tiada yang sesuai dan cadangkan menyesuaikan kriteria.
Keutamaan penyewa (tenant preference) yang dipapar pada kad listing hanyalah maklumat paparan — jangan gunakannya sebagai kriteria carian.`;

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
      console.error("[ChatSession] chat turn failed", err);
      return json(
        { reply: "Maaf, ada gangguan teknikal. Sila cuba lagi sebentar lagi ya.", listings: [] },
        200,
      );
    }
  }

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
      "Maaf, jawapan saya belum selesai — cuba tanya lagi ya.";
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
