import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import VizPage from "../../src/components/VizPage";
import {
  composition,
  resetCompositionForTests,
} from "../../src/viz/compositionState";
import { COMPOSITION_KEY, VISUAL_EFFECTS } from "../../src/viz/composition";
import { activeCompositionEngines } from "../../src/viz/compositionEngine";
import { liveVizRendererCount } from "../../src/viz/renderer";
import { activeVizPipelines } from "../../src/viz/pipeline";
import { getSession } from "../../src/engine/session";
import { docStore } from "../../src/state/store";
import axe from "axe-core";
import { page, cdp, userEvent } from "vitest/browser";
import { vizRendererProbes } from "../../src/viz/renderer";
import { activeVizAnnouncers } from "../../src/viz/announcements";
import { activeVizActivitySummarizers } from "../../src/viz/textEquivalence";
import "../../src/styles/base.css";

let cleanup: (() => void) | undefined;
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  localStorage.removeItem(COMPOSITION_KEY);
  resetCompositionForTests();
  delete (document as unknown as { hidden?: boolean }).hidden;
  document.dispatchEvent(new Event("visibilitychange"));
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await page.viewport(1280, 800);
});
function mount() {
  resetCompositionForTests();
  localStorage.removeItem(COMPOSITION_KEY);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <VizPage />, host);
  cleanup = () => {
    dispose();
    host.remove();
  };
  return host;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe("composition inspector", () => {
  it("selects lanes, assigns effects, sets and persists orbit strength without editing the song", async () => {
    const host = mount(),
      doc = JSON.stringify(docStore.getState().doc),
      playing = getSession().transport.snapshot.playing;
    const bass = host.querySelector<HTMLButtonElement>(
      '[aria-label="Select bass"]',
    )!;
    bass.click();
    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label$="visual effect"]',
    )!;
    expect(select.getAttribute("aria-label")).toBe("bass visual effect");
    select.value = "torus";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(composition().lanes.bass.effect).toBe("torus");
    expect(activeCompositionEngines()).toHaveLength(1);
    const mode = host.querySelector<HTMLSelectElement>(
      '[aria-label="Motion direction"]',
    )!;
    mode.value = "orbit";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const orbit = host.querySelector<HTMLInputElement>(
      '[aria-label="bass orbit strength"]',
    )!;
    orbit.value = "85";
    orbit.dispatchEvent(new Event("input", { bubbles: true }));
    orbit.dispatchEvent(new Event("change", { bubbles: true }));
    expect(composition().lanes.bass.orbitStrength).toBe(85);
    expect(
      JSON.parse(localStorage.getItem(COMPOSITION_KEY)!).lanes.bass
        .orbitStrength,
    ).toBe(85);
    expect(composition().lanes.drums.effect).toBe("fracture");
    expect(JSON.stringify(docStore.getState().doc)).toBe(doc);
    expect(getSession().transport.snapshot.playing).toBe(playing);
    const axeResult = await axe.run(host, {
      rules: { region: { enabled: false } },
    });
    expect(
      axeResult.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
  it("persists motion and blending, preserving both on reroll", async () => {
    const host = mount();
    expect(composition().motion).toBe("fluid");
    expect(composition().blended).toBe(true);
    const mode = host.querySelector<HTMLSelectElement>(
      '[aria-label="Motion direction"]',
    )!;
    const blend = host.querySelector<HTMLSelectElement>(
      '[aria-label="Instrument blending"]',
    )!;
    mode.value = "trails";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    blend.value = "distinct";
    blend.dispatchEvent(new Event("change", { bubbles: true }));
    host.querySelector<HTMLButtonElement>(".viz-reroll")!.click();
    await wait(200);
    const saved = JSON.parse(localStorage.getItem(COMPOSITION_KEY)!);
    expect(saved.motion).toBe("trails");
    expect(saved.blended).toBe(false);
    expect(
      host.querySelector('[aria-label="drums orbit strength"]'),
    ).toBeNull();
    mode.value = "orbit";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(blend.disabled).toBe(true);
    expect(
      host.querySelector('[aria-label="drums orbit strength"]'),
    ).not.toBeNull();
    mode.value = "fluid";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(blend.disabled).toBe(false);
    expect(blend.value).toBe("distinct");
  });
  it("renders every library effect, rerolls all layers, and cancels pending reroll on disposal", async () => {
    const host = mount(),
      select = host.querySelector<HTMLSelectElement>(
        '[aria-label$="visual effect"]',
      )!;
    for (const effect of VISUAL_EFFECTS) {
      select.value = effect.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(20);
      expect(host.querySelector(".viz-error")!.textContent).toBe("");
    }
    const prior = composition();
    const button = host.querySelector<HTMLButtonElement>(".viz-reroll")!;
    for (let i = 0; i < 20; i++) button.click();
    await wait(200);
    expect(composition().seed).not.toBe(prior.seed);
    expect(composition().lanes.lead.x).not.toBe(prior.lanes.lead.x);
    const saved = composition();
    button.click();
    cleanup?.();
    cleanup = undefined;
    await wait(200);
    expect(composition()).toEqual(saved);
    expect(activeCompositionEngines()).toHaveLength(0);
    expect(liveVizRendererCount()).toBe(0);
    expect(activeVizPipelines()).toHaveLength(0);
    expect(activeVizAnnouncers()).toHaveLength(0);
    expect(activeVizActivitySummarizers()).toHaveLength(0);
  });
  it("adjusts the orbit with the keyboard independently of scale and other lanes", async () => {
    const host = mount();
    const mode = host.querySelector<HTMLSelectElement>(
      '[aria-label="Motion direction"]',
    )!;
    mode.value = "orbit";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const before = composition();
    const slider = host.querySelector<HTMLInputElement>(
      '[aria-label="drums orbit strength"]',
    )!;
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(composition().lanes.drums.orbitStrength).toBe(61);
    expect(composition().lanes.drums.scale).toBe(before.lanes.drums.scale);
    expect(composition().lanes.bass).toEqual(before.lanes.bass);
    expect(host.querySelector(".viz-anchor")).toBeNull();
  });
  it("parks the renderer while hidden and resumes without multiplying loops", async () => {
    mount();
    await wait(60);
    expect(vizRendererProbes()[0]!.state).toBe("running");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vizRendererProbes()[0]!.state).toBe("parked");
    const frames = vizRendererProbes()[0]!.frames;
    await wait(80);
    expect(vizRendererProbes()[0]!.frames).toBe(frames);
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
    await wait(60);
    expect(liveVizRendererCount()).toBe(1);
    expect(vizRendererProbes()[0]!.frames).toBeGreaterThan(frames);
  });
  it("keeps reduced-motion pixels static even under MIDI, with working controls", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const host = mount();
    await wait(60);
    const engine = activeCompositionEngines()[0]!;
    expect(engine.probe().reduced).toBe(true);
    const canvas = host.querySelector<HTMLCanvasElement>("canvas")!,
      ctx = canvas.getContext("2d")!;
    const pixels = () =>
      Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    // Warm canvas readback before comparing frames across Chromium backends.
    await document.fonts.ready;
    pixels();
    await wait(70);
    const before = pixels();
    engine.ignite({ lane: "drums", pitch: 99, velocity: 1, audibleAt: 0 });
    await wait(70);
    expect(pixels()).toEqual(before);
    host
      .querySelector<HTMLButtonElement>('[aria-label="Select lead"]')!
      .click();
    expect(
      host
        .querySelector('[aria-label$="visual effect"]')!
        .getAttribute("aria-label"),
    ).toBe("lead visual effect");
  });
  it("contains a draw failure and leaves the exit reachable", async () => {
    const host = mount(),
      engine = activeCompositionEngines()[0]!;
    engine.draw = () => {
      throw Error("test draw fault");
    };
    await wait(80);
    expect(vizRendererProbes()[0]!.state).toBe("error");
    expect(host.querySelector(".viz-error")!.textContent).toContain(
      "Audio is unaffected",
    );
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (b) => b.textContent === "Return to DAW",
      ),
    ).toBe(true);
  });
  it("fits desktop and phone, keeps controls reachable, and restores editing after view mode", async () => {
    const host = mount();
    for (const [width, height, name] of [
      [1440, 900, "desktop"],
      [1280, 800, "desktop-1280"],
      [390, 844, "mobile"],
    ] as const) {
      await cdp().send("Emulation.setDeviceMetricsOverride", {
        width: 1600,
        height: 1200,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.viewport(width, height);
      await wait(60);
      const section = host.querySelector<HTMLElement>(".viz-page")!,
        stage = host.querySelector<HTMLElement>(".viz-stage")!;
      expect(section.scrollWidth).toBeLessThanOrEqual(width);
      expect(section.scrollHeight).toBeLessThanOrEqual(height);
      expect(stage.getBoundingClientRect().height).toBeGreaterThan(195);
      const report = await axe.run(host, {
        rules: { region: { enabled: false } },
      });
      expect(report.violations.map((v) => v.id)).toEqual([]);
      if (import.meta.env.VITE_VIZ_CAPTURE === "1") {
        // Vitest's visible runner scales its iframe to fit the runner panel.
        // Remove that harness-only transform for 1:1 artifact screenshots.
        const ancestors: [HTMLElement, string][] = [];
        let parent = window.frameElement?.parentElement;
        while (parent) {
          ancestors.push([parent, parent.style.cssText]);
          parent.style.setProperty("transform", "none", "important");
          parent = parent.parentElement;
        }
        try {
          await page.screenshot({
            element: section,
            path: `../../.impeccable/review/${name}.png`,
          });
        } finally {
          for (const [el, css] of ancestors) el.style.cssText = css;
        }
      }
    }
    await page.getByRole("button", { name: "Hide controls" }).click();
    expect(getComputedStyle(host.querySelector(".viz-remote")!).display).toBe(
      "none",
    );
    await userEvent.keyboard("{Escape}");
    expect(
      getComputedStyle(host.querySelector(".viz-remote")!).display,
    ).not.toBe("none");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Select drums",
    );
  });
});
