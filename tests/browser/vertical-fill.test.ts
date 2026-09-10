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
 * the condensed phone rail renders cue labels as "—", so callers at phone
 * width pass their own (the §E body then pins the demo's lead manifest).
 */
async function boot(
  w: number,
  h: number,
  demoOk?: (frame: HTMLIFrameElement) => boolean,
): Promise<Ctx> {
  const bundleKey = Object.keys(bundleGlob)[0];
  const cssKey = Object.keys(cssGlob)[0];
  expect(bundleKey, "built bundle missing (globalSetup build failed?)").toBeTruthy();
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
        const cues = Array.from(
          iframe!.contentDocument?.querySelectorAll(".rail-tile-cue") ?? [],
        ).map((c) => c.textContent);
        const settled = demoOk
          ? cues.length > 0 && demoOk(iframe!)
          : cues.some((c) => c === "VERSE");
        if (settled) return resolve(true);
        if (performance.now() - t0 > 6_000) return resolve(false);
        setTimeout(check, 100);
      };
      check();
    });
    if (ok) break;
    if (attempt >= 3) {
      const cues = Array.from(
        iframe.contentDocument?.querySelectorAll(".rail-tile-cue") ?? [],
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
        Math.abs(floors.getBoundingClientRect().bottom - h) < 1.5
      );
    },
    8_000,
    `the vertical fill settles at ${w}×${h} (floors own the viewport bottom)`,
  );
}

