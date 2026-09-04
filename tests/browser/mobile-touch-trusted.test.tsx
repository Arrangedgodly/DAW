/**
 * MB-6 browser gate — the CONSOLIDATED trusted-touch acceptance matrix for
 * M17 ("Works In Your Pocket"): every editing action named in the committed
 * phone model, driven by TRUSTED CDP TOUCH (`Input.dispatchTouchEvent`)
 * against the REAL BUILT APP (dist bundle in a sized iframe — the
 * mobile-viewport harness), at BOTH committed phone viewports:
 *
 * 390×844 — the full committed editing model:
 *   transport (PLAY/STOP tap, playhead liveness), lane switcher tap, tap
 *   place/remove (the gate-default note), drag-create (≥2 segments),
 *   edge-resize (trim), drums paint, euclid arm→SET (FILL reveal → stepper
 *   taps → SET commits the row), rail sweep cue (stopped → selection
 *   follows the last-touched tile; playing → the quantized switch QUEUES),
 *   preset stepper, MIX (MUTE/SOLO taps + the volume slider by touch), FX
 *   (console open by tap, bypass flip, ADD a device, close), EXPORTS
 *   (busy-guarded: the guard swallows a second tap mid-render; both blobs
 *   captured through the iframe's URL.createObjectURL seam), and PROJECTS
 *   SWITCH (NEW by touch → the empty-project stage; back to the WELCOME
 *   SONG demo row).
 *
 * 360×800 — the tight-viewport pass: the same CORE gesture classes (tap
 *   place/remove, drag-create, edge-resize, drums paint, euclid SET on the
 *   wrapped commit line, transport, preset stepper, MUTE, stopped sweep) —
 *   the MB-3 precedent (full inventory at 390, core re-proof at 360); the
 *   popover-vocabulary surfaces (exports/projects) are width-invariant and
 *   proven at 390.
 *
 * Division of labor (the matrix index lives in docs/dev/
 * definition-of-done.md §6): MB-2's touch-gestures.test.tsx is the
 * SOURCE-MOUNTED per-gesture gate with store assertions + the
 * gesture-vs-scroll discrimination; MB-4's mobile-resilience.test.tsx owns
 * the touch edge table (touchCancel, second finger, long-press,
 * scroll-cancel); THIS gate is the consolidated BUILT-APP acceptance run —
 * the shipped bundle, trusted touch only, DOM-observable assertions.
 *
 * Harness honesty (recorded): CDP touch coordinates map through BOTH
 * iframe boxes (the app iframe inside the vitest tester iframe, which
 * vitest scales to fit — measured fresh at every dispatch, never assumed);
 * `dispatchTouchEvent` runs the real gesture handlers and click
 * finalization but does not drive compositor scrolling (MB-2's recorded
 * split — scrolling is `synthesizeScrollGesture`'s half, owned by
 * touch-gestures/mobile-resilience). The boot iframe pins
 * `scrollbar-width: none` (MB-6's measured hardening: the committed phone
 * target is Android Chrome, whose overlay scrollbars take no layout width
 * — a classic desktop scrollbar would lay the phone out 15 px narrower
 * than the committed 390/360).
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A deterministic first-run demo boot (PX-1) in a sized, scrollbar-pinned
 *  iframe, with the blob-download seam captured before the app loads. */
