/**
 * ScalePopover (DES-3): the one shared scale picker behind every scale chip.
 * Lane mode offers the explicit override semantics — pick root + mode, then
 * one action commits ("OVERRIDE LANE" / "USE PROJECT SCALE"); project mode
 * (booth chip) is a plain "SET PROJECT SCALE" with no override options.
 *
 * Keyboard contract (DA law, ahead of DA-1): Esc closes, Tab is trapped
 * inside the popover while open, focus lands on the first control on open
 * and returns to the anchoring chip on close.
 */

import { For, onCleanup, onMount, type JSX } from "solid-js";
import { type LaneId } from "../document/schema";
import { type ModeName } from "../document/scales";
import {
  MODE_LIST,
  MODE_LONG,
  applyLaneOverride,
  applyProjectScale,
  returnToProjectScale,
  rootName,
  type ScaleStoreSeam,
} from "../state/scaleChip";
import { registerHelp } from "../help/registry";

/**
 * HP-2 help entries for the popover's internals (HP-1 deliberately deferred
 * them here — the plan's coverage list owns "scale popover"; I2-6 colocated
 * law unchanged). Root/mode are registered on their GROUP containers (the
 * booth-stepper pattern): one explanation per concept, every button inside
 * resolves through `closest("[data-help]")`.
 */
registerHelp([
  {
    id: "scale.root",
    title: "ROOT",
    text: "The note the scale starts from. Pick any of the twelve — same mode on a new root is the easiest way to change a song's mood without changing a single note.",
  },
  {
    id: "scale.mode",
    title: "MODE",
    text: "The scale's flavor: the step pattern that makes major bright and minor dark. The pentatonic modes offer fewer rows — every note they leave you is a safe one.",
  },
  {
    id: "scale.apply",
    title: "APPLY SCALE",
    text: "Applies the root and mode picked above. From a lane chip this becomes that lane's own scale (an override); from the booth it sets the scale every lane follows.",
  },
  {
    id: "scale.detach",
    title: "USE PROJECT SCALE",
    text: "Puts this lane back on the project scale — one press and the override is gone. Notes keep their scale positions and simply sound in the scale they now share.",
  },
]);

export type ScaleAppliedFn = (root: number, mode: ModeName) => void;

export interface ScalePopoverProps {
  /** Lane mode shows override semantics; project mode is a plain setter. */
  readonly variant: "lane" | "project";
  readonly lane?: LaneId;
  /** Effective scale the popover opens on (root + mode preselected). */
  readonly initialRoot: number;
  readonly initialMode: ModeName;
  /** True when the lane currently has an override (drives the return action). */
  readonly overridden: boolean;
  readonly store: ScaleStoreSeam;
  /** Fires after ANY commit that changes the effective scale (aria-live etc). */
  readonly onApplied?: ScaleAppliedFn;
  readonly onClose: () => void;
}

export default function ScalePopover(props: ScalePopoverProps): JSX.Element {
  let panel: HTMLDivElement | undefined;

  // Local selection state (ephemeral — never the document store, D1 law).
  const sel = { root: props.initialRoot, mode: props.initialMode };

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
  }

  onMount(() => {
    focusables()[0]?.focus();
    const onDocKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onDocKeydown, true);
    onCleanup(() =>
      document.removeEventListener("keydown", onDocKeydown, true),
    );
  });

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    // Focus trap: Tab cycles within the popover while it is open.
    const items = focusables();
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey
      ? items[(idx - 1 + items.length) % items.length]
      : items[(idx + 1) % items.length];
    next.focus();
  };

  const pickRoot = (pc: number) => {
    sel.root = pc;
    // Re-render selection purely through DOM state (no reactive machinery).
    if (panel) {
      for (const btn of panel.querySelectorAll<HTMLButtonElement>(
        "[data-root]",
      )) {
        btn.setAttribute(
          "aria-pressed",
          String(Number(btn.dataset.root) === pc),
        );
      }
    }
  };

  const pickMode = (mode: ModeName) => {
    sel.mode = mode;
    if (panel) {
      for (const btn of panel.querySelectorAll<HTMLButtonElement>(
        "[data-mode]",
      )) {
        btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
      }
    }
  };

  const commit = () => {
    if (props.variant === "project") {
      applyProjectScale(props.store, sel.root, sel.mode);
    } else {
      applyLaneOverride(props.store, props.lane!, sel.root, sel.mode);
    }
    props.onApplied?.(sel.root, sel.mode);
    props.onClose();
  };

  const detach = () => {
    returnToProjectScale(props.store, props.lane!);
    props.onApplied?.(props.initialRoot, props.initialMode);
    props.onClose();
  };

  return (
    <div
      ref={(el) => {
        panel = el;
      }}
      class="scale-pop"
      role="dialog"
      aria-modal="false"
      aria-label="Scale selector"
      onKeyDown={handleKeydown}
    >
      <div
        class="scale-pop-group"
        role="group"
        aria-label="Root note"
        data-help="scale.root"
      >
        <span class="scale-pop-heading" aria-hidden="true">
          ROOT
        </span>
        <div class="scale-pop-roots">
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}>
            {(pc) => (
              <button
                type="button"
                class="scale-pop-root"
                data-root={pc}
                aria-pressed={pc === props.initialRoot ? "true" : "false"}
                onClick={() => pickRoot(pc)}
              >
                {rootName(pc)}
              </button>
            )}
          </For>
        </div>
      </div>

      <div
        class="scale-pop-group"
        role="group"
        aria-label="Mode"
        data-help="scale.mode"
      >
        <span class="scale-pop-heading" aria-hidden="true">
          MODE
        </span>
        {/* DA-2: modes are toggle buttons, not a listbox — role=option on a
            <button> is contradictory semantics (axe: nested-interactive risk)
            and there is no listbox arrow-key machinery to back it. The
            aria-pressed toggle pair (root/mode) is the honest contract. */}
        <div class="scale-pop-modes">
          <For each={MODE_LIST}>
            {(mode) => (
              <button
                type="button"
                class="scale-pop-mode"
                data-mode={mode}
                aria-pressed={mode === props.initialMode ? "true" : "false"}
                onClick={() => pickMode(mode)}
              >
                {MODE_LONG[mode]}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="scale-pop-actions">
        <button
          type="button"
          class="scale-pop-commit"
          data-help="scale.apply"
          onClick={commit}
        >
          {props.variant === "project" ? "SET PROJECT SCALE" : "OVERRIDE LANE"}
        </button>
        {props.variant === "lane" && (
          <button
            type="button"
            class="scale-pop-detach"
            data-help="scale.detach"
            aria-disabled={props.overridden ? "false" : "true"}
            classList={{ "is-dim": !props.overridden }}
            onClick={() => {
              if (!props.overridden) {
                // Already following the project scale — nothing to detach.
                props.onClose();
                return;
              }
              detach();
            }}
          >
            USE PROJECT SCALE
          </button>
        )}
      </div>
    </div>
  );
}
