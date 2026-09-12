import BitbounceBrand from "./BitbounceBrand";
import ThemeSelector from "./ThemeSelector";
/**
 * Booth — the transport control strip at the top of the stage.
 * Arcade Stage Floor vocabulary: dark chassis, silkscreened labels
 * (--font-label), values (--font-value), LED readouts (--font-led).
 *
 * Performance contract (D1): the BAR.BEAT.STEP readout and beat LEDs are
 * written from rAF via direct DOM mutation — never reactive state. Coarse
 * state (playing, loop, bpm…) rides Solid signals fed by transport.subscribe.
 */

import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Position } from "../audio/time";
import { getSession } from "../engine/session";
import {
  clampBpmUi,
  formatBeatAnnouncement,
  formatPosition,
  gainToVolumePercent,
  swingAmountToPercent,
  swingPercentToAmount,
  volumePercentToGain,
} from "../engine/mappings";
import "../styles/booth.css";
import {
  docStore,
  setLaneScaleOverride,
  setProjectScale,
  setTransport,
} from "../state/store";
import { announceScale, projectScaleChipLabel } from "../state/scaleChip";
import { dismissFirstRunNudge, firstRunNudge } from "../state/firstRun";
import { openHelp } from "../state/helpOverlay";
import { helpMode, toggleHelp } from "../state/helpMode";
import { openViz, vizMode } from "../state/vizMode";
import { registerHelp } from "../help/registry";
import ScalePopover from "./ScalePopover";
import SaveIndicator from "./SaveIndicator";
import Projects from "./Projects";
import BoothScreen from "./BoothScreen";
import { DesktopPageNavigation } from "./PhonePageToggle";

const session = getSession();

const BEAT_LED_COUNT = 4;

// HP-2 help content (Professor X voice, riding HP-1's registry): plain
// language, music-first, every entry says what it is + what happens when you
// use it; keyboard twins get a mention where one exists (I2-6 colocated law).
registerHelp([
  {
    id: "booth.play",
    title: "PLAY / STOP",
    text: "Starts or stops the song. The Space bar does the same whenever focus is on the page rather than a control.",
  },
  {
    id: "booth.loop",
    title: "LOOP",
    text: "Keeps the song repeating from the top. With loop off, playback runs ONE full song CYCLE — every lane's chain has come round once (with lanes of different lengths, that is the longest lane's cycle) — and stops by itself.",
  },
  {
    id: "booth.metronome",
    title: "METRONOME",
    text: "Clicks on every beat so the tempo is something you can hear while building patterns. The click is for you only — it never reaches the WAV or MIDI exports.",
  },
  {
    id: "booth.keys",
    title: "KEYS ?",
    text: "Opens the keyboard-shortcut reference: every key this instrument knows, on one page. Escape closes it.",
  },
  {
    id: "booth.info",
    title: "INFO ?",
    text: "Turns this info view on: point at, focus, or tap any control and this bar explains it. I toggles, Escape leaves — controls keep working either way.",
  },
  {
    id: "booth.viz",
    title: "VIZ",
    text: "Turns the visualizer on: the song plays as light on a full-screen stage while the music keeps going. V toggles it from anywhere; Escape returns to the booth with focus back here — playback never stops either way.",
  },
  {
    id: "booth.tempo",
    title: "TEMPO",
    text: "Song speed in beats per minute, 60 to 200. Takes effect immediately — synced delays shift with it so echoes stay on the beat.",
  },
  {
    id: "booth.scale",
    title: "PROJECT SCALE",
    text: "The note pool every pitched lane plays from. Opens the picker; a lane only ignores it when it carries an override of its own.",
  },
  {
    id: "booth.swing",
    title: "SWING",
    text: "Delays every second 16th note so the groove leans — higher means lazier. 0% is dead straight.",
  },
  {
    id: "booth.master",
    title: "MASTER VOLUME",
    text: "Volume of the whole mix, 0 to 100%. Balance the lanes against each other with the VOLUME strip inside each quadrant.",
  },
]);

