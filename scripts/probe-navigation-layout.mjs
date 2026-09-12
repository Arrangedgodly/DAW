/* global document, matchMedia, getComputedStyle -- page.evaluate callbacks run in Chromium */
import { preview } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const screenshots = process.argv.includes("--screenshots");
if (screenshots)
  mkdirSync("docs/dev/browser-followup-2026-09-12/screenshots", {
    recursive: true,
  });

// Read-only layout probe. Hide navigation only in the disposable browser DOM
// to measure its contribution to overflow without changing the application.
const server = await preview({
  preview: { host: "127.0.0.1", port: 4187, strictPort: true },
});
const browser = await chromium.launch({ headless: true });
try {
  for (const hasTouch of [false, true]) {
    const context = await browser.newContext({ hasTouch });
    const page = await context.newPage();
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [768, 1024],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("http://127.0.0.1:4187");
      await page.locator(".lane-grid-scroll").first().waitFor();
      if (width === 390)
        await page
          .locator(".lane-switcher button")
          .filter({ hasText: "LEAD" })
          .click();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      const measure = () =>
        page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          coarse: matchMedia("(any-pointer: coarse)").matches,
          floors: [...document.querySelectorAll(".lane-floor")].map((el) => ({
            lane: el.getAttribute("data-lane"),
            height: el.getBoundingClientRect().height,
            children: [...el.children]
              .filter((child) => child.getBoundingClientRect().height)
              .map((child) => ({
                class: child.className,
                height: child.getBoundingClientRect().height,
                top: child.getBoundingClientRect().top,
              })),
          })),
          navigation: [...document.querySelectorAll(".grid-navigation")].map(
            (el) => ({
              display: getComputedStyle(el).display,
              height: el.getBoundingClientRect().height,
            }),
          ),
        }));
      const before = await measure();
      if (screenshots)
        await page.screenshot({
          path: `docs/dev/browser-followup-2026-09-12/screenshots/${width}-${hasTouch ? "touch" : "mouse"}.png`,
          fullPage: true,
        });
      if (screenshots && hasTouch && width === 390) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        const cell = page.locator(".lane-grid-scroll .cell").first();
        const box = await cell.boundingBox();
        const pointer = {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: box.x + 5,
          clientY: box.y + 5,
        };
        await cell.dispatchEvent("pointerdown", pointer);
        await page.waitForTimeout(400);
        if (
          (await page
            .locator('.lane-grid-scroll[data-pan-ready="true"]')
            .count()) !== 1
        )
          throw new Error("Pan cue did not activate");
        await page.screenshot({
          path: "docs/dev/browser-followup-2026-09-12/screenshots/390-pan-reduced-motion.png",
          fullPage: true,
        });
        await page
          .locator(".lane-grid-scroll")
          .dispatchEvent("pointerup", pointer);
      }
      await page.evaluate(() =>
        document
          .querySelectorAll(".grid-navigation")
          .forEach((el) =>
            el.style.setProperty("display", "none", "important"),
          ),
      );
      await page.waitForTimeout(500);
      const hidden = await measure();
      console.log(
        JSON.stringify({ viewport: [width, height], hasTouch, before, hidden }),
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
