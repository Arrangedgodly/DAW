/* global document, window */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "docs/dev/r2-control-labels";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, scale, theme] of [
    [1280, 800, 1, "dark"],
    [390, 844, 1, "dark"],
    [390, 667, 1, "light"],
    [640, 400, 2, "light"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: scale,
      hasTouch: width < 768,
    });
    await page.goto("http://127.0.0.1:4192");
    await page.locator(".lane-floor").first().waitFor();
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    await page.getByText("Built-in demos", { exact: true }).click();
    await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await page.evaluate(async (theme) => {
      const { setTheme } = await import("/src/state/theme.ts");
      setTheme(theme);
    }, theme);
    for (const lane of ["lead", "extra4"]) {
      if (width >= 768) {
        await page
          .getByRole("button", {
            name: lane === "lead" ? "Instruments 1–4" : "Instruments 5–8",
            exact: true,
          })
          .click();
        await page
          .locator(`.lane-floor[data-lane="${lane}"] .lane-name`)
          .click();
      } else await page.locator(`[role="tab"][data-lane="${lane}"]`).click();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      const floor = page.locator(`.lane-floor[data-lane="${lane}"]`);
      const before = await page.evaluate(async (lane) => {
        const { docStore } = await import("/src/state/store.ts");
        const { registerWindowStart } = await import("/src/state/selection.ts");
        window.__r2Doc = docStore.getState().doc;
        return {
          octave: window.__r2Doc.lanes.find((l) => l.id === lane).octave ?? 0,
          start: registerWindowStart(lane),
        };
      }, lane);
      await floor.getByRole("button", { name: /octave view up$/ }).click();
      const view = await page.evaluate(async (lane) => {
        const { docStore } = await import("/src/state/store.ts");
        const { registerWindowStart } = await import("/src/state/selection.ts");
        return {
          unchanged: docStore.getState().doc === window.__r2Doc,
          start: registerWindowStart(lane),
        };
      }, lane);
      assert.ok(view.unchanged);
      assert.notEqual(view.start, before.start);
      await floor.getByRole("button", { name: /octave view down$/ }).click();
      if (width < 768)
        await page
          .getByRole("button", { name: "OPTIONS", exact: true })
          .click();
      await page
        .getByRole("button", {
          name: new RegExp(
            `^Transpose octave up for ${lane === "lead" ? "LEAD" : "INSTRUMENT 8"}$`,
          ),
        })
        .click();
      const transpose = await page.evaluate(async (lane) => {
        const { docStore } = await import("/src/state/store.ts");
        const { registerWindowStart } = await import("/src/state/selection.ts");
        return {
          octave:
            docStore.getState().doc.lanes.find((l) => l.id === lane).octave ??
            0,
          start: registerWindowStart(lane),
        };
      }, lane);
      assert.equal(transpose.octave, before.octave + 1);
      assert.equal(transpose.start, before.start);
      await page
        .getByRole("button", {
          name: new RegExp(
            `^Transpose octave down for ${lane === "lead" ? "LEAD" : "INSTRUMENT 8"}$`,
          ),
        })
        .click();
      if (width < 768) {
        await page.screenshot({
          path: `${out}/options-${width}x${height}-${scale}x-${lane}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "OPTIONS", exact: true })
          .click();
      }
      await page.waitForTimeout(350);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        labels: [...document.querySelectorAll(".register-stepper-label")]
          .filter((e) => e.getBoundingClientRect().height)
          .map((e) => e.textContent),
        footer: [...document.querySelectorAll(".lane-follow")]
          .filter((e) => e.getBoundingClientRect().height)
          .map((e) => e.getBoundingClientRect().bottom),
      }));
      assert.equal(geometry.width, width);
      if (width >= 768) {
        assert.equal(geometry.height, height);
        assert.ok(geometry.footer.every((y) => y <= height));
      }
      await page.screenshot({
        path: `${out}/final-${width}x${height}-${scale}x-${lane}.png`,
        fullPage: true,
      });
      results.push({
        width,
        height,
        scale,
        theme,
        lane,
        before,
        view,
        transpose,
        geometry,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}/evidence.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
