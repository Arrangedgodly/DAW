/**
 * VZ-HU-2 unit tests — reroll coalescing + preset-switch teardown: the
 * re-deal state machine behind the joy loop, node-driven with every
 * effect injected (the timer seam is a manual clock, the engine a
 * recorder). The REAL page journey — play → watch → reroll → watch — is
 * tests/browser/viz-joy-loop.test.tsx (in-page mount idiom, real
 * transport); this suite proves the mechanism:
 *
 * - COALESCING (the spam law): N rapid rerolls within the window produce
 *   EXACTLY ONE committed regeneration — last-wins, at most ONE armed
 *   timer at any moment, no queued backlog ever; a patient reroll commits
 *   one window after its click with a FRESH seed.
 * - DETERMINISM: every committed deal (reroll OR cycle) draws the next
 *   seed from the one seeded xorshift32 stream — same (stream seed,
 *   initial deal, request script) ⇒ same envelope sequence and deep-equal
 *   arrangements; the reported envelope re-deals the exact arrangement
 *   handed to the engine (seed ⇒ arrangement, the VZ-IM-3 contract).
 * - CYCLING: cycle(delta) commits immediately (wrapping both directions),
 *   tears down + mounts per committed switch, and SUPERSEDES a pending
 *   reroll (a mid-burst switch lands as the one and only deal).
 * - TEARDOWN/CONTAINMENT: a throwing listener never breaks a commit;
 *   dispose cancels a pending window (no setArrangement after exit),
 *   drops refs, stays idempotent; the module is Math.random/Date.now
 *   clean (fence, the preset-model precedent).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { xorshift32 } from "../src/audio/fx";
import {
  activeVizArrangementControllers,
  createVizArrangementController,
  nextRerollSeed,
  VIZ_REROLL_COALESCE_MS,
  VIZ_REROLL_STREAM_SEED,
  type VizArrangementController,
  type VizArrangementMount,
  type VizSchedule,
} from "../src/viz/arrangement";
import type { VizNodeEngineProbe } from "../src/viz/nodes";
import {
  arrangementEnvelope,
  generateArrangement,
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
  type VizArrangement,
  type VizArrangementEnvelope,
} from "../src/viz/presets";
import { defaultBootArrangement, VIZ_DEFAULT_SEED } from "../src/viz/nodes";

// ---------------------------------------------------------------------------
// Doubles: manual clock + recording engine
// ---------------------------------------------------------------------------

/** Manual clock: deterministic `schedule` + `advance` firing due timers in order. */
function manualClock(): {
  schedule: VizSchedule;
  advance(ms: number): void;
  armed(): number;
} {
  let now = 0;
  let nextId = 1;
  const timers = new Map<
    number,
    { at: number; fn: () => void; canceled: boolean }
  >();
  const schedule: VizSchedule = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, ms), fn, canceled: false });
    return () => {
      const t = timers.get(id);
      if (t) t.canceled = true;
    };
  };
  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      let due: { at: number; fn: () => void } | null = null;
      let dueKey = 0;
      for (const [key, t] of timers) {
        if (t.canceled || t.at > target) continue;
        if (due === null || t.at < due.at) {
          due = t;
          dueKey = key;
        }
      }
      if (due === null) break;
      now = due.at;
      timers.delete(dueKey);
      due.fn();
    }
    now = target;
  };
  const armed = (): number =>
    [...timers.values()].filter((t) => !t.canceled).length;
  return { schedule, advance, armed };
}

/** Recording engine: every setArrangement call captured in order. */
function recordingEngine(): {
  mount: VizArrangementMount;
  deals: VizArrangement[];
} {
  const deals: VizArrangement[] = [];
  return {
    deals,
    mount: {
      setArrangement: (a) => {
        deals.push(a);
      },
    },
  };
}

