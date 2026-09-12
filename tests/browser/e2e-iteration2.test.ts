import { WORKSPACE_TOGGLE } from "./workspace";
/**
 * HW-5 — THE iteration-2 definition-of-done e2e: one ordered journey through
 * the REAL BUILT APP (dist/ bundle served by the browser project's publicDir,
 * exactly as deployed), starting from a wiped IndexedDB, driving REAL UI
 * input (clicks, synthetic pointers for the drag gestures, keydowns for the
 * keyboard twins):
 *
 *   1. first-run boot → WELCOME SONG demo (PX-1) + one-page law (LY-1)
 *   2. quadrant selection by CLICK and by KEY (PageUp) — NOW EDITING
 *      announcements + name flips (LY-1, a11y E1/E3)
 *   3. drag-create a multi-segment note on the BASS grid (IN-2)
 *   4. resize it by EDGE-DRAG and by KEYBOARD `+`/`-` — LENGTH announcement
 *      parity (IN-2, a11y E4/E5)
 *   5. multi-clip rail sweep cue while playing: preview → commit →
 *      QUEUED <n> LANES → both lanes land on ONE quantized boundary (IN-3)
 *   6. mix a lane: SOLO on/off announcement, MUTE, VOLUME (LY-1)
 *   7. switch BASS to a Karplus-Strong preset (PLUCK LOW) and then a
 *      sample-backed preset (SUB DROP) — the LAZY content-load path through
 *      the built bundle's separate chunk (PS-4: real same-origin .ogg fetch)
 *   8. help mode on (booth INFO ?) → focus-driven + hover info text →
 *      Escape exits first (HP-1, a11y E6)
 *   9. EXPORT WAV + MIDI with a NON-DEFAULT mix — the coordinator
 *      resolution (recorded at LY-1 verification): the WAV APPLIES the mix
 *      (differs from the pre-mix export, lower energy), the MIDI keeps ALL
 *      notes (byte-identical to the pre-mix export); restoring the mix
 *      restores byte-identical exports (canonical-empty determinism)
 *  10. save/reload round-trip: mix state, preset, and the dragged note all
 *      survive; the post-reload export is byte-identical
 *  11. migration load of a v1 golden project: OPEN FILE with
 *      v1DemoProjectText() → migrated demo (cues + 15-step chord pads)
 *
 * Follows the v0 HW-4 conventions: download-seam capture, deterministic
 * first-run IDB wipe, R14 teardown wipe, poll-based waits.
 *
 * Synthetic-input honesty (the established law): synthetic keydowns/pointers
 * run every app handler but carry no browser defaults (native-button Enter
 * activation is replicated as focus+Enter+click; setPointerCapture is skipped
 * by the renderer when un-trusted). Trusted-pointer parity is separately
 * pinned by the IN-2/IN-3/IN-4 trusted gates.
 */

import { describe, expect, it } from "vitest";
import { v1DemoProjectText } from "../v1Project";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const VIEW_W = 1440;
const VIEW_H = 900;

const T = {
  boot: 15_000,
  ui: 5_000,
  switch: 30_000,
  render: 90_000,
  save: 8_000,
};

const DEMO_BPM = 112;
/** 4 beats/bar × (44100 × 60 / 112) = 94500 samples per bar (integer). */
const EXPECTED_FRAMES_PER_BAR = 4 * ((44100 * 60) / DEMO_BPM);

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

// --- tiny test-owned parsers (same laws as the HW-4/MF-4 suites) -----------

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
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, x.length));
}

function firstDiffByte(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : Math.min(a.length, b.length);
}

