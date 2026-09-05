/**
 * HL-1 browser gate (i3-5 edges) — LONG-RENDER FAILURE MODES on the real app.
 *
 * XP-1 proved the busy-guard spans a healthy render; this gate proves the
 * FAILURE half of the contract: every failure mode typed + recoverable —
 * nothing stuck, nothing lost, no partial file, autosave clean.
 *
 * | # | Failure mode                                | Law                        |
 * |---|---------------------------------------------|----------------------------|
 * | 1 | the export module call fails UNEXPECTEDLY    | honest error toast, sticky  |
 * |   | (the stale-deploy chunk-load class — an      | RENDERING dismissed, busy   |
 * |   | import() rejection lands in the SAME catch)  | cleared, no unhandled       |
 * |   |                                             | rejection, retry works      |
 * | 2 | offline render fails mid-render             | typed render toast, busy    |
 * |   | (startRendering rejects)                    | recovers, 0 blobs (no       |
 * |   |                                             | partial file), doc          |
 * |   |                                             | untouched, retry works,     |
 * |   |                                             | autosave row still decodes  |
 * | 3 | download io fails (createObjectURL throws)  | typed io toast, retry works |
 * | 4 | tab hidden mid-render + double-export race  | render completes, taps      |
 * |   | + popover closed mid-busy                   | swallowed, the disabled     |
 * |   |                                             | anchor blocks reopening     |
 *
 * Injection discipline: failures 2-4 go through REAL seams of the running
 * app — OfflineAudioContext.prototype.startRendering, URL.createObjectURL,
 * the synthetic visibilitychange — never a module mock. Failure 1 mocks the
 * export module ONCE (a throwing first call, the real implementation after)
 * because the vitest/browser page wrapper exposes no request interception
 * to abort the chunk request itself; the mocked throw and a rejected
 * dynamic import land in the SAME catch clause of the handler, which is
 * what the row gates.
 *
 * CI-cost honesty: the failed renders abort at once; the successful retries
 * render a 64-bar cycle (~2.5-4 s wall each, the XP-1/TH-5 measured band).
 * The 128-bar worst-case wall + heap numbers are recorded by TH-5 §10c/10d
 * (perf-budget.md); nothing here re-measures them.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import App from "../../src/App";
import { createDefaultProject, type ProjectDocument } from "../../src/document/schema";
import { decode } from "../../src/document/codec";
import { addNote, docStore, loadDocument } from "../../src/state/store";
import { clearToasts } from "../../src/state/toasts";
import { getActiveProjectId, getAutosaveController } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
// Token sheet exactly as deployed (the export-busy-guard precedent).
import "../../src/styles/base.css";

// Row 1's one-shot injection: the FIRST exportWav call from THIS file throws
// (the module-load/unexpected-throw class); every later call is the real
// pipeline. vi.mock is file-scoped, so tests 2-4 in this file run the REAL
// module — they order after row 1 and their exports must stay unmocked, so
// the flag flips exactly once and the mock then delegates.
const moduleFailure = { armed: true };
vi.mock("../../src/audio/exportWav", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/audio/exportWav")>();
  return {
    ...actual,
    exportWav: async (
      ...args: Parameters<typeof actual.exportWav>
    ): ReturnType<typeof actual.exportWav> => {
      if (moduleFailure.armed) {
        moduleFailure.armed = false;
        throw new Error("HL-1 injected module-call failure");
      }
      return actual.exportWav(...args);
    },
  };
});

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

/** Drums alone grow to `bars` bars — the export cycle = the longest lane. */
function unequalChainDoc(bars: 64 | 128): ProjectDocument {
  const doc = createDefaultProject();
  const drums = doc.patterns.drums[0];
  if (drums.kind !== "drums") throw new Error("expected drums");
  drums.bars = bars;
  const len = bars * 16;
  drums.steps = {
    kick: Array.from({ length: len }, (_, i) => i % 4 === 0),
    snare: Array.from({ length: len }, (_, i) => i % 16 === 4),
    hat: Array.from({ length: len }, (_, i) => i % 2 === 0),
    openhat: new Array<boolean>(len).fill(false),
    clap: new Array<boolean>(len).fill(false),
    tom: new Array<boolean>(len).fill(false),
  };
  return doc;
}

