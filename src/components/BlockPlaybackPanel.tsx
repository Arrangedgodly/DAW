import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { LaneId, PlaybackRule } from "../document/schema";
import {
  docStore,
  doublePattern,
  insertPatternBlock,
  setPlaybackRule,
} from "../state/store";
import { copyPattern, patternClipboard } from "../state/patternClipboard";
import { announceStage, selectPattern } from "../state/selection";
import { createLaneDisplayNames } from "../state/laneDisplayNames";
import PatternMidiExport from "./PatternMidiExport";

export function playbackSummary(
  rule: PlaybackRule | null | undefined,
  bars: number,
  loop = false,
): string {
  if (rule?.unit === "hold" || (!rule && loop)) return "Until triggered";
  const count = rule?.amount ?? bars;
  const unit = rule?.unit === "repeats" ? "repeat" : "bar";
  const duration = `${count} ${unit}${count === 1 ? "" : "s"}`;
  const action = rule?.action ?? "next";
  const destination =
    action === "goto"
      ? `Block ${(rule?.target ?? 0) + 1}`
      : {
          next: "Next",
          previous: "Previous",
          random: "Random other",
          stop: "Stop lane",
          return: "Return",
        }[action];
  return `${duration} → ${destination}`;
}

export default function BlockPlaybackPanel(props: {
  lane: LaneId;
  slot: number;
  onClose: () => void;
}) {
  const displayName = createLaneDisplayNames();
  const [doc, setDoc] = createSignal(docStore.getState().doc);
  onCleanup(docStore.subscribe((s) => setDoc(s.doc)));
  const pattern = () =>
    doc().patterns[props.lane]?.find(
      (p) => p.id === doc().songChain[props.lane]?.[props.slot],
    );
  const initial = doc().playbackRules?.[props.lane]?.[props.slot];
  const [unit, setUnit] = createSignal<PlaybackRule["unit"]>(
    initial?.unit ??
      (doc().chainModes?.[props.lane]?.[props.slot] === "loop"
        ? "hold"
        : "repeats"),
  );
  const [amount, setAmount] = createSignal(String(initial?.amount ?? 1));
  const [action, setAction] = createSignal<PlaybackRule["action"]>(
    initial?.action ?? "next",
  );
  const [target, setTarget] = createSignal(initial?.target ?? 0);
  const [choices, setChoices] = createSignal<number[]>(initial?.choices ?? []);
  const [message, setMessage] = createSignal("");
  let panel!: HTMLDivElement;
  onMount(() => panel.querySelector<HTMLButtonElement>("button")?.focus());
  const copy = () => {
    const source = pattern();
    if (!source) return;
    copyPattern(props.lane, source);
    setMessage(
      `Copied ${source.name}. Choose another block and paste after it, or use Paste at the end of a lane.`,
    );
  };
  const insert = (kind: "duplicate" | "paste" | "reuse") => {
    const source = kind === "paste" ? patternClipboard()?.pattern : pattern();
    if (!source) return;
    const id = insertPatternBlock(
      props.lane,
      source,
      props.slot,
      kind === "reuse",
    );
    selectPattern(props.lane, id, props.slot + 1);
    announceStage(
      `Inserted ${kind === "reuse" ? "shared pattern" : "independent copy"} in block ${props.slot + 2}.`,
    );
    props.onClose();
  };
  const apply = () => {
    const value = unit() === "hold" ? 1 : Number(amount());
    if (!Number.isInteger(value) || value < 1 || value > 128) {
      setMessage("Enter a whole number from 1 to 128.");
      return;
    }
    const rule: PlaybackRule = {
      unit: unit(),
      amount: value,
      action: action(),
      ...(action() === "goto" ? { target: target() } : {}),
      ...(action() === "random" ? { choices: choices() } : {}),
    };
    setPlaybackRule(props.lane, props.slot, rule);
    announceStage(
      `Block ${props.slot + 1}: ${playbackSummary(rule, pattern()?.bars ?? 1)}.`,
    );
    props.onClose();
  };
  return (
    <Portal mount={document.querySelector(".app") ?? document.body}>
      <div
        ref={(element) => {
          panel = element;
        }}
        class="block-playback-panel"
        role="dialog"
        aria-modal="false"
        aria-label={`Playback for block ${props.slot + 1}`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") props.onClose();
        }}
      >
        <div class="block-panel-heading">
          <h2>
            {displayName(props.lane)} · Block {props.slot + 1}
          </h2>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <p>
          Pattern {pattern()?.name} · {pattern()?.bars} bars
        </p>
        <div class="block-edit-actions">
          <PatternMidiExport
            lane={props.lane}
            patternId={pattern()?.id ?? ""}
          />
          <button type="button" onClick={copy}>
            Copy
          </button>
          <button
            type="button"
            disabled={
              !patternClipboard() || patternClipboard()?.lane !== props.lane
            }
            onClick={() => insert("paste")}
          >
            Paste after
          </button>
          <button type="button" onClick={() => insert("duplicate")}>
            Duplicate block
          </button>
          <button type="button" onClick={() => insert("reuse")}>
            Reuse pattern
          </button>
          <button
            type="button"
            disabled={(pattern()?.bars ?? 128) > 64}
            title={
              (pattern()?.bars ?? 128) > 64
                ? "Doubling would exceed 128 bars."
                : "Double the length and repeat every note."
            }
            onClick={() => {
              const p = pattern();
              if (p && doublePattern(props.lane, p.id))
                setMessage(`Pattern doubled to ${p.bars * 2} bars.`);
            }}
          >
            Double ×2
          </button>
        </div>
        <p class="block-panel-hint">
          Copies can be edited independently. Reuse shares notes between blocks.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label>
            Play for
            <select
              value={unit()}
              onChange={(e) =>
                setUnit(e.currentTarget.value as PlaybackRule["unit"])
              }
            >
              <option value="bars">Bars</option>
              <option value="repeats">Pattern repeats</option>
              <option value="hold">Until triggered</option>
            </select>
          </label>
          <Show when={unit() !== "hold"}>
            <label>
              {unit() === "bars" ? "Number of bars" : "Number of repeats"}
              <input
                type="number"
                min="1"
                max="128"
                step="1"
                required
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
              />
            </label>
            <label>
              Then
              <select
                value={action()}
                onChange={(e) =>
                  setAction(e.currentTarget.value as PlaybackRule["action"])
                }
              >
                <option value="next">Next block</option>
                <option value="previous">Previous block</option>
                <option value="goto">Go to block</option>
                <option value="random">Random other block</option>
                <option value="return">Return to previous playing block</option>
                <option value="stop">Stop lane</option>
              </select>
            </label>
            <Show when={action() === "goto"}>
              <label>
                Destination
                <select
                  value={target()}
                  onChange={(e) => setTarget(Number(e.currentTarget.value))}
                >
                  <For each={doc().songChain[props.lane]}>
                    {(id, i) => (
                      <option value={i()}>
                        Block {i() + 1} ·{" "}
                        {
                          doc().patterns[props.lane]?.find((p) => p.id === id)
                            ?.name
                        }
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </Show>
            <Show when={action() === "random"}>
              <fieldset>
                <legend>
                  Choose alternatives, or leave all unchecked for any other
                  block
                </legend>
                <For each={doc().songChain[props.lane]}>
                  {(id, i) => (
                    <Show when={i() !== props.slot}>
                      <label class="block-choice">
                        <input
                          type="checkbox"
                          checked={choices().includes(i())}
                          onChange={(e) =>
                            setChoices(
                              e.currentTarget.checked
                                ? [...choices(), i()]
                                : choices().filter((n) => n !== i()),
                            )
                          }
                        />
                        Block {i() + 1} ·{" "}
                        {
                          doc().patterns[props.lane]?.find((p) => p.id === id)
                            ?.name
                        }
                      </label>
                    </Show>
                  )}
                </For>
              </fieldset>
            </Show>
            <p class="block-panel-hint">
              Bars use the exact duration, even if the last repeat is partial.
              Return plays a fill and goes back to the block that led here.
            </p>
          </Show>
          <button type="submit">Apply playback</button>
        </form>
        <p role="status">{message()}</p>
      </div>
    </Portal>
  );
}
