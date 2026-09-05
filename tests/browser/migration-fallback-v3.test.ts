/**
 * HL-1 browser gate — MIGRATION-FALLBACK UX through the REAL OPEN FILE path
 * (i3 edges; the IN-4 v1 precedent extended to the v3-era corpus). Every
 * class below is fed through the actual hidden .projects-input (DataTransfer
 * → the real import handler → decode → migrate → validate); the typed result
 * surfaces as the shared toast, the working project stays untouched, and no
 * partial row is ever written.
 *
 * | # | Corpus class (file bytes)                | UX law                     |
 * |---|------------------------------------------|----------------------------|
 * | 1 | v3 corrupted structurally                | corrupt toast + issues,    |
 * |   |                                          | dismissible, store + rows  |
 * |   |                                          | untouched                  |
 * | 2 | truncated JSON                           | not-json toast             |
 * | 3 | __proto__/constructor at v3 positions    | corrupt toast;             |
 * |   |                                          | Object.prototype NEVER     |
 * |   |                                          | polluted                   |
 * | 4 | 4.1 MB VALID JSON (over the decode cap)  | too-large toast with the   |
 * |   |                                          | HONEST message (never      |
 * |   |                                          | "not valid JSON")          |
 * | 5 | 3.9 MB valid project (under the cap)     | imports (OPENED toast)     |
 * | 6 | v2 with loopBars ≠ chain basis           | imports; the LCM basis is  |
 * |   |                                          | the chain truth            |
 * | 7 | v2 with bars=8 (out-of-v2 vocab)         | imports (permissive widen) |
 * | 8 | v1 sustain-heavy (the full ladder)       | imports at v3              |
 * | 9 | recovery: a valid import AFTER failures  | works — the path never     |
 * |   |                                          | wedges                     |
 *
 * The unit twin (typed results, fake idb, every boundary arithmetic) is
 * tests/import-edge-corpus.test.ts.
 */

import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import Projects from "../../src/components/Projects";
import Toasts from "../../src/components/Toasts";
import { createDefaultProject, type ProjectDocument } from "../../src/document/schema";
import { encode } from "../../src/document/codec";
import { laneCycleSteps } from "../../src/audio/song";
import { docStore } from "../../src/state/store";
import { clearToasts } from "../../src/state/toasts";
import { getAutosaveController, initPersistence } from "../../src/persist/boot";
import { openRawProjectDb, type ProjectDb } from "../../src/persist/db";
import { v2ProjectText } from "../v2Project";
import { sustainHeavyV1ProjectText } from "../v1Project";

async function freshDb(name: string): Promise<ProjectDb> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  return openRawProjectDb(name);
}

function setInputFiles(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(
  predicate: () => boolean,
  ms = 6000,
  what = "condition",
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`${what} never met within budget`);
}

/** Wait for the shared Toasts bus to show a role=alert error toast. */
async function errorToast(): Promise<HTMLElement> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const el = document.body.querySelector<HTMLElement>('[role="alert"] .toast');
    if (el) return el;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("error toast never appeared");
}

/** A valid project's canonical text, space-padded to `chars` (legal JSON). */
function paddedTo(doc: ProjectDocument, chars: number): string {
  const body = encode(doc);
  return " ".repeat(chars - body.length) + body;
}

