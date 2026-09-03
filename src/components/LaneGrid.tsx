/**
 * LaneGrid (DES-4, DES-6, LY-1, IN-2): one lane's pad floor — a QUADRANT of
 * the 2×2 stage. The DOM grid itself is owned by DomGridRenderer (D1 seam); this
 * component provides the quadrant chassis (strip, scroll container, hue),
 * the document write-through + audition wiring, and the quadrant-selection
 * law. Nothing here re-renders at 60 Hz — the renderer's rAF loop handles
 * the playhead and glow outside Solid entirely.
 *
 * DES-6: the grid edits the lane's ACTIVE pattern — the ephemeral selection
 * (selection.ts activePatterns), which the pattern rail drives. A Keyed
 * wrapper remounts the grid surface when the selected pattern (or its shape)
 * changes; the selection itself lives outside, so collapse/expand and
 * pattern switches never lose your place.
 *
 * LY-1: exactly ONE quadrant is editable (selection.activeLane IS the
 * quadrant selection); the other three render view-only with live notes +
 * playhead, no tab stops, not focus traps (a11y §7 E2). A click on any part
 * of a view-only quadrant selects it (pointer parity — keyboard.md v2).
 *
 * IN-2 (v2 note law): pitched clicks/Enter place (gate default), remove
 * (anchor) or trim (mid-span) through the SC-2 pattern-scoped note actions —
 * replacing the v0 all-patterns cell toggle (journey-change ledger #2).
 * Pointer drag-create / edge-drag resize / drums paint commit through the
 * same actions on release (previews are renderer-local, zero store writes).
 */

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import {
  DRUM_PIECES,
  type DrumPiece,
  type DrumPattern,
  type LaneId,
  PITCH_CLASS_NAMES,
  type Pattern,
  resolveGateSteps,
} from "../document/schema";
import { effectiveScale, modeSize } from "../document/scales";
import { getSession } from "../engine/session";
import {
  DomGridRenderer,
  type PitchedNotesView,
  type PlayheadFrame,
} from "../grid/renderer";
import {
  addNote,
  docStore,
  removeNote,
  resizeNote,
  toggleDrumStep,
} from "../state/store";
import {
  activeLane,
  activePatterns,
  currentPatternFor,
  selectLane,
} from "../state/selection";
import {
  focusRequest,
  requestLaneFocus,
  selectQuadrantFromPointer,
} from "../state/gridFocus";
import { noteEditAt, type Span } from "../interaction/drag";
import { registerHelp } from "../help/registry";
import LaneHeader from "./LaneHeader";
import EuclidFill from "./EuclidFill";
import { LANE_NAMES } from "./laneMeta";

const session = getSession();

/**
 * HP-1 help entries — one per quadrant's grid (I2-6: colocated here, next to
 * the surface the entry describes; structural placeholder copy — HP-2
 * rewrites it text-only). The entry covers every cell/row inside the grid:
 * the InfoView resolves focus/hover through `closest("[data-help]")`, so the
 * per-cell names (renderer) stay as they are.
 */
for (const lane of ["drums", "bass", "chords", "lead"] as const) {
  registerHelp([
    {
      id: `grid.${lane}`,
      title: `${LANE_NAMES[lane]} GRID`,
      text:
        lane === "drums"
          ? "Drums steps: click or press Enter on a pad to toggle a hit; drag across pads to paint. The fill rail spreads hits evenly for you."
          : `${LANE_NAMES[lane]} steps: click or press Enter to place a note, drag right to draw a longer one, drag its right edge to resize. Rows follow the lane's scale.`,
    },
  ]);
}

/**
 * LY-1 quadrant geometry (production decision inside the committed 2×2
 * structure, recorded in-task): drums keeps near-v0 pad scale (6 rows); the
 * 14-row pitched lanes compress to 16 px cells so every quadrant fits the
 * one-page 1440×900 law. Long patterns scroll horizontally inside the
 * quadrant (the v0 per-grid mechanism) — the page itself never scrolls.
 */
