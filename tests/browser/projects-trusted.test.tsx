/**
 * i6 S-5 browser gate — the SAVED-SONG MANAGEMENT JOURNEY by TRUSTED CDP
 * TOUCH on the BUILT APP at the phone stage (390×844): the committed form
 * of the S-4 scratch probe the S-4 verifier handed to S-5's charter
 * ("the trusted-tap journey gates pass to S-5 per its charter" — plan.md
 * S-4 status). Charter: the mobile-touch-trusted (MB-6) harness — the real
 * dist bundle booted in a sized, scrollbar-pinned iframe, trusted
 * `Input.synthesizeTapGesture` taps (real gesture pipeline + click
 * finalization) with the R2 settle → fresh-measure → verify → ONE
 * re-measured retry law, and `Input.insertText` for the keyboard's half of
 * the rename (trusted text insertion over the mounted editor's
 * focus+select — typing over the selection, exactly like a user).
 *
 * The journey (one continuous story, taps only, real persistence — the
 * app's real "bitbounce" IndexedDB, seeded with one extra row from the
 * same-origin tester page through per-op connections that always close):
 *
 *   tap PROJECTS → the popover lists the seeded row → tap RENAME → the
 *   editor mounts focused+selected → trusted text replaces the name →
 *   BLUR-COMMIT by tapping non-focusable ground inside the popover (§2.5's
 *   stated click-away choice — a tap, not a key) → the row AND its db
 *   record carry the new name (envelope AND decoded json; the working
 *   demo row untouched) → tap DELETE → CONFIRM DELETE replaces the row
 *   (the two-step law) → the row is gone from the list AND the db → the
 *   sticky DELETED toast is still on screen past the 5 s transient window
 *   (XP-1: the undo window stays open) → tap UNDO → the row returns with
 *   BYTE-IDENTICAL json, original name/updatedAt/dirty, INACTIVE (UNDO
 *   never auto-switches — §3.4), and the toast dismisses after the
 *   successful one-shot run.
 *
 * Scope fences (why nothing else is re-proven here): sizing/geometry of
 * the same controls at 360/390/430 is S-4's phoneProjectsWalk
 * (target-size.test.tsx); the keyboard contract (Esc layering, Tab trap)
 * and the source-level journey twins are hu3.test.ts's; the touch editing
 * model is MB-6's matrix. This gate is the JOURNEY acceptance on the
 * shipped bundle: a finger can name, rename, delete, and undo a song
 * without a keyboard, and every step's effect is asserted against the
 * real database, not just the DOM.
 *
 * Viewport: 390×844 only (the MB-3 precedent — the full committed model
 * at 390; width-invariance of this popover vocabulary is S-4's 360/430
 * legs). Linux-CI scoping rides MB-6's R3 disposition (same tap-synthesis
 * gap in headless-Linux Chromium): authoritative on macOS, skipped on a
 * Linux UA.
 *
 * Teeth premise (the probe's discriminating power): the blur-commit tap
 * lands on a <p> that can never receive focus, so ONLY a genuine focus
 * loss on the editor can commit the rename — a blur-handler regression
 * reddens the rename step; the byte-identical UNDO compare reddens any
 * re-encode or dirty-flag drift in the restore path.
 */

import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { createFreshProjectDocument } from "../../src/state/store";
import { makeRecord, type ProjectRecord } from "../../src/persist/db";
import { encode, decode } from "../../src/document/codec";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One IndexedDB operation against the APP'S "bitbounce" database from the
 * same-origin tester page, on a connection that is ALWAYS closed before
 * the promise resolves — the bootPhone teardown's deleteDatabase is never
 * blocked by a lingering test handle (the S-4 probe's snapshot/restore
 * needed exactly this discipline).
 */
function appDbOp<T>(
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = indexedDB.open("bitbounce");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("projects", "readwrite");
      const inner = op(tx.objectStore("projects"));
      tx.oncomplete = () => {
        db.close();
        resolve(inner.result as T);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error("transaction failed"));
      };
    };
    req.onerror = () => reject(req.error ?? new Error("open failed"));
    req.onblocked = () => reject(new Error("blocked"));
  });
}

const appGetRecord = (id: string): Promise<ProjectRecord | undefined> =>
  appDbOp<ProjectRecord | undefined>((s) => s.get(id));