describe("HL-1 migration-fallback UX (v3-era corpus, REAL OPEN FILE path)", () => {
  it(
    "1-4+9. hostile/corrupt/oversized classes: typed toasts, project untouched, no partial rows, recovery works",
    { timeout: 120_000 },
    async () => {
      const db = await freshDb("bitbounce-hl1-import-fallback");
      const host = document.createElement("div");
      document.body.append(host);
      const toastHost = document.createElement("div");
      document.body.append(toastHost);
      const dispose = render(Projects, host);
      const disposeToasts = render(Toasts, toastHost);
      try {
        await initPersistence({ db });
        const before = docStore.getState().doc;
        const rowsBefore = (await db.allRecords()).length;
        const input = host.querySelector<HTMLInputElement>(
          'input[type="file"]',
        )!;

        const feed = async (file: File): Promise<HTMLElement> => {
          clearToasts();
          setInputFiles(input, file);
          const toast = await errorToast();
          return toast;
        };
        const assertUntouched = async (): Promise<void> => {
          expect(docStore.getState().doc).toBe(before);
          expect(await db.allRecords()).toHaveLength(rowsBefore);
        };

        // --- 1. v3 corrupted structurally --------------------------------
        const bad = JSON.parse(encode(createDefaultProject()));
        bad.patterns.bass = 5;
        let toast = await feed(
          new File([JSON.stringify(bad)], "broken.bitbounce.json", {
            type: "application/json",
          }),
        );
        expect(toast.textContent).toContain("damaged or incomplete");
        expect(toast.querySelector("button")).not.toBeNull(); // dismissible
        await assertUntouched();
        toast.querySelector("button")!.click();
        await waitFor(
          () => document.body.querySelector('[role="alert"] .toast') === null,
        );

        // --- 2. truncated JSON --------------------------------------------
        const full = encode(createDefaultProject());
        toast = await feed(
          new File(
            [full.slice(0, Math.floor(full.length / 2))],
            "cut.bitbounce.json",
            { type: "application/json" },
          ),
        );
        expect(toast.textContent).toContain("not valid JSON");
        await assertUntouched();
        toast.querySelector("button")!.click();
        await waitFor(
          () => document.body.querySelector('[role="alert"] .toast') === null,
        );

        // --- 3. hostile prototype keys at v3 shapes ------------------------
        const hostile = JSON.parse(encode(createDefaultProject()));
        toast = await feed(
          new File(
            [
              JSON.stringify({
                ...hostile,
                patterns: {
                  __proto__: { polluted: "yes" },
                  constructor: { prototype: { polluted: "yes" } },
                  ...hostile.patterns,
                },
              }),
            ],
            "hostile.bitbounce.json",
            { type: "application/json" },
          ),
        );
        expect(toast.textContent).toContain("damaged");
        await assertUntouched();
        // The pollution probe: fresh objects stay clean.
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        toast.querySelector("button")!.click();
        await waitFor(
          () => document.body.querySelector('[role="alert"] .toast') === null,
        );

        // --- 4. 4.1 MB VALID JSON over the decode cap ----------------------
        const overCap = paddedTo(createDefaultProject(), 4_300_000);
        toast = await feed(
          new File([overCap], "huge.bitbounce.json", {
            type: "application/json",
          }),
        );
        expect(toast.textContent).toContain("too large to open safely");
        // The honesty law: this file IS valid JSON — the pre-fix message
        // ("not valid JSON") must never appear for this class.
        expect(toast.textContent).not.toContain("not valid JSON");
        await assertUntouched();
        toast.querySelector("button")!.click();
        await waitFor(
          () => document.body.querySelector('[role="alert"] .toast') === null,
        );

        // --- 9. recovery: a valid import still works after every failure ---
        clearToasts();
        setInputFiles(
          input,
          new File(
            [
              JSON.stringify({
                ...createDefaultProject(),
                name: "after the fall",
              }),
            ],
            "good.bitbounce.json",
            { type: "application/json" },
          ),
        );
        await waitFor(
          () => docStore.getState().doc.name === "after the fall (imported)",
        );
        expect(await db.allRecords()).toHaveLength(rowsBefore + 1);
      } finally {
        dispose();
        disposeToasts();
        clearToasts();
        await getAutosaveController()?.stop();
        host.remove();
        toastHost.remove();
      }
    },
  );

  it(
    "5-8. the accept classes: 3.9 MB under the cap, v2 loopBars≠basis, v2 bars=8, v1 ladder",
    { timeout: 120_000 },
    async () => {
      const db = await freshDb("bitbounce-hl1-import-accept");
      const host = document.createElement("div");
      document.body.append(host);
      const toastHost = document.createElement("div");
      document.body.append(toastHost);
      const dispose = render(Projects, host);
      const disposeToasts = render(Toasts, toastHost);
      try {
        await initPersistence({ db });
        // Running row count: each accepted import adds exactly ONE row.
        let rows = (await db.allRecords()).length;
        const input = host.querySelector<HTMLInputElement>(
          'input[type="file"]',
        )!;

        const feed = async (file: File, name: string): Promise<void> => {
          clearToasts();
          setInputFiles(input, file);
          await waitFor(
            () => docStore.getState().doc.name === `${name} (imported)`,
            15_000,
            `import of ${name}`,
          );
          rows += 1;
          expect(await db.allRecords()).toHaveLength(rows);
        };

        // --- 5. 3.9 MB valid project (under the 4 MB decode cap) -----------
        await feed(
          new File(
            [paddedTo({ ...createDefaultProject(), name: "wide" }, 3_900_000)],
            "wide.bitbounce.json",
            { type: "application/json" },
          ),
          "wide",
        );

        // --- 6. v2 loopBars ≠ chain basis ----------------------------------
        await feed(
          new File(
            [v2ProjectText({ ...createDefaultProject(), name: "mismatch" }, 4)],
            "mismatch.bitbounce.json",
            { type: "application/json" },
          ),
          "mismatch",
        );
        const doc = docStore.getState().doc;
        expect(doc.version).toBe(3);
        expect("loopBars" in doc.transport).toBe(false);
        // The LCM basis is the chain truth (16), not the stale loopBars (4).
        expect(
          (["drums", "bass", "chords", "lead"] as const).every(
            (lane) => laneCycleSteps(doc, lane) === 16,
          ),
        ).toBe(true);

        // --- 7. v2 carrying bars=8 (invalid in v2, v3-legal) ----------------
        const wide = createDefaultProject();
        wide.patterns.bass[0] = { ...wide.patterns.bass[0], bars: 8 };
        await feed(
          new File(
            [v2ProjectText({ ...wide, name: "era-crosser" })],
            "era.bitbounce.json",
            { type: "application/json" },
          ),
          "era-crosser",
        );
        expect(docStore.getState().doc.patterns.bass[0].bars).toBe(8);
        expect(laneCycleSteps(docStore.getState().doc, "bass")).toBe(128);

        // --- 8. v1 sustain-heavy through the full ladder ---------------------
        await feed(
          new File(
            [sustainHeavyV1ProjectText()],
            "sustain.bitbounce.json",
            { type: "application/json" },
          ),
          "SUSTAIN LAB",
        );
        expect(docStore.getState().doc.version).toBe(3);
      } finally {
        dispose();
        disposeToasts();
        clearToasts();
        await getAutosaveController()?.stop();
        host.remove();
        toastHost.remove();
      }
    },
  );
});
