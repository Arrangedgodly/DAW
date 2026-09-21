import { createMemo, For, type JSX } from "solid-js";
import { eqBandHasGain, eqBandHasQ, type EqBand } from "../document/mixer";

export interface MixerSpectrum {
  bins: Float32Array<ArrayBuffer>;
  sampleRate: number;
}
type Filter = { kind: BiquadFilterType; cutoffHz: number; q: number };
type Band = {
  key: string;
  name: string;
  letter: string;
  frequency: number;
  gain: number;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const x = (f: number) => 28 + (Math.log10(f / 20) / 3) * 364;
const y = (db: number) => 12 + ((18 - db) / 54) * 134;

/** Disconnected biquads compute the response; spectrum comes from the channel output tap. */
export default function MixerGraph(props: {
  filter?: Filter;
  eqBands?: readonly EqBand[];
  selectedId?: number;
  selectBand?: (id: number) => void;
  updateBand?: (id: number, patch: Partial<EqBand>) => void;
  enabled: boolean;
  spectrum?: MixerSpectrum;
  set?: (values: Record<string, number>) => void;
}): JSX.Element {
  const sampleRate = createMemo(() => props.spectrum?.sampleRate ?? 48000);
  const context = createMemo(() => new OfflineAudioContext(1, 1, sampleRate()));
  const nodes = createMemo(() =>
    Array.from({ length: 8 }, () => context().createBiquadFilter()),
  );
  const frequencies = Float32Array.from(
    { length: 180 },
    (_, i) => 20 * 1000 ** (i / 179),
  );
  type Setting = [BiquadFilterType, number, number, number];
  const responsePath = (settings: Setting[]) => {
    const result = new Float32Array(180),
      mag = new Float32Array(180),
      phase = new Float32Array(180);
    for (const [i, s] of settings.entries()) {
      const n = nodes()[i];
      n.type = s[0];
      n.frequency.value = s[1];
      n.Q.value = s[2];
      n.gain.value = s[3];
      n.getFrequencyResponse(frequencies, mag, phase);
      for (let j = 0; j < 180; j++)
        result[j] += 20 * Math.log10(Math.max(1e-6, mag[j]));
    }
    return Array.from(
      result,
      (db, i) =>
        `${i ? "L" : "M"}${x(frequencies[i]).toFixed(2)},${clamp(y(db), 12, 146).toFixed(2)}`,
    ).join("");
  };
  const selectedCurve = createMemo(() => {
    const b = props.eqBands?.find((b) => b.id === props.selectedId);
    return b ? responsePath([[b.type, b.frequency, b.q, b.gain]]) : "";
  });
  const curve = createMemo(() => {
    const f = props.filter;
    const settings: [BiquadFilterType, number, number, number][] = f
      ? [[f.kind, f.cutoffHz, f.q, 0]]
      : (props.eqBands ?? [])
          .filter((b) => b.enabled)
          .map((b) => [b.type, b.frequency, b.q, b.gain]);
    return responsePath(settings);
  });
  const spectrum = createMemo(() => {
    const s = props.spectrum;
    if (!s) return "";
    return (
      "M28,146" +
      Array.from(frequencies, (f) => {
        const bin = Math.min(
          s.bins.length - 1,
          Math.round((f / (s.sampleRate / 2)) * s.bins.length),
        );
        return `L${x(f).toFixed(2)},${(146 - clamp((s.bins[bin] + 90) / 90, 0, 1) * 134).toFixed(2)}`;
      }).join("") +
      "L392,146Z"
    );
  });
  const bands = (): Band[] =>
    props.filter
      ? [
          {
            key: "cutoffHz",
            name: "Cutoff and resonance",
            letter: "F",
            frequency: props.filter.cutoffHz,
            gain: props.filter.q - 3,
          },
        ]
      : (props.eqBands ?? []).map((b) => ({
          key: String(b.id),
          name: `Band ${b.id}`,
          letter: String(b.id),
          frequency: b.frequency,
          gain: eqBandHasGain(b) ? b.gain : 0,
        }));
  let graph!: HTMLDivElement;
  let dragging: { key: string; y: number; q: number } | undefined;
  const move = (key: string, e: PointerEvent) => {
    const r = graph.getBoundingClientRect(),
      f =
        20 *
        1000 **
          clamp((((e.clientX - r.left) / r.width) * 410 - 28) / 364, 0, 1),
      gain =
        18 -
        clamp((((e.clientY - r.top) / r.height) * 170 - 12) / 134, 0, 1) * 54;
    if (props.filter)
      props.set?.({ cutoffHz: Math.round(f), q: clamp(gain + 3, 0.1, 18) });
    else {
      const band = props.eqBands?.find((b) => String(b.id) === key);
      if (!band) return;
      if (e.shiftKey) {
        if (eqBandHasQ(band))
          props.updateBand?.(band.id, {
            q: Number(
              clamp(
                (dragging?.q ?? band.q) +
                  ((dragging?.y ?? e.clientY) - e.clientY) / 20,
                0.1,
                18,
              ).toFixed(1),
            ),
          });
      } else
        props.updateBand?.(band.id, {
          frequency: Math.round(f),
          ...(eqBandHasGain(band)
            ? { gain: Number(clamp(gain, -18, 18).toFixed(1)) }
            : {}),
        });
    }
  };
  // Stable IDs retain focus and pointer capture when bands cross or values change.
  const keys = () =>
    props.filter
      ? ["cutoffHz"]
      : (props.eqBands ?? []).map((b) => String(b.id));
  return (
    <div class="mixer-graph-wrap" classList={{ "is-bypassed": !props.enabled }}>
      <div
        class="mixer-frequency-graph"
        ref={(el) => {
          graph = el;
        }}
        role="group"
        aria-label={`${props.filter ? "Filter" : "Equalizer"} frequency response`}
      >
        <svg
          viewBox="0 0 410 170"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <For each={[100, 1000]}>
            {(f) => (
              <>
                <line x1={x(f)} x2={x(f)} y1="12" y2="146" />
                <text x={x(f)} y="165" text-anchor="middle">
                  {f === 1000 ? "1k" : f}
                </text>
              </>
            )}
          </For>
          <For each={[12, 0, -12, -24]}>
            {(db) => (
              <>
                <line x1="28" x2="392" y1={y(db)} y2={y(db)} />
                <text x="2" y={y(db) + 3}>
                  {db}
                </text>
              </>
            )}
          </For>
          <text x="28" y="165">
            20
          </text>
          <text x="392" y="165" text-anchor="end">
            20k Hz
          </text>
          <path class="mixer-spectrum" d={spectrum()} />
          <path class="mixer-selected-response" d={selectedCurve()} />
          <path class="mixer-response" d={curve()} />
        </svg>
        <For each={keys()}>
          {(key) => {
            const band = () => bands().find((b) => b.key === key)!;
            return (
              <button
                class="mixer-band"
                aria-label={`${band().name}. Arrow keys adjust; Shift changes Q; exact values below.`}
                aria-pressed={
                  props.filter ? undefined : props.selectedId === Number(key)
                }
                classList={{
                  "is-selected": props.selectedId === Number(key),
                  "is-band-bypassed":
                    !props.filter &&
                    !props.eqBands?.find((b) => String(b.id) === key)?.enabled,
                }}
                style={{
                  left: `${(x(band().frequency) / 410) * 100}%`,
                  top: `${(y(band().gain) / 170) * 100}%`,
                }}
                onClick={() => props.selectBand?.(Number(key))}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  props.selectBand?.(Number(key));
                  dragging = {
                    key,
                    y: e.clientY,
                    q: props.eqBands?.find((b) => String(b.id) === key)?.q ?? 1,
                  };
                }}
                onPointerMove={(e) => {
                  if (dragging?.key === key) move(key, e);
                }}
                onPointerUp={() => {
                  dragging = undefined;
                }}
                onPointerCancel={() => {
                  dragging = undefined;
                }}
                onLostPointerCapture={() => {
                  dragging = undefined;
                }}
                onKeyDown={(e) => {
                  const dx =
                      e.key === "ArrowRight"
                        ? 1
                        : e.key === "ArrowLeft"
                          ? -1
                          : 0,
                    dy =
                      e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
                  if (!dx && !dy) return;
                  e.preventDefault();
                  const b = band();
                  if (props.filter)
                    props.set?.({
                      cutoffHz: Math.round(
                        clamp(b.frequency * 1.03 ** dx, 20, 20000),
                      ),
                      q: clamp(props.filter.q + dy * 0.1, 0.1, 18),
                    });
                  else {
                    const selected = props.eqBands?.find(
                      (b) => String(b.id) === key,
                    );
                    if (!selected) return;
                    props.selectBand?.(selected.id);
                    if (e.shiftKey && eqBandHasQ(selected))
                      props.updateBand?.(selected.id, {
                        q: Number(
                          clamp(selected.q + (dx || dy) * 0.1, 0.1, 18).toFixed(
                            1,
                          ),
                        ),
                      });
                    else
                      props.updateBand?.(selected.id, {
                        frequency: Math.round(
                          clamp(selected.frequency * 1.03 ** dx, 20, 20000),
                        ),
                        ...(eqBandHasGain(selected)
                          ? {
                              gain: Number(
                                clamp(
                                  selected.gain + dy * 0.1,
                                  -18,
                                  18,
                                ).toFixed(1),
                              ),
                            }
                          : {}),
                      });
                  }
                }}
              >
                {band().letter}
              </button>
            );
          }}
        </For>
      </div>
      <div class="mixer-graph-legend">
        <span>{props.enabled ? "Response" : "Response · bypassed"}</span>
        <span>Output spectrum · dBFS</span>
      </div>
    </div>
  );
}
