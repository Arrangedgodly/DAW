/**
 * PhoneOptions — M-4 (iteration 4): the phone-stage collapsible options
 * drawer. The OPTIONS toggle rides the pinned `.phone-transport` row
 * beside the centered PLAY/STOP (a 1fr-auto-1fr grid keeps PLAY exactly
 * centered whether the drawer is open or closed); the drawer itself is the
 * LAST child of the sticky `.phone-chrome` — it grows the chrome downward,
 * never covering the transport. Collapsed = ZERO drawer DOM (the Show law,
 * helpOverlay/vizMode precedents — App mounts this panel inside a Show).
 *
 * Reuse law: the drawer mounts the ONE shared `BoothOptions` component
 * (compact copy — the same signals, the same store/session seams, the same
 * JSX groups as the desktop Booth). No transport logic lives here. i7 N-2:
 * the drawer also carries the ACTIVE lane's OCTAVE stepper (the strip
 * group's phone home — LaneOctaveGroup below, the E9-fenced sound
 * transpose; the audit §2.2 unified-controls law).
 *
 * Dismissal: Escape or an outside tap (the help-overlay precedent) — the
 * fixed backdrop sits BELOW the sticky chrome (z 5 < 10) so taps on the
 * scrolling grid close the drawer while the chrome (transport + drawer)
 * stays interactive; focus returns to the OPTIONS toggle.
 */

import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { BoothOptions } from "./Booth";
import {
  closeOptions,
  optionsOpen,
  toggleOptions,
} from "../state/optionsDrawer";
import {
  activeLane,
  octaveText,
  stepLaneOctave,
  type PitchedLaneId,
} from "../state/selection";
import { docStore } from "../state/store";
import { LANE_NAMES } from "./laneMeta";
import RollValue from "./RollValue";
import { registerHelp } from "../help/registry";

// HP-2 help content (same registry): the drawer's own affordance.
registerHelp([
  {
    id: "phone.options",
    title: "OPTIONS",
    text: "Opens and closes the options drawer on the phone: loop, metronome, viz, tempo, scale, swing and master volume live inside. Escape or a tap outside closes it.",
  },
]);

/**
 * The OPTIONS toggle + its live announcement. Rendered INSIDE the pinned
 * `.phone-transport` row (grid column 1; the equal 1fr edge columns keep
 * PLAY centered). The visually-hidden status region announces open/close
 * to screen readers (the plan's SR-announced clause).
 */
export function OptionsButton() {
  return (
    <>
      <button
        type="button"
        class="booth-btn phone-options-btn"
        classList={{ "is-on": optionsOpen() }}
        data-help="phone.options"
        aria-expanded={optionsOpen()}
        aria-haspopup="true"
        onClick={(e) => toggleOptions(e.currentTarget)}
      >
        OPTIONS
      </button>
      <span class="booth-sr" role="status" aria-live="polite">
        {optionsOpen() ? "Options drawer open" : "Options drawer closed"}
      </span>
    </>
  );
}

/**
 * The open drawer's dismissal surface + the panel housing the compact
 * BoothOptions groups. App render-guards both with a Show on
 * `optionsOpen()` — collapsed means both are unmounted (zero DOM).
 *
 * Stacking law: the backdrop mounts OUTSIDE `.phone-chrome` (a fixed,
 * full-viewport layer at z 5, BELOW the chrome's own z 10) so it dims and
 * catches taps on the scrolling grid while the chrome — transport row AND
 * drawer panel — stays interactive above it. The panel mounts INSIDE the
 * chrome (after `.phone-transport`), growing the sticky chrome downward.
 */
export function OptionsBackdrop() {
  // Escape closes (help-overlay precedent). Window-level: focus may sit in
  // the drawer's inputs, the popover, or the grid below.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOptions();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  return (
    <div
      class="phone-options-backdrop"
      aria-hidden="true"
      onClick={closeOptions}
    />
  );
}

/**
 * i7 N-2 (midi-i7-audit §2.2, the unified controls law): the phone drawer's
 * lane OCTAVE group — the RC-1 SOUND transpose the strip carries on desktop/
 * tablet moves here at phone scope (the strip group is render-guarded away,
 * so the card's ONE octave control is the register VIEW row's OCT stepper).
 * Same seam as the strip (stepLaneOctave: the −3..+3 clamp + the strip's
 * SR announcements), the strip's own stepper vocabulary (.head-stepper —
 * the phone 44×44 painted law is stage-scoped, so it applies here), and
 * the E9-fenced "what you HEAR, not what you SEE" wording the audit pins.
 * The ACTIVE pitched lane owns the stepper (phone mounts exactly one card);
 * drums never renders the group.
 */
function LaneOctaveGroup() {
  // The document store is zustand/vanilla (the LaneHeader law): mirror doc
  // identity into a signal so the value re-derives on octave writes.
  const [docVersion, setDocVersion] = createSignal(0);
  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc) setDocVersion((v) => v + 1);
    });
    onCleanup(unsubscribe);
  });
  const lane = createMemo(() => {
    const l = activeLane();
    return l === "drums" ? null : (l as PitchedLaneId);
  });
  const octave = createMemo(() => {
    void docVersion();
    const l = lane();
    if (!l) return 0;
    const conf = docStore.getState().doc.lanes.find((c) => c.id === l);
    return conf && conf.id !== "drums" ? (conf.octave ?? 0) : 0;
  });

  return (
    <Show when={lane()} keyed>
      {(l: PitchedLaneId) => (
        <div
          class="booth-group phone-oct-group"
          role="group"
          aria-label={`${LANE_NAMES[l]} octave (sound)`}
          data-help={`lane.${l}.oct`}
        >
          <span class="booth-label" aria-hidden="true">
            {LANE_NAMES[l]} OCTAVE
          </span>
          <div class="head-stepper">
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Octave down for ${LANE_NAMES[l]}`}
              onClick={() => stepLaneOctave(l, -1)}
            >
              –
            </button>
            <span class="head-ctl-value head-oct-value" aria-live="polite">
              <RollValue value={octave()}>{octaveText(octave())}</RollValue>
            </span>
            <button
              type="button"
              class="head-step-btn"
              aria-label={`Octave up for ${LANE_NAMES[l]}`}
              onClick={() => stepLaneOctave(l, 1)}
            >
              +
            </button>
          </div>
          {/* The E9 fence, spoken where the control lives: OCT transposes
              the SOUND; the register row scrolls the VIEW. */}
          <span class="phone-oct-fence">
            Changes what you HEAR, not what you SEE — clamped at −3 and +3.
            The OCT/SEMI row scrolls the view.
          </span>
        </div>
      )}
    </Show>
  );
}

export function OptionsDrawerPanel() {
  // Focus lands INSIDE the drawer on open (the APG dialog expectation);
  // closeOptions() returns it to the opener. A macrotask, not a microtask:
  // the initiating click is still bubbling when the panel mounts, and a
  // microtask focus would be overwritten by the click observers that run
  // later in the same dispatch (observed with the help-mode entry region).
  let panel: HTMLDivElement | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    focusTimer = setTimeout(() => {
      const first = panel?.querySelector<HTMLElement>("button, input");
      first?.focus();
    }, 0);
  });
  onCleanup(() => {
    if (focusTimer !== undefined) clearTimeout(focusTimer);
  });

  return (
    <div
      ref={(el) => {
        panel = el;
      }}
      class="booth phone-options-drawer"
      role="group"
      aria-label="Options"
    >
      <LaneOctaveGroup />
      <BoothOptions compact />
    </div>
  );
}
