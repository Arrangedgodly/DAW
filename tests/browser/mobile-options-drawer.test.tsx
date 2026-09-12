import { readPitchRange } from "./register-readout";
/**
 * M-4 browser gate (iteration 4) — the phone-stage collapsible options
 * drawer, on the REAL BUILT APP (the mobile-transport harness law: iframe +
 * dist bundle, first-run wiped origin).
 *
 * The plan's AC (plan.md "M-4 · Collapsible options drawer"):
 *  1. COLLAPSED = ZERO drawer DOM (the Show law): no panel, no backdrop,
 *     and NONE of the drawer-housed tools (loop, metronome, viz, tempo,
 *     scale, swing, master) exist in the phone DOM — zero drawer Tab stops
 *     by construction. The OPTIONS toggle rides the pinned
 *     `.phone-transport` row, is aria-expanded="false", and carries a
 *     ≥44×44 hit box (the MB-3 strap law).
 *  2. The drawer does NOT displace or cover the centered transport: with
 *     the drawer OPEN the play button's center-x is still within ±8 px of
 *     the viewport center-x and the hit at its center resolves to the
 *     button (nothing covering it).
 *  3. Every named control is reachable + operable from the drawer with an
 *     observable effect (loop and metronome aria-pressed flips ride the
 *     session echo; tempo stepper +1 changes the input value; swing and
 *     master slider input changes the painted value; the scale chip opens
 *     the ScalePopover).
 *  4. Dismissal: Escape and an outside tap close the drawer, focus returns
 *     to the OPTIONS toggle (the helpOverlay/APG precedent), and closing
 *     restores the zero-DOM law.
 *  5. DESKTOP UNCHANGED: at 1280×800 there is no `.phone-transport` row,
 *     no OPTIONS toggle, no drawer — and the Booth's own Playback group
 *     carries LOOP (the m4 byte-identical fallback law).
 *
 * Teeth: probe 1 reddens if the drawer ever paints hidden DOM instead of
 * unmounting (the pre-M-4 chrome itself fails it — the tools lived in the
 * open booth); probe 2 reddens if the drawer grows the chrome sideways or
 * overlays the transport; probe 4 reddens if close leaves DOM behind.
 */

import { describe, expect, it } from "vitest";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

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

/** A deterministic first-run boot (PX-1 demo) in a sized iframe — the
 * mobile-transport.test.ts harness, verbatim law. */
async function bootIframe(
  w: number,
  h: number,
): Promise<{
  iframe: HTMLIFrameElement;
  win: Window;
  $: <T extends Element>(sel: string) => T;
  $$: <T extends Element>(sel: string) => T[];
  idoc: () => Document;
}> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(
    bundleKey,
    "built bundle missing (globalSetup build failed?)",
  ).toBeTruthy();
  const iframe = document.createElement("iframe");
  iframe.style.width = `${w}px`;
  iframe.style.height = `${h}px`;
  document.body.appendChild(iframe);
  const win = iframe.contentWindow!;
  try {
    await wipeOrigin(win);
  } catch (err) {
    iframe.remove();
    throw err;
  }
  const doc0 = iframe.contentDocument!;
  doc0.open();
  doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}"/>
<style>html { scrollbar-width: none; }</style>
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
  doc0.close();
  const idoc = () => iframe.contentDocument!;
  const $ = <T extends Element>(sel: string): T => {
    const el = idoc().querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  const $$ = <T extends Element>(sel: string): T[] =>
    Array.from(idoc().querySelectorAll<T>(sel));
  await poll(() => !!idoc().querySelector(".booth"), 15_000, "boot");
  // 2026-09-11: boot readiness is RAIL-FREE on every stage. The chain moved
  // off the stage into its own SONG page, so rail tiles are no longer proof
  // the demo loaded — and they never were the thing under test here. The
  // drums KIT readout is the stage-independent demo signal (it was already
  // the phone branch's).
  await poll(
    () =>
      $$(".head-ctl-value").some((v) =>
        (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() === "SOFT STEP",
      ),
    5_000,
    "demo loaded",
  );
  if (w < 768) {
    await poll(
      () => !!idoc().querySelector(".phone-transport .booth-btn-play"),
      5_000,
      "pinned phone transport",
    );
  }
  return { iframe, win, $, $$, idoc };
}

async function wipeOrigin(win: Window): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let blocked = false;
    const grace = setTimeout(() => {
      if (blocked)
        reject(
          new Error(
            "bootIframe wipe stayed blocked for 3 s — the first-run boot is not honest",
          ),
        );
    }, 3_000);
    const req = win.indexedDB.deleteDatabase("bitbounce");
    req.onsuccess = req.onerror = () => {
      clearTimeout(grace);
      resolve();
    };
    req.onblocked = () => {
      blocked = true;
    };
  });
}

