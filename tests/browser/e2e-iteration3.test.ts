import { pitchDomain } from "../../src/document/pitchWindow";
import { WORKSPACE_TOGGLE } from "./workspace";
/**
 * HW-6 — THE iteration-3 definition-of-done e2e: ONE ordered journey through
 * the REAL BUILT APP (dist/ bundle served by the browser project's publicDir,
 * exactly as deployed), starting from a wiped IndexedDB (first run boots the
 * PX-4 POLY-LOOP demo), driving REAL UI input (clicks, synthetic pointers
 * for the drag gestures, keydowns for every keyboard twin the v3 ledger
 * demands — Daredevil's spec is the contract):
 *
 *   1. BOOT — the poly-loop demo: UNEQUAL lane cycles visible in the rail
 *      (chords 4×2B → 8-BAR CYCLE vs the 4-BAR rhythm lanes; per-tile 2B/1B
 *      badges) + i3-1 equal default register windows (lead windowed
 *      ROWS 6–12 OF 14, fitting manifests byte-identical names, full
 *      manifests in the DOM) + the one-page law at 1440×900.
 *   2. PLAY — the poly-loop audibly-adjacent/visible: `p` announces
 *      POSITION BAR n OF 8 · LEAD BAR m OF 4 (the LCM basis — denominators
 *      differ, cross-checked against the booth BAR digit); the four
 *      playheads sweep UNSYNCED (the 1-bar-grid lanes wrap strictly more
 *      often than the 2-bar chords grid); the booth reaches BAR 5+ (past
 *      every 4-bar lane's own cycle — only the 8-bar LCM explains it).
 *   3. RAIL `+` TWINS (i3-3, the ledger's one deliberate journey change):
 *      the row button → PATTERN E CREATED · 1 BAR · APPENDED (next letter
 *      after the demo's A–D); the rail-local `=` key on a focused tile →
 *      PATTERN F (focus lands on the new tile — the DA-3 law); PAT-menu RM
 *      removes F (back to a 5-slot chain — the cycle badge follows).
 *   4. EDIT the blank: drag-create a 4-step note on the E grid.
 *   5. LENGTH LADDER (i3-4): `b` grows 1→2 (PATTERN E · 2 BARS, extent
 *      remount, tile badge, the lane's cycle badge 4→5→6-BAR); a note at
 *      bar 2 makes Shift+b REFUSE with the exact E10 text naming it; the
 *      PAT stepper refuses with the IDENTICAL text and STAYS OPEN (own
 *      lifecycle); after the blocking note is removed the shrink proceeds
 *      clean; a rapid b×3 burst reverts with ONE Ctrl+Z (the resize
 *      coalescing family); the settled ladder re-climbs to 8 BARS where
 *      the grid renders through the virtualized column window while the
 *      scroll extent stays pattern-wide — and the rail now reads
 *      12-BAR CYCLE (lane cycle = chain total, i3-4/I3-e).
 *   6. OCT TRANSPOSE (i3-2): global `o` → LEAD OCTAVE +1; the pointer twin
 *      on ANOTHER quadrant's strip (always-operable); Shift+`o` down;
 *      undo; then the EXPORT-REFLECTED proof the gate matrix was missing
 *      on the real app: baseline WAV at octave 0, +1 changes the bytes
 *      (same frame count — timing untouched), the difference is audible
 *      by metric (diff-RMS + high-band energy ratio up — the established
 *      acoustic-metric pattern), and undo restores a byte-identical
 *      export (canonical-empty at 0).
 *   7. WINDOW SCROLL (i3-1 reachability + E9): Shift+↓ on a focused cell —
 *      VIEW DOWN ONE OCTAVE · ROWS <a>–<b> (computed against the live
 *      manifest), focus never moves, the grid name flips; the second press
 *      clamps VIEW AT BOTTOM; arrows walk the FULL manifest back to row 0
 *      (the window follows), Shift+↑ clamps VIEW AT TOP.
 *   8. EXPORTS at the journey's own LCM (i3-5): the editing above moved
 *      the export cycle to 24 bars (chords 8 · lead 12 · 4/4) — EXPORT WAV
 *      double-tapped mid-busy produces exactly ONE blob (the busy-guard
 *      swallow), the RENDERING WAV… toast is observed, the success toast
 *      reports the CYCLE (`WAV EXPORTED · 24-BAR CYCLE`), parse-back:
 *      16-bit stereo, frames = 24 bars exactly; EXPORT MIDI toast carries
 *      TRACKS · NOTES · CYCLE; parse-back (@tonejs/midi, the independent
 *      parser): lead (channel 2) carries E's note at ticks 7,680 AND
 *      30,720 — the 12-bar chain repeating INSIDE the 24-bar LCM cycle
 *      (XP-1's repeat law), pitch = the row label's own, all inside the
 *      cycle bound.
 *   9. RELOAD/AUTOSAVE — the whole edited document survives (E with its
 *      note at 8 bars, 5-slot chain, 12-BAR CYCLE badge); the post-reload
 *      export is byte-identical (save/load determinism).
 *  10. FV-1 WIDE PROBE (i3-6) — the same document rebooted at 1920×1080:
 *      ≥95% width utilization on both widest surfaces, no centered
 *      vacancy, the one-page law, the lead quadrant > 900 px (the
 *      densified stage — the retired 1400 px cap would leave ~660).
 *
 * Follows the HW-4/HW-5 conventions: download-seam capture, deterministic
 * first-run IDB wipe, R14 teardown wipe, poll-based waits. Synthetic-input
 * honesty is the established law (synthetic keydowns/pointers run every app
 * handler but carry no browser defaults); trusted-pointer parity is pinned
 * by the IN-2/IN-3/IN-4 trusted gates. The per-clause standing gates live in
 * the i3 AC matrix (docs/dev/definition-of-done.md §7); this journey is the
 * one ordered user story that runs them end to end.
 */

import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { createDemoProject } from "../../src/document/demoSong";
import { degreeToMidi, effectiveScale } from "../../src/document/scales";
import { getPreset } from "../../src/audio/presets";
import { clampedWindowScroll } from "../../src/grid/keynav";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;

const T = {
  boot: 15_000,
  ui: 5_000,
  play: 20_000,
  render: 90_000,
  save: 8_000,
};

const DEMO_BPM = 112;
/** One beat @112 BPM = 23,625 samples (integer); a bar = 4 beats. */
const SAMPLES_PER_BEAT = (44100 * 60) / DEMO_BPM;
/** The journey's export cycle: LCM(chords 8, lead 12, drums 4, bass 4) bars. */
const CYCLE_BARS = 24;
const FRAMES_PER_BAR = 4 * SAMPLES_PER_BEAT;

