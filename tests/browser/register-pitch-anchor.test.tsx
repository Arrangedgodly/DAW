import { createDemoProject } from "../../src/document/demoSong";
import { midiLabel, pitchDomain } from "../../src/document/pitchWindow";
import { readPitchRange } from "./register-readout";
import { WORKSPACE_TOGGLE } from "./workspace";
/** Notes retain their scale degrees and horizontal placement across the
 * full MIDI editor's scrolling, register shifts, remounts and scale changes. */
import { describe, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { modeSize } from "../../src/document/scales";

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
  // 2026-09-11 merge: phone boot signal = the preset readout (the chain rail
  // lives on the SONG page now — the forked-helper convention).
  await poll(
    () =>
      // 2026-09-11: rail-free on every stage (the chain is its own page).
      $$(".head-ctl-value").some(
        (v) =>
          (v as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ===
          "SOFT STEP",
      ),
    5_000,
    "demo chain tiles",
  );
  await poll(
    () => !!idoc().querySelector(".phone-transport .booth-btn-play"),
    5_000,
    "pinned phone transport",
  );
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

const PE_ID = 41;
function pe(el: Element, type: string, x: number, y: number): boolean {
  return el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: PE_ID,
      pointerType: "mouse",
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );
}
function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

describe("pitch-anchored notes in the full MIDI editor", () => {
  it(
    "retains note placement across register shifts, scroll, focus, lane/pattern switches, scale changes and resize",
    { timeout: 300_000 },
    async () => {
      const { iframe, win, $, $$, idoc } = await bootIframe(390, 844);
      let model = createDemoProject();
      const domain = () => pitchDomain(model, "lead");
      const pane = () =>
        $(".lane-floor[data-lane='lead'] .lane-grid-scroll") as HTMLElement;
      const rows = () =>
        $$<HTMLElement>(".lane-floor[data-lane='lead'] .grid-row");
      const index = (degree: number) => domain().degrees.indexOf(degree);
      const row = (degree: number) => rows()[index(degree)]!;
      const cell = (degree: number, step: number) =>
        row(degree).querySelector<HTMLElement>(
          '.cell[data-step="' + step + '"]',
        )!;
      const run = (degree: number, step: number) =>
        row(degree).querySelector<HTMLElement>(
          '.note-run[data-start="' + step + '"]',
        );
      const visible = (degree: number) => {
        const r = row(degree).getBoundingClientRect(),
          box = pane().getBoundingClientRect();
        return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      };
      const seatAt = async (degree: number) => {
        const r = row(degree).getBoundingClientRect(),
          box = pane().getBoundingClientRect();
        pane().scrollTop += r.top - box.top;
        await new Promise((r) => setTimeout(r, 350));
        await poll(() => !!cell(degree, 0), 5000, "degree cells mounted");
      };
      const shift = async (delta: number) => {
        const before = readPitchRange(
          $(".register-window-readout").textContent,
        )[0]!;
        const label =
          "LEAD " +
          (Math.abs(delta) === 12 ? "octave" : "semitone") +
          " view " +
          (delta > 0 ? "up" : "down");
        $<HTMLButtonElement>('[aria-label="' + label + '"]').click();
        await poll(
          () =>
            readPitchRange($(".register-window-readout").textContent)[0] ===
            before + delta,
          5000,
          "pitch shift",
        );
      };
      const tracked = [
        { degree: 9, step: 2, length: 2 },
        { degree: 7, step: 6, length: 2 },
      ];
      const check = () => {
        for (const n of tracked) {
          expect(row(n.degree).querySelector(".row-label")!.textContent).toBe(
            midiLabel(domain().pitches[index(n.degree)]!),
          );
          if (!visible(n.degree)) {
            expect(run(n.degree, n.step)).toBeNull();
            continue;
          }
          const note = run(n.degree, n.step)!;
          expect(note, "note remounts at its degree").not.toBeNull();
          expect(Number(note.dataset.length)).toBe(n.length);
          const r = note.getBoundingClientRect(),
            cr = row(n.degree).getBoundingClientRect();
          expect(r.top).toBeGreaterThanOrEqual(cr.top - 0.6);
          expect(r.bottom).toBeLessThanOrEqual(cr.bottom + 0.6);
          const first = cell(n.degree, n.step).getBoundingClientRect();
          const end = cell(
            n.degree,
            n.step + n.length - 1,
          ).getBoundingClientRect();
          expect(
            Math.abs(r.left - first.left),
            "note starts at the saved step",
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(r.right - end.right),
            "note spans its saved length",
          ).toBeLessThanOrEqual(1);
        }
      };
      try {
        $<HTMLElement>('.lane-switch-tab[data-lane="lead"]').click();
        await poll(
          () =>
            idoc().querySelector('.lane-floor[data-lane="lead"] .cell') !==
            null,
          5000,
          "lead stage",
        );
        for (const n of tracked) {
          await seatAt(n.degree);
          const a = cell(n.degree, n.step),
            b = cell(n.degree, n.step + 1);
          if (a.dataset.on === "true") a.click();
          const pa = center(a),
            pb = center(b);
          pe(a, "pointerdown", pa.x, pa.y);
          pe(b, "pointermove", pb.x, pb.y);
          pe(b, "pointerup", pb.x, pb.y);
          await poll(() => !!run(n.degree, n.step), 3000, "placed note");
        }
        await seatAt(9);
        check();
        await shift(1);
        check();
        await shift(-1);
        check();
        await shift(12);
        await shift(12);
        expect(visible(9)).toBe(false);
        check();
        await shift(-12);
        await shift(-12);
        await seatAt(9);
        check();
        const frame = window.frameElement as HTMLElement;
        const wheel = async (deltaY: number) => {
          const targetBox = pane().getBoundingClientRect();
          await page.elementLocator(iframe).hover({ position: { x: targetBox.left + targetBox.width / 2 + 2, y: targetBox.top + targetBox.height / 2 + 2 } });
          const fr = frame.getBoundingClientRect(),
            ir = iframe.getBoundingClientRect(),
            er = pane().getBoundingClientRect();
          const x =
            fr.left +
            ((ir.left + er.left + er.width / 2) * fr.width) / innerWidth;
          const y =
            fr.top +
            ((ir.top + er.top + er.height / 2) * fr.height) / innerHeight;
          const before = pane().scrollTop;

          await cdp().send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
          });
          await cdp().send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x,
            y,
            deltaX: 0,
            deltaY,
          });
          await poll(
            () => pane().scrollTop !== before,
            5000,
            "wheel moves register",
          );
          await new Promise((r) => setTimeout(r, 350));
          check();
          await cdp().send("Input.synthesizeScrollGesture", {
            x,
            y,
            xDistance: 0,
            yDistance: -deltaY,
            speed: 1200,
          });
          await new Promise((r) => setTimeout(r, 350));
          check();
        };
        await wheel(240);
        await seatAt(9);
        check();
        cell(9, 0).focus();
        for (let i = 0; i < 12; i++)
          idoc().activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        check();
        await seatAt(9);
        for (const lane of ["drums", "lead"]) {
          $<HTMLElement>('.lane-switch-tab[data-lane="' + lane + '"]').click();
          await poll(
            () => $(".lane-floor").getAttribute("data-lane") === lane,
            5000,
            "lane switch",
          );
        }
        await seatAt(9);
        check();
        $<HTMLElement>(WORKSPACE_TOGGLE).click();
        await poll(
          () =>
            idoc().querySelector('.rail-row[data-lane="lead"] .rail-tile') !==
            null,
          5000,
          "arrangement",
        );
        const tiles = () =>
          $$<HTMLElement>('.rail-row[data-lane="lead"] .rail-tile');
        tiles()[1]!.click();
        tiles()[0]!.click();
        $<HTMLElement>(WORKSPACE_TOGGLE).click();
        await poll(
          () =>
            idoc().querySelector('.lane-floor[data-lane="lead"] .cell') !==
            null,
          5000,
          "notes again",
        );
        await seatAt(9);
        check();
        for (const mode of ["major", "pentatonicMinor", "minor"] as const) {
          $<HTMLElement>(".lane-floor[data-lane='lead'] .scale-chip").click();
          await poll(
            () => idoc().querySelector(".scale-pop") !== null,
            3000,
            "scale chooser",
          );
          $<HTMLElement>('.scale-pop [data-mode="' + mode + '"]').click();
          $<HTMLElement>(".scale-pop-commit").click();
          model = {
            ...model,
            laneOverrides: { ...model.laneOverrides, lead: { root: 0, mode } },
          };
          await new Promise((r) => setTimeout(r, 350));
          await seatAt(9);
          check();
          expect(rows().filter((r) => r.querySelector(".cell")).length).toBe(
            modeSize(mode),
          );
        }
        for (const [w, h] of [
          [360, 800],
          [430, 932],
        ]) {
          iframe.style.width = w + "px";
          iframe.style.height = h + "px";
          await poll(() => win.innerWidth === w, 5000, "resized");
          await new Promise((r) => setTimeout(r, 400));
          await seatAt(9);
          check();
        }
      } finally {
        await teardown(iframe);
      }
    },
  );
});
