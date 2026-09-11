/**
 * ModeIcon — the ⟲ LOOP / → NEXT slot-follow glyph (2026-09-11), drawn as
 * SVG so it renders identically on every platform font (the ⟲ codepoint is
 * missing from the UI faces). 1em square, currentColor stroke; decorative —
 * the owning control carries the text equivalent.
 */

import { Show, type JSX } from "solid-js";

export default function ModeIcon(props: { mode: "loop" | "next" }): JSX.Element {
  return (
    <svg
      class="mode-icon"
      data-mode={props.mode}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <Show
        when={props.mode === "loop"}
        fallback={<path d="M2 8h11M9 4l4 4-4 4" />}
      >
        <path d="M13 8.5A5 5 0 1 1 11.2 4.2" />
        <path d="M12.5 1.5v3.5H9" />
      </Show>
    </svg>
  );
}
