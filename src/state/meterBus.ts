/**
 * meterBus — the ONE audible-note-on feed for the unit's meters (THE FULL
 * UNIT, live-signal pass): the four lane channel meters (LaneMeter) and the
 * booth screen's meter bank (BoothScreen) register their lit bars here; the
 * bus holds a single session.subscribeNoteOns tap while any meter is
 * mounted.
 *
 * The scheduler delivers note-ons up to ~1.5s before they are heard. Each
 * delivered note parks in a cheap per-lane TIMER bucket keyed by its audible
 * instant (notes of one lane landing together — a chord, a kit stack —
 * share a bucket and raise its level); when the bucket fires, every
 * registered bar gets ONE fresh Web Animation that REPLACES the bar's
 * previous one — instant attack, a short hold, a segment-quantized fall.
 * Levels come from the delivered voice level; muted lanes (and lanes
 * silenced by another lane's SOLO) stay dark — the meter shows what you HEAR.
 *
 * HANDS BEFORE LIGHTS (the perf law, measured on the 128-bar LP-1/TH-5
 * sweeps): the meters are decoration and never compete with the grid for
 * the main thread. One live animation per bar (never a stack of delayed
 * ones), at most one strike per lane per MIN_STRIKE_GAP_MS, and NO strikes
 * while any scroller is moving (and for SCROLL_QUIET_MS after) — a fling
 * owns every frame it needs.
 *
 * Laws: zero DOM writes (WAAPI transform on a pre-painted bar — nothing a
 * MutationObserver can see, compositor-only), zero rAF loops, observe-only
 * tap (the session contains a throwing listener), transport park cancels
 * every pending strike, and it fires nothing under prefers-reduced-motion,
 * while the VIZ page covers the stage, or while the tab is hidden.
 */

import type { LaneId } from "../document/schema";
import { getSession, type VizNoteOn } from "../engine/session";
import { docStore } from "./store";
import { vizMode } from "./vizMode";

export type MeterAxis = "x" | "y";

interface Meter {
  readonly el: HTMLElement;
  readonly axis: MeterAxis;
}

interface Bucket {
  peak: number;
  count: number;
  timer: number;
}

const SEGMENTS = 12;
const DURATION_MS = 460;
const HOLD = 0.12;
/** Audible-time bucket width: 2ms — one strike per lane per instant. */
const BUCKETS_PER_SECOND = 500;
/** Strike ceiling per lane (16ths at ≤136 BPM all strike; faster → every other). */
const MIN_STRIKE_GAP_MS = 110;
/** Quiet window after the last scroll event before meters strike again. */
const SCROLL_QUIET_MS = 200;

const meters = new Map<LaneId, Set<Meter>>();
const pending = new Map<LaneId, Map<number, Bucket>>();
const lastStrikeAt = new Map<LaneId, number>();
const live = new WeakMap<HTMLElement, Animation>();
let lastScrollAt = -Infinity;
let unsubscribeNotes: (() => void) | null = null;
let unsubscribeTransport: (() => void) | null = null;

const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const onScroll = (): void => {
  lastScrollAt = performance.now();
};

function audible(lane: LaneId): boolean {
  const lanes = docStore.getState().doc.lanes;
  const conf = lanes.find((l) => l.id === lane);
  if (!conf || conf.mute === true) return false;
  const anySolo = lanes.some((l) => l.solo === true);
  return !anySolo || conf.solo === true;
}

function level(peak: number, count: number): number {
  const v = Math.min(1, Math.max(0, peak));
  return Math.min(1, 0.3 + 0.7 * v + 0.12 * (count - 1));
}

function fire(lane: LaneId, key: number): void {
  const lanePending = pending.get(lane);
  const bucket = lanePending?.get(key);
  if (!lanePending || !bucket) return;
  lanePending.delete(key);
  if (vizMode() || document.hidden || reducedMotion()) return;
  const now = performance.now();
  if (now - lastScrollAt < SCROLL_QUIET_MS) return;
  if (now - (lastStrikeAt.get(lane) ?? -Infinity) < MIN_STRIKE_GAP_MS) return;
  const set = meters.get(lane);
  if (!set) return;
  lastStrikeAt.set(lane, now);
  const steps = Math.max(1, Math.round(level(bucket.peak, bucket.count) * SEGMENTS));
  const q = steps / SEGMENTS;
  for (const m of set) {
    const scale = (v: number) => (m.axis === "y" ? `scaleY(${v})` : `scaleX(${v})`);
    live.get(m.el)?.cancel();
    live.set(
      m.el,
      m.el.animate(
        [
          { transform: scale(q), offset: 0 },
          { transform: scale(q), offset: HOLD, easing: `steps(${steps}, end)` },
          { transform: scale(0), offset: 1 },
        ],
        { duration: DURATION_MS },
      ),
    );
  }
}

function onNoteOn(hit: VizNoteOn): void {
  if (reducedMotion() || vizMode() || document.hidden) return;
  if (!meters.has(hit.lane) || !audible(hit.lane)) return;
  const session = getSession();
  if (!session.engine.created) return;
  const now = session.engine.getContext().currentTime;
  if (!Number.isFinite(hit.audibleAt) || hit.audibleAt < now - 0.03) return;
  const key = Math.round(hit.audibleAt * BUCKETS_PER_SECOND);
  let lanePending = pending.get(hit.lane);
  if (!lanePending) {
    lanePending = new Map();
    pending.set(hit.lane, lanePending);
  }
  const bucket = lanePending.get(key);
  if (bucket) {
    bucket.peak = Math.max(bucket.peak, hit.velocity);
    bucket.count += 1;
    return;
  }
  const lane = hit.lane;
  const delay = Math.max(0, (hit.audibleAt - now) * 1000);
  lanePending.set(key, {
    peak: hit.velocity,
    count: 1,
    timer: window.setTimeout(() => fire(lane, key), delay),
  });
}

function clearPending(): void {
  for (const lanePending of pending.values())
    for (const bucket of lanePending.values()) window.clearTimeout(bucket.timer);
  pending.clear();
}

function cancelAll(): void {
  clearPending();
  for (const set of meters.values())
    for (const m of set) {
      live.get(m.el)?.cancel();
      live.delete(m.el);
    }
}

function connect(): void {
  if (unsubscribeNotes) return;
  const session = getSession();
  unsubscribeNotes = session.subscribeNoteOns(onNoteOn);
  unsubscribeTransport = session.subscribe((snap) => {
    if (!snap.playing) cancelAll();
  });
  // Scroll events do not bubble; capture sees every scroller's.
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

function disconnect(): void {
  unsubscribeNotes?.();
  unsubscribeTransport?.();
  unsubscribeNotes = null;
  unsubscribeTransport = null;
  document.removeEventListener("scroll", onScroll, { capture: true });
  clearPending();
  lastStrikeAt.clear();
}

/** Register a lit meter bar for `lane`; returns its unregister. */
export function registerMeter(lane: LaneId, el: HTMLElement, axis: MeterAxis): () => void {
  const meter: Meter = { el, axis };
  let set = meters.get(lane);
  if (!set) {
    set = new Set();
    meters.set(lane, set);
  }
  set.add(meter);
  connect();
  return () => {
    live.get(el)?.cancel();
    live.delete(el);
    const current = meters.get(lane);
    current?.delete(meter);
    if (current && current.size === 0) meters.delete(lane);
    if (meters.size === 0) disconnect();
  };
}
