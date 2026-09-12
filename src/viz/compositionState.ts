import { createSignal } from "solid-js";
import { defaultVizPrefsStorage, type VizPrefsStorage } from "./persist";
import {
  COMPOSITION_KEY,
  defaultComposition,
  parseComposition,
  type VisualComposition,
} from "./composition";

const [composition, setComposition] = createSignal(defaultComposition());
let restored = false;
export { composition };
export function restoreComposition(
  storage: VizPrefsStorage | null = defaultVizPrefsStorage(),
): void {
  if (restored) return;
  restored = true;
  try {
    setComposition(
      parseComposition(storage?.getItem(COMPOSITION_KEY) ?? null) ??
        defaultComposition(),
    );
  } catch {
    /* Keep the session usable when storage is unavailable. */
  }
}
/** Pointer moves update session state; pointer release writes once. */
export function changeComposition(
  next: VisualComposition,
  persist = true,
  storage: VizPrefsStorage | null = defaultVizPrefsStorage(),
): void {
  setComposition(next);
  if (persist)
    try {
      storage?.setItem(COMPOSITION_KEY, JSON.stringify(next));
    } catch {
      /* Session state outranks a failed storage write. */
    }
}
export function resetCompositionForTests(): void {
  restored = false;
  setComposition(defaultComposition());
}
