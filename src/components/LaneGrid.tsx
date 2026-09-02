/**
 * LaneGrid (DES-4): one lane's pad floor. The DOM grid itself is owned by
 * DomGridRenderer (D1 seam); this component provides the lane chassis (label,
 * scroll container, hue) and the document write-through + audition wiring.
 * Nothing here re-renders at 60 Hz — the renderer's rAF loop handles the
 * playhead and glow outside Solid entirely.
 */

import { onCleanup, onMount } from "solid-js";
import {
  DRUM_PIECES,
  type DrumPiece,
  type LaneId,
  PITCH_CLASS_NAMES,
} from "../document/schema";
import { effectiveScale, modeSize } from "../document/scales";
import { getSession } from "../engine/session";
import {
  DomGridRenderer,
  type PlayheadFrame,
} from "../grid/renderer";
import { docStore, toggleDrumStep, togglePitchedCell } from "../state/store";
import LaneHeader from "./LaneHeader";
import { LANE_NAMES } from "./laneMeta";

const session = getSession();

function currentPattern(lane: LaneId) {
  const doc = docStore.getState().doc;
  const id = doc.songChain[lane][0];
  return doc.patterns[lane].find((p) => p.id === id) ?? doc.patterns[lane][0];
}

function drumLabels(): string[] {
  return DRUM_PIECES.map((p) => p.toUpperCase());
}

/** Degree rows for a pitched lane: note names over ~2 octaves (1 for chords). */
function pitchedLabels(lane: Exclude<LaneId, "drums">): {
  labels: string[];
  degrees: number[];
} {
  const doc = docStore.getState().doc;
  const scale = effectiveScale(doc, lane);
  const size = modeSize(scale.mode);
  const pattern = currentPattern(lane);
  const degrees =
    pattern && pattern.kind === "pitched"
      ? pattern.rows.map((r) => r.degree)
      : [];
  const labels = degrees.map((degree) => {
    const pc = (scale.root + scale.intervals[degree % size]) % 12;
    const octave = Math.floor(degree / size);
    return PITCH_CLASS_NAMES[pc] + (octave > 0 ? "′" : "");
  });
  return { labels, degrees };
}

export default function LaneGrid(props: { lane: LaneId }) {
  let container: HTMLDivElement | undefined;

  onMount(() => {
    if (!container) return;
    const lane = props.lane;
    const pattern = currentPattern(lane);
    if (!pattern) return;

    const pitched = pattern.kind === "pitched";
    const rowLabels = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">).labels
      : drumLabels();
    const degrees = pitched
      ? pitchedLabels(lane as Exclude<LaneId, "drums">).degrees
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
      const next = currentPattern(lane);
      if (next) renderer.sync(next);
    });

    onCleanup(() => {
      unsubscribe();
      renderer.dispose();
    });
  });

  return (
    <section class="lane-floor" data-lane={props.lane} aria-label={LANE_NAMES[props.lane]}>
      <LaneHeader lane={props.lane} />
      <div
        class="lane-grid-scroll"
        ref={(el) => {
          container = el;
        }}
      />
    </section>
  );
}
