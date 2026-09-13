/* global document, window */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = "docs/dev/r3-phone-help";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height, theme, lane] of [
    [390, 844, "dark", "lead"],
    [390, 667, "light", "extra4"],
    [1280, 800, "dark", "lead"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 768,
    });
    await page.goto("http://127.0.0.1:4193");
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
    if (width >= 768) {
      await page.locator('[data-lane="lead"] .lane-name').click();
      await page.waitForTimeout(400);
      assert.equal(await page.locator(".phone-help-toggle").count(), 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollHeight),
        height,
      );
      await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
      results.push({ width, height, desktopUnchanged: true });
      await page.close();
      continue;
    }
    await page.locator(`[role="tab"][data-lane="${lane}"]`).click();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const { docStore } = await import("/src/state/store.ts");
      window.__r3Doc = docStore.getState().doc;
    });
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    const help = page.getByRole("button", { name: "Help", exact: true });
    assert.equal(await help.getAttribute("aria-expanded"), "false");
    assert.ok((await help.boundingBox()).height >= 44);
    await help.click();
    assert.equal(
      await page
        .getByRole("button", { name: "Close help", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    const topics = page.getByLabel("Help topic", { exact: true });
    assert.ok((await topics.boundingBox()).height >= 44);
    const ids = await topics
      .locator("option")
      .evaluateAll((options) => options.map((o) => o.value));
    const topicProof = [];
    for (const id of ids) {
      await topics.selectOption(id);
      const text = await page
        .getByRole("region", { name: "Help explanation", exact: true })
        .innerText();
      const source = await page.evaluate(async (id) => {
        const { getHelp } = await import("/src/help/registry.ts");
        const entry = getHelp(id);
        if (!entry) throw new Error(`Missing help: ${id}`);
        return entry.text;
      }, id);
      assert.equal(text, source);
      assert.ok(text.length > 35);
      topicProof.push({ id, length: text.length });
    }
    await topics.selectOption("fx.device.filter");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${out}/help-${width}x${height}-${theme}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close help", exact: true }).click();
    assert.equal(
      await page
        .getByRole("region", { name: "Help explanation", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "Help",
    );
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await topics.selectOption(`lane.${lane}.regshift`);
    await topics.focus();
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Help", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "OPTIONS", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "OPTIONS", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "OPTIONS",
    );
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page
      .locator(".phone-options-backdrop")
      .click({ position: { x: 2, y: height - 70 } });
    assert.equal(
      await page
        .getByRole("button", { name: "OPTIONS", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page.evaluate(async () => {
        const { docStore } = await import("/src/state/store.ts");
        return window.__r3Doc === docStore.getState().doc;
      }),
      true,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await topics.selectOption("grid.draw");
    await page.evaluate(() => window.scrollTo(0, 0));
    const geometry = await page.evaluate(() => {
      const panel = document
        .querySelector("#phone-help")
        .getBoundingClientRect();
      const copy = document.querySelector(".phone-help-copy");
      return {
        panelBottom: panel.bottom,
        copyHeight: copy.clientHeight,
        copyScrollHeight: copy.scrollHeight,
        width: document.documentElement.scrollWidth,
      };
    });
    assert.ok(geometry.panelBottom <= height - 36);
    await page.screenshot({
      path: `${out}/draw-${width}x${height}-${theme}.png`,
      fullPage: true,
    });
    results.push({
      width,
      height,
      theme,
      lane,
      topicProof,
      geometry,
      documentUnchanged: true,
      escapeAndOutside: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}/evidence.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
