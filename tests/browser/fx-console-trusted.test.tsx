import { setTheme, theme } from "../../src/state/theme";
/** Mixer replaces the former instrument FX overlays. Exercise the real screen
 * with trusted clicks, saved effects, optional tracks and keyboard access. */
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import axe from "axe-core";
import App from "../../src/App";
import {
  addInstrumentLane,
  createFreshProjectDocument,
  docStore,
  loadDocument,
  undo,
} from "../../src/state/store";
import { showPhonePage } from "../../src/state/phonePage";
import { getAutosaveController } from "../../src/persist/boot";

async function waitFor(test: () => boolean): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Mixer condition was not reached");
}
describe("Mixer and relocated creative effects", () => {
  it(
    "moves FX to Mixer, saves edits, supports all eight channels and has accessible controls",
    { timeout: 30000 },
    async () => {
      await page.viewport(1440, 1000);
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = render(() => <App />, host);
      try {
        await waitFor(() => getAutosaveController() !== null);
        loadDocument(createFreshProjectDocument());
        showPhonePage("edit");
        expect(
          host.querySelector('.lane-floor button[aria-label^="FX chain"]'),
        ).toBeNull();
        expect(host.querySelector(".lane-fx-wrap")).toBeNull();
        await page.getByRole("button", { name: "Mixer", exact: true }).click();
        await waitFor(() => !!host.querySelector(".mixer-page"));
        expect(host.querySelectorAll(".mixer-strip").length).toBe(5);
        await page
          .getByRole("button", { name: "+ ADD FX", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "FILTER", exact: true })
          .click();
        expect(docStore.getState().doc.lanes[0].fxChain[0].type).toBe("filter");
        await page
          .getByRole("button", { name: "Enable equalizer", exact: true })
          .click();
        expect(docStore.getState().doc.mixer?.channels.drums?.eq.enabled).toBe(
          true,
        );
        undo();
        expect(docStore.getState().doc.mixer).toBeUndefined();
        for (let i = 0; i < 4; i++) addInstrumentLane();
        expect(host.querySelectorAll(".mixer-strip").length).toBe(9);
        expect(
          host.querySelector('[aria-label="Bells, track 8 level"]'),
        ).toBeTruthy();
        await page
          .getByRole("button", { name: "Master processing", exact: true })
          .click();
        await page
          .getByRole("button", { name: "+ ADD FX", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "DELAY", exact: true })
          .click();
        await page
          .getByRole("button", { name: "+ ADD FX", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "FILTER", exact: true })
          .click();
        expect(
          docStore.getState().doc.mixer?.master.fxChain?.map((d) => d.type),
        ).toEqual(["delay", "filter"]);
        await page
          .getByRole("button", {
            name: "Move FILTER module earlier",
            exact: true,
          })
          .click();
        expect(docStore.getState().doc.mixer?.master.fxChain?.[0].type).toBe(
          "filter",
        );
        await page
          .getByRole("button", { name: "Bypass FILTER", exact: true })
          .click();
        expect(
          docStore.getState().doc.mixer?.master.fxChain?.[0].bypassed,
        ).toBe(true);
        const cards = [
          ...host.querySelectorAll<HTMLElement>(
            ".mixer-rack .fx-mod, .mixer-rack .mixer-device",
          ),
        ].map((el) => el.getBoundingClientRect());
        expect(cards.length).toBe(4);
        expect(
          cards.every(
            (rect) =>
              rect.width >= 185 &&
              rect.height === 308 &&
              Math.abs(rect.top - cards[0].top) < 1,
          ),
        ).toBe(true);
        expect(
          cards.slice(1).every((rect, i) => rect.left > cards[i].left),
        ).toBe(true);
        await page
          .getByRole("button", { name: "Enable master limiter", exact: true })
          .click();
        expect(docStore.getState().doc.mixer?.master.limiter.enabled).toBe(
          true,
        );
        const saved = JSON.parse(JSON.stringify(docStore.getState().doc));
        loadDocument(saved);
        expect(docStore.getState().doc.mixer?.master.limiter.enabled).toBe(
          true,
        );
        await page
          .getByRole("button", { name: "Instruments 1–4", exact: true })
          .click();
        expect(host.querySelector(".mixer-page")).toBeNull();
        expect(docStore.getState().doc.lanes[0].fxChain).toHaveLength(1);
        await page.getByRole("button", { name: "Mixer", exact: true }).click();
        const initialTheme = theme();
        try {
          for (const palette of ["dark", "light"] as const) {
            setTheme(palette);
            const result = await axe.run(host.querySelector(".mixer-page")!, {
              rules: { region: { enabled: false } },
            });
            expect(
              result.violations.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => n.failureSummary),
              })),
            ).toEqual([]);
          }
        } finally {
          setTheme(initialTheme);
        }
        await page.viewport(390, 844);
        await waitFor(
          () =>
            host.querySelector(".app")?.getAttribute("data-stage") === "phone",
        );
        const controls = host.querySelectorAll<HTMLElement>(
          '.mixer-page button, .mixer-page input[type="range"], .phone-mixer-nav button',
        );
        for (const control of controls)
          if (control.getClientRects().length) {
            expect(
              control.getBoundingClientRect().height,
              control.getAttribute("aria-label") ?? control.textContent ?? "",
            ).toBeGreaterThanOrEqual(44);
          }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          innerWidth,
        );
      } finally {
        dispose();
        host.remove();
        await getAutosaveController()?.stop();
        showPhonePage("edit");
      }
    },
  );
});