/** Best-effort visibilityState override (the TH-3 precedent). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

interface Harness {
  host: HTMLElement;
  cleanup: () => void;
  $: <T extends Element>(sel: string) => T;
  toastTexts: () => string[];
  toastFullText: () => string[];
  actionByLabel: (label: string) => HTMLButtonElement | undefined;
  openPopover: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  // The toast bus is module-global and survives across tests in this file —
  // start every case from a clean stack so toast waits are this test's own.
  clearToasts();
  const { host, cleanup } = mount();
  await waitFor(
    () => getAutosaveController() !== null,
    10_000,
    "boot autosave controller",
  );
  const h: Harness = {
    host,
    cleanup,
    $: <T extends Element>(sel: string): T => {
      const el = host.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    toastTexts: () =>
      Array.from(host.querySelectorAll(".toast-message")).map(
        (t) => t.textContent ?? "",
      ),
    // Message + suggestion + details — the whole toast's visible text.
    toastFullText: () =>
      Array.from(host.querySelectorAll(".toast")).map(
        (t) => t.textContent ?? "",
      ),
    actionByLabel: (label: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".projects-action")).find(
        (b) => b.textContent?.trim() === label,
      ),
    openPopover: async () => {
      (host.querySelector(".projects-btn") as HTMLButtonElement).click();
      await waitFor(
        () => host.querySelector(".projects-pop") !== null,
        4000,
        "projects popover",
      );
    },
  };
  return h;
}

describe("HL-1 long-render failure modes (real app)", () => {
  // This test MUST run first in the file: the vi.mock toggle is one-shot
  // (armed at module load) and the module-call failure class is only
  // injectable before any healthy export runs.
  it(
    "1. export module call fails UNEXPECTEDLY: honest toast, never stuck, retry works",
    { timeout: 60_000 },
    async () => {
      expect(moduleFailure.armed).toBe(true); // injection precondition
      const h = await setup();
      const snap = await snapshotDb();
      const blobs: string[] = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob.type);
        return origCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
      const rejections: unknown[] = [];
      const onUnhandled = (e: PromiseRejectionEvent) => rejections.push(e.reason);
      window.addEventListener("unhandledrejection", onUnhandled);
      try {
        loadDocument(createDefaultProject());
        await h.openPopover();

        h.actionByLabel("EXPORT WAV")!.click();
        // The sticky RENDERING toast appears, then the honest failure.
        await waitFor(
          () => h.toastTexts().some((t) => t === "RENDERING WAV…"),
          4000,
          "RENDERING toast while the export call fails",
        );
        await waitFor(
          () => h.toastTexts().some((t) => t === "WAV export could not start."),
          8000,
          "the unexpected-failure toast (the chunk-load class)",
        );
        await waitFor(
          () => h.toastFullText().some((t) => t.includes("reload the page")),
          2000,
          "the recovery suggestion",
        );
        await waitFor(
          () => !h.toastTexts().some((t) => t === "RENDERING WAV…"),
          2000,
          "RENDERING toast dismissed on failure",
        );
        // Busy cleared: the popover actions re-enable.
        await waitFor(
          () =>
            h.actionByLabel("EXPORT WAV") !== undefined &&
            !h.actionByLabel("EXPORT WAV")!.disabled,
          4000,
          "busy cleared after the failure",
        );
        expect(blobs).toHaveLength(0); // nothing half-started
        // No unhandled rejection leaked (the pre-fix class: the sticky
        // toast vanished with no explanation and the rejection went quiet).
        await new Promise((r) => setTimeout(r, 150));
        expect(rejections).toHaveLength(0);

        // Retry — the real pipeline runs end to end.
        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t.includes("WAV EXPORTED")),
          30_000,
          "retry succeeds (the one-shot mock now delegates)",
        );
        expect(blobs).toEqual(["audio/wav"]); // exactly one, from the retry
      } finally {
        window.removeEventListener("unhandledrejection", onUnhandled);
        URL.createObjectURL = origCreateObjectURL;
        h.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "2. render failure mid-export: typed toast, busy recovers, 0 blobs, doc + autosave untouched, retry works",
    { timeout: 120_000 },
    async () => {
      const h = await setup();
      const snap = await snapshotDb();
      const blobs: string[] = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob.type);
        return origCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
      // Inject ONE failing render through the real offline pipeline seam.
      const origStartRendering =
        OfflineAudioContext.prototype.startRendering;
      let failedOnce = false;
      OfflineAudioContext.prototype.startRendering =
        function (this: OfflineAudioContext) {
          if (!failedOnce) {
            failedOnce = true;
            return Promise.reject(new Error("HL-1 injected render failure"));
          }
          return origStartRendering.call(this);
        };
      try {
        loadDocument(unequalChainDoc(64));
        const docBefore = docStore.getState().doc;
        await h.openPopover();

        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t === "RENDERING WAV…"),
          4000,
          "RENDERING toast",
        );
        await waitFor(
          () => h.toastTexts().some((t) => t === "WAV could not be rendered."),
          10_000,
          "typed render-failure toast",
        );
        await waitFor(
          () =>
            h.toastFullText().some((t) =>
              t.includes("Playback is untouched — try exporting again."),
            ),
          2000,
          "recovery suggestion",
        );
        await waitFor(
          () => !h.toastTexts().some((t) => t === "RENDERING WAV…"),
          2000,
          "RENDERING toast dismissed (never stuck RENDERING)",
        );
        await waitFor(
          () => !h.actionByLabel("EXPORT WAV")!.disabled,
          4000,
          "busy cleared after render failure",
        );
        expect(blobs).toHaveLength(0); // no partial file ever downloaded
        expect(docStore.getState().doc).toBe(docBefore); // doc untouched

        // Autosave is not corrupted by the failed export: edit → flush →
        // the persisted row still decodes to the current document.
        expect(
          addNote("lead", docStore.getState().doc.patterns.lead[0]!.id, {
            degree: 3,
            start: 0,
            length: 2,
          }),
        ).toBe(true);
        await getAutosaveController()!.flush();
        const db = await openRawProjectDb("bitbounce");
        const row = (await db.allRecords()).find(
          (r) => r.id === getActiveProjectId(),
        );
        expect(row).toBeTruthy();
        expect(() => decode(row!.json)).not.toThrow();
        expect(decode(row!.json)).toEqual(docStore.getState().doc);

        // Retry: the second render goes through the REAL pipeline.
        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t === "WAV EXPORTED · 64-BAR CYCLE"),
          60_000,
          "retry succeeds (fresh offline context — the WeakSet discipline)",
        );
        expect(blobs).toEqual(["audio/wav"]);
      } finally {
        OfflineAudioContext.prototype.startRendering = origStartRendering;
        URL.createObjectURL = origCreateObjectURL;
        h.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "3. download io failure: typed io toast, retry works",
    { timeout: 60_000 },
    async () => {
      const h = await setup();
      const snap = await snapshotDb();
      const blobs: string[] = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      let thrownOnce = false;
      URL.createObjectURL = ((blob: Blob) => {
        if (!thrownOnce) {
          thrownOnce = true;
          throw new Error("HL-1 injected io failure");
        }
        blobs.push(blob.type);
        return origCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
      try {
        loadDocument(createDefaultProject()); // 1-bar cycle: fast render
        await h.openPopover();

        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t === "WAV file could not be saved."),
          20_000,
          "typed io-failure toast",
        );
        await waitFor(
          () =>
            h.toastFullText().some((t) =>
              t.includes("Check the browser's download settings"),
            ),
          2000,
          "io recovery suggestion",
        );
        await waitFor(
          () => !h.actionByLabel("EXPORT WAV")!.disabled,
          4000,
          "busy cleared after io failure",
        );
        expect(blobs).toHaveLength(0);

        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t.includes("WAV EXPORTED")),
          20_000,
          "retry succeeds once the io seam heals",
        );
        expect(blobs).toEqual(["audio/wav"]);
      } finally {
        URL.createObjectURL = origCreateObjectURL;
        h.cleanup();
        await restoreDb(snap);
      }
    },
  );

  it(
    "4. tab hidden mid-render + double-tap race + popover close/reopen: render completes, busy survives",
    { timeout: 120_000 },
    async () => {
      const h = await setup();
      const snap = await snapshotDb();
      const blobs: string[] = [];
      const origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob) => {
        blobs.push(blob.type);
        return origCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
      try {
        loadDocument(unequalChainDoc(128)); // worst case: a ~5-7 s busy window
        await h.openPopover();

        h.actionByLabel("EXPORT WAV")!.click();
        await waitFor(
          () => h.toastTexts().some((t) => t === "RENDERING WAV…"),
          4000,
          "RENDERING toast",
        );

        // Hide the tab mid-render (the TH-3 law at render scale)…
        setVisibility("hidden");
        // …and race it: second taps direct + synthetic bubbling.
        h.actionByLabel("EXPORT WAV")!.click();
        h.actionByLabel("EXPORT MIDI")!.click();
        h.actionByLabel("EXPORT WAV")!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        expect(blobs.length).toBeLessThanOrEqual(1); // never a SECOND export
        expect(h.toastTexts().some((t) => t === "RENDERING WAV…")).toBe(true);

        // Close the popover mid-busy (Escape). The anchor PROJECTS button is
        // itself one-shot through the render: it STAYS disabled, so the
        // panel cannot be reopened to fire another action mid-busy — a
        // synthetic bubbling click at the disabled anchor is a no-op.
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        await waitFor(
          () => h.host.querySelector(".projects-pop") === null,
          2000,
          "popover closed mid-busy",
        );
        const anchor = h.$(".projects-btn") as HTMLButtonElement;
        expect(anchor.disabled).toBe(true);
        anchor.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await new Promise((r) => setTimeout(r, 150));
        expect(h.host.querySelector(".projects-pop")).toBeNull();
        expect(blobs.length).toBeLessThanOrEqual(1);

        // Back to visible; the render was never interrupted.
        setVisibility("visible");
        await waitFor(
          () => h.toastTexts().some((t) => t === "WAV EXPORTED · 128-BAR CYCLE"),
          90_000,
          "render completes across the hidden window",
        );
        expect(blobs).toEqual(["audio/wav"]); // exactly one
        // Busy cleared end-state: the anchor re-enables and the popover
        // opens again with every action operable (the retry lane).
        await waitFor(
          () => !(h.$(".projects-btn") as HTMLButtonElement).disabled,
          4000,
          "anchor re-enabled after completion",
        );
        (h.$(".projects-btn") as HTMLButtonElement).click();
        await waitFor(
          () => h.host.querySelector(".projects-pop") !== null,
          2000,
          "popover opens after completion",
        );
        const asyncActions = ["NEW", "EXPORT WAV", "EXPORT MIDI", "OPEN FILE"];
        expect(
          asyncActions.every(
            (label) => h.actionByLabel(label)?.disabled === false,
          ),
        ).toBe(true);
      } finally {
        setVisibility("visible");
        URL.createObjectURL = origCreateObjectURL;
        h.cleanup();
        await restoreDb(snap);
      }
    },
  );
});
