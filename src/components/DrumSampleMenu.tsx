/**
 * DrumSampleMenu — the drums lane's sample-control menu: per drum piece, choose
 * how a hit plays.
 *
 *   GATE      the hit sounds for its note length (release lands at the end of
 *             the bar you drew — drag a hit's right edge to change it)
 *   ONE-SHOT  the sample/envelope plays all the way through on trigger; the
 *             hit's length no longer matters
 *
 * The choice is document state (`DrumsLane.pieceModes`), so playback, WAV
 * export and reload all agree. A piece with no override plays its kit's
 * natural mode (recorded samples one-shot, synth pieces gated) — pieces show
 * that effective mode, so opening the menu never lies about what you hear.
 *
 * A non-modal disclosure: Escape and an outside press close it, focus returns
 * to the trigger. Mounted inside the drum register bar, absolutely anchored
 * like the scale popover.
 */

import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import {
  DRUM_PIECES,
  type DrumPiece,
  type DrumPlaybackMode,
  type DrumsLane,
} from "../document/schema";
import { getDrumKit, naturalDrumMode } from "../audio/presets";
import { docStore, setDrumPieceMode } from "../state/store";
import { registerHelp } from "../help/registry";
import "../styles/drum-sample.css";

registerHelp([
  {
    id: "drums.sample",
    title: "SAMPLE CONTROL",
    text: "Opens the drum sample menu. For each drum sound choose GATE — the hit sounds only for its note length, so drag a hit's right edge to shorten or lengthen it — or ONE-SHOT — the sample plays all the way through every time it is triggered, whatever the hit's length.",
  },
  {
    id: "drums.sample.mode",
    title: "GATE OR ONE-SHOT",
    text: "GATE cuts this drum sound off at the end of the hit's note length. ONE-SHOT lets it ring out fully on every trigger and ignores the hit's length. Hits keep their lengths while one-shot, so switching back to GATE brings them back.",
  },
]);

/** "openhat" → "OPEN HAT", "kick2" → "KICK 2" — the grid's row label law. */
export function drumPieceLabel(piece: DrumPiece): string {
  return piece
    .replace(/2$/, " 2")
    .replace(/^(open|mid|high)(hat|tom)$/, "$1 $2")
    .toUpperCase();
}

type EffectiveModes = Readonly<Record<DrumPiece, DrumPlaybackMode>>;

/** Each piece's effective mode: the lane override, else the kit's natural one. */
function readModes(): EffectiveModes {
  const lane = docStore
    .getState()
    .doc.lanes.find((l): l is DrumsLane => l.id === "drums");
  const kit = getDrumKit(lane?.kitId ?? "") ?? getDrumKit("kit-default");
  const out = {} as Record<DrumPiece, DrumPlaybackMode>;
  for (const piece of DRUM_PIECES) {
    const preset = kit?.pieces[piece];
    out[piece] =
      lane?.pieceModes?.[piece] ?? (preset ? naturalDrumMode(preset) : "gate");
  }
  return out;
}

const sameModes = (a: EffectiveModes, b: EffectiveModes): boolean =>
  DRUM_PIECES.every((p) => a[p] === b[p]);

export default function DrumSampleMenu(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [modes, setModes] = createSignal<EffectiveModes>(readModes(), {
    equals: sameModes,
  });
  const [root, setRoot] = createSignal<HTMLSpanElement>();
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();

  onMount(() => {
    const unsubscribe = docStore.subscribe(() => setModes(readModes()));
    const onPointerDown = (e: PointerEvent) => {
      if (open() && !root()?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open()) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger()?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      unsubscribe();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    });
  });

  const setAll = (mode: DrumPlaybackMode) => {
    for (const piece of DRUM_PIECES) {
      if (modes()[piece] !== mode) setDrumPieceMode(piece, mode);
    }
  };

  return (
    <span class="drum-sample" ref={setRoot}>
      <button
        ref={setTrigger}
        class="drum-sample-btn"
        type="button"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-controls="drum-sample-panel"
        data-help="drums.sample"
        onClick={() => setOpen(!open())}
      >
        SAMPLE
      </button>
      <Show when={open()}>
        <div
          class="drum-sample-panel"
          id="drum-sample-panel"
          role="group"
          aria-label="Drum sample playback"
        >
          <p class="drum-sample-note">
            GATE plays for the hit's length. ONE-SHOT plays all the way through.
          </p>
          <div class="drum-sample-bulk">
            <button type="button" onClick={() => setAll("gate")}>
              ALL GATE
            </button>
            <button type="button" onClick={() => setAll("oneshot")}>
              ALL ONE-SHOT
            </button>
          </div>
          <ul class="drum-sample-list">
            <For each={DRUM_PIECES}>
              {(piece) => (
                <li class="drum-sample-row">
                  <span class="drum-sample-name">{drumPieceLabel(piece)}</span>
                  <span
                    class="drum-sample-mode"
                    role="group"
                    aria-label={`${drumPieceLabel(piece)} playback`}
                    data-help="drums.sample.mode"
                  >
                    <button
                      type="button"
                      aria-pressed={modes()[piece] === "gate"}
                      onClick={() => setDrumPieceMode(piece, "gate")}
                    >
                      GATE
                    </button>
                    <button
                      type="button"
                      aria-pressed={modes()[piece] === "oneshot"}
                      onClick={() => setDrumPieceMode(piece, "oneshot")}
                    >
                      ONE-SHOT
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </span>
  );
}