function poll(
  cond: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      Promise.resolve(cond()).then((ok) => {
        if (ok) return resolve();
        if (performance.now() - t0 > timeoutMs)
          return reject(new Error(`timed out waiting for ${what}`));
        setTimeout(check, 50);
      }, reject);
    };
    check();
  });
}

// --- tiny test-owned parsers (same laws as the HW-4/MF-4/XP-1 suites) ------

function decodeWav16(bytes: Uint8Array): {
  frames: number;
  mono: Float32Array;
} {
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.slice(at, at + n));
  const u16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8);
  const u32 = (at: number) =>
    (bytes[at]! |
      (bytes[at + 1]! << 8) |
      (bytes[at + 2]! << 16) |
      (bytes[at + 3]! << 24)) >>>
    0;
  const i16 = (at: number) => {
    const u = bytes[at]! | (bytes[at + 1]! << 8);
    return u >= 0x8000 ? u - 0x10000 : u;
  };
  if (ascii(0, 4) !== "RIFF") throw new Error("not RIFF");
  if (ascii(8, 4) !== "WAVE") throw new Error("not WAVE");
  if (u16(20) !== 1 || u16(22) !== 2 || u16(34) !== 16)
    throw new Error("not 16-bit stereo PCM");
  const dataBytes = u32(40);
  const frames = dataBytes / 4;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    mono[i] = (i16(44 + i * 4) / 32767 + i16(44 + i * 4 + 2) / 32767) / 2;
  }
  return { frames, mono };
}

function rms(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i]!;
  return Math.sqrt(sum / Math.max(1, x.length));
}

