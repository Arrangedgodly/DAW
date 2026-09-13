import { afterEach, expect, it } from "vitest";
import { render } from "solid-js/web";
import LaneGrid from "../../src/components/LaneGrid";
import { createAgentTools } from "../../src/webmcp/tools";
import {
  addInstrumentLane,
  createFreshProjectDocument,
  docStore,
  loadDocument,
} from "../../src/state/store";
import { getSession } from "../../src/engine/session";
import { pitchDomain } from "../../src/document/pitchWindow";
import {
  getOrCreateRegisterWindow,
  registerWindowStart,
  setRegisterWindowStart,
} from "../../src/state/selection";
import { noteParamsFor, PRESET_LIBRARY } from "../../src/audio/presets";
import { renderOffline } from "./helpers";

let dispose = () => {};
afterEach(() => dispose());
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));

it.each(["bass", "chords", "lead", "extra1"] as const)(
  "shows agent notes in %s after its empty pitch window was initialized",
  async (lane) => {
    loadDocument(createFreshProjectDocument());
    if (lane === "extra1") addInstrumentLane();
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = render(() => <LaneGrid lane={lane} />, host);
    const agent = createAgentTools(() => true);
    dispose = () => {
      unmount();
      host.remove();
      agent.dispose();
    };
    getOrCreateRegisterWindow(lane, 7);
    const domain = pitchDomain(docStore.getState().doc, lane);
    const degree = 21;
    const p = docStore.getState().doc.patterns[lane]![0]!;
    const tool = agent.tools.find((t) => t.name === "bitbounce_set_pattern")!;
    await tool.execute({
      revision: 0,
      lane: lane,
      patternId: p.id,
      notes: [{ degree, start: 0, length: 4 }],
    });
    const before = docStore.getState().doc;
    await getSession().togglePlay();
    await wait();
    const start = registerWindowStart(lane)!;
    await getSession().togglePlay();
    const row = domain.degrees.indexOf(degree);
    expect(row).toBeGreaterThanOrEqual(start);
    expect(row).toBeLessThan(start + domain.windowRows);
    expect(docStore.getState().doc).toBe(before);
    setRegisterWindowStart(lane, 0);
  },
);

it("Sub Drop renders audible notes at its home register even with short gates", async () => {
  for (const midi of [36, 42, 48]) {
    const event = noteParamsFor(PRESET_LIBRARY["preset-bass-13"]!, {
      time: 0.05,
      midi,
      holdSeconds: 0.125,
    });
    const { mono } = await renderOffline({
      startTime: 0.05,
      duration: 0.5,
      lanes: [[event]],
    });
    let peak = 0;
    for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
    expect(peak, `Sub Drop at MIDI ${midi}`).toBeGreaterThan(0.01);
  }
});
