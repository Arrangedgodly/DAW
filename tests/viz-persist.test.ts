/**
 * VZ-IM-3 unit tests — the viz memory store + session state: last-preset +
 * last-seed in ONE versioned localStorage key, with the silent fallback law
 * proven at every failure mode (plan.md §"VZ-IM-3" acceptance):
 *
 * - ROUND-TRIP on good storage: writeVizPrefs → readVizPrefs deep-equal,
 *   exact key, exact three-field JSON shape.
 * - FALLBACK SILENTLY: corrupt JSON, wrong shapes, unknown FUTURE version,
 *   unknown presetId, degenerate seeds, throwing getItem, throwing setItem
 *   (quota), absent storage — every path returns defaults/no-throw.
 * - WRITE TIMING (no amplification): restore NEVER writes; pending reroll
 *   requests NEVER write (integration with the real controller + manual
 *   clock: a 10-request burst = 0 writes pre-commit, exactly 1 at the
 *   coalesced commit); boot with no memory stays keyless.
 * - SESSION STATE: restore-once semantics (later storages cannot resurrect
 *   a stale envelope over the in-session truth), commit updates the signal
 *   even when the write fails (in-session truth survives quota), the boot
 *   helper re-deals the restored envelope exactly, unknown presetId falls
 *   back to the FIRST library preset.
 * - FENCES: the one versioned product-namespaced key; no Math.random /
 *   Date.now; never docStore/schema (two-tier law); key isolation (writes
 *   touch nothing but the viz key).
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeVizArrangementControllers,
  createVizArrangementController,
  VIZ_REROLL_COALESCE_MS,
  type VizSchedule,
} from "../src/viz/arrangement";
import { defaultBootArrangement, VIZ_DEFAULT_SEED } from "../src/viz/nodes";
import {
  VIZ_DEFAULT_PRESET_ID,
  VIZ_PRESETS,
  generateArrangement,
  type VizArrangement,
  type VizArrangementEnvelope,
} from "../src/viz/presets";
import {
  clearVizPrefs,
  readVizPrefs,
  VIZ_PREFS_STORAGE_KEY,
  writeVizPrefs,
  type VizPrefsStorage,
} from "../src/viz/persist";
import {
  bootVizArrangementFromPrefs,
  commitVizEnvelope,
  defaultVizPrefsEnvelope,
  resetVizPrefsForTests,
  restoreVizPrefs,
  vizPrefs,
} from "../src/viz/state";

// ---------------------------------------------------------------------------
// Storage doubles (the injectable seam — node has no DOM by law)
// ---------------------------------------------------------------------------

/** In-memory Storage double: map-backed, records setItem calls. */
function memoryStorage(initial: Record<string, string> = {}): {
  storage: VizPrefsStorage;
  writes: { key: string; value: string }[];
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  const writes: { key: string; value: string }[] = [];
  return {
    store,
    writes,
    storage: {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => {
        writes.push({ key: k, value: v });
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    },
  };
}

/** Quota double: every setItem throws (the QuotaExceededError path). */
function quotaStorage(): VizPrefsStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
}

/** Privacy-mode double: even getItem throws. */
function hostileStorage(): VizPrefsStorage {
  return {
    getItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
    setItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
    removeItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
  };
}

/** A valid non-default envelope for round-trips. */
const GOOD: VizArrangementEnvelope = {
  version: 1,
  presetId: "orrery",
  seed: 0x0badf00d,
};

/** Seed storage with a raw stored value (simulating a previous session). */
function seeded(value: string): { storage: VizPrefsStorage; store: Map<string, string> } {
  const { storage, store } = memoryStorage({
    [VIZ_PREFS_STORAGE_KEY]: value,
  });
  return { storage, store };
}

beforeEach(() => {
  resetVizPrefsForTests(); // module session state fresh per test
});

// ---------------------------------------------------------------------------
// persist.ts — round-trip + the exact stored shape
// ---------------------------------------------------------------------------

