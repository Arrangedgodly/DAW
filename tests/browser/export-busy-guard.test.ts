/**
 * XP-1 browser gate (i3-5) — the busy-guard UX spans the LONG render.
 *
 * The offline render of one LCM cycle at the 128-bar worst case runs
 * 12-15 s wall (LP-1 §10; re-measured by this task's audio-determinism
 * case). The UX must stay honest for that whole window:
 *
 * - the RENDERING WAV… toast is on screen while the render runs (STICKY —
 *   a 5 s auto-dismiss would erase the state mid-render; the unit proof of
 *   stickiness lives in tests/toasts.test.ts, this gate proves the wiring:
 *   visible on start, still present mid-render, dismissed on completion);
 * - every popover action is ONE-SHOT while busy: mid-render second taps on
 *   EXPORT WAV (and every sibling action) are swallowed — exactly one
 *   render, exactly one download;
 * - BOTH success toasts report the CYCLE bars (the LCM of lane chain
 *   totals): one lane resized to 32 bars against three 1-bar lanes makes
 *   every export 32 bars.
 *
 * CI-time honesty: this gate renders a 64-bar cycle (~128 s of audio, a
 * multi-second wall — enough window for the mid-render probes) rather than
 * the 128-bar worst case; the worst case's wall time is measured and
 * recorded by the XP-1 determinism case in audio-determinism.test.ts.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { createDefaultProject, type ProjectDocument } from "../../src/document/schema";
import { loadDocument } from "../../src/state/store";
import { getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// Token sheet exactly as deployed (the pattern-resize precedent).
import "../../src/styles/base.css";

function mount(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(App, host);
  return {
    host,
    cleanup: () => {
      dispose();
      host.remove();
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  ms = 4000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

async function snapshotDb(): Promise<{
  db: ProjectDb;
  rows: Awaited<ReturnType<ProjectDb["allRecords"]>>;
} | null> {
  try {
    const db = await openRawProjectDb("bitbounce");
    return { db, rows: await db.allRecords() };
  } catch {
    return null;
  }
}

async function restoreDb(
  snap: Awaited<ReturnType<typeof snapshotDb>>,
): Promise<void> {
  if (!snap) return;
  try {
    const ids = new Set(snap.rows.map((r) => r.id));
    const current = await snap.db.allRecords();
    for (const row of snap.rows) await snap.db.putRecord(row);
    for (const row of current)
      if (!ids.has(row.id)) await snap.db.deleteRecord(row.id);
  } catch {
    /* best-effort restore */
  }
}

/** Drums alone grow to 64 bars (content preserved by the grow law) — the
 * export cycle becomes the LONGEST lane = 64 bars while every other lane
 * stays 1 bar (the I3-d shape; measured ~2.3 s render + encode in this
 * environment — a comfortably probe-able busy window at CI-sane cost). */
function unequalChain64Bars(): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  if (drums.kind !== "drums") throw new Error("expected drums");
  drums.bars = 64;
  const len = 64 * 16;
  drums.steps = {
    kick: Array.from({ length: len }, (_, i) => i % 4 === 0),
    snare: Array.from({ length: len }, (_, i) => i % 16 === 4),
    hat: Array.from({ length: len }, (_, i) => i % 2 === 0),
    openhat: new Array<boolean>(len).fill(false),
    clap: new Array<boolean>(len).fill(false),
    tom: new Array<boolean>(len).fill(false),
  };
  const lead = doc.patterns.lead[0];
  if (lead.kind !== "pitched") throw new Error("expected pitched lead");
  lead.notes = [{ degree: 3, start: 0, length: 2 }];
  return doc;
}

