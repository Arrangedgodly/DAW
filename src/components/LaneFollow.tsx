/**
 * LaneFollow — the lane section's ⟲/→ footer (2026-09-11, user call: "icons
 * on the bottom of the section"). Names the slot this lane is ON — the slot
 * sounding while playing (the shared sounding follow, frozen mid-gesture per
 * TH-4(b)), else the slot of the pattern selected for editing — and what it
 * does when it ends: ⟲ LOOP replays it until another slot is cued, → NEXT
 * plays it once and moves on. The key flips that slot's mode (one undo
 * step); the engine applies it at the slot's next end.
 */

import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { LaneId } from "../document/schema";
import { registerHelp } from "../help/registry";
import { currentPatternFor, getActiveSlot } from "../state/selection";
import {
  mountSoundingFollow,
  sounding,
  soundingSlot,
} from "../state/soundingFollow";
import { docStore, toggleChainSlotMode } from "../state/store";
import { LANE_NAMES } from "./laneMeta";
import ModeIcon from "./ModeIcon";
import { getSession } from "../engine/session";

registerHelp([
  {
    id: "lane.follow",
    title: "LOOP / NEXT",
    text: "What this lane does when its current pattern ends. ⟲ LOOP keeps repeating it until you pick another tile in the song chain; → NEXT plays it once and moves on to the next tile (the last tile goes back to the first). Click to flip it. Every tile in the chain carries its own arrow — M on a focused tile flips it too.",
  },
]);

export default function LaneFollow(props: { lane: LaneId }): JSX.Element {
  const session = getSession();
  const [playing, setPlaying] = createSignal(
    session.transport.snapshot.playing,
  );
  const [doc, setDoc] = createSignal(docStore.getState().doc);
  onMount(() => {
    const unsubscribe = docStore.subscribe((state) => setDoc(state.doc));
    const release = mountSoundingFollow();
    const stopTransport = session.subscribe((snapshot) =>
      setPlaying(snapshot.playing),
    );
    onCleanup(() => {
      unsubscribe();
      release();
      stopTransport();
    });
  });

  const slot = createMemo(() => {
    const chain = doc().songChain[props.lane];
    const addressedSlot = playing()
      ? soundingSlot()[props.lane]
      : getActiveSlot(props.lane);
    if (addressedSlot != null && chain[addressedSlot] !== undefined)
      return addressedSlot;
    const id =
      (playing()
        ? sounding()[props.lane]
        : currentPatternFor(props.lane)?.id) ?? chain[0];
    const index = chain.indexOf(id ?? "");
    return index >= 0 ? index : 0;
  });
  const mode = () => doc().chainModes?.[props.lane]?.[slot()] ?? "next";
  const name = () => {
    const d = doc();
    const id = d.songChain[props.lane][slot()];
    return d.patterns[props.lane].find((p) => p.id === id)?.name ?? "?";
  };

  return (
    <div class="lane-follow" data-mode={mode()}>
      <button
        type="button"
        class="lane-follow-btn"
        data-help="lane.follow"
        aria-pressed={mode() === "loop"}
        aria-label={`${LANE_NAMES[props.lane]} slot ${slot() + 1}, pattern ${name()}: ${mode() === "loop" ? "loops" : "plays once, then next"}`}
        onClick={() => toggleChainSlotMode(props.lane, slot())}
      >
        <ModeIcon mode={mode()} />
        <span class="lane-follow-mode">
          {mode() === "loop" ? "LOOP" : "NEXT"}
        </span>
      </button>
      <span class="lane-follow-slot" aria-hidden="true">
        SLOT {slot() + 1} · {name()}
      </span>
    </div>
  );
}
