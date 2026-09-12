import { LANE_IDS, type LaneId } from "../document/schema";
import type { VizNoteOn } from "../engine/session";
import type { VizFrameInfo } from "./renderer";
import {
  orbitPosition,
  type VisualComposition,
  type VisualLayer,
  type MotionMode,
} from "./composition";

export interface LayerActivity {
  at: number;
  velocity: number;
  pitch: number;
  holdSeconds?: number;
  releaseSeconds?: number;
  lane?: LaneId;
}
export function activityLevel(activity: LayerActivity, now: number): number {
  const age = now - activity.at;
  if (!Number.isFinite(age) || age < 0) return 0;
  if (activity.lane === "drums") return activity.velocity * Math.exp(-age * 22);
  if (activity.holdSeconds === undefined)
    return activity.velocity * Math.exp(-age * 3);
  const hold = activity.holdSeconds;
  const release = Math.max(0.06, Math.min(2, activity.releaseSeconds ?? 0.25));
  // Gate follows the compiled MIDI duration, including tempo and note length.
  // A short opening preserves the transient, then holds until note release.
  const opening = 0.3 + 0.7 * Math.min(1, age / 0.045);
  return (
    activity.velocity *
    opening *
    (age <= hold ? 1 : Math.exp((-5 * (age - hold)) / release))
  );
}
/** Transient energy is separate from sustain, so long notes do not keep bursting. */
export function attackLevel(activity: LayerActivity, now: number): number {
  const age = now - activity.at;
  return Number.isFinite(age) && age >= 0
    ? activity.velocity * Math.exp(-age * (activity.lane === "drums" ? 11 : 16))
    : 0;
}
/** Four bounded ledgers; dense MIDI never allocates more geometry or particles. */
export function createCompositionEngine(
  initial: VisualComposition,
  colors: Record<LaneId, string>,
) {
  let composition = initial,
    reduced = false,
    disposed = false,
    playing = false;
  let mode: MotionMode = initial.motion ?? "fluid";
  let blended = initial.blended ?? true;
  let motion = 0,
    previousTime = Number.NaN;
  const activity = Object.fromEntries(
    LANE_IDS.map((id) => [id, { at: -Infinity, velocity: 0, pitch: 60 }]),
  ) as Record<LaneId, LayerActivity>;
  // Up to sixteen overlapping voices per lane, independent of song length.
  const voices = Object.fromEntries(
    LANE_IDS.map((id) => [id, [] as LayerActivity[]]),
  ) as Record<LaneId, LayerActivity[]>;
  const laneMotion = Object.fromEntries(
    LANE_IDS.map((id) => [id, 0]),
  ) as Record<LaneId, number>;
  const audible = Object.fromEntries(
    LANE_IDS.map((id) => [id, true]),
  ) as Record<LaneId, boolean>;
  const engine = {
    setMotion(next: MotionMode, blend: boolean) {
      mode = next;
      blended = blend;
    },
    setAudible(id: LaneId, value: boolean) {
      audible[id] = value;
      if (!value) {
        voices[id].length = 0;
        activity[id].velocity = 0;
      }
    },
    setComposition(next: VisualComposition) {
      composition = next;
      mode = next.motion ?? "fluid";
      blended = next.blended ?? true;
    },
    setReducedMotion(next: boolean) {
      reduced = next;
    },
    setPlaying(next: boolean) {
      playing = next;
      previousTime = Number.NaN;
      if (!next)
        for (const id of LANE_IDS) {
          activity[id].velocity = 0;
          voices[id].length = 0;
        }
    },
    ignite(hit: VizNoteOn) {
      if (
        disposed ||
        !Number.isFinite(hit.audibleAt) ||
        !Number.isFinite(hit.velocity) ||
        hit.velocity <= 0 ||
        !Number.isFinite(hit.pitch) ||
        !LANE_IDS.includes(hit.lane) ||
        !audible[hit.lane]
      )
        return;
      const note: LayerActivity = {
        at: hit.audibleAt,
        velocity: Math.min(1, hit.velocity),
        pitch: Math.max(0, Math.min(127, hit.pitch)),
        lane: hit.lane,
        holdSeconds:
          Number.isFinite(hit.holdSeconds) && hit.holdSeconds! >= 0
            ? hit.holdSeconds
            : undefined,
        releaseSeconds:
          Number.isFinite(hit.releaseSeconds) && hit.releaseSeconds! >= 0
            ? hit.releaseSeconds
            : undefined,
      };
      activity[hit.lane] = note;
      const laneVoices = voices[hit.lane];
      // Prefer retiring an expired voice before stealing the earliest release.
      if (laneVoices.length >= 16) {
        let oldest = 0;
        for (let i = 1; i < laneVoices.length; i++)
          if (
            laneVoices[i]!.at + (laneVoices[i]!.holdSeconds ?? 0) <
            laneVoices[oldest]!.at + (laneVoices[oldest]!.holdSeconds ?? 0)
          )
            oldest = i;
        laneVoices.splice(oldest, 1);
      }
      laneVoices.push(note);
    },
    draw(
      ctx: CanvasRenderingContext2D,
      frame: VizFrameInfo,
      now: number,
      bpm: number,
    ) {
      if (disposed) return;
      const delta =
        Number.isFinite(now) && Number.isFinite(previousTime)
          ? Math.max(0, Math.min(0.1, now - previousTime))
          : 0;
      if (
        playing &&
        !reduced &&
        Number.isFinite(now) &&
        Number.isFinite(previousTime)
      )
        motion += (Math.max(0, Math.min(0.1, now - previousTime)) * bpm) / 112;
      previousTime = now;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [i, id] of LANE_IDS.entries()) {
        if (!playing || reduced || !audible[id]) continue;
        const a = activity[id];
        let energy = 0,
          presence = 0;
        for (const voice of voices[id]) {
          const level = activityLevel(voice, now);
          energy = Math.max(energy, level);
          // Relative envelope keeps soft notes visible without leaving an
          // asymptotic trace forever after the release.
          presence = Math.max(
            presence,
            Math.max(level, attackLevel(voice, now)) / voice.velocity,
          );
        }
        if (presence <= 0.01) continue;
        const impact = attackLevel(a, now);
        if (playing && !reduced)
          laneMotion[id] +=
            (delta * (0.08 + energy * 3.5 + impact * 2) * bpm) / 112;
        // Reduced motion stays fully static. The activity summarizer supplies
        // equivalent MIDI information without flashes or geometric movement.
        drawLayer(
          ctx,
          composition.lanes[id],
          i,
          reduced ? 0 : laneMotion[id],
          reduced ? 0 : energy,
          reduced ? 0 : (a.pitch - 60) / 36,
          frame.width,
          frame.height,
          colors[id],
          id,
          reduced ? 0 : impact,
          Math.min(1, presence * 2),
          motion,
          mode,
          blended,
        );
      }
      ctx.restore();
    },
    probe(now = previousTime) {
      return {
        disposed,
        layers: disposed ? 0 : 4,
        activity: structuredClone(activity),
        motion,
        reduced,
        energy: Object.fromEntries(
          LANE_IDS.map((id) => [
            id,
            Math.max(
              0,
              ...voices[id].map((voice) => activityLevel(voice, now)),
            ),
          ]),
        ),
        voices: Object.fromEntries(
          LANE_IDS.map((id) => [id, voices[id].length]),
        ),
      };
    },
    dispose() {
      disposed = true;
      live.delete(engine);
      for (const id of LANE_IDS) {
        activity[id].velocity = 0;
        voices[id].length = 0;
      }
    },
  };
  live.add(engine);
  return engine;
}
type CompositionEngine = ReturnType<typeof createCompositionEngine>;
const live = new Set<CompositionEngine>();
export const activeCompositionEngines = (): readonly CompositionEngine[] => [
  ...live,
];