export interface BoothProps {
  /**
   * VZ-DD-1: while the VIZ surface is on, the booth sits under the
   * full-bleed page — App marks it `inert` so its controls hold no Tab
   * stop and stay out of the a11y tree until the surface closes (the
   * no-Tab-stops-outside-the-remote law).
   */
  readonly covered?: boolean;
  /**
   * M-2 (iteration 4): on the phone stage the KEYS ? and INFO ? corner
   * buttons do not render at all — a render guard, not CSS hiding, so
   * they leave the a11y tree per the VZ-DD-1 inert law (same pattern as
   * `covered`). Desktop/tablet never sets it and renders both buttons
   * unchanged. The help-registry entries `booth.keys`/`booth.info` stay
   * (desktop keeps the controls) and the `?`/I keyboard twins remain
   * functional with an attached keyboard.
   *
   * M-3 (iteration 4) extends the guard to the PLAY/STOP control itself:
   * on the phone stage the in-group button does not render — the ONE true
   * button (the shared `PlayStopButton`) rides the pinned centered
   * `.phone-transport` row at the bottom of the sticky chrome instead, so
   * it is always visible and horizontally centered while the grid scrolls.
   */
  readonly compact?: boolean;
}

/**
 * M-4 (iteration 4): the option tools in ONE shared component — the
 * Playback group (LOOP, METRONOME, the desktop KEYS ?/INFO ? corner pair,
 * VIZ), TEMPO, SCALE (chip + popover), SWING and MASTER VOLUME, with all
 * their signals/handlers on the SAME store/session seams as before. The
 * desktop Booth mounts it inline (DOM byte-identical to the pre-M-4 booth);
 * the phone options drawer (App.tsx → PhoneOptionsDrawer) mounts the
 * `compact` copy — no play/KEYS/INFO duplicates, no new logic, the drawer
 * just re-houses the identical JSX groups (the plan's reuse law).
 */
export interface BoothOptionsProps {
  /**
   * M-2/M-3/M-4 (iteration 4): compact omits the KEYS ? / INFO ? corner
   * buttons and the in-group PLAY copy (the phone stage carries PLAY in
   * the pinned centered `.phone-transport` row and leaves KEYS/INFO off
   * entirely). Desktop never sets it.
   */
  readonly compact?: boolean;
}

