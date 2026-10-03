import { expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { trustedTapAt } from "./trusted-touch";
import { render } from "solid-js/web";
import StageFloor from "../../src/components/StageFloor";
import { docStore, setFxBypassed } from "../../src/state/store";
import { selectLane } from "../../src/state/selection";
import { getSession } from "../../src/engine/session";
import { getPreset, getDrumKit } from "../../src/audio/presets";
import { createDemoProject } from "../../src/document/demoSong";

it.each(["bass", "drums", "chords", "lead"] as const)(
  "the %s track remains audible after previewing and applying synth and recorded sounds",
  async (lane) => {
    await page.viewport(390, 844);
    const doc = createDemoProject();
    doc.transport.bpm = 180;
    const bass = doc.patterns.bass[0];
    if (bass.kind !== "pitched") throw new Error("pitched fixture required");
    bass.notes = Array.from({ length: 8 }, (_, i) => ({
      degree: 0,
      start: i * 2,
      length: 2,
    }));
    docStore.setState({ doc });
    const session = getSession();
    selectLane(lane);
    const mount = document.createElement("div");
    document.body.append(mount);
    const dispose = render(() => <StageFloor />, mount);
    const audible = async (label: string) => {
      let peak = 0;
      await vi.waitFor(
        () => {
          peak = Math.max(peak, session.readMixerLevel(lane).peak);
          expect(peak, label).toBeGreaterThan(0.001);
        },
        { timeout: 4000, interval: 30 },
      );
    };
    try {
      await session.togglePlay();
      await audible("before a sound swap");
      for (const id of lane === "drums"
        ? ["kit-808", "kit-lab", "kit-punch"]
        : ["preset-bass-2", "preset-bass-13", "preset-lead-2"]) {
        const name = (getPreset(id) ?? getDrumKit(id))!.name;
        mount
          .querySelector<HTMLButtonElement>(
            `[data-lane="${lane}"] .head-sound-browse`,
          )!
          .click();
        const input = document.querySelector<HTMLInputElement>(
          ".sound-search input",
        )!;
        input.value = name;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const preview = document.querySelector<HTMLButtonElement>(
          `.sound-preview[aria-label="Preview ${name}"]`,
        )!;
        preview.click();
        await vi.waitFor(
          () =>
            expect(
              document.querySelector<HTMLButtonElement>(".sound-use")!.disabled,
            ).toBe(false),
          { timeout: 10000 },
        );
        // Changing a preset must preserve the existing track graph. Check
        // synchronously so sample voice retirement is not part of this probe.
        const disconnect = vi.spyOn(AudioNode.prototype, "disconnect");
        try {
          document.querySelector<HTMLButtonElement>(".sound-use")!.click();
          expect(
            disconnect.mock.calls.filter((args) => args.length > 0),
            "Use sound must not disconnect unchanged track effects",
          ).toHaveLength(0);
        } finally {
          disconnect.mockRestore();
        }
        const conf = docStore.getState().doc.lanes.find((l) => l.id === lane)!;
        expect(conf.id === "drums" ? conf.kitId : conf.presetId).toBe(id);
        // Let the old voice and analyzer window finish; measure scheduled track
        // audio only, after the preview was stopped by Use sound and dismissal.
        await new Promise((r) => setTimeout(r, 2500));
        await audible(`scheduled track after applying ${id}`);
      }
      if (lane !== "drums") {
        const disconnect = vi.spyOn(AudioNode.prototype, "disconnect");
        try {
          setFxBypassed(lane, 0, true);
          expect(
            disconnect.mock.calls.filter((args) => args.length > 0).length,
            "An actual effects bypass still updates the track graph",
          ).toBeGreaterThan(0);
        } finally {
          disconnect.mockRestore();
        }
        await audible("track after bypassing an effect");
      }
    } finally {
      if (session.transport.snapshot.playing) await session.togglePlay();
      dispose();
      mount.remove();
    }
  },
  30000,
);

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

it("the built app plays each soloed track after Use sound", async () => {
  await page.viewport(1280, 960);
  await cdp().send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  const frame = document.createElement("iframe");
  frame.style.width = "390px";
  frame.style.height = "844px";
  document.body.append(frame);
  const win = frame.contentWindow!;
  const doc = frame.contentDocument!;
  doc.open();
  // Observe the actual built app's output without importing its session or
  // installing an extra store-to-engine bridge in the test.
  let tap: AnalyserNode | undefined;
  const proto = (win as unknown as { AudioNode: typeof AudioNode }).AudioNode
    .prototype;
  const connect = proto.connect;
  proto.connect = function (
    destination: AudioNode | AudioParam,
    ...args: number[]
  ) {
    if (destination === this.context.destination) {
      tap = this.context.createAnalyser();
      tap.fftSize = 2048;
      connect.call(this, tap);
    }
    const invoke = connect as unknown as (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      output?: number,
      input?: number,
    ) => AudioNode | undefined;
    return invoke.call(this, destination, ...args);
  } as typeof connect;
  doc.write(
    `<!doctype html><html><head><link rel="stylesheet" href="${Object.keys(cssGlob)[0].replace("/dist/", "/")}" /></head><body><div id="root"></div><script type="module" src="${Object.keys(bundleGlob)[0].replace("/dist/", "/")}"></script></body></html>`,
  );
  doc.close();
  const $ = <E extends Element>(selector: string) => {
    const element = doc.querySelector<E>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element;
  };
  const audible = async (label: string) => {
    const samples = new Float32Array(2048);
    await vi.waitFor(
      () => {
        expect(tap).toBeTruthy();
        tap!.getFloatTimeDomainData(samples);
        expect(Math.max(...samples.map(Math.abs)), label).toBeGreaterThan(
          0.001,
        );
      },
      { timeout: 4000, interval: 30 },
    );
  };
  const tapButton = async (selector: string) => {
    const element = $<HTMLButtonElement>(selector);
    element.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 100));
    const rect = element.getBoundingClientRect();
    const tester = (window.frameElement as HTMLElement).getBoundingClientRect();
    const app = frame.getBoundingClientRect();
    await trustedTapAt({
      x:
        tester.left +
        ((app.left + rect.left + rect.width / 2) * tester.width) / innerWidth,
      y:
        tester.top +
        ((app.top + rect.top + rect.height / 2) * tester.height) / innerHeight,
    });
  };
  try {
    await vi.waitFor(
      () =>
        expect(doc.querySelector(".head-sound-browse")?.textContent).toContain(
          "SOFT STEP",
        ),
      { timeout: 15000 },
    );
    for (const [lane, id] of [
      ["drums", "kit-warehouse"],
      ["bass", "preset-bass-2"],
      ["chords", "preset-bells-crystal"],
      ["lead", "preset-lead-13"],
    ] as const) {
      await tapButton(`#lane-tab-${lane}`);
      await tapButton('button[aria-label^="Solo "]');
      await tapButton(".head-sound-browse");
      const name = (getPreset(id) ?? getDrumKit(id))!.name;
      const input = $<HTMLInputElement>(".sound-search input");
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await tapButton(`.sound-preview[aria-label="Preview ${name}"]`);
      await vi.waitFor(
        () => expect($<HTMLButtonElement>(".sound-use").disabled).toBe(false),
        { timeout: 10000 },
      );
      await tapButton(".sound-use");
      await tapButton(".booth-btn-play");
      await new Promise((r) => setTimeout(r, 2500));
      await audible(`built app soloed ${lane} after applying ${name}`);
      await tapButton(".booth-btn-play");
      await tapButton('button[aria-label^="Solo "]');
    }
  } finally {
    tap?.disconnect();
    await tap?.context.close();
    frame.remove();
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}, 60000);
