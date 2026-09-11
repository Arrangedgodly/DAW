/**
 * LaneHeader → QUADRANT CONTROL STRIP (DES-3, LY-1): the silkscreened strip
 * above each quadrant's pad floor. Arcade Stage Floor vocabulary — Silkscreen
 * labels, lane hue accents on borders/states only (ink law: info-critical
 * text stays warm white on the ground; the red lane never sets red text
 * above 10px Silkscreen 700).
 *
 * LY-1 two-tier structure (production decision inside the committed 2×2
 * synthesis, recorded in-task):
 * - COMPACT row, present + operable in ALL FOUR quadrants ("tweak any lane
 *   without switching"): preset/kit stepper (auditions on change), VOLUME
 *   range, MUTE, SOLO. Native tab stops (keyboard.md v2 focus table).
 * - EDIT row, visible only in the SELECTED quadrant (display:none elsewhere
 *   — hidden controls leave the tab order, never traps): effective-scale
 *   chip, gate-length stepper, FX entry (the DES-3 editing controls).
 *
 * Quadrant keys: `]` / `[` select the next/previous quadrant FROM THE STRIP
 * (the keyboard escape hatch — keyboard.md v2 key-scope rule; no native
 * meaning is hijacked). Solo changes announce through the stage status
 * region (SOLO changes other lanes' audibility — it must be speakable).
 *
 * Reactivity: the document store is zustand/vanilla, so config changes are
 * mirrored into Solid signals via one subscription — nothing here runs at
 * 60 Hz and the store stays out of the render loop (D1 law).
 */

import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { type LaneId } from "../document/schema";
import { getSession } from "../engine/session";
import { gainToVolumePercent, volumePercentToGain } from "../engine/mappings";
import {
  docStore,
  setLaneGate,
  setLaneMix,
  setLaneScaleOverride,
  setLaneSoundId,
  setProjectScale,
} from "../state/store";
import { laneScaleChipLabel, announceScale } from "../state/scaleChip";
import {
  announceStage,
  octaveStatus,
  octaveText,
  stepLaneOctave,
} from "../state/selection";
import { laneFxChain } from "../state/fxStrip";
import {
  closeFxConsole,
  fxConsoleLane,
  setFxConsoleLane,
} from "../state/fxConsole";
import { helpMode } from "../state/helpMode";
import { helpOpen } from "../state/helpOverlay";
import { primeSoundContent } from "../state/engineBridge";
import { adjacentQuadrant, focusLaneRoving } from "../state/gridFocus";
import { activeLane, stageMode } from "../state/selection";
import { fillRailsOpen, toggleFillRails } from "../state/fillRails";
import { registerHelp, type HelpEntry } from "../help/registry";
import { LANE_NAMES, soundOptionsFor } from "./laneMeta";
import ScalePopover from "./ScalePopover";
import FxStrip from "./FxStrip";

const session = getSession();

const GATE_MIN = 1;
const GATE_MAX = 16;

/**
 * HP-2 help content for one lane's strip (Professor X voice on HP-1's
 * registry; I2-6 colocated law). Ids are per-lane so the info region names
 * the lane whose control is focused.
 */
