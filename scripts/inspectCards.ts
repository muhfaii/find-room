import { chromium } from "playwright";
import { JAKARTA_SEEDS } from "../src/config/jakarta.js";

// One-off diagnostic (not part of the scraper): load ONE search page and report
// why clicking later listing cards does not open a tab, and whether listing URLs
// can be read without clicking. Prints only; writes nothing. Run:
//   npx tsx scripts/inspectCards.ts
//
// All page-side code is passed as STRING expressions on purpose: tsx/esbuild
// rewrites function literals (injecting a `__name` helper) and that helper does
// not exist inside the browser page.

const CARD = '[data-testid="nominatimRoomCard"]';

async function main() {
  const seed = JAKARTA_SEEDS.find((s) => s.cityLabel === "Jakarta Pusat")!;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  // JSON responses the page itself fetched (no extra requests made by us).
  const jsonResponses: string[] = [];
  page.on("response", async (res) => {
    try {
      if (!(res.headers()["content-type"] ?? "").includes("json")) return;
      const body = await res.text();
      const hasRoomInfo = /"slug"|share_url|\/room\//.test(body);
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
    const info = await card.evaluate(`el => {
      const hrefs = Array.from(el.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).slice(0, 6);
      const vue = el.__vue__ || el.__vueParentComponent || null;
      let vueProps = null;
      if (el.__vue__) vueProps = Object.keys(el.__vue__.$props || el.__vue__.$attrs || {}).slice(0, 25);
      else if (el.__vueParentComponent) vueProps = Object.keys(el.__vueParentComponent.props || {}).slice(0, 25);
      const dataAttrs = Array.from(el.attributes).map(a => a.name + '=' + a.value.slice(0, 40));
      return JSON.stringify({ hrefs, hasVueInstance: !!vue, vueProps, dataAttrs });
    }`);
    console.log("  " + info);
  }

  // Why is card #2 not clickable?
  const target = cards.nth(2);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  console.log("\n== card #2 hit-test after scrolling into view");
  console.log(
    "  " +
      (await target.evaluate(`el => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const name = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 50);
        const stack = document.elementsFromPoint(x, y).slice(0, 6).map(name);
        let scroller = null;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) { scroller = name(p); break; }
        }
        return JSON.stringify({
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          viewport: [innerWidth, innerHeight], point: [Math.round(x), Math.round(y)],
          stackAtPoint: stack, scrollContainer: scroller,
          bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
          bodyStyleAttr: document.body.getAttribute('style'),
        });
      }`))
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
  await tryMethod("DOM click", () => target.evaluate("el => el.click()"));
  await tryMethod("force click", () => target.click({ force: true, timeout: 3000 }));
  const box = await target.boundingBox();
  if (box) await tryMethod("mouse click at center", () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
