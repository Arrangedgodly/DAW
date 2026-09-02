/**
 * LaneGrid (DES-4, DES-6): one lane's pad floor. The DOM grid itself is owned
 * by DomGridRenderer (D1 seam); this component provides the lane chassis
 * (label, scroll container, hue) and the document write-through + audition
 * wiring. Nothing here re-renders at 60 Hz — the renderer's rAF loop handles
 * the playhead and glow outside Solid entirely.
 *
 * DES-6: the grid edits the lane's ACTIVE pattern — the ephemeral selection
 * (selection.ts activePatterns), which the pattern rail drives — no longer
 * just chain slot 0. A Keyed wrapper remounts the grid surface when the
 * selected pattern (or its shape) changes; the selection itself lives
 * outside, so collapse/expand and pattern switches never lose your place.
 */

import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  DRUM_PIECES,
  type DrumPiece,
  type LaneId,
  PITCH_CLASS_NAMES,
  type Pattern,
} from "../document/schema";
import { effectiveScale, modeSize } from "../document/scales";
import { getSession } from "../engine/session";
import {
  DomGridRenderer,
  type PlayheadFrame,
} from "../grid/renderer";
import { docStore, toggleDrumStep, togglePitchedCell } from "../state/store";
import { activePatterns } from "../state/selection";
import LaneHeader from "./LaneHeader";
import { LANE_NAMES } from "./laneMeta";

const session = getSession();

function currentPattern(lane: LaneId): Pattern | undefined {
  const doc = docStore.getState().doc;
  const selected = activePatterns()[lane];
  if (selected) {
    const byId = doc.patterns[lane].find((p) => p.id === selected);
    if (byId) return byId;
  }
  const id = doc.songChain[lane][0];
  return doc.patterns[lane].find((p) => p.id === id) ?? doc.patterns[lane][0];
}

function drumLabels(): string[] {
  return DRUM_PIECES.map((p) => p.toUpperCase());
}

/** Degree rows for a pitched lane: note names over ~2 octaves (1 for chords). */
function pitchedLabels(lane: Exclude<LaneId, "drums">, pattern: Pattern): {
  labels: string[];
  degrees: number[];
} {
  const doc = docStore.getState().doc;
  const scale = effectiveScale(doc, lane);
  const size = modeSize(scale.mode);
  const degrees =
    pattern.kind === "pitched" ? pattern.rows.map((r) => r.degree) : [];
  const labels = degrees.map((degree) => {
    const pc = (scale.root + scale.intervals[degree % size]) % 12;
    const octave = Math.floor(degree / size);
    return PITCH_CLASS_NAMES[pc] + (octave > 0 ? "′" : "");
  });
  return { labels, degrees };
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

    const readFrame = (): PlayheadFrame | null => {
      const snap = session.transport.snapshot;
      if (!snap.playing) return null;
      return {
        playing: true,
        loopTime: session.transport.getLoopTime(),
        options: { bars: snap.loopBars, bpm: snap.bpm, swing: snap.swing },
      };
    };

    const renderer = new DomGridRenderer({
      container,
      laneId: lane,
      laneLabel: LANE_NAMES[lane],
      rowLabels,
      steps,
      pitched,
      host: {
        readFrame,
        prefersReducedMotion: () =>
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
            true,
      },
      onToggle: (row, step) => {
        if (lane === "drums") {
          const piece = DRUM_PIECES[row] as DrumPiece;
          const res = toggleDrumStep(piece, step);
          if (res.turnedOn) void session.audition(lane, piece);
        } else {
          const degree = degrees[row];
          if (degree === undefined) return;
          const res = togglePitchedCell(
            lane as Exclude<LaneId, "drums">,
            degree,
            step,
          );
          if (res.turnedOn) void session.audition(lane, degree);
        }
      },
    });

    renderer.sync(pattern);

    const unsubscribe = docStore.subscribe((state, prev) => {
      if (state.doc.patterns[lane] === prev.doc.patterns[lane]) return;
      const next = state.doc.patterns[lane].find((p) => p.id === pattern.id);
      if (next) renderer.sync(next);
    });

    onCleanup(() => {
      unsubscribe();
      renderer.dispose();
    });
  });

  return (
    <div
      class="lane-grid-scroll"
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

  return (
    <section class="lane-floor" data-lane={props.lane} aria-label={LANE_NAMES[props.lane]}>
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
