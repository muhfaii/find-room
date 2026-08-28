import { ChatSession } from "./session.js";

export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  OPENAI_API_KEY: string;
  CHAT_SESSION: DurableObjectNamespace;
  CHAT_RATE_LIMITER: RateLimit;
  ASSETS: Fetcher;
}

export { ChatSession };

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  // Each request can trigger a paid OpenAI call (plus a Workers AI embedding
  // call for semantic search) with no auth in front of it — rate limit by
  // client IP so a single abuser can't run up unbounded API spend.
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.CHAT_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return json({ error: "rate_limited", message: "Terlalu banyak mesej, cuba lagi sebentar ya." }, 429);
  }

  let body: { session_id?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "malformed JSON body" }, 400);
  }

  const message = body?.message;
  if (typeof message !== "string" || message.length === 0) {
    return json({ error: "missing required field: message" }, 400);
  }

  const sessionId =
    typeof body?.session_id === "string" && body.session_id.length > 0 ? body.session_id : crypto.randomUUID();

  const id = env.CHAT_SESSION.idFromName(sessionId);
  const stub = env.CHAT_SESSION.get(id);

  const subrequest = new Request("https://do.internal/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  try {
    const res = await stub.fetch(subrequest);
    const data = (await res.json()) as { reply?: string; listings?: unknown[]; filters?: unknown };
    return json({ session_id: sessionId, ...data }, res.status);
  } catch (err) {
    console.error("[chat-kl] session dispatch failed", err);
    return json(
      { session_id: sessionId, reply: "Maaf, ada gangguan teknikal. Sila cuba lagi sebentar ya.", listings: [] },
      200,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Static chat page and any other static assets.
    if (request.method === "GET") {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      return handleChat(request, env);
    }

    return json({ error: "not_found" }, 404);
  },
};
