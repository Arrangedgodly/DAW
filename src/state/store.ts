/**
 * Document store (IM-6, completed from the DES-4 pull-forward): one
 * zustand/vanilla store holding the valibot-validated ProjectDocument with
 * zundo temporal undo (limit 50, D1). Every mutation goes through `commit`,
 * which re-validates the whole document through the schema on write — an
 * invalid edit throws and leaves the store untouched.
 *
 * History coalescing (documented decision): rapid same-family edits within a
 * 350 ms trailing window collapse into ONE undo step. Families: all cell
 * toggles ("toggle" — grid painting), per-lane gate drags ("gate:<lane>"),
 * per-knob transport drags ("transport:<field>"). The first edit of a family
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
  DRUM_PIECES,
  type DrumPiece,
  type FxDevice,
  type LaneGate,
  type LaneId,
  MAX_FX_PER_LANE,
  type Pattern,
  type PatternBars,
  type PitchedCell,
  type PitchedPattern,
  type ProjectDocument,
  type ScaleConfig,
  type Transport,
  createDefaultProject,
} from "../document/schema";
import { validateProject } from "../document/validate";
import { type ModeName, modeSize } from "../document/scales";
import { type FxDeviceType, defaultFxDevice, reorderChain } from "./fxStrip";

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
function commit(
  next: ProjectDocument,
  coalesceKey?: string,
): ProjectDocument {
  validateProject(next); // throws → store unchanged
  if (coalesceKey !== undefined) {
    if (lastCoalesceKey === coalesceKey && nowMs() - lastCoalesceAt < COALESCE_WINDOW_MS) {
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
  commit(withDrumStep(docStore.getState().doc, piece, step, !current), "toggle");
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
  commit(withPitchedCell(docStore.getState().doc, lane, degree, step, next), "toggle");
  return { turnedOn: next === 1 };
}

// ---------------------------------------------------------------------------
// Lane config: gate, preset/kit, scale overrides
// ---------------------------------------------------------------------------

function withLane(
  doc: ProjectDocument,
  lane: LaneId,
  patch: (lane: ProjectDocument["lanes"][number]) => ProjectDocument["lanes"][number],
): ProjectDocument {
  const lanes = doc.lanes.map((l) => (l.id === lane ? patch(l) : l));
  return { ...doc, lanes };
}

/** Set the gate length of one lane (cell-width raise). Coalesced while dragging. */
export function setLaneGate(lane: LaneId, gate: LaneGate): void {
  commit(withLane(docStore.getState().doc, lane, (l) => ({ ...l, gate })), `gate:${lane}`);
}