const QUADRANT_GEOMETRY: Record<
  LaneId,
  { cellPx: number; gapPx: number; labelPx: number; fillRailPx: number }
> = {
  drums: { cellPx: 20, gapPx: 2, labelPx: 72, fillRailPx: 104 },
  bass: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0 },
  chords: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0 },
  lead: { cellPx: 16, gapPx: 1, labelPx: 64, fillRailPx: 0 },
};

function currentPattern(lane: LaneId): Pattern | undefined {
  void activePatterns();
  return currentPatternFor(lane);
}

function drumLabels(): string[] {
  return DRUM_PIECES.map((p) => p.toUpperCase());
}

/** Degree rows for a pitched lane: note names over ~2 octaves (1 for chords). */
function pitchedLabels(
  lane: Exclude<LaneId, "drums">,
  pattern: Pattern,
): {
  labels: string[];
  degrees: number[];
} {
  const doc = docStore.getState().doc;
  const scale = effectiveScale(doc, lane);
  const size = modeSize(scale.mode);
  const degrees = pattern.kind === "pitched" ? [...pattern.rowDegrees] : [];
  const labels = degrees.map((degree) => {
    const pc = (scale.root + scale.intervals[degree % size]) % 12;
    const octave = Math.floor(degree / size);
    return PITCH_CLASS_NAMES[pc] + (octave > 0 ? "′" : "");
  });
  return { labels, degrees };
}

/**
 * What the renderer syncs (IN-2): drums patterns pass through; pitched
 * patterns project their v2 NOTES onto rows (degree → row index via the
 * pattern's manifest). The renderer renders note spans natively — the v1
 * cell view (SC-1 bridge) is retired from the UI path.
 */
function syncPatternFor(pattern: Pattern): DrumPattern | PitchedNotesView {
  if (pattern.kind !== "pitched") return pattern; // drums pass through
  const byDegree = new Map<number, Span[]>();
  for (const note of pattern.notes) {
    const list = byDegree.get(note.degree);
    if (list) list.push(note);
    else byDegree.set(note.degree, [note]);
  }
  const rows = pattern.rowDegrees.map(
    (degree) => byDegree.get(degree) ?? [], // degree without a row: unplayed
  );
  return { kind: "pitched", rows };
}

/**
 * The lane's effective gate in note steps at the CURRENT document BPM — the
 * single-click default length (I2-3), read at interaction time so BPM/gate
 * edits apply immediately.
 */
function laneGateStepsNow(lane: LaneId): number {
  const doc = docStore.getState().doc;
  const conf = doc.lanes.find((l) => l.id === lane);
  return conf ? resolveGateSteps(conf.gate, doc.transport.bpm) : 1;
}

/**
 * One row's note spans at interaction time (the mount-time props.pattern is
 * a stale snapshot after the first edit — always read the live document).
 */
function rowSpansNow(lane: LaneId, patternId: string, degree: number): Span[] {
  const p = docStore
    .getState()
    .doc.patterns[lane].find((cand) => cand.id === patternId);
  if (p?.kind !== "pitched") return [];
  return p.notes
    .filter((n) => n.degree === degree)
    .map((n) => ({ start: n.start, length: n.length }));
}

/**
 * The grid surface for exactly one pattern shape. Mounts the renderer, syncs
 * content edits from the store, disposes on cleanup. Keyed by pattern id +
 * step count so every shape change rebuilds cleanly.
 */
