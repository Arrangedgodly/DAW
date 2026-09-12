/**
 * Refinement-7 (critique P2-3 / deferred #14 — the HW-5 observation): the
 * SOUNDING follow. Each lane's chain position during playback by AUDIBLE
 * time (session.getSoundingPattern — a per-lane ledger stamped with the
 * absolute audio-clock time each slot starts sounding), so NATURAL chain
 * advance (and a ⟲ hold) reads the slot that is actually sounding;
 * getActivePattern keeps its IM-7 switch/schedule-build semantics as the
 * fallback (before anything has sounded). ONE rAF loop for the whole app,
 * started/stopped on transport transitions, writing only when a lane's
 * pattern actually CHANGES — never a 60 Hz re-render (the playhead law);
 * stopped parks on the last-sounded slot (one final read).
 *
 * Shared (2026-09-11): the pattern rail AND the lane ⟲/→ footers read it —
 * on the phone's EDIT page the rail is not mounted while the footer is, so
 * the follow is ref-counted per consumer mount instead of living in the rail.
 */

import { createSignal } from "solid-js";
import type { LaneId } from "../document/schema";
import { getSession } from "../engine/session";
import { RAIL_ROWS } from "./patternRail";
import { selectPattern } from "./selection";

const [sounding, setSounding] = createSignal<{
  readonly [L in LaneId]: string | null;
}>({
  drums: null,
  bass: null,
  chords: null,
  extra1: null,
  extra2: null,
  extra3: null,
  extra4: null,
  lead: null,
});

/**
 * 2026-09-11 (user call): the sounding SLOT per lane — the section identity
 * the rail lights. Read from the same ledger entry as `sounding`, so the lit
 * tile and the grid's notes can never name different slots. A chain that
 * repeats one pattern (A A A B) lights exactly the slot that is playing,
 * where the pattern-id read lit all three A tiles.
 */
const [soundingSlot, setSoundingSlot] = createSignal<{
  readonly [L in LaneId]: number | null;
}>({
  drums: null,
  bass: null,
  chords: null,
  extra1: null,
  extra2: null,
  extra3: null,
  extra4: null,
  lead: null,
});

export { sounding, soundingSlot };

let followFrame = 0;
/**
 * TH-4(b) zero-mid-gesture-mutations law: while a pointer gesture is ARMED
 * (button held — a strict superset of every drag window, rail or grid), the
 * follow commits NOTHING to the DOM; its tile/aria writes would be
 * non-preview mid-gesture mutations (the exact class the frame-budget storm
 * gate polices). The rAF loop keeps ticking as a no-op and the follow
 * converges on the FIRST FRAME after release — a freeze of one gesture's
 * length, never a dropped state.
 */
let heldPointers = 0;

function pollSounding(): void {
  const session = getSession();
  const prev = sounding();
  const prevSlot = soundingSlot();
  const next = { ...prev };
  const nextSlot = { ...prevSlot };
  const playing = session.transport.snapshot.playing;
  let changed = false;
  let slotChanged = false;
  for (const lane of RAIL_ROWS) {
    const id = session.getSoundingPattern(lane);
    const slot = session.getSoundingSlot(lane);
    if (id !== prev[lane]) {
      next[lane] = id;
      changed = true;
    }
    if (slot !== prevSlot[lane]) {
      nextSlot[lane] = slot;
      slotChanged = true;
    }
    /**
     * THE ARRANGEMENT FOLLOW (2026-09-11, user call): while the transport
     * runs, the EDITING SELECTION rides the chain. Natural advance used to
     * move only the `active` tile, leaving the old slot painted `selected`
     * (tileState's strongest fill) and the grid still showing the pattern
     * that had stopped playing — two lit sections and stale notes.
     *
     * Driven from the SLOT, not the pattern id, and the slot is carried into
     * the selection: a chain repeats patterns (A A A B is the ordinary
     * case), so a pattern-addressed selection would light every tile holding
     * that pattern — the same "more than one lit section" defect this
     * change exists to remove.
     *
     * Playing only: while stopped, selection is the user's editing place and
     * nothing may move it.
     */
    if (playing && slot !== prevSlot[lane] && slot !== null && id !== null)
      selectPattern(lane, id, slot);
  }
  if (changed) setSounding(next);
  if (slotChanged) setSoundingSlot(nextSlot);
}

/** (Re)align the follow loop with the transport: rAF while playing, one
 *  parked read while stopped. Idempotent — safe on every transport emit. */
function syncSoundingFollow(): void {
  cancelAnimationFrame(followFrame);
  if (getSession().transport.snapshot.playing) {
    const tick = () => {
      if (heldPointers === 0) pollSounding();
      followFrame = requestAnimationFrame(tick);
    };
    tick();
  } else {
    pollSounding();
  }
}

/**
 * Count pressed primary pointers at the WINDOW capture level (sees every
 * gesture surface, including renderer-captured grid drags). Returns the
 * uninstall function.
 */
function watchHeldPointers(): () => void {
  const down = (e: PointerEvent): void => {
    if (e.button === 0) heldPointers++;
  };
  const up = (e: PointerEvent): void => {
    if (e.button === 0 && heldPointers > 0) heldPointers--;
  };
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  return () => {
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    heldPointers = 0;
  };
}

let mounts = 0;
let teardown: (() => void) | null = null;

/**
 * Start the follow for one consumer mount; returns its release. The first
 * mount installs the transport subscription + pointer watch; the last
 * release uninstalls them and clears the signal (mount-scoped state never
 * leaks across mounts — test hygiene).
 */
export function mountSoundingFollow(): () => void {
  mounts++;
  if (mounts === 1) {
    const unsubscribe = getSession().subscribe(() => syncSoundingFollow());
    const unwatch = watchHeldPointers();
    syncSoundingFollow();
    teardown = () => {
      unsubscribe();
      unwatch();
      cancelAnimationFrame(followFrame);
      setSounding({
        drums: null,
        bass: null,
        chords: null,
        extra1: null,
        extra2: null,
        extra3: null,
        extra4: null,
        lead: null,
      });
      setSoundingSlot({
        drums: null,
        bass: null,
        chords: null,
        extra1: null,
        extra2: null,
        extra3: null,
        extra4: null,
        lead: null,
      });
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounts--;
    if (mounts === 0) {
      teardown?.();
      teardown = null;
    }
  };
}
