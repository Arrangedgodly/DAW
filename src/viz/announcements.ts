/**
 * VIZ announcements (VZ-DD-2) — the surface's non-visual channel: the copy
 * constants (the INFO_MODE_* style, state/helpMode.ts) + the ONE polite
 * live-region announcer owned by the viz page. The page's region
 * (VizPage's `.viz-announce` div) speaks entry, preset names, reroll
 * notices, transport edges and — under reduced motion — the textual
 * equivalence summaries (src/viz/textEquivalence.ts, read through the
 * summarizer's return line). The EXIT announcement is the one exception:
 * it rides the stage-level status region (announceStage) because this
 * page's own region is, correctly, unmounted the instant the mode turns
 * off — the exact reasoning state/helpMode.ts records for INFO MODE OFF.
 *
 * Bounded-announcement law (plan §VZ-DD-2): state changes only, never
 * per-hit narration. Full motion announces entry/exit, committed preset
 * switches and rerolls, transport edges; reduced motion ADDS the activity
 * summaries at their own 2 s floor (textEquivalence's rate law — this
 * module adds no second clock). Every caller fires at most once per
 * event: the arrangement announcements hang off the controller's
 * subscribe seam (once per COMMIT — a coalesced reroll burst announces
 * exactly once, mirroring the 150 ms commit law).
 *
 * The announcer is DIRECT-DOM by design (textContent writes, never a
 * Solid signal): the reduced-motion summaries arrive inside the render
 * loop's drain, and the rAF law forbids framework-state writes from the
 * loop. A bounded chrome write (≤ one per 2 s under reduce) is the canvas
 * law's own idiom. Identical consecutive texts re-announce through the
 * clear-then-set replay (two tasks apart), so e.g. a second committed
 * REROLL speaks again.
 */

/**
 * The gap between the dedup clear and the replayed set, milliseconds.
 * Two tasks apart is the classic live-region re-announcement idiom; 30 ms
 * is far under any perception budget and never observable in chrome.
 */
export const VIZ_ANNOUNCE_REPLAY_MS = 30;

/** Entry while playing — names the fact that matters (transport isolation). */
export const VIZ_ON_ANNOUNCEMENT = "VIZ ON — THE MUSIC KEEPS PLAYING";

/** Entry while stopped — the idle line's spoken twin, truthful at entry. */
export const VIZ_ON_IDLE_ANNOUNCEMENT = "VIZ ON — PLAYBACK STOPPED";

/**
 * The phone-stage GATE line (VZ-DD-4, the committed fallback form): one
 * string, spoken and visible — the gate message names the situation, never
 * an apology (the idle line below it names the way back when stopped).
 */
export const VIZ_PHONE_GATE_MESSAGE = "THE LIGHT SHOW RUNS ON A LARGER SCREEN";

/** Entry at phone width while playing — gate truth + the isolation fact. */
export const VIZ_ON_PHONE_ANNOUNCEMENT = `VIZ ON — ${VIZ_PHONE_GATE_MESSAGE} — THE MUSIC KEEPS PLAYING`;

/** Entry at phone width while stopped — gate truth + the stopped state. */
export const VIZ_ON_PHONE_IDLE_ANNOUNCEMENT = `VIZ ON — ${VIZ_PHONE_GATE_MESSAGE}`;

/** Exit (spoken through the STAGE region — see the header law). */
export const VIZ_OFF_ANNOUNCEMENT = "VIZ OFF";

/** A committed coalesced reroll — names WHAT was re-dealt, not just that. */
export const VIZ_REROLL_ANNOUNCEMENT = "ARRANGEMENT REROLLED";

/** Transport running edge while the surface is on. */
export const VIZ_PLAYBACK_STARTED_ANNOUNCEMENT = "PLAYBACK STARTED";
// The stopped edge speaks VIZ_IDLE_LINE (VizRemote's constant — the visible
// idle line and its spoken twin are ONE string, owned where it renders).

/** A committed preset switch speaks the new preset's name (pure). */
export function vizPresetAnnouncement(name: string): string {
  return `PRESET ${name}`;
}

/** Inert snapshot — the browser gates' once-per-event evidence. */
export interface VizAnnouncerProbe {
  /** The last announced text (null before the first). */
  readonly last: string | null;
  /** announce() calls accepted so far (the bounded-announcement ledger). */
  readonly emissions: number;
}

export interface VizAnnouncer {
  /** Bind the live region element (VizPage's JSX ref; one per announcer). */
  attach(region: HTMLElement): void;
  /**
   * Speak `text` through the region (polite, bounded, dedup-safe). A no-op
   * on empty text; dropped (not queued) if no region is attached yet.
   */
  announce(text: string): void;
  /** Inert snapshot. */
  probe(): VizAnnouncerProbe;
  /**
   * Cancel any pending replay timer, drop the region ref and leave the
   * live registry (the page's teardown — nothing survives the unmount).
   */
  dispose(): void;
}

// -- module-level registry (inert; the controllers/summarizers precedent) ---

const liveAnnouncers = new Set<VizAnnouncer>();

/**
 * Live announcers, oldest first (0 after every dispose). The browser gates
 * read the mounted page's instance for the emissions ledger (the
 * activeVizArrangementControllers precedent).
 */
export function activeVizAnnouncers(): readonly VizAnnouncer[] {
  return [...liveAnnouncers];
}

/**
 * Create the announcer. One per VizPage mount; the region element arrives
 * via attach (Solid assigns refs during render, before any announcement
 * can fire — the entry line lands a task after mount by design).
 */
export function createVizAnnouncer(): VizAnnouncer {
  let region: HTMLElement | null = null;
  let last: string | null = null;
  let emissions = 0;
  let replay: ReturnType<typeof setTimeout> | null = null;

  const write = (text: string): void => {
    // Direct DOM (the header law): never a signal, never reactive children.
    if (region) region.textContent = text;
  };

  const announcer: VizAnnouncer = {
    attach(next) {
      region = next;
    },
    announce(text) {
      if (!text) return;
      // A newer announcement supersedes any pending replay outright.
      if (replay !== null) {
        clearTimeout(replay);
        replay = null;
      }
      if (text === last) {
        // Identical consecutive text: clear, then re-set a task later, so
        // the mutation re-announces instead of reading as no-change.
        write("");
        replay = setTimeout(() => {
          replay = null;
          write(text);
        }, VIZ_ANNOUNCE_REPLAY_MS);
      } else {
        write(text);
      }
      last = text;
      emissions++;
    },
    probe() {
      return { last, emissions };
    },
    dispose() {
      if (replay !== null) {
        clearTimeout(replay);
        replay = null;
      }
      region = null;
      liveAnnouncers.delete(announcer);
    },
  };

  liveAnnouncers.add(announcer);
  return announcer;
}
