/**
 * LaneHeader (DES-3): the silkscreened control strip above each pad floor.
 * Arcade Stage Floor vocabulary — Silkscreen labels, lane hue accents on
 * borders/states only (ink law: info-critical text stays warm white on the
 * ground; the red lane never sets red text above 10px Silkscreen 700).
 *
 * Strip: preset/kit stepper (auditions on change) · effective-scale chip
 * (the R6 discharger — PROJECT vs LANE source is stated on the chip, and the
 * popover offers exactly one action to detach or return) · gate-length
 * stepper · FX entry point (placeholder for DES-5).
 *
 * Reactivity: the document store is zustand/vanilla, so config changes are
 * mirrored into Solid signals via one subscription — nothing here runs at
 * 60 Hz and the store stays out of the render loop (D1 law).
 */

import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { type LaneId } from "../document/schema";
import { getSession } from "../engine/session";
import { rovingGroup } from "../lib/rovingGroup";
import {
  docStore,
  setLaneGate,
  setLaneScaleOverride,
  setLaneSoundId,
  setProjectScale,
} from "../state/store";
import { laneScaleChipLabel, announceScale } from "../state/scaleChip";
import { laneFxChain } from "../state/fxStrip";
import { LANE_NAMES, soundOptionsFor } from "./laneMeta";
import ScalePopover from "./ScalePopover";
import FxStrip from "./FxStrip";

const session = getSession();

const GATE_MIN = 1;
const GATE_MAX = 16;

function laneConf(lane: LaneId) {
  return docStore.getState().doc.lanes.find((l) => l.id === lane)!;
}

/** Gate read as whole steps (seconds-unit gates coerce to 1 step on edit). */
function gateSteps(lane: LaneId): number {
  const gate = laneConf(lane).gate;
  return gate.unit === "steps" ? Math.round(gate.value) : GATE_MIN;
}

interface HeaderState {
  soundId: string;
  gate: number;
  chip: ReturnType<typeof laneScaleChipLabel>;
}

function readState(lane: LaneId): HeaderState {
  const conf = laneConf(lane);
  return {
    soundId: conf.id === "drums" ? conf.kitId : conf.presetId,
    gate: gateSteps(lane),
    chip: laneScaleChipLabel(docStore.getState().doc, lane),
  };
}

