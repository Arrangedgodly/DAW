/**
 * FxStrip (DES-5): the lit console strip opened from the lane header's FX
 * entry. One lit module per device in the lane's chain — reorderable (drag
 * AND keyboard move buttons), bypassable (lit/dimmed), removable — plus an
 * add-device menu capped at MAX_FX_PER_LANE.
 *
 * Vocabulary mapping (schema is authority for names): FILTER kind LP/HP/BP ·
 * cutoff Hz · Q — DRIVE amount % — CRUSH bits · decimation — DELAY sync unit
 * (1/8 · 1/8. · 1/4 · 1/2 → 16th steps) · feedback % · mix % — REVERB size
 * (readout in seconds via reverbSeconds) · mix %.
 *
 * Every param is a native range input / select (free a11y: arrow keys,
 * aria-valuetext carries the unit-formatted value) with a live --font-value
 * numeric readout (the variable-font-specimen raise). All writes go through
 * the store's FX actions; engineBridge pushes them to the session on the same
 * commit, so tweaks are audible immediately while looping (IM-4) and param
 * drags never touch the render loop (D1/Thor — the only DOM writes are the
 * readout spans Solid already owns).
 *
 * Glow law (D9): lane-hue border + fill tint code active/bypassed; the one
 * ≤180 ms one-shot flash on module add is decoration layered on top and is
 * suppressed under prefers-reduced-motion (matchMedia AND CSS).
 */

