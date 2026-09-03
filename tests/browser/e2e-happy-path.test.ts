/**
 * HW-4 — THE definition-of-done e2e: one ordered journey through the REAL
 * BUILT APP (dist/ bundle served by the browser project's publicDir, exactly
 * as deployed), starting from a wiped IndexedDB, driven by REAL UI clicks:
 *
 *   1. first-run boot → WELCOME SONG demo (PX-1)
 *   2. PLAY through the booth button — transport runs (playhead animates),
 *      and the sounding loop is proven by a REAL offline render of the demo
 *      through the true worklet path (onset check; D8 layer 2/3 evidence)
 *   3. alter the loop: cell toggle + euclid fill commit + preset change
 *   4. tune a chain: FX device added via the strip menu + param tweak
 *   5. arrange: quantized pattern switch observed landing (pending → active),
 *      then duplicate + chain append
 *   6. EXPORT WAV through the real Projects button — i.e. through the LAZY
 *      dynamic-import chunk (TH-2 gap: exportWav/exportMidi tests import the
 *      modules statically; only the built app exercises the on-demand path).
 *      The captured seam Blob is parsed + decoded: canonical header, sample-
 *      exact length vs the demo transport math.
 *   7. EXPORT MIDI likewise — MThd header, format 1, MTrk chunks present.
 *   8. reload (fresh iframe, SAME IndexedDB) → autosave restores the project
 *      with every edit intact
 *   9. export WAV again → BYTE-IDENTICAL to the first export (determinism
 *      through persistence: save/load round-trips the exact document).
 *
 * Mouse-first (this is the happy path; the keyboard-only journey is DA-3's
 * keyboard-journey-full.test.ts — the two are deliberately complementary).
 */

import { describe, expect, it } from "vitest";
import { createDemoProject } from "../../src/document/demoSong";
import {
  renderProjectToBuffer,
  EXPORT_SAMPLE_RATE,
} from "../../src/audio/render";
import { assertCleanAudio } from "./helpers";

const bundleGlob = import.meta.glob("/dist/assets/index-*.js");
const cssGlob = import.meta.glob("/dist/assets/index-*.css");

const T = {
  boot: 15_000,
  ui: 5_000,
  switch: 30_000,
  render: 90_000,
  save: 6_000,
};

/** Demo transport math (edits in this journey never touch bpm/loopBars). */
const DEMO_BPM = 112;
const DEMO_LOOP_BARS = 1;
const EXPECTED_FRAMES =
  DEMO_LOOP_BARS * 4 * ((EXPORT_SAMPLE_RATE * 60) / DEMO_BPM);

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

// --- tiny test-owned parsers (same laws as exportWav/exportMidi tests) -----

interface ParsedWavHeader {
  frames: number;
  sampleRate: number;
  bits: number;
  channelsCount: number;
  audioFormat: number;
  dataBytes: number;
  riffSize: number;
}

function parseWav16Stereo(bytes: Uint8Array): ParsedWavHeader {
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.slice(at, at + n));
  const u16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8);
  const u32 = (at: number) =>
    (bytes[at]! |
      (bytes[at + 1]! << 8) |
      (bytes[at + 2]! << 16) |
      (bytes[at + 3]! << 24)) >>>
    0;
  if (ascii(0, 4) !== "RIFF") throw new Error("not RIFF");
  if (ascii(8, 4) !== "WAVE") throw new Error("not WAVE");
  if (ascii(12, 4) !== "fmt ") throw new Error("no fmt chunk");
  const audioFormat = u16(20);
  const channelsCount = u16(22);
  const sampleRate = u32(24);
  const bits = u16(34);
  if (ascii(36, 4) !== "data") throw new Error("no data chunk");
  const dataBytes = u32(40);
  return {
    frames: dataBytes / 4,
    sampleRate,
    bits,
    channelsCount,
    audioFormat,
    dataBytes,
    riffSize: u32(4),
  };
}

