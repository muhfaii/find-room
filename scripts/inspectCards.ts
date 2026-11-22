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
    return console.log(`  (not valid JSON; starts with: ${JSON.stringify(body.slice(0, 80))})`);
  }
  const lines: string[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (lines.length >= 70) return;
    if (Array.isArray(node)) {
      lines.push(`${path}: array(${node.length})`);
      if (node.length > 0 && depth < 5) walk(node[0], `${path}[0]`, depth + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      lines.push(`${path}: object`);
      if (depth < 5) for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, depth + 1);
      return;
    }
    // Values are shown only for URL/slug-like strings; everything else is type only.
    const isLink = typeof node === "string" && /kost-|\/room|^https?:\/\//i.test(node);
    lines.push(`${path}: ${isLink ? JSON.stringify((node as string).slice(0, 110)) : typeof node}`);
  };
  walk(json, "$", 0);
  for (const line of lines) console.log("  " + line);
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

  console.log("\n== shape of the page's own list API (/garuda/stories/list), keys and types only");
  describeListApi(listBody);

  console.log("\n== component tree behind card #2 (props/data keys; link-like values only)");
  const tree = await cards.nth(2).evaluate((el) => {
    const anyEl = el as unknown as Record<string, any>;
    const out: string[] = [];
    const isV2 = Boolean(anyEl.__vue__);
    let vm: any = anyEl.__vue__ ?? anyEl.__vueParentComponent ?? null;
    out.push(isV2 ? "vue 2" : vm ? "vue 3" : "no vue instance");
    for (let depth = 0; vm && depth < 8; depth++) {
      const data: Record<string, any> = isV2 ? vm.$data ?? {} : { ...(vm.setupState ?? {}), ...(vm.data ?? {}) };
      const props: Record<string, any> = (isV2 ? vm.$props : vm.props) ?? {};
      out.push(`level ${depth}: props=[${Object.keys(props).join(",")}] data=[${Object.keys(data).join(",")}]`);
      out.push(
        "  id/link-like props: " +
          Object.entries(props)
            .filter(([k]) => /slug|url|link|share|room_?id|^id$/i.test(k))
            .map(([k, x]) => k + "=" + String(x).slice(0, 100))
            .join(" ")
      );
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
          out.push(
            `  data.${k}: array(${v.length}) item keys: ${Object.keys(v[0]).slice(0, 45).join(",")} | link-like: ` +
              Object.entries(v[0])
                .filter(([, x]) => typeof x === "string" && /kost-|\/room/i.test(x))
                .map(([kk, x]) => kk + "=" + String(x).slice(0, 110))
                .join(" ")
          );
        }
      }
      vm = isV2 ? vm.$parent : vm.parent;
    }
    return out.join("\n");
  });
  console.log(tree.split("\n").map((l) => "  " + l).join("\n"));

  // Why is card #2 not clickable? (run before AND after a listing tab was opened)
  const target = cards.nth(2);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const hitTest = async (label: string): Promise<void> => {
    console.log(`\n== card #2 hit-test ${label}`);
    console.log(
      "  " +
        (await target
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            const stack = document
              .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              .slice(0, 5)
              .map((n) => n.tagName.toLowerCase() + "." + String(n.className).slice(0, 40));
            return JSON.stringify({
              rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
              stackAtPoint: stack,
              visibility: document.visibilityState,
              hasFocus: document.hasFocus(),
              bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
              bodyStyleAttr: document.body.getAttribute("style"),
              bodyChildren: document.body.children.length,
              scrollY: Math.round(scrollY),
            });
          })
          .catch((err) => "evaluate failed: " + String(err.message).split("\n")[0]))
    );
  };
  await hitTest("before any click");

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
  await page.waitForTimeout(1500);
  await hitTest("AFTER the first listing tab was opened and closed");
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
