import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { summarizeAndroidWindow } from "./android-live-math.mjs";

test("matches lane watermarks and separates gesture, refill and frame costs", () => {
  const sample = { workload: "glass-arcade", temperature: "fresh-page", pass: 1,
    end: { audioTime: 0.3 }, errors: [], data: {
      contexts: [{ sampleRate: 48000 }], gestures: [{ wallMs: 10 }],
      posts: [{ wallMs: 20, audioTime: 0.1, lane: 0, count: 1,
        events: [{ time: 0.2, type: "note-on" }] }],
      replies: [{ wallMs: 23, lane: 0, type: "loaded" },
        { wallMs: 29, lane: 0, type: "consumed", untilTime: 0.198 }],
      refills: [{ wallMs: 20 }, { wallMs: 45 }, { wallMs: 190 }],
      frames: [{ kind: "grid", callbackMs: 2 }, { kind: "visualizer", callbackMs: 4 }],
      longTaskSupported: true, longTasks: [{ durationMs: 55 }],
    } };
  const result = summarizeAndroidWindow(sample);
  deepStrictEqual([result.gestureToFirstPostMs, result.gestureToFirstLoadedReplyMs,
    result.gestureToFirstConsumedReplyMs, result.minimumSendLeadMs,
    result.matureEventsWithoutConsumedWatermark, result.refillMaximumGapMs,
    result.refillGapsBeyond120Ms, result.grid.p95Ms, result.visualizer.p95Ms,
    result.longTaskMaximumMs], [10, 13, 19, 100, 0, 145, 1, 2, 4, 55]);
});

test("missing observations stay null", () => {
  const result = summarizeAndroidWindow({ workload: "welcome", temperature: "repeat-play", pass: 1,
    end: { audioTime: null }, data: { posts: [], replies: [], refills: [], frames: [],
      gestures: [], longTaskSupported: false } });
  for (const key of ["gestureToFirstPostMs", "gestureToFirstLoadedReplyMs",
    "gestureToFirstConsumedReplyMs", "minimumSendLeadMs", "refillMaximumGapMs",
    "matureEventsWithoutConsumedWatermark", "longTasks", "longTaskMaximumMs"])
    strictEqual(result[key], null, key);
  strictEqual(result.events, 0);
  strictEqual(result.grid.p95Ms, null);
});
