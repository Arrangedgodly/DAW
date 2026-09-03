/**
 * Engine bridge (DES-4 → IM-6 → IM-7): the one-way store→engine pipe. Subscribes to
 * the document store, compiles each lane's full CHAIN with compileLaneSchedule
 * (the only scheduling authority, D2–D4) and pushes the schedule into the
 * session's chain-playback seam.
 *
 * IM-7: the document's songChain is the arrangement; the session derives the
 * playback cursor from it. Structure changes (chain edits) are deferred by the
 * session to the lane's next chain-iteration boundary; pattern-content edits
 * (same segment sequence) swap the event map at the next un-emitted step
 * (DES-4 rule). Live pattern switching is engine state fed from the ephemeral
 * UI selection (selection.ts) via requestPatternSwitch below — the CHAIN is
 * document, the ACTIVE pattern for playback is engine state (documented D1
 * two-tier split).
 */

import { compileLaneSchedule, resolveChainPatterns } from "../audio/song";
import { getDrumKit, getPreset } from "../audio/presets";
import {
  type LaneId,
  effectiveLaneMix,
  type ProjectDocument,
} from "../document/schema";
import { effectiveScale } from "../document/scales";
import { getSession, type Session } from "../engine/session";
import { docStore } from "./store";

const PITCHED_LANES = ["bass", "chords", "lead"] as const;

function laneScheduleFor(doc: ProjectDocument, lane: LaneId, session: Session) {
  const chain = resolveChainPatterns(doc, lane);
  if (chain.length === 0) return null;
  const laneConf = doc.lanes.find((l) => l.id === lane)!;
  const groove = {
    bpm: session.transport.snapshot.bpm,
    swing: session.transport.snapshot.swing,
  };
  return compileLaneSchedule({
    chain,
    preset:
      lane === "drums"
        ? (getDrumKit((laneConf as { kitId: string }).kitId) ??
          getDrumKit("kit-default")!)
        : (getPreset((laneConf as { presetId: string }).presetId) ??
          getPreset("preset-lead-1")!),
    gate: laneConf.gate,
    groove,
    ...(lane === "drums"
      ? {}
      : {
          scale: effectiveScale(doc, lane),
          stackChord: lane === "chords",
        }),
  });
}

export function compileLaneForSession(
  doc: ProjectDocument,
  lane: LaneId,
  session: Session,
): void {
  const schedule = laneScheduleFor(doc, lane, session);
  if (schedule) session.setLaneSchedule(lane, schedule);
}

/**
 * QUANTIZED LIVE SWITCH (IM-7): compile `patternId` standalone and hand it to
 * the session, which lands it on the lane's next pattern boundary (exact step
 * observable via session.getPendingSwitch). Fed from the ephemeral pattern
 * selection (selection.ts selectPattern) — never mutates the document.
 */
export function requestPatternSwitch(
  lane: LaneId,
  patternId: string,
  session: Session = getSession(),
): void {
  const doc = docStore.getState().doc;
  const pattern = doc.patterns[lane].find((p) => p.id === patternId);
  if (!pattern) return;
  const schedule = laneScheduleFor(
    { ...doc, songChain: { ...doc.songChain, [lane]: [patternId] } },
    lane,
    session,
  );
  if (schedule) session.setActivePattern(lane, patternId, schedule);
}

/** Push the document's effective scales + lane sound ids + FX chains + mix. */
function syncLaneConfig(doc: ProjectDocument, session: Session): void {
  for (const laneConf of doc.lanes) {
    session.setLaneSound(
      laneConf.id,
      laneConf.id === "drums" ? laneConf.kitId : laneConf.presetId,
    );
    // IM-4: the lane's fxChain rides the same lane-object identity, so any
    // chain edit (params, bypass, reorder, add/remove) lands here.
    session.setLaneChain(laneConf.id, laneConf.fxChain);
    // LY-1: the quadrant mix (volume/mute/solo) rides the lane-object identity
    // too — any mix edit re-syncs all four lanes (solo ducks the others).
    session.setLaneMix(laneConf.id, effectiveLaneMix(laneConf));
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
      doc.scale !== prev.doc.scale ||
      doc.laneOverrides !== prev.doc.laneOverrides;
    // Lane config (sound ids) and effective scales both ride syncLaneConfig.
    if (doc.lanes !== prev.doc.lanes || scaleChanged)
      syncLaneConfig(doc, session);
    // Compilation inputs per lane: pattern content, lane config (gate/preset),
    // effective scale, song chain (first-pattern selection), groove (bpm/swing).
    const grooveChanged = doc.transport !== prev.doc.transport;
    for (const lane of Object.keys(doc.patterns) as LaneId[]) {
      // Per-lane config identity for COMPILATION: gate + sound id + fx chain
      // (the lanes array is replaced wholesale on any lane edit, and LY-1 mix
      // edits replace the lane object too — a mix-only change alters none of
      // the compile inputs, so it must not recompile).
      const confChanged = (
        a: (typeof doc.lanes)[number] | undefined,
        b: (typeof doc.lanes)[number] | undefined,
      ): boolean => {
        if (a === b) return false;
        if (!a || !b) return true;
        const soundOf = (l: (typeof doc.lanes)[number]) =>
          l.id === "drums"
            ? (l as { kitId: string }).kitId
            : (l as { presetId: string }).presetId;
        return (
          a.gate !== b.gate ||
          soundOf(a) !== soundOf(b) ||
          a.fxChain !== b.fxChain
        );
      };
      const laneConfChanged =
        confChanged(
          doc.lanes.find((l) => l.id === lane),
          prev.doc.lanes.find((l) => l.id === lane),
        ) || doc.songChain[lane] !== prev.doc.songChain[lane];
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
