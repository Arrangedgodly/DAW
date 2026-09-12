/* global document, innerWidth, setTimeout */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const output = "docs/dev/instruments-review";
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log(e.stack);
  });
  await page.goto(process.env.BITBOUNCE_URL ?? "http://127.0.0.1:5199");
  const bass = page.getByRole("combobox", {
    name: "BASS instrument preset",
    exact: true,
  });
  await bass.selectOption("preset-bells-crystal");
  assert.equal(await bass.inputValue(), "preset-bells-crystal");
  await page
    .getByRole("button", { name: "Next preset for BASS", exact: true })
    .click();
  assert.notEqual(await bass.inputValue(), "preset-bells-crystal");
  await page
    .getByRole("button", { name: "Previous preset for BASS", exact: true })
    .click();
  assert.equal(await bass.inputValue(), "preset-bells-crystal");
  await page.screenshot({ path: `${output}/desktop-presets.png` });
  await page
    .getByRole("button", { name: "Instruments 5–8", exact: true })
    .click();
  assert.equal(
    await page.locator(".instruments-page .instrument-empty").count(),
    4,
  );
  await page.screenshot({ path: output + "/desktop-empty-quadrants.png" });
  for (const n of [8, 6, 5, 7])
    await page
      .getByRole("button", {
        name: "Add instrument to track " + n,
        exact: true,
      })
      .click();
  assert.equal(
    await page.locator(".instruments-page .instrument-empty").count(),
    0,
  );
  assert.equal(await page.locator(".instruments-page .lane-floor").count(), 4);
  await page
    .locator('.instruments-page [data-lane="extra4"] .lane-name')
    .click();
  await page
    .getByRole("combobox", {
      name: "INSTRUMENT 8 instrument preset",
      exact: true,
    })
    .selectOption("preset-brass-horn");
  // Place a real note via the grid, then verify it reached the document.
  const cell = page
    .locator('.instruments-page [data-lane="extra4"] [role="gridcell"]')
    .first();
  await cell.click();
  const count = await page.evaluate(async () => {
    const { docStore } = await import("/src/state/store.ts");
    return docStore.getState().doc.patterns.extra4[0].notes.length;
  });
  assert.ok(count > 0, "Extra track grid must save notes");
  await page.screenshot({ path: `${output}/desktop-instruments.png` });
  await page
    .getByRole("button", { name: "Song arrangement", exact: true })
    .click();
  assert.equal(await page.locator(".rail-row").count(), 8);
  await page.screenshot({ path: `${output}/desktop-song.png` });
  // Exercise the actual eight-lane offline export and the live scheduling path.
  const audio = await page.evaluate(async () => {
    const { docStore, setLaneMix, addNote, removeInstrumentLane, undo } =
      await import("/src/state/store.ts");
    const { renderProjectToBuffer } = await import("/src/audio/render.ts");
    const { getSession } = await import("/src/engine/session.ts");
    for (let i = 1; i <= 4; i++) {
      addNote(`extra${i}`, `extra${i}-1`, { degree: 0, start: 0, length: 4 });
    }
    for (const lane of docStore.getState().doc.lanes)
      setLaneMix(lane.id, { mute: !lane.id.startsWith("extra") });
    const hits = new Set();
    const session = getSession();
    const unsubscribe = session.subscribeNoteOns((hit) => hits.add(hit.lane));
    await session.togglePlay();
    await new Promise((r) => setTimeout(r, 2400));
    await session.togglePlay();
    unsubscribe();
    const rendered = await renderProjectToBuffer(docStore.getState().doc);
    let peak = 0,
      nonFinite = 0;
    for (const c of rendered.channels)
      for (const x of c) {
        peak = Math.max(peak, Math.abs(x));
        if (!Number.isFinite(x)) nonFinite++;
      }
    removeInstrumentLane("extra2");
    if (session.getLaneCycleSteps("extra2") !== null)
      throw new Error("Removed lane still scheduled");
    await session.togglePlay();
    await session.togglePlay();
    undo();
    if (session.getLaneCycleSteps("extra2") === null)
      throw new Error("Undo did not restore playback");
    return { peak, nonFinite, hits: [...hits], samples: rendered.loopSamples };
  });
  assert.ok(audio.peak > 0.01);
  assert.equal(audio.nonFinite, 0);
  for (let i = 1; i <= 4; i++)
    assert.ok(audio.hits.includes(`extra${i}`), `Live notes from extra${i}`);
  await page
    .getByRole("button", { name: "Instruments 1–4", exact: true })
    .click();
  assert.equal(
    await page
      .locator('.lane-floor[data-lane="drums"]')
      .getAttribute("data-editing"),
    "true",
  );

  const navNames = await page
    .locator(".desktop-page-nav button")
    .allTextContents();
  assert.deepEqual(
    navNames.map((s) => s.trim()),
    ["Instruments 1–4", "Instruments 5–8", "Song arrangement"],
  );
  assert.equal(await page.locator(".lane-state").count(), 0);
  await page.setViewportSize({ width: 1293, height: 1272 });
  const headerRows = await page
    .locator("main.stage:not([hidden]) .lane-strip-compact")
    .evaluateAll((els) =>
      els.map((el) => ({
        height: el.getBoundingClientRect().height,
        rows: [...el.children].map((row) =>
          [...row.children].map((c) =>
            Math.round(c.getBoundingClientRect().top),
          ),
        ),
      })),
    );
  assert.ok(
    headerRows.every((h) => Math.abs(h.height - headerRows[0].height) < 2),
    JSON.stringify(headerRows),
  );
  await page.screenshot({ path: output + "/desktop-header-layout.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole("tab").count(), 8);
  assert.equal(
    await page
      .getByRole("button", { name: "Add new instrument", exact: true })
      .count(),
    0,
  );
  await page.getByRole("tab", { name: "Track 8", exact: true }).click();
  assert.equal(
    await page.locator("#lane-stage .lane-floor").getAttribute("data-lane"),
    "extra4",
  );
  await page.screenshot({ path: output + "/phone-instruments.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "Song arrangement", exact: true })
    .click();
  assert.equal(await page.locator(".rail-row").count(), 8);
  await page.screenshot({ path: output + "/phone-song.png" });
  await page.getByRole("button", { name: "Edit notes", exact: true }).click();
  assert.equal(
    await page.locator("#lane-stage .lane-floor").getAttribute("data-lane"),
    "extra4",
  );
  for (let n = 8; n >= 5; n--) {
    await page.getByRole("tab", { name: "Track " + n, exact: true }).click();
    await page
      .getByRole("button", { name: "Remove instrument " + n, exact: true })
      .click();
  }
  assert.equal(await page.getByRole("tab").count(), 4);
  await page.screenshot({ path: output + "/phone-add-instrument.png" });
  for (let n = 5; n <= 8; n++) {
    await page
      .getByRole("button", { name: "Add new instrument", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("tab", { name: "Track " + n, exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
  }
  await page.getByRole("tab", { name: "Track 8", exact: true }).focus();
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: "DRUMS", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("End");
  assert.equal(
    await page
      .getByRole("tab", { name: "Track 8", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(
    await page
      .locator('.desktop-page-nav [data-page="instruments"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.locator("#lane-stage .lane-floor").getAttribute("data-lane"),
    "extra4",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ audio, errors, headerRows, screenshots: output }),
  );
} finally {
  await browser.close();
}
