/**
 * Engine bridge (DES-4 → IM-6): the one-way store→engine pipe. Subscribes to
 * the document store, recompiles changed lanes with compileLaneEvents (the only
 * scheduling authority, D2–D4) and pushes the grouped events into the
 * session's pattern-playback seam.
 *
 * IM-6 additions: the document is now the source of truth for transport
 * parameters (bpm/swing/loopBars/metronome) and per-lane effective scales —
 * this bridge syncs them into the session and recompiles lanes whenever any
 * input to compilation changes (patterns, lane config, scale/overrides, song
 * chain, groove). Scale changes recompile all pitched lanes, so turning the
 * project scale mid-play takes effect at the next unscheduled step.
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

const PITCHED_LANES = ["bass", "chords", "lead"] as const;

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

/** Push the document's effective scales + lane sound ids into the session. */
function syncLaneConfig(doc: ProjectDocument, session: Session): void {
  for (const laneConf of doc.lanes) {
    session.setLaneSound(
      laneConf.id,
      laneConf.id === "drums" ? laneConf.kitId : laneConf.presetId,
    );
  }
  for (const lane of PITCHED_LANES) {
    session.setLaneScale(lane, effectiveScale(doc, lane));
  }
}

/** Transport parameters persisted in the document drive the session. */
function syncTransport(doc: ProjectDocument, session: Session): void {
  session.setBpm(doc.transport.bpm);
  session.setSwingAmount(doc.transport.swing);
  session.setMetronome(doc.transport.metronome);
  session.transport.setLoopBars(doc.transport.loopBars);
}

/** Connect the store to the session; returns the unsubscribe function. */
export function connectStoreToEngine(
  session: Session = getSession(),
): () => void {
  const pushAll = (doc: ProjectDocument) => {
    syncTransport(doc, session);
    syncLaneConfig(doc, session);
    for (const lane of Object.keys(doc.patterns) as LaneId[]) {
      compileLaneForSession(doc, lane, session);
    }
  };
  pushAll(docStore.getState().doc);
  return docStore.subscribe((state, prev) => {
    const doc = state.doc;
    if (doc === prev.doc) return;
    if (doc.transport !== prev.doc.transport) syncTransport(doc, session);
    const scaleChanged =
      doc.scale !== prev.doc.scale || doc.laneOverrides !== prev.doc.laneOverrides;
    // Lane config (sound ids) and effective scales both ride syncLaneConfig.
    if (doc.lanes !== prev.doc.lanes || scaleChanged) syncLaneConfig(doc, session);
    // Compilation inputs per lane: pattern content, lane config (gate/preset),
    // effective scale, song chain (first-pattern selection), groove (bpm/swing).
    const grooveChanged = doc.transport !== prev.doc.transport;
    for (const lane of Object.keys(doc.patterns) as LaneId[]) {
      // Per-lane config identity (gate/preset live on the lane object; the
      // lanes array is replaced wholesale on any lane edit).
      const laneConfChanged =
        doc.lanes.find((l) => l.id === lane) !== prev.doc.lanes.find((l) => l.id === lane) ||
        doc.songChain[lane] !== prev.doc.songChain[lane];
      const pitchedScaleChanged = scaleChanged && lane !== "drums";
      if (
        doc.patterns[lane] !== prev.doc.patterns[lane] ||
        laneConfChanged ||
        pitchedScaleChanged ||
        grooveChanged
      ) {
        compileLaneForSession(doc, lane, session);
      }
    }
  });
}