/** A booted rig: manual clock + recording engine + controller + teardown. */
function boot(opts?: {
  streamSeed?: number;
  initial?: VizArrangement;
}): {
  clock: ReturnType<typeof manualClock>;
  engine: { mount: VizArrangementMount; deals: VizArrangement[] };
  controller: VizArrangementController;
} {
  const clock = manualClock();
  const engine = recordingEngine();
  const controller = createVizArrangementController({
    engine: engine.mount,
    initial: opts?.initial ?? defaultBootArrangement(),
    ...(opts?.streamSeed !== undefined ? { streamSeed: opts.streamSeed } : {}),
    schedule: clock.schedule,
  });
  return { clock, engine, controller };
}

/** Spam `count` reroll requests at `gapMs` cadence, advancing the clock. */
function spam(
  rig: ReturnType<typeof boot>,
  count: number,
  gapMs: number,
): void {
  for (let i = 0; i < count; i++) {
    rig.controller.reroll();
    rig.clock.advance(gapMs);
  }
}

const W = VIZ_REROLL_COALESCE_MS;

// ---------------------------------------------------------------------------
// Boot state — the readable seam VZ-IM-3 inherits
// ---------------------------------------------------------------------------

describe("VZ-HU-2 boot state (the envelope seam)", () => {
  it("boots from the shared initial deal: envelope readable, ZERO engine re-deals, registry live", () => {
    const initial = defaultBootArrangement();
    const rig = boot({ initial });
    try {
      expect(rig.engine.deals).toEqual([]); // boot mounts, never re-deals
      expect(rig.controller.envelope()).toEqual(
        arrangementEnvelope(initial),
      );
      expect(rig.controller.probe()).toMatchObject({
        presetId: VIZ_DEFAULT_PRESET_ID,
        seed: VIZ_DEFAULT_SEED,
        pendingReroll: false,
        rerollRequests: 0,
        commits: 0,
        rerollCommits: 0,
        cycleCommits: 0,
        armedTimers: 0,
        engine: null, // recording engine exposes no probe
      });
      expect(rig.controller.arrangement()).toEqual(initial);
      expect(rig.controller.preset().id).toBe(VIZ_DEFAULT_PRESET_ID);
      expect(activeVizArrangementControllers()).toContain(rig.controller);
    } finally {
      rig.controller.dispose();
    }
  });

  it("passes the mounted engine's probe through (the bounded-node ledger seam)", () => {
    const snapshot: VizNodeEngineProbe = {
      live: 3,
      peakLive: 7,
      spawned: 9,
      evicted: 0,
      ignited: 4,
      sprites: 5,
      restLevel: 1,
      liveGain: 1,
    };
    const clock = manualClock();
    const mount: VizArrangementMount = {
      setArrangement: () => {},
      probe: () => snapshot,
    };
    const controller = createVizArrangementController({
      engine: mount,
      initial: defaultBootArrangement(),
      schedule: clock.schedule,
    });
    try {
      expect(controller.probe().engine).toEqual(snapshot);
    } finally {
      controller.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Reroll coalescing — the spam law
// ---------------------------------------------------------------------------

describe("VZ-HU-2 reroll coalescing (last-wins, one commit per burst)", () => {
  it("a single reroll: pending through the window, then EXACTLY one commit with a fresh seed", () => {
    const rig = boot();
    try {
      rig.controller.reroll();
      expect(rig.controller.probe()).toMatchObject({
        pendingReroll: true,
        commits: 0,
        armedTimers: 1,
      });
      rig.clock.advance(W - 1);
      expect(rig.engine.deals).toEqual([]); // not yet — the window holds
      rig.clock.advance(1);
      const probe = rig.controller.probe();
      expect(probe.commits).toBe(1);
      expect(probe.rerollCommits).toBe(1);
      expect(probe.pendingReroll).toBe(false);
      expect(probe.armedTimers).toBe(0);
      expect(rig.engine.deals.length).toBe(1);
      // Fresh seed: never the boot seed, same preset re-dealt.
      expect(probe.seed).not.toBe(VIZ_DEFAULT_SEED);
      expect(probe.presetId).toBe(VIZ_DEFAULT_PRESET_ID);
      // Seed ⇒ arrangement: the reported envelope re-deals the EXACT rig
      // the engine received (the VZ-IM-3 persistence contract).
      const preset = VIZ_PRESETS.find((p) => p.id === probe.presetId)!;
      expect(generateArrangement(preset, probe.seed)).toEqual(
        rig.engine.deals[0],
      );
    } finally {
      rig.controller.dispose();
    }
  });

  it("25 rapid rerolls within the window ⇒ exactly ONE committed regeneration, no backlog", () => {
    const rig = boot();
    try {
      spam(rig, 25, 40); // 40 ms gaps inside the 150 ms window — always re-armed
      expect(rig.controller.probe()).toMatchObject({
        pendingReroll: true,
        rerollRequests: 25,
        commits: 0,
      });
      expect(rig.clock.armed()).toBe(1); // ONE timer, never a queue
      rig.clock.advance(W);
      const probe = rig.controller.probe();
      expect(probe.commits).toBe(1);
      expect(probe.rerollCommits).toBe(1);
      expect(rig.engine.deals.length).toBe(1); // one setArrangement, one teardown
      expect(probe.armedTimers).toBe(0);
      // Long quiet tail: nothing further fires (no queued backlog).
      rig.clock.advance(10_000);
      expect(rig.controller.probe().commits).toBe(1);
      expect(rig.engine.deals.length).toBe(1);
    } finally {
      rig.controller.dispose();
    }
  });

  it("patient rerolls (gaps beyond the window) each commit a FRESH, DISTINCT seed", () => {
    const rig = boot();
    try {
      rig.controller.reroll();
      rig.clock.advance(W);
      rig.controller.reroll();
      rig.clock.advance(W);
      const probe = rig.controller.probe();
      expect(probe.commits).toBe(2); // fresh seed per committed click
      expect(rig.engine.deals.length).toBe(2);
      const [first, second] = rig.engine.deals;
      expect(first!.seed).not.toBe(VIZ_DEFAULT_SEED);
      expect(second!.seed).not.toBe(VIZ_DEFAULT_SEED);
      expect(second!.seed).not.toBe(first!.seed);
      expect(second).not.toEqual(first); // the re-deal is visibly different
      // Two teardown+mount cycles: each deal is the FULL swap.
      expect(rig.controller.arrangement()).toEqual(second);
    } finally {
      rig.controller.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism — the seed stream law
// ---------------------------------------------------------------------------

describe("VZ-HU-2 determinism (one seeded stream, reproducible joy loop)", () => {
  /** Drive a mixed script (the joy loop's control shape) and collect results. */
  function scriptedRun(streamSeed: number): {
    envelopes: VizArrangementEnvelope[];
    deals: VizArrangement[];
  } {
    const rig = boot({ streamSeed });
    const envelopes: VizArrangementEnvelope[] = [];
    rig.controller.subscribe((e) => envelopes.push({ ...e }));
    rig.controller.reroll();
    rig.clock.advance(W);
    spam(rig, 3, 20); // a burst mid-script
    rig.controller.cycle(1);
    rig.controller.reroll();
    rig.clock.advance(W);
    rig.controller.cycle(-1);
    const deals = [...rig.engine.deals];
    rig.controller.dispose();
    return { envelopes, deals };
  }

  it("same stream seed + same script ⇒ identical envelope sequence and deep-equal deals", () => {
    const a = scriptedRun(VIZ_REROLL_STREAM_SEED);
    const b = scriptedRun(VIZ_REROLL_STREAM_SEED);
    expect(b.envelopes).toEqual(a.envelopes);
    expect(b.deals).toEqual(a.deals);
    // The script commits 4 deals (reroll, cycle, reroll, cycle).
    expect(a.deals.length).toBe(4);
  });

  it("different stream seed ⇒ different deals (the stream is the source)", () => {
    const a = scriptedRun(VIZ_REROLL_STREAM_SEED);
    const c = scriptedRun(0x0badf00d);
    expect(c.deals).not.toEqual(a.deals);
    expect(c.deals[0]!.seed).not.toBe(a.deals[0]!.seed);
  });

  it("the first committed seed is the stream's own next draw (wiring pinned)", () => {
    const rand = xorshift32(VIZ_REROLL_STREAM_SEED);
    const expected = nextRerollSeed(rand, VIZ_DEFAULT_SEED);
    const rig = boot();
    try {
      rig.controller.reroll();
      rig.clock.advance(W);
      expect(rig.controller.probe().seed).toBe(expected);
    } finally {
      rig.controller.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Preset cycling — immediate committed switches
// ---------------------------------------------------------------------------

describe("VZ-HU-2 preset cycling (teardown + mount per committed switch)", () => {
  it("cycle(1)/cycle(-1) commit IMMEDIATELY (no window), wrapping both directions", () => {
    const rig = boot();
    try {
      rig.controller.cycle(1);
      let probe = rig.controller.probe();
      expect(probe.commits).toBe(1);
      expect(probe.cycleCommits).toBe(1);
      expect(probe.armedTimers).toBe(0); // synchronous — no timer armed
      expect(probe.presetId).toBe(VIZ_PRESETS[1]!.id);
      expect(rig.engine.deals.length).toBe(1); // teardown + mount happened
      rig.controller.cycle(-1);
      probe = rig.controller.probe();
      expect(probe.commits).toBe(2);
      expect(probe.presetId).toBe(VIZ_PRESETS[0]!.id);
      // Wrap backwards from the FIRST entry lands on the LAST.
      rig.controller.cycle(-1);
      expect(rig.controller.probe().presetId).toBe(
        VIZ_PRESETS[VIZ_PRESETS.length - 1]!.id,
      );
      // And wrap forward from the last returns to the first.
      rig.controller.cycle(1);
      expect(rig.controller.probe().presetId).toBe(VIZ_PRESETS[0]!.id);
      expect(rig.controller.probe().commits).toBe(4);
      expect(rig.engine.deals.length).toBe(4); // one teardown per commit
    } finally {
      rig.controller.dispose();
    }
  });

  it("each cycle draws a fresh seed; cycle(0) re-deals the current preset; degenerate deltas no-op", () => {
    const rig = boot();
    try {
      rig.controller.cycle(0);
      let probe = rig.controller.probe();
      expect(probe.commits).toBe(1);
      expect(probe.presetId).toBe(VIZ_DEFAULT_PRESET_ID);
      expect(probe.seed).not.toBe(VIZ_DEFAULT_SEED); // same rig, fresh deal
      const seedAfterZero = probe.seed;
      rig.controller.cycle(1.9); // fractional truncates
      probe = rig.controller.probe();
      expect(probe.presetId).toBe(VIZ_PRESETS[1]!.id);
      expect(probe.seed).not.toBe(seedAfterZero);
      const before = probe.commits;
      rig.controller.cycle(Number.NaN); // degenerate input: no deal, no throw
      expect(rig.controller.probe().commits).toBe(before);
    } finally {
      rig.controller.dispose();
    }
  });

  it("a switch MID-BURST supersedes the pending reroll: exactly ONE deal, the cycle's", () => {
    const rig = boot();
    try {
      spam(rig, 6, 25); // pending burst, uncommitted
      expect(rig.controller.probe().pendingReroll).toBe(true);
      rig.controller.cycle(1);
      let probe = rig.controller.probe();
      expect(probe.commits).toBe(1); // the cycle ONLY — pending died uncommitted
      expect(probe.cycleCommits).toBe(1);
      expect(probe.rerollCommits).toBe(0);
      expect(probe.pendingReroll).toBe(false);
      expect(probe.armedTimers).toBe(0);
      rig.clock.advance(5 * W);
      probe = rig.controller.probe();
      expect(probe.commits).toBe(1); // the canceled window never lands
      expect(rig.engine.deals.length).toBe(1);
      expect(rig.engine.deals[0]!.presetId).toBe(VIZ_PRESETS[1]!.id);
    } finally {
      rig.controller.dispose();
    }
  });

  it("a reroll AFTER a cycle re-deals the CURRENT (cycled-to) preset", () => {
    const rig = boot();
    try {
      rig.controller.cycle(1);
      rig.controller.reroll();
      rig.clock.advance(W);
      const probe = rig.controller.probe();
      expect(probe.commits).toBe(2);
      expect(probe.cycleCommits).toBe(1);
      expect(probe.rerollCommits).toBe(1);
      expect(probe.presetId).toBe(VIZ_PRESETS[1]!.id);
    } finally {
      rig.controller.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Listener seam + teardown
// ---------------------------------------------------------------------------

describe("VZ-HU-2 listener seam + dispose (containment, exit-while-arranging)", () => {
  it("one emission per COMMIT (spam collapses to one); throwing listener contained; unsubscribe stops", () => {
    const rig = boot();
    const received: VizArrangementEnvelope[] = [];
    try {
      rig.controller.subscribe(() => {
        throw new Error("listener blows up"); // must not break the commit
      });
      const stop = rig.controller.subscribe((e) => received.push({ ...e }));
      spam(rig, 12, 30);
      rig.clock.advance(W);
      expect(rig.controller.probe().commits).toBe(1); // commit survived
      expect(received.length).toBe(1); // coalesced: ONE emission
      expect(received[0]).toEqual(rig.controller.envelope());
      stop();
      rig.controller.reroll();
      rig.clock.advance(W);
      expect(rig.controller.probe().commits).toBe(2);
      expect(received.length).toBe(1); // unsubscribed — silent
    } finally {
      rig.controller.dispose();
    }
  });

  it("dispose cancels a pending window (no setArrangement after exit), drops refs, idempotent", () => {
    const rig = boot();
    try {
      spam(rig, 5, 20);
      expect(rig.controller.probe().pendingReroll).toBe(true);
      rig.controller.dispose();
      expect(rig.controller.probe()).toMatchObject({
        pendingReroll: false,
        armedTimers: 0,
        engine: null,
      });
      rig.clock.advance(10_000);
      expect(rig.engine.deals).toEqual([]); // the window died uncommitted
      expect(rig.controller.probe().commits).toBe(0);
      expect(rig.controller.arrangement()).toBeNull(); // refs dropped
      expect(activeVizArrangementControllers()).not.toContain(
        rig.controller,
      );
      // Post-dispose controls are no-ops; dispose is idempotent.
      rig.controller.reroll();
      rig.controller.cycle(1);
      rig.clock.advance(10_000);
      expect(rig.engine.deals).toEqual([]);
      rig.controller.dispose();
    } finally {
      rig.controller.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Pure seed math + fences
// ---------------------------------------------------------------------------

describe("nextRerollSeed (pure)", () => {
  it("skips the current seed and 0 (redraw), falls back to current+1 when the stream stalls", () => {
    const current = 1234;
    expect(nextRerollSeed(() => current, current)).toBe(current + 1);
    const seq = [0, current, 777];
    expect(nextRerollSeed(() => seq.shift() ?? 0, current)).toBe(777);
    expect(nextRerollSeed(() => 0, current)).toBe(current + 1);
  });

  it("a real xorshift32 stream never repeats within a long sweep and never re-deals the current seed", () => {
    const rand = xorshift32(0xabcdef);
    let current = 42;
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const next = nextRerollSeed(rand, current);
      expect(next).not.toBe(0);
      expect(next).not.toBe(current);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      current = next;
    }
  });
});

describe("arrangement module fence (grep-clean source, recorded constants)", () => {
  const SOURCE = readFileSync("src/viz/arrangement.ts", "utf8");

  it("never calls Math.random / Date.now — randomness only via the shared xorshift32", () => {
    expect(SOURCE).not.toMatch(/Math\.random\s*\(/);
    expect(SOURCE).not.toMatch(/Date\.now\s*\(/);
    expect(SOURCE).toMatch(
      /import\s+\{[^}]*xorshift32[^}]*\}\s+from\s+"\.\.\/audio\/fx"/,
    );
  });

  it("ships the recorded production decisions as pinned constants", () => {
    // 150 ms trailing window (perceptual immediacy vs spam collapse) and a
    // fixed non-zero stream boot — both RECORDED in the module's header.
    expect(VIZ_REROLL_COALESCE_MS).toBe(150);
    expect(VIZ_REROLL_STREAM_SEED).toBe(0x5eed1234);
    expect(VIZ_REROLL_STREAM_SEED).not.toBe(0);
  });
});