describe("VZ-IM-3 writeVizPrefs/readVizPrefs round-trip (good storage)", () => {
  it("writes then reads back the exact envelope under the ONE versioned key", () => {
    const { storage, store, writes } = memoryStorage();
    expect(writeVizPrefs(GOOD, storage)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe("bitbounce.viz.v1");
    // Exact three-field JSON, fixed order, JSON-safe values only.
    expect(store.get(VIZ_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, presetId: "orrery", seed: GOOD.seed }),
    );
    expect(readVizPrefs(storage)).toEqual(GOOD);
  });

  it("round-trips every library preset id and the u32 seed edges", () => {
    const { storage } = memoryStorage();
    for (const preset of VIZ_PRESETS) {
      for (const seed of [0, 1, 0xffffffff, 20260904]) {
        const envelope: VizArrangementEnvelope = {
          version: 1,
          presetId: preset.id,
          seed,
        };
        expect(writeVizPrefs(envelope, storage)).toBe(true);
        expect(readVizPrefs(storage)).toEqual(envelope);
      }
    }
  });

  it("writes touch NOTHING but the viz key (key isolation)", () => {
    const { storage, store } = memoryStorage({
      "bitbounce.other": "keep",
      "unrelated.key": "keep",
    });
    writeVizPrefs(GOOD, storage);
    expect(store.get("bitbounce.other")).toBe("keep");
    expect(store.get("unrelated.key")).toBe("keep");
    expect(store.size).toBe(3);
  });

  it("clearVizPrefs removes exactly the viz key (test/harness hygiene path)", () => {
    const { storage, store } = memoryStorage({
      [VIZ_PREFS_STORAGE_KEY]: "{}",
      "bitbounce.other": "keep",
    });
    clearVizPrefs(storage);
    expect(store.has(VIZ_PREFS_STORAGE_KEY)).toBe(false);
    expect(store.get("bitbounce.other")).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// persist.ts — read validation table (every failure = the same answer: null)
// ---------------------------------------------------------------------------

describe("VZ-IM-3 readVizPrefs validation (corrupt/stale data → discard)", () => {
  const DISCARD: readonly string[] = [
    "{corrupt json", // corrupt JSON
    "", // empty string
    "null",
    "42",
    '"a string"',
    "[]",
    "[1,2,3]",
    "{}", // missing every field
    '{"presetId":"orrery","seed":7}', // missing version
    '{"version":2,"presetId":"orrery","seed":7}', // unknown FUTURE version
    '{"version":"1","presetId":"orrery","seed":7}', // version as string
    '{"version":0,"presetId":"orrery","seed":7}',
    '{"version":1,"seed":7}', // missing presetId
    '{"version":1,"presetId":123,"seed":7}', // presetId not a string
    '{"version":1,"presetId":"ghost-preset","seed":7}', // unknown preset
    '{"version":1,"presetId":"","seed":7}', // empty preset id
    '{"version":1,"presetId":"orrery"}', // missing seed
    '{"version":1,"presetId":"orrery","seed":null}',
    '{"version":1,"presetId":"orrery","seed":"7"}', // seed as string
    '{"version":1,"presetId":"orrery","seed":7.5}', // fractional seed
    '{"version":1,"presetId":"orrery","seed":-1}', // negative (>>> 0 would
    // silently reinterpret −1 as 4294967295 — discard instead)
    '{"version":1,"presetId":"orrery","seed":4294967296}', // above u32
    '{"version":1,"presetId":"orrery","seed":1e309}', // Infinity → null in JSON
  ];

  it.each(DISCARD)("discards silently: %s", (raw) => {
    const { storage } = seeded(raw);
    expect(readVizPrefs(storage)).toBeNull();
  });

  it("unknown presetId falls back — the library is the truth, not the disk", () => {
    // A preset id from a hypothetical older library: valid shape, no rig.
    const { storage } = seeded(
      JSON.stringify({ version: 1, presetId: "removed-in-v2", seed: 42 }),
    );
    expect(readVizPrefs(storage)).toBeNull();
  });

  it("absent key and absent storage are the same answer: null", () => {
    expect(readVizPrefs(memoryStorage().storage)).toBeNull(); // no key
    expect(readVizPrefs(null)).toBeNull(); // no storage at all (node/sandbox)
  });

  it("a throwing getItem (privacy modes) falls back silently, no crash", () => {
    expect(readVizPrefs(hostileStorage())).toBeNull();
  });

  it("extra unknown fields inside a v1 envelope are tolerated (within-version lenience)", () => {
    const { storage } = seeded(
      JSON.stringify({ version: 1, presetId: "orrery", seed: 7, extra: "x" }),
    );
    expect(readVizPrefs(storage)).toEqual({
      version: 1,
      presetId: "orrery",
      seed: 7,
    });
  });
});

// ---------------------------------------------------------------------------
// persist.ts — write fallback law (quota/serialization/absent storage)
// ---------------------------------------------------------------------------

describe("VZ-IM-3 writeVizPrefs silent fallback (quota, hostile, absent)", () => {
  it("a throwing setItem (quota) returns false and NEVER throws", () => {
    expect(writeVizPrefs(GOOD, quotaStorage())).toBe(false);
  });

  it("a fully hostile storage (privacy mode) returns false silently", () => {
    expect(writeVizPrefs(GOOD, hostileStorage())).toBe(false);
    expect(clearVizPrefs(hostileStorage)).toBeUndefined(); // clear never throws
  });

  it("absent storage returns false (memory is a privilege)", () => {
    expect(writeVizPrefs(GOOD, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state.ts — the session signals + boot restore
// ---------------------------------------------------------------------------

describe("VZ-IM-3 session state (restore on boot, commit on deal)", () => {
  it("restore adopts a VALID persisted envelope into the reactive signal", () => {
    const { storage } = seeded(
      JSON.stringify({ version: 1, presetId: "spark-fan", seed: 999 }),
    );
    const restored = restoreVizPrefs(storage);
    expect(restored).toEqual({
      version: 1,
      presetId: "spark-fan",
      seed: 999,
    });
    expect(vizPrefs()).toEqual(restored); // the signal IS the session truth
  });

  it("restore reads storage ONCE per session — later storages cannot resurrect a stale deal", () => {
    const first = seeded(
      JSON.stringify({ version: 1, presetId: "orrery", seed: 11 }),
    );
    expect(restoreVizPrefs(first.storage).seed).toBe(11);
    const second = seeded(
      JSON.stringify({ version: 1, presetId: "river-glass", seed: 22 }),
    );
    expect(restoreVizPrefs(second.storage)).toEqual({
      version: 1,
      presetId: "orrery",
      seed: 11,
    }); // session-once: the signal wins, the second disk is ignored
  });

  it("corrupt/stale/absent memory restores the DEFAULT (first library preset, fixed boot seed)", () => {
    expect(defaultVizPrefsEnvelope()).toEqual({
      version: 1,
      presetId: VIZ_DEFAULT_PRESET_ID,
      seed: VIZ_DEFAULT_SEED,
    });
    // The default IS the first library preset (the plan's fallback wording).
    expect(VIZ_DEFAULT_PRESET_ID).toBe(VIZ_PRESETS[0]!.id);
    for (const raw of ["{corrupt", '{"version":1,"presetId":"ghost","seed":5}', "{}"]) {
      resetVizPrefsForTests();
      const { storage } = seeded(raw);
      expect(restoreVizPrefs(storage)).toEqual(defaultVizPrefsEnvelope());
    }
    resetVizPrefsForTests();
    expect(restoreVizPrefs(null)).toEqual(defaultVizPrefsEnvelope());
    expect(restoreVizPrefs(hostileStorage())).toEqual(
      defaultVizPrefsEnvelope(),
    );
  });

  it("restore NEVER writes (a fresh install stays keyless until the first commit)", () => {
    const { storage, writes } = memoryStorage();
    restoreVizPrefs(storage); // absent key
    resetVizPrefsForTests();
    const seededStore = seeded(
      JSON.stringify({ version: 1, presetId: "halo-rings", seed: 33 }),
    );
    restoreVizPrefs(seededStore.storage); // valid key
    expect(writes).toHaveLength(0);
    expect(seededStore.store.get(VIZ_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, presetId: "halo-rings", seed: 33 }),
    ); // the stored bytes are untouched by a read
  });

  it("commitVizEnvelope updates the signal and persists exactly the committed envelope", () => {
    const { storage, writes } = memoryStorage();
    const committed: VizArrangementEnvelope = {
      version: 1,
      presetId: "comet-run",
      seed: 7777,
    };
    commitVizEnvelope(committed, storage);
    expect(vizPrefs()).toEqual(committed);
    expect(writes).toHaveLength(1);
    expect(readVizPrefs(storage)).toEqual(committed); // full round-trip
  });

  it("a commit with a DEAD storage still updates the signal (session survives quota)", () => {
    commitVizEnvelope(
      { version: 1, presetId: "kit-fires", seed: 5 },
      quotaStorage(),
    );
    expect(vizPrefs()).toEqual({ version: 1, presetId: "kit-fires", seed: 5 });
    commitVizEnvelope({ version: 1, presetId: "wash-field", seed: 6 }, null);
    expect(vizPrefs()).toEqual({
      version: 1,
      presetId: "wash-field",
      seed: 6,
    });
  });

  it("bootVizArrangementFromPrefs re-deals the restored envelope EXACTLY (seed ⇒ rig)", () => {
    const { storage } = seeded(
      JSON.stringify({ version: 1, presetId: "lighthouse", seed: 424242 }),
    );
    restoreVizPrefs(storage);
    const preset = VIZ_PRESETS.find((p) => p.id === "lighthouse")!;
    expect(bootVizArrangementFromPrefs()).toEqual(
      generateArrangement(preset, 424242),
    );
  });

  it("boot with no memory = the deterministic first-boot deal (the fingerprint's rig)", () => {
    restoreVizPrefs(null);
    expect(bootVizArrangementFromPrefs()).toEqual(defaultBootArrangement());
  });

  it("the boot helper degrades an unknown preset id to the FIRST library preset (library churn)", () => {
    // Not reachable through readVizPrefs (validation), so it is defended
    // directly: a signal holding an id the library no longer has still
    // boots a valid rig — entry 0, never a crash.
    commitVizEnvelope(
      { version: 1, presetId: "removed-since", seed: 8 },
      null,
    );
    const boot: VizArrangement = bootVizArrangementFromPrefs();
    expect(boot.presetId).toBe(VIZ_PRESETS[0]!.id);
    expect(boot).toEqual(generateArrangement(VIZ_PRESETS[0]!, 8));
  });
});

// ---------------------------------------------------------------------------
// Write timing — the no-amplification law, against the REAL controller
// ---------------------------------------------------------------------------

/** Manual clock (the viz-reroll precedent): deterministic schedule/advance. */
function manualClock(): {
  schedule: VizSchedule;
  advance(ms: number): void;
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
  return { schedule, advance };
}

describe("VZ-IM-3 write timing (persist on COMMITTED deals only)", () => {
  it("a 10-request reroll burst writes ZERO times pre-commit, EXACTLY once at the commit", () => {
    const clock = manualClock();
    const { storage, writes } = memoryStorage();
    const controller = createVizArrangementController({
      engine: { setArrangement: () => {} },
      initial: defaultBootArrangement(),
      schedule: clock.schedule,
    });
    try {
      const stop = controller.subscribe((envelope) =>
        commitVizEnvelope(envelope, storage),
      ); // VizPage's exact wiring shape
      // Boot state: nothing written (boot is not a commit).
      expect(writes).toHaveLength(0);
      // Ten rapid reroll REQUESTS inside the window: all pending, no deal.
      for (let i = 0; i < 10; i++) {
        controller.reroll();
        clock.advance(30);
      }
      expect(controller.probe()).toMatchObject({
        pendingReroll: true,
        commits: 0,
      });
      expect(writes).toHaveLength(0); // ← the amplification guard
      // The window closes: ONE commit, ONE write, byte-exact the envelope.
      clock.advance(VIZ_REROLL_COALESCE_MS);
      expect(controller.probe().commits).toBe(1);
      expect(writes).toHaveLength(1);
      expect(readVizPrefs(storage)).toEqual(controller.envelope());
      expect(vizPrefs()).toEqual(controller.envelope()); // signal tracked
      // Quiet tail: nothing further fires, nothing further writes.
      clock.advance(10_000);
      expect(writes).toHaveLength(1);
      stop();
    } finally {
      controller.dispose();
    }
  });

  it("each committed cycle writes exactly once (browse steps are commits)", () => {
    const clock = manualClock();
    const { storage, writes } = memoryStorage();
    const controller = createVizArrangementController({
      engine: { setArrangement: () => {} },
      initial: defaultBootArrangement(),
      schedule: clock.schedule,
    });
    try {
      controller.subscribe((envelope) => commitVizEnvelope(envelope, storage));
      controller.cycle(1);
      controller.cycle(1);
      expect(writes).toHaveLength(2);
      expect(readVizPrefs(storage)).toEqual(controller.envelope());
      expect(readVizPrefs(storage)!.presetId).toBe(VIZ_PRESETS[2]!.id);
    } finally {
      controller.dispose();
    }
  });

  it("a pending window that dies (dispose) never writes", () => {
    const clock = manualClock();
    const { storage, writes } = memoryStorage();
    const controller = createVizArrangementController({
      engine: { setArrangement: () => {} },
      initial: defaultBootArrangement(),
      schedule: clock.schedule,
    });
    controller.subscribe((envelope) => commitVizEnvelope(envelope, storage));
    controller.reroll();
    controller.dispose(); // exit-while-arranging: the window dies uncommitted
    clock.advance(10_000);
    expect(writes).toHaveLength(0);
    expect(activeVizArrangementControllers()).not.toContain(controller);
  });
});

// ---------------------------------------------------------------------------
// Fences (the run's grep-clean source precedent)
// ---------------------------------------------------------------------------

describe("VZ-IM-3 module fences (two-tier law, determinism, the key)", () => {
  const PERSIST = readFileSync("src/viz/persist.ts", "utf8");
  const STATE = readFileSync("src/viz/state.ts", "utf8");

  it("the ONE key is product-namespaced and versioned", () => {
    expect(VIZ_PREFS_STORAGE_KEY).toBe("bitbounce.viz.v1");
  });

  it("no Math.random / Date.now anywhere in the memory modules", () => {
    for (const source of [PERSIST, STATE]) {
      expect(source).not.toMatch(/Math\.random\s*\(/);
      expect(source).not.toMatch(/Date\.now\s*\(/);
    }
  });

  it("never docStore / IndexedDB / schema (the two-tier state law)", () => {
    // Import-shaped fence (comment-proof): every import must stay inside
    // src/viz (or solid-js for the signal) — nothing reaches state/store,
    // the project persist/ layer, document/, or engine/.
    const importSpecs = (source: string): string[] => {
      const specs: string[] = [];
      for (const match of source.matchAll(/from\s+"([^"]+)"/g))
        specs.push(match[1]!);
      return specs;
    };
    for (const source of [PERSIST, STATE]) {
      for (const spec of importSpecs(source)) {
        expect(
          spec === "solid-js" || /^\.\.\/viz\//.test(spec) || /^\.\//.test(spec),
          `unexpected import "${spec}" outside src/viz + solid-js`,
        ).toBe(true);
      }
    }
  });
});
