import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { addInstrumentLane, docStore } from "../state/store";
import {
  activeLane,
  selectLane,
  selectPattern,
  stageStatus,
  viewMode,
} from "../state/selection";
import { EXTRA_LANE_IDS, isDefaultLane } from "../document/schema";
import LaneGrid from "./LaneGrid";
import "../styles/instruments.css";

type ExtraSlot = (typeof EXTRA_LANE_IDS)[number];
const trackNumber = (slot: ExtraSlot) => Number(slot.slice(-1)) + 4;

export default function InstrumentsPage() {
  const [lanes, setLanes] = createSignal(docStore.getState().doc.lanes);
  onCleanup(docStore.subscribe((s) => setLanes(s.doc.lanes)));
  const exists = (slot: ExtraSlot) => lanes().some((lane) => lane.id === slot);
  createEffect(() => {
    const active = activeLane();
    if (isDefaultLane(active) || !lanes().some((l) => l.id === active)) {
      const first = EXTRA_LANE_IDS.find(exists);
      if (first) selectLane(first);
      else if (!isDefaultLane(active)) selectLane("drums");
    }
  });
  const add = (slot: ExtraSlot) => {
    const id = addInstrumentLane("preset-bells-crystal", slot);
    if (!id) return;
    selectPattern(id, `${id}-1`, 0);
    selectLane(id);
    queueMicrotask(() =>
      document
        .querySelector<HTMLSelectElement>(
          `.instruments-page [data-lane="${slot}"] .head-sound-select`,
        )
        ?.focus(),
    );
  };
  const Slot = (props: { slot: ExtraSlot }) => (
    <Show
      when={exists(props.slot)}
      fallback={
        <section
          class="lane-floor instrument-empty"
          data-lane={props.slot}
          aria-label={`Empty track ${trackNumber(props.slot)}`}
        >
          <button
            type="button"
            class="instrument-add"
            aria-label={`Add instrument to track ${trackNumber(props.slot)}`}
            onClick={() => add(props.slot)}
          >
            <span class="instrument-slot-name">
              Track {trackNumber(props.slot)}
            </span>
            <span class="instrument-add-symbol" aria-hidden="true">
              +
            </span>
            <span>Add instrument</span>
          </button>
        </section>
      }
    >
      <LaneGrid lane={props.slot} />
    </Show>
  );
  return (
    <main class="stage instruments-page" aria-label="Extra instruments">
      <div
        class="stage-floors"
        data-view={viewMode()}
        aria-label="Extra instrument quadrants"
      >
        <For each={EXTRA_LANE_IDS}>{(slot) => <Slot slot={slot} />}</For>
        <div class="head-sr" role="status" aria-live="polite">
          {stageStatus()}
        </div>
      </div>
    </main>
  );
}
