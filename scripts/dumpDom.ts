import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { JAKARTA_SEEDS } from "../src/config/jakarta.js";
import { politeWait } from "../src/config/politeness.js";

// One-off DOM-dump utility (not part of the production scraper). Navigates to the
// bulanan search page for Jakarta Pusat, saves the rendered HTML, extracts a
// handful of real listing detail URLs from it, then saves those too. Output feeds
// selector-writing for src/crawlers/discovery.ts and detailRefresh.ts.
const OUT_DIR = "data/dom-snapshots";

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  const searchSeed = JAKARTA_SEEDS.find((s) => s.cityLabel === "Jakarta Pusat")!;
  console.log(`Navigating to search page: ${searchSeed.seedUrl}`);
  await page.goto(searchSeed.seedUrl, { waitUntil: "networkidle" });
  // Wait for a price string ("Rp") to actually appear in rendered text, rather than
  // a fixed timeout — the SPA finishes its own async data fetch after networkidle.
  await page.waitForFunction(() => document.body.innerText.includes("Rp"), { timeout: 20000 });
  await page.waitForTimeout(1000); // let remaining cards settle

  const searchHtml = await page.content();
  writeFileSync(`${OUT_DIR}/search-bulanan-jakarta-pusat.html`, searchHtml, "utf-8");
  console.log(`Saved search page HTML (${searchHtml.length} bytes)`);

  // Extract candidate listing detail links. Try broad href patterns since the exact
  // path prefix isn't confirmed yet.
  const detailLinks: string[] = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const hrefs = anchors
      .map((a) => a.getAttribute("href") || "")
      .filter((href) => /\/(room|kost)\//i.test(href) || /-\d+$/.test(href));
    return Array.from(new Set(hrefs));
  });
  console.log(`Found ${detailLinks.length} candidate detail links`);
  writeFileSync(`${OUT_DIR}/_detail-links-found.json`, JSON.stringify(detailLinks, null, 2), "utf-8");

  if (detailLinks.length === 0) {
    console.log("No detail links found — dumping all hrefs for manual inspection.");
    const allHrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") || ""),
    );
    writeFileSync(`${OUT_DIR}/_all-hrefs.json`, JSON.stringify(allHrefs, null, 2), "utf-8");
    await browser.close();
    return;
  }

  const sampleCount = Math.min(4, detailLinks.length);
  const sampled: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.floor((i * detailLinks.length) / sampleCount);
    sampled.push(detailLinks[idx]);
  }

  for (let i = 0; i < sampled.length; i++) {
    const href = sampled[i];
    const url = href.startsWith("http") ? href : `https://mamikos.com${href}`;
    console.log(`Navigating to detail page ${i + 1}/${sampled.length}: ${url}`);
    await politeWait();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const html = await page.content();
    writeFileSync(`${OUT_DIR}/detail-${i + 1}.html`, html, "utf-8");
    writeFileSync(`${OUT_DIR}/detail-${i + 1}.url.txt`, url, "utf-8");
    console.log(`Saved detail-${i + 1}.html (${html.length} bytes)`);
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
