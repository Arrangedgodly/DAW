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

const [sounding, setSounding] = createSignal<{
  readonly [L in LaneId]: string | null;
}>({ drums: null, bass: null, chords: null, lead: null });

export { sounding };

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
  const next = { ...prev };
  let changed = false;
  for (const lane of RAIL_ROWS) {
    const id = session.getSoundingPattern(lane);
    if (id !== prev[lane]) {
      next[lane] = id;
      changed = true;
    }
  }
  if (changed) setSounding(next);
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
      setSounding({ drums: null, bass: null, chords: null, lead: null });
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
