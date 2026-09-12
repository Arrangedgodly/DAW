import { LANE_IDS, type LaneId } from "../document/schema";

export const COMPOSITION_KEY = "bitbounce.viz.composition.v2";
export const VISUAL_EFFECTS = [
  {
    id: "orbit",
    name: "Orbit lattice",
    description:
      "Interlocking paths rotate in depth. Each note opens the structure; pitch changes its tilt.",
  },
  {
    id: "contour",
    name: "Contour field",
    description:
      "Nested contours fold around a shared center. Pitch shapes the folds; velocity pushes them outward.",
  },
  {
    id: "mesh",
    name: "Prism mesh",
    description:
      "A curved triangular mesh flexes with the notes. Chord activity lights the connected vertices.",
  },
  {
    id: "current",
    name: "Particle current",
    description:
      "Interwoven point trails flow from the instrument’s center. Stronger notes lengthen the current.",
  },
  {
    id: "fracture",
    name: "Radial fractures",
    description:
      "Concentric segments turn at different rates. Every strike sends an expansion through the structure.",
  },
  {
    id: "interference",
    name: "Interference",
    description:
      "Intersecting wave families form a moving field. Pitch changes their frequency; velocity opens their spread.",
  },
  {
    id: "helix",
    name: "Double helix",
    description:
      "Braided strands twist around a common axis. Pitch and velocity shape its response.",
  },
  {
    id: "torus",
    name: "Torus knot",
    description:
      "A woven knot turns through three dimensions. Pitch and velocity shape its response.",
  },
  {
    id: "ribbon",
    name: "Ribbon sculpture",
    description:
      "Folded ribbons stretch and curl with each phrase. Pitch and velocity shape its response.",
  },
  {
    id: "rose",
    name: "Harmonic rose",
    description:
      "Petal structures bloom through harmonic ratios. Pitch and velocity shape its response.",
  },
  {
    id: "lissajous",
    name: "Lissajous cage",
    description:
      "Crossed oscillations weave a spatial cage. Pitch and velocity shape its response.",
  },
  {
    id: "vortex",
    name: "Spiral vortex",
    description:
      "Tapering spiral arms curl into a moving center. Pitch and velocity shape its response.",
  },
  {
    id: "tunnel",
    name: "Polygon tunnel",
    description:
      "Nested polygon frames recede through depth. Pitch and velocity shape its response.",
  },
  {
    id: "starburst",
    name: "Starburst",
    description:
      "Faceted rays radiate from a shared center. Pitch and velocity shape its response.",
  },
  {
    id: "wavegrid",
    name: "Wave membrane",
    description:
      "A suspended grid ripples across two axes. Pitch and velocity shape its response.",
  },
  {
    id: "pendulum",
    name: "Pendulum trails",
    description:
      "Layered pendulum paths trace long, interlocking loops. Pitch and velocity shape its response.",
  },
  {
    id: "crystal",
    name: "Crystal facets",
    description:
      "Angular wireframe crystals turn as a cluster. Pitch and velocity shape its response.",
  },
  {
    id: "eclipse",
    name: "Eclipse bands",
    description:
      "Offset circular bands sweep across a dark core. Pitch and velocity shape its response.",
  },
  {
    id: "arcs",
    name: "Arc cascade",
    description:
      "Stacked arcs unfold into a sweeping fan. Pitch and velocity shape its response.",
  },
  {
    id: "superformula",
    name: "Superform",
    description:
      "Parametric shells reshape into lobed and angular forms. Pitch and velocity shape its response.",
  },
  {
    id: "attractor",
    name: "Attractor cloud",
    description:
      "A bounded strange-attractor trace coils through space. Pitch and velocity shape its response.",
  },
  {
    id: "terrain",
    name: "Terrain contours",
    description:
      "Contour ridges undulate through a projected landscape. Pitch and velocity shape its response.",
  },
  {
    id: "weave",
    name: "Woven light",
    description:
      "Counter-moving strands form a twisting fabric. Pitch and velocity shape its response.",
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    description:
      "Repeated facets build a rotating radial mosaic. Pitch and velocity shape its response.",
  },
] as const;
export type VisualEffect = (typeof VISUAL_EFFECTS)[number]["id"];
export interface VisualLayer {
  effect: VisualEffect;
  x: number;
  y: number;
  scale: number;
  /** Orbit radius in percent. Missing legacy values use 60. */
  orbitStrength?: number;
  variation: number;
}
export type MotionMode = "orbit" | "fluid" | "trails";
export interface VisualComposition {
  motion?: MotionMode;
  blended?: boolean;
  version: 2;
  seed: number;
  lanes: Record<LaneId, VisualLayer>;
}
export const clampPosition = (n: number): number =>
  Math.max(0.08, Math.min(0.92, n));