describe("i3-1 vertical fill law (built app, demo state)", () => {
  it(
    "fills every desktop viewport: equal rows, floors to the bottom, windows first then row scale within the clamp; resize converges; deficits grow the page",
    { timeout: 240_000 },
    async () => {
      const viewports: Array<[number, number]> = [
        [1280, 800],
        [1440, 900],
        [1920, 1080],
      ];
      for (const [w, h] of viewports) {
        const ctx = await boot(w, h);
        try {
          await settleFill(ctx, w, h);
          const idoc = ctx.iframe.contentDocument!;
          const $ = ctx.$;

          // --- A. THE FILL + the one-page law ----------------------------
          const de = idoc.documentElement;
          expect(
            de.scrollWidth <= w && de.scrollHeight <= h,
            `${w}×${h}: one page, both axes (measured ${de.scrollWidth}×${de.scrollHeight})`,
          ).toBe(true);
          const floors = $(".stage-floors");
          const fr = floors.getBoundingClientRect();
          expect(
            Math.abs(fr.bottom - h),
            `${w}×${h}: floors own the viewport bottom (pre-fix dead band: ${
              w === 1280 ? 166 : w === 1440 ? 288 : 512
            }px)`,
          ).toBeLessThanOrEqual(1.5);

          // Equal stage rows (the shared budget — the pre-fix rows read
          // 206/166 content-sized).
          const rows = Array.from(floors.children).filter((c) =>
            c.classList.contains("lane-floor"),
          );
          const r0 = rows[0]!.getBoundingClientRect();
          const r2 = rows[2]!.getBoundingClientRect();
          expect(Math.abs(r0.height - r2.height)).toBeLessThanOrEqual(1.5);

          // --- B. THE DISTRIBUTION ---------------------------------------
          for (const lane of ["drums", "bass", "chords", "lead"]) {
            const track = Number.parseFloat(
              $(`.lane-floor[data-lane="${lane}"] .row-cells`).style
                .gridAutoRows,
            );
            expect(
              track,
              `${lane} track within the fill clamp [committed, 24px] at ${w}×${h}`,
            ).toBeGreaterThanOrEqual(lane === "drums" ? 20 : 16);
            expect(track).toBeLessThanOrEqual(24);
          }
          // Windows first: the lead window grows with the share.
          const leadName =
            $(`.lane-floor[data-lane="lead"] [role="grid"]`).getAttribute(
              "aria-label",
            ) ?? "";
          const m = /ROWS (\d+)–(\d+) OF 14/.exec(leadName);
          const leadWindowRows = m ? Number(m[2]) - Number(m[1]) + 1 : 15;
          expect(
            leadWindowRows,
            `lead window never below the one-octave default at ${w}×${h}`,
          ).toBeGreaterThanOrEqual(7);
          if (w === 1280) {
            // The tested minimum still has budget past the octave: the
            // window must be GROWN (teeth: the fill-disabled build windows
            // at exactly 7 here).
            expect(
              leadWindowRows,
              "1280×800: the window grows past the one-octave default",
            ).toBeGreaterThan(7);
          }
          // Whole rows: every fully-visible row count matches the window
          // law (the grown pane quantizes to whole row pitches).
          const leadScroll = $(
            `.lane-floor[data-lane="lead"] .lane-grid-scroll`,
          ) as HTMLElement;
          const leadRows = Array.from(
            leadScroll.querySelectorAll(".grid-row"),
          );
          const box = leadScroll.getBoundingClientRect();
          const fullyVisible = leadRows.filter((row) => {
            const r = row.getBoundingClientRect();
            return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
          }).length;
          expect(
            fullyVisible,
            "grown window shows whole rows (quantized to the row pitch)",
          ).toBe(leadWindowRows);

          // --- per-viewport fill facts (the critique's evidence view) ----
          if (w === 1920) {
            // The biggest share: the lead manifest fits whole (unwindowed)
            // AND its track reaches the committed clamp.
            expect(m, "1920: lead manifest fits the grown window").toBeNull();
            expect(
              Number.parseFloat(
                $(`.lane-floor[data-lane="lead"] .row-cells`).style
                  .gridAutoRows,
              ),
              "1920: lead row scale fills to the 24px clamp",
            ).toBe(24);
          }
        } finally {
          await ctx.cleanup();
        }
      }

      // --- C. THE SHRINK PATH: 1920 → 1280 → 1920 converges -------------
      const ctx = await boot(1920, 1080);
      try {
        await settleFill(ctx, 1920, 1080);
        const read = () => {
          const idoc = ctx.iframe.contentDocument!;
          const tracks: Record<string, number> = {};
          for (const lane of ["drums", "bass", "chords", "lead"]) {
            tracks[lane] = Number.parseFloat(
              idoc.querySelector<HTMLElement>(
                `.lane-floor[data-lane="${lane}"] .row-cells`,
              )!.style.gridAutoRows,
            );
          }
          const name =
            idoc
              .querySelector(`.lane-floor[data-lane="lead"] [role="grid"]`)
              ?.getAttribute("aria-label") ?? "";
          const m = /ROWS (\d+)–(\d+) OF 14/.exec(name);
          return {
            tracks,
            leadWindow: m ? Number(m[2]) - Number(m[1]) + 1 : 15,
            leadWindowed: !!m,
          };
        };
        const at1920 = read();
        expect(at1920.leadWindow).toBe(15); // full manifest
        // Shrink to the minimum: the share re-quantizes DOWN (windows
        // first — never below one octave), the page still fits.
        ctx.iframe.style.width = "1280px";
        ctx.iframe.style.height = "800px";
        await poll(
          () => {
            const r = read();
            return r.leadWindowed && r.leadWindow < 15 && r.leadWindow >= 7;
          },
          8_000,
          "1920→1280: the window re-quantizes down (≥ one octave)",
        );
        const at1280 = read();
        expect(
          at1280.leadWindow,
          "1280: window above the default, below the manifest",
        ).toBeGreaterThan(7);
        const de = ctx.iframe.contentDocument!.documentElement;
        expect(
          de.scrollWidth <= 1280 && de.scrollHeight <= 800,
          "1280×800 one page after the shrink",
        ).toBe(true);
        // And back up: the same 1920 fill returns (no hysteresis).
        ctx.iframe.style.width = "1920px";
        ctx.iframe.style.height = "1080px";
        await poll(
          () => {
            const r = read();
            return r.leadWindow === 15 && r.tracks.lead === 24;
          },
          8_000,
          "1280→1920: the fill converges back (no hysteresis)",
        );
        const back1920 = read();
        expect(back1920.tracks).toEqual(at1920.tracks);
      } finally {
        await ctx.cleanup();
      }

      // --- D. THE DEFICIT PATH (grow-on-miss preserved) ------------------
      const ctx2 = await boot(1024, 600);
      try {
        await new Promise((r) => setTimeout(r, 900)); // fonts + fit settle
        const idoc = ctx2.iframe.contentDocument!;
        const drumsTrack = Number.parseFloat(
          idoc.querySelector<HTMLElement>(
            `.lane-floor[data-lane="drums"] .row-cells`,
          )!.style.gridAutoRows,
        );
        expect(
          drumsTrack,
          "the drums 20px readability floor holds under a real deficit",
        ).toBeGreaterThanOrEqual(20);
        expect(
          idoc.documentElement.scrollHeight,
          "a budget miss honestly GROWS the page (grow-on-miss), never clips",
        ).toBeGreaterThan(600);
      } finally {
        await ctx2.cleanup();
      }

      // --- E. PHONE REGRESSION (I3-f): no fill registration ---------------
      // The condensed phone rail renders ONE lane row with cue labels as
      // "—", so the demo signature here is its 4-slot chain (a stale
      // single-pattern restore shows one cue); the lead manifest assertion
      // below pins the demo document.
      const ctx3 = await boot(390, 844, (frame) => {
        const doc = frame.contentDocument!;
        return (
          doc.querySelectorAll(".rail-tile-cue").length >= 4 &&
          doc.querySelector(".app")?.getAttribute("data-stage") === "phone"
        );
      });
      try {
        await poll(
          () =>
            ctx3.iframe.contentDocument!.querySelector(".app")?.getAttribute(
              "data-stage",
            ) === "phone",
          8_000,
          "phone stage",
        );
        await poll(
          () =>
            ctx3.iframe.contentDocument!.querySelector(
              ".lane-switch-tab[data-lane='lead']",
            ) !== null,
          5_000,
          "switcher",
        );
        const idoc = ctx3.iframe.contentDocument!;
        (
          idoc.querySelector(
            ".lane-switch-tab[data-lane='lead']",
          ) as HTMLElement
        ).click();
        await poll(
          () =>
            idoc.querySelector(".lane-floor")?.getAttribute("data-lane") ===
            "lead",
          3_000,
          "lead stage",
        );
        const leadScroll = idoc.querySelector(
          ".lane-grid-scroll",
        ) as HTMLElement;
        // M-5 (iteration 4) FLIPPED the phone full-manifest law: the phone
        // now windows at the same one-octave RC-1 default (the full manifest
        // stays in the DOM — a fixed-height scroll seat), and the fill
        // compressor still never runs at phone (no GROWN window: the seat
        // height is exactly the mode-size default, never the fill's grown
        // row count). The exact seat math is owned by the M-5 gate
        // (mobile-register-window.test.tsx); this probe pins the NO-GROWTH
        // half of the fill law only.
        expect(
          leadScroll.classList.contains("is-windowed"),
          "phone windows the pitched grid (M-5 one-octave seat)",
        ).toBe(true);
        expect(leadScroll.querySelectorAll(".grid-row").length).toBe(15);
        expect(
          Number.parseFloat(
            idoc.querySelector<HTMLElement>(".row-cells")!.style.gridAutoRows,
          ),
          "phone rows keep the committed 24px preset",
        ).toBe(24);
      } finally {
        await ctx3.cleanup();
      }
    },
    240_000,
  );
});
