import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { summarizePlay } from "./latency-math.mjs";

test("uses first nonempty note batch and keeps worklet timing separate", () => {
  deepStrictEqual(summarizePlay({
    clicks: [100],
    messages: [{ at: 130, count: 0 }, { at: 145, count: 2, firstAudioTime: 4.2 }],
    modules: [{ url: "voice.js", start: 104, end: 119 }],
    resumes: [{ start: 101, end: 103 }],
  }), {
    gestureToFirstPostedNoteMs: 45,
    firstPostedAudioTime: 4.2,
    workletModuleMs: [{ url: "voice.js", durationMs: 15 }],
    resumeMs: [2],
  });
});

test("missing observations stay null instead of becoming zero latency", () => {
  deepStrictEqual(summarizePlay({
    clicks: [], messages: [], modules: [{ url: "voice.js", start: 4 }], resumes: [],
  }), {
    gestureToFirstPostedNoteMs: null,
    firstPostedAudioTime: null,
    workletModuleMs: [{ url: "voice.js", durationMs: null }],
    resumeMs: [],
  });
});
