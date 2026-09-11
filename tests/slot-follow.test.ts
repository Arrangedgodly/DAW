/**
 * ⟲ LOOP / → NEXT slot follow (2026-09-11, user call) — fake ctx, exact
 * step attribution (the IM-7 quantized-switch harness):
 * - a ⟲ slot replays its pattern instead of advancing; → slots advance and
 *   the last one wraps to the first;
 * - a slot cue (cueSlot) jumps the lane to the cued chain slot at the end of
 *   the segment it is playing, then follows that slot's mode;
 * - cueing the ⟲ slot the lane is holding cancels the pending cue;
 * - a mode flip applies at the slot's next end (same-structure push);
 * - a chain-structure edit queued while holding lands at the hold boundary;
 * - play start never "holds" a slot that has not played yet;
 * - the store keeps chainModes parallel and canonical (key absent when no
 *   slot loops); validation rejects a misaligned array.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Session } from "../src/engine/session";
import {
  compileLaneSchedule,
  resolveChainSlots,
  type LaneSchedule,
} from "../src/audio/song";
import { getDrumKit } from "../src/audio/presets";
import { EventOutbox, type VoiceEngineHost } from "../src/audio/voiceEngine";
import type { AudioContextLike } from "../src/audio/context";
import type { DrumPattern, LaneId } from "../src/document/schema";
import {
  appendChainSlot,
  createFreshProjectDocument,
  docStore,
  loadDocument,
  removeChainSlot,
  setLaneChain,
  toggleChainSlotMode,
} from "../src/state/store";
import { decode, encode } from "../src/document/codec";

const KIT = getDrumKit("kit-default")!;
const GATE = { unit: "steps", value: 1 } as const;
const GROOVE = { bpm: 120, swing: 0 };
const SPB = 0.125; // seconds per 16th at 120 bpm
const TIMELINE = 10.1; // play() at ctx.now = 10 + 0.1 start delay

function drumPattern(id: string, kickSteps: number[]): DrumPattern {
  const kick = new Array(16).fill(false);
  for (const s of kickSteps) kick[s] = true;
  const empty = () => new Array(16).fill(false);
  return {
    kind: "drums",
    id,
    name: id,
    bars: 1,
    steps: {
      kick,
      snare: empty(),
      hat: empty(),
      openhat: empty(),
      clap: empty(),
      tom: empty(),
    },
  };
}

const A = drumPattern("A", [0]); // kick at pattern step 0 only
const B = drumPattern("B", [0, 8]); // kicks at pattern steps 0 and 8
const C = drumPattern("C", [4]); // kick at pattern step 4 only

/** Chain schedule with slot identity + ⟲ flags (the engineBridge shape). */
function chainOf(
  entries: readonly { pattern: DrumPattern; loop?: boolean }[],
): LaneSchedule {
  return compileLaneSchedule({
    chain: entries.map((e) => e.pattern),
    slots: entries.map((e, slot) => ({ slot, loop: e.loop === true })),
    preset: KIT,
    gate: GATE,
    groove: GROOVE,
  });
}

interface Harness {
  session: Session;
  deliverUpTo(step: number): Promise<void>;
  /** Kick count the drums lane sent at global step `step`. */
  hitsAt(step: number): number;
}

async function makeHarness(
  initial: Partial<Record<LaneId, LaneSchedule>>,
): Promise<Harness> {
  const state = { now: 10 };
  const ctx = {
    get currentTime() {
      return state.now;
    },
    sampleRate: 44100,
    state: "running",
    resume: async () => {},
  } as unknown as AudioContextLike;
  const sent: { lane: number; step: number }[] = [];
  const host: VoiceEngineHost = {
    outbox: new EventOutbox(4),
    sendEvents: (lane, events) => {
      for (const e of events)
        sent.push({ lane, step: Math.round((e.time - TIMELINE) / SPB) });
    },
    connect: () => {},
    allOff: () => {},
    dispose: () => {},
  };
  let intervalCb: (() => void) | null = null;
  const session = new Session({
    engine: { getContext: () => ctx, unlock: async () => {} } as never,
    createVoiceEngineHost: async () => host,
    horizonSeconds: 0.1,
    setIntervalFn: (cb) => {
      intervalCb = cb as () => void;
      return 0;
    },
    clearIntervalFn: () => {},
  });
  for (const [lane, schedule] of Object.entries(initial) as [
    LaneId,
    LaneSchedule,
  ][]) {
    session.setLaneSchedule(lane, schedule);
  }
  session.transport.play();
  const deliverUpTo = async (step: number) => {
    state.now = TIMELINE + step * SPB + 1e-6;
    intervalCb!();
    await Promise.resolve();
    await Promise.resolve();
  };
  const hitsAt = (step: number) =>
    sent.filter((s) => s.lane === 0 && s.step === step).length;
  return { session, deliverUpTo, hitsAt };
}

