/**
 * DA-3 browser journey — the FULL make-a-loop + arrange + export walkthrough
 * driven ENTIRELY BY KEYBOARD against the REAL BUILT APP (dist/ bundle served
 * by the browser project's publicDir, exactly as deployed). The scripted
 * journey is recorded as documentation in docs/dev/keyboard.md §"DA-3
 * scripted journey" — this test IS that script.
 *
 * Stages (town-hall AC #8 "grid editing fully keyboard-operable"):
 *   1. first-run boot (IndexedDB wiped → WELCOME SONG demo, PX-1)
 *   2. Space PLAY (body-level transport shortcut)
 *   3. help overlay consulted mid-journey ("?" → focus-trapped dialog → Esc)
 *   4. drums grid navigation (roving seed → arrows → beat jump)
 *   5. euclid fill via keyboard (steppers preview → SET commits)
 *   6. cell toggle (Enter on a focused gridcell)
 *   7. quadrant select (PageDown → BASS; LY-1: announces NOW EDITING BASS,
 *      focus carried — the v0 lane-move key is now the quadrant selector)
 *   8. preset stepper + gate stepper via keyboard
 *   9. lane scale override via the popover (root + mode + OVERRIDE LANE)
 *  10. FX device added + param tweaked by keyboard
 *  11. quantized pattern switch (tile Enter while playing → PENDING → lands)
 *  12. stop · duplicate pattern (DUP) + append to chain (+ key on a tile)
 *  13. EXPORT WAV → EXPORT MIDI via the Projects popover (downloads recorded
 *      through a URL.createObjectURL seam)
 *  14. NEW project, then Escape out of the popover (focus trap exit)
 *
 * Synthetic-keyboard honesty note (same law as the DA-1 journey): synthetic
 * KeyboardEvents exercise every keydown path the app installs, but they do
 * NOT carry the browser's default activation behavior — a real Enter/Space
 * on a focused <button> synthesizes a click; a real Arrow key on a focused
 * <input type=range> steps the thumb. Those default actions are platform
 * guarantees for native elements, so `kbActivate()` (focus + Enter keydown +
 * click) and `kbStepSlider()` (focus + Arrow keydown + stepUp + input event)
 * replicate exactly what a real keypress does, while the keydown dispatches
 * prove the app's own handlers fire and never double-act.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const T = {
  boot: 15_000,
  ui: 5_000,
  switch: 30_000,
  render: 90_000,
};

function poll(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      if (cond()) return resolve();
      if (performance.now() - t0 > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(check, 50);
    };
    check();
  });
}

describe("DA-3 full keyboard journey (built app)", () => {
  it(
    "make-a-loop + arrange + export without ever touching the mouse",
    { timeout: 240_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      const iframe = document.createElement("iframe");
      iframe.style.width = "1280px";
      iframe.style.height = "960px";
      document.body.appendChild(iframe);
      const win = iframe.contentWindow!;
      const downloads: string[] = [];
      const origCreateObjectURL = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = (blob: Blob) => {
        const url = origCreateObjectURL(blob);
        downloads.push(`${blob.type} ${blob.size}B`);
        return url;
      };

      // Deterministic FIRST RUN: wipe the shared-origin IndexedDB before any
      // app code exists, so boot takes the PX-1 demo path.
      await new Promise<void>((resolve) => {
        const req = win.indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      const doc0 = iframe.contentDocument!;
      doc0.open();
      doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
      doc0.close();

      const idoc = () => iframe.contentDocument!;
      const key = (
        el: Element,
        k: string,
        opts: KeyboardEventInit = {},
      ): void => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
            ...opts,
          }),
        );
      };
      const active = (): HTMLElement | null =>
        idoc().activeElement as HTMLElement | null;
      /** Native Enter activation (see header note). */
      const kbActivate = (el: Element): void => {
        (el as HTMLElement).focus();
        key(el, "Enter");
        (el as HTMLElement).click();
      };
      /** Native Arrow stepping on a range input, ×n (see header note). */
      const kbStepSlider = (el: HTMLInputElement, times: number): void => {
        el.focus();
        for (let i = 0; i < times; i++) {
          key(el, "ArrowRight");
          el.stepUp();
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      const $ = <T extends Element>(sel: string): T => {
        const el = idoc().querySelector<T>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      const $$ = <T extends Element>(sel: string): T[] =>
        Array.from(idoc().querySelectorAll<T>(sel));

      try {
        // --- 1. BOOT: first-run demo song --------------------------------
        await poll(
          () => !!idoc().querySelector(".booth"),
          T.boot,
          "app to mount",
        );
        const playBtn = () => $<HTMLButtonElement>(".booth-btn-play");
        // Demo loaded (PX-1): the rail carries named section cues.
        await poll(
          () => $$(".rail-tile-cue").some((c) => c.textContent === "VERSE"),
          T.ui,
          "demo cue labels in the rail",
        );
        expect($$(".lane-grid").length).toBe(4);

        // --- 2. PLAY by body-level Space ---------------------------------
        idoc().body.focus();
        key(idoc().body, " ");
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          T.ui,
          "play to start",
        );

        // --- 3. HELP mid-journey (? → dialog → Esc) -----------------------
        key(idoc().body, "?");
        const help = $(".help-panel");
        expect(help.getAttribute("role")).toBe("dialog");
        await poll(() => help.contains(active()), T.ui, "help focus trap");
        key(help, "Escape");
        await poll(
          () => !idoc().querySelector(".help-panel"),
          T.ui,
          "help to close",
        );

        // --- 4. DRUMS GRID NAVIGATION -------------------------------------
        const drums = $(`.lane-floor[data-lane="drums"]`);
        const seed = [...drums.querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed.focus();
        key(active() ?? seed, "ArrowDown"); // KICK → SNARE row
        key(active() ?? seed, "End");
        expect((active() as HTMLElement).dataset.step).toBe("15");
        key(active() ?? seed, "Home");
        key(active() ?? seed, "."); // beat jump alternates: , . (spec map)
        expect((active() as HTMLElement).dataset.step).toBe("4");

        // --- 5. EUCLID FILL via keyboard ----------------------------------
        // The SNARE row's fill rail: + pulses twice (armed → dashed preview),
        // then SET commits. Row state is observable through data-on cells.
        const snareCell = (i: number) =>
          $$('.lane-floor[data-lane="drums"] .grid-row')[1]!.querySelectorAll(
            ".cell",
          )[i]!;
        const fillRail = $('.row-fill[data-row="1"]');
        const morePulses = fillRail.querySelector<HTMLButtonElement>(
          'button[aria-label="More pulses for SNARE fill"]',
        )!;
        const pulsesValue = () =>
          Number(
            (
              fillRail.querySelector(".row-fill-value")!.textContent ?? "0/16"
            ).split("/")[0],
          );
        kbActivate(morePulses); // arm (custom rows re-arm at current density)
        const pulsesArmed = pulsesValue();
        kbActivate(morePulses); // raise by one
        expect(pulsesValue()).toBe(pulsesArmed + 1);
        const pulsesNow = pulsesValue();
        expect(pulsesNow).toBeGreaterThanOrEqual(1);
        await poll(
          () =>
            $$('.lane-floor[data-lane="drums"] .cell[data-preview="true"]')
              .length > 0,
          T.ui,
          "euclid preview overlay",
        );
        kbActivate(
          fillRail.querySelector<HTMLButtonElement>(
            'button[aria-label^="Apply Euclidean fill to SNARE"]',
          )!,
        );
        await poll(
          () => {
            const onCount = Array.from({ length: 16 }, (_, i) =>
              snareCell(i),
            ).filter((c) => c.dataset.on === "true").length;
            return (
              onCount === pulsesNow &&
              $$('.lane-floor[data-lane="drums"] .cell[data-preview="true"]')
                .length === 0
            );
          },
          T.ui,
          "euclid commit to paint the row",
        );

        // --- 6. CELL TOGGLE (Enter on the focused gridcell) ----------------
        // (Focus sits on the SET button after the fill; step back into the
        // row the grid way — the roving seed, then ArrowDown into SNARE.)
        const seed2 = [...drums.querySelectorAll(".cell")].find(
          (c) => c.tabIndex === 0,
        ) as HTMLElement;
        seed2.focus();
        key(active() ?? seed2, "ArrowDown");
        const cell = active() as HTMLElement;
        expect(cell.classList.contains("cell")).toBe(true);
        const wasOn = cell.dataset.on === "true";
        key(cell, "Enter");
        await poll(
          () => cell.dataset.on === String(!wasOn),
          T.ui,
          "cell toggle",
        );

        // --- 7. QUADRANT SELECT → BASS (LY-1 ledger #1: the v0 lane-move
        // key now SELECTS the quadrant + announces NOW EDITING BASS; focus
        // is carried into the newly editable bass grid at the same cell.)
        key(cell, "PageDown");
        await poll(
          () => $(`.lane-floor[data-lane="bass"]`).contains(active()),
          T.ui,
          "quadrant select carries focus into bass",
        );
        expect($(".stage-status").textContent).toBe("NOW EDITING BASS");

        // --- 8. PRESET + GATE STEPPERS --------------------------------------
        const bassSound = $('[aria-label="BASS sound"]');
        const presetName = () =>
          bassSound.querySelector(".head-ctl-value")!.textContent ?? "";
        const presetBefore = presetName();
        kbActivate(
          bassSound.querySelector<HTMLButtonElement>(
            'button[aria-label="Next preset for BASS"]',
          )!,
        );
        await poll(
          () => presetName() !== presetBefore && presetName() !== "",
          T.ui,
          "preset stepper",
        );
        const bassGate = $('[aria-label="BASS gate length"]');
        const gateText = () =>
          bassGate.querySelector(".head-ctl-value")!.textContent ?? "";
        const gateBefore = Number((gateText().match(/(\d+)/) ?? ["", "1"])[1]);
        kbActivate(
          bassGate.querySelector<HTMLButtonElement>(
            'button[aria-label="Longer gate for BASS"]',
          )!,
        );
        await poll(
          () => gateText().startsWith(String(gateBefore + 1)),
          T.ui,
          "gate stepper",
        );

        // --- 9. LANE SCALE OVERRIDE (popover, keyboard) ----------------------
        const chip = $(`.lane-floor[data-lane="bass"] .scale-chip`);
        kbActivate(chip);
        const pop = $(".scale-pop");
        expect(pop.contains(active())).toBe(true);
        kbActivate(pop.querySelector<HTMLButtonElement>('[data-root="2"]')!); // D
        kbActivate(
          pop.querySelector<HTMLButtonElement>('[data-mode="dorian"]')!,
        );
        kbActivate(pop.querySelector(".scale-pop-commit")); // OVERRIDE LANE
        await poll(
          () => !idoc().querySelector(".scale-pop"),
          T.ui,
          "popover close",
        );
        await poll(
          () =>
            chip.classList.contains("is-lane") &&
            (chip.textContent ?? "").includes("D"),
          T.ui,
          "lane-override chip",
        );
        // Cancel path: reopen + Escape closes and refocuses the chip.
        kbActivate(chip);
        await poll(
          () => !!idoc().querySelector(".scale-pop"),
          T.ui,
          "popover reopen",
        );
        key($(".scale-pop"), "Escape");
        await poll(
          () => !idoc().querySelector(".scale-pop"),
          T.ui,
          "popover cancel",
        );
        expect(active()).toBe(chip);

        // --- 10. FX DEVICE + PARAM ------------------------------------------
        kbActivate($(`.lane-floor[data-lane="bass"] .head-fx`));
        await poll(
          () => !!idoc().querySelector('.fx-strip[data-lane="bass"]'),
          T.ui,
          "fx strip",
        );
        kbActivate($(".fx-add-btn"));
        await poll(
          () => !!idoc().querySelector(".fx-add-menu"),
          T.ui,
          "add menu",
        );
        // Menu convention (DA-3 fix): focus landed inside the menu.
        await poll(
          () => $(".fx-add-menu").contains(active()),
          T.ui,
          "add menu focus",
        );
        kbActivate($(".fx-add-item")); // first device (FILTER)
        await poll(
          () => $$('.fx-strip[data-lane="bass"] .fx-mod').length === 3,
          T.ui,
          "third fx module",
        );
        // Param tweak: range input stepped by keyboard (5 arrow presses —
        // the log cutoff map can round a single step to the same readout).
        // NOTE: each param commit rebuilds the module DOM (For reference
        // diff), so re-query the slider FRESH every press.
        const sliderReadout = () =>
          $<HTMLInputElement>(".fx-param-slider")
            .closest("label")
            ?.querySelector(".fx-param-readout")?.textContent ?? "";
        const readoutBefore = sliderReadout();
        for (let i = 0; i < 5; i++)
          kbStepSlider($<HTMLInputElement>(".fx-param-slider"), 1);
        await poll(
          () => sliderReadout() !== readoutBefore,
          T.ui,
          "fx param readout",
        );

        // --- 11. QUANTIZED SWITCH while playing ------------------------------
        const bassRow = $('.rail-row[data-lane="bass"]');
        const tiles = () =>
          Array.from(bassRow.querySelectorAll<HTMLButtonElement>(".rail-tile"));
        expect(tiles().length).toBe(4); // demo bass chain: 4 distinct patterns
        tiles()[0]!.focus();
        // Rove to the last tile (arrows per the rail map) and trigger it.
        for (let i = 1; i < tiles().length; i++) key(active()!, "ArrowRight");
        const target = active() as HTMLButtonElement;
        kbActivate(target);
        let sawPending = false;
        await poll(
          () => {
            sawPending ||= target.dataset.state === "pending";
            return (
              target.dataset.state === "active" ||
              target.dataset.state === "selected"
            );
          },
          T.switch,
          "quantized switch to land",
        );
        expect(sawPending, "switch never showed its pending state").toBe(true);
        expect(target.getAttribute("aria-label") ?? "").not.toContain(
          "switch pending",
        );

        // --- 12. STOP · DUPLICATE · APPEND ------------------------------------
        idoc().body.focus();
        key(idoc().body, " ");
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          T.ui,
          "stop",
        );
        kbActivate(
          bassRow.querySelector<HTMLButtonElement>(
            'button[aria-label="Duplicate BASS selected pattern"]',
          )!,
        );
        const tilesBefore = tiles().length;
        // "+" on a focused tile appends the selected pattern (DA-3 spec fix).
        const lastTile = tiles()[tiles().length - 1]!;
        lastTile.focus();
        key(lastTile, "+");
        await poll(
          () => tiles().length === tilesBefore + 1,
          T.ui,
          "chain append",
        );
        // Escape from a tile pops to the rail head (the view toggle).
        key(active() ?? lastTile, "Escape");
        await poll(
          () => active()?.classList.contains("rail-view-toggle") === true,
          T.ui,
          "rail Escape → rail head",
        );

        // --- 13. EXPORTS via the Projects popover ------------------------------
        kbActivate($(".projects-btn"));
        await poll(
          () => !!idoc().querySelector(".projects-pop"),
          T.ui,
          "projects popover",
        );
        const actionByLabel = async (label: string) => {
          for (let i = 0; i < 60; i++) {
            const b = $$(".projects-action").find(
              (x) => x.textContent?.trim() === label && !x.disabled,
            );
            if (b) return b;
            await new Promise((r) => setTimeout(r, 50));
          }
          throw new Error(`projects action ${label} not found`);
        };
        kbActivate(await actionByLabel("EXPORT WAV"));
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              t.textContent?.includes("WAV EXPORTED"),
            ),
          T.render,
          "WAV export toast",
        );
        kbActivate(await actionByLabel("EXPORT MIDI"));
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              t.textContent?.includes("MIDI EXPORTED"),
            ),
          T.render,
          "MIDI export toast",
        );
        expect(downloads.some((d) => d.startsWith("audio/wav"))).toBe(true);
        expect(downloads.some((d) => d.startsWith("audio/midi"))).toBe(true);

        // --- 14. NEW PROJECT + Escape out of the popover -----------------------
        kbActivate(await actionByLabel("NEW"));
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              t.textContent?.includes("NEW PROJECT READY"),
            ),
          T.ui,
          "new project toast",
        );
        await poll(
          () =>
            (idoc().querySelector(".stage-hint")?.textContent ?? "").includes(
              "PICK A PRESET",
            ),
          T.ui,
          "empty-project stage note",
        );
        // Popover closed itself on NEW; reopen and Escape to prove the trap
        // releases focus back to the PROJECTS button.
        kbActivate($(".projects-btn"));
        await poll(
          () => !!idoc().querySelector(".projects-pop"),
          T.ui,
          "popover reopen",
        );
        key($(".projects-pop"), "Escape");
        await poll(
          () => !idoc().querySelector(".projects-pop"),
          T.ui,
          "popover escape",
        );
        expect(active()?.classList.contains("projects-btn")).toBe(true);
      } finally {
        // Teardown (DA-3 fix): the journey ends on a NEW empty project that
        // autosaved into the shared-origin IndexedDB. Left behind, it makes
        // any LATER same-origin boot (e.g. the DA-2 axe gate, which mounts
        // the app in the outer page) restore the EMPTY project and render
        // the empty-state hint under test. Remove the iframe FIRST (closing
        // its open DB connections — deleting under a live connection only
        // blocks), then wipe via the outer same-origin window, the same
        // deterministic wipe as the start, so no journey state leaks across
        // test files.
        iframe.remove();
        // Deleting under a still-live connection blocks; retry briefly until
        // the removed iframe's connections are gone and the delete lands.
        for (let attempt = 0; ; attempt++) {
          const deleted = await new Promise<boolean>((resolve) => {
            const req = indexedDB.deleteDatabase("bitbounce");
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(true);
            req.onblocked = () => resolve(false);
          });
          if (deleted || attempt >= 20) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
    240_000,
  );
});
