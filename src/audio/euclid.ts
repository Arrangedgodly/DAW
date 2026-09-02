/**
 * Euclidean rhythm (PX-3): pure Bjorklund/threshold-method pattern math.
 *
 * `euclid(pulses, steps, rotation)` spreads `pulses` onsets as evenly as
 * possible over `steps` columns using the classic threshold method —
 * column i is on iff `(i * pulses) mod steps < pulses` — then rotates the
 * result. This is the standard closed form of Bjorklund's algorithm for the
 * patterns musicians call E(p, n): E(3,8) = x..x..x., E(2,3) = x.x, etc.
 *
 * Row identity ("is this row still an Euclidean pattern?") is the inverse
 * problem: `matchEuclid(row)` searches pulses ascending / rotation ascending
 * for the canonical (smallest) parameterisation whose pattern equals the row
 * exactly, so the fill control can show '—' the moment a hand edit breaks
 * the pattern.
 */

/** Clamp helper shared by the fill UI (params are always in range). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalize any rotation into [0, steps). */
function normalizeRotation(rotation: number, steps: number): number {
  if (steps <= 0) return 0;
  return ((Math.trunc(rotation) % steps) + steps) % steps;
}

/**
 * The Euclidean pattern E(pulses, steps) rotated right by `rotation`
 * (rotation 0 = canonical x-first form). Degenerate cases are well-defined:
 * pulses ≤ 0 → silence, pulses ≥ steps → all on, steps ≤ 0 → empty array.
 */
export function euclid(pulses: number, steps: number, rotation = 0): boolean[] {
  if (steps <= 0) return [];
  const p = clamp(Math.trunc(pulses), 0, steps);
  const base: boolean[] = new Array<boolean>(steps);
  for (let i = 0; i < steps; i++) {
    base[i] = (i * p) % steps < p;
  }
  const r = normalizeRotation(rotation, steps);
  if (r === 0) return base;
  const out: boolean[] = new Array<boolean>(steps);
  for (let i = 0; i < steps; i++) {
    out[(i + r) % steps] = base[i];
  }
  return out;
}

/** True when two patterns are element-wise equal (length must match). */
export function patternEquals(a: readonly boolean[], b: readonly boolean[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The canonical parameterisation of a row, if it is an Euclidean pattern. */
export interface EuclidMatch {
  readonly pulses: number;
  readonly rotation: number;
}

/**
 * Inverse of `euclid`: find the (pulses, rotation) with the fewest pulses —
 * and, among equals, the smallest rotation — whose pattern equals `row`
 * exactly. Returns null when the row is not any Euclidean pattern
 * (i.e. it has been hand-edited away from every fill shape), including the
 * empty/short-row guard cases.
 */
export function matchEuclid(row: readonly boolean[]): EuclidMatch | null {
  const steps = row.length;
  if (steps <= 0) return null;
  for (let pulses = 0; pulses <= steps; pulses++) {
    const base = euclid(pulses, steps);
    for (let rotation = 0; rotation < steps; rotation++) {
      if (rotation === 0) {
        if (patternEquals(base, row)) return { pulses, rotation: 0 };
        continue;
      }
      const rotated = new Array<boolean>(steps);
      for (let i = 0; i < steps; i++) rotated[(i + rotation) % steps] = base[i];
      if (patternEquals(rotated, row)) return { pulses, rotation };
    }
  }
  return null;
}

/** Compact human label, e.g. "E(3,8)" / "E(5,16)·r1" — display only. */
export function euclidLabel(match: EuclidMatch, steps: number): string {
  return match.rotation === 0
    ? `E(${match.pulses},${steps})`
    : `E(${match.pulses},${steps})·r${match.rotation}`;
}