async function bootPhone(
  w: number,
  h: number,
): Promise<{
  iframe: HTMLIFrameElement;
  iwin: () => Window;
  idoc: () => Document;
  $: <T extends Element>(sel: string) => T;
  $$: <T extends Element>(sel: string) => T[];
  blobs: Array<{ type: string; size: number }>;
  reveal: (el: Element) => Promise<void>;
  tap: (el: Element) => Promise<void>;
  touch: (
    pts: ReadonlyArray<{ x: number; y: number }>,
    holdMs?: number,
  ) => Promise<void>;
  touchLine: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    box: DOMRect,
    steps?: number,
  ) => Promise<void>;
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
  /** R14 teardown of THIS iframe (used on both failure and success paths —
   *  a boot that throws must not leave a live IDB connection blocking the
   *  next boot's wipe). */
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
    // First-run honesty (the mobile-viewport precedent): the pre-boot wipe
    // must genuinely complete — retry transient blocks, fail loud otherwise.
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
    // Download seam: every export blob, in order (the e2e-happy-path seam).
    const blobs: Array<{ type: string; size: number }> = [];
    const origCreate = win.URL.createObjectURL.bind(win.URL);
    (win.URL as { createObjectURL: (b: Blob) => string }).createObjectURL = (
      blob: Blob,
    ) => {
      blobs.push({ type: blob.type, size: blob.size });
      return origCreate(blob);
    };
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
    // The demo chain booted: at phone width only the ACTIVE lane's rail row
    // renders, and the VERSE cues live on the CHORDS lane — the honest
    // phone-mode boot signal is the tile count (the MB-1 precedent).
    await poll(() => $$(".rail-tile").length >= 2, 5_000, "demo chain tiles");

    // --- trusted CDP touch, mapped through BOTH iframe boxes -------------
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
    /** One trusted touch sequence through iframe-client points (mapped
     *  FRESH at every dispatch — the boxes move under both documents'
     *  scrolling). */
    const touch = async (
      pts: ReadonlyArray<{ x: number; y: number }>,
      holdMs = 30,
    ): Promise<void> => {
      const first = map(pts[0]!.x, pts[0]!.y);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: first.x, y: first.y }],
      });
      for (let i = 1; i < pts.length; i++) {
        await sleep(holdMs);
        const p = map(pts[i]!.x, pts[i]!.y);
        await c.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: p.x, y: p.y }],
        });
      }
      await sleep(holdMs);
      await c.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await sleep(120);
    };
    /** Bring an element into the iframe's open viewport (below the sticky
     *  chrome) — CDP hit-testing only sees the iframe's rendered area. */
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
    const tap = async (el: Element): Promise<void> => {
      await reveal(el);
      const r = el.getBoundingClientRect();
      await touch([{ x: r.left + r.width / 2, y: r.top + r.height / 2 }], 40);
    };
    /** A touch line across one row-box (iframe-client coords relative). */
    const touchLine = async (
      from: { x: number; y: number },
      to: { x: number; y: number },
      box: DOMRect,
      steps = 8,
    ): Promise<void> => {
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        pts.push({
          x: box.left + from.x + ((to.x - from.x) * i) / steps,
          y: box.top + from.y + ((to.y - from.y) * i) / steps,
        });
      }
      await touch(pts);
    };
    return {
      iframe,
      iwin,
      idoc,
      $,
      $$,
      blobs,
      reveal,
      tap,
      touch,
      touchLine,
      teardown: cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

describe("MB-6 mobile acceptance: trusted CDP touch on the BUILT app (m1)", () => {
  it(
    "390×844 — the full committed editing model succeeds by touch: transport · switcher · place/remove · drag-create · edge-resize · drums paint · euclid SET · sweep cue (stopped + queued) · preset · mix · FX · busy-guarded exports · projects switch",
    { timeout: 300_000 },
    async () => {
      const app = await bootPhone(390, 844);
      const { $, $$, idoc, tap, reveal, touch, touchLine, blobs } = app;
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "phone stage",
        );

        // ---- transport ------------------------------------------------------
        const playBtn = () => $(".booth-btn-play");
        await tap(playBtn());
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          4_000,
          "PLAY tap starts the transport",
        );
        {
          // Playhead liveness (load-robust): distinct transforms over ~1s.
          const ph = () =>
            idoc().querySelector<HTMLElement>(".grid-playhead")?.style
              .transform ?? "";
          let last = ph();
          let moves = 0;
          for (let i = 0; i < 14; i++) {
            await sleep(70);
            if (ph() !== last && ph() !== "") {
              last = ph();
              moves++;
            }
          }
          expect(
            moves,
            "playhead moves under touch-started playback",
          ).toBeGreaterThanOrEqual(4);
        }

        // ---- rail sweep cue while PLAYING: the quantized switch queues ----
        // (the condensed rail is the ACTIVE lane's row — drums at boot.)
        // The pending state can LAND within the sweep's own duration (a
        // 16th at the demo's 112 BPM is 134 ms) — the durable, aria-live
        // evidence is the QUEUED cue summary + the target tile ENGAGING
        // (pending → landed: selected/active), asserted as a poll.
        {
          const tiles = () => $$(".rail-row .rail-tile") as HTMLElement[];
          expect(tiles().length).toBeGreaterThanOrEqual(4);
          const box = tiles()[0]!.parentElement!.getBoundingClientRect();
          const a = tiles()[0]!.getBoundingClientRect();
          const b = tiles()[2]!.getBoundingClientRect();
          await touchLine(
            { x: a.left - box.left + 8, y: a.top - box.top + 10 },
            { x: b.right - box.left - 6, y: b.top - box.top + 10 },
            box,
          );
          await poll(
            () =>
              ($(".rail-cue-summary").textContent ?? "").match(
                /QUEUED 1 LANES?/,
              ) !== null,
            4_000,
            "playing touch sweep queues the switch (cue summary announces QUEUED)",
          );
          await poll(
            () => tiles()[2]!.dataset.state !== "idle",
            4_000,
            "the swept-to tile engages (pending or landed: selected/active)",
          );
        }
        await tap(playBtn());
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          4_000,
          "STOP tap stops the transport",
        );

        // ---- switcher + tap place/remove (BASS) -----------------------------
        await tap($('.lane-switch-tab[data-lane="bass"]'));
        await poll(
          () =>
            $(".lane-floor").dataset.lane === "bass" &&
            $(".stage-status").textContent?.trim() === "NOW EDITING BASS",
          3_000,
          "switcher tap selects + announces BASS",
        );
        // A deterministically EMPTY row (no note-runs painted): the demo
        // populates a few of the 14 rows — pick one it leaves alone. (The
        // keyed lane-floor remount can lag the announcement by a tick —
        // poll for the bass grid first.)
        await poll(
          () => $$(".lane-floor[data-lane='bass'] .row-cells").length > 0,
          4_000,
          "bass grid mounted",
        );
        const emptyRow = (): HTMLElement => {
          const rows = $$(".lane-floor[data-lane='bass'] .row-cells");
          const free = rows.find(
            (r) => r.querySelectorAll(".note-run").length === 0,
          );
          if (!free)
            throw new Error("no empty bass row (unexpected demo density)");
          return free as HTMLElement;
        };
        const stepW = (): number => {
          const cells = $(
            ".lane-floor[data-lane='bass'] .row-cells",
          ).querySelectorAll(".cell");
          const a = cells[0]!.getBoundingClientRect();
          const b = cells[1]!.getBoundingClientRect();
          return b.left - a.left;
        };
        const runsIn = (row: HTMLElement): number =>
          row.querySelectorAll(".note-run").length;

        // Tap place: the gate-default note appears at the tapped cell…
        const placeRow = emptyRow();
        const placeCell = placeRow.querySelectorAll(".cell")[4]! as HTMLElement;
        await reveal(placeCell);
        {
          const r = placeCell.getBoundingClientRect();
          await touch(
            [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }],
            40,
          );
        }
        await poll(
          () => runsIn(placeRow) === 1,
          4_000,
          "touch tap places the gate-default note",
        );
        expect(
          Math.abs(
            placeRow.querySelector(".note-run")!.getBoundingClientRect().left -
              placeCell.getBoundingClientRect().left,
          ),
          "the placed note starts at the tapped cell",
        ).toBeLessThanOrEqual(2);
        // …and the anchor tap removes it (place/remove both by touch).
        {
          const r = placeCell.getBoundingClientRect();
          await touch(
            [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }],
            40,
          );
        }
        await poll(
          () => runsIn(placeRow) === 0,
          4_000,
          "touch anchor tap removes the note",
        );

        // ---- drag-create (≥2 segments) + edge-resize (trim) ----------------
        const dragRow = emptyRow();
        await reveal(dragRow);
        const w4 = stepW();
        await touchLine(
          { x: 4 * w4 + w4 / 2, y: 12 },
          { x: 8 * w4 + w4 / 2, y: 12 },
          dragRow.getBoundingClientRect(),
        );
        await poll(
          () => runsIn(dragRow) === 1,
          4_000,
          "touch drag creates one note (multi-segment)",
        );
        {
          const run = dragRow.querySelector(".note-run")!;
          const runW = run.getBoundingClientRect().width;
          expect(
            runW,
            "the dragged note spans ~5 steps",
          ).toBeGreaterThanOrEqual(4 * w4 - 2);
        }
        // Edge-resize: drag the run's right-edge hit zone out to the CENTER
        // of step 12 (cell centers are snap-unambiguous on the 0.25 resize
        // grid — a boundary-exact release can floor to x.75 under the
        // tester iframe's sub-pixel mapping) → length 8.5 steps.
        {
          const edge = dragRow.querySelector(".note-edge")! as HTMLElement;
          await reveal(edge);
          const rowBox = dragRow.getBoundingClientRect();
          const edgeCenter = edge.getBoundingClientRect();
          await touchLine(
            { x: edgeCenter.left + 2.5 - rowBox.left, y: 12 },
            { x: 12 * w4 + w4 / 2, y: 12 },
            rowBox,
          );
          await poll(
            () =>
              Math.abs(
                dragRow.querySelector(".note-run")!.getBoundingClientRect()
                  .width -
                  (8.5 * w4 - 1),
              ) <= 2.5,
            4_000,
            "touch edge-drag trims the note (released at step 12's center → length 8.5)",
          );
        }

        // ---- preset stepper + MIX (MUTE/SOLO/volume) ------------------------
        {
          const valueSel = "[aria-label='BASS sound'] .head-ctl-value";
          const before = $(valueSel).textContent ?? "";
          await tap($("[aria-label='Next preset for BASS']"));
          await poll(
            () => ($(valueSel).textContent ?? "") !== before,
            4_000,
            "preset stepper advances by touch tap",
          );
          const mute = $("[aria-label='Mute BASS']");
          await tap(mute);
          await poll(
            () => mute.getAttribute("aria-pressed") === "true",
            4_000,
            "MUTE toggles on by touch tap",
          );
          await tap(mute);
          await poll(
            () => mute.getAttribute("aria-pressed") === "false",
            4_000,
            "MUTE toggles back off by touch tap",
          );
          const solo = $("[aria-label='Solo BASS']");
          await tap(solo);
          await poll(
            () => solo.getAttribute("aria-pressed") === "true",
            4_000,
            "SOLO engages by touch tap",
          );
          await tap(solo);
          // Volume slider by touch: a thumb-anchored drag (the input owns
          // its drag — MB-2's global law). The thumb's x derives from the
          // input's own value; drag toward the far end so the change is
          // unambiguous whichever end the demo starts at.
          const vol = $("[aria-label='BASS volume'] input") as HTMLInputElement;
          await reveal(vol);
          const vBefore = vol.value;
          const vr = vol.getBoundingClientRect();
          const min = Number(vol.min || "0");
          const max = Number(vol.max || "100");
          const frac = Math.min(
            Math.max((Number(vol.value) - min) / (max - min || 1), 0.05),
            0.95,
          );
          const thumbX = vr.left + frac * vr.width;
          const targetX =
            frac < 0.5 ? vr.left + vr.width * 0.92 : vr.left + vr.width * 0.08;
          const vy = vr.top + vr.height / 2;
          await touch(
            [
              { x: thumbX, y: vy },
              { x: thumbX + (targetX - thumbX) / 2, y: vy },
              { x: targetX, y: vy },
            ],
            60,
          );
          await poll(
            () => vol.value !== vBefore,
            4_000,
            "volume slider responds to a touch drag",
          );
        }

        // ---- FX console by touch --------------------------------------------
        {
          await tap($("[data-help='lane.bass.fx']"));
          await poll(
            () => idoc().querySelector(".fx-strip[data-lane='bass']") !== null,
            4_000,
            "FX console opens by touch tap",
          );
          const bypass = $$(".fx-strip[data-lane='bass'] .fx-bypass-btn")[0]!;
          const wasPressed = bypass.getAttribute("aria-pressed") === "true";
          await tap(bypass);
          await poll(
            () =>
              (bypass.getAttribute("aria-pressed") === "true") !== wasPressed,
            4_000,
            "FX bypass flips by touch tap",
          );
          await tap(bypass); // restore the demo state
          const modCount = () =>
            $$(".fx-strip[data-lane='bass'] .fx-mod").length;
          const modsBefore = modCount();
          await tap($(".fx-add-btn"));
          await poll(
            () => idoc().querySelector(".fx-add-menu") !== null,
            4_000,
            "FX add menu opens by touch",
          );
          await tap($$(".fx-add-item")[0]!);
          await poll(
            () => modCount() === modsBefore + 1,
            4_000,
            "FX device added by touch",
          );
          await tap($(".lane-fx-close"));
          await poll(
            () => idoc().querySelector(".fx-strip") === null,
            4_000,
            "FX console closes by touch",
          );
        }

        // ---- drums paint + euclid arm→SET -----------------------------------
        await tap($('.lane-switch-tab[data-lane="drums"]'));
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          3_000,
          "drums stage by switcher tap",
        );
        const kickRow = (): HTMLElement =>
          $('.lane-floor[data-lane="drums"] .row-cells') as HTMLElement;
        const kickCell = (step: number): HTMLElement =>
          $$('.lane-floor[data-lane="drums"] .cell[data-row="0"]').find(
            (c) => c.dataset.step === String(step),
          )! as HTMLElement;
        const kickOn = (step: number): boolean =>
          kickCell(step).dataset.on === "true";
        await reveal(kickRow());
        {
          // The drums rows' own step pitch (never the bass helper — only
          // the active lane's floor renders at phone width).
          const dc = kickRow().querySelectorAll(".cell");
          const w =
            dc[1]!.getBoundingClientRect().left -
            dc[0]!.getBoundingClientRect().left;
          await touchLine(
            { x: 1 * w + w / 2, y: 12 },
            { x: 5 * w + w / 2, y: 12 },
            kickRow().getBoundingClientRect(),
          );
          await poll(
            () => [1, 2, 3, 4, 5].every(kickOn),
            4_000,
            "touch drag paints the swept drums range (the demo's own hits at 0/8/10 stay untouched)",
          );
        }
        // Euclid: FILL reveal → stepper taps arm → SET commits the row.
        const fill0 = $('.lane-floor[data-lane="drums"] .row-fill');
        expect(getComputedStyle(fill0).opacity).toBe("0"); // hidden first
        await tap($(".head-fill-toggle"));
        await sleep(350); // the 120ms reveal ease settles
        expect(
          Number.parseFloat(getComputedStyle(fill0).opacity),
          "FILL reveals the overlay rail",
        ).toBeGreaterThanOrEqual(0.99);
        const plusBtn = fill0.querySelector(
          '[aria-label="More pulses for KICK fill"]',
        ) as HTMLElement;
        const setBtn = fill0.querySelector(
          ".row-fill-apply",
        ) as HTMLButtonElement;
        await tap(plusBtn);
        await tap(plusBtn);
        await poll(() => !setBtn.disabled, 3_000, "stepper taps arm SET");
        const readout =
          fill0.querySelector(".row-fill-value")?.textContent ?? "";
        const pulses = Number.parseInt(readout.split("/")[0] ?? "", 10);
        expect(
          Number.isFinite(pulses) && pulses > 0,
          `readout parses pulses (got "${readout}")`,
        ).toBe(true);
        await tap(setBtn);
        await poll(
          () =>
            $$('.lane-floor[data-lane="drums"] .cell[data-row="0"]').filter(
              (c) => c.dataset.on === "true",
            ).length === pulses,
          4_000,
          `SET taps the Euclidean row in (${pulses} painted hits — rotation-agnostic euclid count)`,
        );
        await tap($(".head-fill-toggle"));
        await sleep(350);
        expect(
          Number.parseFloat(getComputedStyle(fill0).opacity),
          "FILL hides the rails again",
        ).toBeLessThanOrEqual(0.01);

        // ---- stopped rail sweep: selection follows the LAST-touched tile ---
        {
          const tiles = () => $$(".rail-row .rail-tile") as HTMLElement[];
          await poll(() => tiles().length >= 4, 3_000, "demo chain tiles");
          const box = tiles()[0]!.parentElement!.getBoundingClientRect();
          const a = tiles()[0]!.getBoundingClientRect();
          const b = tiles()[3]!.getBoundingClientRect();
          await touchLine(
            { x: a.left - box.left + 8, y: a.top - box.top + 10 },
            { x: b.right - box.left - 6, y: b.top - box.top + 10 },
            box,
          );
          await poll(
            () => tiles()[3]!.dataset.state === "selected",
            4_000,
            "stopped touch sweep selects the LAST-touched tile",
          );
        }

        // ---- busy-guarded exports + projects switch --------------------------
        await tap($("[data-help='projects.open']"));
        await poll(
          () => idoc().querySelector(".projects-pop") !== null,
          4_000,
          "projects popover opens by touch",
        );
        const wavBtn = () =>
          $(".projects-action[data-help='projects.wav']") as HTMLButtonElement;
        const midiBtn = () =>
          $(".projects-action[data-help='projects.midi']") as HTMLButtonElement;
        await tap(wavBtn());
        // The busy guard: while the render runs, the actions are disabled —
        // a second tap (MIDI) is swallowed by the native disabled state.
        await poll(
          () => midiBtn().disabled,
          4_000,
          "export busy guard engages (actions disabled mid-render)",
        );
        await tap(midiBtn()); // swallowed (disabled)
        const toastSays = (text: string): boolean =>
          Array.from(idoc().querySelectorAll(".toast")).some((t) =>
            (t.textContent ?? "").includes(text),
          );
        await poll(() => toastSays("WAV EXPORTED"), 60_000, "WAV export toast");
        expect(blobs.length, "the swallowed MIDI tap produced no blob").toBe(1);
        expect(blobs[0]!.type).toBe("audio/wav");
        expect(blobs[0]!.size).toBeGreaterThan(44);
        await tap(midiBtn());
        await poll(
          () =>
            Array.from(idoc().querySelectorAll(".toast")).some((t) =>
              (t.textContent ?? "").includes("MIDI EXPORTED"),
            ),
          60_000,
          "MIDI export toast",
        );
        expect(blobs.length).toBe(2);
        expect(blobs[1]!.type).toBe("audio/midi");
        // Projects switch: NEW by touch → the empty-project stage note;
        // then back to the WELCOME SONG row — the demo returns.
        await tap($(".projects-action[data-help='projects.new']"));
        await poll(
          () => idoc().querySelector(".stage-hint") !== null,
          6_000,
          "NEW lands the empty-project stage note",
        );
        await tap($("[data-help='projects.open']"));
        await poll(
          () => idoc().querySelector(".projects-pop") !== null,
          4_000,
          "projects popover reopens",
        );
        const demoRow = $$(".projects-item").find(
          (r) =>
            r.querySelector(".projects-name")?.textContent === "WELCOME SONG",
        );
        expect(demoRow, "the WELCOME SONG row is listed").toBeTruthy();
        await tap(demoRow!);
        await poll(
          () =>
            idoc().querySelector(".stage-hint") === null &&
            $$(".rail-row .rail-tile").length >= 4,
          6_000,
          "switching back to the demo row restores the WELCOME SONG (empty hint gone, the demo's 4-slot chain returns)",
        );
      } finally {
        await app.teardown();
      }
    },
    300_000,
  );

  it(
    "360×800 — the tight-viewport pass: every core gesture class + transport + steppers by touch",
    { timeout: 240_000 },
    async () => {
      const app = await bootPhone(360, 800);
      const { $, $$, idoc, tap, reveal, touch, touchLine } = app;
      try {
        await poll(
          () => $(".app").getAttribute("data-stage") === "phone",
          5_000,
          "phone stage at 360×800",
        );
        expect(
          $(".booth-btn-play").classList.contains("booth-nudge"),
          "the boot is genuinely FIRST-RUN (PX-1 nudge armed)",
        ).toBe(true);

        // Transport by touch.
        const playBtn = () => $(".booth-btn-play");
        await tap(playBtn());
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          4_000,
          "PLAY tap at 360",
        );
        await tap(playBtn());
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          4_000,
          "STOP tap at 360",
        );

        // Switcher + tap place/remove on an empty row.
        await tap($('.lane-switch-tab[data-lane="bass"]'));
        await poll(
          () => $(".lane-floor").dataset.lane === "bass",
          3_000,
          "switcher tap at 360",
        );
        const rows = () => $$(".lane-floor[data-lane='bass'] .row-cells");
        const emptyRow = (): HTMLElement =>
          rows().find(
            (r) => r.querySelectorAll(".note-run").length === 0,
          ) as HTMLElement;
        const stepW = (): number => {
          const cells = rows()[0]!.querySelectorAll(".cell");
          return (
            cells[1]!.getBoundingClientRect().left -
            cells[0]!.getBoundingClientRect().left
          );
        };
        const placeRow = emptyRow();
        const cell4 = placeRow.querySelectorAll(".cell")[4]! as HTMLElement;
        await reveal(cell4);
        {
          const r = cell4.getBoundingClientRect();
          await touch(
            [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }],
            40,
          );
        }
        await poll(
          () => placeRow.querySelectorAll(".note-run").length === 1,
          4_000,
          "tap place at 360",
        );
        {
          const r = cell4.getBoundingClientRect();
          await touch(
            [{ x: r.left + r.width / 2, y: r.top + r.height / 2 }],
            40,
          );
        }
        await poll(
          () => placeRow.querySelectorAll(".note-run").length === 0,
          4_000,
          "tap remove at 360",
        );

        // Drag-create + edge-resize.
        const dragRow = emptyRow();
        await reveal(dragRow);
        const w = stepW();
        await touchLine(
          { x: 2 * w + w / 2, y: 12 },
          { x: 6 * w + w / 2, y: 12 },
          dragRow.getBoundingClientRect(),
        );
        await poll(
          () => dragRow.querySelectorAll(".note-run").length === 1,
          4_000,
          "drag-create at 360",
        );
        {
          const edge = dragRow.querySelector(".note-edge")! as HTMLElement;
          await reveal(edge);
          const rowBox = dragRow.getBoundingClientRect();
          const edgeCenter = edge.getBoundingClientRect();
          await touchLine(
            { x: edgeCenter.left + 2.5 - rowBox.left, y: 12 },
            { x: 10 * w + w / 2, y: 12 },
            rowBox,
          );
          await poll(
            () =>
              Math.abs(
                dragRow.querySelector(".note-run")!.getBoundingClientRect()
                  .width -
                  (8.5 * w - 1),
              ) <= 2.5,
            4_000,
            "edge-resize (trim) at 360 (released at step 10's center → length 8.5)",
          );
        }

        // Preset stepper + MUTE.
        {
          const valueSel = "[aria-label='BASS sound'] .head-ctl-value";
          const before = $(valueSel).textContent ?? "";
          await tap($("[aria-label='Next preset for BASS']"));
          await poll(
            () => ($(valueSel).textContent ?? "") !== before,
            4_000,
            "preset stepper at 360",
          );
          const mute = $("[aria-label='Mute BASS']");
          await tap(mute);
          await poll(
            () => mute.getAttribute("aria-pressed") === "true",
            4_000,
            "MUTE at 360",
          );
          await tap(mute);
        }

        // Drums paint + euclid SET (the wrapped commit line at 360).
        await tap($('.lane-switch-tab[data-lane="drums"]'));
        await poll(
          () => $(".lane-floor").dataset.lane === "drums",
          3_000,
          "drums stage at 360",
        );
        const kickRow = () =>
          $('.lane-floor[data-lane="drums"] .row-cells') as HTMLElement;
        const kickCell = (step: number): HTMLElement =>
          $$('.lane-floor[data-lane="drums"] .cell[data-row="0"]').find(
            (c) => c.dataset.step === String(step),
          )! as HTMLElement;
        await reveal(kickRow());
        await touchLine(
          { x: 1 * w + w / 2, y: 12 },
          { x: 5 * w + w / 2, y: 12 },
          kickRow().getBoundingClientRect(),
        );
        await poll(
          () =>
            kickCell(1).dataset.on === "true" &&
            kickCell(5).dataset.on === "true",
          4_000,
          "drums paint at 360",
        );
        const fill0 = $('.lane-floor[data-lane="drums"] .row-fill');
        await tap($(".head-fill-toggle"));
        await sleep(350);
        expect(
          Number.parseFloat(getComputedStyle(fill0).opacity),
          "FILL reveal at 360",
        ).toBeGreaterThanOrEqual(0.99);
        const plusBtn = fill0.querySelector(
          '[aria-label="More pulses for KICK fill"]',
        ) as HTMLElement;
        const setBtn = fill0.querySelector(
          ".row-fill-apply",
        ) as HTMLButtonElement;
        await tap(plusBtn);
        await poll(() => !setBtn.disabled, 3_000, "SET armed at 360");
        const pulses = Number.parseInt(
          (fill0.querySelector(".row-fill-value")?.textContent ?? "").split(
            "/",
          )[0] ?? "",
          10,
        );
        expect(Number.isFinite(pulses) && pulses > 0).toBe(true);
        await tap(setBtn);
        await poll(
          () =>
            $$('.lane-floor[data-lane="drums"] .cell[data-row="0"]').filter(
              (c) => c.dataset.on === "true",
            ).length === pulses,
          4_000,
          "euclid SET commits at 360 (wrapped commit line)",
        );
        await tap($(".head-fill-toggle"));

        // Stopped sweep at the tight width.
        {
          const tiles = () => $$(".rail-row .rail-tile") as HTMLElement[];
          const box = tiles()[0]!.parentElement!.getBoundingClientRect();
          const a = tiles()[0]!.getBoundingClientRect();
          const b = tiles()[2]!.getBoundingClientRect();
          await touchLine(
            { x: a.left - box.left + 8, y: a.top - box.top + 10 },
            { x: b.right - box.left - 6, y: b.top - box.top + 10 },
            box,
          );
          await poll(
            () => tiles()[2]!.dataset.state === "selected",
            4_000,
            "stopped sweep at 360",
          );
        }
        expect(idoc().documentElement.scrollWidth).toBeLessThanOrEqual(360);
      } finally {
        await app.teardown();
      }
    },
    240_000,
  );
});
