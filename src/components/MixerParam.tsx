import type { JSX } from "solid-js";

/** A vertical-drag dial with keyboard adjustment and an exact numeric field. */
export default function MixerParam(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  log?: boolean;
  compact?: boolean;
  reset?: number;
  set: (value: number) => void;
}): JSX.Element {
  const step = () => props.step ?? 1;
  const normalize = (value: number) =>
    props.log
      ? Math.log(value / props.min) / Math.log(props.max / props.min)
      : (value - props.min) / (props.max - props.min);
  const commit = (value: number) => {
    if (!Number.isFinite(value)) return;
    props.set(
      Math.max(
        props.min,
        Math.min(
          props.max,
          Number((Math.round(value / step()) * step()).toFixed(6)),
        ),
      ),
    );
  };
  let start: { y: number; value: number } | undefined;
  return (
    <div class="mixer-param" classList={{ "is-numeric": props.compact }}>
      <span class="mixer-param-label">{props.label}</span>
      {!props.compact && (
        <div
          class="mixer-dial"
          role="slider"
          tabIndex={0}
          aria-label={props.label}
          aria-valuemin={props.min}
          aria-valuemax={props.max}
          aria-valuenow={props.value}
          aria-valuetext={`${props.value} ${props.unit ?? ""}`}
          aria-orientation="vertical"
          style={{
            "--dial-angle": `${-135 + normalize(props.value) * 270}deg`,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            start = { y: e.clientY, value: props.value };
          }}
          onPointerMove={(e) => {
            if (!start) return;
            const n = Math.max(
              0,
              Math.min(
                1,
                normalize(start.value) +
                  (start.y - e.clientY) / (e.shiftKey ? 1600 : 160),
              ),
            );
            commit(
              props.log
                ? props.min * (props.max / props.min) ** n
                : props.min + n * (props.max - props.min),
            );
          }}
          onPointerUp={(e) => {
            start = undefined;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onLostPointerCapture={() => {
            start = undefined;
          }}
          onPointerCancel={() => {
            start = undefined;
          }}
          onDblClick={() => {
            if (props.reset !== undefined) commit(props.reset);
          }}
          onKeyDown={(e) => {
            const direction = ["ArrowUp", "ArrowRight"].includes(e.key)
              ? 1
              : ["ArrowDown", "ArrowLeft"].includes(e.key)
                ? -1
                : 0;
            if (direction || e.key === "Home" || e.key === "End") {
              e.preventDefault();
              commit(
                e.key === "Home"
                  ? props.min
                  : e.key === "End"
                    ? props.max
                    : props.value + direction * step() * (e.shiftKey ? 10 : 1),
              );
            }
          }}
        >
          <i />
        </div>
      )}
      <label class="mixer-param-value">
        <input
          type="number"
          aria-label={`${props.label} value`}
          min={props.min}
          max={props.max}
          step={step()}
          value={Number(props.value.toFixed(4))}
          onChange={(e) => {
            if (e.currentTarget.value !== "")
              commit(e.currentTarget.valueAsNumber);
            e.currentTarget.value = String(props.value);
          }}
        />
        <span>{props.unit}</span>
      </label>
    </div>
  );
}
