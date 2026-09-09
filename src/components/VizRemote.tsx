/**
 * VizRemote (VZ-DD-1) — the DOM "remote" that carries ALL of the VIZ
 * surface's a11y (.impeccable/surfaces/viz.md, Interaction intent): a
 * minimal silkscreened chassis, bottom-anchored and center-set over the
 * canvas, that RECEDES BY SMALLNESS AND STILLNESS — never by hiding. One
 * chassis cast (the rail-popover law: opaque token ground, 1px 25%-ink
 * border, offset+blur shadow), three controls:
 *
 * - PRESET readout + prev/next (the booth TEMPO stepper cast) — cycles the
 *   library through the arrangement controller's `cycle(±1)`, wrapping;
 * - REROLL — the controller's coalesced `reroll()`;
 * - EXIT — `closeViz()`, with Escape and the global `v` key as twins.
 *
 * KEYBOARD PARITY (keyboard.md §"VIZ page", the rovingGroup helper): the
 * four buttons are ONE Tab stop — ←/→ walk the chain (clamped, no wrap),
 * Home/End jump, Enter/Space activate natively. While the surface is on,
 * the covered stage below is `inert` (App.tsx), so NOTHING outside this
 * remote (and the always-reachable failure chrome above it) holds a Tab
 * stop — the plan's "no new Tab stops beyond the remote" law, held by
 * construction rather than by enumeration.
 *
 * The PRESET readout consumes `vizPrefs()` reactively (src/viz/state.ts —
 * one update per COMMITTED deal, so pending reroll windows never flicker
 * it); the ACTIONS go straight to the live controller VizPage mounted
 * (late-bound getter — the remote renders before VizPage's onMount creates
 * the controller, and clicks can only land after).
 *
 * ANNOUNCEMENTS (VZ-DD-2): the readout stays a plain visible span (the
 * current name stays readable); the page's ONE polite live region
 * (src/viz/announcements.ts, rendered by VizPage) speaks entry, preset
 * names and reroll notices off the same funnels this remote drives. This
 * component's announcement duty is the TRANSPORT EDGE: the session
 * subscription that flips the idle line also speaks its twin through the
 * injected `announce` seam (PLAYBACK STARTED / the idle line's own words)
 * — the spoken and visible state are one string, owned here.
 *
 * ENTRY FOCUS (VZ-DD-2, keyboard.md §"VIZ page" Focus law): mounting the
 * remote IS the surface's entry (App's <Show>), so its onMount hands
 * focus to the roving seed — the first control — exactly once per open.
 * The exit's focus RETURN rides closeViz's stored invoker (unchanged),
 * and nothing here ever re-focuses on preset/reroll changes (a re-deal
 * never steals focus from wherever the user is).
 *
 * The idle line (J2 legibility): while the transport is STOPPED the remote
 * carries the warm-white "PLAYBACK STOPPED — EXIT TO TRANSPORT" line — the
 * stage is never a dead screen, and the way back to the booth is named.
 * Transport observation rides the session's coarse subscribe (the Booth
 * precedent); the signal only ever flips on real transport snapshots, so
 * the chrome is still between-frames static (the stillness law).
 *
 * VZ-DD-4 — the PHONE-STAGE GATE (the committed fallback form: gate +
 * message, the plan's fence-lean default — the surface is desktop-first by
 * brief, and a reduced mode would be a new show form outside the lean
 * fence). At `stageMode() === "phone"` this ONE chassis swaps its contents
 * for the gate: the message line ("THE LIGHT SHOW RUNS ON A LARGER
 * SCREEN"), the idle line while stopped (unchanged law), and EXIT — the
 * surface's single control, painted ≥44×44 (the target law; the gate is a
 * full-screen message, not pinned chrome, so the honest route is paint).
 * Every DD-1/DD-2 law carries over UNCHANGED by staying on this one
 * component: the transport subscription (edges still speak), the entry
 * focus (the roving seed — here the single EXIT), the roving helper (one
 * button: inert but harmless), the closeViz funnel, the help stamp. A live
 * desktop→phone flip mid-show swaps the form in place: focus that falls
 * with the unmounted controls is re-seeded onto the live form's first
 * control, and the gate line is SPOKEN once (a screen-reader user's show
 * just stood down — the why is the announcement); the reverse flip
 * restores the full remote without a word (the show resumes visibly).
 */

