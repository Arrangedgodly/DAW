/**
 * Document store (IM-6, completed from the DES-4 pull-forward): one
 * zustand/vanilla store holding the valibot-validated ProjectDocument with
 * zundo temporal undo (limit 50, D1). Every mutation goes through `commit`,
 * which re-validates the whole document through the schema on write — an
 * invalid edit throws and leaves the store untouched.
 *
 * History coalescing (documented decision): rapid same-family edits within a
 * 350 ms trailing window collapse into ONE undo step. Families: all cell
 * toggles ("toggle" — grid painting), note edits ("note:<lane>:<pattern>",
 * SC-2), per-lane gate drags ("gate:<lane>"), per-knob transport drags
 * ("transport:<field>"). The first edit of a family
 * (or after a >350 ms gap, or after any undo/redo) records normally; follow-up
 * edits in the window skip the history push, so undo jumps back to the state
 * before the gesture instead of mid-stroke. Implementation: a one-shot flag
 * consumed by zundo's `equality` hook (returning true = "no new snapshot").
 *
 * Law (D1): the grid renderer and playhead NEVER read this store at 60 Hz —
 * pattern edits land here, a subscription recompiles lane events for the
 * engine, and the Solid layer only re-renders on shape changes. Ephemeral
 * selection/focus state lives in selection.ts (Solid signals), NOT here.
 */

import { createStore } from "zustand/vanilla";
import { temporal } from "zundo";
import {
  DEFAULT_LANE_MIX,
  DRUM_PIECES,
  type DrumPiece,
  type FxDevice,
  type LaneGate,
  type LaneId,
  type LaneMix,
  MAX_FX_PER_LANE,
  MAX_NOTE_LENGTH,
  MIN_NOTE_LENGTH,
  NOTE_LENGTH_GRANULARITY,
  type Note,
  type Pattern,
  type PatternBars,
  type PitchedPattern,
  type ProjectDocument,
  type SampleProvenanceEntry,
  type ScaleConfig,
  type Transport,
  createDefaultProject,
  effectiveLaneMix,
  pitchedCellAt,
  resolveGateSteps,
  togglePitchedNote,
} from "../document/schema";
import { validateProject } from "../document/validate";
import { euclid } from "../audio/euclid";
import { sampleRefsForSound } from "../audio/presets";
import { type ModeName, modeSize } from "../document/scales";
import { type FxDeviceType, defaultFxDevice, reorderChain } from "./fxStrip";
import { normalizeProjectName } from "./projectName";

const UNDO_LIMIT = 50;
const COALESCE_WINDOW_MS = 350;

export interface DocState {
  readonly doc: ProjectDocument;
}

// --- Coalescing internals (see header for the strategy) ---------------------

let skipNextHistoryEntry = false;
let lastCoalesceKey: string | null = null;
let lastCoalesceAt = 0;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Expand the default project's pitched patterns to full editing grids:
 * bass/lead get ~2 octaves of scale-degree rows, chords keeps one octave of
 * diatonic chord rows (matching the row model DES-4 renders). Pure; only run
 * at store creation so the shipped default document stays untouched.
 */