function GridSurface(props: { lane: LaneId; pattern: Pattern }) {
  let container: HTMLDivElement | undefined;

  onMount(() => {
    if (!container) return;
    const lane = props.lane;
    const pattern = props.pattern;

    const pitched = pattern.kind === "pitched";
    const rowLabels = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">, pattern).labels
      : drumLabels();
    const degrees = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">, pattern).degrees
      : [];
    const steps = pattern.bars * 16;
    const geo = QUADRANT_GEOMETRY[lane];

    const readFrame = (): PlayheadFrame | null => {
      const snap = session.transport.snapshot;
      if (!snap.playing) return null;
      return {
        playing: true,
        loopTime: session.transport.getLoopTime(),
        options: { bars: snap.loopBars, bpm: snap.bpm, swing: snap.swing },
      };
    };

    let rendererRef: DomGridRenderer | null = null;
    const fillDisposers: Array<() => void> = [];

    const renderer = new DomGridRenderer({
      container,
      laneId: lane,
      laneLabel: LANE_NAMES[lane],
      rowLabels,
      steps,
      pitched,
      cellPx: geo.cellPx,
      gapPx: geo.gapPx,
      labelPx: geo.labelPx,
      fillRailPx: geo.fillRailPx,
      // LY-1: only the selected quadrant's grid starts editable.
      editable: activeLane() === lane,
      host: {
        readFrame,
        prefersReducedMotion: () =>
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
            true,
      },
      // PX-3: drums rows only — pitched lanes are out of scope.
      ...(lane === "drums"
        ? {
            mountFillControl: (row: number, el: HTMLElement) => {
              const piece = DRUM_PIECES[row] as DrumPiece;
              fillDisposers.push(
                render(
                  () => (
                    <EuclidFill
                      piece={piece}
                      steps={steps}
                      label={rowLabels[row] ?? piece}
                      onPreview={(values) =>
                        rendererRef?.previewRow(row, values)
                      }
                    />
                  ),
                  el,
                ),
              );
            },
          }
        : {}),
      onToggle: (row, step) => {
        selectLane(lane); // selection follows the latest grid interaction
        if (lane === "drums") {
          const piece = DRUM_PIECES[row] as DrumPiece;
          const res = toggleDrumStep(piece, step);
          if (res.turnedOn) void session.audition(lane, piece);
          return;
        }
        // IN-2 v2 note law (keyboard.md v2): place / remove / trim, scoped to
        // the DISPLAYED pattern (DES-6) through the SC-2 note actions.
        const degree = degrees[row];
        if (degree === undefined) return;
        const gateSteps = laneGateStepsNow(lane);
        const spans = rowSpansNow(lane, pattern.id, degree);
        const decision = noteEditAt(spans, gateSteps, step);
        if (decision.kind === "place") {
          if (
            addNote(lane, pattern.id, {
              degree,
              start: step,
              length: gateSteps,
            })
          )
            void session.audition(lane, degree); // placement auditions (v0 law)
        } else if (decision.kind === "remove") {
          removeNote(lane, pattern.id, degree, decision.span.start);
        } else if (decision.kind === "trim") {
          resizeNote(
            lane,
            pattern.id,
            degree,
            decision.span.start,
            decision.length,
          );
        }
      },
      // IN-2 pointer gestures — commit on release, through the same store
      // note actions (0.25 snap + clamps live in the store; SC-2).
      onNoteCreate: (row, start, length) => {
        selectLane(lane);
        const degree = degrees[row];
        if (degree === undefined) return;
        const pitchedLane = lane as Exclude<LaneId, "drums">;
        if (addNote(pitchedLane, pattern.id, { degree, start, length }))
          void session.audition(lane, degree); // audition on create (plan law)
      },
      onNoteResize: (row, start, length) => {
        const degree = degrees[row];
        if (degree === undefined) return;
        resizeNote(
          lane as Exclude<LaneId, "drums">,
          pattern.id,
          degree,
          start,
          length,
        );
      },
      onNoteRemove: (row, start) => {
        const degree = degrees[row];
        if (degree === undefined) return;
        removeNote(lane as Exclude<LaneId, "drums">, pattern.id, degree, start);
      },
      onDrumsPaint: (cells) => {
        selectLane(lane);
        let auditioned = false;
        for (const c of cells) {
          const piece = DRUM_PIECES[c.row] as DrumPiece | undefined;
          if (!piece) continue;
          const res = toggleDrumStep(piece, c.step); // cells were off → on
          if (res.turnedOn && !auditioned) {
            // One placement audition per gesture — a hit-per-cell machine
            // gun would fight the one-shot law (I2-4).
            auditioned = true;
            void session.audition(lane, piece);
          }
        }
      },
      // DA-1 lane moves → LY-1 quadrant selection: this grid asks the
      // coordinator; the target quadrant's surface consumes the request.
      onLaneMove: (dir, from) =>
        requestLaneFocus(lane, dir, from.row, from.step),
      // DA-1 audition key: Shift+Enter sounds the focused cell, no toggle.
      onAudition: (row) => {
        if (lane === "drums") {
          void session.audition(lane, DRUM_PIECES[row] as DrumPiece);
        } else if (degrees[row] !== undefined) {
          void session.audition(lane, degrees[row]);
        }
      },
    });

    rendererRef = renderer;
    renderer.sync(syncPatternFor(pattern));

    // LY-1 quadrant state: flip editable when the selection moves. O(1) in
    // the renderer (tab stop + names); the rAF loop never restarts.
    createEffect(() => {
      rendererRef?.setEditable(activeLane() === lane);
    });

    // DA-1 cross-lane focus: consume requests addressed to THIS quadrant and
    // move DOM focus + roving tabindex to the carried cell (clamped by the
    // renderer to this grid's rows/steps). "roving" requests land on the
    // grid's remembered cursor (the strip ]/[ escape hatch).
    createEffect(() => {
      const req = focusRequest();
      if (!req || req.lane !== lane) return;
      if (req.mode === "roving") rendererRef?.focusRoving();
      else rendererRef?.focusCell(req.row, req.step);
    });

    const unsubscribe = docStore.subscribe((state, prev) => {
      // Re-sync on pattern-content identity only: IN-2 renders notes
      // natively (no gate/BPM-derived view left to invalidate).
      if (state.doc.patterns[lane] === prev.doc.patterns[lane]) return;
      const next = state.doc.patterns[lane].find((p) => p.id === pattern.id);
      if (next) renderer.sync(syncPatternFor(next));
    });

    onCleanup(() => {
      unsubscribe();
      for (const dispose of fillDisposers) dispose();
      renderer.dispose();
    });
  });

  return (
    <div
      class="lane-grid-scroll"
      data-help={`grid.${props.lane}`}
      ref={(el) => {
        container = el;
      }}
    />
  );
}

