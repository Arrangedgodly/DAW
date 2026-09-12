/* global document, innerWidth, window */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1296, height: 900 },
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page.evaluate(async () => {
    window.vizProbe = (
      await import("/src/viz/compositionEngine.ts")
    ).activeCompositionEngines;
  });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
  await page.getByText("Built-in demos", { exact: true }).click();
  await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await page.getByRole("button", { name: "VIZ", exact: true }).click();
  assert.equal(await page.locator(".viz-lane-tabs button").count(), 8);
  await page
    .getByRole("button", { name: "Select extra4", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "extra4 visual effect", exact: true })
    .selectOption("weave");
  await page.waitForFunction(
    () => {
      const p = window.vizProbe()[0]?.probe();
      return (
        p &&
        ["extra1", "extra2", "extra3", "extra4"].every((id) =>
          Number.isFinite(p.activity[id].at),
        )
      );
    },
    {},
    { timeout: 22000 },
  );
  const activity = await page.evaluate(async () => {
    const { activeCompositionEngines } =
      await import("/src/viz/compositionEngine.ts");
    return activeCompositionEngines()[0].probe().activity;
  });

  await page.screenshot({
    path: "docs/dev/instruments-review/eight-lane-visualizer.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".viz-lane-tabs button").count(), 8);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "Select extra2", exact: true })
    .click();
  await page.screenshot({
    path: "docs/dev/instruments-review/eight-lane-visualizer-phone.png",
  });
  await page.setViewportSize({ width: 1296, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
  await page.getByText("Built-in demos", { exact: true }).click();
  await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
  await page.getByRole("button", { name: "VIZ", exact: true }).click();
  await page
    .getByRole("button", { name: "Select extra4", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "extra4 visual effect", exact: true })
      .inputValue(),
    "weave",
  );
  assert.deepEqual(errors, []);
  console.log({ activity, errors, persisted: true });
} finally {
  await browser.close();
}
