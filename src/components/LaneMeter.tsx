/**
 * LaneMeter — the per-lane CHANNEL METER (THE FULL UNIT, live-signal pass):
 * a segmented signal line along each quadrant's leading edge that jumps on every
 * AUDIBLE note-on of its lane (level from the delivered voice level + chord
 * density) and falls back segment by segment. Driven entirely by the meter
 * bus (state/meterBus.ts) through Web Animations — zero DOM writes, zero
 * layout px (absolute inside the floor), aria-hidden
 * decoration (the lane's sound state lives in the grid, the rim pulse and
 * the mixer keys).
 */

import { onCleanup, onMount } from "solid-js";
import type { LaneId } from "../document/schema";
import { registerMeter } from "../state/meterBus";

export default function LaneMeter(props: { readonly lane: LaneId }) {
  let lit: HTMLSpanElement | undefined;
  onMount(() => {
    if (!lit) return;
    onCleanup(registerMeter(props.lane, lit, "x"));
  });
  return (
    <span class="lane-meter" aria-hidden="true">
      <span class="lane-meter-lit" ref={(el) => (lit = el)} />
    </span>
  );
}