function laneHelpEntries(lane: LaneId): HelpEntry[] {
  const n = LANE_NAMES[lane];
  const kind = lane === "drums" ? "kit" : "preset";
  return [
    {
      id: `lane.${lane}.sound`,
      title: `${n} ${kind === "kit" ? "KIT" : "PRESET"}`,
      text: `Cycles through the ${kind}s ${n} can wear. Every step plays one note, so you hear the new sound the moment you land on it.`,
    },
    {
      id: `lane.${lane}.volume`,
      title: `${n} VOLUME`,
      text: `How loud ${n} sits against the other lanes. MASTER in the booth moves the whole mix at once.`,
    },
    {
      id: `lane.${lane}.mute`,
      title: `${n} MUTE`,
      text: `Silences ${n} while its notes stay exactly where you painted them — press again and it returns.`,
    },
    {
      id: `lane.${lane}.solo`,
      title: `${n} SOLO`,
      text: `Isolates ${n}: every other lane ducks down until you press it again. Handy for checking one part.`,
    },
    // RC-1 (v3): the register transpose — SOUND-changing, fenced from the
    // VIEW-only window scroll (the Professor X conflation fence, E9). PX-4
    // owns the final wording (KL-1): it must say OCTAVE, name the −3…+3
    // clamps, and draw the fence — OCT changes which rows SOUND, never
    // which rows are shown.
    ...(lane !== "drums"
      ? [
          {
            id: `lane.${lane}.oct`,
            title: `${n} OCTAVE`,
            text: `Moves the octave ${n} plays in — the SOUND transposes one OCTAVE per press, clamped at −3 and +3, and exports follow. The notes stay exactly where you painted them. This is not a view: Shift+arrows on the grid scroll the octave you SEE; OCT changes the octave you HEAR. Keyboard twin: O, Shift+O.`,
          },
        ]
      : []),
    {
      id: `lane.${lane}.scale`,
      title: `${n} SCALE`,
      text: `The notes ${n} actually offers — the project scale, or this lane's own if it overrides. Opens the picker.`,
    },
    {
      id: `lane.${lane}.gate`,
      title: `${n} GATE`,
      text: `How long a NEW note lasts when you click once, counted in 16th steps. Drag a note's right edge — or press + / − — to reshape it afterwards.`,
    },
    {
      id: `lane.${lane}.fx`,
      title: `${n} FX`,
      text: `Opens ${n}'s effect rack: up to three devices in a row, reorderable, bypassable in one click.`,
    },
    // MB-2 (mobile slice): the drums-only, narrow-stages-only fill-rails
    // reveal — the touch/mouse twin of the desktop hover reveal.
    ...(lane === "drums"
      ? [
          {
            id: "lane.drums.fill",
            title: "DRUMS FILL RAILS",
            text: "Shows every drum row's E fill rail over its pads (no hover on touch — this is the reveal). SET in a rail to spread that row's hits evenly; the button or Escape hides the rails again.",
          },
        ]
      : []),
  ];
}

for (const lane of ["drums", "bass", "chords", "lead"] as const) {
  registerHelp(laneHelpEntries(lane));
}

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
  volume: number;
  mute: boolean;
  solo: boolean;
  /** RC-1: the lane's register offset (pitched lanes; 0 default). */
  octave: number;
}

function readState(lane: LaneId): HeaderState {
  const conf = laneConf(lane);
  return {
    soundId: conf.id === "drums" ? conf.kitId : conf.presetId,
    gate: gateSteps(lane),
    chip: laneScaleChipLabel(docStore.getState().doc, lane),
    volume: gainToVolumePercent(conf.volume ?? 1),
    mute: conf.mute === true,
    solo: conf.solo === true,
    octave: conf.id === "drums" ? 0 : (conf.octave ?? 0),
  };
}