describe("HW-5 iteration-2 e2e (built app, wiped IDB, full journey)", () => {
  it(
    "quadrants → drag notes → resize → sweep cue → mix → presets (lazy samples) → help → mixed exports → reload → v1 migration",
    { timeout: 420_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      const loadApp = async (): Promise<{
        iframe: HTMLIFrameElement;
        blobs: Blob[];
      }> => {
        const iframe = document.createElement("iframe");
        iframe.style.width = `${VIEW_W}px`;
        iframe.style.height = `${VIEW_H}px`;
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

      let app = await loadApp();
      const idoc = (): Document => app.iframe.contentDocument!;
      const win = (): Window => app.iframe.contentWindow!;
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
      const statusText = () =>
        ($(".stage-status") as HTMLElement).textContent?.trim() ?? "";
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
      const tile = (lane: string, slot: number): HTMLButtonElement => {
        const el = $(
          `.rail-row[data-lane="${lane}"]`,
        ).querySelectorAll<HTMLButtonElement>(".rail-tile")[slot];
        if (!el) throw new Error(`missing ${lane} rail tile ${slot}`);
        return el;
      };
      const actionByLabel = async (
        label: string,
      ): Promise<HTMLButtonElement> => {
        for (let i = 0; i < 60; i++) {
          const b = $$(".projects-action").find(
            (x) => x.textContent?.trim() === label && !x.disabled,
          );
          if (b) return b as HTMLButtonElement;
          await new Promise((r) => setTimeout(r, 50));
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

      // Journey state shared across stages.
      const created = { start: -1, length: -1, row: -1 };
      let wavClean: Uint8Array;
      let midiClean: Uint8Array;
      let wavMixed2: Uint8Array;

      try {
        // --- 1. FIRST-RUN BOOT + one-page law ------------------------------
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

        // --- 2. QUADRANT SELECTION: click + keyboard -----------------------
        floor("lead").querySelector<HTMLElement>(".cell")!.click();
        await poll(
          () => statusText() === "NOW EDITING LEAD",
          T.ui,
          "NOW EDITING LEAD (click path)",
        );
        // RC-1 journey delta: windowed pitched names append `· ROWS a–b OF n`.
        expect(
          floor("lead")
            .querySelector("[role='grid']")!
            .getAttribute("aria-label")
            ?.startsWith("LEAD grid · EDITING"),
        ).toBe(true);
        expect(
          floor("drums")
            .querySelector("[role='grid']")!
            .getAttribute("aria-label"),
        ).toBe("DRUMS grid · VIEW ONLY");
        // Keyboard twin: focus the (now editable) lead grid's roving cell,
        // then PageUp selects the previous quadrant (lead → chords).
        const roving = () =>
          [...floor("lead").querySelectorAll<HTMLElement>(".cell")].find(
            (c) => c.tabIndex === 0,
          );
        await poll(
          () => roving() !== undefined,
          T.ui,
          "lead grid roving tab stop",
        );
        roving()!.focus();
        key(roving()!, "PageUp");
        await poll(
          () => statusText() === "NOW EDITING CHORDS",
          T.ui,
          "NOW EDITING CHORDS (keyboard path)",
        );
        // Select BASS for the note stages (THE FULL UNIT: pads are live on
        // every quadrant, so select through the side-effect-free label).
        floor("bass").querySelector<HTMLElement>(".lane-name")!.click();
        await poll(
          () =>
            floor("bass")
              .querySelector("[role='grid']")!
              .getAttribute("aria-label")
              ?.startsWith("BASS grid · EDITING") === true,
          T.ui,
          "BASS quadrant editable",
        );

        // --- 3. DRAG-CREATE a multi-segment note ---------------------------
        // Find 4 consecutive EMPTY cells in one bass row (runtime discovery:
        // the demo bass pattern has notes).
        const bassCells = (row: number) =>
          Array.from(
            floor("bass").querySelectorAll<HTMLElement>(
              `.cell[data-row="${row}"]`,
            ),
          ).sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
        let dragRow = -1;
        let dragStart = -1;
        const mountedBassRows = [
          ...new Set(
            Array.from(
              floor("bass").querySelectorAll<HTMLElement>(".cell"),
              (cell) => Number(cell.dataset.row),
            ),
          ),
        ];
        outer: for (const row of mountedBassRows) {
          const cells = bassCells(row);
          if (cells.length < 16) continue;
          // ≤ 8 so the stage-4 edge-drag (+2 steps) stays inside the pattern.
          for (let s = 0; s + 3 < cells.length && s <= 8; s++) {
            if (cells.slice(s, s + 4).every((c) => c.dataset.on !== "true")) {
              dragRow = row;
              dragStart = s;
              break outer;
            }
          }
        }
        expect(dragRow).toBeGreaterThanOrEqual(0);
        const cells = bassCells(dragRow);
        const a = center(cells[dragStart]!);
        const m = center(cells[dragStart + 2]!);
        const z = center(cells[dragStart + 3]!);
        pe(cells[dragStart]!, "pointerdown", a.x, a.y);
        pe(cells[dragStart + 2]!, "pointermove", m.x, m.y);
        // LIVE PREVIEW, zero commits (the euclid/IN-2 law).
        expect(
          floor("bass").querySelectorAll(".note-run.is-drag-preview").length,
        ).toBe(1);
        pe(cells[dragStart + 3]!, "pointermove", z.x, z.y);
        pe(cells[dragStart + 3]!, "pointerup", z.x, z.y);
        /** THE created note's edge handle (rows carry their own notes). */
        const myEdge = () =>
          floor("bass").querySelector<HTMLElement>(
            `.note-edge[data-row="${dragRow}"][data-start="${dragStart}"]`,
          );
        created.start = dragStart;
        created.row = dragRow;
        await poll(
          () => myEdge()?.dataset.length === "4",
          T.ui,
          "drag-created note-run committed",
        );
        expect(
          cells[dragStart]!.getAttribute("aria-label")?.includes(
            "note starts, 4 steps",
          ),
        ).toBe(true);
        created.length = 4;
        created.row = dragRow;

        // --- 4. RESIZE: edge-drag, then keyboard (announcement parity) ----
        const rowEl = cells[0]!.parentElement as HTMLElement;
        const origin = rowEl.getBoundingClientRect();
        const stepW = center(cells[1]!).x - center(cells[0]!).x;
        const px = (frac: number) => origin.left + frac * stepW;
        const edge = myEdge()!;
        const runEl = edge.parentElement as HTMLElement;
        const er = runEl.getBoundingClientRect();
        const liveSpan = () =>
          floor("bass")
            .querySelector(".note-length-live")
            ?.textContent?.trim() ?? "";
        pe(edge, "pointerdown", er.right - 1, er.top + er.height / 2);
        pe(rowEl, "pointermove", px(dragStart + 6), er.top + er.height / 2);
        pe(rowEl, "pointerup", px(dragStart + 6), er.top + er.height / 2);
        await poll(
          () => myEdge()?.dataset.length === "6",
          T.ui,
          "edge-drag resize to 6",
        );
        const pointerAnnouncement = liveSpan();
        expect(pointerAnnouncement).toBe("LENGTH 6 ST");
        // Keyboard twin: + then - returns to 6 with the SAME text (E5).
        const anchor = cells[dragStart]! as HTMLElement;
        anchor.focus();
        key(anchor, "+");
        await poll(
          () => myEdge()?.dataset.length === "7",
          T.ui,
          "keyboard resize to 7",
        );
        expect(liveSpan()).toBe("LENGTH 7 ST");
        key(anchor, "-");
        await poll(
          () => myEdge()?.dataset.length === "6",
          T.ui,
          "keyboard resize back to 6",
        );
        expect(liveSpan()).toBe(pointerAnnouncement);
        created.length = 6;

        // --- 5. MULTI-CLIP RAIL SWEEP CUE (playing; quantized landing) ----
        await openSong(); // the sweep's tiles live on the chain's own page
        const playBtn = () => $<HTMLButtonElement>(".booth-btn-play");
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          T.ui,
          "play for the sweep",
        );
        const d0 = center(tile("drums", 0));
        const d2 = center(tile("drums", 2));
        const b2 = center(tile("bass", 2));
        pe(tile("drums", 0), "pointerdown", d0.x, d0.y);
        pe(
          tile("drums", 1),
          "pointermove",
          center(tile("drums", 1)).x,
          center(tile("drums", 1)).y,
        );
        pe(tile("drums", 2), "pointermove", d2.x, d2.y);
        pe(tile("bass", 2), "pointermove", b2.x, b2.y);
        // Preview marks before the commit.
        expect(tile("drums", 2).dataset.cuePreview).toBe("target");
        expect(tile("bass", 2).dataset.cuePreview).toBe("target");
        pe(tile("bass", 2), "pointerup", b2.x, b2.y);
        await poll(
          () =>
            ($(".rail-cue-summary")?.textContent?.trim() ?? "") ===
            "QUEUED 2 LANES",
          T.ui,
          "QUEUED 2 LANES summary",
        );
        expect(tile("drums", 2).dataset.state).toBe("pending");
        expect(tile("bass", 2).dataset.state).toBe("pending");
        // Quantized landing: BOTH lanes leave pending for a landed state
        // (active | selected — the sweep's commit also selects the cued
        // pattern) within the same poll tick — one boundary, together.
        // (The rail's active read follows switches; natural chain advance
        // does not move it — pre-existing v0 law, recorded in the log.)
        const landed = () =>
          ["active", "selected"].includes(
            tile("drums", 2).dataset.state ?? "",
          ) &&
          ["active", "selected"].includes(tile("bass", 2).dataset.state ?? "");
        await poll(landed, T.switch, "both cued lanes to land together");
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          T.ui,
          "stop after the sweep",
        );

        await openEdit();

        // --- 6. PRESETS: Karplus-Strong, then sample-backed (LAZY path) ---
        const bassSound = () => $('[aria-label="BASS sound"]');
        const presetName = () =>
          bassSound().querySelector<HTMLSelectElement>("select")!
            .selectedOptions[0]!.textContent ?? "";
        const stepPreset = async (target: string) => {
          for (let i = 0; i < bassSound().querySelector<HTMLSelectElement>("select")!.options.length && presetName() !== target; i++) {
            bassSound()
              .querySelector<HTMLButtonElement>(
                'button[aria-label="Next preset for BASS"]',
              )!
              .click();
            await new Promise((r) => setTimeout(r, 30));
          }
          expect(presetName(), `bass preset should be ${target}`).toBe(target);
        };
        await stepPreset("PLUCK LOW"); // Karplus-Strong (PS-1)
        await stepPreset("SUB DROP"); // sample-backed (PS-4)
        // The LAZY content path really fetched a same-origin OGG through the
        // built bundle's separate content chunk.
        await poll(
          () =>
            win()
              .performance.getEntriesByType("resource")
              .filter((r) => r.name.endsWith(".ogg")).length >= 1,
          T.ui,
          "a sample OGG fetched lazily (same-origin)",
        );
        // No failure chrome: the sticky load-failure toast never appeared.
        expect(idoc().querySelector('[role="alert"] .toast')).toBeNull();

        // --- 7. HELP MODE: on → focus + hover → off ------------------------
        const infoBtn = () => $<HTMLButtonElement>(".booth-btn-info");
        infoBtn().click();
        await poll(
          () => statusText().includes("INFO MODE ON"),
          T.ui,
          "INFO MODE ON announcement",
        );
        expect($(".info-view").getAttribute("role")).toBe("status");
        expect($(".app").getAttribute("data-help-mode")).toBe("on");
        // Focus-driven info (no pointer events at all).
        const bassVol = floor("bass").querySelector<HTMLInputElement>(
          'input[aria-label="BASS volume"]',
        )!;
        bassVol.focus();
        await poll(
          () => ($(".info-view-text")?.textContent ?? "").length > 10,
          T.ui,
          "focus-driven info text",
        );
        // Hover twin: pointerover on a registered control speaks too.
        const bpmInput = $('[data-help="booth.tempo"] input');
        bpmInput.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            cancelable: true,
            clientX: center(bpmInput).x,
            clientY: center(bpmInput).y,
          }),
        );
        await poll(
          () =>
            ($(".info-view-title")?.textContent ?? "")
              .toLowerCase()
              .includes("tempo"),
          T.ui,
          "hover-driven info text (TEMPO)",
        );
        // Escape exits the mode FIRST (cancel-first law).
        key(idoc().body, "Escape");
        await poll(
          () => $(".app").getAttribute("data-help-mode") === "off",
          T.ui,
          "help mode off via Escape",
        );
        expect(idoc().querySelector(".info-view")).toBeNull();

        // --- 8. EXPORTS with a CLEAN mix (baseline) ------------------------
        wavClean = await exportVia("EXPORT WAV");
        midiClean = await exportVia("EXPORT MIDI");
        {
          const h = decodeWav16(wavClean);
          expect(h.frames % EXPECTED_FRAMES_PER_BAR).toBe(0);
          expect(rms(h.mono)).toBeGreaterThan(1e-3);
        }

        // --- 9. MIX THE LANES (SOLO announced, MUTE, VOLUME) ----------------
        const bassSolo = floor("bass").querySelector<HTMLButtonElement>(
          'button[aria-label="Solo BASS"]',
        )!;
        bassSolo.click();
        await poll(
          () => statusText() === "SOLO BASS",
          T.ui,
          "SOLO BASS announcement",
        );
        expect(bassSolo.getAttribute("aria-pressed")).toBe("true");
        bassSolo.click();
        await poll(
          () => statusText() === "SOLO OFF",
          T.ui,
          "SOLO OFF announcement",
        );
        const drumsMute = floor("drums").querySelector<HTMLButtonElement>(
          'button[aria-label="Mute DRUMS"]',
        )!;
        drumsMute.click();
        await poll(
          () => drumsMute.getAttribute("aria-pressed") === "true",
          T.ui,
          "drums MUTE on",
        );
        bassVol.value = "40";
        bassVol.dispatchEvent(new Event("input", { bubbles: true }));
        await poll(
          () => bassVol.getAttribute("aria-valuetext") === "40 percent",
          T.ui,
          "bass VOLUME 40%",
        );

        // --- 10. EXPORTS WITH THE MIX: WAV applies it, MIDI does not -------
        const wavMixed = await exportVia("EXPORT WAV");
        const midiMixed = await exportVia("EXPORT MIDI");
        // MIDI keeps ALL notes regardless of mix: byte-identical (the
        // coordinator resolution's MIDI half).
        expect(midiMixed.byteLength).toBe(midiClean.byteLength);
        expect(firstDiffByte(midiMixed, midiClean)).toBe(-1);
        // WAV applies the mix: same length, different bytes, less energy.
        expect(wavMixed.byteLength).toBe(wavClean.byteLength);
        const diffAt = firstDiffByte(wavMixed, wavClean);
        expect(
          diffAt,
          "mixed WAV export must differ from the clean export (mix applied)",
        ).toBeGreaterThan(43);
        const cleanAudio = decodeWav16(wavClean);
        const mixedAudio = decodeWav16(wavMixed);
        expect(mixedAudio.frames).toBe(cleanAudio.frames);
        expect(rms(mixedAudio.mono)).toBeLessThan(rms(cleanAudio.mono) * 0.9);
        expect(rms(mixedAudio.mono)).toBeGreaterThan(1e-4); // not near-silence
        // Restoring the mix restores byte-identical exports (canonical-empty
        // determinism through the real UI path).
        drumsMute.click();
        await poll(
          () => drumsMute.getAttribute("aria-pressed") === "false",
          T.ui,
          "drums MUTE off",
        );
        bassVol.value = "100";
        bassVol.dispatchEvent(new Event("input", { bubbles: true }));
        await poll(
          () => bassVol.getAttribute("aria-valuetext") === "100 percent",
          T.ui,
          "bass VOLUME 100%",
        );
        const wavRestored = await exportVia("EXPORT WAV");
        expect(wavRestored.byteLength).toBe(wavClean.byteLength);
        expect(firstDiffByte(wavRestored, wavClean)).toBe(-1);

        // --- 11. SAVE/RELOAD ROUND-TRIP (mix + preset + note survive) ------
        drumsMute.click();
        await poll(
          () => drumsMute.getAttribute("aria-pressed") === "true",
          T.ui,
          "drums MUTE on again (for the reload)",
        );
        wavMixed2 = await exportVia("EXPORT WAV");
        await new Promise((r) => setTimeout(r, 1500)); // autosave flush
        app.iframe.remove();
        app = await loadApp();
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
        await poll(
          () =>
            floor("drums")
              .querySelector<HTMLButtonElement>(
                'button[aria-label="Mute DRUMS"]',
              )!
              .getAttribute("aria-pressed") === "true",
          T.ui,
          "mix (drums MUTE) survived the reload",
        );
        await poll(
          () =>
            $('[aria-label="BASS sound"]')
              .querySelector<HTMLSelectElement>("select")!.selectedOptions[0]!.textContent?.trim() === "SUB DROP",
          T.ui,
          "sample preset survived the reload",
        );
        // The dragged note survived: click through the bass rail tiles until
        // the pattern carrying it is displayed (selection is ephemeral).
        const noteSurvived = async (): Promise<boolean> => {
          await openSong(); // the tiles this clicks through are on the page
          const bassTiles = Array.from(
            $(
              '.rail-row[data-lane="bass"]',
            ).querySelectorAll<HTMLButtonElement>(".rail-tile"),
          );
          for (const t of bassTiles) {
            t.click();
            await new Promise((r) => setTimeout(r, 120));
            await openEdit();
            const pane = floor("bass").querySelector<HTMLElement>(".lane-grid-scroll")!;
            const row = floor("bass").querySelectorAll<HTMLElement>(".grid-row")[created.row]!;
            pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
            await new Promise(r => setTimeout(r, 250));
            const e = floor("bass").querySelector(
              `.note-edge[data-row="${created.row}"][data-start="${created.start}"]`,
            );
            if (e && Number(e.dataset.length) === created.length) return true;
            await openSong();
          }
          return false;
        };
        await poll(
          () => noteSurvived(),
          T.save,
          "dragged note survived reload",
        );
        // Post-reload export: byte-identical (determinism through save).
        const wavAfterReload = await exportVia("EXPORT WAV");
        expect(wavAfterReload.byteLength).toBe(wavMixed2.byteLength);
        expect(firstDiffByte(wavAfterReload, wavMixed2)).toBe(-1);

        // --- 12. V1 MIGRATION LOAD (golden v1 demo through OPEN FILE) ------
        if (!idoc().querySelector(".projects-pop")) {
          $(".projects-btn").click();
        }
        await poll(
          () => !!idoc().querySelector(".projects-pop"),
          T.ui,
          "popover for OPEN FILE",
        );
        const input = $<HTMLInputElement>("input.projects-input[type='file']");
        const w = win();
        const dt = new w.DataTransfer();
        dt.items.add(
          new w.File([v1DemoProjectText()], "v1-demo.bitbounce.json", {
            type: "application/json",
          }),
        );
        input.files = dt.files;
        input.dispatchEvent(new w.Event("change", { bubbles: true }));
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              t.textContent?.includes('OPENED "WELCOME SONG (imported)"'),
            ),
          T.save,
          "v1 import toast",
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
          "migrated demo cues",
        );
        // The migration law, visible in the UI: the demo's chord pads
        // (6-step gate + 9 sustains) migrate to 15-step notes.
        await openSong();
        const chordsTiles = Array.from(
          $(
            '.rail-row[data-lane="chords"]',
          ).querySelectorAll<HTMLButtonElement>(".rail-tile"),
        );
        let saw15StepPad = false;
        for (const t of chordsTiles) {
          t.click();
          await new Promise((r) => setTimeout(r, 120));
          if (
            Array.from(floor("chords").querySelectorAll(".note-edge")).some(
              (e) => Number(e.dataset.length) === 15,
            )
          ) {
            saw15StepPad = true;
            break;
          }
        }
        expect(saw15StepPad, "migrated 15-step chord pad visible").toBe(true);
      } finally {
        // R14 teardown: iframe first (closes DB connections), then wipe.
        app.iframe.remove();
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
      }
    },
    420_000,
  );
});