export function BoothOptions(props: BoothOptionsProps) {
  // Project-scale chip (DES-3): mirrors the document scale into signals via
  // one subscription; the popover commits through the store seam.
  const [scaleChip, setScaleChip] = createSignal(
    projectScaleChipLabel(docStore.getState().doc),
  );
  const [scalePopOpen, setScalePopOpen] = createSignal(false);
  const [scaleAnnounce, setScaleAnnounce] = createSignal("");
  let scaleChipBtn: HTMLButtonElement | undefined;
  onMount(() => {
    const unsubscribeDoc = docStore.subscribe((state, prev) => {
      if (state.doc.scale === prev.doc.scale) return;
      setScaleChip(projectScaleChipLabel(state.doc));
    });
    onCleanup(unsubscribeDoc);
  });

  const [loopOn, setLoopOn] = createSignal(session.transport.snapshot.loop);
  const [metroOn, setMetroOn] = createSignal(false);
  const [bpm, setBpm] = createSignal(session.transport.snapshot.bpm);
  const [swingPct, setSwingPct] = createSignal(
    swingAmountToPercent(session.transport.snapshot.swing),
  );
  const [volPct, setVolPct] = createSignal(
    gainToVolumePercent(session.masterVolume),
  );

  onMount(() => {
    const unsubscribe = session.subscribe((snap) => {
      setLoopOn(snap.loop);
      setBpm(snap.bpm);
      setSwingPct(swingAmountToPercent(snap.swing));
    });
    onCleanup(unsubscribe);
  });

  const handleToggleLoop = () => session.setLoop(!loopOn());
  const handleToggleMetro = () => {
    const next = !metroOn();
    setMetroOn(next);
    // Persisted to the document (IM-6); the engine bridge syncs the session.
    setTransport({ metronome: next });
  };
  const handleBpmInput = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    setTransport({ bpm: Math.round(clampBpmUi(parsed)) }); // session echoes back
  };
  const stepBpm = (delta: number) =>
    setTransport({ bpm: Math.round(clampBpmUi(bpm() + delta)) });
  const handleSwing = (value: number) => {
    setSwingPct(value);
    setTransport({ swing: swingPercentToAmount(value) });
  };
  const handleVolume = (value: number) => {
    setVolPct(value);
    session.setMasterVolume(volumePercentToGain(value));
  };

  return (
    <>
      <div class="booth-group" role="group" aria-label="Playback">
        {/* M-3: the play control is the shared PlayStopButton. On the phone
            stage (`compact`) the in-group copy does not render — the pinned
            centered `.phone-transport` row at the bottom of the sticky
            chrome carries the one true button (see PlayStopButton). */}
        <Show when={!props.compact}>
          <PlayStopButton />
        </Show>
        <button
          type="button"
          class="booth-btn booth-btn-loop"
          classList={{ "is-on": loopOn() }}
          data-help="booth.loop"
          aria-pressed={loopOn()}
          onClick={handleToggleLoop}
        >
          LOOP
        </button>
        <button
          type="button"
          class="booth-btn booth-btn-metro"
          classList={{ "is-on": metroOn() }}
          data-help="booth.metronome"
          aria-pressed={metroOn()}
          onClick={handleToggleMetro}
        >
          METRONOME
        </button>
        {/* M-2: phone-stage render guard — KEYS ? / INFO ? leave the DOM
            (and the a11y tree) entirely on the phone stage; the `?`/I
            keyboard twins stay live (KeyboardShortcuts). */}
        <Show when={!props.compact}>
          <button
            type="button"
            class="booth-btn booth-btn-help"
            data-help="booth.keys"
            aria-haspopup="dialog"
            onClick={(e) => openHelp(e.currentTarget)}
          >
            KEYS ?
          </button>
          {/* HP-1: the info-mode corner toggle (beside KEYS ?; the keyboard
              shortcut overlay stays a SEPARATE surface). */}
          <button
            type="button"
            class="booth-btn booth-btn-info"
            classList={{ "is-on": helpMode() }}
            data-help="booth.info"
            aria-pressed={helpMode()}
            onClick={toggleHelp}
          >
            INFO ?
          </button>
        </Show>
        {/* VZ-IM-2: the VIZ page entry toggle (the INFO-? row precedent).
            A stage-global mode, so the lit state is the warm-white chassis
            fill — booth-btn-info's lamp, not a lane hue. VZ-DD-1: the click
            opens through openViz(currentTarget) so the exit's focus return
            lands back HERE (helpOverlay precedent); Escape / `v` / the
            remote's EXIT are the twins (the booth sits inert under the
            full-bleed page while on). M-4 (iteration 4): on the phone
            stage this is the third tool the drawer carries ("similar
            tools" clause — the audit's displaced-tool call). */}
        <button
          type="button"
          class="booth-btn booth-btn-viz"
          classList={{ "is-on": vizMode() }}
          data-help="booth.viz"
          aria-pressed={vizMode()}
          onClick={(e) => openViz(e.currentTarget)}
        >
          VIZ
        </button>
      </div>

      <div
        class="booth-group"
        role="group"
        aria-label="Tempo"
        data-help="booth.tempo"
      >
        <span class="booth-label" aria-hidden="true">
          TEMPO
        </span>
        <div class="booth-stepper">
          <button
            type="button"
            class="booth-step-btn"
            aria-label="Decrease tempo one BPM"
            onClick={() => stepBpm(-1)}
          >
            –
          </button>
          <input
            class="booth-led-input"
            type="number"
            inputmode="numeric"
            min="60"
            max="200"
            step="1"
            value={bpm()}
            aria-label="Tempo in beats per minute"
            onInput={(e) => handleBpmInput(e.currentTarget.value)}
            onBlur={(e) => {
              e.currentTarget.value = String(bpm());
            }}
          />
          <button
            type="button"
            class="booth-step-btn"
            aria-label="Increase tempo one BPM"
            onClick={() => stepBpm(1)}
          >
            +
          </button>
        </div>
      </div>

      <div class="booth-group" role="group" aria-label="Project scale">
        <span class="booth-label" aria-hidden="true">
          SCALE
        </span>
        <span class="head-scale-wrap">
          <button
            type="button"
            ref={(el) => {
              scaleChipBtn = el;
            }}
            class="scale-chip scale-chip-booth"
            data-help="booth.scale"
            aria-haspopup="dialog"
            aria-expanded={scalePopOpen()}
            aria-label={`Project scale: ${scaleChip().text}. Open scale selector.`}
            onClick={() => setScalePopOpen(!scalePopOpen())}
          >
            {scaleChip().text}
          </button>
          {scalePopOpen() && (
            <ScalePopover
              variant="project"
              initialRoot={scaleChip().root}
              initialMode={scaleChip().mode}
              overridden={false}
              store={{ setProjectScale, setLaneScaleOverride }}
              onApplied={() =>
                setScaleAnnounce(
                  announceScale(
                    projectScaleChipLabel(docStore.getState().doc),
                    "Project",
                  ),
                )
              }
              onClose={() => {
                setScalePopOpen(false);
                scaleChipBtn?.focus();
              }}
            />
          )}
        </span>
        <span class="booth-sr" role="status" aria-live="polite">
          {scaleAnnounce()}
        </span>
      </div>

      <div
        class="booth-group booth-group-slider"
        role="group"
        aria-label="Swing"
        data-help="booth.swing"
      >
        <span class="booth-label" aria-hidden="true">
          SWING
        </span>
        <input
          class="booth-range"
          type="range"
          min="0"
          max="100"
          step="1"
          value={swingPct()}
          aria-label="Swing amount"
          aria-valuetext={`${swingPct()} percent`}
          onInput={(e) => handleSwing(Number(e.currentTarget.value))}
        />
        <span class="booth-value" aria-hidden="true">
          {swingPct()}%
        </span>
      </div>

      <div
        class="booth-group booth-group-slider"
        role="group"
        aria-label="Master volume"
        data-help="booth.master"
      >
        <span class="booth-label" aria-hidden="true">
          MASTER
        </span>
        <input
          class="booth-range"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volPct()}
          aria-label="Master volume"
          aria-valuetext={`${volPct()} percent`}
          onInput={(e) => handleVolume(Number(e.currentTarget.value))}
        />
        <span class="booth-value" aria-hidden="true">
          {volPct()}%
        </span>
      </div>
    </>
  );
}