import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { getSession } from "../engine/session";
import { stageMode } from "../state/selection";
import { closeViz } from "../state/vizMode";
import { vizPrefs } from "../viz/state";
import {
  VIZ_PHONE_GATE_MESSAGE,
  VIZ_PLAYBACK_STARTED_ANNOUNCEMENT,
} from "../viz/announcements";
import type { VizArrangementController } from "../viz/arrangement";
import { VIZ_PRESETS } from "../viz/presets";
import { registerHelp } from "../help/registry";
import { rovingGroup } from "../lib/rovingGroup";

const session = getSession();

/** The idle line's exact copy (J2; warm-white ink on the ground). */
export const VIZ_IDLE_LINE = "PLAYBACK STOPPED — EXIT TO TRANSPORT";

// VZ-DD-1 help content (the HP-2 colocated law — defined next to the
// controls that carry the data-help stamps; the help-coverage walk gates
// these). Plain language, says what it is + what happens, keyboard twin
// named (I2-6).
registerHelp([
  {
    id: "viz.preset",
    title: "PRESET",
    text: "The light rig the song is playing on, by name. The arrows step through the preset library in order, wrapping around at the ends — each step re-hangs the whole rig immediately.",
  },
  {
    id: "viz.reroll",
    title: "REROLL",
    text: "Deals a fresh random arrangement of the current preset — same rig, new layout. Click it again quickly and the bursts collapse into one re-deal.",
  },
  {
    id: "viz.exit",
    title: "EXIT",
    text: "Leaves the visualizer and returns to the booth; focus lands back where you left it. Escape and V do the same. The music keeps playing either way.",
  },
]);

export interface VizRemoteProps {
  /**
   * The live arrangement controller (null before VizPage's onMount and
   * after its cleanup — actions on a null controller are quiet no-ops, the
   * only window being a click that races the mount itself).
   */
  getController(): VizArrangementController | null;
  /**
   * Speak one line through the page's live region (VZ-DD-2 — the
   * transport-edge twin of the idle line; the region itself is VizPage's).
   */
  announce(text: string): void;
}

