/**
 * VZ-TH-1 — the audible-time offset queue (pure, node-testable).
 *
 * The note-on tap (VZ-IM-1) emits at DELIVERY (schedule) time, up to the
 * scheduler horizon (~1.5 s, src/audio/scheduler.ts) before the note is
 * audible. This queue holds those events and releases each one only when
 * the audio clock crosses its `audibleAt` — so every visible reaction can
 * fire at AUDIBLE time (House Lights contract 1: within one frame of the
 * audible time; schedule-time events never leak early) while late or
 * unobservable arrivals never burst (R3: drop-and-resync).
 *
 * Purity laws (VZ-MF-1 presets.ts precedent): no DOM, no Web Audio, no
 * clock reads — `now` is ALWAYS a drain() parameter (VZ-TH-2's frame loop
 * passes `ctx.currentTime`; Booth.tsx's playhead re-read pattern) — and
 * no randomness anywhere (the determinism contract; nothing here is
 * random by construction).
 *
 * Insert is NEVER gated (R3): no visibility/transport condition can refuse
 * an event — the drain-side stale rule is the single enforcement. That is
 * what lets VZ-TH-3 add clear-on-hide + resync WITHOUT reworking this
 * module: hide clears (`clear()`), the tap keeps inserting future-dated
 * events while hidden (bounded below by the capacity), and the first
 * visible drain drops the stale past under the shared grace constant.
 */

import type { VizNoteOn } from "../engine/session";

/**
 * Drain-side stale grace, in audio-clock SECONDS — 32 ms = 2 frames @
 * 60 Hz (R3, docs/ultron/research/r3-hidden-page-policy.md §2/§6.1). An
 * event fires only while `now - audibleAt <= VIZ_STALE_GRACE_SECONDS`;
 * anything older drops silently at drain (never bursts). The constant is
 * OWNED here (VZ-TH-1) and shared, never duplicated: VZ-TH-3's
 * hidden-page policy imports it — its stale-drop and this one are the
 * same rule (VZ-TH-2's one-frame law ×2; imperceptible, and it covers the
 * brief tab-flap edge and ordinary dropped frames near any pause).
 */
export const VIZ_STALE_GRACE_SECONDS = 0.032;

/**
 * The queue's ONLY policy predicate, exported so VZ-TH-3 reuses the exact
 * rule instead of restating it: an event is firable at `now` iff its
 * audible time has arrived AND it is still within the stale grace. A
 * non-finite `now` or `audibleAt` fires nothing.
 */
export function shouldFireAtDrain(event: VizNoteOn, now: number): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(event.audibleAt)) return false;
  return (
    event.audibleAt <= now &&
    now - event.audibleAt <= VIZ_STALE_GRACE_SECONDS
  );
}

/**
 * Default bound, sized to the engine's schedule lead: the scheduler
 * horizon 1.5 s (src/audio/scheduler.ts `horizonSeconds`) times the
 * densest standard rate 53 1/3 events/s (16ths @ 200 BPM × 4 lanes,
 * plan VZ-TH-4's worst case) = 80 events in steady state. The constant
 * carries ~20% headroom above that (96) because the bound is enforced
 * OLDEST-FIRST: when a scheduler refill lands between two viz drains,
 * the queue transiently holds one extra frame's worth of events, and
 * the headroom guarantees the eviction can never eat a still-due hit.
 * Sustained inserts beyond the bound evict the OLDEST entry (see
 * insert) — the stalest at any eventual drain, so the least is lost.
 */
export const VIZ_OFFSET_QUEUE_CAPACITY = 96;

export interface OffsetQueueOptions {
  /** Max simultaneously held events (default VIZ_OFFSET_QUEUE_CAPACITY). */
  readonly capacity?: number;
}

export interface OffsetQueue {
  /**
   * Accept one tapped note-on. Never gated (no clock, no visibility, no
   * transport condition) and backpressure-free: O(log n) locate + splice
   * on a capacity-bounded array, never throws. An event with a
   * non-finite `audibleAt` is ignored (the engine never produces one; the
   * guard only keeps the sort invariant total).
   */
  insert(event: VizNoteOn): void;
  /**
   * Release every event whose audible time has arrived at audio-clock
   * `now` (the caller's injected clock read): ordered by `audibleAt`
   * (ties in insertion order), each at most VIZ_STALE_GRACE_SECONDS past
   * its audible time — older ones drop silently, future ones stay. A
   * non-finite `now` parks the queue unchanged and returns [].
   */
  drain(now: number): VizNoteOn[];
  /** Empty the queue (stop teardown now; VZ-TH-3 hide entry later). */
  clear(): void;
  /** Events currently held (0 .. capacity). */
  readonly size: number;
  /** The effective bound (normalized from options, never below 1). */
  readonly capacity: number;
}

/**
 * Create the offset queue. The queue is kept sorted by `audibleAt`
 * (binary-search insert, stable among ties), so both drain and the
 * oldest-first eviction read from the head only.
 */
export function createOffsetQueue(
  opts: OffsetQueueOptions = {},
): OffsetQueue {
  const raw = opts.capacity ?? VIZ_OFFSET_QUEUE_CAPACITY;
  const capacity =
    Number.isFinite(raw) && raw >= 1
      ? Math.floor(raw)
      : VIZ_OFFSET_QUEUE_CAPACITY;
  let queue: VizNoteOn[] = [];

  return {
    get size() {
      return queue.length;
    },
    capacity,
    insert(event) {
      if (!Number.isFinite(event.audibleAt)) return;
      // Insert AFTER every entry with audibleAt <= ours: equal audibleAt
      // (same tick, several lanes/pieces) keeps FIRST-IN-FIRST-DRAINED.
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (queue[mid]!.audibleAt <= event.audibleAt) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, event);
      // Bound: drop the OLDEST (head — earliest audibleAt, first in) so a
      // sustained insert without drain loses the already-stalest events.
      if (queue.length > capacity)
        queue.splice(0, queue.length - capacity);
    },
    drain(now) {
      if (!Number.isFinite(now)) return [];
      const due: VizNoteOn[] = [];
      while (queue.length > 0) {
        const head = queue[0]!;
        if (head.audibleAt > now) break; // future: stays queued
        queue.shift();
        if (shouldFireAtDrain(head, now)) due.push(head);
        // else: stale — dropped at the drain, never bursts (R3).
      }
      return due;
    },
    clear() {
      queue = [];
    },
  };
}
