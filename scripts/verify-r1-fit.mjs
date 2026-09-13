/* global document, window -- browser evaluation callbacks */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const phase = process.argv[2] ?? "before";
const out = "docs/dev/r1-desktop-fit";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, touch] of [
    [1280, 800, false],
    [1440, 1000, false],
    [390, 844, true],
    [390, 667, true],
    [1280, 800, true],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
    });
    await page.goto("http://127.0.0.1:4191");
    await page.locator(".lane-floor").first().waitFor();
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    await page.getByText("Built-in demos", { exact: true }).click();
    await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await page.evaluate(async () => {
      const { docStore } = await import("/src/state/store.ts");
      window.__r1Document = docStore.getState().doc;
    });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(async (theme) => {
        const { setTheme } = await import("/src/state/theme.ts");
        setTheme(theme);
      }, theme);
      for (const cohort of [1, 2]) {
        if (width >= 768)
          await page
            .getByRole("button", {
              name: cohort === 1 ? "Instruments 1–4" : "Instruments 5–8",
              exact: true,
            })
            .click();
        const lane = cohort === 1 ? "lead" : "extra4";
        if (width < 768)
          await page.locator(`[role="tab"][data-lane="${lane}"]`).click();
        else
          await page
            .locator(`.lane-floor[data-lane="${lane}"] .lane-name`)
            .click();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1000);
        const m = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth,
          theme: document.documentElement.dataset.theme,
          lanes: [...document.querySelectorAll(".lane-floor")]
            .filter((e) => e.getBoundingClientRect().height)
            .map((e) => {
              const b = e.getBoundingClientRect();
              const grid = e.querySelector(".lane-grid-scroll");
              const g = grid.getBoundingClientRect();
              const rows = [...grid.querySelectorAll(".grid-row")]
                .map((r) => r.getBoundingClientRect())
                .filter((r) => r.bottom > g.top + 1 && r.top < g.bottom - 4);
              const footer = e
                .querySelector(".lane-follow")
                .getBoundingClientRect();
              return {
                lane: e.dataset.lane,
                top: b.top,
                bottom: b.bottom,
                gridTop: g.top,
                gridBottom: g.bottom,
                rowHeights: rows.map((r) => r.height),
                rows: rows.length,
                partialRows: rows.filter(
                  (r) =>
                    r.top < g.top - 0.5 ||
                    r.bottom > g.top + grid.clientHeight + 0.5,
                ).length,
                footerBottom: footer.bottom,
                head: e
                  .querySelector(".lane-head-strip")
                  .getBoundingClientRect().height,
                register: e
                  .querySelector(".register-shift")
                  .getBoundingClientRect().height,
              };
            }),
        }));
        assert.equal(
          await page.evaluate(async () => {
            const { docStore } = await import("/src/state/store.ts");
            return window.__r1Document === docStore.getState().doc;
          }),
          true,
          "Layout navigation changed document",
        );
        if (width >= 768) {
          assert.equal(m.height, height);
          assert.equal(m.width, width);
          assert.equal(m.lanes.length, 4);
          assert.ok(
            m.lanes.every(
              (l) => l.footerBottom <= height && l.partialRows === 0,
            ),
          );
        } else if (width < 768) {
          assert.ok(
            m.lanes.every(
              (l) => l.rowHeights.every((h) => h >= 44) && l.partialRows === 0,
            ),
          );
        }
        results.push({
          viewportWidth: width,
          viewportHeight: height,
          touch,
          theme,
          cohort,
          ...m,
        });
        await page.screenshot({
          path: `${out}/${phase}-${width}x${height}-${touch ? "touch" : "mouse"}-${theme}-${cohort}.png`,
          fullPage: true,
        });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(
    `${out}/${phase}-matrix.json`,
    JSON.stringify(results, null, 2),
  );
}
console.log(JSON.stringify(results));