describe("⟲ LOOP / → NEXT slot follow (session)", () => {
  it("a ⟲ slot replays its pattern instead of advancing", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A, loop: true }, { pattern: B }]),
    });
    await h.deliverUpTo(56);
    for (const s of [0, 16, 32, 48]) expect(h.hitsAt(s)).toBe(1); // A, held
    for (const s of [24, 40, 56]) expect(h.hitsAt(s)).toBe(0); // B never plays
  });

  it("→ slots advance and the last one wraps to the first", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A }, { pattern: B }]),
    });
    await h.deliverUpTo(40);
    expect(h.hitsAt(0)).toBe(1); // A
    expect(h.hitsAt(16) + h.hitsAt(24)).toBe(2); // B (steps 0 and 8)
    expect(h.hitsAt(32)).toBe(1); // wrapped to A
    expect(h.hitsAt(40)).toBe(0); // …and A has no step-8 kick
  });

  it("play start never holds a slot that has not played yet", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A }, { pattern: B, loop: true }]),
    });
    await h.deliverUpTo(40);
    expect(h.hitsAt(0)).toBe(1); // starts on A (slot 1's ⟲ is not a pull)
    expect(h.hitsAt(8)).toBe(0);
    expect(h.hitsAt(24)).toBe(1); // B
    expect(h.hitsAt(32) + h.hitsAt(40)).toBe(2); // B held, not wrapped to A
  });

  it("a slot cue jumps at the end of the playing segment, then follows the cued slot's mode", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A, loop: true }, { pattern: B }]),
    });
    await h.deliverUpTo(5);
    h.session.cueSlot("drums", 1);
    const pending = h.session.getPendingSwitch("drums")!;
    expect(pending.mode).toBe("jump");
    expect(pending.toSlot).toBe(1);
    expect(pending.toPatternId).toBe("B");
    expect(pending.fromPatternId).toBe("A");
    expect(pending.appliesAtStep).toBe(16); // the held A's end, exactly
    await h.deliverUpTo(15);
    expect(h.session.getPendingSwitch("drums")).not.toBeNull();
    await h.deliverUpTo(16);
    expect(h.session.getPendingSwitch("drums")).toBeNull();
    expect(h.session.getActivePattern("drums")).toBe("B");
    await h.deliverUpTo(56);
    expect(h.hitsAt(24)).toBe(1); // B's step 8
    expect(h.hitsAt(32)).toBe(1); // B is → : wraps to A (⟲) …
    expect(h.hitsAt(40)).toBe(0);
    expect(h.hitsAt(48)).toBe(1); // … which holds
    expect(h.hitsAt(56)).toBe(0);
  });

  it("cueing the ⟲ slot the lane is holding cancels the pending cue", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A, loop: true }, { pattern: B }]),
    });
    await h.deliverUpTo(5);
    h.session.cueSlot("drums", 1);
    expect(h.session.getPendingSwitch("drums")).not.toBeNull();
    h.session.cueSlot("drums", 0);
    expect(h.session.getPendingSwitch("drums")).toBeNull();
    await h.deliverUpTo(24);
    expect(h.hitsAt(16)).toBe(1); // still A
    expect(h.hitsAt(24)).toBe(0);
  });

  it("a cue to a → slot mid-chain lands on that slot's first step", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A }, { pattern: B }, { pattern: C }]),
    });
    await h.deliverUpTo(3);
    h.session.cueSlot("drums", 2); // skip B
    expect(h.session.getPendingSwitch("drums")!.appliesAtStep).toBe(16);
    await h.deliverUpTo(36);
    expect(h.hitsAt(16) + h.hitsAt(24)).toBe(0); // B skipped
    expect(h.hitsAt(20)).toBe(1); // C's step 4
    expect(h.hitsAt(32)).toBe(1); // C is last → wraps to A
    expect(h.hitsAt(36)).toBe(0);
  });

  it("a mode flip applies at the slot's next end (same-structure push)", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A, loop: true }, { pattern: B }]),
    });
    await h.deliverUpTo(20);
    expect(h.hitsAt(16)).toBe(1); // held once
    h.session.setLaneSchedule("drums", chainOf([{ pattern: A }, { pattern: B }]));
    expect(h.session.hasPendingSchedule("drums")).toBe(false); // not deferred
    await h.deliverUpTo(40);
    expect(h.hitsAt(32)).toBe(1); // B's step 0 (advanced at 32)
    expect(h.hitsAt(40)).toBe(1); // B's step 8
  });

  it("a chain-structure edit queued while holding lands at the hold boundary", async () => {
    const h = await makeHarness({
      drums: chainOf([{ pattern: A, loop: true }, { pattern: B }]),
    });
    await h.deliverUpTo(5);
    h.session.setLaneSchedule(
      "drums",
      chainOf([{ pattern: A, loop: true }, { pattern: B }, { pattern: C }]),
    );
    expect(h.session.hasPendingSchedule("drums")).toBe(true);
    await h.deliverUpTo(16);
    expect(h.session.hasPendingSchedule("drums")).toBe(false); // landed at 16
    expect(h.session.getLaneCycleSteps("drums")).toBe(48);
    await h.deliverUpTo(40);
    expect(h.hitsAt(16) + h.hitsAt(32)).toBe(2); // still holding A
    expect(h.hitsAt(24) + h.hitsAt(36) + h.hitsAt(40)).toBe(0);
  });
});

