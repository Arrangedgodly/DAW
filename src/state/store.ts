/**
 * Document store (DES-4, minimal pull-forward of IM-6 per plan): one
 * zustand/vanilla store holding the valibot-validated ProjectDocument with
 * zundo temporal undo (limit 50, D1). Scope here is deliberately tight —
 * document state + cell toggle actions + undo/redo; IM-6 completes selection,
 * scale overrides and the rest of the write API.
 *
 * Law (D1): the grid renderer and playhead NEVER read this store at 60 Hz —
 * pattern edits land here, a subscription recompiles lane events for the
 * engine, and the Solid layer only re-renders on shape changes.
 */

import { createStore } from "zustand/vanilla";
import { temporal } from "zundo";
import {
  DRUM_PIECES,
  type DrumPiece,
  type LaneId,
  type PitchedCell,
  type PitchedPattern,
  type ProjectDocument,
  createDefaultProject,
} from "../document/schema";
import { validateProject } from "../document/validate";
import { modeSize } from "../document/scales";

const UNDO_LIMIT = 50;

export interface DocState {
  readonly doc: ProjectDocument;
}

/**
 * Expand the default project's pitched patterns to full editing grids:
 * bass/lead get ~2 octaves of scale-degree rows, chords keeps one octave of
 * diatonic chord rows (matching the row model DES-4 renders). Pure; only run
 * at store creation so the shipped default document stays untouched.
 */
function expandDefaultGrids(doc: ProjectDocument): ProjectDocument {
  const size = modeSize(doc.scale.mode);
  const degrees = (count: number) =>
    Array.from({ length: count }, (_, i) => i);
  const expand = (lane: Exclude<LaneId, "drums">, count: number) => {
    const patterns = doc.patterns[lane].map((p) => {
      const pitched = p as PitchedPattern;
      if (pitched.kind !== "pitched") return p;
      const wanted = degrees(count);
      const rows = wanted.map(
        (degree) =>
          pitched.rows.find((r) => r.degree === degree) ?? {
            degree,
            steps: new Array(16 * pitched.bars).fill(0) as PitchedCell[],
          },
      );
      return { ...pitched, rows };
    });
    return patterns;
  };
  return {
    ...doc,
    patterns: {
      ...doc.patterns,
      bass: expand("bass", size * 2),
      lead: expand("lead", size * 2),
      // chords: diatonic chord rows = one per scale degree (chordRows).
      chords: expand("chords", size),
    },
  };
}

function initialDoc(): ProjectDocument {
  return validateProject(expandDefaultGrids(createDefaultProject()));
}

export const docStore = createStore<DocState>()(
  temporal(
    () => ({
      doc: initialDoc(),
    }),
    {
      limit: UNDO_LIMIT,
      // Undo tracks the document only — no UI state in history.
      partialize: (state) => ({ doc: state.doc }) as DocState,
      equality: (pastState, currentState) =>
        pastState.doc === currentState.doc,
    },
  ),
);

// ---------------------------------------------------------------------------
// Actions (plain functions over the vanilla store; Solid binds imperatively)
// ---------------------------------------------------------------------------

/** Immutably rewrite one drum step. */
function withDrumStep(
  doc: ProjectDocument,
  piece: DrumPiece,
  step: number,
  value: boolean,
): ProjectDocument {
  const patterns = doc.patterns.drums.map((p) => {
    if (p.kind !== "drums") return p;
    const steps = [...p.steps[piece]];
    steps[step] = value;
    return { ...p, steps: { ...p.steps, [piece]: steps } };
  });
  return { ...doc, patterns: { ...doc.patterns, drums: patterns } };
}

/** Immutably rewrite one pitched cell. */
function withPitchedCell(
  doc: ProjectDocument,
  lane: Exclude<LaneId, "drums">,
  degree: number,
  step: number,
  value: PitchedCell,
): ProjectDocument {
  const patterns = doc.patterns[lane].map((p) => {
    if (p.kind !== "pitched") return p;
    const rows = p.rows.map((row) => {
      if (row.degree !== degree) return row;
      const steps = [...row.steps];
      steps[step] = value;
      return { ...row, steps };
    });
    return { ...p, rows };
  });
  return { ...doc, patterns: { ...doc.patterns, [lane]: patterns } };
}

export interface ToggleResult {
  /** True when the toggle turned a cell ON (i.e. audition should fire). */
  readonly turnedOn: boolean;
}

export function toggleDrumStep(
  piece: DrumPiece,
  step: number,
): ToggleResult {
  const doc = docStore.getState().doc;
  const patterns = doc.patterns.drums.filter((p) => p.kind === "drums");
  const current = patterns.some((p) => p.steps[piece][step]);
  docStore.setState((s) => ({
    doc: withDrumStep(s.doc, piece, step, !current),
  }));
  return { turnedOn: !current };
}

export function togglePitchedCell(
  lane: Exclude<LaneId, "drums">,
  degree: number,
  step: number,
): ToggleResult {
  const doc = docStore.getState().doc;
  const row = doc.patterns[lane]
    .filter((p): p is PitchedPattern => p.kind === "pitched")
    .flatMap((p) => p.rows)
    .find((r) => r.degree === degree);
  const current: PitchedCell = row ? (row.steps[step] ?? 0) : 0;
  const next: PitchedCell = current === 0 ? 1 : 0;
  docStore.setState((s) => ({
    doc: withPitchedCell(s.doc, lane, degree, step, next),
  }));
  return { turnedOn: next === 1 };
}

export function undo(): void {
  docStore.temporal.getState().undo();
}

export function redo(): void {
  docStore.temporal.getState().redo();
}

export function canUndo(): boolean {
  return docStore.temporal.getState().pastStates.length > 0;
}

export function canRedo(): boolean {
  return docStore.temporal.getState().futureStates.length > 0;
}

/** All drum pieces in fixed row order (grid row labels). */
export const DRUM_ROWS: readonly DrumPiece[] = DRUM_PIECES;
