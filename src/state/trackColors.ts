import { createSignal } from "solid-js";
import { ALL_LANE_IDS as LANE_IDS, type LaneId } from "../document/schema";
import { theme } from "./theme";

export const TRACK_COLORS_KEY = "bitbounce.track-colors.v1";
export type TrackColors = Partial<Record<LaneId, string>>;
const defaults = {
  dark: {
    drums: "#dfaaa1",
    bass: "#c4d49e",
    chords: "#93cfc7",
    lead: "#aabbe7",
    extra1: "#d6b4df",
    extra2: "#e0c090",
    extra3: "#a4cbd8",
    extra4: "#c8cca0",
  },
  light: {
    drums: "#bb3055",
    bass: "#886000",
    chords: "#007967",
    lead: "#4f48bd",
    extra1: "#864695",
    extra2: "#876017",
    extra3: "#246f87",
    extra4: "#667326",
  },
};
export function parseTrackColors(raw: string | null): TrackColors {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: TrackColors = {};
    for (const id of LANE_IDS) {
      const color = (value as Record<string, unknown>)[id];
      if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
        result[id] = color.toLowerCase();
    }
    return result;
  } catch {
    return {};
  }
}
function load(): TrackColors {
  try {
    return parseTrackColors(localStorage.getItem(TRACK_COLORS_KEY));
  } catch {
    return {};
  }
}
export function colorInk(color: string): string {
  const channels = [1, 3, 5].map((start) => {
    const c = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
const [trackColors, update] = createSignal<TrackColors>(load());
export { trackColors };
export const trackColor = (id: LaneId): string =>
  trackColors()[id] ?? defaults[theme()][id];
function apply(colors: TrackColors): void {
  if (typeof document === "undefined" || !document.documentElement?.style)
    return;
  for (const id of LANE_IDS) {
    const root = document.documentElement.style;
    const color = colors[id];
    if (color) {
      root.setProperty(`--color-lane-${id}`, color);
      root.setProperty(`--color-lane-${id}-ink`, colorInk(color));
    } else {
      root.removeProperty(`--color-lane-${id}`);
      root.removeProperty(`--color-lane-${id}-ink`);
    }
  }
}
export function setTrackColor(id: LaneId, color: string | null): void {
  if (
    !LANE_IDS.includes(id) ||
    (color !== null && !/^#[0-9a-f]{6}$/i.test(color))
  )
    return;
  const next = { ...trackColors() };
  if (color === null) delete next[id];
  else next[id] = color.toLowerCase();
  apply(next);
  update(next);
  try {
    localStorage.setItem(TRACK_COLORS_KEY, JSON.stringify(next));
  } catch {
    /* Appearance still works for this session without storage. */
  }
}
apply(trackColors());
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
)
  window.addEventListener("storage", (event) => {
    if (event.key !== TRACK_COLORS_KEY && event.key !== null) return;
    const next = parseTrackColors(event.newValue);
    apply(next);
    update(next);
  });