export default function LaneHeader(props: { lane: LaneId }): JSX.Element {
  const initial = readState(props.lane);
  const [soundId, setSoundId] = createSignal(initial.soundId);
  const [gate, setGate] = createSignal(initial.gate);
  const [chip, setChip] = createSignal(initial.chip);
  const [volumePct, setVolumePct] = createSignal(initial.volume);
  const [mute, setMute] = createSignal(initial.mute);
  const [solo, setSolo] = createSignal(initial.solo);
  const [octave, setOctave] = createSignal(initial.octave);
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  // Refinement-1 (critique P1-1): the FX console open-state is PAGE-level
  // (state/fxConsole.ts) so page-level Escape can close it. Only the
  // selected quadrant can open it — the focus law below still closes it the
  // instant this quadrant goes view-only.
  const fxOpen = () => fxConsoleLane() === props.lane;
  const [fxCount, setFxCount] = createSignal(
    laneFxChain(docStore.getState().doc, props.lane).length,
  );
  const [announce, setAnnounce] = createSignal("");
  const editable = () => activeLane() === props.lane;

  let chipBtn: HTMLButtonElement | undefined;
  let stripEl: HTMLDivElement | undefined;
  let editRowEl: HTMLDivElement | undefined;
  let fxFocusHost: HTMLDivElement | undefined;
  let fxBtn: HTMLButtonElement | undefined;

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
      setVolumePct(next.volume);
      setMute(next.mute);
      setSolo(next.solo);
      setOctave(next.octave);
      setFxCount(laneFxChain(state.doc, props.lane).length);
    });
    onCleanup(unsubscribe);
  });

  // LY-1 focus law: when this quadrant becomes view-only, its edit row hides
  // and any open FX overlay closes (display:none). If focus rested inside
  // them it would strand on <body> — land it on the strip's first control
  // instead (the strip stays visible + operable everywhere). The focus
  // check runs BEFORE the overlay unmounts so containment is still testable.
  createEffect(() => {
    if (!editable() && stripEl && typeof document !== "undefined") {
      const el = document.activeElement;
      const insideHidden =
        (editRowEl && el && editRowEl.contains(el) === true) ||
        (fxFocusHost && el && fxFocusHost.contains(el) === true);
      if (fxConsoleLane() === props.lane) closeFxConsole();
      setPopoverOpen(false);
      if (insideHidden) {
        stripEl.querySelector<HTMLElement>("button, input")?.focus();
      }
    }
  });

  // Refinement-1 (critique P1-1): PAGE-LEVEL ESCAPE closes the console —
  // the pointer user's "how do I get my grid back" exit. Ordering law
  // (keyboard.md v2): the KEYS modal and help mode win FIRST (their
  // capture-phase handlers consume the keystroke before this bubble
  // listener; the guards below make the law hold even for window-targeted
  // dispatches), inline edits/popovers/menus cancel first (they all
  // stopPropagation — the add menu's second-Escape contract in
  // help-mode.test), and the region-head pops apply only once the console
  // is closed. Focus stays where it was (help-mode precedent — nothing was
  // trapped) UNLESS it rested inside the console, where closing would
  // strand it on <body>: then it lands on the strip's FX entry, the
  // control that owns the console.
  createEffect(() => {
    if (!fxOpen()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (helpMode() || helpOpen()) return; // cancel-first surfaces win
      if (fxConsoleLane() !== props.lane) return; // closed mid-dispatch
      e.preventDefault();
      const inside =
        fxFocusHost !== undefined &&
        document.activeElement !== null &&
        fxFocusHost.contains(document.activeElement);
      closeFxConsole();
      if (inside) fxBtn?.focus();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
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
    const index = soundIndex();
    const next = list[(index + delta + list.length) % list.length];
    setLaneSoundId(props.lane, next.id);
    setSoundId(next.id);
    // PS-4 decode-on-selection law: the chosen sound's sample assets (if
    // any) load lazily NOW, together with the stepper's two neighbors, so
    // the next step in either direction is already decoded when reached.
    // Failures surface as one sticky toast (engineBridge); synth sounds
    // resolve to zero refs and prime nothing.
    primeSoundContent([
      next.id,
      list[(index + delta + 1 + list.length) % list.length]?.id ?? next.id,
      list[(index + delta - 1 + list.length) % list.length]?.id ?? next.id,
    ]);
    // One audition of the new sound (spec: preview on change).
    void session.audition(props.lane, props.lane === "drums" ? "kick" : 0);
  };

  const stepGate = (delta: number) => {
    const next = Math.min(GATE_MAX, Math.max(GATE_MIN, gate() + delta));
    if (next === gate()) return;
    setLaneGate(props.lane, { unit: "steps", value: next });
    setGate(next);
  };

  const handleVolume = (pct: number) => {
    setVolumePct(pct);
    setLaneMix(props.lane, { volume: volumePercentToGain(pct) });
  };

  const handleMute = () => {
    const next = !mute();
    setMute(next);
    setLaneMix(props.lane, { mute: next });
  };

  const handleSolo = () => {
    const next = !solo();
    setSolo(next);
    setLaneMix(props.lane, { solo: next });
    // keyboard.md v2: solo changes OTHER lanes' audibility — speak it through
    // the stage status region (E1's region).
    announceStage(next ? `SOLO ${LANE_NAMES[props.lane]}` : `SOLO OFF`);
  };

  // RC-1 (v3, E8): the OCT funnel — pointer twin of global `o`/Shift+`o`,
  // same path, same announcements (the E5 parity law). Operates on THIS
  // lane from ANY quadrant (the always-operable compact-row law).
  const stepOctave = (delta: -1 | 1) => {
    stepLaneOctave(props.lane as Exclude<LaneId, "drums">, delta);
    setOctave(readState(props.lane).octave);
  };

  // `]` / `[` select the adjacent quadrant (the strip-side escape hatch —
  // these keys have no native meaning on any control, so nothing is hijacked).
  const onStripKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "]" && e.key !== "[") return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
      !(target instanceof HTMLInputElement && target.type === "range")
    )
      return; // never in text entries
    const dir = e.key === "]" ? 1 : -1;
    const target2 = adjacentQuadrant(props.lane, dir);
    if (!target2) return; // at the edge — stay, no wrap
    e.preventDefault();
    focusLaneRoving(target2);
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
    <div
      class="lane-head lane-head-strip"
      data-editing={editable()}
      onKeyDown={onStripKeyDown}
      ref={(el) => {
        stripEl = el;
      }}
    >
      {/* ---- compact row: always operable in all four quadrants (LY-1) ---- */}
      <div class="lane-strip-compact">
        <span class="lane-name">
          {LANE_NAMES[props.lane]}
          <span class="lane-state" aria-hidden="true">
            {editable() ? "· EDIT" : "· VIEW"}
          </span>
        </span>

        <div
          class="head-ctl"
          role="group"
          aria-label={`${LANE_NAMES[props.lane]} sound`}
          data-help={`lane.${props.lane}.sound`}
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

        <Show when={props.lane !== "drums" && stageMode() !== "phone"}>
          {/* RC-1 (v3, E8): the register readout + OCT −/+ stepper — the
              preset/kit + gate stepper pattern, always operable from every
              quadrant (KL-1's COMPACT-row placement). SOUND-changing: the
              help entry fences it from VIEW-only window scroll (E9).
              i7 N-2 (midi-i7-audit §2.2, the LY-1 phone carve-out): at
              PHONE scope this group HIDES (render guard, the M-2 KEYS/INFO
              precedent — not CSS) and the SAME control moves into the phone
              OPTIONS drawer — one card carries ONE octave control next to
              ONE semitone control (the register VIEW row), so the two
              same-labeled OCT controls never share a card. Desktop/tablet
              markup is byte-identical (m4). */}
          <div
            class="head-ctl"
            role="group"
            aria-label={`${LANE_NAMES[props.lane]} octave`}
            data-help={`lane.${props.lane}.oct`}
          >
            <span class="head-ctl-label" aria-hidden="true">
              OCT
            </span>
            <div class="head-stepper">
              <button
                type="button"
                class="head-step-btn"
                aria-label={`Octave down for ${LANE_NAMES[props.lane]}`}
                onClick={() => stepOctave(-1)}
              >
                –
              </button>
              <span class="head-ctl-value head-oct-value">
                {octaveText(octave())}
              </span>
              <button
                type="button"
                class="head-step-btn"
                aria-label={`Octave up for ${LANE_NAMES[props.lane]}`}
                onClick={() => stepOctave(1)}
              >
                +
              </button>
            </div>
          </div>
        </Show>

        <div
          class="head-ctl head-ctl-vol"
          role="group"
          aria-label={`${LANE_NAMES[props.lane]} volume`}
          data-help={`lane.${props.lane}.volume`}
        >
          <span class="head-ctl-label" aria-hidden="true">
            VOL
          </span>
          <input
            class="head-range"
            type="range"
            min="0"
            max="100"
            step="1"
            value={volumePct()}
            aria-label={`${LANE_NAMES[props.lane]} volume`}
            aria-valuetext={`${volumePct()} percent`}
            onInput={(e) => handleVolume(Number(e.currentTarget.value))}
          />
          <span class="head-ctl-value head-vol-value" aria-hidden="true">
            {volumePct()}%
          </span>
        </div>

        <button
          type="button"
          class="head-mix-btn"
          classList={{ "is-on": mute() }}
          data-help={`lane.${props.lane}.mute`}
          aria-pressed={mute()}
          aria-label={`Mute ${LANE_NAMES[props.lane]}`}
          onClick={handleMute}
        >
          MUTE
        </button>
        <button
          type="button"
          class="head-mix-btn"
          classList={{ "is-on": solo() }}
          data-help={`lane.${props.lane}.solo`}
          aria-pressed={solo()}
          aria-label={`Solo ${LANE_NAMES[props.lane]}`}
          onClick={handleSolo}
        >
          SOLO
        </button>
      </div>

      {/* ---- edit row: the SELECTED quadrant only (display:none elsewhere) ---- */}
      <div
        class="lane-strip-edit"
        classList={{ "is-hidden": !editable() }}
        ref={(el) => {
          editRowEl = el;
        }}
      >
        <span class="head-scale-wrap">
          <button
            type="button"
            ref={(el) => {
              chipBtn = el;
            }}
            class="scale-chip"
            classList={{ "is-lane": chip().overridden }}
            data-help={`lane.${props.lane}.scale`}
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
          data-help={`lane.${props.lane}.gate`}
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
          ref={(el) => {
            fxBtn = el;
          }}
          data-help={`lane.${props.lane}.fx`}
          aria-expanded={fxOpen()}
          aria-controls={`fx-strip-${props.lane}`}
          aria-label={`FX chain for ${LANE_NAMES[props.lane]}${fxCount() > 0 ? `, ${fxCount()} device${fxCount() === 1 ? "" : "s"}` : ", empty"}. Open FX strip.`}
          onClick={() => {
            // Only the SELECTED quadrant's entry is live (the LY-1 focus
            // law: a console never rests on a view-only floor). The guard
            // matters now that the open-state is page-level — without it a
            // synthetic click on a hidden edit row could flash a console
            // open over a view-only quadrant before the focus law closed it.
            if (!editable()) return;
            setFxConsoleLane(fxOpen() ? null : props.lane);
          }}
        >
          FX
          <Show when={fxCount() > 0}>
            <span class="head-fx-count" aria-hidden="true">
              {" "}
              · {fxCount()}
            </span>
          </Show>
        </button>

        {/* MB-2 (mobile slice): the FILL reveal — drums lane, NARROW stages
            only (phone + tablet render the fill rails as the MB-1 overlay;
            hover reveals nothing on touch, so the strip toggle is the
            reveal). Desktop never renders it — the inline rail keeps its
            hover/focus reveal and the desktop law stays byte-identical
            (m4). One action: show/hide every row's rail; the steppers were
            always tab stops, so keyboard reachability is unchanged. */}
        <Show when={props.lane === "drums" && stageMode() !== "desktop"}>
          <button
            type="button"
            class="head-mix-btn head-fill-toggle"
            classList={{ "is-on": fillRailsOpen() }}
            data-help="lane.drums.fill"
            aria-pressed={fillRailsOpen()}
            aria-label={`Euclidean fill rails over the ${LANE_NAMES[props.lane]} rows`}
            onClick={() => toggleFillRails()}
          >
            FILL
          </button>
        </Show>
      </div>

      {/* FX console overlay: only the selected quadrant can open it (the
          focus law above closes it the instant the quadrant goes view-only);
          the overlay chassis floats over the quadrant's GRID (one-page law —
          opening a strip never grows the page), scrolling internally.

          Refinement-1 (critique P1-1 — the pointer-trap fix): the chassis
          starts BELOW the whole control strip (measured top pinned inline;
          the CSS value is the measured fallback), so the strip's edit row —
          FX toggle, scale chip, GATE — stays clickable while the console is
          open. The title strip gives the chassis a visible boundary (the
          empty console used to be invisible: chassis-on-chassis) and carries
          the CLOSE affordance on the chassis itself — never under it. */}
      <Show when={fxOpen()}>
        <div
          id={`fx-strip-${props.lane}`}
          class="lane-fx-wrap"
          ref={(el) => {
            fxFocusHost = el;
            // Pin the chassis top to the strip's real bottom edge (the
            // renderer-pinned-geometry precedent — CSS holds the fallback).
            // The strip cannot wrap into a second line in the supported
            // viewport range, but measuring keeps every viewport honest.
            const floor = el.closest(".lane-floor");
            if (floor && stripEl) {
              const below =
                stripEl.getBoundingClientRect().bottom -
                floor.getBoundingClientRect().top +
                4;
              el.style.top = `${Math.max(0, below)}px`;
            }
          }}
        >
          <div class="lane-fx-title">
            <span class="lane-fx-title-led" aria-hidden="true" />
            <span class="lane-fx-title-name" aria-hidden="true">
              {LANE_NAMES[props.lane]} FX
            </span>
            <button
              type="button"
              class="lane-fx-close"
              data-help="fx.close"
              aria-label={`Close ${LANE_NAMES[props.lane]} FX console`}
              onClick={() => {
                closeFxConsole();
                fxBtn?.focus();
              }}
            >
              CLOSE
            </button>
          </div>
          <FxStrip lane={props.lane} />
        </div>
      </Show>

      <span class="head-sr" role="status" aria-live="polite">
        {announce()}
      </span>

      {/* RC-1 (v3, E8): the strip-local OCT value/clamp region — ONE funnel
          (selection.stepLaneOctave) writes it from every input path: the
          strip buttons, the pointer, and the global `o`/Shift+`o` key on the
          active lane. Rendered for drums too (its only text is the
          DRUMS HAS NO OCTAVE refusal). */}
      <span
        class="head-sr oct-live"
        role="status"
        aria-live="polite"
        data-lane={props.lane}
      >
        {octaveStatus(props.lane)}
      </span>
    </div>
  );
}
