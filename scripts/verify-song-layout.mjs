import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 506, height: 1272 },
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:5199");
  await page
    .getByRole("button", { name: "Song arrangement", exact: true })
    .click();
  const rows = await page.locator(".rail-row").evaluateAll((els) =>
    els.map((e) => {
      const t = e.querySelector(".rail-lane-name").getBoundingClientRect();
      const r = e.getBoundingClientRect();
      const tiles = e.querySelector(".rail-tiles").getBoundingClientRect();
      return {
        title: t.y,
        tiles: tiles.y,
        center: Math.abs(t.x + t.width / 2 - r.x - r.width / 2),
        height: r.height,
      };
    }),
  );
  assert.ok(
    rows.every((r) => r.title < r.tiles && r.center < 2 && r.height < 210),
    JSON.stringify(rows),
  );
  await page.screenshot({
    path: "docs/dev/instruments-review/phone-song-506.png",
    fullPage: true,
  });
  for (const width of [360, 390, 506]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  console.log(JSON.stringify({ rows, overflow: false }));
} finally {
  await browser.close();
}