/** Choose the drum kit (drums lane) or the voice preset (pitched lanes). */
export function setLaneSoundId(lane: LaneId, presetOrKitId: string): void {
  commit(
    withLane(docStore.getState().doc, lane, (l) =>
      l.id === "drums" ? { ...l, kitId: presetOrKitId } : { ...l, presetId: presetOrKitId },
    ),
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
export function setFxBypassed(lane: LaneId, index: number, bypassed: boolean): void {
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
  if (!device) throw new Error(`setFxParam: no device ${index} in lane '${lane}'`);
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
export function setLaneScaleOverride(lane: LaneId, scale: ScaleConfig | null): void {
  const doc = docStore.getState().doc;
  const current: Partial<Record<LaneId, ScaleConfig>> = { ...(doc.laneOverrides ?? {}) };
  if (scale === null) delete current[lane];
  else current[lane] = scale;
  // Collapse to null when no override remains (schema's canonical empty form).
  const hasAny = (Object.keys(current) as LaneId[]).some((k) => current[k] != null);
  commit({ ...doc, laneOverrides: hasAny ? current : null });
}

// ---------------------------------------------------------------------------
// Transport (persisted to the document; engineBridge syncs the session)
// ---------------------------------------------------------------------------

/** Patch bpm/swing/loopBars/metronome in the document. Slider drags coalesce. */
export function setTransport(
  patch: Partial<Pick<Transport, "bpm" | "swing" | "loopBars" | "metronome">>,
): void {
  const doc = docStore.getState().doc;
  commit(
    { ...doc, transport: { ...doc.transport, ...patch } },
    Object.keys(patch).length === 1 ? `transport:${Object.keys(patch)[0]}` : undefined,
  );
}

// ---------------------------------------------------------------------------
// Pattern management (store-level primitives; the pattern UI is DES-6/IM-7)
// ---------------------------------------------------------------------------

function pitchedRowCount(lane: Exclude<LaneId, "drums">, doc: ProjectDocument): number {
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

/** Append a new empty pattern to a lane. Returns the new pattern id. */
export function addPattern(lane: LaneId, bars: PatternBars = 1, name = "?"): string {
  const doc = docStore.getState().doc;
  const id = newPatternId(lane);
  const pattern: Pattern =
    lane === "drums"
      ? {
          kind: "drums",
          id,
          name,
          bars,
          steps: Object.fromEntries(
            DRUM_PIECES.map((piece) => [piece, new Array(16 * bars).fill(false)]),
          ) as Record<DrumPiece, boolean[]>,
        }
      : {
          kind: "pitched",
          id,
          name,
          bars,
          rows: Array.from({ length: pitchedRowCount(lane, doc) }, (_, degree) => ({
            degree,
            steps: new Array(16 * bars).fill(0) as PitchedCell[],
          })),
        };
  commit({ ...doc, patterns: { ...doc.patterns, [lane]: [...doc.patterns[lane], pattern] } });
  return id;
}

/** Deep-copy a pattern under a fresh id. Returns the new pattern id. */
export function duplicatePattern(lane: LaneId, patternId: string): string {
  const doc = docStore.getState().doc;
  const source = doc.patterns[lane].find((p) => p.id === patternId);
  if (!source) throw new Error(`duplicatePattern: no pattern '${patternId}' in lane '${lane}'`);
  const id = newPatternId(lane);
  const copy = { ...deepClone(source), id, name: `${source.name}+` };
  commit({ ...doc, patterns: { ...doc.patterns, [lane]: [...doc.patterns[lane], copy] } });
  return id;
}

/** Rename a pattern. */
export function renamePattern(lane: LaneId, patternId: string, name: string): void {
  const doc = docStore.getState().doc;
  const patterns = doc.patterns[lane].map((p) => (p.id === patternId ? { ...p, name } : p));
  commit({ ...doc, patterns: { ...doc.patterns, [lane]: patterns } });
}

/**
 * Replace a lane's song chain (ordered pattern ids; ids may repeat). Throws
 * via validation when an id does not exist in the lane. Cue labels are
 * positional, so they ride the rewrite index-aligned (slot i keeps its label
 * when a chain rewrite keeps slot i; new slots start unlabeled).
 */
export function setLaneChain(lane: LaneId, patternIds: readonly string[]): void {
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

/** Rewrite one lane's chain plus its parallel cue array. */
function withChain(
  doc: ProjectDocument,
  lane: LaneId,
  chain: string[],
  cues: (old: readonly (string | null)[]) => (string | null)[],
): ProjectDocument {
  // Cue arrays are parallel to the chain — pad to chain length first, since
  // lanes that never carried labels have no array at all.
  const old = padCues(doc.chainCues?.[lane] ?? [], chain.length);
  const nextCues = cues(old);
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

function padCues(slots: readonly (string | null)[], length: number): (string | null)[] {
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
    withChain(base, lane, kept.map((s) => s.id), () => kept.map((s) => s.cue)),
  );
  return true;
}

/** Append one chain slot playing `patternId` (unlabeled). */
export function appendChainSlot(lane: LaneId, patternId: string): void {
  const doc = docStore.getState().doc;
  if (!doc.patterns[lane].some((p) => p.id === patternId)) return;
  // `old` arrives padded to the NEW chain length — the appended slot is the
  // trailing null already.
  commit(withChain(doc, lane, [...doc.songChain[lane], patternId], (old) => [...old]));
}

/** Remove chain slot `index`; refuses (returns false) on the last slot. */
export function removeChainSlot(lane: LaneId, index: number): boolean {
  const doc = docStore.getState().doc;
  const chain = doc.songChain[lane];
  if (chain.length <= 1 || index < 0 || index >= chain.length) return false;
  commit(
    withChain(doc, lane, chain.filter((_, i) => i !== index), (old) =>
      old.filter((_, i) => i !== index),
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
export function setChainCue(lane: LaneId, index: number, label: string | null): void {
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