/**
 * M-3 (iteration 4): the ONE play/stop control, shared by every stage.
 * Desktop/tablet renders it as the first control of the Playback group
 * (inside Booth, byte-identical to the pre-M-3 button); the phone stage
 * lifts THIS component into the pinned centered `.phone-transport` row at
 * the bottom of the sticky `.phone-chrome` (App.tsx) so PLAY/STOP stays
 * visible and horizontally centered while the grid scrolls. One handler
 * (gesture unlock + transport state machine + first-run nudge consume),
 * one `booth.play` help-registry entry, one button in the a11y tree per
 * stage — the phone Booth's in-group copy is render-guarded away by
 * `compact`, never duplicated.
 */
export function PlayStopButton() {
  const [playing, setPlaying] = createSignal(false);
  onMount(() => {
    const unsubscribe = session.subscribe((snap) => setPlaying(snap.playing));
    onCleanup(unsubscribe);
  });
  const handleTogglePlay = () => {
    if (firstRunNudge()) dismissFirstRunNudge(); // first PLAY consumes the nudge (PX-1)
    void session.togglePlay();
  };
  return (
    <button
      type="button"
      class="booth-btn booth-btn-play"
      classList={{
        "is-on": playing(),
        "booth-nudge": firstRunNudge() && !playing(),
      }}
      data-nudge={firstRunNudge() && !playing() ? "true" : undefined}
      data-help="booth.play"
      aria-pressed={playing()}
      onClick={handleTogglePlay}
    >
      {playing() ? "STOP" : "PLAY"}
    </button>
  );
}

