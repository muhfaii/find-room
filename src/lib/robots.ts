import { MIN_DELAY_MS } from "../config/politeness.js";

interface RobotsRules {
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export class RobotsCheckFailed extends Error {}

// PRD §3: automated pre-run check. Fetches and parses robots.txt for the `*` user
// agent group; aborts the run if a targeted path is newly disallowed or a stricter
// Crawl-delay than our configured minimum (3s) is now published.
export async function fetchRobotsRules(baseUrl = "https://mamikos.com"): Promise<RobotsRules> {
  const res = await fetch(`${baseUrl}/robots.txt`);
  if (!res.ok) {
    throw new RobotsCheckFailed(`robots.txt fetch failed: HTTP ${res.status}`);
  }
  const body = await res.text();
  return parseRobotsTxt(body);
}

export function parseRobotsTxt(body: string): RobotsRules {
  const lines = body.split("\n").map((l) => l.trim());
  const disallow: string[] = [];
  let crawlDelaySeconds: number | null = null;
  let inWildcardGroup = false;

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inWildcardGroup = value === "*";
      continue;
    }
    if (!inWildcardGroup) continue;

    if (key === "disallow" && value) disallow.push(value);
    if (key === "crawl-delay") crawlDelaySeconds = Number(value) || null;
  }

  return { disallow, crawlDelaySeconds };
}

export function assertPathAllowed(rules: RobotsRules, path: string): void {
  for (const disallowed of rules.disallow) {
    if (path.startsWith(disallowed)) {
      throw new RobotsCheckFailed(
        `Path "${path}" is disallowed by robots.txt (Disallow: ${disallowed})`,
      );
    }
  }
}

export function assertCrawlDelayRespected(rules: RobotsRules): void {
  if (rules.crawlDelaySeconds === null) return;
  const requiredMs = rules.crawlDelaySeconds * 1000;
  if (requiredMs > MIN_DELAY_MS) {
    throw new RobotsCheckFailed(
      `robots.txt now requires Crawl-delay of ${rules.crawlDelaySeconds}s, which exceeds our configured minimum of ${MIN_DELAY_MS / 1000}s. Update src/config/politeness.ts before running.`,
    );
  }
}
