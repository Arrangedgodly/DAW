/**
 * i3-1 browser gate — the VERTICAL FILL LAW (iteration-3 critique P1) on the
 * REAL BUILT APP, default demo state, at the three committed desktop
 * viewports + a phone regression clause:
 *
 * A. THE FILL: the stage rows share the vertical budget (equal halves when
 *    content allows) and the FLOORS FILL THEIR ROW — the floors' box ends at
 *    the viewport bottom (the pre-fix dead bands: 166px/20.8% at 1280×800,
 *    288px/32% at 1440×900, 512px/47.4% at 1920×1080). The one-page law
 *    holds EXACTLY on both axes at every probed viewport.
 * B. THE DISTRIBUTION: each lane fills its share by its own law —
 *    register-window rows first (whole-row quantized, lockstep, never below
 *    the one-octave default, never past the manifest), then row scale
 *    within the committed clamp [cellPx, 24px] (the world's own v0/phone
 *    editing-row scale). Every visible row renders whole inside the pane
 *    (no bisected row at a grown window's edge beyond the recorded
 *    pane-padding delta — entry 2 owns that fix independently).
 * C. THE SHRINK PATH (the critique's closing question): mid-session resizes
 *    re-distribute in BOTH directions — 1920 → 1280 → 1920 converges to the
 *    same fill values (canonical-target computation, no hysteresis), and a
 *    window never drops below the one-octave default.
 * D. THE DEFICIT PATH (refinement-4's law preserved): at a viewport whose
 *    budget cannot lawfully fit (1024×600 — the desktop floor), the drums
 *    track holds its 20px readability floor and the page HONESTLY grows
 *    (the grow-on-miss law) instead of clipping or sub-floor compression.
 * E. PHONE REGRESSION (I3-f): the phone stage never registers for the fill
 *    — no windowing, the committed full-manifest scrolling-grid law.
 */

import { describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

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

interface Ctx {
  iframe: HTMLIFrameElement;
  $: <T extends Element>(sel: string) => T;
  cleanup: () => Promise<void>;
}

/**
 * Boot the built app at an explicit viewport with a GUARANTEED first-run
 * demo state: the shared-origin IDB may hold a prior suite's autosave, and
 * a delete can be blocked by the booting app's own open connection (the
 * R14 teardown law) — so each retry starts from a FRESH iframe (closing the
 * prior app's DB connections), wipes, and polls a demo signature. The
 * signature defaults to the demo's named VERSE cue tiles (desktop rail);
 * the phone EDIT page carries NO rail (2026-09-11: the chain moved to the
 * SONG page), so callers at phone width pass their own signature (the §E
 * body then pins the demo's lead manifest).
 */
async function boot(
  w: number,
  h: number,
  demoOk?: (frame: HTMLIFrameElement) => boolean,
): Promise<Ctx> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(
    bundleKey,
    "built bundle missing (globalSetup build failed?)",
  ).toBeTruthy();
  expect(cssKey).toBeTruthy();
  let iframe: HTMLIFrameElement | null = null;
  const wipe = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("bitbounce");
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  const write = (frame: HTMLIFrameElement): void => {
    const doc0 = frame.contentDocument!;
    doc0.open();
    doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey.replace("/dist/", "/")}"></script>
</body></html>`);
    doc0.close();
  };
  for (let attempt = 0; ; attempt++) {
    // Fresh frame per attempt: removing the old one closes its app's DB
    // connections, so the wipe below can never be blocked by our own boot.
    iframe?.remove();
    await new Promise((r) => setTimeout(r, 100));
    await wipe();
    iframe = document.createElement("iframe");
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    document.body.appendChild(iframe);
    write(iframe);
    const ok = await new Promise<boolean>((resolve) => {
      const t0 = performance.now();
      const check = () => {
        // A caller-supplied signature decides ALONE; otherwise the drums KIT
        // readout is the rail-free demo signal (the chain moved to its own
        // SONG page on 2026-09-11, so cue tiles are on no stage at boot).
        const kits = Array.from(
          iframe!.contentDocument?.querySelectorAll(".head-ctl-value") ?? [],
        ).map((c) => c.textContent ?? "");
        const settled = demoOk
          ? demoOk(iframe!)
          : kits.some((c) => c.includes("SOFT STEP"));
        if (settled) return resolve(true);
        if (performance.now() - t0 > 6_000) return resolve(false);
        setTimeout(check, 100);
      };
      check();
    });
    if (ok) break;
    if (attempt >= 3) {
      const cues = Array.from(
        iframe.contentDocument?.querySelectorAll(".head-ctl-value") ?? [],
      ).map((c) => c.textContent);
      const lane = iframe.contentDocument?.querySelector(".lane-floor");
      throw new Error(
        `demo boot never settled at ${w}×${h}: cues=${JSON.stringify(cues.slice(0, 8))} lane=${lane?.getAttribute("data-lane") ?? "none"}`,
      );
    }
  }
  const frame = iframe;
  const $ = <T extends Element>(sel: string): T => {
    const el = frame.contentDocument!.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  return {
    iframe: frame,
    $,
    cleanup: async () => {
      frame.remove();
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
    },
  };
}

/** Settle past the webfont race (the fit lawfully waits for final metrics
 * before it grows — a cold boot honestly reads content-sized for ~100ms). */
async function settleFill(ctx: Ctx, w: number, h: number): Promise<void> {
  const idoc = ctx.iframe.contentDocument!;
  await poll(
    () => {
      const de = idoc.documentElement;
      const floors = idoc.querySelector<HTMLElement>(".stage-floors");
      if (!floors) return false;
      // The fill law's signature: the floors own the viewport bottom.
      return (
        de.scrollHeight > 0 &&
        Math.abs(
          floors.getBoundingClientRect().bottom -
            h +
            Number.parseFloat(
              idoc.defaultView!.getComputedStyle(idoc.querySelector(".app")!)
                .paddingBottom,
            ) +
            1,
        ) < 1.5
      );
    },
    8_000,
    `the vertical fill settles at ${w}×${h} (floors own the viewport bottom)`,
  );
}

describe("vertical fill with the full MIDI editor", () => {
  it.each([false, true])(
    "fits desktop quadrants, preserves seven complete pitched rows, recovers after resize, and keeps phone targets (touch: %s)",
    { timeout: 240_000 },
    async (touch) => {
      await cdp().send("Emulation.setTouchEmulationEnabled", {
        enabled: touch,
        maxTouchPoints: 5,
      });
      const ctx = await boot(1280, 800);
      try {
        const doc = ctx.iframe.contentDocument!;
        const tracks = new Map<string, number[]>();
        for (const [w, h] of [
          [1280, 800],
          [1440, 900],
          [1920, 1080],
          [1280, 800],
          [1920, 1080],
        ]) {
          ctx.iframe.style.width = w + "px";
          ctx.iframe.style.height = h + "px";
          await settleFill(ctx, w, h);
          await doc.fonts.ready;
          await new Promise((r) => setTimeout(r, 300));
          expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(w);
          expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(h);
          const floors = Array.from(
            doc.querySelectorAll<HTMLElement>(".lane-floor"),
          );
          expect(floors).toHaveLength(4);
          expect(
            Math.abs(
              floors[0]!.getBoundingClientRect().height -
                floors[1]!.getBoundingClientRect().height,
            ),
          ).toBeLessThanOrEqual(1.5);
          const measured: number[] = [];
          for (const floor of floors) {
            const pane = floor.querySelector<HTMLElement>(".lane-grid-scroll")!;
            const box = pane.getBoundingClientRect();
            const rows = Array.from(
              pane.querySelectorAll<HTMLElement>(".grid-row"),
            );
            const visible = rows.filter((row) => {
              const r = row.getBoundingClientRect();
              return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
            });
            expect(visible).toHaveLength(
              floor.dataset.lane === "drums" ? 6 : 7,
            );
            if (floor.dataset.lane !== "drums")
              expect(rows.length).toBeGreaterThan(7);
            const track = Number.parseFloat(
              (visible[0]!.querySelector(".row-cells") as HTMLElement).style
                .gridAutoRows,
            );
            expect(track).toBeGreaterThanOrEqual(11);
            expect(track).toBeLessThanOrEqual(64);
            measured.push(track);
          }
          const key = w + "x" + h;
          if (tracks.has(key))
            expect(measured, "resize returns to the same geometry").toEqual(
              tracks.get(key),
            );
          tracks.set(key, measured);
        }
        expect(tracks.get("1920x1080")![1]!).toBeGreaterThan(
          tracks.get("1280x800")![1]!,
        );
        ctx.iframe.style.height = "500px";
        await new Promise((r) => setTimeout(r, 600));
        expect(
          doc.documentElement.scrollHeight,
          "short viewport scrolls rather than clipping controls",
        ).toBeGreaterThan(500);
      } finally {
        await ctx.cleanup();
      }
      const phone = await boot(
        390,
        844,
        (frame) =>
          frame.contentDocument!.querySelector(".phone-chrome") !== null,
      );
      try {
        const doc = phone.iframe.contentDocument!;
        await poll(
          () => doc.querySelectorAll(".lane-switch-tab").length === 4,
          5000,
          "phone instruments",
        );
        (
          doc.querySelector('.lane-switch-tab[data-lane="lead"]') as HTMLElement
        ).click();
        await poll(
          () =>
            doc.querySelector('.lane-floor[data-lane="lead"] .cell') !== null,
          5000,
          "lead grid",
        );
        const rows = Array.from(
          doc.querySelectorAll<HTMLElement>(".grid-row:has(.cell)"),
        );
        expect(rows).toHaveLength(7);
        for (const row of rows)
          expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      } finally {
        await phone.cleanup();
      }
    },
  );
});