export default function Booth(props: BoothProps) {
  const [playing, setPlaying] = createSignal(false);

  // Direct-DOM refs for the 60 Hz readouts (never signals).
  let positionEl: HTMLSpanElement | undefined;
  let announceEl: HTMLDivElement | undefined;
  const beatEls: HTMLElement[] = [];

  onMount(() => {
    const unsubscribe = session.subscribe((snap) => {
      setPlaying(snap.playing);
    });
    onCleanup(unsubscribe);
  });

  // rAF loop runs only while playing; coarse `playing` signal gates it.
  createEffect(() => {
    let lastText = "";
    let lastBeat = -1;

    function writePosition(pos: Position) {
      const text = formatPosition(pos);
      if (text !== lastText) {
        lastText = text;
        if (positionEl) positionEl.textContent = text;
      }
      if (pos.beat !== lastBeat) {
        lastBeat = pos.beat;
        for (let i = 0; i < beatEls.length; i++) {
          beatEls[i].dataset.active = String(i === pos.beat);
        }
        if (announceEl) {
          announceEl.textContent = formatBeatAnnouncement(pos);
        }
      }
    }

    function writeStoppedPosition() {
      lastText = "";
      lastBeat = -1;
      if (positionEl) {
        positionEl.textContent = formatPosition(
          session.transport.getPosition(),
        );
      }
      for (const el of beatEls) el.dataset.active = "false";
      if (announceEl) announceEl.textContent = "";
    }

    if (!playing()) {
      writeStoppedPosition();
      return;
    }
    let raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));

    function loop() {
      const pos = session.transport.getPosition();
      writePosition(pos);
      raf = requestAnimationFrame(loop);
    }
  });

  return (
    <header
      class="booth"
      aria-label="Transport booth"
      inert={props.covered ? true : undefined}
    >
      {/* M-4 (iteration 4): every option group (Playback minus the pinned
          play, Tempo, Scale, Swing, Master) lives in the ONE shared
          BoothOptions component — the desktop Booth mounts it inline, the
          phone options drawer mounts the compact copy. On the compact
          phone stage the Booth renders ONLY the position group (readout +
          SaveIndicator + Projects); the option tools sit in the drawer. */}
      <Show when={!props.compact}>
        <BitbounceBrand />
        <BoothOptions />
        <DesktopPageNavigation />
      </Show>

      <div
        class="booth-group booth-group-position"
        role="group"
        aria-label="Position"
      >
        {/* THE FULL UNIT: the status screen, set into the status module —
            it takes only the row's leftover width (zero layout px). */}
        <Show when={!props.compact}>
          <BoothScreen />
        </Show>
        {/* LL-2 (KL-1 position law): this readout is the GLOBAL clock —
            BAR.BEAT.STEP within the FULL LCM cycle of the lane chains (at
            equal cycle lengths it wraps exactly at each lane's wrap, the
            zero-drift shape; mechanism + format byte-identical to v0.1 —
            only the wrap modulus grew from the retired loopBars to the
            LCM). The beat announcement below keeps its on-beat-change-only
            fence (the spam fence). */}
        <span class="booth-label" aria-hidden="true">
          BAR.BEAT.STEP
        </span>
        <span
          ref={(el) => {
            positionEl = el;
          }}
          class="booth-led"
          aria-hidden="true"
        >
          1.1.1
        </span>
        <div class="booth-beats" aria-hidden="true">
          {Array.from({ length: BEAT_LED_COUNT }, (_, i) => (
            <span
              ref={(el) => {
                if (el) beatEls[i] = el;
              }}
              class="booth-beat-led"
              data-active="false"
            />
          ))}
        </div>
        <div
          ref={(el) => {
            announceEl = el;
          }}
          class="booth-sr"
          aria-live="polite"
        />
        <Show when={props.compact}>
          <BitbounceBrand />
        </Show>
        <Show when={!props.compact}>
          <SaveIndicator />
        </Show>
        <Projects />
        <ThemeSelector />
      </div>
    </header>
  );
}
