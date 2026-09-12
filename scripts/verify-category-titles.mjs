import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1296, height: 1272 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page
    .getByRole("button", { name: "Instruments 5–8", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add instrument to track 5", exact: true })
    .click();
  const header = page.locator(
    '.instruments-page [data-lane="extra1"] .lane-name',
  );
  assert.equal((await header.textContent()).trim(), "Bells");
  const preset = page.getByRole("combobox", {
    name: "INSTRUMENT 5 instrument preset",
    exact: true,
  });
  for (const [id, name] of [
    ["preset-brass-horn", "Brass"],
    ["preset-strings-zither", "Plucks"],
    ["preset-fx-wind", "FX"],
  ]) {
    await preset.selectOption(id);
    assert.equal((await header.textContent()).trim(), name);
    assert.equal(
      await page
        .locator('.screen-meter-row[data-lane="extra1"] .screen-meter-tag')
        .textContent(),
      name,
    );
  }
  await page
    .getByRole("button", { name: "Song arrangement", exact: true })
    .click();
  assert.equal(
    (
      await page
        .locator('.rail-row[data-lane="extra1"] .rail-lane-name')
        .textContent()
    ).trim(),
    "FX",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  await page.getByRole("tab", { name: "FX", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "INSTRUMENT 5 instrument preset",
      exact: true,
    })
    .selectOption("preset-strings-zither");
  assert.equal(
    await page
      .getByRole("tab", { name: "Plucks", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.screenshot({
    path: "docs/dev/instruments-review/category-track-titles.png",
  });
  await page.waitForTimeout(1200);
  await page.reload();
  await page
    .getByRole("tab", { name: "Plucks", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Category titles update across headers, meter bank, Song and mobile tabs; retained on reload.",
  );
} finally {
  await browser.close();
}
