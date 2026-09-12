import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../src/webmcp/tools";
import {
  createFreshProjectDocument,
  docStore,
  loadDocument,
  setTransport,
  undo,
  redo,
} from "../src/state/store";
import { PRESET_LIBRARY } from "../src/audio/presets";

let group: ReturnType<typeof createAgentTools>;
let allowed = true;
const read = () => docStore.getState().doc;
function call(name: string, args: unknown = {}) {
  return group.tools
    .find((tool) => tool.name === `bitbounce_${name}`)!
    .execute(args);
}
beforeEach(() => {
  loadDocument(createFreshProjectDocument());
  docStore.temporal.getState().clear();
  allowed = true;
  group = createAgentTools(() => allowed);
});
afterEach(() => group.dispose());

describe("WebMCP musical editing", () => {
  it("reads actual lanes and exposes only pitched presets", async () => {
    expect(await call("get_project")).toMatchObject({
      revision: 0,
      lanes: [
        { id: "drums" },
        { id: "bass" },
        { id: "chords" },
        { id: "lead" },
      ],
    });
    const sounds = (await call("list_sounds")) as { presets: { id: string }[] };
    expect(sounds.presets.length).toBeGreaterThan(40);
    expect(sounds.presets.every((p) => PRESET_LIBRARY[p.id].pitchRange)).toBe(
      true,
    );
  });
  it("makes each tempo edit one undo step and rejects stale human or agent revisions", async () => {
    await call("set_tempo", { revision: 0, bpm: 130 });
    await call("set_tempo", { revision: 1, bpm: 140 });
    undo();
    expect(read().transport.bpm).toBe(130);
    undo();
    expect(read().transport.bpm).toBe(120);
    redo();
    expect(read().transport.bpm).toBe(130);
    const before = read();
    await expect(call("set_tempo", { revision: 0, bpm: 150 })).rejects.toThrow(
      "Project changed",
    );
    expect(read()).toBe(before);
    const rev = group.revision();
    setTransport({ bpm: 155 });
    await expect(
      call("set_tempo", { revision: rev, bpm: 150 }),
    ).rejects.toThrow("Project changed");
  });
  it("rejects invalid inputs without writes or undo entries", async () => {
    const before = read();
    for (const input of [
      { revision: 0, bpm: 500 },
      { revision: 0, bpm: "120" },
      { revision: 0, bpm: 100, extra: true },
    ]) {
      await expect(call("set_tempo", input)).rejects.toThrow();
    }
    await expect(
      call("set_lane", { revision: 0, lane: "extra1", mix: { mute: true } }),
    ).rejects.toThrow();
    await expect(
      call("set_lane", {
        revision: 0,
        lane: "bass",
        soundId: "kit-default",
        mix: { mute: true },
      }),
    ).rejects.toThrow();
    expect(read()).toBe(before);
    expect(docStore.temporal.getState().pastStates).toHaveLength(0);
  });
  it("applies sound and mix atomically, preserving the other lanes", async () => {
    const before = read();
    await call("set_lane", {
      revision: 0,
      lane: "bass",
      soundId: "preset-lead-1",
      mix: { volume: 0.5, mute: true },
    });
    expect(read().lanes[1]).toMatchObject({
      presetId: "preset-lead-1",
      volume: 0.5,
      mute: true,
    });
    expect(read().lanes[0]).toBe(before.lanes[0]);
    undo();
    expect(read()).toBe(before);
  });
  it("sets notes on one pattern, exposes valid degrees, and refuses overlaps or out-of-bounds starts", async () => {
    const patternId = read().patterns.bass[0].id;
    expect(
      await call("get_pattern", { lane: "bass", patternId }),
    ).toHaveProperty("allowedDegrees");
    await call("set_pattern", {
      revision: 0,
      lane: "bass",
      patternId,
      notes: [{ degree: 0, start: 0, length: 2 }],
    });
    expect(read().patterns.bass[0]).toMatchObject({
      notes: [{ degree: 0, start: 0, length: 2 }],
    });
    const before = read();
    await expect(
      call("set_pattern", {
        revision: group.revision(),
        lane: "bass",
        patternId,
        notes: [{ degree: 0, start: 16, length: 2 }],
      }),
    ).rejects.toThrow();
    await expect(
      call("set_pattern", {
        revision: group.revision(),
        lane: "bass",
        patternId,
        notes: [
          { degree: 0, start: 0, length: 3 },
          { degree: 0, start: 1, length: 2 },
        ],
      }),
    ).rejects.toThrow();
    expect(read()).toBe(before);
  });
  it("replaces only supplied drum rows and rejects length repair", async () => {
    const patternId = read().patterns.drums[0].id;
    const steps = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
    await call("set_pattern", {
      revision: 0,
      lane: "drums",
      patternId,
      drumRows: { kick: steps },
    });
    expect(read().patterns.drums[0].steps.kick).toEqual(steps);
    expect(read().patterns.drums[0].steps.snare.every((v) => !v)).toBe(true);
    const before = read();
    await expect(
      call("set_pattern", {
        revision: group.revision(),
        lane: "drums",
        patternId,
        drumRows: { snare: [true] },
      }),
    ).rejects.toThrow("exactly");
    expect(read()).toBe(before);
  });
  it("edits full arrangements, effects, and scale in one recoverable change", async () => {
    const before = read();
    const next = structuredClone(before);
    const document = {
      ...next,
      scale: { root: 2, mode: "major" },
      lanes: next.lanes.map((lane) =>
        lane.id === "bass"
          ? {
              ...lane,
              fxChain: [
                { type: "drive", bypassed: false, params: { amount: 0.5 } },
              ],
            }
          : lane,
      ),
      songChain: {
        ...next.songChain,
        bass: [next.patterns.bass[0].id, next.patterns.bass[0].id],
      },
    };
    await call("apply_document", { revision: 0, document });
    expect(read().songChain.bass).toHaveLength(2);
    expect(read().lanes[1].fxChain).toHaveLength(1);
    undo();
    expect(read()).toBe(before);
    redo();
    expect(read().scale.root).toBe(2);
  });
  it("rejects invalid full documents atomically", async () => {
    const before = read();
    const document = {
      ...before,
      songChain: { ...before.songChain, bass: ["missing"] },
    };
    await expect(
      call("apply_document", { revision: 0, document }),
    ).rejects.toThrow();
    expect(read()).toBe(before);
  });
  it("revokes already-discovered callbacks and honors cancellation", async () => {
    allowed = false;
    await expect(call("get_project")).rejects.toThrow("off");
    allowed = true;
    const controller = new AbortController();
    controller.abort();
    await expect(
      group.tools[0].execute({}, { signal: controller.signal }),
    ).rejects.toThrow();
  });
  it("does not add undo history for an unchanged edit", async () => {
    await expect(
      call("set_tempo", { revision: 0, bpm: 120 }),
    ).resolves.toMatchObject({ changed: false });
    expect(group.revision()).toBe(0);
    expect(docStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