import {
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { type LaneId } from "../document/schema";
import {
  addFxDevice,
  docStore,
  moveFxDevice,
  removeFxDevice,
  setFxBypassed,
  setFxParam,
} from "../state/store";
import {
  type FxChoiceSpec,
  type FxModule,
  type FxSliderSpec,
  FX_DEVICE_SPECS,
  FX_DEVICE_TYPES,
  canMoveFx,
  formatFxParam,
  fxChainFull,
  fxModuleList,
  laneFxChain,
  paramToSlider,
  sliderToParam,
} from "../state/fxStrip";
import { LANE_NAMES } from "./laneMeta";

const FLASH_MS = 180; // D9 one-shot cap

interface DragState {
  from: number;
}

function readChain(lane: LaneId) {
  return laneFxChain(docStore.getState().doc, lane);
}

export default function FxStrip(props: { lane: LaneId }): JSX.Element {
  const [chain, setChain] = createSignal(readChain(props.lane));
  const [flashIndex, setFlashIndex] = createSignal(-1);
  const [addOpen, setAddOpen] = createSignal(false);
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [dropTarget, setDropTarget] = createSignal(-1);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let fxEntry: HTMLButtonElement | undefined;
  let addMenu: HTMLDivElement | undefined;

  // DA-3: the add menu is a role=menu — opening it moves focus to the first
  // item (menu convention), and Escape closes it with focus returned to the
  // + ADD FX entry. Tab still works (items are real buttons in DOM order).
  const openAddMenu = () => {
    setAddOpen(true);
    queueMicrotask(() =>
      addMenu?.querySelector<HTMLButtonElement>(".fx-add-item")?.focus(),
    );
  };
  const closeAddMenu = () => {
    setAddOpen(false);
    fxEntry?.focus();
  };

  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc.lanes === prev.doc.lanes) return;
      setChain(readChain(props.lane));
    });
    onCleanup(unsubscribe);
  });

  onCleanup(() => {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
  });

  const modules = () => fxModuleList(chain());
  const full = () => fxChainFull(chain());

  const reducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const handleAdd = (type: (typeof FX_DEVICE_TYPES)[number]) => {
    setAddOpen(false);
    if (!addFxDevice(props.lane, type)) return;
    if (!reducedMotion()) {
      // One-shot ≤180 ms flash on the module that just appeared.
      setFlashIndex(chain().length - 1);
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setFlashIndex(-1), FLASH_MS);
    }
    fxEntry?.focus();
  };

  const commitMove = (from: number, to: number) => {
    setDropTarget(-1);
    setDrag(null);
    moveFxDevice(props.lane, from, to);
  };

  return (
    <div
      class="fx-strip"
      data-lane={props.lane}
      aria-label={`${LANE_NAMES[props.lane]} FX chain`}
    >
      <div
        class="fx-strip-modules"
        role="list"
        aria-label={`${LANE_NAMES[props.lane]} FX modules`}
      >
        {/* DES-7: Index (position-keyed), not For — modules() mints fresh
            objects on every store commit, so reference-keyed For tore down and
            rebuilt the whole module list (DOM + range inputs) on every param
            drag tick (the DA-3 stale-ref observation). Index patches the
            changed slot's props in place; the slider being dragged is never
            recreated. Reorders swap data across positions without rebuild. */}
        <Index each={modules()}>
          {(mod) => (
            <FxModuleView
              lane={props.lane}
              mod={mod()}
              count={modules().length}
              flash={flashIndex() === mod().index}
              dropping={
                dropTarget() === mod().index &&
                drag() !== null &&
                drag()!.from !== mod().index
              }
              onDragStart={() => setDrag({ from: mod().index })}
              onDragOver={() => {
                if (drag() !== null && dropTarget() !== mod().index)
                  setDropTarget(mod().index);
              }}
              onDrop={() => {
                const d = drag();
                if (d) commitMove(d.from, mod().index);
              }}
              onDragEnd={() => {
                setDrag(null);
                setDropTarget(-1);
              }}
              onMove={(delta) =>
                moveFxDevice(props.lane, mod().index, mod().index + delta)
              }
              onRemove={() => removeFxDevice(props.lane, mod().index)}
            />
          )}
        </Index>
        <Show when={modules().length === 0}>
          <p class="fx-strip-empty">NO DEVICES — ADD ONE BELOW</p>
        </Show>
      </div>

      <div class="fx-strip-footer">
        <Show
          when={!full()}
          fallback={
            <span class="fx-strip-cap">CHAIN FULL — 3 DEVICES MAX</span>
          }
        >
          <button
            type="button"
            ref={(el) => {
              fxEntry = el;
            }}
            class="fx-add-btn"
            aria-haspopup="menu"
            aria-expanded={addOpen()}
            onClick={() => (addOpen() ? closeAddMenu() : openAddMenu())}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!addOpen()) openAddMenu();
              }
            }}
          >
            + ADD FX
          </button>
          <Show when={addOpen()}>
            <div
              ref={(el) => {
                addMenu = el;
              }}
              class="fx-add-menu"
              role="menu"
              aria-label={`Add FX device to ${LANE_NAMES[props.lane]}`}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeAddMenu();
                }
              }}
            >
              <For each={FX_DEVICE_TYPES}>
                {(type) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="fx-add-item"
                    onClick={() => handleAdd(type)}
                  >
                    {FX_DEVICE_SPECS[type].label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One module
// ---------------------------------------------------------------------------

function FxModuleView(props: {
  lane: LaneId;
  mod: FxModule;
  count: number;
  flash: boolean;
  dropping: boolean;
  onDragStart(): void;
  onDragOver(): void;
  onDrop(): void;
  onDragEnd(): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
}): JSX.Element {
  const m = () => props.mod;
  const label = () => m().spec.label;

  return (
    <section
      class="fx-mod"
      classList={{
        "is-bypassed": m().device.bypassed,
        "is-flash": props.flash,
        "is-drop": props.dropping,
      }}
      role="listitem"
      aria-label={`${label()} module ${m().index + 1} of ${props.count}${m().device.bypassed ? ", bypassed" : ""}`}
      draggable={true}
      onDragStart={props.onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
      onDragEnd={props.onDragEnd}
    >
      <header class="fx-mod-head">
        <span class="fx-mod-name" aria-hidden="true">
          {label()}
        </span>
        <span class="fx-mod-actions">
          <button
            type="button"
            class="fx-mod-btn fx-move-btn"
            disabled={!canMoveFx(m().index, -1, props.count)}
            aria-label={`Move ${label()} module up`}
            onClick={() => props.onMove(-1)}
          >
            ▲
          </button>
          <button
            type="button"
            class="fx-mod-btn fx-move-btn"
            disabled={!canMoveFx(m().index, 1, props.count)}
            aria-label={`Move ${label()} module down`}
            onClick={() => props.onMove(1)}
          >
            ▼
          </button>
          <button
            type="button"
            class="fx-mod-btn fx-bypass-btn"
            aria-pressed={m().device.bypassed}
            aria-label={
              m().device.bypassed ? `Enable ${label()}` : `Bypass ${label()}`
            }
            onClick={() =>
              setFxBypassed(props.lane, m().index, !m().device.bypassed)
            }
          >
            <span aria-hidden="true">BYP</span>
          </button>
          <button
            type="button"
            class="fx-mod-btn fx-remove-btn"
            aria-label={`Remove ${label()} module`}
            onClick={props.onRemove}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      </header>

      <div class="fx-mod-params">
        <For each={m().spec.choices}>
          {(choice) => (
            <FxChoiceControl
              lane={props.lane}
              mod={m()}
              choice={choice as FxChoiceSpec}
            />
          )}
        </For>
        <For each={m().spec.sliders}>
          {(slider) => (
            <FxSliderControl lane={props.lane} mod={m()} slider={slider} />
          )}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Param controls
// ---------------------------------------------------------------------------

function FxSliderControl(props: {
  lane: LaneId;
  mod: FxModule;
  slider: FxSliderSpec;
}): JSX.Element {
  const s = () => props.slider;
  const value = () =>
    (props.mod.device.params as Record<string, number | string>)[
      s().key
    ] as number;
  const readout = () => formatFxParam(props.mod.device.type, s().key, value());

  return (
    <label class="fx-param">
      <span class="fx-param-label" aria-hidden="true">
        {s().label}
      </span>
      <input
        type="range"
        class="fx-param-slider"
        min={s().log ? 0 : s().min}
        max={s().log ? 1000 : s().max}
        step={s().log ? 1 : s().step}
        value={paramToSlider(s(), value())}
        aria-label={`${s().label} of ${props.mod.spec.label} on ${LANE_NAMES[props.lane]}`}
        aria-valuetext={readout()}
        onInput={(e) =>
          setFxParam(
            props.lane,
            props.mod.index,
            s().key,
            sliderToParam(s(), Number(e.currentTarget.value)),
          )
        }
      />
      <span class="fx-param-readout" data-testid="fx-readout">
        {readout()}
      </span>
    </label>
  );
}

function FxChoiceControl(props: {
  lane: LaneId;
  mod: FxModule;
  choice: FxChoiceSpec;
}): JSX.Element {
  const c = () => props.choice;
  const value = () =>
    (props.mod.device.params as Record<string, number | string>)[c().key];
  const current = () =>
    c().options.find((o) => String(o.value) === String(value()))?.value ??
    c().options[0]!.value;

  return (
    <label class="fx-param fx-param-choice">
      <span class="fx-param-label" aria-hidden="true">
        {c().label}
      </span>
      <select
        class="fx-param-select"
        value={String(current())}
        aria-label={`${c().label} of ${props.mod.spec.label} on ${LANE_NAMES[props.lane]}`}
        onChange={(e) => {
          const opt = c().options.find(
            (o) => String(o.value) === e.currentTarget.value,
          );
          if (opt) setFxParam(props.lane, props.mod.index, c().key, opt.value);
        }}
      >
        <For each={c().options}>
          {(opt) => <option value={String(opt.value)}>{opt.label}</option>}
        </For>
      </select>
      <span class="fx-param-readout" data-testid="fx-readout">
        {formatFxParam(props.mod.device.type, c().key, current())}
      </span>
    </label>
  );
}
