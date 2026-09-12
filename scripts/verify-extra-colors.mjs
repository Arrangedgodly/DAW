/* global document, getComputedStyle */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1296, height: 1272 },
  });
  await page.goto("http://127.0.0.1:5199");
  await page
    .getByRole("button", { name: "Instruments 5–8", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add instrument to track 5", exact: true })
    .click();
  await page
    .getByRole("button", { name: "extra1 track color", exact: true })
    .click();
  const swatch = page
    .getByRole("dialog", { name: "extra1 color palette" })
    .locator("[data-swatch]")
    .first();
  await swatch.click();
  const values = await page
    .locator('.instruments-page .lane-floor[data-lane="extra1"]')
    .evaluate((el) => ({
      hue: getComputedStyle(el).getPropertyValue("--lane-hue").trim(),
      selected: document.documentElement.style
        .getPropertyValue("--color-lane-extra1")
        .trim(),
    }));
  console.log(values);
  assert.equal(values.hue, values.selected);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".screen-meter-row").length === 5,
  );
  await page
    .getByRole("button", { name: "Instruments 5–8", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.instruments-page .lane-floor[data-lane="extra1"]')
        ?.classList.contains("instrument-empty") === false,
  );
  assert.equal(
    await page
      .locator('.instruments-page .lane-floor[data-lane="extra1"]')
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--lane-hue").trim(),
      ),
    values.selected,
  );
  assert.equal(await page.locator(".screen-meter-row").count(), 5);
  for (const n of [6, 7, 8])
    await page
      .getByRole("button", {
        name: "Add instrument to track " + n,
        exact: true,
      })
      .click();
  assert.equal(await page.locator(".screen-meter-row").count(), 8);
  await page.screenshot({
    path: "docs/dev/instruments-review/eight-track-colors-meters.png",
  });
  const geometry = await page.locator(".booth-screen").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll(".screen-meter-row")].every((m) => {
      const b = m.getBoundingClientRect();
      return b.top >= r.top && b.bottom <= r.bottom && b.right <= r.right;
    });
  });
  assert.ok(geometry, "All meter rows must fit the status display");
  await page
    .getByRole("button", { name: "Remove instrument 8", exact: true })
    .click();
  assert.equal(await page.locator(".screen-meter-row").count(), 7);
  console.log({ retainedAfterReload: true, metersAddedAndRemoved: true });
} finally {
  await browser.close();
}
