/**
 * VIZ textual event equivalence (VZ-DD-3) — the reduced-motion surface's
 * non-visual channel, as a PURE module: per-lane activity summaries at a
 * BOUNDED rate (phase/summary level, NOT per-hit — the recorded choice in
 * plan.md §VZ-DD-3 risks). The canvas swap shows the rig statically; this
 * module says what the song is DOING.
 *
 * DD-2 OWNS THE ANNOUNCEMENTS (the fence this module holds): nothing here
 * touches the DOM, ships an aria-live region, or announces anything — it
 * computes the strings VZ-DD-2's live region will speak. VizPage runs one
 * summarizer per mount under reduced motion and DD-2 reads
 * `activeVizActivitySummarizers()` for the mounted page's instance.
 *
 * Rate law: at most ONE emission per
 * VIZ_ACTIVITY_MIN_INTERVAL_SECONDS (2 s — far under any spam threshold,
 * matching DD-2's bounded-announcement intent); suppressed notes return
 * null and change nothing. Counts are per-lane hits over a trailing
 * VIZ_ACTIVITY_COUNT_WINDOW_SECONDS window, in LANE_IDS order, uppercase
 * (the remote's silkscreen copy law). Deterministic: a pure function of
 * the (hit, now) sequence — no randomness (the determinism contract), no
 * clock reads (`now` is the caller's audio-clock read), no DOM.
 */

import { ALL_LANE_IDS as LANE_IDS, type LaneId } from "../document/schema";

/** Minimum spacing between emissions, audio-clock seconds (the rate law). */
export const VIZ_ACTIVITY_MIN_INTERVAL_SECONDS = 2;

/** Trailing window the emitted counts cover, audio-clock seconds. */
export const VIZ_ACTIVITY_COUNT_WINDOW_SECONDS = 2;

/** The summary line's constant prefix (the INFO_MODE_* constants style). */
export const VIZ_ACTIVITY_PREFIX = "VIZ ACTIVITY";

/** One noted hit (the structural subset the summarizer reads). */
export interface VizActivityHit {
  readonly lane: LaneId;
  readonly audibleAt: number;
}

export interface VizActivitySummarizer {
  /**
   * Note one drained (audible-time) hit. Returns the summary line when
   * this note's emission is due (≥ the rate floor since the last), else
   * null — the hit is COUNTED either way (the next emission reports it).
   */
  note(hit: VizActivityHit, now: number): string | null;
  /** The last emitted line (null before the first) — DD-2's region text. */
  current(): string | null;
  /** Emissions so far (the rate-law ledger). */
  readonly emissions: number;
}

/** Format the counts (exported for tests + DD-2's reuse; pure). */
export function formatVizActivitySummary(
  counts: Readonly<Record<LaneId, number>>,
): string {
  const parts = LANE_IDS.filter(
    (lane) => !lane.startsWith("extra") || counts[lane] > 0,
  ).map(
    (lane) =>
      `${lane.startsWith("extra") ? `TRACK ${Number(lane.slice(-1)) + 4}` : lane.toUpperCase()} ${counts[lane]}`,
  );
  return `${VIZ_ACTIVITY_PREFIX} — ${parts.join(" · ")}`;
}

// -- module-level registry (inert; the controllers/renderers precedent) -------

const liveSummarizers = new Set<VizActivitySummarizer>();

/**
 * Live summarizers, oldest first (0 after every dispose). The browser gates
 * read the mounted page's instance; VZ-DD-2's live region will consume the
 * same seam.
 */
export function activeVizActivitySummarizers(): readonly VizActivitySummarizer[] {
  return [...liveSummarizers];
}

/**
 * Create the summarizer. PURE bookkeeping over injected times — the unit
 * suite drives it with tables; VizPage feeds it drained hits at the audio
 * clock.
 */
export function createVizActivitySummarizer(): VizActivitySummarizer {
  const noted: Array<{ lane: LaneId; at: number }> = [];
  let lastEmission: string | null = null;
  let emittedAt = Number.NEGATIVE_INFINITY;
  let emissions = 0;

  const summarize = (now: number): string => {
    // Prune the trailing count window, then count per lane in LANE_IDS
    // order (deterministic formatting).
    while (
      noted.length > 0 &&
      noted[0]!.at < now - VIZ_ACTIVITY_COUNT_WINDOW_SECONDS
    ) {
      noted.shift();
    }
    const counts = Object.fromEntries(
      LANE_IDS.map((lane) => [lane, 0]),
    ) as Record<LaneId, number>;
    for (const entry of noted) counts[entry.lane]++;
    return formatVizActivitySummary(counts);
  };

  const summarizer: VizActivitySummarizer = {
    note(hit, now) {
      if (!Number.isFinite(hit.audibleAt) || !Number.isFinite(now)) {
        return null; // degenerate clock reads never emit garbage
      }
      noted.push({ lane: hit.lane, at: hit.audibleAt });
      if (now - emittedAt < VIZ_ACTIVITY_MIN_INTERVAL_SECONDS) return null;
      emittedAt = now;
      emissions++;
      lastEmission = summarize(now);
      return lastEmission;
    },
    current() {
      return lastEmission;
    },
    get emissions() {
      return emissions;
    },
  };

  liveSummarizers.add(summarizer);
  return summarizer;
}

/** Test/teardown helper: drop a summarizer from the live registry. */
export function releaseVizActivitySummarizer(
  summarizer: VizActivitySummarizer,
): void {
  liveSummarizers.delete(summarizer);
}
