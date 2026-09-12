/* global document, innerWidth, btoa */
import { Buffer } from "node:buffer";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
const out = "docs/dev/demo-review";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.BITBOUNCE_URL ?? "http://127.0.0.1:5199");
  await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
  await page.getByText("Built-in demos", { exact: true }).click();
  await page.screenshot({ path: out + "/desktop-picker.png" });
  await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
  const first = await page.evaluate(async () => {
    const { docStore } = await import("/src/state/store.ts");
    const { getActiveProjectId } = await import("/src/persist/boot.ts");
    return {
      id: getActiveProjectId(),
      name: docStore.getState().doc.name,
      lanes: docStore.getState().doc.lanes.length,
    };
  });
  assert.equal(first.name, "GLASS ARCADE");
  assert.equal(first.lanes, 8);
  assert.equal(first.id, null, "Untouched demo must not have a saved project id");
  await page
    .getByRole("button", { name: "Instruments 5–8", exact: true })
    .click();
  await page.screenshot({ path: out + "/glass-arcade.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
  await page.getByText("Built-in demos", { exact: true }).click();
  await page.screenshot({ path: out + "/phone-picker.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: /After Hours 8 tracks/ }).click();
  const saved = await page.evaluate(async () => {
    const { getActiveProjectId, getBootDb } =
      await import("/src/persist/boot.ts");
    const { listProjects } = await import("/src/persist/projectStore.ts");
    return {
      id: getActiveProjectId(),
      names: (await listProjects(getBootDb())).map((p) => p.name),
    };
  });
  assert.equal(saved.id, null);
  assert.deepEqual(saved.names, [], "Browsing demos must not create local copies");
  const edited = await page.evaluate(async () => {
    const { setLaneSoundId } = await import("/src/state/store.ts");
    const { getActiveProjectId, getAutosaveController, savedProjects } = await import("/src/persist/boot.ts");
    setLaneSoundId("extra1", "preset-bells-crystal");
    await getAutosaveController().flush();
    return { id: getActiveProjectId(), names: (await savedProjects()).map(p => p.name) };
  });
  assert.ok(edited.id);
  assert.deepEqual(edited.names, ["AFTER HOURS"]);
  for (const id of ["glass-arcade", "after-hours"]) {
    const result = await page.evaluate(async (id) => {
      const { createBuiltInDemo } =
        await import("/src/document/builtInDemos.ts");
      const { renderProjectToBuffer } = await import("/src/audio/render.ts");
      const { encodeWav16 } = await import("/src/audio/wav.ts");
      const doc = createBuiltInDemo(id);
      const rendered = await renderProjectToBuffer(doc);
      let peak = 0,
        sum = 0,
        bad = 0;
      for (const c of rendered.channels)
        for (const x of c) {
          peak = Math.max(peak, Math.abs(x));
          sum += x * x;
          if (!Number.isFinite(x)) bad++;
        }
      const bytes = encodeWav16(rendered.channels, rendered.sampleRate);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return {
        base64: btoa(binary),
        peak,
        rms: Math.sqrt(sum / (rendered.channels[0].length * 2)),
        bad,
        samples: rendered.loopSamples,
      };
    }, id);
    assert.equal(result.bad, 0);
    assert.ok(result.peak > 0.01 && result.peak < 1);
    await writeFile(
      out + "/" + id + ".wav",
      Buffer.from(result.base64, "base64"),
    );
    delete result.base64;
    console.log(id, result);
  }
  assert.deepEqual(errors, []);
  console.log({ saved, errors });
} finally {
  await browser.close();
}
