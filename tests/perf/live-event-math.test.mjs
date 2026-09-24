import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { percentile, summarizeWindow } from "./live-event-math.mjs";

test("nearest-rank percentile keeps absent samples null", () => {
  strictEqual(percentile([], 0.95), null);
  strictEqual(percentile([4, 1, 3, 2], 0.95), 4);
});

test("late, unconfirmed and hidden observations stay distinct", () => {
  const summary = summarizeWindow({ workload: "welcome", pass: 0,
    visibility: "hidden-attempt", end: { audioTime: 0.5, hidden: false }, errors: [],
    data: {
      posts: [{ lane: 0, wallMs: 10, audioTime: 0.2,
        events: [{ time: 0.1 }, { time: 0.3 }] }],
      replies: [{ lane: 0, type: "loaded", wallMs: 11 },
        { lane: 0, type: "consumed", wallMs: 20, untilTime: 0.1 }],
      refills: [{ wallMs: 10 }, { wallMs: 35 }, { wallMs: 165 }],
      visibility: [],
      contexts: [{ sampleRate: 44100 }],
    },
  });
  deepStrictEqual({ hidden: summary.observedHidden, late: summary.latePosts,
    unconfirmed: summary.matureEventsWithoutWatermark, longGaps: summary.refillGapsOverHorizon,
    loaded: summary.loadedReplies },
  { hidden: false, late: 1, unconfirmed: 1, longGaps: 1, loaded: 1 });
});

test("a watermark at the start of the event's render quantum confirms consumption", () => {
  const summary = summarizeWindow({ workload: "welcome", pass: 0,
    visibility: "foreground", end: { audioTime: 0.5 }, errors: [],
    data: {
      posts: [{ lane: 0, wallMs: 10, audioTime: 0.1, events: [{ time: 0.3 }] }],
      replies: [{ lane: 0, type: "consumed", wallMs: 20, untilTime: 0.298 }],
      refills: [], visibility: [], contexts: [{ sampleRate: 44100 }],
    },
  });
  strictEqual(summary.matureEventsWithoutWatermark, 0);
});
