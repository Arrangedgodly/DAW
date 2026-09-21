import { createMemo, createSignal, For, type JSX } from "solid-js";
import {
  equalizerBands,
  eqBandHasGain,
  eqBandHasQ,
  EQ_BAND_TYPES,
  MAX_EQ_BANDS,
  type Equalizer,
  type EqBand,
} from "../document/mixer";
import MixerGraph, { type MixerSpectrum } from "./MixerGraph";

const names: Record<EqBand["type"], string> = {
  peaking: "Bell",
  lowshelf: "Low shelf",
  highshelf: "High shelf",
  highpass: "Low cut",
  lowpass: "High cut",
  notch: "Notch",
  bandpass: "Band pass",
};
export default function MixerEq(props: {
  value: Equalizer;
  spectrum?: MixerSpectrum;
  set: (eq: Equalizer) => void;
}): JSX.Element {
  const bands = createMemo(() => equalizerBands(props.value));
  const [selection, setSelection] = createSignal(1);
  const active = () => bands().find((b) => b.id === selection()) ?? bands()[0];
  const update = (id: number, patch: Partial<EqBand>) =>
    props.set({
      ...props.value,
      bands: bands().map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  let addButton!: HTMLButtonElement;
  const add = () => {
    if (bands().length >= MAX_EQ_BANDS) return;
    const occupied = [20, ...bands().map((b) => b.frequency), 20000].sort(
      (a, b) => a - b,
    );
    let gap = 0;
    for (let i = 1; i < occupied.length - 1; i++)
      if (occupied[i + 1] / occupied[i] > occupied[gap + 1] / occupied[gap])
        gap = i;
    const id = Array.from({ length: MAX_EQ_BANDS }, (_, i) => i + 1).find(
      (id) => !bands().some((b) => b.id === id),
    )!;
    props.set({
      ...props.value,
      bands: [
        ...bands(),
        {
          id,
          type: "peaking",
          frequency: Math.round(Math.sqrt(occupied[gap] * occupied[gap + 1])),
          gain: 0,
          q: 1,
          enabled: true,
        },
      ],
    });
    setSelection(id);
  };
  const remove = () => {
    const id = active()?.id;
    if (id === undefined) return;
    props.set({ ...props.value, bands: bands().filter((b) => b.id !== id) });
    addButton.focus();
  };
  const number = (
    key: "frequency" | "gain" | "q",
    label: string,
    unit: string,
    min: number,
    max: number,
    step: number,
  ) => {
    const disabled = () =>
      !active() ||
      (key === "gain" && !eqBandHasGain(active()!)) ||
      (key === "q" && !eqBandHasQ(active()!));
    return (
      <label>
        {label}
        <span>
          <input
            type="number"
            aria-label={`Band ${label.toLowerCase()}`}
            min={min}
            max={max}
            step={step}
            value={
              disabled()
                ? ""
                : Number(active()![key].toFixed(key === "frequency" ? 0 : 2))
            }
            disabled={disabled()}
            onChange={(e) => {
              const value = e.currentTarget.valueAsNumber,
                b = active();
              if (b && Number.isFinite(value))
                update(b.id, {
                  [key]: Math.max(
                    min,
                    Math.min(max, Math.round(value / step) * step),
                  ),
                });
              e.currentTarget.value = String(active()?.[key] ?? "");
            }}
          />
          <small>{unit}</small>
        </span>
      </label>
    );
  };
  return (
    <section
      class="mixer-device mixer-eq mixer-flexible-eq"
      data-help="mixer.eq"
    >
      <div class="mixer-device-heading">
        <h3>Equalizer</h3>
        <button
          aria-label={`${props.value.enabled ? "Bypass" : "Enable"} equalizer`}
          aria-pressed={props.value.enabled}
          onClick={() =>
            props.set({ ...props.value, enabled: !props.value.enabled })
          }
        >
          {props.value.enabled ? "On" : "Bypassed"}
        </button>
      </div>
      <div class="mixer-eq-body">
        <div class="mixer-eq-tools">
          <div class="mixer-eq-tabs" role="group" aria-label="EQ bands">
            <For each={bands().map((b) => b.id)}>
              {(id) => (
                <button
                  aria-label={`Select band ${id}`}
                  aria-pressed={active()?.id === id}
                  classList={{
                    "is-bypassed": !bands().find((b) => b.id === id)?.enabled,
                  }}
                  onClick={() => setSelection(id)}
                >
                  {id}
                </button>
              )}
            </For>
          </div>
          <button
            ref={(el) => {
              addButton = el;
            }}
            class="mixer-eq-add"
            aria-label="Add EQ band"
            disabled={bands().length >= MAX_EQ_BANDS}
            onClick={add}
          >
            + Band
          </button>
          <button
            aria-label="Remove selected EQ band"
            disabled={!active()}
            onClick={remove}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="m4 4 8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
        </div>
        <MixerGraph
          eqBands={bands()}
          selectedId={active()?.id}
          selectBand={setSelection}
          updateBand={update}
          enabled={props.value.enabled}
          spectrum={props.spectrum}
        />
        <div class="mixer-eq-fields">
          <label>
            Type
            <select
              aria-label="Selected band type"
              value={active()?.type ?? "peaking"}
              disabled={!active()}
              onChange={(e) => {
                const b = active();
                if (b)
                  update(b.id, {
                    type: e.currentTarget.value as EqBand["type"],
                  });
              }}
            >
              <For each={EQ_BAND_TYPES}>
                {(type) => <option value={type}>{names[type]}</option>}
              </For>
            </select>
          </label>
          {number("frequency", "Frequency", "Hz", 20, 20000, 1)}
          {number("gain", "Gain", "dB", -18, 18, 0.1)}
          {number("q", "Q", "", 0.1, 18, 0.1)}
        </div>
        <div class="mixer-eq-bottom">
          <label>
            <input
              type="checkbox"
              aria-label="Selected band enabled"
              checked={active()?.enabled ?? false}
              disabled={!active()}
              onChange={(e) => {
                const b = active();
                if (b) update(b.id, { enabled: e.currentTarget.checked });
              }}
            />
            Band on
          </label>
          <span>
            {active()
              ? `Band ${active()!.id} · Shift-drag Q`
              : "Add a band to shape the sound"}
          </span>
        </div>
      </div>
    </section>
  );
}