export default function LaneGrid(props: { lane: LaneId }) {
  // Store writes (e.g. the selected pattern being removed) re-derive the
  // pattern; the selection signal drives pattern switches.
  const [docVersion, setDocVersion] = createSignal(0);
  onMount(() => {
    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc) setDocVersion((v) => v + 1);
    });
    onCleanup(unsubscribe);
  });

  const pattern = createMemo(() => {
    void docVersion();
    return currentPattern(props.lane);
  });
  const key = () => {
    const p = pattern();
    return p ? `${p.id}:${p.kind}:${p.bars}` : "none";
  };

  // LY-1 pointer law: a click on any part of a VIEW-ONLY quadrant selects it
  // (control clicks keep their own action + focus; the announcement carries
  // the change). The selected quadrant's own clicks are left alone.
  const onQuadrantClick = () => {
    if (activeLane() !== props.lane) selectQuadrantFromPointer(props.lane);
  };

  return (
    <section
      class="lane-floor"
      data-lane={props.lane}
      data-editing={activeLane() === props.lane}
      aria-label={LANE_NAMES[props.lane]}
      onClick={onQuadrantClick}
    >
      <LaneHeader lane={props.lane} />
      <Show when={key()} keyed>
        {(keyed: string) =>
          (() => {
            void keyed;
            const p = pattern();
            return p ? (
              <GridSurface lane={props.lane} pattern={p} />
            ) : (
              <div class="lane-grid-scroll" />
            );
          })()
        }
      </Show>
    </section>
  );
}