export function defaultComposition(): VisualComposition {
  return {
    version: 2,
    motion: "fluid",
    blended: true,
    seed: 48271,
    lanes: {
      drums: {
        effect: "fracture",
        x: 0.28,
        y: 0.32,
        scale: 80,
        variation: 48271,
      },
      bass: { effect: "contour", x: 0.7, y: 0.32, scale: 80, variation: 48271 },
      chords: { effect: "mesh", x: 0.3, y: 0.7, scale: 80, variation: 48271 },
      lead: { effect: "current", x: 0.72, y: 0.7, scale: 80, variation: 48271 },
    },
  };
}
/** Seed determines every assignment. Repeated effects are intentional. */
export function rerollComposition(
  current: VisualComposition,
): VisualComposition {
  const seed = (current.seed + 0x9e3779b9) >>> 0 || 1;
  let state = seed;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const next = defaultComposition();
  next.seed = seed;
  next.motion = current.motion ?? "fluid";
  next.blended = current.blended ?? true;
  for (const id of LANE_IDS)
    next.lanes[id] = {
      effect: VISUAL_EFFECTS[Math.floor(random() * VISUAL_EFFECTS.length)]!.id,
      x: 0.16 + random() * 0.68,
      y: 0.18 + random() * 0.64,
      scale: current.lanes[id].scale,
      orbitStrength: current.lanes[id].orbitStrength ?? 60,
      variation: Math.floor(random() * 65535) + 1,
    };
  return next;
}
export function editLayer(
  current: VisualComposition,
  id: LaneId,
  patch: Partial<VisualLayer>,
): VisualComposition {
  const layer = { ...current.lanes[id], ...patch };
  if (
    !VISUAL_EFFECTS.some((e) => e.id === layer.effect) ||
    ![
      layer.x,
      layer.y,
      layer.scale,
      layer.variation,
      layer.orbitStrength ?? 60,
    ].every(Number.isFinite)
  )
    return current;
  return {
    ...current,
    lanes: {
      ...current.lanes,
      [id]: {
        ...layer,
        x: clampPosition(layer.x),
        y: clampPosition(layer.y),
        scale: Math.max(35, Math.min(130, layer.scale)),
        ...(layer.orbitStrength === undefined
          ? {}
          : { orbitStrength: Math.max(0, Math.min(100, layer.orbitStrength)) }),
      },
    },
  };
}
/** Reject malformed or future data as a whole; never render unbounded input. */
export function parseComposition(raw: string | null): VisualComposition | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const v = value as Record<string, unknown>;
    if (
      v.version !== 2 ||
      (v.motion !== undefined &&
        !["orbit", "fluid", "trails"].includes(v.motion as string)) ||
      (v.blended !== undefined && typeof v.blended !== "boolean") ||
      typeof v.seed !== "number" ||
      !Number.isInteger(v.seed) ||
      v.seed < 0 ||
      v.seed > 0xffffffff ||
      !v.lanes ||
      typeof v.lanes !== "object"
    )
      return null;
    const out = defaultComposition();
    out.seed = v.seed;
    out.motion = (v.motion as MotionMode | undefined) ?? "fluid";
    out.blended = (v.blended as boolean | undefined) ?? true;
    for (const id of LANE_IDS) {
      const layer: unknown = (v.lanes as Record<string, unknown>)[id];
      if (!layer || typeof layer !== "object") return null;
      const l = layer as Record<string, unknown>;
      if (
        typeof l.variation !== "number" ||
        !Number.isInteger(l.variation) ||
        l.variation < 1 ||
        l.variation > 65535
      )
        return null;
      if (
        (l.orbitStrength !== undefined &&
          (typeof l.orbitStrength !== "number" ||
            !Number.isFinite(l.orbitStrength) ||
            l.orbitStrength < 0 ||
            l.orbitStrength > 100)) ||
        !VISUAL_EFFECTS.some((e) => e.id === l.effect) ||
        typeof l.x !== "number" ||
        typeof l.y !== "number" ||
        typeof l.scale !== "number" ||
        ![l.x, l.y, l.scale].every(Number.isFinite) ||
        l.x < 0.08 ||
        l.x > 0.92 ||
        l.y < 0.08 ||
        l.y > 0.92 ||
        l.scale < 35 ||
        l.scale > 130
      )
        return null;
      out.lanes[id] = {
        effect: l.effect as VisualEffect,
        x: l.x,
        y: l.y,
        scale: l.scale,
        variation: l.variation,
        ...(l.orbitStrength === undefined
          ? {}
          : { orbitStrength: l.orbitStrength as number }),
      };
    }
    return out;
  } catch {
    return null;
  }
}

/** Shared circular orbit, in CSS pixels. Legacy placement supplies only phase. */
export function orbitPosition(
  layer: VisualLayer,
  elapsed: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const phase = Math.atan2(layer.y - 0.5, layer.x - 0.5) + elapsed * 0.12;
  const radius =
    (Math.min(width, height) * 0.32 * (layer.orbitStrength ?? 60)) / 100;
  return {
    x: width / 2 + Math.cos(phase) * radius,
    y: height / 2 + Math.sin(phase) * radius,
  };
}
