import { For, Show, type JSX } from "solid-js";
import { LANE_IDS, type DefaultLaneId as LaneId } from "../document/schema";
import { composition, changeComposition } from "../viz/compositionState";
import {
  editLayer,
  VISUAL_EFFECTS,
  type VisualEffect,
} from "../viz/composition";
import { registerHelp } from "../help/registry";
import TrackColorControl from "./TrackColorControl";
export const VIZ_IDLE_LINE = "PLAYBACK STOPPED — EXIT TO TRANSPORT";
registerHelp([
  {
    id: "viz.motion",
    title: "MOTION",
    text: "Fluid folds bends and twists the geometry. Flowing trails stretches it into rippling forms. Orbit moves effects around a shared center. All follow MIDI phrasing and disappear during silence.",
  },
  {
    id: "viz.blending",
    title: "INSTRUMENT BLENDING",
    text: "Blended brings instruments into an overlapping region; Distinct gives their moving forms more separation. Applies to Fluid folds and Flowing trails. Orbit uses each instrument's orbit strength instead.",
  },
  {
    id: "viz.select",
    title: "SELECT INSTRUMENT",
    text: "Choose the instrument to edit. Other instruments keep their settings.",
  },
  {
    id: "viz.position",
    title: "ORBIT STRENGTH",
    text: "Set how far this effect orbits from the shared center. Zero stays centered; 100 uses the widest orbit. Rotation follows playback and pauses when stopped.",
  },
  {
    id: "viz.scale",
    title: "VISUAL SCALE",
    text: "Change the selected instrument's visual size. This does not change its audio volume.",
  },
  {
    id: "viz.view",
    title: "HIDE CONTROLS",
    text: "Hide motion controls, the inspector and orbit guide to watch the composition. Edit composition or Escape brings them back.",
  },
  {
    id: "viz.preset",
    title: "VISUAL EFFECT",
    text: "Choose an effect for the selected instrument. Other instruments keep their effects and orbit settings.",
  },
  {
    id: "viz.reroll",
    title: "REROLL COMPOSITION",
    text: "Assigns a random effect, geometric variation, and starting angle around the center to every instrument. Motion, blending, scale and orbit strength stay as you set them. Your song and sounds stay the same.",
  },
  {
    id: "viz.exit",
    title: "RETURN TO DAW",
    text: "Return to the DAW. The music keeps playing. Escape and V also return.",
  },
]);
interface Props {
  selected: LaneId;
  showOrbit?: boolean;
  onSelect(id: LaneId): void;
  announce(text: string): void;
  beforeEdit(): void;
}
export default function VizRemote(props: Props): JSX.Element {
  const layer = () => composition().lanes[props.selected];
  const effect = () => VISUAL_EFFECTS.find((e) => e.id === layer().effect)!;
  const update = (
    patch: Parameters<typeof editLayer>[2],
    persist = true,
  ): void => {
    props.beforeEdit();
    changeComposition(editLayer(composition(), props.selected, patch), persist);
  };
  return (
    <aside
      class="viz-remote"
      aria-label="Instrument inspector"
      style={{ "--viz-lane": `var(--color-lane-${props.selected})` }}
    >
      <nav
        class="viz-lane-tabs"
        data-help="viz.select"
        aria-label="Select instrument"
      >
        <For each={LANE_IDS}>
          {(id) => (
            <button
              class="viz-btn"
              aria-label={`Select ${id}`}
              aria-pressed={id === props.selected}
              onClick={() => props.onSelect(id)}
            >
              <span
                class="viz-lane-dot"
                style={{ background: `var(--color-lane-${id})` }}
              />
              {id}
            </button>
          )}
        </For>
      </nav>
      <div class="viz-inspector-body">
        <h2>{props.selected}</h2>
        <label class="viz-field" data-help="viz.preset">
          Visual effect
          <select
            aria-label={`${props.selected} visual effect`}
            value={layer().effect}
            onChange={(e) => {
              update({ effect: e.currentTarget.value as VisualEffect });
              props.announce(`${props.selected}: ${effect().name}`);
            }}
          >
            <For each={VISUAL_EFFECTS}>
              {(e) => <option value={e.id}>{e.name}</option>}
            </For>
          </select>
        </label>
        <p class="viz-effect-description">{effect().description}</p>
        <Show when={props.showOrbit !== false}>
          <label class="viz-field viz-scale" data-help="viz.position">
            Orbit strength{" "}
            <output aria-live="off">{layer().orbitStrength ?? 60}%</output>
            <input
              type="range"
              aria-label={`${props.selected} orbit strength`}
              min="0"
              max="100"
              value={layer().orbitStrength ?? 60}
              onInput={(e) =>
                update({ orbitStrength: e.currentTarget.valueAsNumber }, false)
              }
              onChange={() => changeComposition(composition())}
            />
          </label>
        </Show>
        <label class="viz-field viz-scale" data-help="viz.scale">
          Scale <output aria-live="off">{Math.round(layer().scale)}%</output>
          <input
            type="range"
            aria-label={`${props.selected} visual scale`}
            min="35"
            max="130"
            value={layer().scale}
            onInput={(e) =>
              update({ scale: e.currentTarget.valueAsNumber }, false)
            }
            onChange={() => changeComposition(composition())}
          />
        </label>
        <TrackColorControl lane={props.selected} />
        <p class="viz-inspector-tip">
          {props.showOrbit === false
            ? "Choose an effect and scale for this instrument. The motion controls above shape the whole composition."
            : "All instruments circle the same center. At 0% the effect stays centered; higher strength widens its orbit. Scale changes the artwork's size."}
        </p>
        <div class="viz-library-note">
          {VISUAL_EFFECTS.length} effects · seeded variations
        </div>
      </div>
    </aside>
  );
}
