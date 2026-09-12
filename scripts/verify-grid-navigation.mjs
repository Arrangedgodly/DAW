import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
/* global document, innerWidth, setTimeout -- callbacks execute inside Chromium */

const output = "docs/dev/mobile-navigation";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [844, 390],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 1024,
    });
    await page.goto("http://127.0.0.1:5194/");
    await page.waitForSelector(".lane-floor");
    await page.evaluate(async () => {
      const { getAutosaveController } = await import("/src/persist/boot.ts");
      while (!getAutosaveController())
        await new Promise((r) => setTimeout(r, 50));
      const { createFreshProjectDocument, loadDocument } =
        await import("/src/state/store.ts");
      const { selectLane } = await import("/src/state/selection.ts");
      const { showPhonePage } = await import("/src/state/phonePage.ts");
      const doc = createFreshProjectDocument();
      doc.patterns.bass[0].bars = 4;
      loadDocument(doc);
      selectLane("bass");
      showPhonePage("edit");
      await document.fonts.ready;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
    results.push(
      await page.evaluate(() => {
        const nav = document.querySelector(
          '.lane-floor[data-lane="bass"] .grid-navigation',
        );
        return {
          width: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          navigationVisible: nav.getBoundingClientRect().height > 0,
          controls: [...nav.querySelectorAll("button")].map((b) => ({
            text: b.textContent,
            width: b.getBoundingClientRect().width,
            height: b.getBoundingClientRect().height,
          })),
        };
      }),
    );
    await page.close();
  }
  await writeFile(`${output}/layout.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
