/**
 * VZ-TH-1 unit tests — the audible-time offset queue: drain exactness
 * (events up to the 1.5 s horizon fire exactly when `now` crosses their
 * audibleAt, never before), ordering under same-tick + out-of-order
 * inserts, drain-side stale-drop (the R3 shared rule), clear-on-stop,
 * oldest-first capacity bound, backpressure-free ungated inserts, and the
 * pure-module fence (no clock reads, no Math.random — source-pinned,
 * VZ-MF-1 viz-preset-model.test.ts pattern).
 *
 * The clock is the test's fake: `drain(now)` takes the same audio-clock
 * seconds the frame loop will pass as `ctx.currentTime`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VIZ_OFFSET_QUEUE_CAPACITY,
  VIZ_STALE_GRACE_SECONDS,
  createOffsetQueue,
  shouldFireAtDrain,
} from "../src/viz/offsetQueue";
import type { VizNoteOn } from "../src/engine/session";

/** Minimal VizNoteOn factory — payload fields pass through untouched. */
function note(audibleAt: number, tag = 0): VizNoteOn {
  return { lane: "drums", pitch: 36 + (tag % 12), velocity: 0.5, audibleAt };
}

const SCHEDULE_AT = 10; // delivery (schedule) time, audio-clock seconds

describe("drain exactness — audible time, never early (VZ-TH-1)", () => {
  it.each([0.25, 0.5, 1.0, 1.5])(
    "lead %ss: drains exactly when now crosses audibleAt, never before",
    (lead) => {
      const q = createOffsetQueue();
      const audibleAt = SCHEDULE_AT + lead;
      q.insert(note(audibleAt));

      // Schedule-time probe: nothing leaks early (contract 1).
      expect(q.drain(SCHEDULE_AT)).toEqual([]);
      // One clock quantum before the crossing: still held, not fired.
      expect(q.drain(audibleAt - 1e-6)).toEqual([]);
      expect(q.size).toBe(1);
      // The exact crossing: fires.
      expect(q.drain(audibleAt)).toEqual([note(audibleAt)]);
      expect(q.size).toBe(0);
    },
  );

  it("frame-by-frame probing between schedule and audible time fires nothing, then fires once", () => {
    const q = createOffsetQueue();
    const audibleAt = SCHEDULE_AT + 1.5;
    q.insert(note(audibleAt));
    // 60 Hz frames from schedule time up to (not including) audibleAt.
    for (let f = 1; f / 60 < 1.5; f++) {
      expect(q.drain(SCHEDULE_AT + f / 60)).toEqual([]);
      expect(q.size).toBe(1);
    }
    expect(q.drain(audibleAt)).toEqual([note(audibleAt)]);
    expect(q.drain(audibleAt + 0.01)).toEqual([]); // fired exactly once
  });

  it("drained events are removed — repeated drains never re-fire", () => {
    const q = createOffsetQueue();
    q.insert(note(11.999)); // both within grace of the drain below
    q.insert(note(12));
    expect(q.drain(12)).toHaveLength(2);
    expect(q.drain(12)).toEqual([]);
    expect(q.drain(13)).toEqual([]);
  });

  it("payload fields pass through untouched (the frozen VizNoteOn shape)", () => {
    const q = createOffsetQueue();
    const hit: VizNoteOn = {
      lane: "chords",
      pitch: 60,
      velocity: 0.875,
      audibleAt: 100.25,
    };
    q.insert(hit);
    expect(q.drain(100.25)).toEqual([hit]);
  });
});

describe("ordering (VZ-TH-1)", () => {
  it("same-tick inserts drain in insertion order (FIFO among equal audibleAt)", () => {
    const q = createOffsetQueue();
    const a = { ...note(20), lane: "drums" as const };
    const b = { ...note(20), lane: "bass" as const };
    const c = { ...note(20), lane: "lead" as const };
    q.insert(a);
    q.insert(b);
    q.insert(c);
    expect(q.drain(20)).toEqual([a, b, c]);
  });

  it("out-of-order arrival drains in audibleAt order (late-scheduled earlier event first)", () => {
    const q = createOffsetQueue();
    const late = note(20.02); // inserted first, audible later (within grace)
    const early = note(20.0); // arrives after, audible earlier
    q.insert(late);
    q.insert(early);
    expect(q.drain(20.02)).toEqual([early, late]);
  });

  it("mixed: sorted by audibleAt with FIFO ties, within one grace window", () => {
    const q = createOffsetQueue();
    const a = note(11.0, 1);
    const b = note(10.99, 2);
    const c = note(11.0, 3);
    const d = note(10.98, 4);
    q.insert(a);
    q.insert(b);
    q.insert(c);
    q.insert(d);
    expect(q.drain(11.0)).toEqual([d, b, a, c]);
  });
});