export default function VizRemote(props: VizRemoteProps): JSX.Element {
  let chassis: HTMLDivElement | null = null;
  const [playing, setPlaying] = createSignal(
    session.transport.snapshot.playing,
  );
  // VZ-DD-4: the phone-stage gate form (reactive — live flips swap in place).
  const phone = (): boolean => stageMode() === "phone";

  onMount(() => {
    const unsubscribe = session.subscribe((snap) => {
      // One announcement per real transport EDGE (the bounded-announcement
      // law): the stopped edge speaks the idle line's own words, the
      // running edge names playback — the visible line and the spoken
      // twin are the same string for the stopped case by design.
      const was = playing();
      setPlaying(snap.playing);
      if (was !== snap.playing) {
        props.announce(
          snap.playing ? VIZ_PLAYBACK_STARTED_ANNOUNCEMENT : VIZ_IDLE_LINE,
        );
      }
    });
    onCleanup(unsubscribe);
    // One Tab stop for the whole surface (the DA-1 roving helper; its
    // arrows clamp — the app-wide no-wrap law).
    if (chassis) onCleanup(rovingGroup(chassis).dispose);
    // VZ-DD-2 ENTRY FOCUS: the roving seed (first control) receives focus
    // the moment the surface opens — the modal law, scoped to the remote's
    // own group (nothing else is focusable up here; the stage below is
    // inert). closeViz's stored invoker is untouched by this move.
    const seed = chassis?.querySelector<HTMLElement>("button");
    seed?.focus();
  });

  // VZ-DD-4 — LIVE FORM FLIPS (desktop ⇄ phone while the surface is on).
  // Reading stageMode() tracks; the DOM for the new form has settled by
  // effect time, so: (a) focus that fell to <body> with the unmounted
  // form's controls is re-seeded onto the LIVE form's first control (the
  // focus law survives rotation/resize, the m2 rotation-coherence law's
  // sibling); (b) a flip INTO the gate speaks the gate line once — the
  // entry line already covers a phone-width MOUNT, so only mid-session
  // flips announce (a form flap under rotation re-announces per arrival,
  // matching the one-announcement-per-state-change law).
  let formRuns = 0;
  createEffect(() => {
    const gate = phone();
    const flips = formRuns++ > 0;
    if (flips && gate) props.announce(VIZ_PHONE_GATE_MESSAGE);
    if (chassis && !chassis.contains(document.activeElement)) {
      chassis.querySelector<HTMLElement>("button")?.focus();
    }
  });

  const presetName = (): string => {
    const id = vizPrefs().presetId;
    const preset = VIZ_PRESETS.find((p) => p.id === id);
    // Library churn between read and render degrades to the first preset's
    // name — never a crash (the state.ts boot guard's read-time twin).
    return (preset ?? VIZ_PRESETS[0]!).name;
  };

  const cycle = (delta: number): void => {
    props.getController()?.cycle(delta);
  };
  const reroll = (): void => {
    props.getController()?.reroll();
  };

  // ONE chassis, TWO forms (VZ-DD-4): the cast is the rail-popover law's
  // either way; at phone the gate modifier re-anchors it as a centered
  // message card and the role softens to a labelled GROUP (a notice + one
  // button is not a toolbar — axe snapshots whichever form is live).
  return (
    <div
      ref={(el) => {
        chassis = el;
      }}
      class="viz-remote"
      classList={{ "viz-remote-gate": phone() }}
      role={phone() ? "group" : "toolbar"}
      aria-label="VIZ remote"
    >
      <Show
        when={phone()}
        fallback={
          <>
            {!playing() && <p class="viz-remote-idle">{VIZ_IDLE_LINE}</p>}
            <div
              class="viz-remote-preset"
              role="group"
              aria-label="Preset"
              data-help="viz.preset"
            >
              <span class="viz-remote-label" aria-hidden="true">
                PRESET
              </span>
              <button
                type="button"
                class="viz-remote-btn"
                aria-label="Previous preset"
                onClick={() => cycle(-1)}
              >
                –
              </button>
              {/* The readout: committed deals only (vizPrefs), plain in-tree
            text (the current name stays readable; DD-2's live region will carry
            its spoken-on-change twin). */}
              <span class="viz-remote-name">{presetName()}</span>
              <button
                type="button"
                class="viz-remote-btn"
                aria-label="Next preset"
                onClick={() => cycle(1)}
              >
                +
              </button>
            </div>
            <button
              type="button"
              class="viz-remote-btn viz-remote-reroll"
              data-help="viz.reroll"
              onClick={reroll}
            >
              REROLL
            </button>
            <button
              type="button"
              class="viz-remote-btn viz-remote-exit"
              data-help="viz.exit"
              onClick={() => closeViz()}
            >
              EXIT
            </button>
          </>
        }
      >
        {/* The phone gate: the message names the situation, the idle line
            (stopped only) names the way back, EXIT is the single control. */}
        <p class="viz-phone-message">{VIZ_PHONE_GATE_MESSAGE}</p>
        {!playing() && <p class="viz-remote-idle">{VIZ_IDLE_LINE}</p>}
        <button
          type="button"
          class="viz-remote-btn viz-remote-exit"
          data-help="viz.exit"
          onClick={() => closeViz()}
        >
          EXIT
        </button>
      </Show>
    </div>
  );
}
