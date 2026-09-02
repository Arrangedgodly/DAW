/**
 * Engine bridge (DES-4): the one-way store→engine pipe. Subscribes to the
 * document store, recompiles changed lanes with compileLaneEvents (the only
 * scheduling authority, D2–D4) and pushes the grouped events into the
 * session's pattern-playback seam.
 *
 * Timing (documented decision): the session delivers events per scheduled
 * step, so an edit becomes audible at the next step the lookahead scheduler
 * has not yet emitted (~1.5 s horizon) — effectively immediately, with no
 * in-flight audio re-queueing.
 */

import { compileLaneEvents } from "../audio/compile";
import type { VoiceNoteOnEvent } from "../audio/presets";
import { getDrumKit, getPreset } from "../audio/presets";
import {
  type LaneId,
  type Pattern,
  type ProjectDocument,
} from "../document/schema";
import { effectiveScale } from "../document/scales";
import { getSession, type Session } from "../engine/session";
import { docStore } from "./store";

function firstPattern(doc: ProjectDocument, lane: LaneId): Pattern | undefined {
  // Single-pattern chains in v0 grids; IM-7 brings chain-aware selection.
  const id = doc.songChain[lane][0];
  return doc.patterns[lane].find((p) => p.id === id) ?? doc.patterns[lane][0];
}

export function compileLaneForSession(
  doc: ProjectDocument,
  lane: LaneId,
  session: Session,
): void {
  const pattern = firstPattern(doc, lane);
  if (!pattern) {
    return;
  }
  const laneConf = doc.lanes.find((l) => l.id === lane)!;
  const groove = {
    bpm: session.transport.snapshot.bpm,
    swing: session.transport.snapshot.swing,
  };
  const events: VoiceNoteOnEvent[] =
    lane === "drums"
      ? compileLaneEvents({
          pattern,
          preset: getDrumKit((laneConf as { kitId: string }).kitId) ?? getDrumKit("kit-default")!,
          gate: laneConf.gate,
          groove,
        })
      : compileLaneEvents({
          pattern,
          preset:
            getPreset((laneConf as { presetId: string }).presetId) ??
            getPreset("preset-lead-1")!,
          gate: laneConf.gate,
          groove,
          scale: effectiveScale(doc, lane),
          stackChord: lane === "chords",
        });
  session.setLaneEvents(lane, events, pattern.bars * 16);
}

/** Connect the store to the session; returns the unsubscribe function. */
export function connectStoreToEngine(
  session: Session = getSession(),
): () => void {
  const pushAll = (doc: ProjectDocument) => {
    // v0: single pattern per lane — the loop length follows the pattern
    // length so the playhead and the audio agree on the grid extent.
    const bars = firstPattern(doc, "drums")?.bars;
    if (bars) session.transport.setLoopBars(bars);
    for (const lane of Object.keys(doc.patterns) as LaneId[]) {
      compileLaneForSession(doc, lane, session);
    }
  };
  pushAll(docStore.getState().doc);
  return docStore.subscribe((state, prev) => {
    if (state.doc === prev.doc) return;
    for (const lane of Object.keys(state.doc.patterns) as LaneId[]) {
      if (state.doc.patterns[lane] !== prev.doc.patterns[lane]) {
        compileLaneForSession(state.doc, lane, session);
      }
    }
  });
}
