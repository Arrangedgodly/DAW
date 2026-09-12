import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "solid-js/web";
import "../../src/styles/base.css";
import App from "../../src/App";
import { createDemoProject } from "../../src/document/demoSong";
import { pitchDomain, midiLabel } from "../../src/document/pitchWindow";
import { encode, decode } from "../../src/document/codec";
import { docStore, loadDocument } from "../../src/state/store";
import { selectLane, registerWindowStart } from "../../src/state/selection";
import { getAutosaveController } from "../../src/persist/boot";

it("higher notes render above lower notes; octave view and keyboard editing preserve pitch identity", async () => {
  await page.viewport(1440, 1000);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => <App />, host);
  try {
    await expect
      .poll(() => getAutosaveController(), { timeout: 10000 })
      .not.toBeNull();
    loadDocument(createDemoProject());
    selectLane("lead");
    await expect
      .poll(
        () =>
          host.querySelectorAll('.lane-floor[data-lane="lead"] .grid-row')
            .length,
      )
      .toBeGreaterThan(40);
    const doc = docStore.getState().doc;
    for (const lane of ["bass", "chords", "lead"] as const) {
      const domain = pitchDomain(doc, lane);
      const rows = [
        ...host.querySelectorAll<HTMLElement>(
          `.lane-floor[data-lane="${lane}"] .grid-row`,
        ),
      ];
      expect(
        rows.map((row) => row.querySelector(".row-label")?.textContent),
      ).toEqual(domain.pitches.map(midiLabel));
      for (let i = 1; i < rows.length; i++)
        expect(rows[i].getBoundingClientRect().top).toBeGreaterThan(
          rows[i - 1].getBoundingClientRect().top,
        );
    }
    const domain = pitchDomain(doc, "lead");
    const floor = host.querySelector<HTMLElement>(
      '.lane-floor[data-lane="lead"]',
    )!;
    const button = (label: string) =>
      floor.querySelector<HTMLButtonElement>(
        `button[aria-label="LEAD ${label}"]`,
      )!;
    const initial = registerWindowStart("lead")!;
    button("octave view up").click();
    await expect
      .poll(() => registerWindowStart("lead"))
      .toBe(initial - domain.windowRows);
    button("octave view down").click();
    await expect.poll(() => registerWindowStart("lead")).toBe(initial);
    expect(docStore.getState().doc).toBe(doc);
    // Reach a register beyond the old two-octave grid, then place a note using the real keyboard path.
    for (let i = 0; i < 3; i++) button("octave view up").click();
    const index = registerWindowStart("lead")!;
    const degree = domain.degrees[index];
    expect(degree).toBeGreaterThan(23);
    const cell = floor.querySelector<HTMLElement>(
      `.cell[data-row="${index}"][data-step="0"]`,
    )!;
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect
      .poll(() =>
        docStore
          .getState()
          .doc.patterns.lead.some(
            (p) =>
              p.kind === "pitched" &&
              p.notes.some((n) => n.degree === degree && n.start === 0),
          ),
      )
      .toBe(true);
    const saved = decode(encode(docStore.getState().doc));
    expect(
      saved.patterns.lead.some(
        (p) => p.kind === "pitched" && p.notes.some((n) => n.degree === degree),
      ),
    ).toBe(true);
    const unchanged = docStore.getState().doc;
    const brand = host.querySelector<HTMLElement>(".bitbounce-brand")!;
    expect(brand.getAttribute("aria-label")).toBe("Bitbounce");
    expect(brand.textContent).toContain("Bitbounce.");
    expect(brand.querySelector("img")?.getAttribute("src")).toContain(
      "bitbounce-logo",
    );
    expect(host.querySelectorAll(".lane-meter")).toHaveLength(4);

    const themeButton =
      host.querySelector<HTMLButtonElement>(".theme-selector")!;
    const initialTheme = document.documentElement.dataset.theme;
    themeButton.click();
    expect(document.documentElement.dataset.theme).not.toBe(initialTheme);
    expect(localStorage.getItem("bitbounce.theme.v1")).toBe(
      document.documentElement.dataset.theme,
    );
    expect(docStore.getState().doc).toBe(unchanged);
    themeButton.click();
    await page.viewport(390, 844);
    await expect
      .poll(() => host.querySelector(".app")?.getAttribute("data-stage"))
      .toBe("phone");
    expect(host.querySelectorAll(".bitbounce-brand")).toHaveLength(1);
    for (const lane of ["bass", "chords", "lead"] as const) {
      selectLane(lane);
      await expect
        .poll(() => host.querySelector(`.lane-floor[data-lane="${lane}"]`))
        .not.toBeNull();
      const laneFloor = host.querySelector<HTMLElement>(
        `.lane-floor[data-lane="${lane}"]`,
      )!;
      for (let themeIndex = 0; themeIndex < 2; themeIndex++) {
        host.querySelector<HTMLButtonElement>(".theme-selector")!.click();
        laneFloor
          .querySelector<HTMLButtonElement>(".register-zoom-chip")!
          .click();
        laneFloor
          .querySelector<HTMLButtonElement>(
            `[aria-label="${lane.toUpperCase()} octave view up"]`,
          )!
          .click();
        await expect
          .poll(
            () =>
              laneFloor
                .querySelector(".lane-grid-scroll")
                ?.getBoundingClientRect().bottom,
          )
          .toBeLessThanOrEqual(844);
        await expect
          .poll(() => document.documentElement.scrollHeight)
          .toBeLessThanOrEqual(844);
        const box = laneFloor
          .querySelector(".lane-grid-scroll")!
          .getBoundingClientRect();
        const rows = [...laneFloor.querySelectorAll(".grid-row")].filter(
          (row) => {
            const rect = row.getBoundingClientRect();
            return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
          },
        );
        expect(rows).toHaveLength(7);
        expect(laneFloor.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          844,
        );
      }
    }
  } finally {
    dispose();
    host.remove();
  }
}, 30000);
