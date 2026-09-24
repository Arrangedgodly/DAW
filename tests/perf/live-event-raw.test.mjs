import { test } from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { summarizeWindow } from "./live-event-math.mjs";

const raw = JSON.parse(readFileSync(new URL("../../docs/dev/live-event-headroom-samples.json", import.meta.url), "utf8"));

test("committed capture contains twelve ordered foreground windows with usable clocks", () => {
  strictEqual(raw.revision, "a292f3d733cd32e65fbb0dffb20afdd78686c6ed");
  strictEqual(raw.windows.length, 13);
  deepStrictEqual(raw.windows.slice(0, 12).map((window) => window.workload),
    [...Array(6).fill("welcome"), ...Array(6).fill("glass-arcade")]);
  strictEqual(raw.errors.length, 0);
  for (const window of raw.windows.slice(0, 12)) {
    const summary = summarizeWindow(window);
    strictEqual(window.visibility, "foreground");
    strictEqual(summary.errors, 0);
    ok(summary.refillCount > 0 && summary.events > 0);
    strictEqual(summary.batches, summary.loadedReplies);
    strictEqual(summary.latePosts, 0);
    strictEqual(summary.matureEventsWithoutWatermark, 0);
  }
});

test("hidden attempt is not counted as measured background timing", () => {
  const attempt = raw.windows[12];
  strictEqual(attempt.visibility, "hidden-attempt");
  strictEqual(summarizeWindow(attempt).observedHidden, false);
});
