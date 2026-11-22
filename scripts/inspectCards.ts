import { chromium } from "playwright";
import { JAKARTA_SEEDS } from "../src/config/jakarta.js";

// One-off diagnostic (not part of the scraper): load ONE search page and report
// why clicking later listing cards does not open a tab, and whether listing URLs
// can be read without clicking. Prints only; writes nothing. Run:
//   npx tsx scripts/inspectCards.ts
//
// Page-side callbacks avoid nested named helpers (no `const f = () => ...`):
// tsx/esbuild injects a `__name` helper for those, which does not exist in the
// browser page.

const CARD = '[data-testid="nominatimRoomCard"]';

// Prints the key structure of the first room object in the list API response.
// Values are shown only for URL/slug-like strings (what we are looking for);
// everything else prints its type only, so no owner/contact details are echoed.
function describeListApi(body: string): void {
  if (!body) return console.log("  (no list response captured)");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return console.log("  (list response is not valid JSON)");
  }
  // Depth-first search for the first array of objects.
  let found: { path: string; items: Record<string, unknown>[] } | null = null;
  const walk = (node: unknown, path: string, depth: number): void => {
    if (found || depth > 4 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === "object" && node[0] !== null && !Array.isArray(node[0])) {
        found = { path, items: node as Record<string, unknown>[] };
        return;
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(json, "", 0);
  if (!found) return console.log("  (no array of objects found)");
  const { path, items } = found as { path: string; items: Record<string, unknown>[] };
  console.log(`  array at "${path}" with ${items.length} items; first item fields:`);
  const lines: string[] = [];
  const flat = (node: unknown, prefix: string, depth: number): void => {
    if (lines.length >= 90) return;
    if (node !== null && typeof node === "object" && !Array.isArray(node) && depth < 2) {
      for (const [k, v] of Object.entries(node)) flat(v, `${prefix}.${k}`, depth + 1);
      return;
    }
    const isLink = typeof node === "string" && /kost-|\/room|^https?:\/\//i.test(node);
    const shown = isLink ? JSON.stringify((node as string).slice(0, 110)) : Array.isArray(node) ? `array(${node.length})` : typeof node;
    lines.push(`    ${prefix.slice(1)}: ${shown}`);
  };
  flat(items[0], "", 0);
  for (const line of lines) console.log(line);
}

async function main() {
  const seed = JAKARTA_SEEDS.find((s) => s.cityLabel === "Jakarta Pusat")!;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  // JSON responses the page itself fetched (no extra requests made by us).
  const jsonResponses: string[] = [];
  let listBody = "";
  page.on("response", async (res) => {
    try {
      if (!(res.headers()["content-type"] ?? "").includes("json")) return;
      const body = await res.text();
      if (res.url().includes("/stories/list")) listBody = body;
      const hasRoomInfo = /slug|share_url|\/room\//i.test(body);
      jsonResponses.push(`${res.status()} ${res.url().slice(0, 140)} bytes=${body.length} roomInfo=${hasRoomInfo}`);
    } catch {
      // body not available (redirect/aborted) — ignore
    }
  });

  await page.goto(seed.seedUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.body.innerText.includes('Rp')", undefined, { timeout: 20000 });
  await page.waitForTimeout(2000);

  const cards = page.locator(CARD);
  console.log(`\n== cards on page: ${await cards.count()}`);

  console.log("\n== JSON responses the page loaded:");
  for (const line of jsonResponses.slice(0, 25)) console.log("  " + line);

  for (const index of [0, 2]) {
    const card = cards.nth(index);
    console.log(`\n== card #${index}`);
    const info = await card.evaluate((el) => {
      const anyEl = el as unknown as Record<string, any>;
      const hrefs = Array.from(el.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href"))
        .slice(0, 6);
      let vueProps: string[] | null = null;
      if (anyEl.__vue__) vueProps = Object.keys(anyEl.__vue__.$props ?? anyEl.__vue__.$attrs ?? {}).slice(0, 25);
      else if (anyEl.__vueParentComponent) vueProps = Object.keys(anyEl.__vueParentComponent.props ?? {}).slice(0, 25);
      return JSON.stringify({
        hrefs,
        hasVueInstance: Boolean(anyEl.__vue__ || anyEl.__vueParentComponent),
        vueProps,
        attrs: Array.from(el.attributes).map((a) => a.name + "=" + a.value.slice(0, 40)),
      });
    });
    console.log("  " + info);
  }

  console.log("\n== structure of the page's own list API (/garuda/stories/list)");
  describeListApi(listBody);

  // Why is card #2 not clickable?
  const target = cards.nth(2);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  console.log("\n== card #2 hit-test after scrolling into view");
  console.log(
    "  " +
      (await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const stack = document
          .elementsFromPoint(x, y)
          .slice(0, 6)
          .map((n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + "." + String(n.className).slice(0, 50));
        let scroller = "none";
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) {
            scroller = p.tagName.toLowerCase() + "." + String(p.className).slice(0, 50);
            break;
          }
        }
        return JSON.stringify({
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          viewport: [innerWidth, innerHeight],
          stackAtPoint: stack,
          scrollContainer: scroller,
          bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
          bodyStyleAttr: document.body.getAttribute("style"),
        });
      }))
  );

  // Which click method actually opens a tab?
  const tryMethod = async (label: string, action: () => Promise<unknown>) => {
    const tab = context.waitForEvent("page", { timeout: 6000 }).catch(() => null);
    try {
      await action();
    } catch (err) {
      console.log(`  ${label}: threw — ${String(err instanceof Error ? err.message : err).split("\n")[0]}`);
      return;
    }
    const opened = await tab;
    console.log(`  ${label}: ${opened ? "OPENED A TAB " + opened.url().slice(0, 90) : "no tab"}`);
    if (opened) await opened.close();
    await page.bringToFront();
  };
  console.log("\n== click methods on card #2");
  await tryMethod("normal click (3s)", () => target.click({ timeout: 3000 }));
  await tryMethod("DOM click", () => target.evaluate((el) => (el as HTMLElement).click()));
  await tryMethod("force click", () => target.click({ force: true, timeout: 3000 }));
  const box = await target.boundingBox();
  if (box) await tryMethod("mouse click at center", () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