function expandDefaultGrids(doc: ProjectDocument): ProjectDocument {
  const size = modeSize(doc.scale.mode);
  const degrees = (count: number) => Array.from({ length: count }, (_, i) => i);
  const expand = (lane: Exclude<LaneId, "drums">, count: number) => {
    const patterns = doc.patterns[lane].map((p) => {
      const pitched = p as PitchedPattern;
      if (pitched.kind !== "pitched") return p;
      // v2 (SC-1): the row manifest replaces wholesale exactly as the v0 row
      // arrays did — notes (content) are untouched.
      return { ...pitched, rowDegrees: degrees(count) };
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

/**
 * A fresh default document for a NEW project (HU-2 empty-project flow):
 * exactly what the store boots with — empty 1-bar patterns, expanded editing
 * grids, "Untitled". `loadDocument` accepts the result directly.
 */
export function createFreshProjectDocument(): ProjectDocument {
  return initialDoc();
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
      equality: (pastState, currentState) => {
        // Consume the one-shot coalescing flag FIRST so it can never leak
        // into an unrelated later commit.
        const skip = skipNextHistoryEntry;
        skipNextHistoryEntry = false;
        return pastState.doc === currentState.doc || skip;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Actions (plain functions over the vanilla store; Solid binds imperatively)
// ---------------------------------------------------------------------------

/**
 * The single write path: validate the next document through the full schema
 * (valibot parse + semantic checks), then swap it in. Throws on invalid input
 * with the store untouched. `coalesceKey` opts the edit into rapid-edit
 * history coalescing (same key within the window → no new undo step).
 *
 * Note: the PARSED clone is discarded and the original `next` object stored.
 * valibot's safeParse always builds a fresh object tree, which would defeat
 * the identity-based diffing in engineBridge/LaneGrid; since every `next`
 * here is derived immutably from an already-valid, already-normalized
 * document, validation is a gate, not a transformation. (Load paths from
 * untrusted JSON keep using validateProject's normalized output.)
 */
function commit(next: ProjectDocument, coalesceKey?: string): ProjectDocument {
  validateProject(next); // throws → store unchanged
  if (coalesceKey !== undefined) {
    if (
      lastCoalesceKey === coalesceKey &&
      nowMs() - lastCoalesceAt < COALESCE_WINDOW_MS
    ) {
      skipNextHistoryEntry = true;
      // zundo only clears the redo future when it records a past state; a
      // skipped entry must clear it ourselves (a new edit invalidates redo).
      docStore.temporal.setState({ futureStates: [] });
    }
    lastCoalesceKey = coalesceKey;
    lastCoalesceAt = nowMs();
  } else {
    lastCoalesceKey = null;
  }
  docStore.setState({ doc: next });
  return next;
}

/** Deep clone through JSON — documents are JSON-safe by construction (MF-1). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

/**
 * Resolve a lane's gate into note steps at the CURRENT document BPM (the
 * single-click default length — the SC-1 law shared with the migration).
 */
function laneGateSteps(doc: ProjectDocument, lane: LaneId): number {
  const conf = doc.lanes.find((l) => l.id === lane);
  if (!conf) return 1;
  return resolveGateSteps(conf.gate, doc.transport.bpm);
}

/**
 * Immutably flip one pitched cell in EVERY pattern of the lane (v0 wrote the
 * same cell across all patterns; v2 applies the same law per pattern through
 * the pure note toggle — see schema.ts `togglePitchedNote`). Patterns whose
 * row manifest lacks the degree are untouched, exactly as v0 skipped rows
 * that did not exist.
 */
function withPitchedCellToggled(
  doc: ProjectDocument,
  lane: Exclude<LaneId, "drums">,
  degree: number,
  step: number,
): ProjectDocument {
  const gateSteps = laneGateSteps(doc, lane);
  const patterns = doc.patterns[lane].map((p) => {
    if (p.kind !== "pitched") return p;
    if (!p.rowDegrees.includes(degree)) return p;
    return togglePitchedNote(p, gateSteps, degree, step).pattern;
  });
  return { ...doc, patterns: { ...doc.patterns, [lane]: patterns } };
}

export interface ToggleResult {
  /** True when the toggle turned a cell ON (i.e. audition should fire). */
  readonly turnedOn: boolean;
}

export function toggleDrumStep(piece: DrumPiece, step: number): ToggleResult {
  const doc = docStore.getState().doc;
  const patterns = doc.patterns.drums.filter((p) => p.kind === "drums");
  const current = patterns.some((p) => p.steps[piece][step]);
  commit(
    withDrumStep(docStore.getState().doc, piece, step, !current),
    "toggle",
  );
  return { turnedOn: !current };
}

export function togglePitchedCell(
  lane: Exclude<LaneId, "drums">,
  degree: number,
  step: number,
): ToggleResult {
  const doc = docStore.getState().doc;
  const gateSteps = laneGateSteps(doc, lane);
  // v0 read: the cell of the FIRST pattern whose manifest carries the degree.
  const firstWithDegree = doc.patterns[lane]
    .filter((p): p is PitchedPattern => p.kind === "pitched")
    .find((p) => p.rowDegrees.includes(degree));
  const current = firstWithDegree
    ? pitchedCellAt(firstWithDegree, gateSteps, degree, step)
    : 0;
  const turnedOn = current === 0;
  if (firstWithDegree) {
    commit(
      withPitchedCellToggled(docStore.getState().doc, lane, degree, step),
      "toggle",
    );
  }
  return { turnedOn };
}

// ---------------------------------------------------------------------------
// Note-edit actions (SC-2) — the editing surface for explicit v2 notes. The
// click UI keeps `togglePitchedCell` (v0 law) until IN-2's drag gestures land;
// these actions are pattern-scoped (drag edits the pattern being displayed)
// and coalesce per `note:<lane>:<pattern>` so one gesture = one undo step.
// ---------------------------------------------------------------------------

/**
 * Rewrite one pitched pattern immutably. The patch returns the SAME pattern
 * object when it would change nothing; a fully no-op edit yields null so the
 * caller can skip the commit (no history entry, identities preserved).
 */
function withPitchedPattern(
  doc: ProjectDocument,
  lane: Exclude<LaneId, "drums">,
  patternId: string,
  patch: (pattern: PitchedPattern) => PitchedPattern,
): ProjectDocument | null {
  let changed = false;
  const patterns = doc.patterns[lane].map((p) => {
    if (p.kind !== "pitched" || p.id !== patternId) return p;
    const next = patch(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed
    ? { ...doc, patterns: { ...doc.patterns, [lane]: patterns } }
    : null;
}

/** Snap a gesture length onto the note grid, clamped to the schema bounds. */
function snapNoteLength(length: number): number {
  const snapped =
    Math.round(length / NOTE_LENGTH_GRANULARITY) * NOTE_LENGTH_GRANULARITY;
  return Math.min(MAX_NOTE_LENGTH, Math.max(MIN_NOTE_LENGTH, snapped));
}

/**
 * Add (or replace, when a note is already anchored at the same degree+start)
 * one explicit note in the target pattern. The degree must exist in the
 * pattern's row manifest — a note with no visible row would neither display
 * nor sound (the same law the compiler applies). Returns false (store
 * untouched) when the pattern or row does not exist. Invalid start/shape
 * values throw through validation with the store untouched.
 */
export function addNote(
  lane: Exclude<LaneId, "drums">,
  patternId: string,
  note: Note,
): boolean {
  const doc = docStore.getState().doc;
  const next = withPitchedPattern(doc, lane, patternId, (p) => {
    if (!p.rowDegrees.includes(note.degree)) return p;
    const snapped = { ...note, length: snapNoteLength(note.length) };
    const notes = p.notes.filter(
      (n) => !(n.degree === note.degree && n.start === note.start),
    );
    notes.push(snapped);
    notes.sort((a, b) => a.degree - b.degree || a.start - b.start);
    return { ...p, notes };
  });
  if (!next) return false; // no pattern / degree outside the manifest
  commit(next, `note:${lane}:${patternId}`);
  return true;
}

/**
 * Remove the note anchored at (degree, start) in the target pattern. Returns
 * false (store untouched) when no such note exists.
 */
export function removeNote(
  lane: Exclude<LaneId, "drums">,
  patternId: string,
  degree: number,
  start: number,
): boolean {
  const doc = docStore.getState().doc;
  const next = withPitchedPattern(doc, lane, patternId, (p) => {
    if (!p.notes.some((n) => n.degree === degree && n.start === start)) {
      return p;
    }
    return {
      ...p,
      notes: p.notes.filter((n) => !(n.degree === degree && n.start === start)),
    };
  });
  if (!next) return false;
  commit(next, `note:${lane}:${patternId}`);
  return true;
}

/**
 * Set the length of the note anchored at (degree, start) — the resize
 * primitive for edge-drag and keyboard resize (IN-2). The length is snapped
 * to the 0.25-step grid and clamped to the schema bounds (gesture-friendly;
 * validation would reject off-grid values). Returns false (store untouched)
 * when no such note exists or the snapped length is unchanged.
 */
export function resizeNote(
  lane: Exclude<LaneId, "drums">,
  patternId: string,
  degree: number,
  start: number,
  length: number,
): boolean {
  const doc = docStore.getState().doc;
  const next = withPitchedPattern(doc, lane, patternId, (p) => {
    let touched = false;
    const snapped = snapNoteLength(length);
    const notes = p.notes.map((n) => {
      if (n.degree !== degree || n.start !== start) return n;
      if (n.length === snapped) return n;
      touched = true;
      return { ...n, length: snapped };
    });
    return touched ? { ...p, notes } : p;
  });
  if (!next) return false;
  commit(next, `note:${lane}:${patternId}`);
  return true;
}

/**
 * PX-3 Euclidean fill: paint E(pulses, ·) rotated by `rotation` into one
 * drum piece's row — the one-shot grid-paint commit behind the per-row fill
 * control (preview happens in the UI; only this writes). Like the toggles,
 * it rewrites the piece's row in EVERY drums pattern, each at its own step
 * count, so multi-bar patterns get the pattern over their full length. After
 * the commit the cells are ordinary data — hand editing works immediately.
 * Rapid re-fills of the same piece coalesce into one undo step.
 */
export function applyEuclidFill(
  piece: DrumPiece,
  pulses: number,
  rotation: number,
): void {
  const doc = docStore.getState().doc;
  const patterns = doc.patterns.drums.map((p) => {
    if (p.kind !== "drums") return p;
    const filled = euclid(pulses, p.steps[piece].length, rotation);
    return { ...p, steps: { ...p.steps, [piece]: filled } };
  });
  commit(
    { ...doc, patterns: { ...doc.patterns, drums: patterns } },
    `fill:${piece}`,
  );
}

// ---------------------------------------------------------------------------
// Lane config: gate, preset/kit, scale overrides
// ---------------------------------------------------------------------------

function withLane(
  doc: ProjectDocument,
  lane: LaneId,
  patch: (
    lane: ProjectDocument["lanes"][number],
  ) => ProjectDocument["lanes"][number],
): ProjectDocument {
  const lanes = doc.lanes.map((l) => (l.id === lane ? patch(l) : l));
  return { ...doc, lanes };
}

/** Set the gate length of one lane (cell-width raise). Coalesced while dragging. */
export function setLaneGate(lane: LaneId, gate: LaneGate): void {
  commit(
    withLane(docStore.getState().doc, lane, (l) => ({ ...l, gate })),
    `gate:${lane}`,
  );
}

/** Choose the drum kit (drums lane) or the voice preset (pitched lanes). */
export function setLaneSoundId(lane: LaneId, presetOrKitId: string): void {
  commit(
    withLane(docStore.getState().doc, lane, (l) =>
      l.id === "drums"
        ? { ...l, kitId: presetOrKitId }
        : { ...l, presetId: presetOrKitId },
    ),
  );
}

// ---------------------------------------------------------------------------
// RC-1 (v3, i3-2): per-lane register transpose — writes the v3 `octave` field
// (schema PitchedLane.octave, −3..+3). Canonical-empty at 0 (the lane-mix
// law: default-shaped documents stay byte-stable on the wire, so every
// pre-RC-1 document and both codec goldens are untouched). Rapid repeats
// coalesce per `octave:<lane>` (held-key repeats = ONE undo gesture — the
// note-resize discrete-commit precedent). The engineBridge treats octave as
// a compile input, so the lane recompiles LIVE (audible); compile.ts and
// exportMidi.ts consume it as an offset on the preset's octave base.
// ---------------------------------------------------------------------------

/**
 * Set one PITCHED lane's octave register offset (clamped to the schema
 * domain by validation; the UI funnel in selection.ts pre-clamps and
 * announces). Writing 0 DELETES the field (canonical empty form).
 */
export function setLaneOctave(
  lane: Exclude<LaneId, "drums">,
  octave: number,
): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane);
  if (!conf || conf.id === "drums") return;
  if ((conf.octave ?? 0) === octave) return; // no-op never commits
  commit(
    withLane(doc, lane, (l) => {
      const merged = { ...l } as typeof l & { octave?: number };
      if (octave === 0) delete merged.octave;
      else merged.octave = octave;
      return merged;
    }),
    `octave:${lane}`,
  );
}

// ---------------------------------------------------------------------------
// Document-replacement listeners (RC-1): view state that models "per
// document" position (selection.ts's register windows) resets when a whole
// document is LOADED — boot restore, project switch, NEW. Registered from
// selection.ts through this seam so the store never imports view modules
// (no cycle; ordinary edits and undo/redo never fire it).
// ---------------------------------------------------------------------------

const docReplacedListeners = new Set<() => void>();

/** Subscribe to whole-document replacements; returns the unsubscribe. */
export function onDocumentReplaced(fn: () => void): () => void {
  docReplacedListeners.add(fn);
  return () => docReplacedListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// PS-4 — sample-voice provenance maintenance (the PS-3 field's writer).
//
// Law (PS-3 schema): a project whose lanes use sample-backed sounds records
// an echo of each asset's manifest row in doc.sampleProvenance, and the map
// is canonical-empty (field omitted) when no lane does. This keeps the doc
// self-describing through selection, reload, import, AND undo: the store
// re-derives the map from the current lane sounds whenever it drifts.
//
// - The manifest is loaded through a DYNAMIC import — the content module
//   stays out of the initial JS graph, and a synth-only document (the boot
//   path, TH-4(d)) never triggers the import at all.
// - Repair commits SKIP the undo history (derived metadata, not an edit);
//   redo futures are deliberately left intact — a redo whose doc carries a
//   stale map self-heals through this same pass.
// ---------------------------------------------------------------------------

/** Asset ids a document's current lane sounds reference (pure). */
function sampleRefsOfDoc(doc: ProjectDocument): Set<string> {
  const refs = new Set<string>();
  for (const lane of doc.lanes) {
    for (const ref of sampleRefsForSound(
      lane.id === "drums" ? lane.kitId : lane.presetId,
    )) {
      refs.add(ref);
    }
  }
  return refs;
}

function provenanceInSync(doc: ProjectDocument, refs: Set<string>): boolean {
  const keys = new Set(Object.keys(doc.sampleProvenance ?? {}));
  if (keys.size !== refs.size) return false;
  for (const ref of refs) if (!keys.has(ref)) return false;
  return true;
}

let provenanceRepairRunning = false;

/**
 * Bring doc.sampleProvenance back in step with the lane sounds (no-op when
 * already in sync). Fire-and-forget; every doc change re-runs it.
 */
function maintainSampleProvenance(): void {
  if (provenanceRepairRunning) return;
  const doc0 = docStore.getState().doc;
  if (provenanceInSync(doc0, sampleRefsOfDoc(doc0))) return;
  provenanceRepairRunning = true;
  void (async () => {
    try {
      // Loop: another edit may land while the import resolves — re-check
      // until a write sticks against the CURRENT document.
      for (let guard = 0; guard < 8; guard++) {
        const doc = docStore.getState().doc;
        const refs = sampleRefsOfDoc(doc);
        if (provenanceInSync(doc, refs)) return;
        const { CONTENT_ASSETS } = await import("../assets/content/loader");
        const echo: Record<string, SampleProvenanceEntry> = {};
        for (const ref of refs) {
          const asset = CONTENT_ASSETS.find((a) => a.id === ref);
          if (!asset) continue; // unknown ref is validation's business, not ours
          echo[ref] = {
            license: asset.license,
            sourceUrl: asset.sourceUrl,
            author: asset.author,
          };
        }
        const next =
          refs.size === 0
            ? (() => {
                const { sampleProvenance: _stale, ...rest } = doc;
                void _stale;
                return rest;
              })()
            : { ...doc, sampleProvenance: echo };
        validateProject(next); // manifest echoes must always parse
        skipNextHistoryEntry = true; // derived metadata: no undo step
        docStore.setState({ doc: next });
      }
    } finally {
      provenanceRepairRunning = false;
    }
  })();
}

docStore.subscribe(() => maintainSampleProvenance());

// ---------------------------------------------------------------------------
// LY-1 quadrant mix: per-lane volume / mute / solo (optional document fields,
// canonical-empty at defaults — the chainCues precedent, no version bump).
// ---------------------------------------------------------------------------

/**
 * Patch one lane's mix. Fields left undefined keep their current effective
 * value. Values equal to the defaults are written as ABSENT keys (canonical
 * empty form — keeps default-shaped documents byte-stable on the wire).
 * Rapid drags of the VOLUME slider coalesce per `mix:<lane>`.
 */
export function setLaneMix(
  lane: LaneId,
  patch: Partial<Pick<LaneMix, "volume" | "mute" | "solo">>,
): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  const current = effectiveLaneMix(conf);
  const next: LaneMix = { ...current, ...patch };
  commit(
    withLane(doc, lane, (l) => {
      const merged = { ...l } as typeof l & {
        volume?: number;
        mute?: boolean;
        solo?: boolean;
      };
      if (next.volume === DEFAULT_LANE_MIX.volume) delete merged.volume;
      else merged.volume = next.volume;
      if (!next.mute) delete merged.mute;
      else merged.mute = true;
      if (!next.solo) delete merged.solo;
      else merged.solo = true;
      return merged;
    }),
    `mix:${lane}`,
  );
}

// ---------------------------------------------------------------------------
// FX chains (DES-5): add/remove/move/bypass/param — every edit rides the lane
// object identity, so engineBridge's syncLaneConfig pushes it to the session
// live (param tweaks ramp on AudioParams, topology edits rebuild glitch-free).
// ---------------------------------------------------------------------------

/** Append a default device; no-op (returns false) at MAX_FX_PER_LANE. */
export function addFxDevice(lane: LaneId, type: FxDeviceType): boolean {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  if (conf.fxChain.length >= MAX_FX_PER_LANE) return false;
  commit(
    withLane(doc, lane, (l) => ({
      ...l,
      fxChain: [...l.fxChain, defaultFxDevice(type)],
    })),
  );
  return true;
}

/** Remove the device at `index` (no-op when out of range). */
export function removeFxDevice(lane: LaneId, index: number): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  if (index < 0 || index >= conf.fxChain.length) return;
  commit(
    withLane(doc, lane, (l) => ({
      ...l,
      fxChain: l.fxChain.filter((_, i) => i !== index),
    })),
  );
}

/**
 * Move a device (drag drop or keyboard move buttons). Target is clamped;
 * a no-op move keeps the lane identity (nothing re-syncs).
 */
export function moveFxDevice(lane: LaneId, from: number, to: number): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  const next = reorderChain(conf.fxChain, from, to);
  if (next === conf.fxChain) return;
  commit(withLane(doc, lane, (l) => ({ ...l, fxChain: next })));
}

/** Set one device's bypass state (lit/dimmed on the module). */
export function setFxBypassed(
  lane: LaneId,
  index: number,
  bypassed: boolean,
): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  if (index < 0 || index >= conf.fxChain.length) return;
  commit(
    withLane(doc, lane, (l) => ({
      ...l,
      fxChain: l.fxChain.map((d, i) => (i === index ? { ...d, bypassed } : d)),
    })),
  );
}

/**
 * Set one param on one device (numeric sliders and choice selects). Throws
 * through validation on out-of-range values (store untouched). Rapid slider
 * drags coalesce into one undo step per param (`fxparam:<lane>:<i>:<key>`).
 */
export function setFxParam(
  lane: LaneId,
  index: number,
  key: string,
  value: number | string,
): void {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane)!;
  const device = conf.fxChain[index];
  if (!device)
    throw new Error(`setFxParam: no device ${index} in lane '${lane}'`);
  commit(
    withLane(doc, lane, (l) => ({
      ...l,
      fxChain: l.fxChain.map((d, i) =>
        i === index
          ? ({ ...d, params: { ...d.params, [key]: value } } as FxDevice)
          : d,
      ),
    })),
    `fxparam:${lane}:${index}:${key}`,
  );
}

// ---------------------------------------------------------------------------
// Scale mutations
// ---------------------------------------------------------------------------

/** Set the project-wide default scale (root and/or mode). */
export function setProjectScale(scale: ScaleConfig): void {
  commit({ ...docStore.getState().doc, scale });
}

/** Set (or clear with null) one lane's scale override. */
export function setLaneScaleOverride(
  lane: LaneId,
  scale: ScaleConfig | null,
): void {
  const doc = docStore.getState().doc;
  const current: Partial<Record<LaneId, ScaleConfig>> = {
    ...(doc.laneOverrides ?? {}),
  };
  if (scale === null) delete current[lane];
  else current[lane] = scale;
  // Collapse to null when no override remains (schema's canonical empty form).
  const hasAny = (Object.keys(current) as LaneId[]).some(
    (k) => current[k] != null,
  );
  commit({ ...doc, laneOverrides: hasAny ? current : null });
}

// ---------------------------------------------------------------------------
// Transport (persisted to the document; engineBridge syncs the session)
// ---------------------------------------------------------------------------

/** Patch bpm/swing/metronome in the document. Slider drags coalesce. */
export function setTransport(
  patch: Partial<Pick<Transport, "bpm" | "swing" | "metronome">>,
): void {
  const doc = docStore.getState().doc;
  commit(
    { ...doc, transport: { ...doc.transport, ...patch } },
    Object.keys(patch).length === 1
      ? `transport:${Object.keys(patch)[0]}`
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Pattern management (store-level primitives; the pattern UI is DES-6/IM-7)
// ---------------------------------------------------------------------------

function pitchedRowCount(
  lane: Exclude<LaneId, "drums">,
  doc: ProjectDocument,
): number {
  const size = modeSize(effectiveMode(doc, lane));
  return lane === "chords" ? size : size * 2;
}

function effectiveMode(doc: ProjectDocument, lane: LaneId): ModeName {
  return (doc.laneOverrides?.[lane] ?? doc.scale).mode;
}

function newPatternId(lane: LaneId): string {
  const existing = docStore.getState().doc.patterns[lane].map((p) => p.id);
  let n = existing.length + 1;
  while (existing.includes(`${lane}-${n}`)) n++;
  return `${lane}-${n}`;
}

/** The blank-pattern construction shared by addPattern + appendBlankPattern. */
function blankPattern(
  lane: LaneId,
  doc: ProjectDocument,
  id: string,
  name: string,
  bars: PatternBars,
): Pattern {
  return lane === "drums"
    ? {
        kind: "drums",
        id,
        name,
        bars,
        steps: Object.fromEntries(
          DRUM_PIECES.map((piece) => [
            piece,
            new Array(16 * bars).fill(false),
          ]),
        ) as Record<DrumPiece, boolean[]>,
      }
    : {
        kind: "pitched",
        id,
        name,
        bars,
        rowDegrees: Array.from(
          { length: pitchedRowCount(lane, doc) },
          (_, degree) => degree,
        ),
        notes: [],
      };
}

/** Append a new empty pattern to a lane. Returns the new pattern id. */
export function addPattern(
  lane: LaneId,
  bars: PatternBars = 1,
  name = "?",
): string {
  const doc = docStore.getState().doc;
  const id = newPatternId(lane);
  const pattern = blankPattern(lane, doc, id, name, bars);
  commit({
    ...doc,
    patterns: { ...doc.patterns, [lane]: [...doc.patterns[lane], pattern] },
  });
  return id;
}

/** Deep-copy a pattern under a fresh id. Returns the new pattern id. */
export function duplicatePattern(lane: LaneId, patternId: string): string {
  const doc = docStore.getState().doc;
  const source = doc.patterns[lane].find((p) => p.id === patternId);
  if (!source)
    throw new Error(
      `duplicatePattern: no pattern '${patternId}' in lane '${lane}'`,
    );
  const id = newPatternId(lane);
  const copy = { ...deepClone(source), id, name: `${source.name}+` };
  commit({
    ...doc,
    patterns: { ...doc.patterns, [lane]: [...doc.patterns[lane], copy] },
  });
  return id;
}

/** Rename a pattern. */
export function renamePattern(
  lane: LaneId,
  patternId: string,
  name: string,
): void {
  const doc = docStore.getState().doc;
  const patterns = doc.patterns[lane].map((p) =>
    p.id === patternId ? { ...p, name } : p,
  );
  commit({ ...doc, patterns: { ...doc.patterns, [lane]: patterns } });
}

/**
 * Rename the CURRENT project (i6 §2.3) — the renamePattern precedent applied
 * to the document title. One committed blur/Enter = one commit with NO
 * coalescing key (one history entry per rename); the live doc swap is all it
 * takes — the autosave flush re-reads this doc and its single put lands the
 * name in the record envelope AND the encoded json.
 *
 * No-ops (§2.2): empty-after-normalization input, and a normalized name
 * equal to the current one (no write, no history entry, no updatedAt bump).
 */
export function setProjectName(name: string): void {
  const normalized = normalizeProjectName(name);
  if (normalized === undefined) return;
  const doc = docStore.getState().doc;
  if (normalized === doc.name) return;
  commit({ ...doc, name: normalized });
}

/**
 * Replace a lane's song chain (ordered pattern ids; ids may repeat). Throws
 * via validation when an id does not exist in the lane. Cue labels are
 * positional, so they ride the rewrite index-aligned (slot i keeps its label
 * when a chain rewrite keeps slot i; new slots start unlabeled).
 */
export function setLaneChain(
  lane: LaneId,
  patternIds: readonly string[],
): void {
  const doc = docStore.getState().doc;
  commit(
    withChain(doc, lane, [...patternIds], (old) =>
      patternIds.map((_, i) => old[i] ?? null),
    ),
  );
}

// ---------------------------------------------------------------------------
// DES-6: pattern management + chain slot edits + named cue labels
// ---------------------------------------------------------------------------

/**
 * Rewrite one lane's chain plus its parallel cue array.
 *
 * IN-4 fix (verifier finding: double `+`-append then Delete threw an uncaught
 * ProjectValidationError): the cue callback maps the OLD chain's cue slots
 * positionally, so it must receive the OLD array padded to the OLD chain
 * length — padding to the NEW length first truncated away exactly the entry a
 * slot removal had to drop, building a cues array one short of the chain.
 * The callback's result is padded (never truncated) to the NEW length so the
 * parallel invariant holds for every caller by construction.
 */
function withChain(
  doc: ProjectDocument,
  lane: LaneId,
  chain: string[],
  cues: (old: readonly (string | null)[]) => (string | null)[],
): ProjectDocument {
  const old = padCues(doc.chainCues?.[lane] ?? [], doc.songChain[lane].length);
  const nextCues = padCues(cues(old), chain.length);
  // Full four-lane object (schema requires every lane key, parallel lengths).
  const merged: Record<LaneId, (string | null)[]> = {
    drums: padCues(doc.chainCues?.drums ?? [], doc.songChain.drums.length),
    bass: padCues(doc.chainCues?.bass ?? [], doc.songChain.bass.length),
    chords: padCues(doc.chainCues?.chords ?? [], doc.songChain.chords.length),
    lead: padCues(doc.chainCues?.lead ?? [], doc.songChain.lead.length),
  };
  merged[lane] = nextCues;
  const anyLabel = (Object.keys(merged) as LaneId[]).some((l) =>
    merged[l].some((c) => c != null && c.trim() !== ""),
  );
  return {
    ...doc,
    songChain: { ...doc.songChain, [lane]: chain },
    // Canonical empty form: null when no lane carries a label anymore.
    chainCues: anyLabel ? merged : null,
  };
}

function padCues(
  slots: readonly (string | null)[],
  length: number,
): (string | null)[] {
  return Array.from({ length }, (_, i) => slots[i] ?? null);
}

/**
 * Remove a pattern from a lane. Refuses (returns false) when it is the lane's
 * last pattern — a lane always keeps one. All chain occurrences go with it;
 * surviving slots shift left POSITIONALLY, each keeping its own cue label
 * (repeats of a surviving pattern keep their per-slot labels). If the chain
 * emptied, the first remaining pattern takes slot 0.
 */
export function removePattern(lane: LaneId, patternId: string): boolean {
  const doc = docStore.getState().doc;
  if (doc.patterns[lane].length <= 1) return false;
  if (!doc.patterns[lane].some((p) => p.id === patternId)) return false;
  const nextPatterns = doc.patterns[lane].filter((p) => p.id !== patternId);
  const base = { ...doc, patterns: { ...doc.patterns, [lane]: nextPatterns } };
  const cues = doc.chainCues?.[lane] ?? [];
  const kept = doc.songChain[lane]
    .map((id, i) => ({ id, cue: cues[i] ?? null }))
    .filter((slot) => slot.id !== patternId);
  if (kept.length === 0) {
    commit(withChain(base, lane, [nextPatterns[0]!.id], () => [null]));
    return true;
  }
  if (kept.length === doc.songChain[lane].length) {
    commit(base); // pattern existed but was never chained
    return true;
  }
  commit(
    withChain(
      base,
      lane,
      kept.map((s) => s.id),
      () => kept.map((s) => s.cue),
    ),
  );
  return true;
}

/**
 * BC-1 (I3-a — the rail `+` law): create a NEW blank pattern (caller-supplied
 * next-letter name; bars = addPattern's existing default, 1) AND append it to
 * the lane's chain in ONE commit. The rail's `+` button and rail-local
 * `+`/`=` key both land here; the caller selects the returned id for editing
 * (selection is view state, selection.ts — never document).
 *
 * Undo discipline (the recorded production decision): one `+` press = ONE
 * undo step — the create and its append co-revert, following the
 * removePattern precedent (a patterns+chain structural rewrite in a single
 * commit), NOT a coalescing family (those exist for rapid REPEAT edits
 * within the 350 ms window — a family here would wrongly glue two deliberate
 * `+` presses into one step; structural actions never coalesce).
 */
export function appendBlankPattern(
  lane: LaneId,
  name: string,
  bars: PatternBars = 1,
): string {
  const doc = docStore.getState().doc;
  const id = newPatternId(lane);
  const pattern = blankPattern(lane, doc, id, name, bars);
  commit(
    // The appended slot's cue rides withChain's null padding (unlabeled).
    withChain(
      {
        ...doc,
        patterns: { ...doc.patterns, [lane]: [...doc.patterns[lane], pattern] },
      },
      lane,
      [...doc.songChain[lane], id],
      (old) => [...old],
    ),
  );
  return id;
}

/** Append one chain slot playing `patternId` (unlabeled). */
export function appendChainSlot(lane: LaneId, patternId: string): void {
  const doc = docStore.getState().doc;
  if (!doc.patterns[lane].some((p) => p.id === patternId)) return;
  // The callback returns the OLD slots as-is; withChain pads the trailing
  // null for the appended slot.
  commit(
    withChain(doc, lane, [...doc.songChain[lane], patternId], (old) => [
      ...old,
    ]),
  );
}

// ---------------------------------------------------------------------------
// LL-1 (iteration 3, i3-4): pattern RESIZE — the powers-of-two length ladder
// (1·2·4·8·16·32·64·128) as an after-create edit. Policy (the Hulk
// resolution, fixed): grow ALWAYS proceeds; shrink proceeds only when NO
// note would be lost past the new end — otherwise a TYPED refusal (never a
// silent truncation; the caller announces the blocking note). The blocking
// note is deterministic: greatest end (start + length), ties broken by the
// latest start (the focused-note determinism law, IN-2).
// ---------------------------------------------------------------------------

/** The blocking note a refusal names (row identity + extent, UI formats). */
export interface ResizeBlockingNote {
  /** Drum piece (drums patterns) or scale-degree row (pitched patterns). */
  readonly row: DrumPiece | number;
  /** Note anchor step (0-based). */
  readonly start: number;
  /** Note extent in steps (drums hits are always 1). */
  readonly length: number;
}

export type ResizePatternResult =
  | { readonly ok: true; readonly bars: PatternBars }
  | { readonly ok: false; readonly reason: "not-found" | "no-op" }
  | {
      readonly ok: false;
      readonly reason: "blocked";
      readonly toBars: PatternBars;
      readonly blocking: ResizeBlockingNote;
    };

/**
 * Resize one pattern to `bars` (vocabulary size). Grow extends drum rows
 * with empty steps (pitched notes never change on grow); a clean shrink
 * truncates drum rows and leaves pitched notes byte-identical — every note
 * fits the new extent. Refuses — store untouched — when any note would be
 * lost past the new end: a drum hit at step ≥ newSteps, or a pitched note
 * whose end (start + length) exceeds newSteps (no silent truncation; the
 * overhang-wrap law never applies to the RESIZE path — the user moves or
 * shortens the note first). Undo family `resize:<lane>:<pattern>` (KL-1:
 * held-key ladder repeats coalesce like the octave family — one gesture).
 */
export function resizePattern(
  lane: LaneId,
  patternId: string,
  bars: PatternBars,
): ResizePatternResult {
  const doc = docStore.getState().doc;
  const pattern = doc.patterns[lane].find((p) => p.id === patternId);
  if (!pattern) return { ok: false, reason: "not-found" };
  if (pattern.bars === bars) return { ok: false, reason: "no-op" };
  const newSteps = bars * 16;
  if (bars < pattern.bars) {
    // Shrink: scan for anything the truncation would lose.
    if (pattern.kind === "drums") {
      let blocking: ResizeBlockingNote | null = null;
      for (const piece of DRUM_PIECES) {
        const steps = pattern.steps[piece];
        for (let step = newSteps; step < steps.length; step++) {
          if (!steps[step]) continue;
          // Deterministic: greatest end (a hit's end is step + 1).
          if (
            !blocking ||
            step + 1 > blocking.start + blocking.length ||
            (step + 1 === blocking.start + blocking.length &&
              step > blocking.start)
          ) {
            blocking = { row: piece, start: step, length: 1 };
          }
        }
      }
      if (blocking) {
        return { ok: false, reason: "blocked", toBars: bars, blocking };
      }
    } else {
      let blocking: ResizeBlockingNote | null = null;
      for (const note of pattern.notes) {
        if (note.start + note.length <= newSteps) continue;
        if (
          !blocking ||
          note.start + note.length > blocking.start + blocking.length ||
          (note.start + note.length === blocking.start + blocking.length &&
            note.start > blocking.start)
        ) {
          blocking = { row: note.degree, start: note.start, length: note.length };
        }
      }
      if (blocking) {
        return { ok: false, reason: "blocked", toBars: bars, blocking };
      }
    }
  }
  const nextPatterns = doc.patterns[lane].map((p) => {
    if (p.id !== patternId) return p;
    if (p.kind === "drums") {
      const steps = {} as Record<DrumPiece, boolean[]>;
      for (const piece of DRUM_PIECES) {
        const row = p.steps[piece];
        steps[piece] =
          row.length < newSteps
            ? [...row, ...new Array(newSteps - row.length).fill(false)]
            : row.slice(0, newSteps);
      }
      return { ...p, bars, steps };
    }
    return { ...p, bars };
  });
  commit(
    { ...doc, patterns: { ...doc.patterns, [lane]: nextPatterns } },
    `resize:${lane}:${patternId}`,
  );
  return { ok: true, bars };
}

/** Remove chain slot `index`; refuses (returns false) on the last slot. */
export function removeChainSlot(lane: LaneId, index: number): boolean {
  const doc = docStore.getState().doc;
  const chain = doc.songChain[lane];
  if (chain.length <= 1 || index < 0 || index >= chain.length) return false;
  commit(
    withChain(
      doc,
      lane,
      chain.filter((_, i) => i !== index),
      (old) => old.filter((_, i) => i !== index),
    ),
  );
  return true;
}

/**
 * Set/clear one chain slot's named cue label (the DES-6 raise: sections read
 * as named cue states, text-equivalent). Empty/whitespace clears; longer
 * input throws through validation (schema CUE_MAX_CHARS) with the store
 * untouched. Rapid edits coalesce per slot.
 */
export function setChainCue(
  lane: LaneId,
  index: number,
  label: string | null,
): void {
  const doc = docStore.getState().doc;
  const trimmed = (label ?? "").trim();
  const value = trimmed === "" ? null : trimmed;
  commit(
    withChain(doc, lane, [...doc.songChain[lane]], (old) =>
      old.map((l, i) => (i === index ? value : l)),
    ),
    `cue:${lane}:${index}`,
  );
}

/**
 * Replace the whole document (MF-2 boot restore). Decoded projects arrive
 * pre-normalized from validateProject, but `commit` re-validates anyway —
 * the boot path is untrusted-by-policy (IndexedDB row → codec → store).
 * Clears coalescing so the restore is not glued to any prior gesture, and
 * fires the document-replaced listeners (RC-1 view-state resets).
 */
export function loadDocument(doc: ProjectDocument): void {
  commit(doc);
  for (const fn of docReplacedListeners) fn();
}

export function undo(): void {
  lastCoalesceKey = null; // a history jump ends any coalescing gesture
  docStore.temporal.getState().undo();
}

export function redo(): void {
  lastCoalesceKey = null;
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