function parseMidiHeader(bytes: Uint8Array): {
  format: number;
  ntrks: number;
  division: number;
} {
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.slice(at, at + n));
  // MIDI chunk fields are BIG-endian (unlike RIFF/WAVE).
  const be16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  const be32 = (at: number) =>
    ((bytes[at]! << 24) |
      (bytes[at + 1]! << 16) |
      (bytes[at + 2]! << 8) |
      bytes[at + 3]!) >>>
    0;
  if (ascii(0, 4) !== "MThd") throw new Error("no MThd");
  if (be32(4) !== 6)
    throw new Error(
      `MThd length != 6 (head: ${[...bytes.slice(0, 14)].map((b) => b.toString(16).padStart(2, "0")).join(" ")})`,
    );
  const format = be16(8);
  const ntrks = be16(10);
  const division = be16(12);
  // Every declared track chunk must really be an MTrk.
  let at = 14;
  for (let t = 0; t < ntrks; t++) {
    if (ascii(at, 4) !== "MTrk") throw new Error(`track ${t} is not MTrk`);
    at += 8 + be32(at + 4);
  }
  return { format, ntrks, division };
}

describe("HW-4 e2e happy path (built app, wiped IDB, full journey)", () => {
  it(
    "first-run → play → edit → chain → arrange → lazy exports → reload → determinism",
    { timeout: 420_000 },
    async () => {
      const bundleKey = Object.keys(bundleGlob)[0];
      const cssKey = Object.keys(cssGlob)[0];
      expect(
        bundleKey,
        "built bundle missing (globalSetup build failed?)",
      ).toBeTruthy();
      expect(cssKey).toBeTruthy();

      /** (Re)load the built app in a fresh same-origin iframe. */
      const loadApp = async (): Promise<{
        iframe: HTMLIFrameElement;
        doc: Document;
        blobs: Blob[];
      }> => {
        const iframe = document.createElement("iframe");
        iframe.style.width = "1280px";
        iframe.style.height = "960px";
        document.body.appendChild(iframe);
        const win = iframe.contentWindow!;
        // Download seam capture: every export blob, in order.
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
        return { iframe, doc: doc0, blobs };
      };

      // Deterministic FIRST RUN: wipe the shared-origin IndexedDB before any
      // app code exists, so boot takes the PX-1 demo path (R14 pattern).
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("bitbounce");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });

      let app = await loadApp();
      const idoc = (): Document => app.iframe.contentDocument!;
      const $ = <El extends Element>(sel: string): El => {
        const el = idoc().querySelector<El>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        return el;
      };
      const $$ = <El extends Element>(sel: string): El[] =>
        Array.from(idoc().querySelectorAll<El>(sel));

      /** Wall-clock playhead liveness sampler (load-robust): distinct
       * transforms observed while sampling at ~15 Hz over `ms`. */
      const playheadSamples = async (ms: number): Promise<number> => {
        let last = "";
        let changes = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          const ph = idoc().querySelector<HTMLElement>(".grid-playhead");
          if (ph) {
            const t = ph.style.transform;
            if (t !== last) {
              last = t;
              changes++;
            }
          }
          await new Promise((r) => setTimeout(r, 65));
        }
        return changes;
      };

      let bassPresetAfter = "";
      let bassTilesAfter = 0;
      const firstWav = { bytes: new Uint8Array(0) };

      try {
        // --- 1. FIRST-RUN BOOT: demo song ----------------------------------
        await poll(
          () => !!idoc().querySelector(".booth"),
          T.boot,
          "app to mount",
        );
        await poll(
          () => $$(".rail-tile-cue").some((c) => c.textContent === "VERSE"),
          T.ui,
          "demo cue labels in the rail",
        );
        expect($$(".lane-grid").length).toBe(4);

        // --- 2. PLAY: transport really runs --------------------------------
        const playBtn = () => $<HTMLButtonElement>(".booth-btn-play");
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          T.ui,
          "play to start",
        );
        // Playhead advances: first WAIT for the audio clock to actually
        // start driving it (ctx.resume() is async and can lag the button
        // state on a loaded machine — the button flips first, the playhead
        // follows once currentTime advances), THEN count changes across a
        // 1.5 s wall-clock window: sampling at ~15 Hz needs only ≥8 changes
        // (≈5 fps) to prove the clock runs — robust under machine load,
        // unlike a per-frame count.
        {
          const ph0 = () =>
            idoc().querySelector<HTMLElement>(".grid-playhead")?.style
              .transform ?? "";
          const first = ph0();
          await poll(() => ph0() !== first, T.ui, "playhead to start moving");
        }
        expect(await playheadSamples(1500)).toBeGreaterThanOrEqual(8);

        // Onsets via a REAL render: the demo loop through the true worklet +
        // FX graph (same path as WAV export) transients on the bar grid —
        // the thing PLAYING is the thing that renders. (Onset check = the
        // RMS jump across each bar start, same law as PX-1's demo test.)
        {
          const rendered = await renderProjectToBuffer(createDemoProject());
          assertCleanAudio(rendered.channels, "e2e demo render", {
            minPeak: 0.05,
            maxPeak: 0.95,
          });
          const [left, right] = rendered.channels;
          const mono = new Float32Array(left.length);
          for (let i = 0; i < left.length; i++)
            mono[i] = (left[i]! + right[i]!) / 2;
          const rms = (from: number, to: number): number => {
            let sum = 0;
            const a = Math.max(0, Math.floor(from));
            const b = Math.min(mono.length, Math.ceil(to));
            for (let i = a; i < b; i++) sum += mono[i]! * mono[i]!;
            return Math.sqrt(sum / Math.max(1, b - a));
          };
          const barSamples = rendered.loopSamples / 4;
          const w = 0.04 * EXPORT_SAMPLE_RATE;
          for (let bar = 0; bar < 4; bar++) {
            const t = bar * barSamples;
            const before = rms(t - w, t - 2);
            const after = rms(t + 2, t + w);
            expect(
              after,
              `no downbeat onset at bar ${bar + 1} start`,
            ).toBeGreaterThan(before * 1.5 + 1e-6);
          }
        }

        // Stop before editing: while playing the grid follows the LIVE chain
        // slot, so edits would land on whichever pattern is currently
        // sounding; stopped, the grid (and edits) target the SELECTED
        // pattern — deterministic for the reload comparison in stage 8.
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          T.ui,
          "stop before editing",
        );

        // --- 3. ALTER THE LOOP: cell toggle + euclid fill + preset ----------
        // (a) toggle a kick cell (real click → store → bridge → recompile).
        const kickCell = $$(
          '.lane-floor[data-lane="drums"] .grid-row',
        )[0]!.querySelectorAll<HTMLButtonElement>(".cell")[3]!;
        const wasOn = kickCell.dataset.on === "true";
        kickCell.click();
        await poll(
          () => kickCell.dataset.on === String(!wasOn),
          T.ui,
          "kick cell toggle",
        );
        // (b) euclid fill on the SNARE row: + pulses → preview → SET commits.
        const snareRow = $$('.lane-floor[data-lane="drums"] .grid-row')[1]!;
        const snareCell = (i: number) =>
          snareRow.querySelectorAll<HTMLButtonElement>(".cell")[i]!;
        const fillRail = $('.row-fill[data-row="1"]');
        const morePulses = fillRail.querySelector<HTMLButtonElement>(
          'button[aria-label="More pulses for SNARE fill"]',
        )!;
        const pulsesValue = () =>
          Number(
            (
              fillRail.querySelector(".row-fill-value")!.textContent ?? "0/16"
            ).split("/")[0],
          );
        const snareOnBefore = Array.from({ length: 16 }, (_, i) =>
          snareCell(i),
        ).filter((c) => c.dataset.on === "true").length;
        expect(snareOnBefore).toBeGreaterThan(0); // demo groove row
        morePulses.click(); // arm (custom rows re-arm at current density)
        const armed = pulsesValue();
        morePulses.click(); // raise by one
        await poll(() => pulsesValue() === armed + 1, T.ui, "pulse stepper");
        const pulsesNow = pulsesValue();
        await poll(
          () =>
            $$('.lane-floor[data-lane="drums"] .cell[data-preview="true"]')
              .length > 0,
          T.ui,
          "euclid preview overlay",
        );
        fillRail
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Apply Euclidean fill to SNARE"]',
          )!
          .click();
        await poll(
          () => {
            const onCount = Array.from({ length: 16 }, (_, i) =>
              snareCell(i),
            ).filter((c) => c.dataset.on === "true").length;
            return onCount === pulsesNow;
          },
          T.ui,
          "euclid commit to paint the row",
        );

        // (c) preset change on BASS (observable in the lane header value).
        const bassSound = $('[aria-label="BASS sound"]');
        const presetName = () =>
          bassSound.querySelector(".head-ctl-value")!.textContent ?? "";
        const presetBefore = presetName();
        bassSound
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Next preset for BASS"]',
          )!
          .click();
        await poll(
          () => presetName() !== presetBefore && presetName() !== "",
          T.ui,
          "bass preset change",
        );
        bassPresetAfter = presetName();

        // --- 4. TUNE A CHAIN: FX add + param tweak ---------------------------
        (
          $('.lane-floor[data-lane="bass"] .head-fx') as HTMLButtonElement
        ).click();
        await poll(
          () => !!idoc().querySelector('.fx-strip[data-lane="bass"]'),
          T.ui,
          "bass fx strip",
        );
        $(".fx-add-btn").click();
        await poll(
          () => !!idoc().querySelector(".fx-add-menu"),
          T.ui,
          "fx add menu",
        );
        $$(".fx-add-item")[0]!.click(); // first device
        await poll(
          () => $$('.fx-strip[data-lane="bass"] .fx-mod').length === 3,
          T.ui,
          "third fx module on bass",
        );
        // Param tweak: native range stepping + input event (module DOM is
        // rebuilt per commit, so re-query fresh each press).
        const readout = () =>
          $<HTMLInputElement>(".fx-param-slider")
            .closest("label")
            ?.querySelector(".fx-param-readout")?.textContent ?? "";
        const readoutBefore = readout();
        for (let i = 0; i < 5; i++) {
          const slider = $<HTMLInputElement>(".fx-param-slider");
          slider.stepUp();
          slider.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await poll(
          () => readout() !== readoutBefore,
          T.ui,
          "fx param readout change",
        );

        // --- 5. ARRANGE: quantized switch + duplicate + chain append ---------
        // Play again for the quantized switch (it is a PLAYING-transport law).
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "true",
          T.ui,
          "play for quantized switch",
        );
        const bassRow = $('.rail-row[data-lane="bass"]');
        const tiles = () =>
          Array.from(bassRow.querySelectorAll<HTMLButtonElement>(".rail-tile"));
        const tilesBefore = tiles().length;
        expect(tilesBefore).toBeGreaterThanOrEqual(2); // demo bass chain
        // Quantized switch while playing: pending observed → lands active.
        const target = tiles()[tilesBefore - 1]!;
        target.click();
        let sawPending = false;
        await poll(
          () => {
            sawPending ||= target.dataset.state === "pending";
            return (
              target.dataset.state === "active" ||
              target.dataset.state === "selected"
            );
          },
          T.switch,
          "quantized switch to land",
        );
        expect(sawPending, "switch never showed its pending state").toBe(true);

        // Stop, duplicate the selected pattern, append it to the chain.
        playBtn().click();
        await poll(
          () => playBtn().getAttribute("aria-pressed") === "false",
          T.ui,
          "stop",
        );
        // Duplicate creates a NEW pattern ("NAME+" copy, selected but not yet
        // chained — the chain length is unchanged until append) ...
        bassRow
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Duplicate BASS selected pattern"]',
          )!
          .click();
        await poll(
          () =>
            bassRow.querySelector<HTMLButtonElement>(
              'button[aria-label="Append BASS selected pattern to chain"]',
            ) !== null && tiles().length === tilesBefore,
          T.ui,
          "duplicate pattern (chain unchanged until append)",
        );
        // ... then append chains the copy: one MORE tile, named "…+".
        bassRow
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Append BASS selected pattern to chain"]',
          )!
          .click();
        await poll(
          () => tiles().length === tilesBefore + 1,
          T.ui,
          "chain append",
        );
        const appended = tiles()[tiles().length - 1]!;
        expect(
          (
            appended.querySelector(".rail-tile-name")?.textContent ?? ""
          ).endsWith("+"),
          "appended tile is not the duplicated copy",
        ).toBe(true);
        bassTilesAfter = tiles().length;

        // --- 6. EXPORT WAV through the real button + LAZY import ------------
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
        $(".projects-btn").click();
        await poll(
          () => !!idoc().querySelector(".projects-pop"),
          T.ui,
          "projects popover",
        );
        (await actionByLabel("EXPORT WAV")).click();
        let exportToast = "";
        await poll(
          () => {
            exportToast =
              $$(".toast-message").find((t) =>
                t.textContent?.includes("WAV EXPORTED"),
              )?.textContent ?? exportToast;
            return exportToast !== "";
          },
          T.render,
          "WAV export toast",
        );
        const wavBlob = [...app.blobs]
          .reverse()
          .find((b) => b.type === "audio/wav");
        expect(
          wavBlob,
          "no audio/wav blob through the download seam",
        ).toBeTruthy();
        firstWav.bytes = new Uint8Array(await wavBlob!.arrayBuffer());
        const h = parseWav16Stereo(firstWav.bytes);
        expect(h.audioFormat).toBe(1); // PCM
        expect(h.channelsCount).toBe(2);
        expect(h.bits).toBe(16);
        expect(h.sampleRate).toBe(EXPORT_SAMPLE_RATE);
        // Length via the app's own claim: the toast reports the exported bar
        // count; the file must carry exactly that many sample-exact 112-BPM
        // bars (the demo journey exports the whole arranged chain).
        const toastBars = Number((exportToast.match(/· (\d+) BAR/) ?? [])[1]);
        expect(Number.isInteger(toastBars)).toBe(true);
        expect(toastBars).toBeGreaterThanOrEqual(4); // the 4-section demo
        expect(h.frames).toBe(toastBars * EXPECTED_FRAMES);
        expect(Number.isInteger(EXPECTED_FRAMES)).toBe(true);
        // The decoded file is not silence (first bar carries the downbeat).
        let wavPeak = 0;
        for (let i = 44; i < 44 + EXPECTED_FRAMES * 2; i += 2) {
          wavPeak = Math.max(
            wavPeak,
            firstWav.bytes[i]! | (firstWav.bytes[i + 1]! << 8),
          );
        }
        expect(wavPeak).toBeGreaterThan(0);
        expect(h.riffSize).toBe(firstWav.bytes.byteLength - 8);
        expect(firstWav.bytes.byteLength).toBe(44 + h.dataBytes);

        // --- 7. EXPORT MIDI likewise -----------------------------------------
        (await actionByLabel("EXPORT MIDI")).click();
        await poll(
          () =>
            $$(".toast-message").some((t) =>
              t.textContent?.includes("MIDI EXPORTED"),
            ),
          T.render,
          "MIDI export toast",
        );
        const midiBlob = [...app.blobs]
          .reverse()
          .find((b) => b.type === "audio/midi");
        expect(
          midiBlob,
          "no audio/midi blob through the download seam",
        ).toBeTruthy();
        const firstMidi = new Uint8Array(await midiBlob!.arrayBuffer());
        const midi = parseMidiHeader(firstMidi);
        expect(midi.format).toBe(1); // simultaneous tracks
        expect(midi.ntrks).toBeGreaterThanOrEqual(4); // one per lane
        expect(midi.division).toBeGreaterThan(0);

        // Determinism control: export AGAIN pre-reload — same live document,
        // fresh render. If this differed, the render path itself (not
        // persistence) would be non-deterministic.
        {
          // stage 6/7 left the popover OPEN — reuse it (the button toggles).
          if (!idoc().querySelector(".projects-pop")) {
            $(".projects-btn").click();
            await poll(
              () => !!idoc().querySelector(".projects-pop"),
              T.ui,
              "popover reopen (control)",
            );
          }
          (await actionByLabel("EXPORT WAV")).click();
          // toasts auto-dismiss — wait on the captured BLOB count instead.
          await poll(
            () => app.blobs.filter((b) => b.type === "audio/wav").length >= 2,
            T.render,
            "control WAV export blob",
          );
          const ctrlBlob = [...app.blobs]
            .reverse()
            .find((b) => b.type === "audio/wav")!;
          const ctrl = new Uint8Array(await ctrlBlob.arrayBuffer());
          let ctrlDiff = -1;
          for (let i = 0; i < ctrl.length; i++)
            if (ctrl[i] !== firstWav.bytes[i]) {
              ctrlDiff = i;
              break;
            }
          expect(
            ctrlDiff,
            `pre-reload double export differs at byte ${ctrlDiff} (render path non-deterministic)`,
          ).toBe(-1);
        }

        // --- 8. RELOAD: autosave restores every edit --------------------------
        // Let the autosave debounce (800 ms) flush the last edits first.
        await new Promise((r) => setTimeout(r, 1500));
        // Remember WHICH drums pattern is selected and pin the grid view to
        // it: while playing the grid follows the live chain slot, so after
        // the second stop re-click the SELECTED tile to make the grid (and
        // the reload comparison) target the pattern we edited in stage 3.
        // Snapshot EVERY drums pattern by clicking through its rail tiles:
        // while playing the grid follows the live chain slot, so a single
        // "current view" comparison is ambiguous — a per-pattern map is a
        // view-independent persistence proof of the stage-3 grid edits.
        const drumsTiles = () =>
          Array.from(
            $(
              '.rail-row[data-lane="drums"]',
            ).querySelectorAll<HTMLButtonElement>(".rail-tile"),
          );
        // Rows render in document key order, which is not stable across a
        // save/load round trip — compare the row MULTISET (sorted), the
        // order-insensitive content of the pattern.
        const drumsGridRows = (): string =>
          $$('.lane-floor[data-lane="drums"] .grid-row')
            .map((row) =>
              Array.from(row.querySelectorAll(".cell"))
                .map((c) => c.dataset.on ?? "")
                .join(),
            )
            .sort()
            .join(";");
        const snapshotDrums = async (): Promise<string> => {
          const shots: string[] = [];
          for (const tile of drumsTiles()) {
            tile.click();
            await new Promise((r) => setTimeout(r, 120));
            shots.push(
              `${tile.querySelector(".rail-tile-name")?.textContent ?? "?"}=${drumsGridRows()}`,
            );
          }
          return shots.join("|");
        };
        const drumsBeforeReload = await snapshotDrums();
        expect(drumsBeforeReload).not.toBe("");
        app.iframe.remove(); // same-origin IDB survives; pagehide flush fired
        app = await loadApp();
        await poll(
          () => !!idoc().querySelector(".booth"),
          T.boot,
          "app to remount after reload",
        );
        await poll(
          () => $$(".rail-tile-cue").some((c) => c.textContent === "VERSE"),
          T.ui,
          "restored demo cues",
        );
        // Edits intact.
        const bassSound2 = $('[aria-label="BASS sound"]');
        await poll(
          () =>
            bassSound2.querySelector(".head-ctl-value")!.textContent ===
            bassPresetAfter,
          T.ui,
          "bass preset survived reload",
        );
        // Reopen the strip (same real click as stage 4) and count modules.
        (
          $('.lane-floor[data-lane="bass"] .head-fx') as HTMLButtonElement
        ).click();
        await poll(
          () => $$('.fx-strip[data-lane="bass"] .fx-mod').length === 3,
          T.ui,
          "fx chain survived reload",
        );
        const bassRow2 = $('.rail-row[data-lane="bass"]');
        await poll(
          () =>
            bassRow2.querySelectorAll(".rail-tile").length === bassTilesAfter,
          T.ui,
          "arrangement survived reload",
        );
        // Grid edits survived: every drums pattern's rows identical to the
        // pre-reload snapshot (poll — the grid renders asynchronously after
        // the document restore).
        await poll(
          async () => (await snapshotDrums()) === drumsBeforeReload,
          T.save,
          "drums edits survived reload",
        );

        // --- 9. EXPORT AGAIN → byte-identical (determinism through save) -----
        $(".projects-btn").click();
        await poll(
          () => !!idoc().querySelector(".projects-pop"),
          T.ui,
          "popover reopen",
        );
        (await actionByLabel("EXPORT WAV")).click();
        await poll(
          // NOTE: the reload built a fresh iframe + blob capture — this is
          // the FIRST wav recorded in the NEW array.
          () => app.blobs.filter((b) => b.type === "audio/wav").length >= 1,
          T.render,
          "second WAV export blob",
        );
        // MIDI bytes are PURE document-derived (no audio render): if they
        // match the pre-reload export, the restored document is byte-equal
        // and any WAV difference is render-path, not persistence.
        {
          (await actionByLabel("EXPORT MIDI")).click();
          await poll(
            () => app.blobs.filter((b) => b.type === "audio/midi").length >= 1,
            T.render,
            "second MIDI export blob",
          );
          const midiBlob2 = [...app.blobs]
            .reverse()
            .find((b) => b.type === "audio/midi")!;
          const midi2 = new Uint8Array(await midiBlob2.arrayBuffer());
          let midiDiff = -1;
          for (let i = 0; i < midi2.length; i++)
            if (midi2[i] !== firstMidi[i]) {
              midiDiff = i;
              break;
            }
          expect(
            midiDiff,
            `post-reload MIDI differs at byte ${midiDiff} (document NOT restored byte-equal)`,
          ).toBe(-1);
          expect(midi2.byteLength).toBe(firstMidi.byteLength);
        }
        const wavBlob2 = [...app.blobs]
          .reverse()
          .find((b) => b.type === "audio/wav");
        expect(wavBlob2).toBeTruthy();
        const wav2 = new Uint8Array(await wavBlob2!.arrayBuffer());
        expect(wav2.byteLength).toBe(firstWav.bytes.byteLength);
        // Manual byte compare: the file is ~7.5 MB and vitest's deep-equal
        // diff machinery on multi-million-element typed arrays can stall the
        // renderer for minutes; a plain loop is exact and instant.
        let firstDiff = -1;
        for (let i = 0; i < wav2.length; i++) {
          if (wav2[i] !== firstWav.bytes[i]) {
            firstDiff = i;
            break;
          }
        }
        expect(
          firstDiff,
          `post-reload export differs from the first at byte ${firstDiff} (persistence broke determinism)`,
        ).toBe(-1);
      } finally {
        // R14 teardown (journey pattern): remove the iframe FIRST (closing its
        // open DB connections), then wipe the shared-origin DB with retries so
        // no journey state leaks into later same-origin boots.
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
