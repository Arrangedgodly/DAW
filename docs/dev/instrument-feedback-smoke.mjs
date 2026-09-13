import { chromium } from "../../node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("./instrument-feedback-review/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4176/");
    await page.locator(".lane-floor").first().waitFor();
    await page.waitForFunction(
      async () =>
        Boolean((await import("/src/persist/boot.ts")).getAutosaveController()),
      undefined,
      { timeout: 10000 },
    );
    await page.evaluate(async () => {
      const store = await import("/src/state/store.ts");
      const selection = await import("/src/state/selection.ts");
      const { createAgentTools } = await import("/src/webmcp/tools.ts");
      store.loadDocument(store.createFreshProjectDocument());
      const agent = createAgentTools(() => true);
      const call = (name, args) =>
        agent.tools
          .find((t) => t.name === `bitbounce_${name}`)
          .execute({ revision: agent.revision(), ...args });
      for (const [lane, soundId, degree] of [
        ["bass", "preset-bass-13", 21],
        ["chords", "preset-chords-4", -7],
        ["lead", "preset-chords-1", 14],
      ]) {
        await call("set_lane", { lane, soundId });
        const patternId = store.docStore.getState().doc.patterns[lane][0].id;
        await call("set_pattern", {
          lane,
          patternId,
          notes: [0, 4, 8, 12].map((start) => ({ degree, start, length: 2 })),
        });
        selection.setRegisterWindowStart(lane, 0);
      }
      const { DRUM_PIECES } = await import("/src/document/schema.ts");
      await call("set_pattern", {
        lane: "drums",
        patternId: store.docStore.getState().doc.patterns.drums[0].id,
        drumRows: Object.fromEntries(
          DRUM_PIECES.map((piece, i) => [
            piece,
            Array.from({ length: 16 }, (_, step) => step === i),
          ]),
        ),
      });
      agent.dispose();
      const { getSession } = await import("/src/engine/session.ts");
      await getSession().togglePlay();
    });
    await page.waitForTimeout(400);
    const inspect = () =>
      page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        lanes: [...document.querySelectorAll(".lane-floor")].map((lane) => {
          const pane = lane.querySelector(".lane-grid-scroll");
          const bounds = pane?.getBoundingClientRect();
          const notes = [...lane.querySelectorAll(".note-run")];
          return {
            id: lane.dataset.lane,
            title: lane.querySelector(".lane-name")?.textContent,
            rows: lane.querySelectorAll(".row-label").length,
            visibleLabels: [...lane.querySelectorAll(".row-label")]
              .filter((n) => {
                const r = n.getBoundingClientRect();
                return bounds && r.bottom > bounds.top && r.top < bounds.bottom;
              })
              .map((n) => n.textContent),
            visibleNotes: notes.filter((n) => {
              const r = n.getBoundingClientRect();
              return (
                bounds &&
                r.height > 0 &&
                r.bottom > bounds.top &&
                r.top < bounds.bottom
              );
            }).length,
            gridHeight: bounds?.height,
          };
        }),
      }));
    await page.getByRole("button", { name: "STOP", exact: true }).waitFor();
    const state = await inspect();
    if (
      viewport.width > 500 &&
      state.lanes.some((l) => l.id !== "drums" && !l.visibleNotes)
    )
      throw new Error("Playback left a pitched lane's notes hidden");
    if (state.documentWidth > viewport.width)
      throw new Error("Horizontal page overflow");
    if (viewport.width > 500 && state.documentHeight > viewport.height + 2)
      throw new Error(`Desktop page overflow: ${JSON.stringify(state)}`);
    results.push({ viewport, state, errors });
    await page.screenshot({
      path: fileURLToPath(new URL(`playback-${viewport.width}.png`, output)),
      fullPage: true,
    });
    const nextDrums = page.getByRole("button", {
      name: "Next drum sounds",
      exact: true,
    });
    for (let i = 0; i < 3 && (await nextDrums.isEnabled()); i++) {
      await nextDrums.click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(150);
    const secondBank = await inspect();
    if (
      !secondBank.lanes
        .find((l) => l.id === "drums")
        ?.visibleLabels.includes("PERC")
    )
      throw new Error("Last drum sound is not reachable");
    results.push({ viewport, secondBank });
    if (viewport.width < 500) {
      await page.evaluate(async () =>
        (await import("/src/state/selection.ts")).selectLane("bass"),
      );
      await page.waitForTimeout(200);
      results.push({ viewport, bass: await inspect() });
      await page.screenshot({
        path: fileURLToPath(new URL("bass-phone.png", output)),
        fullPage: true,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  new URL("results.json", output),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
