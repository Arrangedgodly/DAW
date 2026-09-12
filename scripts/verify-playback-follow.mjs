/* global document */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  for (const scenario of [
    {
      name: "desktop drums",
      width: 1296,
      height: 1272,
      lane: "drums",
      extra: false,
      reduced: false,
    },
    {
      name: "desktop extra",
      width: 1296,
      height: 1272,
      lane: "extra1",
      extra: true,
      reduced: false,
    },
    {
      name: "phone extra reduced motion",
      width: 390,
      height: 844,
      lane: "extra1",
      extra: true,
      reduced: true,
    },
  ]) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      reducedMotion: scenario.reduced ? "reduce" : "no-preference",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5199");
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    await page.getByText("Built-in demos", { exact: true }).click();
    await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
    if (scenario.extra)
      await page
        .getByRole(scenario.width < 700 ? "tab" : "button", {
          name: scenario.width < 700 ? "Track 5" : "Instruments 5–8",
          exact: true,
        })
        .click();
    const selector = `main.stage:not([hidden]) [data-lane="${scenario.lane}"] .lane-grid-scroll`;
    const grid = page.locator(selector);
    await page.waitForFunction((selector) => {
      const el = document.querySelector(selector);
      return el && el.scrollWidth > el.clientWidth;
    }, selector);
    const before = await grid.evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
      width: el.clientWidth,
      total: el.scrollWidth,
    }));
    await page.getByRole("button", { name: "PLAY", exact: true }).click();
    await page.waitForFunction(
      (selector) => document.querySelector(selector).scrollLeft > 0,
      selector,
      { timeout: 7000 },
    );
    const advanced = await grid.evaluate((el) => el.scrollLeft);
    await page.waitForFunction(
      (selector) => document.querySelector(selector).scrollLeft === 0,
      selector,
      { timeout: 7000 },
    );

    await page.getByRole("button", { name: "STOP", exact: true }).click();
    await grid.evaluate((el) => {
      el.scrollLeft = 100;
    });
    await page.waitForTimeout(250);
    assert.ok(
      Math.abs((await grid.evaluate((el) => el.scrollLeft)) - 100) < 2,
      "Stopped grid must allow manual scroll",
    );
    assert.deepEqual(errors, []);
    console.log({ scenario: scenario.name, before, advanced, looped: true });
    await page.close();
  }
} finally {
  await browser.close();
}
