/* global document, requestAnimationFrame, performance */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  for (const scenario of [
    { name: "desktop", width: 1296, lane: "drums" },
    { name: "phone pitched", width: 390, lane: "extra1" },
    { name: "reduced motion", width: 390, lane: "extra1", reduced: true },
    { name: "virtual", width: 1296, lane: "drums", virtual: true },
  ]) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: 844 },
      reducedMotion: scenario.reduced ? "reduce" : "no-preference",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:5200");
    await page.getByRole("button", { name: "PROJECTS", exact: true }).click();
    await page.getByText("Built-in demos", { exact: true }).click();
    await page.getByRole("button", { name: /Glass Arcade 8 tracks/ }).click();
    if (scenario.lane === "extra1")
      await page.locator('[role="tab"][data-lane="extra1"]').click();
    if (scenario.virtual) {
      await page.evaluate(async () => {
        const { resizePattern } = await import("/src/state/store.ts");
        for (let i = 1; i <= 4; i++) resizePattern("drums", `drums-${i}`, 8);
      });
    }
    const selector = `main.stage:not([hidden]) [data-lane="${scenario.lane}"] ${scenario.virtual ? ".grid-hscroll" : ".lane-grid-scroll"}`;
    await page.waitForSelector(selector);
    await page.getByRole("button", { name: "PLAY", exact: true }).click();
    const result = await page.evaluate(
      async ({ selector, duration }) => {
        const samples = [];
        const start = performance.now();
        await new Promise((resolve) => {
          function sample() {
            const scroll = document.querySelector(selector);
            const head = scroll?.querySelector(".grid-playhead");
            if (head) {
              const label = parseFloat(head.style.left);
              const x =
                head.getBoundingClientRect().right -
                scroll.getBoundingClientRect().left -
                scroll.clientLeft;
              samples.push({
                visible: head.style.opacity !== "0",
                highlighted: !!scroll.querySelector(".is-col-active"),
                left: scroll.scrollLeft,
                max: scroll.scrollWidth - scroll.clientWidth,
                x,
                center: (scroll.clientWidth + label) / 2,
              });
            }
            if (performance.now() - start < duration)
              requestAnimationFrame(sample);
            else resolve();
          }
          requestAnimationFrame(sample);
        });
        const middle = samples.filter((s) => s.left > 2 && s.left < s.max - 2);
        return {
          sweepHidden: samples.every((s) => !s.visible),
          highlighted: samples.some((s) => s.highlighted),
          samples: samples.length,
          middle: middle.length,
          maxCenterError: Math.max(
            0,
            ...middle.map((s) => Math.abs(s.x - s.center)),
          ),
          atStart: samples.some((s) => s.left === 0 && s.x < s.center - 10),
          atEnd: samples.some(
            (s) => s.max > 0 && s.left >= s.max - 1 && s.x > s.center + 10,
          ),
          wrapped: samples.some(
            (s, i) => i > 0 && s.left === 0 && samples[i - 1].left > 2,
          ),
        };
      },
      { selector, duration: scenario.virtual ? 21000 : 5000 },
    );
    console.log(scenario.name, result);
    if (scenario.reduced) {
      assert.ok(
        result.sweepHidden && result.highlighted,
        "Reduced motion uses column highlights",
      );
      assert.ok(result.wrapped, "Reduced-motion paging follows and resets");
    } else {
      assert.ok(result.middle > 5, "Must sample centered scrolling");
      assert.ok(
        result.maxCenterError < 2,
        "Playhead must remain centered between scroll limits",
      );
      assert.ok(
        result.atStart && result.atEnd && result.wrapped,
        "Must travel at both edges and reset on loop",
      );
    }
    await page.getByRole("button", { name: "STOP", exact: true }).click();
    const grid = page.locator(selector);
    await grid.evaluate((el) => {
      el.scrollLeft = 100;
    });
    await page.waitForTimeout(150);
    assert.ok(
      Math.abs((await grid.evaluate((el) => el.scrollLeft)) - 100) < 2,
      "Stopped manual scrolling stays put",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
