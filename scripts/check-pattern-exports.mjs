/* global window, document */
import { chromium } from "playwright";
import { parseMidi } from "midi-file";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const out = process.env.BITBOUNCE_ARTIFACT_DIR ?? "docs/dev/pattern-builder";
const baseUrl = process.env.BITBOUNCE_URL ?? "http://127.0.0.1:5194/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.locator(".lane-floor").first().waitFor();
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
    const row = page.locator('.rail-row[data-lane="bass"]');
    await row.locator(".rail-playback-trigger").first().click();
    const panel = page.getByRole("dialog", {
      name: "Playback for block 1",
      exact: true,
    });
    const button = panel.getByRole("button", {
      name: "Export pattern MIDI",
      exact: true,
    });
    await button.focus();
    const pending = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await pending;
    const midi = parseMidi(await readFile(await download.path()));
    assert.equal(midi.header.numTracks, 2);
    assert.equal(
      midi.tracks[1].reduce((sum, e) => sum + e.deltaTime, 0),
      parseInt(await row.locator(".rail-tile-bars").first().innerText()) * 1920,
    );
    assert(midi.tracks[1].some((e) => e.type === "noteOn"));
    await page.screenshot({
      path: `${out}/${name}-pattern-export.png`,
      fullPage: true,
    });
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    const axe = await page.evaluate(async () =>
      window.axe.run(document.querySelector(".block-playback-panel"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      }),
    );
    assert.deepEqual(axe.violations, []);
    await page.keyboard.press("Escape");
    await row.locator(".rail-tools-trigger").click();
    await row
      .locator(".rail-tools-menu .pattern-midi-export")
      .waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    results.push({
      viewport: name,
      filename: download.suggestedFilename(),
      tracks: midi.header.numTracks,
      notes: midi.tracks[1].filter((e) => e.type === "noteOn").length,
      axeViolations: axe.violations.length,
      errors,
    });
    await context.close();
  }
  await writeFile(
    `${out}/export-verification.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
