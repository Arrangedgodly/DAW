/* global document, window, innerWidth */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const out = "docs/dev/pattern-builder";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const results = [];
let activePage;
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:5194/");
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    await page.waitForSelector(".lane-floor");
    await page
      .getByRole("status")
      .filter({ hasText: "BUILT-IN DEMO" })
      .first()
      .waitFor();
    if (name === "desktop")
      await page
        .getByRole("button", { name: "Song arrangement", exact: true })
        .click();
    else await page.locator(".phone-page-toggle").click();
    await page.locator(".stage-song").waitFor({ state: "visible" });
    const row = page.locator('.rail-row[data-lane="bass"]');
    const initial = await row.locator(".rail-tile").count();
    const originalName = await row.locator(".rail-tile-name").first().innerText();
    const originalBars = await row.locator(".rail-tile-bars").first().innerText();
    await row.locator(".rail-playback-trigger").first().click();
    const panel = page.getByRole("dialog", {
      name: "Playback for block 1",
      exact: true,
    });
    await panel.getByRole("button", { name: "Copy", exact: true }).click();
    await panel
      .getByRole("button", { name: "Paste after", exact: true })
      .click();
    assert.equal(await row.locator(".rail-tile").count(), initial + 1);
    assert.equal(await row.locator(".rail-tile-name").nth(1).innerText(), `${originalName.slice(0, 7)}+`);
    assert.equal(await row.locator(".rail-tile-bars").nth(1).innerText(), originalBars);
    await row.locator(".rail-playback-trigger").nth(1).click();
    const secondPanel = page.getByRole("dialog", {
      name: "Playback for block 2",
      exact: true,
    });
    await secondPanel
      .getByRole("button", { name: "Double ×2", exact: true })
      .click();
    assert.equal(await row.locator(".rail-tile-bars").first().innerText(), originalBars, "doubling the copy leaves the original unchanged");
    assert.equal(await row.locator(".rail-tile-bars").nth(1).innerText(), `${parseInt(originalBars) * 2}B`);
    await secondPanel
      .getByRole("combobox", { name: "Play for", exact: true })
      .selectOption("bars");
    await secondPanel.getByLabel("Number of bars", { exact: true }).fill("8");
    await secondPanel
      .getByRole("combobox", { name: "Then", exact: true })
      .selectOption("goto");
    await secondPanel
      .getByRole("combobox", { name: "Destination", exact: true })
      .selectOption("0");
    await secondPanel
      .getByRole("button", { name: "Apply playback", exact: true })
      .click();
    assert.match(
      await row.locator(".rail-playback-trigger").nth(1).innerText(),
      /8 bars.*Block 1/,
    );
    await row.locator(".rail-tile").first().focus();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    assert.equal(await row.locator(".rail-tile").count(), initial + 2);
    const bounds = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        headers: [...document.querySelectorAll(".section-header")].map(rect),
        rows: [...document.querySelectorAll(".rail-row")].map((row) =>
          [...row.querySelectorAll(".rail-cell")].map(rect),
        ),
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    assert.ok(
      bounds.width <= bounds.viewport + 1,
      "no page horizontal overflow",
    );
    for (const cells of bounds.rows)
      for (const [i, cell] of cells.entries())
        assert.ok(
          Math.abs(cell.x - bounds.headers[i].x) < 1,
          `column ${i} aligns: cell ${cell.x}, header ${bounds.headers[i].x}`,
        );
    await page.screenshot({
      path: `${out}/${name}-arrangement.png`,
      fullPage: true,
    });
    const arrangementA11y = await page.evaluate(async () => {
      const result = await window.axe.run(
        document.querySelector(".stage-song"),
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } },
      );
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((n) => n.target),
      }));
    });
    assert.deepEqual(arrangementA11y, [], "arrangement accessibility");
    await page
      .getByRole("button", { name: "Edit Section 1", exact: true })
      .click();
    await page.getByLabel("Section name", { exact: true }).fill("Verse");
    await page
      .getByRole("combobox", { name: "Progression", exact: true })
      .selectOption("next");
    await page.getByLabel("Play for bars", { exact: true }).fill("16");
    await page
      .getByRole("button", { name: "Save section", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Launch Verse", exact: true })
        .count(),
      1,
    );
    await row.locator(".rail-playback-trigger").first().click();
    await page.screenshot({
      path: `${out}/${name}-playback-panel.png`,
      fullPage: true,
    });
    const panelA11y = await page.evaluate(async () => {
      const result = await window.axe.run(
        document.querySelector(".block-playback-panel"),
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } },
      );
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((n) => n.target),
      }));
    });
    assert.deepEqual(panelA11y, [], "playback panel accessibility");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.evaluate(() => document.activeElement?.className),
      "rail-playback-trigger",
    );
    assert.deepEqual(errors, []);
    results.push({
      name,
      viewport: { width, height },
      bounds,
      errors,
      arrangementA11y,
      panelA11y,
      passed: true,
    });
    await context.close();
  }
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: `${out}/failure.png`, fullPage: true });
    console.error(
      (await activePage.locator("body").ariaSnapshot()).slice(-4500),
    );
  }
  throw error;
} finally {
  await browser.close();
}
await writeFile(
  `${out}/browser-verification.json`,
  JSON.stringify(results, null, 2),
);
console.log("Pattern builder journeys passed on desktop and phone.");
