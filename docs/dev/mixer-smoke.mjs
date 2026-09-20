import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const url = process.argv[2] ?? "http://127.0.0.1:5194/";
page.on("pageerror", (error) => errors.push(error.message));
await mkdir(".impeccable/review", { recursive: true });
try {
  await page.goto(url);
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.locator(".mixer-page").waitFor();
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".mixer-meter")].some(
        (meter) => Number(meter.getAttribute("aria-valuenow")) > -59,
      ),
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Instruments 1–4", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "STOP", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  assert.equal(await page.locator(".lane-floor .lane-fx-wrap").count(), 0);
  assert.equal(
    await page.locator('.lane-floor button[aria-label^="FX chain"]').count(),
    0,
  );
  await page
    .getByRole("button", { name: "Master processing", exact: true })
    .click();
  for (const name of ["FILTER", "DELAY"]) {
    await page.getByRole("button", { name: "+ ADD FX", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  const rack = await page.locator(".mixer-rack").evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
    cards: [...el.querySelectorAll(".fx-mod, .mixer-device")].map((card) => {
      const r = card.getBoundingClientRect();
      return { width: r.width, top: r.top, left: r.left };
    }),
  }));
  assert.equal(rack.cards.length, 4);
  assert.ok(
    rack.cards.every(
      (card) => card.width <= 320 && Math.abs(card.top - rack.cards[0].top) < 1,
    ),
  );
  assert.ok(
    rack.cards.slice(1).every((card, i) => card.left > rack.cards[i].left),
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: ".impeccable/review/mixer-desktop.png",
    fullPage: true,
  });
  const overflowDesktop = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflowDesktop, false);
  await page
    .getByRole("button", { name: "Analyze arrangement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hear after", exact: true })
    .waitFor({ timeout: 60000 });
  const analysis = await page.locator(".mixer-status").innerText();
  if (
    await page
      .getByRole("button", { name: "Apply mix", exact: true })
      .isEnabled()
  ) {
    await page.getByRole("button", { name: "Hear after", exact: true }).click();
    await page
      .getByRole("button", { name: "Stop after", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Hear before", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop before", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Apply mix", exact: true }).click();
    await page
      .getByRole("button", { name: "Instruments 1–4", exact: true })
      .click();
    await page.getByRole("button", { name: "Mixer", exact: true }).click();
    await page
      .getByRole("button", { name: "Restore before Auto Mix", exact: true })
      .click();
    assert.match(await page.locator(".mixer-status").innerText(), /restored/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.app[data-stage="phone"]').waitFor();
  await page.screenshot({
    path: ".impeccable/review/mixer-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Instruments", exact: true }).click();
  await page.locator('.app[data-page="edit"]').waitFor();
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.locator('.app[data-page="mixer"]').waitFor();
  assert.deepEqual(errors, []);
  const tablet = await browser.newPage({
    viewport: { width: 900, height: 1000 },
    hasTouch: true,
  });
  await tablet.goto(url);
  await tablet.getByRole("button", { name: "Mixer", exact: true }).click();
  await tablet.locator(".mixer-page").waitFor();
  assert.equal(
    await tablet.evaluate(() => matchMedia("(pointer: coarse)").matches),
    true,
  );
  assert.equal(
    await tablet.locator(".mixer-channel-buttons button").count(),
    12,
  );
  const tabletTargetsFit = await tablet.evaluate(() =>
    [...document.querySelectorAll(".mixer-channel-buttons button")].every(
      (button) => {
        const bounds = button.getBoundingClientRect();
        const strip = button.closest(".mixer-strip").getBoundingClientRect();
        return (
          bounds.width >= 44 &&
          bounds.height >= 44 &&
          bounds.right <= strip.right &&
          bounds.left >= strip.left
        );
      },
    ),
  );
  assert.equal(tabletTargetsFit, true);
  await tablet.setViewportSize({
    width: 900,
    height: await tablet.evaluate(() => document.documentElement.scrollHeight),
  });
  await tablet.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".mixer-channel-buttons button"))
        .height === "44px",
  );
  const tabletGeometry = await tablet.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    stripWidth: document.querySelector(".mixer-strip").getBoundingClientRect()
      .width,
    buttonHeight: document
      .querySelector(".mixer-channel-buttons button")
      .getBoundingClientRect().height,
    grid: getComputedStyle(document.querySelector(".mixer-strips"))
      .gridAutoColumns,
    styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(
      (link) => link.href,
    ),
  }));
  assert.equal(tabletGeometry.coarse, true);
  assert.ok(tabletGeometry.stripWidth >= 176);
  await tablet.screenshot({
    path: ".impeccable/review/mixer-tablet.png",
    fullPage: false,
  });
  await tablet.close();
  const result = {
    analysis,
    overflowDesktop,
    overflowMobile: false,
    errors,
    tabletTargetsFit,
    tabletGeometry,
    checks: [
      "navigation",
      "live audio metering and playback across pages",
      "FX relocation",
      "auto analysis",
      "preview",
      "apply",
      "restore",
    ],
  };
  await writeFile(
    ".impeccable/review/mixer-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