export default function LaneHeader(props: { lane: LaneId }): JSX.Element {
  const initial = readState(props.lane);
  const [soundId, setSoundId] = createSignal(initial.soundId);
  const [gate, setGate] = createSignal(initial.gate);
  const [chip, setChip] = createSignal(initial.chip);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  const [fxOpen, setFxOpen] = createSignal(false);
  const [fxCount, setFxCount] = createSignal(
    laneFxChain(docStore.getState().doc, props.lane).length,
  );
  const [announce, setAnnounce] = createSignal("");

  let chipBtn: HTMLButtonElement | undefined;
  let stripEl: HTMLDivElement | undefined;

  onMount(() => {
    // DA-1: the header strip is ONE tab stop (roving group); arrows move
    // between its controls, Home/End to the ends. Native arrow targets
    // (none here today, future inputs) keep their semantics.
    const roving = stripEl ? rovingGroup(stripEl) : null;
    onCleanup(() => roving?.dispose());
  });

  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (
        state.doc.lanes === prev.doc.lanes &&
        state.doc.scale === prev.doc.scale &&
        state.doc.laneOverrides === prev.doc.laneOverrides
      )
        return;
      const next = readState(props.lane);
      setSoundId(next.soundId);
      setGate(next.gate);
      setChip(next.chip);
      setFxCount(laneFxChain(state.doc, props.lane).length);
    });
    onCleanup(unsubscribe);
  });

  const store = { setProjectScale, setLaneScaleOverride };

  const options = () => soundOptionsFor(props.lane);
  const soundIndex = () =>
    Math.max(
      0,
      options().findIndex((o) => o.id === soundId()),
    );
  const soundName = () => options()[soundIndex()]?.name ?? soundId();

  const stepSound = (delta: number) => {
    const list = options();
    if (list.length === 0) return;
    const next = list[(soundIndex() + delta + list.length) % list.length];
    setLaneSoundId(props.lane, next.id);
    setSoundId(next.id);
    // One audition of the new sound (spec: preview on change).
    void session.audition(props.lane, props.lane === "drums" ? "kick" : 0);
  };

  const stepGate = (delta: number) => {
    const next = Math.min(GATE_MAX, Math.max(GATE_MIN, gate() + delta));
    if (next === gate()) return;
    setLaneGate(props.lane, { unit: "steps", value: next });
    setGate(next);
  };

  const closePopover = () => {
    setPopoverOpen(false);
    chipBtn?.focus();
  };

  const handleApplied = () => {
    setAnnounce(
      announceScale(
        laneScaleChipLabel(docStore.getState().doc, props.lane),
        LANE_NAMES[props.lane],
      ),
    );
  };

  return (
    <div class="lane-head lane-head-strip">
      <span class="lane-name">{LANE_NAMES[props.lane]}</span>

      <div
        class="lane-head-controls"
        ref={(el) => {
          stripEl = el;
        }}
      >
        <div
          class="head-ctl"
          role="group"
          aria-label={`${LANE_NAMES[props.lane]} sound`}
        >
          <span class="head-ctl-label" aria-hidden="true">
            {props.lane === "drums" ? "KIT" : "PRESET"}
          </span>
          <div class="head-stepper">
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Previous ${props.lane === "drums" ? "kit" : "preset"} for ${LANE_NAMES[props.lane]}`}
              onClick={() => stepSound(-1)}
            >
              –
            </button>
            <span class="head-ctl-value" aria-live="polite">
              {soundName()}
            </span>
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Next ${props.lane === "drums" ? "kit" : "preset"} for ${LANE_NAMES[props.lane]}`}
              onClick={() => stepSound(1)}
            >
              +
            </button>
          </div>
        </div>

        <span class="head-scale-wrap">
          <button
            type="button"
            ref={(el) => {
              chipBtn = el;
            }}
            class="scale-chip"
            classList={{ "is-lane": chip().overridden }}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen()}
            aria-label={`${LANE_NAMES[props.lane]} effective scale: ${chip().text}. Open scale selector.`}
            onClick={() => setPopoverOpen(!popoverOpen())}
          >
            {chip().text}
          </button>
          <Show when={popoverOpen()}>
            <ScalePopover
              variant="lane"
              lane={props.lane}
              initialRoot={chip().root}
              initialMode={chip().mode}
              overridden={chip().overridden}
              store={store}
              onApplied={handleApplied}
              onClose={closePopover}
            />
          </Show>
        </span>

        <div
          class="head-ctl"
          role="group"
          aria-label={`${LANE_NAMES[props.lane]} gate length`}
        >
          <span class="head-ctl-label" aria-hidden="true">
            GATE
          </span>
          <div class="head-stepper">
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Shorter gate for ${LANE_NAMES[props.lane]}`}
              onClick={() => stepGate(-1)}
            >
              –
            </button>
            <span class="head-ctl-value">
              {gate()}
              <span class="head-ctl-unit" aria-hidden="true">
                ST
              </span>
            </span>
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Longer gate for ${LANE_NAMES[props.lane]}`}
              onClick={() => stepGate(1)}
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          class="head-fx"
          classList={{ "is-open": fxOpen() }}
          aria-expanded={fxOpen()}
          aria-controls={`fx-strip-${props.lane}`}
          aria-label={`FX chain for ${LANE_NAMES[props.lane]}${fxCount() > 0 ? `, ${fxCount()} device${fxCount() === 1 ? "" : "s"}` : ", empty"}. Open FX strip.`}
          onClick={() => setFxOpen(!fxOpen())}
        >
          FX
          <Show when={fxCount() > 0}>
            <span class="head-fx-count" aria-hidden="true">
              {" "}
              · {fxCount()}
            </span>
          </Show>
        </button>
      </div>

      <Show when={fxOpen()}>
        <div id={`fx-strip-${props.lane}`} class="lane-fx-wrap">
          <FxStrip lane={props.lane} />
        </div>
      </Show>

      <span class="head-sr" role="status" aria-live="polite">
        {announce()}
      </span>
    </div>
  );
}
