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

import { compileLaneSchedule, laneCycleSteps, resolveChainSlots } from "../audio/song";
import { computeLoopSteps } from "../audio/render";
import { getDrumKit, getPreset, sampleRefsForSound } from "../audio/presets";
import {
  type LaneId,
  LANE_IDS,
  effectiveLaneMix,
  type ProjectDocument,
} from "../document/schema";
import { effectiveScale } from "../document/scales";
import { getSession, type Session } from "../engine/session";
import { showError } from "./toasts";
import { docStore } from "./store";

const PITCHED_LANES = ["bass", "chords", "lead"] as const;

function laneScheduleFor(doc: ProjectDocument, lane: LaneId, session: Session) {
  const slots = resolveChainSlots(doc, lane);
  const chain = slots.map((s) => s.pattern);
  if (chain.length === 0) return null;
  const laneConf = doc.lanes.find((l) => l.id === lane)!;
  const groove = {
    bpm: session.transport.snapshot.bpm,
    swing: session.transport.snapshot.swing,
  };
  return compileLaneSchedule({
    chain,
    // ⟲/→ follow: segments carry their document slot + mode (session holds).
    slots: slots.map(({ slot, loop }) => ({ slot, loop })),
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
          // RC-1 (v3): the lane's register offset rides the one compiler —
          // the OCT control's live recompile (audible) lands here.
          octaveOffset:
            (laneConf as { octave?: number }).octave ?? 0,
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

/**
 * SLOT CUE (⟲/→ follow, 2026-09-11): the rail's tile tap while playing —
 * the lane jumps to chain slot `slot` at the end of the segment it is
 * playing, then follows that slot's mode (session.cueSlot). Engine state
 * only; the document chain is untouched.
 */
export function requestSlotCue(
  lane: LaneId,
  slot: number,
  session: Session = getSession(),
): void {
  session.cueSlot(lane, slot);
}

/**
 * PS-4 lazy-content priming: decode the sample assets behind `soundIds` on
 * the LIVE context (the loader's per-context cache makes this a no-op once
 * warm). Called at selection (with the stepper's neighbors), on every lane
 * sync (covers reload/import of a sample-using project), and never on the
 * boot→play path of a synth-only project (zero refs → zero work, TH-4(d)).
 * A failed load surfaces ONE sticky toast per call (Hulk failure-state
 * contract) — playback of every other lane is untouched; the lane simply
 * stays silent until a working sound is selected.
 */
export function primeSoundContent(soundIds: readonly string[]): void {
  const refs = [...new Set(soundIds.flatMap((id) => sampleRefsForSound(id)))];
  if (refs.length === 0) return;
  void getSession()
    .primeSound(refs)
    .catch((err: unknown) => {
      showError("A sampled sound could not load.", {
        suggestion:
          "Other lanes keep playing. Step to another sound and back to retry.",
        details: [err instanceof Error ? err.message : String(err)],
      });
    });
}

/** Push the document's effective scales + lane sound ids + FX chains + mix. */
function syncLaneConfig(doc: ProjectDocument, session: Session): void {
  const soundIds: string[] = [];
  for (const laneConf of doc.lanes) {
    const soundId =
      laneConf.id === "drums" ? laneConf.kitId : laneConf.presetId;
    soundIds.push(soundId);
    session.setLaneSound(laneConf.id, soundId);
    // IM-4: the lane's fxChain rides the same lane-object identity, so any
    // chain edit (params, bypass, reorder, add/remove) lands here.
    session.setLaneChain(laneConf.id, laneConf.fxChain);
    // LY-1: the quadrant mix (volume/mute/solo) rides the lane-object identity
    // too — any mix edit re-syncs all four lanes (solo ducks the others).
    session.setLaneMix(laneConf.id, effectiveLaneMix(laneConf));
    // RC-1 (v3): the register offset rides the same identity for AUDITIONS
    // (compilation consumes it as a compile input below).
    if (laneConf.id !== "drums")
      session.setLaneOctave(laneConf.id, laneConf.octave ?? null);
  }
  // PS-4: keep the current sounds' sample assets decoded (warm after the
  // first selection; a no-op for synth-only projects).
  primeSoundContent(soundIds);
  for (const lane of PITCHED_LANES) {
    session.setLaneScale(lane, effectiveScale(doc, lane));
  }
}

/**
 * LL-2 (seam E5's re-base — the deliberate basis swap): the transport's
 * cycle basis is the LCM OF LANE CHAIN TOTALS, derived from the document
 * with the SAME pure law the offline export renders (render.ts
 * computeLoopSteps — one LCM for one-shot, booth readout, and export,
 * i3-4/i3-5). Chain totals come from the bounded resolveChainPatterns scan
 * (song.ts laneCycleSteps; LP-1 §10 — never a schedule compile). Degenerate
 * all-empty docs fall back to computeLoopSteps' constant 16 (one bar, the
 * v0.1 default basis). At powers-of-two chain totals the LCM is simply the
 * longest lane (I3-d); the SV-1 compat derivation retired with this swap.
 */
function docCycleSteps(doc: ProjectDocument): number {
  return computeLoopSteps(LANE_IDS.map((lane) => laneCycleSteps(doc, lane)));
}

/**
 * Transport parameters persisted in the document drive the session. LL-2:
 * the transport's cycle basis is `docCycleSteps(doc)` (see above) — the
 * renderer reads each LANE's own chain total for its sweep (LaneGrid's
 * readFrame), so this push sizes only the global clock + one-shot.
 */
function syncTransport(doc: ProjectDocument, session: Session): void {
  session.setBpm(doc.transport.bpm);
  session.setSwingAmount(doc.transport.swing);
  session.setMetronome(doc.transport.metronome);
  session.transport.setCycleSteps(docCycleSteps(doc));
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
    // The derived cycle basis follows the CHAIN totals (pattern bars × the
    // songChain ids): a chain edit (rail `+`/remove/resize of a chained
    // pattern) must re-push the transport even though doc.transport is
    // untouched. The derivation is VALUE-compared — note edits and
    // same-chain changes never re-push (no spurious setCycleSteps churn;
    // the scan is the same order the SV-1 compat derivation ran per emit).
    if (
      doc.transport !== prev.doc.transport ||
      docCycleSteps(doc) !== docCycleSteps(prev.doc)
    )
      syncTransport(doc, session);
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
        // RC-1: the register offset is a compile input — an OCT change must
        // recompile the lane (audible live). (A mix-only change still alters
        // none of these, so it must not recompile.)
        const octaveOf = (l: (typeof doc.lanes)[number]) =>
          l.id === "drums" ? 0 : ((l as { octave?: number }).octave ?? 0);
        return (
          a.gate !== b.gate ||
          soundOf(a) !== soundOf(b) ||
          a.fxChain !== b.fxChain ||
          octaveOf(a) !== octaveOf(b)
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