async function teardown(iframe: HTMLIFrameElement): Promise<void> {
  iframe.remove();
  for (let i = 0; i < 20; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = () => resolve();
        req.onblocked = () => reject(new Error("blocked"));
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** The drawer-housed tools — every one must be ABSENT from the phone DOM
 * while collapsed, and present + operable while open. */
const DRAWER_TOOLS = [
  "booth.loop",
  "booth.metronome",
  "booth.viz",
  "booth.tempo",
  "booth.scale",
  "booth.swing",
  "booth.master",
] as const;

describe("M-4 phone options drawer — collapsible, zero-DOM closed, operable open", () => {
  it(
    "390×844: collapsed zero drawer DOM + no tool Tab stops; open: transport undisplaced, every tool operable, Escape/outside-tap close with focus return",
    { timeout: 180_000 },
    async () => {
      const { iframe, win, $, $$, idoc } = await bootIframe(390, 844);
      try {
        // --- 1. COLLAPSED: the Show law --------------------------------
        expect(
          $$(".phone-options-drawer, .phone-options-backdrop").length,
          "collapsed drawer must contribute ZERO DOM (panel + backdrop)",
        ).toBe(0);
        for (const tool of DRAWER_TOOLS) {
          expect(
            $$(`[data-help="${tool}"]`).length,
            `collapsed drawer must not render ${tool}`,
          ).toBe(0);
        }
        const optionsBtn = $<HTMLElement>('[data-help="phone.options"]');
        expect(
          optionsBtn.closest(".phone-transport"),
          "the OPTIONS toggle rides the pinned transport row",
        ).toBeTruthy();
        expect(optionsBtn.getAttribute("aria-expanded")).toBe("false");

        // The toggle's hit box: painted box ∪ strap (the MB-3 law — it is
        // a .booth-btn inside .phone-chrome, so the ::before strap applies;
        // lattice-scan like the target-size measurement law).
        const strapBelongs = (x: number, y: number) => {
          const hit = idoc().elementFromPoint(x, y);
          return hit === optionsBtn || optionsBtn.contains(hit);
        };
        const obr = optionsBtn.getBoundingClientRect();
        const ocx = obr.left + obr.width / 2;
        const ocy = obr.top + obr.height / 2;
        let oLeft = ocx;
        let oRight = ocx;
        let oTop = ocy;
        let oBottom = ocy;
        const guard = 60;
        while (oLeft > ocx - guard && strapBelongs(oLeft - 1, ocy)) oLeft--;
        while (oRight < ocx + guard && strapBelongs(oRight + 1, ocy)) oRight++;
        while (oTop > ocy - guard && strapBelongs(ocx, oTop - 1)) oTop--;
        while (oBottom < ocy + guard && strapBelongs(ocx, oBottom + 1))
          oBottom++;
        const hitW =
          Math.max(obr.right, oRight + 0.5) - Math.min(obr.left, oLeft - 0.5);
        const hitH =
          Math.max(obr.bottom, oBottom + 0.5) - Math.min(obr.top, oTop - 0.5);
        expect(
          hitW >= 44 && hitH >= 44,
          `OPTIONS hit box ${hitW.toFixed(1)}×${hitH.toFixed(1)} < 44×44`,
        ).toBe(true);

        // Transport undisplaced by the CLOSED drawer: centered ±8.
        const play = $<HTMLElement>(".phone-transport .booth-btn-play");
        const playCenterX = () => {
          const r = play.getBoundingClientRect();
          return r.left + r.width / 2;
        };
        expect(
          Math.abs(playCenterX() - win.innerWidth / 2),
        ).toBeLessThanOrEqual(8);
        const closedCenterX = playCenterX();

        // --- 2. OPEN: drawer + backdrop, transport still centered -------
        optionsBtn.click();
        await poll(
          () => $$(".phone-options-drawer").length === 1,
          5_000,
          "drawer panel",
        );
        expect($$(".phone-options-backdrop").length).toBe(1);
        expect(optionsBtn.getAttribute("aria-expanded")).toBe("true");
        for (const tool of DRAWER_TOOLS) {
          expect(
            $$(`.phone-options-drawer [data-help="${tool}"]`).length,
            `open drawer must render ${tool} INSIDE the panel`,
          ).toBe(1);
        }
        // No play duplicate inside the drawer (compact law).
        expect(
          $$(".phone-options-drawer .booth-btn-play").length,
          "the drawer must not duplicate PLAY/STOP",
        ).toBe(0);
        // SR announcement rides the status region.
        expect(
          $(".phone-transport [role='status']").textContent?.trim(),
        ).toContain("open");

        // The drawer grows the chrome BELOW the transport: still centered,
        // and nothing covers the play hit.
        expect(
          Math.abs(playCenterX() - win.innerWidth / 2),
          "open drawer must not displace the centered transport",
        ).toBeLessThanOrEqual(8);
        expect(Math.abs(playCenterX() - closedCenterX)).toBeLessThanOrEqual(1);
        const pr = play.getBoundingClientRect();
        const atPlay = idoc().elementFromPoint(
          pr.left + pr.width / 2,
          pr.top + pr.height / 2,
        );
        expect(
          atPlay === play || play.contains(atPlay),
          "open drawer must not cover the transport's hit",
        ).toBeTruthy();
        // The panel itself sits below the transport row (flow order).
        const tr = $(".phone-transport").getBoundingClientRect();
        const dr = $(".phone-options-drawer").getBoundingClientRect();
        expect(dr.top).toBeGreaterThanOrEqual(tr.bottom - 1);

        // --- 3. EVERY TOOL OPERABLE (observable effects) ---------------
        // LOOP: session echo flips aria-pressed.
        const loop = $<HTMLButtonElement>('[data-help="booth.loop"]');
        const loopBefore = loop.getAttribute("aria-pressed") === "true";
        loop.click();
        await poll(
          () => (loop.getAttribute("aria-pressed") === "true") !== loopBefore,
          3_000,
          "LOOP toggled (session echo)",
        );
        loop.click(); // restore
        await poll(
          () => (loop.getAttribute("aria-pressed") === "true") === loopBefore,
          3_000,
          "LOOP restored",
        );

        // METRONOME: local signal + setTransport seam.
        const metro = $<HTMLButtonElement>('[data-help="booth.metronome"]');
        const metroBefore = metro.getAttribute("aria-pressed") === "true";
        metro.click();
        expect(metro.getAttribute("aria-pressed") === "true").not.toBe(
          metroBefore,
        );
        metro.click(); // restore

        // TEMPO: stepper +1 lands in the input (session echo).
        const bpmInput = $<HTMLInputElement>(
          ".phone-options-drawer .booth-led-input",
        );
        const bpmBefore = Number(bpmInput.value);
        $<HTMLButtonElement>(
          '.phone-options-drawer .booth-step-btn[aria-label="Increase tempo one BPM"]',
        ).click();
        await poll(
          () => Number(bpmInput.value) === bpmBefore + 1,
          3_000,
          "tempo stepped +1",
        );

        // SWING: slider input commits and paints.
        const swing = $<HTMLInputElement>(
          '.phone-options-drawer .booth-group[aria-label="Swing"] .booth-range',
        );
        const swingBefore = Number(swing.value);
        swing.value = String(Math.min(100, swingBefore + 7));
        swing.dispatchEvent(new win.Event("input", { bubbles: true }));
        const swingValue = $(
          ".phone-options-drawer .booth-group[aria-label='Swing'] .booth-value",
        );
        await poll(
          () => swingValue.textContent === `${swing.value}%`,
          3_000,
          "swing painted value follows the slider",
        );

        // MASTER: same law.
        const master = $<HTMLInputElement>(
          '.phone-options-drawer .booth-group[aria-label="Master volume"] .booth-range',
        );
        const masterBefore = Number(master.value);
        master.value = String(Math.max(0, masterBefore - 5));
        master.dispatchEvent(new win.Event("input", { bubbles: true }));
        const masterValue = $(
          ".phone-options-drawer .booth-group[aria-label='Master volume'] .booth-value",
        );
        await poll(
          () => masterValue.textContent === `${master.value}%`,
          3_000,
          "master painted value follows the slider",
        );

        // SCALE: the chip opens the ScalePopover from inside the drawer.
        $(".phone-options-drawer .scale-chip").click();
        await poll(
          () => $$(".phone-options-drawer .scale-pop").length === 1,
          3_000,
          "ScalePopover opens from the drawer",
        );
        // The popover's capture Escape closes ITSELF, not the drawer.
        idoc().body.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await poll(
          () => $$(".phone-options-drawer .scale-pop").length === 0,
          3_000,
          "ScalePopover closed",
        );
        expect(
          $$(".phone-options-drawer").length,
          "popover Escape must not close the drawer beneath it",
        ).toBe(1);

        // --- 4. DISMISSAL: Escape, outside tap, focus return ------------
        idoc().body.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await poll(
          () =>
            $$(".phone-options-drawer, .phone-options-backdrop").length === 0,
          3_000,
          "drawer closed by Escape (zero DOM again)",
        );
        expect(optionsBtn.getAttribute("aria-expanded")).toBe("false");
        expect(idoc().activeElement).toBe(optionsBtn);

        // Outside tap: reopen, then tap the grid through the backdrop.
        optionsBtn.click();
        await poll(
          () => $$(".phone-options-drawer").length === 1,
          5_000,
          "drawer reopened",
        );
        const tapped = idoc().elementFromPoint(4, win.innerHeight - 60);
        expect(
          tapped?.classList.contains("phone-options-backdrop"),
          "a tap outside the drawer lands on its backdrop",
        ).toBeTruthy();
        (tapped as HTMLElement).click();
        await poll(
          () =>
            $$(".phone-options-drawer, .phone-options-backdrop").length === 0,
          3_000,
          "drawer closed by outside tap",
        );
        expect(idoc().activeElement).toBe(optionsBtn);
      } finally {
        await teardown(iframe);
      }
    },
    180_000,
  );

  it(
    "M-8 cross-surface probe 390×844: playing + register shifted + drawer open + help mode coexist — transport stays centered/pinned, readout holds the shifted window, drawer tools operable, cancel-first Escape peels help before the drawer",
    { timeout: 180_000 },
    async () => {
      const { iframe, win, $, $$, idoc } = await bootIframe(390, 844);
      try {
        // Lead lane (the M-5/M-6 demo lane: 15 rows, window 7, start 6).
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () => $(".lane-floor").dataset.lane === "lead",
          5_000,
          "lead stage",
        );

        // --- PLAY: the pinned transport's button flips to STOP ----------
        const play = $<HTMLButtonElement>(".phone-transport .booth-btn-play");
        play.click();
        await poll(
          () => play.getAttribute("aria-pressed") === "true",
          5_000,
          "playing (session echo)",
        );

        // --- REGISTER SHIFT: one octave up through the shift row --------
        const readout = $(
          ".lane-floor[data-lane='lead'] .register-window-readout",
        );
        await poll(
          () => (readout.textContent ?? "").includes("–"),
          5_000,
          "default readout",
        );
        const initialRange = readPitchRange(readout.textContent);
        const shiftedRange = initialRange.map((pitch) => pitch + 12);
        const octUp = $$(
          '.lane-floor[data-lane="lead"] .register-shift-btn',
        ).find((b) => b.getAttribute("aria-label") === "LEAD octave view up");
        if (!octUp) throw new Error("missing OCT up shift button");
        (octUp as HTMLButtonElement).click();
        await poll(
          () =>
            readPitchRange(readout.textContent).every(
              (pitch, index) => pitch === shiftedRange[index],
            ),
          5_000,
          "readout re-anchored one octave up (clamped top)",
        );

        // --- DRAWER OPEN over the playing, shifted stage ----------------
        const optionsBtn = $<HTMLElement>('[data-help="phone.options"]');
        optionsBtn.click();
        await poll(
          () => $$(".phone-options-drawer").length === 1,
          5_000,
          "drawer panel",
        );
        // The transport stays centered and uncovered while playing.
        const pr = play.getBoundingClientRect();
        expect(
          Math.abs(pr.left + pr.width / 2 - win.innerWidth / 2),
          "transport centered with drawer open + playing",
        ).toBeLessThanOrEqual(8);
        expect(pr.top).toBeGreaterThanOrEqual(0);
        expect(pr.bottom).toBeLessThanOrEqual(win.innerHeight);
        const atPlay = idoc().elementFromPoint(
          pr.left + pr.width / 2,
          pr.top + pr.height / 2,
        );
        expect(atPlay === play || play.contains(atPlay)).toBeTruthy();
        expect(play.getAttribute("aria-pressed")).toBe("true");
        // The shifted window survives underneath the open drawer.
        expect((readout.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
          "▲A♯5 – A6",
        );

        // --- HELP MODE ON over everything (the `i` global) --------------
        idoc().body.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "i", bubbles: true }),
        );
        await poll(
          () => $(".app").getAttribute("data-help-mode") === "on",
          5_000,
          "help mode on (stage-wrap data-help-mode)",
        );
        // Drawer still open, transport still playing/centered.
        expect($$(".phone-options-drawer").length).toBe(1);
        expect(play.getAttribute("aria-pressed")).toBe("true");
        // A drawer tool is OPERABLE in this four-state overlap: LOOP flips.
        const loop = $<HTMLButtonElement>('[data-help="booth.loop"]');
        const loopBefore = loop.getAttribute("aria-pressed") === "true";
        loop.click();
        await poll(
          () => (loop.getAttribute("aria-pressed") === "true") !== loopBefore,
          3_000,
          "LOOP toggled while playing + drawer + help",
        );
        loop.click(); // restore
        await poll(
          () => (loop.getAttribute("aria-pressed") === "true") === loopBefore,
          3_000,
          "LOOP restored",
        );

        // --- CANCEL-FIRST Escape peels HELP, not the drawer -------------
        idoc().body.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await poll(
          () => $(".app").getAttribute("data-help-mode") === "off",
          5_000,
          "help mode off first (cancel-first)",
        );
        expect(
          $$(".phone-options-drawer").length,
          "the first Escape must leave the drawer open",
        ).toBe(1);
        // The second Escape closes the drawer; play never stopped.
        idoc().body.dispatchEvent(
          new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await poll(
          () =>
            $$(".phone-options-drawer, .phone-options-backdrop").length === 0,
          3_000,
          "drawer closed by second Escape",
        );
        expect(play.getAttribute("aria-pressed")).toBe("true");
        // Stop to leave a quiet origin.
        play.click();
        await poll(
          () => play.getAttribute("aria-pressed") === "false",
          3_000,
          "stopped",
        );
      } finally {
        await teardown(iframe);
      }
    },
    180_000,
  );

  it(
    "desktop 1280×800: no phone transport/OPTIONS/drawer — the Booth keeps its own tools (m4 fallback law)",
    { timeout: 120_000 },
    async () => {
      const { iframe, $$, $ } = await bootIframe(1280, 800);
      try {
        expect($$(".phone-transport").length).toBe(0);
        expect($$('[data-help="phone.options"]').length).toBe(0);
        expect(
          $$(".phone-options-drawer, .phone-options-backdrop").length,
        ).toBe(0);
        // The desktop Booth still carries the tools in its own groups
        // (booth.tempo/swing/master ride the GROUP divs themselves).
        expect($$('.booth [data-help="booth.loop"]').length).toBe(1);
        expect($$('.booth [data-help="booth.tempo"]').length).toBe(1);
        expect($$('.booth [data-help="booth.scale"]').length).toBe(1);
        expect($$('.booth [data-help="booth.swing"]').length).toBe(1);
        expect($$('.booth [data-help="booth.master"]').length).toBe(1);
        // ONE play button, in the Booth's Playback group.
        expect($$(".booth-btn-play").length).toBe(1);
        expect($(".booth-btn-play").closest(".booth-group")).toBeTruthy();
      } finally {
        await teardown(iframe);
      }
    },
    120_000,
  );
});