/** Fixed-cost paths, in CSS pixels. No blur, pixel readbacks, or DOM writes. */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  l: VisualLayer,
  index: number,
  t: number,
  pulse: number,
  pitch: number,
  W: number,
  H: number,
  color: string,
  lane: LaneId,
  impact: number,
  opacity: number,
  orbitTime: number,
  mode: MotionMode,
  blended: boolean,
): void {
  const r = (Math.min(W, H) * 0.24 * l.scale) / 80;
  const v = l.variation / 65535,
    lobes = 3 + (l.variation % 5);
  const spin =
    t * (0.3 + v * 0.3) + index + v * 6 + pitch * 0.3 + impact * 0.65;
  ctx.save();
  const center =
    mode === "orbit"
      ? orbitPosition(l, orbitTime, W, H)
      : {
          x:
            W *
            (0.5 +
              (blended ? 0.12 : 0.27) *
                Math.sin(orbitTime * 0.28 + index * 1.7)),
          y:
            H *
            (0.5 +
              (blended ? 0.1 : 0.24) *
                Math.sin(orbitTime * 0.19 + index * 2.1 + 0.8)),
        };
  ctx.translate(center.x, center.y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  // Instruments have different gestures, regardless of the selected geometry.
  // Expansion and deformation carry energy without adding any draw calls.
  const drum = lane === "drums";
  const stretch = lane === "chords" ? 0.65 : lane === "lead" ? 0.85 : 0.25;
  ctx.rotate(drum ? impact * 0.35 : Math.sin(t * 0.6) * pulse * 0.18);
  ctx.scale(
    1 + (drum ? impact * 0.85 : pulse * stretch + impact * 0.12),
    1 + (drum ? impact * 0.85 : pulse * 0.3 - impact * 0.12),
  );
  const deform = (x: number, y: number): [number, number] => {
    if (mode === "orbit") return [x, y];
    const u = x / r,
      w = y / r;
    const wave = 0.28 + pulse * 0.38 + impact * 0.22;
    if (mode === "fluid") {
      const twist = Math.sin(t * 0.8 + Math.hypot(u, w) * 2.4) * wave;
      return [
        (u * Math.cos(twist) -
          w * Math.sin(twist) +
          Math.sin(w * 3 + t * 1.1) * wave) *
          r,
        (u * Math.sin(twist) +
          w * Math.cos(twist) +
          Math.sin(u * 2.7 - t * 0.9) * wave) *
          r,
      ];
    }
    // Different parts of the line lag behind the phrase, forming a flowing tail.
    const lag = u * 1.4 + w * 0.6;
    return [
      (u * (1.3 + pulse * 0.7) + Math.sin(t * 0.8 - lag) * wave) * r,
      (w * 0.65 + Math.sin(t * 1.2 - lag * 1.7) * (0.5 + pulse * 0.5)) * r,
    ];
  };
  const line = (x: number, y: number) => {
    if (mode === "orbit") {
      ctx.lineTo(x, y);
      return;
    }
    const p = deform(x, y);
    ctx.lineTo(p[0], p[1]);
  };
  const move = (x: number, y: number) => {
    if (mode === "orbit") {
      ctx.moveTo(x, y);
      return;
    }
    const p = deform(x, y);
    ctx.moveTo(p[0], p[1]);
  };
  const ellipse = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ) => {
    if (mode === "orbit") {
      ctx.ellipse(cx, cy, rx, ry, rotation, start, end);
      return;
    }
    const steps = Math.max(4, Math.ceil((end - start) * 18));
    for (let k = 0; k <= steps; k++) {
      const a = start + ((end - start) * k) / steps;
      const x = Math.cos(a) * rx,
        y = Math.sin(a) * ry;
      line(
        cx + x * Math.cos(rotation) - y * Math.sin(rotation),
        cy + x * Math.sin(rotation) + y * Math.cos(rotation),
      );
    }
  };
  const project = (x: number, y: number, z = 0): void => {
    const a = spin * 0.6 + pulse * 0.45,
      depth = x * Math.sin(a) + z * Math.cos(a);
    line(
      (x * Math.cos(a) - z * Math.sin(a)) * r,
      (y * 0.8 + depth * (0.24 + pulse * 0.35)) * r,
    );
  };
  const begin = (alpha = 0.55, width = 0.7): void => {
    ctx.beginPath();
    ctx.globalAlpha = alpha * opacity;
    ctx.lineWidth = width * (1 + impact * 0.65);
  };
  const end = (): void => ctx.stroke();
  switch (l.effect) {
    case "orbit":
      for (let j = 0; j < 22; j++) {
        begin(0.26 + j / 48);
        for (let k = 0; k <= 96; k++) {
          const q = (k / 96) * Math.PI * 2,
            a = (j / 22) * Math.PI + spin;
          const x = Math.cos(q),
            y = Math.sin(q) * (0.24 + v * 0.3);
          line(
            (x * Math.cos(a) - y * Math.sin(a)) * r,
            (x * Math.sin(a) + y * Math.cos(a)) * r,
          );
        }
        end();
      }
      break;
    case "contour":
    case "superformula":
      for (let j = 0; j < 32; j++) {
        begin(0.3 + j / 65);
        for (let k = 0; k <= 128; k++) {
          const a = (k / 128) * Math.PI * 2,
            rr = 0.22 + j / 44;
          const form =
            l.effect === "contour"
              ? 1 +
                0.17 * Math.sin(a * lobes + spin + j * 0.11) +
                0.08 * Math.cos(a * 5 - t * 0.4 + pitch)
              : Math.pow(
                  Math.pow(Math.abs(Math.cos((lobes * a) / 4)), 0.6 + v * 2) +
                    Math.pow(Math.abs(Math.sin((lobes * a) / 4)), 0.6 + v * 2),
                  -0.65,
                );
          line(Math.cos(a) * rr * form * r, Math.sin(a) * rr * form * r * 0.78);
        }
        end();
      }
      break;
    case "mesh":
    case "torus":
      for (let j = 0; j < 18; j++) {
        begin(0.4 + j / 55);
        for (let k = 0; k <= 72; k++) {
          const a = (k / 72) * Math.PI * 2,
            b = (j / 18) * Math.PI * 2;
          const ring =
            l.effect === "torus"
              ? 0.6 + 0.22 * Math.cos(b + a * lobes)
              : Math.sin(b / 2);
          project(Math.cos(a) * ring, Math.cos(b) * 0.65, Math.sin(a) * ring);
          if (l.effect === "mesh" && k % 4 === 0)
            project(
              Math.cos(a + 0.1) * Math.sin(b / 2 + 0.1),
              Math.cos(b + 0.2) * 0.65,
              Math.sin(a + 0.1) * ring,
            );
        }
        end();
      }
      break;
    case "current":
    case "attractor": {
      let ax = 0.1,
        ay = 0.1;
      for (let j = 0; j < 600; j++) {
        let x: number, y: number;
        const q = j * 0.371 + t * 0.22,
          rr = Math.sqrt(j / 600);
        if (l.effect === "attractor") {
          const nx =
            Math.sin((1.4 + v * 0.2) * ay) - Math.cos((1.6 + v * 0.3) * ax);
          ay = Math.sin(1.7 * ax) - Math.cos((1.1 + v * 0.5) * ay);
          ax = nx;
          x = ax * 0.43;
          y = ay * 0.43;
        } else {
          x = Math.cos(q) * rr;
          y = Math.sin(q * (1.02 + v * 0.05) + pitch * 0.1) * rr * 0.65;
        }
        ctx.globalAlpha = (0.45 + (j % 5) / 10) * opacity;
        const particle = deform(x * r, y * r);
        ctx.fillRect(particle[0], particle[1], 1.2 + pulse, 1.2 + pulse);
        if (l.effect === "current" && j % 3 === 0) {
          begin(0.5);
          move(x * r, y * r);
          line(
            x * r + Math.cos(q + 0.7) * (7 + pulse * 15),
            y * r + Math.sin(q + 0.7) * 8,
          );
          end();
        }
      }
      break;
    }
    case "fracture":
    case "eclipse":
    case "arcs":
      for (let j = 0; j < 18; j++) {
        const rr = r * (0.12 + j / 20);
        begin(0.3 + j / 35, j % 4 === 0 ? 1.5 : 0.7);
        const count = l.effect === "fracture" ? 12 : 1;
        for (let n = 0; n < count; n++) {
          const a =
            (n / count) * Math.PI * 2 + spin * (j % 2 ? 1 : -1) + j * 0.04;
          move(Math.cos(a) * rr, Math.sin(a) * rr * 0.84);
          ellipse(
            l.effect === "eclipse" ? Math.sin(j * 0.15 + spin) * r * 0.2 : 0,
            0,
            rr,
            rr * 0.84,
            l.effect === "arcs" ? j * 0.08 : 0,
            a,
            a +
              (l.effect === "fracture"
                ? 0.38
                : l.effect === "arcs"
                  ? 2.2
                  : 5.3),
          );
        }
        end();
      }
      break;
    case "interference":
    case "weave":
      for (let j = 0; j < 42; j++) {
        begin(0.32 + j / 100);
        for (let k = 0; k <= 96; k++) {
          const x = (k / 96 - 0.5) * 2,
            y =
              Math.sin(x * (3 + v * 3) + spin + j * 0.08 + pitch * 0.15) *
                0.23 +
              (j - 21) / 42;
          project(
            x,
            y,
            l.effect === "weave" ? Math.cos(x * 5 + j * 0.13 + spin) * 0.5 : 0,
          );
        }
        end();
      }
      break;
    case "helix":
      for (let j = 0; j < 26; j++) {
        begin(0.45 + j / 65);
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 4 + spin + j * 0.05;
          project(
            Math.cos(a) * 0.4,
            (k / 96 - 0.5) * 1.8,
            Math.sin(a) * 0.4 + j * 0.008,
          );
        }
        end();
      }
      break;
    case "ribbon":
      for (let j = 0; j < 30; j++) {
        begin(0.4 + j / 75);
        for (let k = 0; k <= 100; k++) {
          const a = (k / 100) * Math.PI * 2;
          project(
            Math.cos(a) * (0.6 + 0.25 * Math.cos(a * 3 + spin)),
            Math.sin(a) * (0.6 + 0.25 * Math.cos(a * 3 + spin)),
            (j / 30 - 0.5) * 0.5 + Math.sin(a * lobes + spin) * 0.4,
          );
        }
        end();
      }
      break;
    case "rose":
    case "lissajous":
    case "pendulum":
      for (let j = 0; j < 14; j++) {
        begin(0.4 + j / 35);
        for (let k = 0; k <= 192; k++) {
          const a = (k / 192) * Math.PI * 2,
            phase = j * 0.06 + spin * 0.4;
          if (l.effect === "rose") {
            const rr = Math.cos(a * lobes + phase) * (0.65 + j / 45);
            project(Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 3) * 0.12);
          } else if (l.effect === "lissajous")
            project(
              Math.sin(a * lobes + phase) * 0.85,
              Math.cos(a * (lobes + 1)) * 0.8,
              Math.sin(a * 2 + phase) * 0.3,
            );
          else
            project(
              Math.sin(a * 2 + phase) * 0.55 + Math.sin(a * 5) * 0.3,
              Math.cos(a * 3) * 0.7,
              Math.sin(a + phase) * 0.45,
            );
        }
        end();
      }
      break;
    case "vortex":
      for (let j = 0; j < 18; j++) {
        begin(0.45 + j / 60);
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * 7 + (j / 18) * Math.PI * 2 + spin,
            rr = k / 96;
          project(Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 0.4) * 0.1);
        }
        end();
      }
      break;
    case "tunnel":
      for (let j = 0; j < 28; j++) {
        begin(0.3 + j / 55);
        for (let k = 0; k <= lobes; k++) {
          const a = (k / lobes) * Math.PI * 2 + spin + j * 0.07,
            rr = 0.08 + j / 29;
          project(Math.cos(a) * rr, Math.sin(a) * rr, (j / 28) * 0.5);
        }
        end();
      }
      break;
    case "starburst":
    case "kaleidoscope":
      for (let j = 0; j < lobes * 6; j++) {
        begin(0.65, j % 3 === 0 ? 1.2 : 0.65);
        const a = (j / (lobes * 6)) * Math.PI * 2 + spin;
        for (let k = 0; k <= 12; k++) {
          const rr = 0.15 + k / 14,
            b = a + Math.sin(k * 0.8 + spin) * 0.12;
          project(
            Math.cos(b) * rr,
            Math.sin(b) * rr,
            l.effect === "kaleidoscope" ? Math.sin(k * 2 + j) * 0.3 : 0,
          );
        }
        end();
      }
      break;
    case "wavegrid":
    case "terrain":
      for (let j = 0; j < 34; j++) {
        begin(0.35 + j / 65);
        for (let k = 0; k <= 96; k++) {
          const x = (k / 96 - 0.5) * 1.7,
            z = (j / 34 - 0.5) * 1.8,
            y =
              Math.sin(x * (3 + v * 3) + spin) *
              Math.cos(z * 3 + spin * 0.6) *
              (0.2 + pulse * 0.08);
          project(
            x,
            l.effect === "terrain"
              ? y + Math.abs(Math.sin(x * 2 + z)) * 0.2
              : y,
            z,
          );
        }
        end();
      }
      break;
    case "crystal":
      for (let j = 0; j < 12; j++) {
        begin(0.45 + j / 30);
        for (let k = 0; k <= 8; k++) {
          const a = (k / 8) * Math.PI * 2 + spin + j * 0.08;
          project(
            Math.cos(a) * (0.4 + j / 25),
            Math.sin(a) * (0.4 + j / 25),
            Math.sin(a * 2) * 0.2,
          );
          project(0, 0, j % 2 ? 0.75 : -0.75);
        }
        end();
      }
      break;
  }
  ctx.restore();
}