const appPutRecord = (record: ProjectRecord): Promise<void> =>
  appDbOp<IDBValidKey>((s) => s.put(record)).then(() => undefined);

/** A deterministic first-run demo boot (PX-1) in a sized, scrollbar-pinned
 *  iframe — the MB-6 bootPhone harness, trimmed to this gate's needs. */
async function bootPhone(
  w: number,
  h: number,
): Promise<{
  idoc: () => Document;
  iwin: () => Window;
  $: <T extends Element>(sel: string) => T;
  $$: <T extends Element>(sel: string) => T[];
  tapStable: (el: Element, opts: { effect: () => boolean; what: string }) => Promise<void>;
  teardown: () => Promise<void>;
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
  const cleanup = async (): Promise<void> => {
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
        await sleep(100);
      }
    }
  };
  try {
    // First-run honesty: the pre-boot wipe must genuinely complete.
    await new Promise<void>((resolve, reject) => {
      let blocked = false;
      const grace = setTimeout(() => {
        if (blocked) reject(new Error("pre-boot wipe stayed blocked for 3 s"));
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
    const iwin = () => iframe.contentWindow!;
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
  await poll(() => $$(".head-ctl-value").some((v) => (v.textContent ?? "").includes("SOFT STEP")), 5_000, "demo loaded");
    await poll(
      () => idoc().querySelector(".app")?.getAttribute("data-stage") === "phone",
      5_000,
      "phone stage",
    );

    const c = cdp();
    await c.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    const map = (ix: number, iy: number) => {
      const fr = (window.frameElement as HTMLElement).getBoundingClientRect();
      const ir = iframe.getBoundingClientRect();
      const sx = fr.width / innerWidth;
      const sy = fr.height / innerHeight;
      return {
        x: fr.left + (ir.left + ix) * sx,
        y: fr.top + (ir.top + iy) * sy,
      };
    };
    const reveal = async (el: Element): Promise<void> => {
      (el as HTMLElement).scrollIntoView({
        block: "center",
        inline: "nearest",
      });
      await sleep(40);
      const chrome = idoc().querySelector<HTMLElement>(".phone-chrome");
      const chromeBottom = chrome ? chrome.getBoundingClientRect().bottom : 0;
      if (el.getBoundingClientRect().top < chromeBottom + 4) {
        iwin().scrollBy(0, el.getBoundingClientRect().top - chromeBottom - 12);
        await sleep(40);
      }
    };
    const geometryQuiet = async (el: Element): Promise<void> => {
      try {
        await Promise.race([idoc().fonts.ready, sleep(1_500)]);
      } catch {
        /* fonts API unavailable — the stability poll below still applies */
      }
      const snap = (): string => {
        const r = el.getBoundingClientRect();
        const ir = iframe.getBoundingClientRect();
        const fr = (window.frameElement as HTMLElement).getBoundingClientRect();
        return `${r.left},${r.top},${r.width},${r.height}|${ir.left},${ir.top},${ir.width},${ir.height}|${fr.left},${fr.top},${fr.width},${fr.height}`;
      };
      for (let i = 0; i < 12; i++) {
        const a = snap();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (snap() === a) return;
      }
    };
    const effectMet = async (
      effect: () => boolean,
      ms: number,
    ): Promise<boolean> => {
      const t0 = performance.now();
      while (performance.now() - t0 <= ms) {
        if (effect()) return true;
        await sleep(50);
      }
      return effect();
    };
    let tapSeq = 0;
    /** MB-6 R2 tap: settle → fresh measure → synthesizeTapGesture → verify;
     * on a miss, re-measure and tap exactly ONCE more (never reuse coords). */
    const tapStable = async (
      el: Element,
      opts: { effect: () => boolean; what: string },
    ): Promise<void> => {
      const id = `tap #${++tapSeq} (${opts.what})`;
      const oneAttempt = async (): Promise<string> => {
        await reveal(el);
        await geometryQuiet(el);
        const rMeasure = el.getBoundingClientRect();
        const ix = rMeasure.left + rMeasure.width / 2;
        const iy = rMeasure.top + rMeasure.height / 2;
        const p = map(ix, iy);
        await c.send("Input.synthesizeTapGesture", {
          x: p.x,
          y: p.y,
          duration: 50,
          tapCount: 1,
          gestureSourceType: "touch",
        });
        await sleep(120); // click finalization is async in the gesture pipeline
        const rSynth = el.getBoundingClientRect();
        const hit = idoc().elementFromPoint(ix, iy);
        return `elementFromPoint@(${ix.toFixed(1)},${iy.toFixed(1)})=${hit ? `<${hit.tagName.toLowerCase()} class="${hit.getAttribute("class") ?? ""}">` : "null"} target@measure=[${rMeasure.left.toFixed(1)},${rMeasure.top.toFixed(1)} ${rMeasure.width.toFixed(1)}×${rMeasure.height.toFixed(1)}] target@synth=[${rSynth.left.toFixed(1)},${rSynth.top.toFixed(1)}]`;
      };
      const firstDiag = await oneAttempt();
      if (await effectMet(opts.effect, 4_000)) {
        console.log(`[S-5 ${id}] HIT (attempt 1)`);
        return;
      }
      console.log(
        `[S-5 ${id}] MISS on attempt 1 — one re-measured retry · ${firstDiag}`,
      );
      const secondDiag = await oneAttempt();
      if (await effectMet(opts.effect, 4_000)) {
        console.log(`[S-5 ${id}] HIT (attempt 2, after the re-measured retry)`);
        return;
      }
      throw new Error(
        `tap failed after ONE re-measured retry — ${opts.what}\n  attempt 1: ${firstDiag}\n  attempt 2: ${secondDiag}`,
      );
    };
    return {
      idoc,
      iwin,
      $,
      $$,
      tapStable,
      teardown: cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

// Linux-CI scoping (MB-6 R3: headless-Linux Chromium never synthesizes the
// trailing CLICK from synthesized touch taps — documented input-synthesis
// gap, not a product defect; authoritative on macOS).
const onLinuxCI = /Linux/.test(navigator.userAgent);

describe.skipIf(onLinuxCI)("i6 S-5 — saved-song management journey by trusted touch on the BUILT app (phone stage)", () => {
  it(
    // Short title on purpose (the MB-6 ENAMETOOLONG lesson); the stage list
    // lives in the header comment.
    "390×844 — tap-only rename/delete/undo journey",
    { timeout: 180_000 },
    async () => {
      // Size the TESTER window to the phone too (the help-touch convention):
      // the config default is 1280×800, so an 844-tall app iframe overflows
      // it and bottom-region taps (the toast's UNDO key) would map outside
      // the page — CDP rejects out-of-bounds gesture positions. At 390×844
      // the iframe fits exactly (scale 1:1) and the whole journey is
      // tappable.
      await page.viewport(390, 844);
      const app = await bootPhone(390, 844);
      const { idoc, $, $$, tapStable } = app;
      try {
        // Seed the journey's target row into the app's real database (the
        // demo row the app itself saved at boot stays the working row).
        const seedId = crypto.randomUUID();
        const seedName = "SEED SONG";
        const seedDoc = { ...createFreshProjectDocument(), name: seedName };
        await appPutRecord(
          makeRecord(seedId, seedDoc, encode(seedDoc), Date.now(), false),
        );

        // --- 1. open PROJECTS by tap ---------------------------------------
        await tapStable($("[data-help='projects.open']"), {
          effect: () => idoc().querySelector(".projects-pop") !== null,
          what: "PROJECTS tap opens the popover",
        });
        await poll(
          () => idoc().querySelector(`li[data-id="${CSS.escape(seedId)}"]`) !== null,
          4_000,
          "the seeded row is listed",
        );
        const rowOf = () =>
          idoc().querySelector(`li[data-id="${CSS.escape(seedId)}"]`);
        expect(
          rowOf()!.querySelector(".projects-name")!.textContent,
          "the seed row shows its saved name",
        ).toBe(seedName);

        // --- 2. rename by TAP + trusted text -------------------------------
        await tapStable(rowOf()!.querySelector(".projects-ren")!, {
          effect: () => rowOf()!.querySelector(".projects-edit") !== null,
          what: "RENAME tap swaps in the editor",
        });
        const editor = rowOf()!.querySelector<HTMLInputElement>(
          ".projects-edit",
        )!;
        // The editor's mount law (IN-4): focused with the initial text fully
        // selected — the state in which a trusted text insert REPLACES the
        // whole name, like a user typing over the selection.
        await poll(
          () =>
            idoc().activeElement === editor &&
            editor.selectionStart === 0 &&
            editor.selectionEnd === seedName.length,
          3_000,
          "editor focused with the name selected",
        );
        const newName = "TAP RENAMED";
        await cdp().send("Input.insertText", { text: newName });
        await poll(
          () => editor.value === newName,
          2_000,
          "trusted insertText replaced the selection",
        );

        // --- 3. BLUR-COMMIT by tapping ground (a tap, not a key) ----------
        // The note <p> is non-focusable content INSIDE the popover: the tap
        // can only commit through the editor's real blur handler (§2.5).
        await tapStable($(".projects-note"), {
          effect: () => rowOf()?.querySelector(".projects-edit") === null,
          what: "ground tap blurs the editor (commit)",
        });
        await poll(
          () =>
            rowOf()?.querySelector(".projects-name")?.textContent === newName,
          4_000,
          "the row shows the committed name",
        );
        // Inactive row → renameProjectRecord: envelope AND decoded json, and
        // the working demo row keeps its own name.
        await poll(
          async () => (await appGetRecord(seedId))?.name === newName,
          4_000,
          "the record envelope carries the new name",
        );
        const renamed = await appGetRecord(seedId);
        expect(decode(renamed!.json).name).toBe(newName);
        const demoRow = () =>
          [...$$(".projects-item")].find(
            (r) => r.querySelector(".projects-name")?.textContent === "WELCOME SONG",
          );
        expect(demoRow(), "the demo row is still listed").toBeTruthy();
        expect(demoRow()!.getAttribute("aria-current")).toBe("true");

        // The exact pre-delete bytes (the UNDO round-trip's comparator).
        const held = renamed!;

        // --- 4. delete: two taps + the sticky toast ------------------------
        await tapStable(rowOf()!.querySelector(".projects-del")!, {
          effect: () => rowOf()!.querySelector(".projects-confirm") !== null,
          what: "DELETE tap arms CONFIRM DELETE",
        });
        expect(
          rowOf()!.querySelector(".projects-item"),
          "the confirm state REPLACES the row content",
        ).toBeNull();

        const deletedToast = () =>
          [...idoc().querySelectorAll(".toast")].find((t) =>
            (t.textContent ?? "").includes(`DELETED "${newName}"`),
          ) ?? null;
        await tapStable(rowOf()!.querySelector(".projects-confirm")!, {
          effect: () =>
            rowOf() === null && deletedToast() !== null,
          what: "CONFIRM DELETE tap removes the row and raises the toast",
        });
        await poll(
          async () => (await appGetRecord(seedId)) === undefined,
          4_000,
          "the db row is gone",
        );

        // XP-1 teeth: the DELETED toast is STICKY — a transient toast would
        // be gone at 5 s; the undo window must still be open at 5.5 s.
        await sleep(5_500);
        const stickyCard = deletedToast();
        expect(stickyCard, "the DELETED toast stays armed past 5 s").toBeTruthy();
        expect(
          stickyCard!.querySelector(".toast-action")?.textContent?.trim(),
        ).toBe("UNDO");

        // --- 5. UNDO by tap: exact restore, never a switch ------------------
        await tapStable(stickyCard!.querySelector(".toast-action")!, {
          effect: () =>
            rowOf() !== null && deletedToast() === null,
          what: "UNDO tap restores the row and dismisses the toast",
        });
        const restored = await appGetRecord(seedId);
        // The exact held record: byte-identical json, original name and
        // updatedAt (§3.4 — no decode/re-encode, no dirty drift).
        expect(restored!.json).toBe(held.json);
        expect(restored!.name).toBe(held.name);
        expect(restored!.updatedAt).toBe(held.updatedAt);
        expect(restored!.dirty).toBe(held.dirty);
        // UNDO never auto-switches: the restored row returns INACTIVE and the
        // working row is still the demo (DOM law — the built app's store is
        // not importable here, and need not be).
        const restoredItem = rowOf()!.querySelector(".projects-item")!;
        expect(restoredItem.classList.contains("is-current")).toBe(false);
        expect(restoredItem.getAttribute("aria-current")).toBeNull();
        expect(demoRow()!.getAttribute("aria-current")).toBe("true");
      } finally {
        await app.teardown();
        await page.viewport(1280, 800); // leave the tester viewport as configured
      }
    },
    180_000,
  );
});