describe("⟲/→ slot modes in the document", () => {
  beforeEach(() => loadDocument(createFreshProjectDocument()));

  const drumsId = () => docStore.getState().doc.songChain.drums[0]!;

  it("toggle writes a parallel array; all-→ collapses to the key absent", () => {
    appendChainSlot("drums", drumsId());
    expect(toggleChainSlotMode("drums", 1)).toBe("loop");
    const doc = docStore.getState().doc;
    expect(doc.chainModes?.drums).toEqual(["next", "loop"]);
    expect(doc.chainModes?.bass).toEqual(["next"]);
    expect(toggleChainSlotMode("drums", 1)).toBe("next");
    expect("chainModes" in docStore.getState().doc).toBe(false);
  });

  it("slot edits keep modes positional (remove / append / rewrite)", () => {
    const id = drumsId();
    appendChainSlot("drums", id);
    appendChainSlot("drums", id);
    toggleChainSlotMode("drums", 2);
    removeChainSlot("drums", 0);
    expect(docStore.getState().doc.chainModes?.drums).toEqual(["next", "loop"]);
    appendChainSlot("drums", id); // new slots start →
    expect(docStore.getState().doc.chainModes?.drums).toEqual([
      "next",
      "loop",
      "next",
    ]);
    setLaneChain("drums", [id]); // rewrite truncates positionally
    expect("chainModes" in docStore.getState().doc).toBe(false);
  });

  it("round-trips through the codec; a misaligned array is rejected", () => {
    appendChainSlot("drums", drumsId());
    toggleChainSlotMode("drums", 0);
    const text = encode(docStore.getState().doc);
    expect(decode(text).chainModes?.drums).toEqual(["loop", "next"]);
    const bad = JSON.parse(text) as { chainModes: { drums: string[] } };
    bad.chainModes.drums = ["loop"];
    let error: unknown = null;
    try {
      decode(JSON.stringify(bad));
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(String((error as { issues?: unknown }).issues)).toMatch(
      /chainModes\.drums/,
    );
  });

  it("the compiler tags segments with their document slot and mode", () => {
    appendChainSlot("drums", drumsId());
    toggleChainSlotMode("drums", 1);
    const slots = resolveChainSlots(docStore.getState().doc, "drums");
    expect(slots.map(({ slot, loop }) => ({ slot, loop }))).toEqual([
      { slot: 0, loop: false },
      { slot: 1, loop: true },
    ]);
  });
});
