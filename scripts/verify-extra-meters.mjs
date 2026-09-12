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
  assert.equal(await page.locator(".screen-meter-row").count(), 8);
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.screen-meter-row[data-lane="extra1"] .screen-meter-lit',
        )
        .getAnimations().length > 0,
    {},
    { timeout: 7000 },
  );
  console.log("Extra track meter receives live playback animation");
} finally {
  await browser.close();
}
