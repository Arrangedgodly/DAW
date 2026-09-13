/* global document, window */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = "docs/dev/r4-instrument-names";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 768,
    });
    await page.goto("http://127.0.0.1:4194");
    await page.locator(".lane-floor").first().waitFor();
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    await page.getByText("Built-in demos", { exact: true }).click();
    await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    for (const [lane, duplicate, track] of [
      ["lead", "bass", 4],
      ["extra4", "extra1", 8],
    ]) {
      if (width >= 768) {
        await page
          .getByRole("button", {
            name: lane === "lead" ? "Instruments 1–4" : "Instruments 5–8",
            exact: true,
          })
          .click();
        await page
          .locator(`.lane-floor[data-lane="${lane}"] .lane-name`)
          .click();
      } else await page.locator(`[role=tab][data-lane="${lane}"]`).click();
      const floor = page.locator(`.lane-floor[data-lane="${lane}"]`);
      const preset = floor.locator("select.head-sound-select");
      const keys = await preset
        .locator('optgroup[label="Keys"] option')
        .first()
        .getAttribute("value");
      const bells = await preset
        .locator('option[value="preset-bells-vibes"]')
        .getAttribute("value");
      await preset.selectOption(bells);
      await page.waitForTimeout(200);
      await page.evaluate(
        async ({ lane, duplicate, keys }) => {
          const { setLaneSoundId } = await import("/src/state/store.ts");
          setLaneSoundId(duplicate, keys);
          window.__r4Grid = document.querySelector(
            `.lane-floor[data-lane="${lane}"] [role=grid]`,
          );
          window.__r4Cell = window.__r4Grid.querySelector("[role=gridcell]");
          const { docStore } = await import("/src/state/store.ts");
          window.__r4Patterns = docStore.getState().doc.patterns;
          window.__r4Writes = 0;
          window.__r4Unsub = docStore.subscribe((s, p) => {
            if (s.doc !== p.doc) window.__r4Writes++;
          });
        },
        { lane, duplicate, keys },
      );
      for (const [id, name] of [
        [keys, "Keys"],
        [bells, "Bells"],
        [keys, "Keys"],
      ]) {
        await preset.selectOption(id);
        await page.waitForTimeout(200);
        const prefix = `${name}, track ${track}`;
        assert.equal(await floor.getAttribute("aria-label"), prefix);
        assert.equal(await floor.locator(".lane-name").textContent(), name);
        assert.ok(
          (
            await floor.locator("[role=grid]").getAttribute("aria-label")
          ).startsWith(prefix + " grid"),
        );
        assert.equal(
          await floor
            .getByRole("button", { name: `Mute ${prefix}`, exact: true })
            .count(),
          1,
        );
        assert.equal(
          await floor
            .getByRole("button", { name: `Solo ${prefix}`, exact: true })
            .count(),
          1,
        );
        assert.equal(
          await preset.getAttribute("aria-label"),
          `${prefix} instrument preset`,
        );
        assert.ok(
          await page.evaluate(
            ({ lane }) =>
              window.__r4Grid ===
              document.querySelector(
                `.lane-floor[data-lane="${lane}"] [role=grid]`,
              ),
            { lane },
          ),
          "grid instance preserved",
        );
      }
      const proof = await page.evaluate(
        async ({ lane, track }) => {
          const { docStore } = await import("/src/state/store.ts");
          window.__r4Unsub();
          const floor = document.querySelector(
            `.lane-floor[data-lane="${lane}"]`,
          );
          return {
            writes: window.__r4Writes,
            patternsSame:
              window.__r4Patterns === docStore.getState().doc.patterns,
            gridName: floor
              .querySelector("[role=grid]")
              .getAttribute("aria-label"),
            labels: [...floor.querySelectorAll("[aria-label]")].map((e) =>
              e.getAttribute("aria-label"),
            ),
            tabStops: floor.querySelectorAll('[role=gridcell][tabindex="0"]')
              .length,
            stableId: floor.dataset.lane,
            track,
          };
        },
        { lane, track },
      );
      assert.equal(proof.writes, 3);
      assert.ok(proof.patternsSame);
      assert.equal(proof.tabStops, 1);
      if (width < 768) {
        assert.equal(
          await page
            .getByRole("tab", { name: `Keys, track ${track}`, exact: true })
            .count(),
          1,
        );
        assert.equal(
          await page
            .getByRole("tab", {
              name: `Keys, track ${lane === "lead" ? 2 : 5}`,
              exact: true,
            })
            .count(),
          1,
        );
        await page
          .getByRole("button", { name: "OPTIONS", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", {
              name: `Transpose octave up for Keys, track ${track}`,
              exact: true,
            })
            .count(),
          1,
        );
        await page.keyboard.press("Escape");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(350);
      await page.screenshot({
        path: `${out}/final-${width}x${height}-${lane}.png`,
        fullPage: true,
      });
      await writeFile(
        `${out}/ax-${width}-${lane}.txt`,
        await floor.ariaSnapshot(),
      );
      results.push({ width, height, lane, duplicate, ...proof });
    }
    if (width >= 768) {
      await page
        .getByRole("button", { name: "Song arrangement", exact: true })
        .click();
      assert.ok(
        (await page
          .getByRole("group", { name: /Keys, track 4 song chain/ })
          .count()) > 0,
      );
      await writeFile(
        `${out}/song-ax.txt`,
        await page.locator(".stage-song").ariaSnapshot(),
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}/evidence.json`, JSON.stringify(results, null, 2));
}
console.log(`${results.length} dynamic naming states passed`);
