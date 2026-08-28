import type { Env } from "./index.js";

// Constant-time string comparison — a plain `===`/`!==` on a secret short-circuits
// on the first mismatched byte, which leaks a timing signal an attacker could use
// to guess the token byte-by-byte. Always walks the full length of the longer
// input regardless of where (or whether) a mismatch occurs.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLength = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLength; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

// Bearer-token guard for the ingest endpoints. Returns a 401 Response when the
// Authorization header doesn't match INGEST_SHARED_SECRET, or null to let the
// request through.
export function checkAuth(request: Request, env: Env): Response | null {
  const expected = env.INGEST_SHARED_SECRET;
  const header = request.headers.get("Authorization") ?? "";
  if (!expected || !timingSafeEqual(header, `Bearer ${expected}`)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
