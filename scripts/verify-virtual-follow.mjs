/* global document */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1296, height: 1272 },
  });
  await page.goto("http://127.0.0.1:5199");
  await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
  await page.getByText("Built-in demos", { exact: true }).click();
  await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
  await page.evaluate(async () => {
    const { resizePattern } = await import("/src/state/store.ts");
    for (let i = 1; i <= 4; i++) resizePattern("drums", "drums-" + i, 8);
  });
  const selector = 'main.stage:not([hidden]) [data-lane="drums"] .grid-hscroll';
  await page.waitForSelector(selector);
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await page.waitForTimeout(4000);
  console.log(
    await page.evaluate(async () => {
      const { docStore } = await import("/src/state/store.ts");
      const { getSession } = await import("/src/engine/session.ts");
      return {
        patterns: docStore.getState().doc.patterns.drums.map((p) => p.bars),
        playing: getSession().transport.snapshot.playing,
        grids: [
          ...document.querySelectorAll('[data-lane="drums"] .grid-hscroll'),
        ].map((e) => ({
          left: e.scrollLeft,
          width: e.clientWidth,
          total: e.scrollWidth,
        })),
        heads: [
          ...document.querySelectorAll('[data-lane="drums"] .grid-playhead'),
        ].map((e) => e.style.transform),
      };
    }),
  );
  await page.screenshot({
    path: "docs/dev/instruments-review/virtual-follow.png",
  });
  await page.waitForFunction(
    (selector) => (document.querySelector(selector)?.scrollLeft ?? 0) > 500,
    selector,
    { timeout: 10000 },
  );
  const result = await page
    .locator(selector)
    .evaluate((el) => ({
      left: el.scrollLeft,
      width: el.clientWidth,
      total: el.scrollWidth,
      cells: el.querySelectorAll('[role="gridcell"]').length,
    }));
  assert.ok(result.left > 500);
  console.log(result);
} finally {
  await browser.close();
}
