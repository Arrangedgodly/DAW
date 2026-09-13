import { createSignal } from "solid-js";
import type { LaneId, Pattern } from "../document/schema";

// An app-local snapshot remains usable after editing or deleting its source.
export const [patternClipboard, setPatternClipboard] = createSignal<{
  lane: LaneId;
  pattern: Pattern;
} | null>(null);
export function copyPattern(lane: LaneId, pattern: Pattern): void {
  setPatternClipboard({
    lane,
    pattern: JSON.parse(JSON.stringify(pattern)) as Pattern,
  });
}