describe("stale-drop at drain — the R3 shared rule (VZ-TH-1)", () => {
  it("the grace constant is pinned: 0.032 s = 2 frames @ 60 Hz", () => {
    expect(VIZ_STALE_GRACE_SECONDS).toBe(0.032);
  });

  it("within grace fires; just past grace drops; far past drops (table)", () => {
    const cases: { lag: number; fires: boolean }[] = [
      { lag: 0, fires: true },
      { lag: 0.001, fires: true },
      { lag: 0.031, fires: true }, // just inside the 32 ms grace
      { lag: 0.033, fires: false }, // just outside
      { lag: 0.5, fires: false },
      { lag: 1.5, fires: false }, // a whole horizon late
      { lag: 30, fires: false }, // hidden-tab scale
    ];
    for (const { lag, fires } of cases) {
      const q = createOffsetQueue();
      q.insert(note(100));
      expect(q.drain(100 + lag)).toEqual(fires ? [note(100)] : []);
    }
  });

  it("a stale backlog never bursts: only the fresh tail of a mixed drain fires", () => {
    const q = createOffsetQueue();
    const now = 100;
    // Stale spread (the hidden-return backlog shape)...
    for (let i = 60; i >= 1; i--) q.insert(note(now - i * 0.5, i));
    // ...plus two events due within this frame's grace.
    const fresh1 = note(now - 0.03, 90);
    const fresh2 = note(now - 0.01, 91);
    q.insert(fresh1);
    q.insert(fresh2);
    expect(q.drain(now)).toEqual([fresh1, fresh2]); // 60 stale dropped
    expect(q.size).toBe(0);
  });

  it("stale events are REMOVED when dropped — a later drain sees nothing", () => {
    const q = createOffsetQueue();
    q.insert(note(10));
    expect(q.drain(20)).toEqual([]); // dropped as stale
    expect(q.size).toBe(0);
    expect(q.drain(21)).toEqual([]);
  });

  it("the policy predicate shouldFireAtDrain is the exported single rule", () => {
    expect(shouldFireAtDrain(note(10), 10)).toBe(true); // exact crossing
    expect(shouldFireAtDrain(note(10), 10 - 1e-9)).toBe(false); // not yet
    expect(shouldFireAtDrain(note(10), Number.NaN)).toBe(false);
    expect(shouldFireAtDrain({ ...note(Number.NaN) }, 10)).toBe(false);
    expect(shouldFireAtDrain(note(10), Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("clear — stop/hide teardown seam (VZ-TH-1)", () => {
  it("clear empties pending and due events; nothing fires after", () => {
    const q = createOffsetQueue();
    q.insert(note(11));
    q.insert(note(12));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.drain(13)).toEqual([]); // clock runs past all audibleAt
  });

  it("the queue is reusable after clear (insert → drain works again)", () => {
    const q = createOffsetQueue();
    q.insert(note(11));
    q.clear();
    const next = note(12);
    q.insert(next);
    expect(q.drain(12)).toEqual([next]);
  });
});

describe("capacity bound — oldest-first (VZ-TH-1)", () => {
  it("default capacity is horizon-sized: 80 steady-state + headroom = 96", () => {
    const q = createOffsetQueue();
    expect(q.capacity).toBe(VIZ_OFFSET_QUEUE_CAPACITY);
    expect(VIZ_OFFSET_QUEUE_CAPACITY).toBe(96);
  });

  it("sustained insert without drain holds the newest 96, evicting oldest-first", () => {
    const q = createOffsetQueue();
    // 200 events spread over 2 s — well past the bound without a drain.
    for (let i = 0; i < 200; i++) q.insert(note(100 + i / 100, i));
    expect(q.size).toBe(96);
    // Retained = the LAST 96 (audibleAt 101.04 .. 101.99); the first 104
    // (the oldest / earliest audibleAt) were evicted. Fire each retained
    // event at its own exact crossing.
    const fired: number[] = [];
    for (let i = 104; i < 200; i++)
      fired.push(...q.drain(100 + i / 100).map((e) => e.audibleAt));
    expect(fired).toEqual(
      Array.from({ length: 96 }, (_, k) => 100 + (104 + k) / 100),
    );
    expect(q.size).toBe(0);
  });

  it("custom capacity 4 keeps the newest 4 of 6 close-together events", () => {
    const q = createOffsetQueue({ capacity: 4 });
    const times = [100.0, 100.008, 100.016, 100.024, 100.032, 100.04];
    for (const t of times) q.insert(note(t));
    expect(q.size).toBe(4);
    const due = q.drain(100.04); // within grace of all four retained
    expect(due.map((e) => e.audibleAt)).toEqual(times.slice(2));
  });

  it("eviction is oldest-first by AUDIBLE time, not insertion order", () => {
    const q = createOffsetQueue({ capacity: 2 });
    q.insert(note(50)); // inserted first, later audibleAt
    q.insert(note(40)); // inserted second, but OLDER audibleAt
    q.insert(note(60)); // overflows: evicts the 40 (head of the sorted queue)
    expect(q.size).toBe(2);
    expect(q.drain(50)).toEqual([note(50)]); // the 40 is gone for good
    expect(q.drain(60)).toEqual([note(60)]);
  });

  it("degenerate capacity options normalize to the default, never throw", () => {
    expect(createOffsetQueue({ capacity: 0 }).capacity).toBe(96);
    expect(createOffsetQueue({ capacity: -5 }).capacity).toBe(96);
    expect(createOffsetQueue({ capacity: Number.NaN }).capacity).toBe(96);
    expect(
      createOffsetQueue({ capacity: Number.POSITIVE_INFINITY }).capacity,
    ).toBe(96);
    expect(createOffsetQueue({ capacity: 2.9 }).capacity).toBe(2);
  });
});

describe("inserts are ungated + backpressure-free (VZ-TH-1)", () => {
  it("a past-due event is ACCEPTED at insert — firing is decided only at drain", () => {
    const q = createOffsetQueue();
    q.insert(note(9.99)); // audibleAt already behind the clock
    expect(q.size).toBe(1); // never gated, never refused
    expect(q.drain(10)).toEqual([note(9.99)]); // within grace → fires
  });

  it("non-finite audibleAt inserts are ignored without throwing", () => {
    const q = createOffsetQueue();
    q.insert(note(Number.NaN));
    q.insert(note(Number.POSITIVE_INFINITY));
    expect(q.size).toBe(0);
    expect(q.drain(10)).toEqual([]);
  });

  it("a non-finite drain clock parks the queue unchanged", () => {
    const q = createOffsetQueue();
    q.insert(note(11));
    expect(q.drain(Number.NaN)).toEqual([]);
    expect(q.drain(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(q.size).toBe(1); // nothing fired, nothing dropped
    expect(q.drain(11)).toEqual([note(11)]); // still firable afterwards
  });

  it("dense sustained insert+drain cycling loses nothing, stays in order and bounded", () => {
    const q = createOffsetQueue();
    const STEP = 0.01875; // 53⅓ events/s (16ths @ 200 BPM, 4 lanes)
    const N = 320; // ~6 s at the worst-case rate
    let nextInsert = 0;
    const fired: number[] = [];
    // 60 Hz drain loop; inserts admitted up to the 1.5 s horizon ahead.
    for (let f = 0; f < 420 && fired.length < N; f++) {
      const now = 10 + f / 60;
      while (nextInsert < N && 10 + nextInsert * STEP <= now + 1.5) {
        q.insert(note(10 + nextInsert * STEP, nextInsert));
        nextInsert++;
      }
      expect(q.size).toBeLessThanOrEqual(q.capacity); // bound holds mid-flight
      for (const e of q.drain(now)) fired.push(e.audibleAt);
    }
    // Every event fired, exactly once, in audibleAt order — no loss to
    // the bound, no burst, no reordering across the whole horizon cycle.
    expect(fired).toEqual(
      Array.from({ length: N }, (_, i) => 10 + i * STEP),
    );
  });
});

describe("module fence (VZ-TH-1 acceptance: pure source)", () => {
  const SOURCE = readFileSync("src/viz/offsetQueue.ts", "utf8");

  it("never reads a clock — no Date.now / performance.now / new Date()", () => {
    expect(SOURCE).not.toMatch(/Date\.now|performance\.now|new Date\s*\(/);
  });

  it("never calls Math.random (determinism contract)", () => {
    expect(SOURCE).not.toMatch(/Math\.random\s*\(/);
  });

  it("imports the engine ONLY as a type — zero runtime coupling", () => {
    expect(SOURCE).toMatch(
      /import type \{ VizNoteOn \} from "\.\.\/engine\/session"/,
    );
    expect(SOURCE).not.toMatch(/import\s+\{(?!\s*type)[^}]*\}\s*from/);
  });

  it("imports no DOM / Web Audio runtime surface", () => {
    expect(SOURCE).not.toMatch(/from\s+"[^"]*(document|context|transport)"/);
  });
});
