import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1644, height: 1272 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5195/");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.locator(".mixer-page").waitFor();
  await page.evaluate(async () => {
    const s = await import("/src/state/store.ts");
    const id = s.docStore.getState().doc.lanes[0].id;
    for (
      let i = (s.docStore.getState().doc.lanes[0].fxChain?.length ?? 0) - 1;
      i >= 0;
      i--
    )
      s.removeFxDevice(id, i);
    for (const type of ["filter", "delay", "reverb"]) s.addFxDevice(id, type);
  });
  await page
    .locator(".mixer-strip")
    .first()
    .click({ position: { x: 3, y: 45 } });
  await page
    .locator('.fx-mod[data-device="delay"] .mixer-dial')
    .first()
    .press("ArrowUp");
  assert.equal(
    await page
      .locator('.fx-mod[data-device="delay"] input')
      .first()
      .inputValue(),
    "36",
  );
  const cutoff = page.locator('.fx-mod[data-device="filter"] input').first();
  await cutoff.fill("1200");
  await cutoff.press("Tab");
  assert.equal(await cutoff.inputValue(), "1200");
  const curve = await page.locator(".fx-mod .mixer-response").getAttribute("d");
  await page.getByRole("button", { name: "HP", exact: true }).click();
  assert.notEqual(
    await page.locator(".fx-mod .mixer-response").getAttribute("d"),
    curve,
  );
  await page.locator(".mixer-eq .mixer-band").nth(2).press("ArrowUp");
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Band gain", exact: true })
      .inputValue(),
    "0.1",
  );
  await page
    .locator(".mixer-strip")
    .nth(1)
    .click({ position: { x: 3, y: 45 } });
  assert.equal(
    await page.locator(".mixer-strip").nth(1).getAttribute("class"),
    "mixer-strip is-selected",
  );
  await page.locator(".mixer-strip").first().focus();
  await page.keyboard.press("Enter");
  const heights = await page
    .locator(".mixer-rack .fx-mod,.mixer-rack .mixer-device")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(
    heights.every((h) => h === 308),
    JSON.stringify(heights),
  );
  await page.getByRole("button", { name: "PLAY", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".mixer-spectrum")
      ?.getAttribute("d")
      ?.match(/,\d+\.\d+/g)
      ?.some((v) => v !== ",146.00"),
  );
  await page.getByRole("button", { name: "STOP", exact: true }).click();

  const dial = page.locator('.fx-mod[data-device="delay"] .mixer-dial').first();
  const box = await dial.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 20, {
    steps: 5,
  });
  await page.mouse.up();
  assert.ok(
    Number(
      await page
        .locator('.fx-mod[data-device="delay"] input')
        .first()
        .inputValue(),
    ) > 36,
  );
  const handle = page.locator(".mixer-eq .mixer-band").nth(2);
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 25, h.y + h.height / 2 - 12, {
    steps: 5,
  });
  await page.mouse.up();
  assert.ok(
    Number(
      await page
        .getByRole("spinbutton", { name: "Band frequency", exact: true })
        .inputValue(),
    ) > 350,
  );
  await page.getByRole("button", { name: "Bypass DELAY", exact: true }).click();
  assert.ok(
    await page
      .getByRole("button", { name: "Enable DELAY", exact: true })
      .count(),
  );
  await page.getByRole("button", { name: "Enable DELAY", exact: true }).click();
  await page
    .getByRole("button", { name: "Move DELAY module earlier", exact: true })
    .click();
  assert.equal(
    await page.locator(".fx-mod").first().getAttribute("data-device"),
    "delay",
  );
  await page
    .getByRole("button", { name: "Move DELAY module later", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove REVERB module", exact: true })
    .click();
  await page.getByRole("button", { name: "+ ADD FX", exact: true }).click();
  await page.getByRole("menuitem", { name: "REVERB", exact: true }).click();
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", { name: "Add EQ band", exact: true })
      .click();
  assert.equal(await page.locator(".mixer-eq-tabs button").count(), 8);
  assert.ok(
    await page
      .getByRole("button", { name: "Add EQ band", exact: true })
      .isDisabled(),
  );
  for (const type of [
    "highpass",
    "lowpass",
    "notch",
    "bandpass",
    "lowshelf",
    "highshelf",
    "peaking",
  ]) {
    await page
      .getByLabel("Selected band type", { exact: true })
      .selectOption(type);
    assert.equal(
      await page.getByLabel("Band gain", { exact: true }).isDisabled(),
      !["peaking", "lowshelf", "highshelf"].includes(type),
    );
    assert.equal(
      await page.getByLabel("Band q", { exact: true }).isDisabled(),
      ["lowshelf", "highshelf"].includes(type),
    );
  }
  await page.getByLabel("Band frequency", { exact: true }).fill("40");
  await page.getByLabel("Band frequency", { exact: true }).press("Tab");
  assert.equal(
    await page.getByLabel("Band frequency", { exact: true }).inputValue(),
    "40",
  );
  await page.getByLabel("Selected band enabled", { exact: true }).uncheck();
  await page.getByLabel("Selected band enabled", { exact: true }).check();
  const savedEq = await page.evaluate(
    async () =>
      (await import("/src/state/store.ts")).docStore.getState().doc.mixer,
  );
  assert.ok(savedEq);
  await page
    .getByRole("button", { name: "Remove selected EQ band", exact: true })
    .click();
  assert.equal(await page.locator(".mixer-eq-tabs button").count(), 7);
  await page.evaluate(async () => (await import("/src/state/store.ts")).undo());
  assert.equal(await page.locator(".mixer-eq-tabs button").count(), 8);
  for (let i = 0; i < 8; i++)
    await page
      .getByRole("button", { name: "Remove selected EQ band", exact: true })
      .click();
  assert.equal(await page.locator(".mixer-band").count(), 1); // Filter remains.
  assert.ok(
    await page
      .getByRole("button", { name: "Remove selected EQ band", exact: true })
      .isDisabled(),
  );
  await page.evaluate(async (mixer) => {
    const s = await import("/src/state/store.ts");
    s.loadDocument(
      JSON.parse(JSON.stringify({ ...s.docStore.getState().doc, mixer })),
    );
  }, savedEq);
  assert.equal(await page.locator(".mixer-eq-tabs button").count(), 8);
  await page.screenshot({
    path: ".impeccable/review/mixer-approved-desktop.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: ".impeccable/review/mixer-approved-1280.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".impeccable/review/mixer-approved-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator(".mixer-eq")
    .evaluate((el) => el.scrollIntoView({ inline: "start", block: "nearest" }));
  await page.screenshot({
    path: ".impeccable/review/mixer-eq-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1644, height: 1272 });
  await page.evaluate(async () =>
    (await import("/src/state/theme.ts")).setTheme("light"),
  );
  await page.screenshot({
    path: ".impeccable/review/mixer-approved-light.png",
    fullPage: true,
  });
  await page.evaluate(async () =>
    (await import("/src/state/theme.ts")).setTheme("dark"),
  );
  await page
    .getByRole("button", { name: "Master processing", exact: true })
    .click();
  for (const name of [
    "DRIVE",
    "CRUSH",
    "DELAY",
    "REVERB",
    "FILTER",
    "DRIVE",
    "DELAY",
    "FILTER",
  ]) {
    await page.getByRole("button", { name: "+ ADD FX", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  assert.equal(await page.locator(".fx-mod").count(), 8);
  const masterHeights = await page
    .locator(".mixer-rack .fx-mod,.mixer-rack .mixer-device")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(masterHeights.every((h) => h === 308));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".impeccable/review/mixer-approved-master.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      heights,
      errors,
      checks:
        "channel selection, exact values, keyboard dial, response, EQ handle, live spectrum, desktop/mobile overflow",
    }),
  );
} finally {
  await browser.close();
}
