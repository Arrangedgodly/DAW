/**
 * Booth — the transport control strip at the top of the stage.
 * Arcade Stage Floor vocabulary: dark chassis, silkscreened labels
 * (--font-label), values (--font-value), LED readouts (--font-led).
 *
 * Performance contract (D1): the BAR.BEAT.STEP readout and beat LEDs are
 * written from rAF via direct DOM mutation — never reactive state. Coarse
 * state (playing, loop, bpm…) rides Solid signals fed by transport.subscribe.
 */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
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
import {
  announceScale,
  projectScaleChipLabel,
} from "../state/scaleChip";
import ScalePopover from "./ScalePopover";
import SaveIndicator from "./SaveIndicator";
import FileIO from "./FileIO";

const session = getSession();

const BEAT_LED_COUNT = 4;

export default function Booth() {
  // Project-scale chip (DES-3): mirrors the document scale into signals via
  // one subscription; the popover commits through the store seam.
  const [scaleChip, setScaleChip] = createSignal(projectScaleChipLabel(docStore.getState().doc));
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

  const [playing, setPlaying] = createSignal(false);
  const [loopOn, setLoopOn] = createSignal(session.transport.snapshot.loop);
  const [metroOn, setMetroOn] = createSignal(false);
  const [bpm, setBpm] = createSignal(session.transport.snapshot.bpm);
  const [swingPct, setSwingPct] = createSignal(
    swingAmountToPercent(session.transport.snapshot.swing),
  );
  const [volPct, setVolPct] = createSignal(
    gainToVolumePercent(session.masterVolume),
  );

  // Direct-DOM refs for the 60 Hz readouts (never signals).
  let positionEl: HTMLSpanElement | undefined;
  let announceEl: HTMLDivElement | undefined;
  const beatEls: HTMLElement[] = [];

  onMount(() => {
    const unsubscribe = session.subscribe((snap) => {
      setPlaying(snap.playing);
      setLoopOn(snap.loop);
      setBpm(snap.bpm);
      setSwingPct(swingAmountToPercent(snap.swing));
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

  const handleTogglePlay = () => void session.togglePlay();
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
    <header class="booth" aria-label="Transport booth">
      <div class="booth-group" role="group" aria-label="Playback">
        <button
          type="button"
          class="booth-btn booth-btn-play"
          classList={{ "is-on": playing() }}
          aria-pressed={playing()}
          onClick={handleTogglePlay}
        >
          {playing() ? "STOP" : "PLAY"}
        </button>
        <button
          type="button"
          class="booth-btn booth-btn-loop"
          classList={{ "is-on": loopOn() }}
          aria-pressed={loopOn()}
          onClick={handleToggleLoop}
        >
          LOOP
        </button>
        <button
          type="button"
          class="booth-btn booth-btn-metro"
          classList={{ "is-on": metroOn() }}
          aria-pressed={metroOn()}
          onClick={handleToggleMetro}
        >
          METRONOME
        </button>
      </div>

      <div class="booth-group" role="group" aria-label="Tempo">
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
                  announceScale(projectScaleChipLabel(docStore.getState().doc), "Project"),
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

      <div
        class="booth-group booth-group-position"
        role="group"
        aria-label="Position"
      >
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
        <SaveIndicator />
        <FileIO />
      </div>
    </header>
  );
}
