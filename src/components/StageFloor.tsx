/**
 * StageFloor (DES-4, DES-6, LY-1): the four lane QUADRANTS in the committed
 * 2×2 arrangement (town-hall I2-1 — user synthesis, not re-derived here):
 * drums top-left, bass top-right, chords bottom-left, lead bottom-right
 * (visual reading order = the lane-move order). One quadrant is editable
 * (selection.activeLane IS the quadrant selection); the other three render
 * view-only with live notes + playhead. Plus the one-time store→engine
 * bridge connection.
 *
 * The stage carries ONE role=status region (a11y §7 E1): every actual
 * quadrant-selection change announces `NOW EDITING <LANE>` from ANY input
 * path, and solo changes announce `SOLO <LANE>` / `SOLO OFF` — the same
 * region (keyboard.md v2).
 *
 * DES-6: the stage carries the view-mode attribute (selection.ts viewMode —
 * FOCUS enlarges the short grids, CHAIN shows them at editing size). The
 * pattern rail lives directly under the booth (App shell), this stays the
 * quadrants.
 *
 * MB-1 (mobile slice): at PHONE width the quadrant stage becomes the
 * SINGLE-LANE stage — the committed model (town-hall mobile addendum): the
 * quadrant selection IS lane selection, so the LANE SWITCHER (tabs, below)
 * drives selection.activeLane and the other three lanes simply do not render
 * (no view-only quadrants at phone width — no focus traps by construction).
 * The switcher itself renders in the App shell's sticky phone-chrome group
 * (pinned with the transport + condensed rail) so it never scrolls away.
 */

import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import type { LaneId } from "../document/schema";
import { connectStoreToEngine } from "../state/engineBridge";
import { EMPTY_HINT_LABEL, isProjectEmpty } from "../state/emptyProject";
import {
  activeLane,
  stageStatus,
  viewMode,
  selectLane,
  stageMode,
} from "../state/selection";
import { docStore } from "../state/store";
import { densityBand } from "../state/ambientDensity";
import { registerHelp } from "../help/registry";
import LaneGrid from "./LaneGrid";
import { LANE_NAMES } from "./laneMeta";

const LANES: readonly LaneId[] = ["drums", "bass", "chords", "lead"];

/**
 * HP-2 help content for the switcher (MB-1; the Professor X voice, colocated
 * registration law). Only mounted at phone width.
 */
registerHelp([
  {
    id: "stage.switcher",
    title: "LANE SWITCHER",
    text: "Picks the lane you are editing — the phone's twin of clicking a quadrant. Left and right arrows walk the lanes; PageUp/PageDown and ] [ still work from the grid. The lit tab carries the lane's color.",
  },
]);

/**
 * MB-1: the PHONE lane switcher — tabs in lane hues, one per lane, driving
 * the SAME selection.activeLane as the quadrant clicks/keys (semantics
 * preserved: `NOW EDITING <LANE>` announcements ride the stage status region;
 * the grid lane-move keys keep working from the grid). Tabs convention:
 * roving tabindex (one tab stop — the active lane), ArrowLeft/Right/Home/End
 * select + move focus (automatic activation).
 */
export function LaneSwitcher(): JSX.Element {
  const select = (lane: LaneId) => {
    if (activeLane() === lane) return;
    selectLane(lane); // announces NOW EDITING <LANE> (E1)
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"))
      return; // never in text entries
    const current = LANES.indexOf(activeLane());
    let next: number;
    if (e.key === "ArrowRight") next = Math.min(current + 1, LANES.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(current - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = LANES.length - 1;
    else return;
    e.preventDefault();
    const lane = LANES[next]!;
    if (lane !== activeLane()) select(lane);
    // Tabs convention: focus follows the selection (the switcher is the
    // selector — the E1 focus-movement law's one sanctioned exception class,
    // same as the tablist pattern requires).
    queueMicrotask(() => {
      document
        .querySelector<HTMLButtonElement>(
          `.lane-switch-tab[data-lane="${lane}"]`,
        )
        ?.focus();
    });
  };
  return (
    <div
      class="lane-switcher"
      role="tablist"
      aria-label="Lane switcher"
      onKeyDown={onKeyDown}
    >
      <For each={LANES}>
        {(lane) => (
          <button
            type="button"
            role="tab"
            class="lane-switch-tab"
            data-lane={lane}
            id={`lane-tab-${lane}`}
            aria-controls="lane-stage"
            aria-selected={activeLane() === lane}
            tabindex={activeLane() === lane ? 0 : -1}
            data-help="stage.switcher"
            onClick={() => select(lane)}
          >
            {LANE_NAMES[lane]}
          </button>
        )}
      </For>
    </div>
  );
}

export default function StageFloor() {
  // HU-2 empty-project hint: pure predicate over the document — true while
  // every lane is silent and untouched, gone on the first edit by
  // construction (no hidden flags). A subtle in-world note, never a modal.
  const [empty, setEmpty] = createSignal(
    isProjectEmpty(docStore.getState().doc),
  );
  // T10 (route.md playback-reactivity #8): the DEPTH-BAND density wash —
  // the stage's ambient illumination band, derived from the SAME document
  // subscription (no new seam, no rAF; the attribute write fires only when
  // the quantized BAND changes, i.e. at document-commit boundaries).
  const [density, setDensity] = createSignal(
    densityBand(docStore.getState().doc),
  );
  onMount(() => {
    const unsubscribeDoc = docStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      setEmpty(isProjectEmpty(state.doc));
      setDensity(densityBand(state.doc));
    });
    onCleanup(unsubscribeDoc);
  });
  onMount(() => {
    const disconnect = connectStoreToEngine();
    onCleanup(disconnect);
  });

  /** The E1 announcement region — fresh node per branch (Solid DOM nodes
   * mount in exactly one place; the Show branches swap, never share). */
  const statusRegion = () => (
    <div
      class="head-sr stage-status"
      role="status"
      aria-live="polite"
      aria-label="Stage announcements"
    >
      {stageStatus()}
    </div>
  );

  return (
    <Show
      when={stageMode() === "phone"}
      fallback={
        <div
          class="stage-floors"
          data-view={viewMode()}
          data-density={density()}
          aria-label="Lane quadrants"
        >
          {LANES.map((lane) => (
            <LaneGrid lane={lane} />
          ))}
          {empty() && (
            <div class="stage-hint" role="note" aria-label="Empty project hint">
              {EMPTY_HINT_LABEL}
            </div>
          )}
          {/* LY-1 E1: the stage-level announcement region — edit-target
              changes (`NOW EDITING <LANE>`), solo changes, and HP-1's
              help-mode toggle announcements (`INFO MODE ON …` / `INFO MODE
              OFF`). */}
          {statusRegion()}
        </div>
      }
    >
      {/* MB-1 phone stage: ONE lane (the selection), keyed so lane switches
          remount the grid surface; the switcher lives in the sticky chrome
          (App shell). No view-only quadrants render — no traps by
          construction. */}
      <div
        class="stage-floors stage-floors-phone"
        data-view={viewMode()}
        data-density={density()}
        role="tabpanel"
        id="lane-stage"
        aria-label="Lane stage"
      >
        <Show when={activeLane()} keyed>
          {(lane: LaneId) => <LaneGrid lane={lane} />}
        </Show>
        {empty() && (
          <div class="stage-hint" role="note" aria-label="Empty project hint">
            {EMPTY_HINT_LABEL}
          </div>
        )}
        {statusRegion()}
      </div>
    </Show>
  );
}
