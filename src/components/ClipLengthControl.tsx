import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { LaneId } from "../document/schema";
import { docStore, resizePattern, doublePattern } from "../state/store";
import { announceStage, currentPatternFor } from "../state/selection";
import { barOfStep, resizeRowLabel } from "../state/patternRail";
import "../styles/clip-length.css";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "clip.double",
    title: "DOUBLE PATTERN",
    text: "Double ×2 makes the current pattern twice as long and repeats all of its notes into the new half. A three-bar pattern becomes six bars. It changes this pattern rather than creating another arrangement block. One Undo restores the original. Patterns cannot exceed 128 bars.",
  },
  {
    id: "clip.length",
    title: "CLIP LENGTH",
    text: "Choose the number of bars in this clip without leaving the instrument. Type any whole number from 1 to 128, or use minus and plus to change one bar at a time. Shortening hides later notes and retains them for manual growth. Notes anchored before the new end keep their full lengths. Double repeats visible notes and replaces hidden content. Undo restores the previous pattern.",
  },
]);

export default function ClipLengthControl(props: { lane: LaneId }) {
  let disclosure!: HTMLDetailsElement;
  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!disclosure.contains(event.target as Node)) disclosure.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    onCleanup(() => document.removeEventListener("pointerdown", closeOutside));
  });
  const [doc, setDoc] = createSignal(docStore.getState().doc);
  onCleanup(docStore.subscribe((state) => setDoc(state.doc)));
  const pattern = createMemo(() => {
    doc();
    return currentPatternFor(props.lane);
  });
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal("");
  createEffect(() => {
    setDraft(String(pattern()?.bars ?? 1));
    setError("");
  });
  const apply = (bars: number) => {
    const clip = pattern();
    if (!clip) return;
    let message = "";
    if (!Number.isInteger(bars) || bars < 1 || bars > 128) {
      message = "Enter a whole number from 1 to 128 bars.";
    } else {
      const result = resizePattern(props.lane, clip.id, bars);
      if (!result.ok && result.reason === "blocked") {
        message = `${resizeRowLabel(doc(), props.lane, result.blocking.row)} note at bar ${barOfStep(result.blocking.start)} would be cut off. Move or shorten it first.`;
      } else if (result.ok) {
        announceStage(
          `Clip ${clip.name}: ${bars} ${bars === 1 ? "bar" : "bars"}.`,
        );
      }
    }
    setDraft(String(pattern()?.bars ?? 1));
    setError(message);
  };
  return (
    <div class="clip-length-actions">
      <details
        class="clip-length-wrap"
        ref={(element) => {
          disclosure = element;
        }}
        data-help="clip.length"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            disclosure.open = false;
            disclosure.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label="Edit clip length">
          Bars {pattern()?.bars ?? 1}
        </summary>
        <div class="clip-length-panel">
          <div class="clip-length" role="group" aria-label="Clip length">
            <span class="clip-length-label">Bars</span>
            <button
              type="button"
              aria-label="Shorten clip by one bar"
              disabled={(pattern()?.bars ?? 1) <= 1}
              onClick={() => apply((pattern()?.bars ?? 1) - 1)}
            >
              −
            </button>
            <input
              type="number"
              min="1"
              max="128"
              step="1"
              aria-label="Clip length in bars"
              title={`Clip ${pattern()?.name ?? ""}: 1–128 bars`}
              aria-invalid={!!error()}
              aria-describedby={`clip-length-error-${props.lane}`}
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onBlur={() => apply(Number(draft()))}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply(Number(draft()));
                }
                if (event.key === "Escape") {
                  setDraft(String(pattern()?.bars ?? 1));
                  setError("");
                  event.currentTarget.blur();
                  disclosure.open = false;
                  disclosure.querySelector("summary")?.focus();
                }
              }}
            />
            <button
              type="button"
              aria-label="Extend clip by one bar"
              disabled={(pattern()?.bars ?? 1) >= 128}
              onClick={() => apply((pattern()?.bars ?? 1) + 1)}
            >
              +
            </button>
          </div>
          <span
            id={`clip-length-error-${props.lane}`}
            class="clip-length-error"
            role="status"
          >
            <Show when={error()}>{error()}</Show>
          </span>
        </div>
      </details>
      <button
        type="button"
        class="clip-double"
        data-help="clip.double"
        aria-label="Double pattern length and repeat notes"
        disabled={(pattern()?.bars ?? 128) > 64}
        title={
          (pattern()?.bars ?? 128) > 64
            ? "Doubling would exceed the 128-bar limit."
            : "Double the length and repeat every note. Undo restores the original."
        }
        onClick={() => {
          const clip = pattern();
          if (clip && doublePattern(props.lane, clip.id))
            announceStage(
              `Pattern ${clip.name} doubled to ${clip.bars * 2} bars.`,
            );
        }}
      >
        Double ×2
      </button>
    </div>
  );
}