describe("XP-1 export busy-guard (real app, long render)", () => {
  it(
    "RENDERING state visible through the render; mid-render second taps swallowed; toasts report CYCLE bars",
    { timeout: 120_000 },
    async () => {
      const { host, cleanup } = mount();
      const snap = await snapshotDb();
      // Capture every export download through the URL seam (e2e precedent).
      const blobs: { type: string }[] = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob) => {
        blobs.push({ type: blob.type });
        return origCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
      try {
        await waitFor(
          () => getAutosaveController() !== null,
          10_000,
          "boot autosave controller",
        );
        loadDocument(unequalChain64Bars());

        const $ = <T extends Element>(sel: string): T => {
          const el = host.querySelector<T>(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const $$ = <T extends Element>(sel: string): T[] =>
          Array.from(host.querySelectorAll<T>(sel));
        const toastTexts = () =>
          $$(".toast-message").map((t) => t.textContent ?? "");
        const actionByLabel = (label: string): HTMLButtonElement | undefined =>
          $$(".projects-action").find(
            (b) => b.textContent?.trim() === label,
          ) as HTMLButtonElement | undefined;

        // Open the Projects popover.
        ($(".projects-btn") as HTMLButtonElement).click();
        await waitFor(
          () => host.querySelector(".projects-pop") !== null,
          4000,
          "projects popover",
        );
        expect(actionByLabel("EXPORT WAV")).toBeTruthy();

        // --- The export + the busy window --------------------------------
        actionByLabel("EXPORT WAV")!.click();
        const t0 = performance.now();
        await waitFor(
          () => toastTexts().some((t) => t === "RENDERING WAV…"),
          4000,
          "RENDERING WAV… toast",
        );
        const busyVisibleAt = performance.now() - t0;

        // Mid-render honesty: the busy state IS the screen. The four ASYNC
        // actions (NEW, both EXPORTs, OPEN FILE — the busy-guarded set;
        // SAVE FILE is a pure synchronous encode and stays operable by
        // design) are one-shot while rendering, the RENDERING toast still
        // present.
        const asyncActions = ["NEW", "EXPORT WAV", "EXPORT MIDI", "OPEN FILE"];
        await waitFor(
          () =>
            asyncActions.every(
              (label) => actionByLabel(label)?.disabled === true,
            ),
          2000,
          "async popover actions disabled while rendering",
        );
        expect(($(".projects-btn") as HTMLButtonElement).disabled).toBe(true);
        expect(toastTexts().some((t) => t === "RENDERING WAV…")).toBe(true);

        // Mid-render second taps: a disabled control swallows the click by
        // construction (no event fires). Exercise BOTH the direct .click()
        // and a synthetic bubbling click at the button — the guard's RED
        // tooth (guard removed) fails on exactly these.
        actionByLabel("EXPORT WAV")!.click();
        actionByLabel("EXPORT MIDI")!.click();
        for (const tap of [0, 1]) {
          actionByLabel("EXPORT WAV")!.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
          await new Promise((r) => setTimeout(r, 50 + tap * 50));
          // Still busy: exactly zero export blobs so far, RENDERING visible.
          expect(blobs.filter((b) => b.type === "audio/wav")).toHaveLength(0);
          expect(toastTexts().some((t) => t === "RENDERING WAV…")).toBe(true);
        }

        // Completion: the RENDERING toast is dismissed and the success
        // toast names the CYCLE — 64 bars (the longest lane), not 1. PX-4
        // final wording: `· 64-BAR CYCLE` (XP-1 deferred the wording here).
        await waitFor(
          () => toastTexts().some((t) => t.includes("WAV EXPORTED")),
          60_000,
          "WAV export success toast",
        );
        const busyMs = performance.now() - t0;
        console.log(
          `[xp1] busy-guard gate: RENDERING visible after ${Math.round(busyVisibleAt)} ms; render+download busy window ${Math.round(busyMs)} ms (64-bar cycle)`,
        );
        const success = toastTexts().find((t) => t.includes("WAV EXPORTED"))!;
        expect(success).toBe("WAV EXPORTED · 64-BAR CYCLE");
        await waitFor(
          () => !toastTexts().some((t) => t === "RENDERING WAV…"),
          2000,
          "RENDERING toast dismissed on completion",
        );
        // Exactly ONE render/download — every second tap was swallowed.
        expect(blobs.filter((b) => b.type === "audio/wav")).toHaveLength(1);
        // The busy window was genuinely multi-second (the probe window was
        // real): at least 750 ms of busy time observed.
        expect(busyMs).toBeGreaterThan(750);

        // --- MIDI through the same popover: cycle bars on this toast too --
        await waitFor(
          () => actionByLabel("EXPORT MIDI") !== undefined && !actionByLabel("EXPORT MIDI")!.disabled,
          10_000,
          "popover actions re-enabled (busy cleared)",
        );
        actionByLabel("EXPORT MIDI")!.click();
        await waitFor(
          () => toastTexts().some((t) => t.includes("MIDI EXPORTED")),
          10_000,
          "MIDI export success toast",
        );
        const midiToast = toastTexts().find((t) =>
          t.includes("MIDI EXPORTED"),
        )!;
        expect(midiToast).toMatch(
          /^MIDI EXPORTED · 5 TRACKS · \d+ NOTES · 64-BAR CYCLE$/,
        );
        expect(blobs.filter((b) => b.type === "audio/midi")).toHaveLength(1);
        expect(blobs).toHaveLength(2); // no stray double renders anywhere
      } finally {
        URL.createObjectURL = origCreateObjectURL;
        cleanup();
        await restoreDb(snap);
      }
    },
  );
});