/** RMS of the sample-wise difference — how audibly two renders differ. */
function diffRms(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Energy above `fc` via a one-pole high-pass, relative to total energy —
 *  the coarse spectral-tilt half of the acoustic-metric pattern (an octave-up
 *  transpose moves the lead's band up; the ratio must rise with it). */
function highBandRatio(x: Float32Array, fc: number): number {
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / 44100;
  const a = rc / (rc + dt);
  let y = 0;
  let prevX = 0;
  let eHp = 0;
  let eAll = 0;
  for (let i = 0; i < x.length; i++) {
    const s = x[i]!;
    y = a * (y + s - prevX);
    prevX = s;
    eHp += y * y;
    eAll += s * s;
  }
  return eHp / Math.max(1e-30, eAll);
}

function firstDiffByte(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : Math.min(a.length, b.length);
}

/** The MIDI number the demo's LEAD lane sounds for scale-degree `degree`
 *  (buildPitchedNotes' own law: the preset's octaveBase + the lane octave —
 *  0 at export time here — over the demo's C-minor scale). Pure functions
 *  imported from src/; the built bundle runs the same source, so this is
 *  the reference computation, not a restatement. */
function leadDegreeMidi(degree: number): number {
  const demo = createDemoProject();
  const conf = demo.lanes.find((l) => l.id === "lead")!;
  const preset = getPreset(conf.presetId);
  return degreeToMidi(
    effectiveScale(demo, "lead"),
    degree,
    (preset?.pitchRange?.octaveBase ?? 5) + (conf.octave ?? 0),
  );
}

describe("HW-6 iteration-3 e2e (built app, wiped IDB, full i3 journey)", () => {
  it(
    "poly-loop boot → play (LCM/unsynced sweeps) → + twins → edit → resize ladder + refusal → OCT (export-reflected) → window scroll → LCM exports → reload → 1920 probe",
    { timeout: 300_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      /** Boot the built app at an explicit viewport (the e2e-iteration2
       *  harness shape; each instance captures its own download seam). */
      const loadApp = async (
        w: number,
        h: number,
      ): Promise<{ iframe: HTMLIFrameElement; blobs: Blob[] }> => {
        const iframe = document.createElement("iframe");
        iframe.style.width = `${w}px`;
        iframe.style.height = `${h}px`;
        document.body.appendChild(iframe);
        const win = iframe.contentWindow!;
        const blobs: Blob[] = [];
        const origCreateObjectURL = win.URL.createObjectURL.bind(win.URL);
        win.URL.createObjectURL = (blob: Blob) => {
          blobs.push(blob);
          return origCreateObjectURL(blob);
        };
        const doc0 = iframe.contentDocument!;
        doc0.open();
        doc0.write(`<!doctype html><html><head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="${cssKey!.replace("/dist/", "/")}" />
</head><body><div id="root"></div>
<script type="module" src="${bundleKey!.replace("/dist/", "/")}"></script>
</body></html>`);
        doc0.close();
        return { iframe, blobs };
      };

      // Deterministic FIRST RUN: wipe the shared-origin IDB first (R14).
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      let app = await loadApp(VIEW_W, VIEW_H);
      const idoc = (): Document => app.iframe.contentDocument!;
      const $ = <El extends Element>(sel: string): El => {
        const el = idoc().querySelector<El>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      /**
       * 2026-09-11 (user call): the song chain is its own PAGE on every
       * stage now, not a bar above the quadrants. These move between the
       * pages through the real booth key, so every rail block below
       * addresses a rail that is actually on screen. Handles captured while
       * the SONG page is open go stale when it closes (the rail unmounts),
       * so a block opens once and closes once.
       */
      const openSong = async (): Promise<void> => {
        if (idoc().querySelector(".stage-song .rail")) return;
        $<HTMLButtonElement>(WORKSPACE_TOGGLE).click();
        await poll(
          () => !!idoc().querySelector(".stage-song .rail"),
          T.ui,
          "song page",
        );
      };
      const openEdit = async (): Promise<void> => {
        if (!idoc().querySelector(".stage-song")) return;
        $<HTMLButtonElement>(WORKSPACE_TOGGLE).click();
        await poll(
          () => !!idoc().querySelector(".stage-floors"),
          T.ui,
          "edit stage",
        );
      };
      const $$ = <El extends Element>(sel: string): El[] =>
        Array.from(idoc().querySelectorAll<El>(sel));
      const floor = (lane: string) => $(`.lane-floor[data-lane="${lane}"]`);
      const gridName = (lane: string) =>
        floor(lane)
          .querySelector("[role='grid']")!
          .getAttribute("aria-label") ?? "";
      const statusText = () =>
        ($(".stage-status") as HTMLElement).textContent?.trim() ?? "";
      const railAnnounce = (lane: string) =>
        $(
          `.rail-row[data-lane="${lane}"] > .head-sr[role="status"]`,
        ).textContent?.trim() ?? "";
      const chainCycleName = (lane: string) =>
        $(
          `.rail-row[data-lane="${lane}"] .rail-tiles[role="group"]`,
        ).getAttribute("aria-label") ?? "";
      const tiles = (lane: string): HTMLButtonElement[] =>
        Array.from(
          $(
            `.rail-row[data-lane="${lane}"]`,
          ).querySelectorAll<HTMLButtonElement>(".rail-tile"),
        );
      const key = (el: Element, k: string, opts: KeyboardEventInit = {}) => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
            ...opts,
          }),
        );
      };
      const shrinkB = () => key(idoc().body, "B", { shiftKey: true });
      const POINTER_ID = 11;
      const pe = (el: Element, type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: POINTER_ID,
            pointerType: "mouse",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      const center = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const roving = (lane: string): HTMLElement | undefined =>
        [...floor(lane).querySelectorAll<HTMLElement>(".cell")].find(
          (c) => c.tabIndex === 0,
        );
      const laneCells = (lane: string, row: number) =>
        Array.from(
          floor(lane).querySelectorAll<HTMLElement>(`.cell[data-row="${row}"]`),
        ).sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
      const rowCount = (lane: string) =>
        floor(lane).querySelectorAll(".grid-row").length;
      const cellsPerRow = (lane: string) =>
        floor(lane)
          .querySelectorAll(".grid-row:has(.cell)")[0]
          ?.querySelectorAll(".cell").length ?? 0;
      const rowLabels = (lane: string): string[] =>
        [...floor(lane).querySelectorAll(".lane-grid-scroll .row-label")].map(
          (l) => l.textContent?.trim() ?? "",
        );
      const octLive = (lane: string) =>
        floor(lane).querySelector(".oct-live")?.textContent?.trim() ?? "";
      const octReadout = (lane: string) =>
        floor(lane)
          .querySelector(`[data-help="lane.${lane}.oct"] .head-oct-value`)
          ?.textContent?.trim() ?? "";
      const viewLive = (lane: string) =>
        floor(lane).querySelector(".view-live")?.textContent?.trim() ?? "";
      const actionByLabel = async (
        label: string,
      ): Promise<HTMLButtonElement> => {
        for (let i = 0; i < 60; i++) {
          const b = $$(".projects-action").find(
            (x) => x.textContent?.trim() === label,
          );
          if (b) return b as HTMLButtonElement;
        }
        throw new Error(`projects action ${label} not found`);
      };
      /** Export through the REAL button (lazy chunk) → captured blob bytes. */
      const exportVia = async (label: string): Promise<Uint8Array> => {
        if (!idoc().querySelector(".projects-pop")) {
          $(".projects-btn").click();
          await poll(
            () => !!idoc().querySelector(".projects-pop"),
            T.ui,
            "projects popover",
          );
        }
        const before = app.blobs.length;
        (await actionByLabel(label)).click();
        const wantType = label.includes("MIDI") ? "audio/midi" : "audio/wav";
        await poll(
          () => app.blobs.slice(before).some((b) => b.type === wantType),
          T.render,
          `${label} blob through the download seam`,
        );
        const blob = app.blobs
          .slice(before)
          .reverse()
          .find((b) => b.type === wantType)!;
        return new Uint8Array(await blob.arrayBuffer());
      };
      const teardownApp = async (wipe: boolean) => {
        app.iframe.remove();
        if (!wipe) return;
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
      };

      // Journey state shared across stages.
      let noteRow = -1; // the row the journey's notes live on
      let noteMidi = -1; // that row's label as a MIDI number
      let wavCycle: Uint8Array; // the stage-8 export (reload byte-identity)

      try {
        // --- 1. BOOT: the poly-loop demo + equal windows + one page --------
        await poll(() => !!idoc().querySelector(".booth"), T.boot, "boot");
        await poll(
          // 2026-09-11: rail-free boot readiness — the chain moved to its own
          // SONG page, so cue labels no longer exist at boot. The drums KIT
          // readout is the stage-independent "demo loaded" signal.
          () =>
            $$(".head-ctl-value").some((v) =>
              (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() === "SOFT STEP",
            ),
          T.ui,
          "demo cue labels in the rail",
        );
        expect($$(".lane-grid").length).toBe(4);
        {
          const de = idoc().documentElement;
          await poll(
            () => de.scrollWidth <= VIEW_W && de.scrollHeight <= VIEW_H,
            T.ui,
            "font and grid fit settle",
          );
          expect(de.scrollWidth <= VIEW_W && de.scrollHeight <= VIEW_H).toBe(
            true,
          );
        }
        // The POLY-LOOP is visible before any interaction: UNEQUAL lane
        // cycles (chords 4×2B = 8-bar cycle vs the 4-bar rhythm lanes).
        await openSong();
        expect(
          tiles("chords").map(
            (t) => t.querySelector(".rail-tile-bars")!.textContent,
          ),
        ).toEqual(["2B", "2B", "2B", "2B"]);
        for (const lane of ["drums", "bass", "lead"]) {
          expect(
            tiles(lane).map(
              (t) => t.querySelector(".rail-tile-bars")!.textContent,
            ),
          ).toEqual(["1B", "1B", "1B", "1B"]);
        }
        expect(chainCycleName("chords")).toBe(
          "CHORDS song chain · 8-BAR CYCLE",
        );
        expect(chainCycleName("lead")).toBe("LEAD song chain · 4-BAR CYCLE");
        expect(chainCycleName("drums")).toBe("DRUMS song chain · 4-BAR CYCLE");
        await openEdit(); // the register/geometry checks below read the grid
        // i3-1: equal default register windows + the VERTICAL FILL twin. The
        // lead (15-row manifest) windows — GROWN by the 1440×900 budget
        // share (possibly to its full manifest, the unwindowed law) — while
        // fitting manifests keep today's names. The grown count is
        // budget-derived, so the boot asserts the LAW (≥ one octave, ≤
        // manifest); the exact windowed journey runs at 1280×800 in §7,
        // where the share windows deterministically below the manifest.
        const visibleRows = (lane: string): number => {
          const scroller = floor(lane).querySelector(".lane-grid-scroll")!;
          const box = scroller.getBoundingClientRect();
          let n = 0;
          for (const row of scroller.querySelectorAll(".grid-row")) {
            const r = row.getBoundingClientRect();
            if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) n++;
          }
          return n;
        };
        for (const lane of ["bass", "chords", "lead"]) {
          expect(
            floor(lane)
              .querySelector(".lane-grid-scroll")!
              .classList.contains("is-windowed"),
          ).toBe(true);
          expect(visibleRows(lane), lane + " shows one octave").toBe(7);
          expect(
            rowCount(lane),
            lane + " retains the full MIDI domain",
          ).toBeGreaterThan(7);
        }
        expect(rowCount("drums")).toBe(6);
        expect(visibleRows("drums")).toBe(6);
        expect(
          floor("drums")
            .querySelector(".lane-grid-scroll")!
            .classList.contains("is-windowed"),
        ).toBe(false);
        // Select LEAD (the journey's lane) — the click-selects law.
        floor("lead").click();
        await poll(
          () => gridName("lead").startsWith("LEAD grid · EDITING"),
          T.ui,
          "lead selected (edit name)",
        );

        // --- 2. PLAY: the LCM basis + unsynced per-lane sweeps -------------
        const playBtn = () => $<HTMLButtonElement>(".booth-btn-play");
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          T.ui,
          "play",
        );
        await new Promise((r) => setTimeout(r, 1200)); // past the pre-roll
        // `p` (E12): global cycle position, then the ACTIVE lane's own —
        // the LCM readout. Denominators 8 vs 4 ARE the poly-loop.
        key(idoc().body, "p");
        const pText = statusText();
        expect(pText).toMatch(
          /^POSITION BAR [1-8] OF 8 · LEAD BAR [1-4] OF 4$/,
        );
        const pBar = Number(/POSITION BAR (\d+) OF 8/.exec(pText)![1]);
        const ledBar = () =>
          Number.parseInt(
            $(".booth-led").textContent!.trim().split(".")[0] ?? "1",
            10,
          );
        // Same JS tick for the transport snapshot, but the readout DOM may
        // lag one rAF across a bar boundary — agree within one bar.
        expect(Math.abs(pBar - ledBar())).toBeLessThanOrEqual(1);
        // Per-lane playheads: the 1-bar-grid lanes (drums/bass/lead under
        // 4-bar cycles) wrap at every bar; the 2-bar chords grid every two
        // bars — strictly fewer wraps in the window = UNSYNCED sweeps.
        const phX = (lane: string): number => {
          const el = floor(lane).querySelector<HTMLElement>(".grid-playhead")!;
          const m = /translateX\(([-\d.]+)px\)/.exec(el.style.transform);
          return m ? Number.parseFloat(m[1]!) : Number.NaN;
        };
        // The step track the playhead sweeps over, measured from the grid's
        // OWN cells (the quadrant body is wider than the track — a 1-bar
        // drums track is ~352 px inside a ~658 px body — so parent widths
        // would break wrap detection; cells never lie).
        const trackPx = (lane: string): number => {
          const cells = Array.from(
            floor(lane).querySelectorAll<HTMLElement>(".grid-row .cell"),
          ).slice(0, 2);
          const step = center(cells[1]!).x - center(cells[0]!).x;
          const perRow =
            floor(lane).querySelectorAll(".grid-row:has(.cell)").length > 0
              ? floor(lane).querySelectorAll(".cell").length /
                floor(lane).querySelectorAll(".grid-row:has(.cell)").length
              : 0;
          return perRow * step;
        };
        const trackW: Record<string, number> = {};
        for (const lane of ["drums", "bass", "chords", "lead"]) {
          trackW[lane] = trackPx(lane);
          expect(trackW[lane]!).toBeGreaterThan(0);
        }
        const wraps: Record<string, number> = {
          drums: 0,
          bass: 0,
          chords: 0,
          lead: 0,
        };
        const prev: Record<string, number> = {
          drums: -1,
          bass: -1,
          chords: -1,
          lead: -1,
        };
        let distinct = 0;
        let sawBar5 = false;
        const samples = 24;
        for (let i = 0; i < samples; i++) {
          const fractions: Record<string, number> = {};
          for (const lane of ["drums", "bass", "chords", "lead"]) {
            const x = phX(lane);
            expect(Number.isFinite(x), `${lane} playhead sweeping`).toBe(true);
            fractions[lane] = x / trackW[lane]!;
            const px = prev[lane];
            if (px >= 0 && x < px - 0.5 * trackW[lane]!) wraps[lane]++;
            prev[lane] = x;
          }
          if (Math.abs(fractions.lead! - fractions.chords!) > 0.02) distinct++;
          if (ledBar() >= 5) sawBar5 = true;
          await new Promise((r) => setTimeout(r, 420));
        }
        expect(
          wraps.lead,
          "lead (1-bar grid) wrapped every bar",
        ).toBeGreaterThanOrEqual(3);
        expect(
          wraps.drums,
          "drums (1-bar grid) wrapped every bar",
        ).toBeGreaterThanOrEqual(3);
        expect(
          wraps.chords,
          "chords (2-bar grid) wrapped every 2 bars",
        ).toBeGreaterThanOrEqual(1);
        expect(
          wraps.lead,
          "the sweeps are UNSYNCED (lead wraps strictly more than chords)",
        ).toBeGreaterThan(wraps.chords);
        expect(
          distinct,
          "chords sweeps at its own position, not lead's",
        ).toBeGreaterThanOrEqual(16);
        expect(
          sawBar5,
          "the booth passed BAR 5 — the 8-bar LCM basis, past every 4-bar lane's own cycle",
        ).toBe(true);
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          T.ui,
          "stop after the sweep window",
        );

        // --- 3. RAIL `+` TWINS: blank E by button, blank F by key, RM F ----
        await openSong();
        const leadPlus = () =>
          $<HTMLButtonElement>('.rail-row[data-lane="lead"] .rail-append');
        expect(leadPlus().getAttribute("aria-label")).toBe(
          "Append new blank pattern to LEAD chain",
        );
        leadPlus().click();
        await poll(
          () => railAnnounce("lead") === "PATTERN E CREATED · 1 BAR · APPENDED",
          T.ui,
          "PATTERN E CREATED announcement",
        );
        await poll(
          () =>
            tiles("lead").length === 5 &&
            tiles("lead")[4]!.dataset.state === "selected",
          T.ui,
          "E appended + selected (5th tile)",
        );
        expect(
          tiles("lead")[4]!.querySelector(".rail-tile-name")!.textContent,
        ).toBe("E");
        expect(
          tiles("lead")[4]!.querySelector(".rail-tile-bars")!.textContent,
        ).toBe("1B");
        expect(chainCycleName("lead")).toBe("LEAD song chain · 5-BAR CYCLE");
        // Keyboard twin: `=` on a focused tile (the ledger's rail-local key).
        const lastTile = tiles("lead")[4]!;
        lastTile.focus();
        key(lastTile, "=");
        await poll(
          () => railAnnounce("lead") === "PATTERN F CREATED · 1 BAR · APPENDED",
          T.ui,
          "PATTERN F CREATED announcement (key twin)",
        );
        await poll(() => tiles("lead").length === 6, T.ui, "F appended");
        expect(idoc().activeElement).toBe(tiles("lead")[5]!); // DA-3 focus law
        expect(chainCycleName("lead")).toBe("LEAD song chain · 6-BAR CYCLE");
        // RM the scratch tile through the PAT menu (the v0 remove path).
        $<HTMLElement>(
          '.rail-row[data-lane="lead"] .rail-tools-trigger',
        ).click();
        await poll(
          () =>
            !!idoc().querySelector(
              '.rail-row[data-lane="lead"] button[aria-label="Remove LEAD selected pattern"]',
            ),
          T.ui,
          "PAT menu open (RM)",
        );
        $<HTMLButtonElement>(
          '.rail-row[data-lane="lead"] button[aria-label="Remove LEAD selected pattern"]',
        ).click();
        await poll(
          () =>
            tiles("lead").length === 5 &&
            chainCycleName("lead") === "LEAD song chain · 5-BAR CYCLE",
          T.ui,
          "F removed; chain back to 5 slots",
        );
        tiles("lead")[4]!.click(); // re-select E for the edit stage
        await poll(
          () => tiles("lead")[4]!.dataset.state === "selected",
          T.ui,
          "E re-selected",
        );

        await openEdit(); // drag-create needs the grid's real geometry

        // --- 4. EDIT the blank: drag-create a 4-step note ------------------
        await poll(
          () => cellsPerRow("lead") === 16,
          T.ui,
          "E's blank 1-bar grid rendered (16 columns)",
        );
        const rovingCell = await (async () => {
          for (let i = 0; i < 40; i++) {
            const c = roving("lead");
            if (c) return c;
            await new Promise((r) => setTimeout(r, 50));
          }
          throw new Error("lead roving tab stop never appeared");
        })();
        noteRow = Number(rovingCell.dataset.row);
        // The blank pattern's manifest is degrees 0..n-1 (store.blankPattern
        // law), so the dragged note's degree === its row index.
        noteMidi = leadDegreeMidi(pitchDomain(createDemoProject(), "lead").degrees[noteRow]!);
        const eCells = laneCells("lead", noteRow);
        const a4 = center(eCells[0]!);
        const m4 = center(eCells[2]!);
        const z4 = center(eCells[3]!);
        pe(eCells[0]!, "pointerdown", a4.x, a4.y);
        pe(eCells[2]!, "pointermove", m4.x, m4.y);
        pe(eCells[3]!, "pointermove", z4.x, z4.y);
        pe(eCells[3]!, "pointerup", z4.x, z4.y);
        const myEdge = () =>
          floor("lead").querySelector<HTMLElement>(
            `.note-edge[data-row="${noteRow}"][data-start="0"]`,
          );
        await poll(
          () => myEdge()?.dataset.length === "4",
          T.ui,
          "drag-created note committed in E",
        );
        expect(
          eCells[0]!
            .getAttribute("aria-label")
            ?.includes("note starts, 4 steps"),
        ).toBe(true);

        // --- 5. LENGTH: the ladder, the refusal, the undo family -----------
        await openSong();
        key(idoc().body, "b");
        await poll(
          () => railAnnounce("lead") === "PATTERN E · 2 BARS",
          T.ui,
          "b grows E 1→2 (E10)",
        );
        await poll(
          () => cellsPerRow("lead") === 32,
          T.ui,
          "2-bar extent remount",
        );
        expect(
          tiles("lead")[4]!.querySelector(".rail-tile-bars")!.textContent,
        ).toBe("2B");
        expect(chainCycleName("lead")).toBe("LEAD song chain · 6-BAR CYCLE");
        // A note at bar 2 will block the shrink back to 1.
        await openEdit(); // drawing the blocking note needs grid geometry
        const e2Cells = laneCells("lead", noteRow);
        const b2 = center(e2Cells[16]!);
        const b2m = center(e2Cells[18]!);
        const b2z = center(e2Cells[19]!);
        pe(e2Cells[16]!, "pointerdown", b2.x, b2.y);
        pe(e2Cells[18]!, "pointermove", b2m.x, b2m.y);
        pe(e2Cells[19]!, "pointermove", b2z.x, b2z.y);
        pe(e2Cells[19]!, "pointerup", b2z.x, b2z.y);
        await poll(
          () =>
            floor("lead").querySelector(
              `.note-edge[data-row="${noteRow}"][data-start="16"]`,
            )?.dataset.length === "4",
          T.ui,
          "the bar-2 blocking note committed",
        );
        await openSong(); // back to the rail for the refusal + PAT stepper
        const refusal = `CANNOT SHRINK PATTERN E TO 1 BAR · ${rowLabels("lead")[noteRow]} NOTE AT BAR 2 WOULD BE LOST · MOVE OR SHORTEN IT FIRST`;
        shrinkB();
        await poll(
          () => railAnnounce("lead") === refusal,
          T.ui,
          "the exact E10 refusal names the blocking note",
        );
        expect(cellsPerRow("lead")).toBe(32); // the store refused
        // The PAT stepper twin: IDENTICAL text, and the menu OWNS ITS
        // LIFECYCLE (stays open across the refusal press).
        $<HTMLElement>(
          '.rail-row[data-lane="lead"] .rail-tools-trigger',
        ).click();
        await poll(
          () =>
            !!idoc().querySelector(
              '.rail-row[data-lane="lead"] button[aria-label^="Shrink LEAD selected pattern"]',
            ),
          T.ui,
          "PAT menu open (LENGTH stepper)",
        );
        $<HTMLButtonElement>(
          '.rail-row[data-lane="lead"] button[aria-label^="Shrink LEAD selected pattern"]',
        ).click();
        await poll(
          () => railAnnounce("lead") === refusal,
          T.ui,
          "the stepper refuses with the identical text (one funnel)",
        );
        expect(cellsPerRow("lead")).toBe(32);
        expect(
          $<HTMLElement>('.rail-row[data-lane="lead"] .rail-length-value')
            .textContent,
        ).toBe("LENGTH 2 BARS");
        expect(
          !!idoc().querySelector(
            '.rail-row[data-lane="lead"] .rail-tools-menu',
          ),
          "the stepper STAYS OPEN across presses",
        ).toBe(true);
        $(".rail-tools-menu").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await poll(
          () =>
            !idoc().querySelector(
              '.rail-row[data-lane="lead"] .rail-tools-menu',
            ),
          T.ui,
          "Escape closes the menu",
        );
        // The popover law's exit half (the ledger's stepper-lifecycle
        // clause): focus lands back on the rail trigger, not stranded on
        // <body> (contained in the lane's rail row).
        expect(
          $('.rail-row[data-lane="lead"]').contains(idoc().activeElement),
          "Escape exits with focus returned to the rail trigger",
        ).toBe(true);
        // Remove the blocker (focus its anchor cell + Enter — the v0
        // toggle-off keyboard law, the drag-notes §5 precedent), then the
        // same shrink proceeds clean.
        const anchorCell = laneCells("lead", noteRow)[16]! as HTMLElement;
        anchorCell.focus();
        key(anchorCell, "Enter");
        await poll(
          () =>
            !floor("lead").querySelector(
              `.note-edge[data-row="${noteRow}"][data-start="16"]`,
            ),
          T.ui,
          "the blocking note removed (toggle-off)",
        );
        shrinkB();
        await poll(
          () => railAnnounce("lead") === "PATTERN E · 1 BAR",
          T.ui,
          "clean shrink proceeds",
        );
        await poll(
          () => cellsPerRow("lead") === 16,
          T.ui,
          "1-bar extent restored",
        );
        // Settle PAST the 350 ms resize-family window first, so the rapid
        // burst below is exactly ONE gesture whose baseline is 1 bar (the
        // clean shrink above must not coalesce into it).
        await new Promise((r) => setTimeout(r, 450));
        // A rapid b×3 burst is ONE undo gesture (the resize family).
        key(idoc().body, "b");
        key(idoc().body, "b");
        key(idoc().body, "b");
        await poll(
          () =>
            tiles("lead")[4]!.querySelector(".rail-tile-bars")!.textContent ===
            "8B",
          T.ui,
          "the rapid burst climbs to 8 bars",
        );
        key(idoc().body, "z", { ctrlKey: true });
        await poll(
          () =>
            tiles("lead")[4]!.querySelector(".rail-tile-bars")!.textContent ===
            "1B",
          T.ui,
          "ONE Ctrl+Z reverts the whole burst",
        );
        await new Promise((r) => setTimeout(r, 450)); // past the family window
        // The settled ladder re-climbs (separate gestures, announced each).
        for (const bars of [2, 4, 8]) {
          key(idoc().body, "b");
          await poll(
            () => railAnnounce("lead") === `PATTERN E · ${bars} BARS`,
            T.ui,
            `settled ladder step to ${bars} bars`,
          );
        }
        expect(chainCycleName("lead")).toBe("LEAD song chain · 12-BAR CYCLE");
        // The 8-bar grid renders through the virtualized column window:
        // DOM cells ≪ the eager 128/row, while the dedicated h-scroller's
        // SIZER carries the pattern-wide extent (the LP-1 law — the sticky
        // layer mechanism keeps the scrollport itself viewport-sized).
        await openEdit(); // the virtualization geometry below reads the grid
        await poll(
          () =>
            floor("lead").querySelectorAll(".cell").length <
            rowCount("lead") * 128,
          T.ui,
          "the 8-bar grid renders windowed",
        );
        {
          const sizer =
            floor("lead").querySelector<HTMLElement>(".grid-col-sizer");
          const hscroll =
            floor("lead").querySelector<HTMLElement>(".grid-hscroll");
          expect(sizer, "the virtualized grid's col sizer").toBeTruthy();
          expect(hscroll, "the virtualized grid's h-scroller").toBeTruthy();
          expect(
            sizer!.getBoundingClientRect().width,
            "the sizer carries the full 8-bar extent",
          ).toBeGreaterThan(hscroll!.clientWidth);
        }

        // --- 6. OCT: announcements, twins, undo, EXPORT-REFLECTED ----------
        // Help-mode pass-through first (the KL-1 law, closed by this
        // audit): `o` fires normally while the info mode is ON — nothing
        // traps the letter keys.
        key(idoc().body, "i");
        await poll(
          () => !!idoc().querySelector(".info-view"),
          T.ui,
          "info mode on",
        );
        key(idoc().body, "o");
        await poll(
          () => octLive("lead") === "LEAD OCTAVE +1",
          T.ui,
          "`o` fires inside help mode (pass-through)",
        );
        key(idoc().body, "i");
        await poll(
          () => !idoc().querySelector(".info-view"),
          T.ui,
          "info mode off",
        );
        expect(octReadout("lead")).toBe("+1");
        // Pointer twin on ANOTHER quadrant's strip (always-operable law).
        $<HTMLButtonElement>('button[aria-label="Octave up for BASS"]').click();
        await poll(
          () => octLive("bass") === "BASS OCTAVE +1",
          T.ui,
          "BASS OCTAVE +1 (click twin)",
        );
        expect(octReadout("bass")).toBe("+1");
        key(idoc().body, "z", { ctrlKey: true }); // one gesture → undone
        await poll(
          () => octReadout("bass") === "0",
          T.ui,
          "bass octave undone",
        );
        // Re-select lead (the strip click lawfully selected bass), then the
        // baseline/down/up sequence around the export-diff proof.
        floor("lead").click();
        await poll(
          () => gridName("lead").startsWith("LEAD grid · EDITING"),
          T.ui,
          "lead re-selected",
        );
        key(idoc().body, "o", { shiftKey: true });
        await poll(
          () => octLive("lead") === "LEAD OCTAVE 0",
          T.ui,
          "Shift+o back to 0",
        );
        const wav0 = await exportVia("EXPORT WAV");
        key(idoc().body, "o");
        await poll(() => octReadout("lead") === "+1", T.ui, "octave +1 again");
        const wav1 = await exportVia("EXPORT WAV");
        // Timing law: one octave changes PITCH, never length.
        const h0 = decodeWav16(wav0);
        const h1 = decodeWav16(wav1);
        expect(h1.frames).toBe(h0.frames);
        expect(
          firstDiffByte(wav1, wav0),
          "the transposed export differs",
        ).toBeGreaterThan(43);
        // Acoustic-metric proof (the established pattern, applied to the
        // diff): audible difference + the energy tilt moves UP with the
        // transposed lane.
        const dRms = diffRms(h0.mono, h1.mono);
        expect(
          dRms,
          "the +1-octave render is audibly different (diff RMS)",
        ).toBeGreaterThan(1e-3);
        const r0 = highBandRatio(h0.mono, 1200);
        const r1 = highBandRatio(h1.mono, 1200);
        expect(
          r1,
          `octave-up moves energy up-band (${r1.toFixed(4)} > ${r0.toFixed(4)})`,
        ).toBeGreaterThan(r0);
        // Undo restores the canonical-empty octave → byte-identical export.
        key(idoc().body, "z", { ctrlKey: true });
        await poll(
          () => octReadout("lead") === "0",
          T.ui,
          "lead octave undone",
        );
        const wav0b = await exportVia("EXPORT WAV");
        expect(wav0b.byteLength).toBe(wav0.byteLength);
        expect(firstDiffByte(wav0b, wav0)).toBe(-1);

        // --- 7. WINDOW SCROLL: view-only, clamped, focus-anchored ----------
        // i3-1 delta: the 1440×900 share GROWS the lead window to (or
        // within one row of) its full manifest, leaving no scroll room —
        // so the windowed journey runs at 1280×800, where the share
        // windows deterministically below the manifest. The live re-fit on
        // the resize is itself the rotation-safe fill law (the observers
        // re-distribute mid-session); every expectation derives from the
        // LIVE window (the step stays ONE OCTAVE — 7 rows, the mode size —
        // never the grown height).
        {
          app.iframe.style.width = "1280px";
          app.iframe.style.height = "800px";
          await poll(
            () => /ROWS (\d+)–(\d+) OF (\d+)/.test(gridName("lead")),
            8_000,
            "lead windowed after the 1280×800 re-fit",
          );
          const cell = await (async () => {
            for (let i = 0; i < 40; i++) {
              const c = roving("lead");
              if (c) return c;
              await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error(
              "lead roving tab stop never appeared (scroll stage)",
            );
          })();
          cell.focus();
          const name0 = gridName("lead");
          const m = /ROWS (\d+)–(\d+) OF (\d+)/.exec(name0);
          expect(m, `windowed lead name (got ${name0})`).toBeTruthy();
          const a0 = Number(m![1]);
          const b0 = Number(m![2]);
          const n = Number(m![3]); // the manifest's LAST row index
          const w0 = b0 - a0 + 1; // the fill-grown window height
          expect(
            w0,
            "the fill grew the window past the one-octave default",
          ).toBe(7);
          expect(w0).toBeLessThan(n + 1); // deterministically windowed here
          // Walk focus to the window's bottom row first (the anchor law
          // needs the focus off the top edge for a DOWN scroll — and the
          // walk itself proves arrows traverse the manifest).
          for (let i = 0; i < b0 - a0; i++)
            key(idoc().activeElement!, "ArrowDown");
          expect(
            Number((idoc().activeElement as HTMLElement).dataset.row),
          ).toBe(b0);
          const focused = idoc().activeElement as HTMLElement;
          // One OCTAVE (the mode size), anchor- and manifest-clamped —
          // the pure keynav law at the grown height.
          const newA = clampedWindowScroll(a0, 1, b0, n + 1, w0, 7);
          key(focused, "ArrowDown", { shiftKey: true });
          await poll(
            () => viewLive("lead").startsWith("VIEW DOWN ONE OCTAVE"),
            T.ui,
            "VIEW DOWN ONE OCTAVE announcement",
          );
          const labels = rowLabels("lead");
          expect(viewLive("lead")).toBe(
            `VIEW DOWN ONE OCTAVE · ROWS ${labels[newA]}–${labels[newA + w0 - 1]}`,
          );
          await poll(
            () =>
              gridName("lead") ===
              `LEAD grid · EDITING · ROWS ${newA}–${newA + w0 - 1} OF ${n}`,
            T.ui,
            "the grid name carries the new window",
          );
          expect(
            idoc().activeElement,
            "focus never moves on a window scroll",
          ).toBe(focused);
          // The manifest bottom: a no-op that still announces (E9).
          key(focused, "ArrowDown", { shiftKey: true });
          await poll(
            () => viewLive("lead").startsWith("VIEW AT BOTTOM"),
            T.ui,
            "VIEW AT BOTTOM clamp",
          );
          // Walk back to row 0 — the window follows minimally (the cursor
          // holds the window), then the top clamp announces.
          for (let i = 0; i < b0; i++) key(idoc().activeElement!, "ArrowUp");
          await poll(
            () => (idoc().activeElement as HTMLElement).dataset.row === "0",
            T.ui,
            "arrows walked the full manifest to row 0",
          );
          await poll(
            () =>
              gridName("lead") ===
              `LEAD grid · EDITING · ROWS 0–${w0 - 1} OF ${n}`,
            T.ui,
            "the window followed focus to the top",
          );
          key(idoc().activeElement!, "ArrowUp", { shiftKey: true });
          await poll(
            () => viewLive("lead").startsWith("VIEW AT TOP"),
            T.ui,
            "VIEW AT TOP clamp (anchor law)",
          );
          // Back to the journey's 1440×900 (the re-fit restores the share;
          // §8's export flows and the one-page law ride on it).
          app.iframe.style.width = `${VIEW_W}px`;
          app.iframe.style.height = `${VIEW_H}px`;
          await poll(
            () =>
              idoc().documentElement.scrollWidth <= VIEW_W &&
              idoc().documentElement.scrollHeight <= VIEW_H,
            8_000,
            "one-page restored at 1440×900 after the window journey",
          );
        }

        // --- 8. EXPORTS at the journey's own LCM (24-bar cycle) ------------
        // The editing above (E grown to 8 bars in a 4×1B chain) moved the
        // export cycle: LCM(chords 8, lead 12, 4, 4) = 24 bars. The toast,
        // the WAV length, and the MIDI repeat structure all run on it.
        if (!idoc().querySelector(".projects-pop")) {
          $(".projects-btn").click();
          await poll(
            () => !!idoc().querySelector(".projects-pop"),
            T.ui,
            "projects popover (export stage)",
          );
        }
        const wavBefore = app.blobs.filter(
          (b) => b.type === "audio/wav",
        ).length;
        (await actionByLabel("EXPORT WAV")).click();
        await poll(
          () =>
            $$(".toast-message").some(
              (t) => t.textContent === "RENDERING WAV…",
            ),
          T.ui,
          "RENDERING WAV… toast (busy state on screen)",
        );
        // Mid-busy double-tap: swallowed — still exactly one render.
        (await actionByLabel("EXPORT WAV")).click();
        await poll(
          () =>
            app.blobs.filter((b) => b.type === "audio/wav").length ===
            wavBefore + 1,
          T.render,
          "exactly ONE wav blob (second tap swallowed)",
        );
        await poll(
          () =>
            $$(".toast-message").some(
              (t) => t.textContent === `WAV EXPORTED · ${CYCLE_BARS}-BAR CYCLE`,
            ),
          T.ui,
          "WAV toast reports the CYCLE bars",
        );
        wavCycle = app.blobs
          .filter((b) => b.type === "audio/wav")
          .slice(-1)[0]!;
        const wavBytes = new Uint8Array(await wavCycle.arrayBuffer());
        {
          const h = decodeWav16(wavBytes);
          expect(
            h.frames,
            "one full LCM cycle exactly (24 bars @112 BPM)",
          ).toBe(CYCLE_BARS * FRAMES_PER_BAR);
          expect(rms(h.mono)).toBeGreaterThan(1e-3); // not silence
        }
        const midiBytes = await exportVia("EXPORT MIDI");
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              /^MIDI EXPORTED · 5 TRACKS · \d+ NOTES · 24-BAR CYCLE$/.test(
                t.textContent ?? "",
              ),
            ),
          T.ui,
          "MIDI toast reports TRACKS · NOTES · CYCLE",
        );
        {
          const midi = new Midi(
            await new Blob([midiBytes as BlobPart], {
              type: "audio/midi",
            }).arrayBuffer(),
          );
          expect(midi.header.ppq).toBe(480);
          const lead = midi.tracks.find((t) => t.channel === 2);
          expect(lead, "the lead track (channel 2) exists").toBeTruthy();
          // E sits at chain offset 4 bars (step 64 → tick 7,680) and the
          // 12-bar lead chain repeats INSIDE the 24-bar cycle → the same
          // note again at tick 30,720 (XP-1's repeat law).
          const at = (tick: number) =>
            lead!.notes.filter(
              (nt) => nt.ticks === tick && nt.midi === noteMidi,
            );
          expect(
            at(7680).length,
            `E's note at tick 7,680 (pitch ${noteMidi})`,
          ).toBeGreaterThanOrEqual(1);
          expect(
            at(30720).length,
            "E's note repeated at tick 30,720 (chain repeat in the cycle)",
          ).toBeGreaterThanOrEqual(1);
          expect(at(7680)[0]!.durationTicks).toBe(480); // 4 steps × 120
          const lastTick = Math.max(...lead!.notes.map((nt) => nt.ticks));
          expect(lastTick, "every note inside the 24-bar cycle").toBeLessThan(
            46080,
          );
        }

        // --- 9. RELOAD/AUTOSAVE: the edited document survives --------------
        await new Promise((r) => setTimeout(r, 1500)); // autosave flush
        await teardownApp(false);
        app = await loadApp(VIEW_W, VIEW_H);
        await poll(() => !!idoc().querySelector(".booth"), T.boot, "remount");
        await poll(
          // 2026-09-11: rail-free boot readiness — the chain moved to its own
          // SONG page, so cue labels no longer exist at boot. The drums KIT
          // readout is the stage-independent "demo loaded" signal.
          () =>
            $$(".head-ctl-value").some((v) =>
              (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() === "SOFT STEP",
            ),
          T.ui,
          "restored cues after reload",
        );
        await openSong();
        await poll(
          () =>
            tiles("lead").length === 5 &&
            tiles("lead")[4]!.querySelector(".rail-tile-bars")!.textContent ===
              "8B" &&
            chainCycleName("lead") === "LEAD song chain · 12-BAR CYCLE",
          T.ui,
          "E (8 bars, 5-slot chain, 12-BAR CYCLE) survived the reload",
        );
        tiles("lead")[4]!.click(); // selection is ephemeral — re-select E
        await poll(
          () =>
            !!floor("lead").querySelector(
              `.note-edge[data-row="${noteRow}"][data-start="0"]`,
            ) &&
            floor("lead").querySelector<HTMLElement>(
              `.note-edge[data-row="${noteRow}"][data-start="0"]`,
            )!.dataset.length === "4",
          T.save,
          "the dragged note survived the reload",
        );
        // Save/load determinism: the post-reload export is byte-identical.
        const wavReload = await exportVia("EXPORT WAV");
        expect(wavReload.byteLength).toBe(wavBytes.byteLength);
        expect(firstDiffByte(wavReload, wavBytes)).toBe(-1);

        await openEdit();

        // --- 10. FV-1 WIDE PROBE: the same document at 1920×1080 -----------
        await new Promise((r) => setTimeout(r, 500));
        await teardownApp(false);
        app = await loadApp(1920, 1080);
        await poll(
          () => !!idoc().querySelector(".booth"),
          T.boot,
          "wide remount",
        );
        await poll(
          // 2026-09-11: rail-free boot readiness — the chain moved to its own
          // SONG page, so cue labels no longer exist at boot. The drums KIT
          // readout is the stage-independent "demo loaded" signal.
          () =>
            $$(".head-ctl-value").some((v) =>
              (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() === "SOFT STEP",
            ),
          T.ui,
          "journey doc at 1920",
        );
        // Settle: fonts + fit (a scrollbar-free document is what the
        // clientWidth === 1920 assert below needs).
        await poll(
          () => {
            const de = idoc().documentElement;
            return (
              de.scrollWidth <= 1920 &&
              de.scrollHeight <= 1080 &&
              (idoc().body.scrollWidth ?? 0) <= 1920 &&
              (idoc().body.scrollHeight ?? 0) <= 1080
            );
          },
          T.ui,
          "1920×1080 fit settle",
        );
        {
          const clientW = idoc().documentElement.clientWidth;
          expect(clientW, "1920 layout viewport (no scrollbar)").toBe(1920);
          const floors = $(".stage-floors").getBoundingClientRect();
          // 2026-09-11: the chain is its own page — measure it there.
          await openSong();
          const rail = $(".rail").getBoundingClientRect();
          expect(
            floors.width / clientW,
            "1920: stage floors ≥95% utilization (the retired cap measured 1400/1920 ≈ 73%)",
          ).toBeGreaterThanOrEqual(0.95);
          expect(
            rail.width / clientW,
            "1920: rail utilization",
          ).toBeGreaterThanOrEqual(0.95);
          await openEdit(); // the quadrant probes below read the grid stage
          expect(
            Math.abs(floors.left - Number.parseFloat(idoc().defaultView!.getComputedStyle($(".app")).paddingLeft)),
            "floors respect the app gutter",
          ).toBeLessThanOrEqual(0.5);
          expect(Math.abs(rail.left - (1920 - rail.right)), "symmetric rail gutters").toBeLessThanOrEqual(
            0.5,
          );
          const de = idoc().documentElement;
          expect(
            de.scrollWidth <= 1920 && de.scrollHeight <= 1080,
            "one-page law at 1920×1080",
          ).toBe(true);
          const leadW = floor("lead").getBoundingClientRect().width;
          expect(
            leadW,
            "the densified stage: lead quadrant > 900 px (the retired 1400 cap left ~660)",
          ).toBeGreaterThan(900);
        }
      } finally {
        // R14 teardown: iframe first (closes DB connections), then wipe.
        await teardownApp(true);
      }
    },
    300_000,
  );
});
