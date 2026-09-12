import { For, createSignal, createUniqueId } from "solid-js";
import type { LaneId } from "../document/schema";
import { setTrackColor, trackColor } from "../state/trackColors";
import {
  TRACK_COLOR_SHADES,
  TRACK_COLOR_SWATCHES,
} from "../state/trackColorSwatches";
import "../styles/track-colors.css";
import { registerHelp } from "../help/registry";

registerHelp([
  {
    id: "appearance.track",
    title: "TRACK COLOR",
    text: "Choose a color for this instrument's notes, title, activity meter, and visualizer. The palette offers shades of each color. Reset restores the instrument's default color.",
  },
]);

export default function TrackColorControl(props: { lane: LaneId }) {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let panel!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  const choose = (color: string | null) => {
    setTrackColor(props.lane, color);
    panel.hidePopover();
    trigger.focus();
  };
  const toggle = () => {
    if (open()) {
      panel.hidePopover();
      return;
    }
    panel.showPopover();
    const rect = trigger.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - panel.offsetHeight - 12))}px`;
    (
      panel.querySelector<HTMLButtonElement>(
        '[data-swatch][aria-pressed="true"]',
      ) ?? panel.querySelector<HTMLButtonElement>("[data-swatch]")
    )?.focus();
  };
  return (
    <div class="track-color-control" data-help="appearance.track">
      <button
        ref={(el) => (trigger = el)}
        type="button"
        class="track-color-trigger"
        aria-label={`${props.lane} track color`}
        aria-expanded={open()}
        aria-controls={id}
        onClick={toggle}
      >
        <span>Color</span>
        <i style={{ background: trackColor(props.lane) }} aria-hidden="true" />
      </button>
      <div
        ref={(el) => (panel = el)}
        id={id}
        popover="auto"
        class="track-swatch-panel"
        role="dialog"
        aria-label={`${props.lane} color palette`}
        onToggle={() => setOpen(panel.matches(":popover-open"))}
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLButtonElement) ||
            !event.target.hasAttribute("data-swatch")
          )
            return;
          const delta = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -3,
            ArrowDown: 3,
          }[event.key];
          if (delta === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = [
            ...panel.querySelectorAll<HTMLButtonElement>("[data-swatch]"),
          ];
          buttons[
            Math.max(
              0,
              Math.min(
                buttons.length - 1,
                buttons.indexOf(event.target) + delta,
              ),
            )
          ]?.focus();
        }}
      >
        <div class="swatch-heading">
          <strong>{props.lane} color</strong>
          <button
            type="button"
            aria-label={`Close ${props.lane} color palette`}
            onClick={() => {
              panel.hidePopover();
              trigger.focus();
            }}
          >
            Close
          </button>
        </div>
        <div class="swatch-columns" aria-hidden="true">
          <span></span>
          <For each={TRACK_COLOR_SHADES}>{(shade) => <span>{shade}</span>}</For>
        </div>
        <For each={TRACK_COLOR_SWATCHES}>
          {(family) => (
            <div class="swatch-row">
              <span>{family.name}</span>
              <For each={family.colors}>
                {(color, index) => (
                  <button
                    type="button"
                    data-swatch
                    aria-label={`${TRACK_COLOR_SHADES[index()]} ${family.name.toLowerCase()}`}
                    aria-pressed={trackColor(props.lane) === color}
                    style={{ "--swatch": color }}
                    onClick={() => choose(color)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m5 10 3 3 7-7" />
                    </svg>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
        <button
          type="button"
          class="swatch-reset"
          aria-label={`Reset ${props.lane} track color`}
          onClick={() => choose(null)}
        >
          Use theme default
        </button>
        <p>Applies to this track and its visualizer.</p>
      </div>
    </div>
  );
}
