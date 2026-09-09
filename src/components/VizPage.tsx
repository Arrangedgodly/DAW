/**
 * VizPage (VZ-IM-2) — the House Lights mount shell: the app's second
 * full-screen surface, mounted by App ONLY while vizMode is on (the
 * helpMode/InfoView <Show> precedent). While closed there is zero VIZ DOM
 * and this component's listeners do not exist (HP-1 zero-cost clause).
 *
 * VZ-IM-4: the page now hosts the CANVAS SKELETON — a full-bleed
 * `.viz-canvas` owned by `createVizRenderer` (src/viz/renderer.ts), whose
 * loop paints the token ground and calls the `onFrame` seam.
 *
 * VZ-TH-2: the page now owns the HIT PIPELINE (src/viz/pipeline.ts) — the
 * thin end-to-end path: the session's note-on tap (schedule-time delivery)
 * feeds the audible-time offset queue; the renderer's frame loop drains it
 * at `ctx.currentTime` (the Booth.tsx playhead-loop clock precedent, read
 * fresh per frame — the one-frame law). Both are created in onMount and
 * disposed in onCleanup: unmounting the page leaves ZERO live
 * rAF/observers/listeners AND zero engine subscriptions.
 *
 * VZ-IM-5: drained hits now feed the NODE RENDERING ENGINE
 * (src/viz/nodes.ts) through the pipeline's `onDueHits` seam — the rig of
 * hung effect nodes (booted from the session envelope below) ignites in
 * the hitting lane's hue, pitch-positioned, on bounded one-shot
 * envelopes, over a static resting diagram. The component still only
 * owns mount/teardown + seam composition, never drawing; BPM rides a
 * doc-store subscription into a plain closure so per-beat motion derives
 * from the audio clock × BPM (transport time), never wall time. Later
 * tasks extend the engine's seams (VZ-IM-6 phases via
 * setRestLevel/setLiveGain, VZ-HU-3's clamp via maxLiveObjects).
 *
 * VZ-HU-2: the page now owns the RE-DEAL ORCHESTRATOR
 * (src/viz/arrangement.ts) — reroll (coalesced, last-wins, fresh seeded
 * seed per commit) and preset cycling (immediate, wrapping) drive the
 * engine's setArrangement with FULL teardown between arrangements (the
 * recorded CUT transition). The boot deal is dealt ONCE and shared by
 * engine and controller, so the controller issues setArrangement only on
 * COMMITS. No controls ship here — buttons/keys/announcements are
 * VZ-DD-1's; the controller is reachable for tests/chrome through
 * activeVizArrangementControllers() (the renderer's module-probe
 * precedent).
 *
 * VZ-IM-3: the boot deal is now the RESTORED SESSION ENVELOPE re-dealt
 * (src/viz/state.ts — last preset + seed from the `bitbounce.viz.v1`
 * localStorage key on first mount per session, the deterministic default
 * when memory is absent/corrupt/stale), and every COMMITTED deal is
 * persisted by wiring the controller's subscribe seam straight into
 * commitVizEnvelope — pending reroll requests never write (the
 * no-amplification law), a failed write never costs the running session.
 *
 * Escape exit (FINALIZED ORDER, VZ-DD-1 — keyboard.md §"VIZ page"): the
 * KEYS modal wins first (helpOverlay), then help mode exits (cancel-first,
 * InfoView's capture law), then VIZ — the full-screen surface peels before
 * any stage-level Escape consumer (inline edits / popovers / the FX
 * console / region-head pops are all under the page and unreachable while
 * it is on). Window CAPTURE + stopImmediatePropagation so the exit
 * swallows the keystroke exactly once — the same mechanics as InfoView's
 * handler, and order-robust both ways: if help mode turned on AFTER this
 * page mounted, this handler runs first and stands down (helpMode check);
 * if BEFORE, InfoView's earlier-registered capture handler swallows the
 * keystroke before this one sees it. The exit rides closeViz() so focus
 * RETURNS to the invoking booth control (the helpOverlay precedent; the
 * `v` key, the EXIT button and this Escape share the funnel).
 *
 * VZ-DD-1: the page now carries the REMOTE CHROME (src/components/
 * VizRemote.tsx) — the a11y surface (preset stepper, REROLL, EXIT, the
 * idle line) bound to this page's controller through a late-bound getter
 * (the controller is created in onMount below, after the children render;
 * clicks can only land after mount).
 *
 * VZ-DD-3: the reduced-motion alternative is wired through BOTH gates the
 * brief demands — CSS (viz.css kills chrome transitions under the media
 * query) and the render loop: the renderer's matchMedia seam (its
 * `onReducedMotionChange` + `probe().reducedMotion`) feeds the node
 * engine's `setReducedMotion`, so a LIVE preference flip mid-session swaps
 * the draw mode (static placed marks + bounded hold replace the animated
 * one-shots) without remount damage — engine, renderer, pipeline and
 * controller all survive the swap. Under reduce the drained hits also feed
 * the TEXTUAL EQUIVALENCE summarizer (src/viz/textEquivalence.ts — per-lane
 * activity summaries at a bounded rate, phase/summary level).
 *
 * VZ-DD-2: the page now owns the surface's ONE polite live region
 * (src/viz/announcements.ts + the `.viz-announce` div below). It speaks:
 * the ENTRY line (a task after mount — a region that mounts WITH its text
 * reads as initial content to screen readers, so the region inserts empty
 * first), the committed PRESET name and REROLL notice (classified off the
 * controller's subscribe seam — one announcement per COMMIT, so a
 * coalesced reroll burst speaks exactly once; pending requests are
 * silent, mirroring the no-amplification law), the TRANSPORT edges
 * (spoken by the remote, which owns the visible idle line) and — under
 * reduced motion only — the summarizer's activity lines at their own 2 s
 * floor (full motion never narrates hits; that is noise, not equivalence).
 * The announcer is DIRECT-DOM (textContent, never a signal) because the
 * activity lines arrive inside the render loop's drain — the rAF law
 * forbids framework-state writes from the loop; a bounded chrome write is
 * the canvas law's own idiom. The EXIT line rides the stage status region
 * through closeViz (the page's region dies with the page — see
 * state/vizMode.ts).
 *
 * VZ-IM-6: the page now owns the DENSITY-PHASE CONTROLLER
 * (src/viz/phases.ts) — the House Lights play arc. Drained hits feed a
 * trailing hit-rate window on the audio clock; the classifier (pure,
 * hysteresis) walks the stage through rest → sparse → working → full as
 * the groove fills, and a stopped transport is the IDLE state (the calm
 * near-static still diagram). Phase levels ride the engine's
 * setRestLevel/setLiveGain seams (IM-5's handoff), EASED between phases
 * (gradual, no strobing) with instant steps under reduce (DD-3's law);
 * the text-equivalent phase labels ("VIZ LIGHTS — …") ride the announcer
 * under REDUCED MOTION ONLY — DD-2's verified full-motion contract is a
 * closed state-change list this task adds nothing to.
 *
 * VZ-DD-4 (phone gate, the committed fallback form — gate + message): at
 * `stageMode() === "phone"` the page is the GATE — the canvas element
 * stays mounted (ref stability across live flips) but is display:none'd
 * and NO engine boots (the stage-mode effect below), so the phone gate
 * carries zero rAF/observers/engine subscriptions — non-interference
 * with the mobile stage beneath. The remote (VizRemote) swaps to its gate
 * form; the announcement region and every DD-2 law keep working (the
 * entry line speaks the gate; transport edges still speak; EXIT returns
 * focus through the unchanged closeViz funnel). A live flip back to the
 * wide stage re-boots the engines and continues the SESSION envelope.
 *
 * VZ-HU-1: the ERROR-CONTAINMENT BOUNDARY is closed here — the renderer's
 * loop wraps every draw (its own ground fill included) in a try/catch: a
 * thrown draw parks the loop into the `error` state (pure table,
 * src/viz/renderer.ts; NOT resumable by visibility flips — only EXIT
 * closes it), fires the `onError` seam exactly once, and this page
 * surfaces ONE DOM error line (direct textContent — the rAF-law idiom,
 * the announcer precedent; the line itself is not a live region, but the
 * same fixed copy IS announced once through DD-2's one polite region —
 * the 2026-09-05 polish P3, the show-parking state change speaks).
 * The fault never propagates toward the engine (audio inviolate) or the
 * window, and EXIT (Escape/`v`/button through the one closeViz funnel)
 * stays fully functional from `error` — the teardown contract below runs
 * unchanged. The page-lifecycle contract itself (closed / open-idle /
 * open-playing / hidden / phone-gate / error / disposed) is consolidated
 * as pure data in src/viz/stateMachine.ts with its unit pin.
 *
 * VZ-TH-3: the HIDDEN-PAGE HIT POLICY is wired through the pipeline's
 * `subscribeVisibility` seam (R3's confirmed drop-and-resync): hide clears
 * the queue, inserts are never gated (the tap keeps delivering while
 * hidden — audio tabs are timer-throttle-exempt), and the first visible
 * frame resyncs from ctx.currentTime alone — the drain's stale grace drops
 * the past, phase/envelopes recompute, no replayed burst, no time jump
 * (perf-budget.md §6's refocus contract, the background-tab precedent).
 *
 * Transport isolation (plan Preamble 8): opening/closing VIZ never stops
 * or alters playback. The pipeline's engine wiring is OBSERVATION-ONLY —
 * the note-on tap and the coarse transport snapshot (stop → clear the
 * queue) — with one guard that matters: the audio clock is read only after
 * `engine.created`, so merely OPENING VIZ before any playback never forces
 * the lazy AudioContext into existence (the app creates it at first play).
 */

import { createEffect, onCleanup, onMount, type JSX } from "solid-js";
import { getSession } from "../engine/session";
import { helpOpen } from "../state/helpOverlay";
import { helpMode } from "../state/helpMode";
import { stageMode } from "../state/selection";
import { closeViz } from "../state/vizMode";
import { createVizPipeline, type VizPipeline } from "../viz/pipeline";
import { docStore } from "../state/store";
import {
  createVizArrangementController,
  type VizArrangementController,
} from "../viz/arrangement";
import { createVizNodeEngine, type VizNodeEngine } from "../viz/nodes";
import {
  bootVizArrangementFromPrefs,
  commitVizEnvelope,
} from "../viz/state";
import { createVizRenderer, type VizRenderer } from "../viz/renderer";
import {
  createVizPhaseController,
  type VizPhaseController,
} from "../viz/phases";
import {
  createVizActivitySummarizer,
  releaseVizActivitySummarizer,
  type VizActivitySummarizer,
} from "../viz/textEquivalence";
import {
  createVizAnnouncer,
  vizPresetAnnouncement,
  VIZ_ON_ANNOUNCEMENT,
  VIZ_ON_IDLE_ANNOUNCEMENT,
  VIZ_ON_PHONE_ANNOUNCEMENT,
  VIZ_ON_PHONE_IDLE_ANNOUNCEMENT,
  VIZ_REROLL_ANNOUNCEMENT,
  type VizAnnouncer,
} from "../viz/announcements";
import VizRemote from "./VizRemote";
import "../styles/viz.css";

export default function VizPage(): JSX.Element {
  // VZ-HU-1: the error line's fixed copy (deterministic product text —
  // never the thrown error's own message, which is arbitrary host data).
  const VIZ_ERROR_LINE =
    "VIZ display error — lights parked. EXIT still works; audio unaffected.";
  // The canvas ref lands before onMount (Solid assigns refs during
  // render); the renderer owns it from start() to dispose(). The
  // ANNOUNCER exists from component scope for the same reason — the
  // region's JSX ref (below) attaches during render, before any
  // announcement can fire. The ERROR LINE's ref follows the same law
  // (onError fires from inside the rAF callback — the element must
  // already exist; direct textContent only, one write, idempotent).
  let errorEl: HTMLDivElement | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let renderer: VizRenderer | null = null;
  let pipeline: VizPipeline | null = null;
  let nodeEngine: VizNodeEngine | null = null;
  let arranger: VizArrangementController | null = null;
  const announcer: VizAnnouncer = createVizAnnouncer();

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || helpOpen() || helpMode()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeViz(); // exit + focus return (the finalized-order funnel)
    };
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));

    // VZ-DD-2: the ENTRY line — one task AFTER mount (the region must be
    // inserted empty and gain its text in a later task, or screen readers
    // read it as initial content). The copy is transport-truthful AND
    // stage-truthful: at the wide stage it names the isolation fact while
    // playing / the stopped state while idle (the idle line's spoken twin);
    // at the phone stage (VZ-DD-4) it speaks the GATE — the show stands
    // down for a larger screen, and the line says so.
    const session = getSession();
    const entryTimer = setTimeout(
      () =>
        announcer.announce(
          stageMode() === "phone"
            ? session.transport.snapshot.playing
              ? VIZ_ON_PHONE_ANNOUNCEMENT
              : VIZ_ON_PHONE_IDLE_ANNOUNCEMENT
            : session.transport.snapshot.playing
              ? VIZ_ON_ANNOUNCEMENT
              : VIZ_ON_IDLE_ANNOUNCEMENT,
        ),
      0,
    );
    onCleanup(() => {
      clearTimeout(entryTimer);
      announcer.dispose();
    });

    // VZ-DD-4 — the PHONE GATE's engine law: the wide-stage engine stack
    // (renderer + pipeline + node engine + arranger) boots ONLY while the
    // stage is wide; at `stageMode() === "phone"` the surface is the gate
    // and carries ZERO engine footprint (no rAF loop, no engine
    // subscriptions, no observers — non-interference with the mobile stage
    // beneath). Live viewport flips boot/dispose cleanly in both
    // directions; a re-boot after gate→wide continues the SESSION envelope
    // (the session-once restore law — remounts never rewind the deal).
    const bootEngines = (): (() => void) | null => {
      if (!canvasEl) return null;
      // VZ-TH-2: the tap → queue → drain pipeline, with the REAL seams —
      // the session's tap, the transport's coarse snapshots, and the audio
      // clock read per frame (guarded: no context yet → NaN parks the
      // drain; the engine creates the context at first play).
      // BPM seam: a plain closure variable refreshed by the REACTIVE world
      // (the doc-store subscription) and read by the render loop as plain
      // data — the rAF law forbids framework-state WRITES from the loop,
      // and this keeps even reads off the loop's hot path. Per-beat motion
      // (orbits, river flow) derives beats from the AUDIO clock × this BPM
      // — transport time, never wall time.
      let bpm = docStore.getState().doc.transport.bpm;
      const unsubscribeBpm = docStore.subscribe(() => {
        bpm = docStore.getState().doc.transport.bpm;
      });
      const audioTime = () =>
        session.engine.created
          ? session.engine.getContext().currentTime
          : Number.NaN;

      // VZ-IM-5 + VZ-HU-2 + VZ-IM-3: the node rendering engine and its
      // re-deal orchestrator. The boot rig is the RESTORED session envelope
      // re-dealt ONCE and handed to both — the engine mounts it, the
      // controller derives its envelope from it — so setArrangement fires
      // only on committed rerolls/cycles, and the controller's envelope at
      // boot IS the restored one (persisted last deal, or the deterministic
      // default on a fresh install — the fingerprint's pinned rig). The
      // subscribe seam persists each COMMIT through the viz session state
      // (never a pending request); VZ-DD-1 binds buttons/keys to the
      // controller's reroll()/cycle().
      const boot = bootVizArrangementFromPrefs();
      nodeEngine = createVizNodeEngine({ arrangement: boot });
      const controller = createVizArrangementController({
        engine: nodeEngine,
        initial: boot,
      });
      arranger = controller;
      // VZ-DD-2: the commit classifier. The subscribe seam fires once per
      // COMMITTED deal; the probe's commit counters classify WHICH kind
      // landed (a cycle supersedes a pending reroll — only one counter
      // moves per commit), so the announcement text is a pure function of
      // the commit facts. One announcement per commit, exactly — a
      // coalesced reroll burst speaks once (the 150 ms commit law's spoken
      // twin); pending requests never announce (the no-amplification law).
      let seenRerolls = controller.probe().rerollCommits;
      let seenCycles = controller.probe().cycleCommits;
      const stopMemory = controller.subscribe((envelope) => {
        commitVizEnvelope(envelope);
        const probe = controller.probe();
        if (probe.rerollCommits > seenRerolls) {
          announcer.announce(VIZ_REROLL_ANNOUNCEMENT);
        } else if (probe.cycleCommits > seenCycles) {
          announcer.announce(vizPresetAnnouncement(controller.preset().name));
        }
        seenRerolls = probe.rerollCommits;
        seenCycles = probe.cycleCommits;
      });
      // VZ-DD-3: the reduced-motion state, owned by the renderer's
      // matchMedia seam and mirrored here as plain closure data (the rAF
      // law: no reactive state in the loop, only reads).
      let reduced = false;
      // VZ-IM-6: the density-phase controller — created below (it needs
      // the engine for its level sink) but declared here so the reduced
      // seam covers it from the first preference read.
      let phaseCtl: VizPhaseController | null = null;
      const applyReducedMotion = (on: boolean): void => {
        reduced = on;
        nodeEngine?.setReducedMotion(on);
        phaseCtl?.setReducedMotion(on);
      };
      // Textual event equivalence (reduced motion only — the announcement
      // path's payload; DD-2 owns the live region that speaks it).
      const summarizer: VizActivitySummarizer = createVizActivitySummarizer();
      // VZ-IM-6 — the House Lights play arc (src/viz/phases.ts is the
      // law module): the trailing hit-rate window over DRAINED hits, the
      // hysteresis classifier, the idle state on the stopped edge, and
      // the phase levels through IM-5's engine seams. Labels ride the
      // announcer under REDUCE ONLY (DD-2's verified full-motion silence
      // law — the phases.ts module doc records the reasoning); the level
      // sink fires only on change, both values atomically.
      phaseCtl = createVizPhaseController({
        subscribeTransport: (listener) => session.subscribe(listener),
        initialPlaying: session.transport.snapshot.playing,
        onLevels: (restLevel, liveGain) => {
          nodeEngine?.setRestLevel(restLevel);
          nodeEngine?.setLiveGain(liveGain);
        },
        onPhaseLabel: (text) => announcer.announce(text),
      });
      pipeline = createVizPipeline({
        subscribeNoteOns: (listener) => session.subscribeNoteOns(listener),
        subscribeTransport: (listener) => session.subscribe(listener),
        // VZ-TH-3 (R3 drop-and-resync): the hidden-page seam — HIDE clears
        // the queue (hygiene); SHOW needs no action: the renderer resumes
        // and the first visible frame drains under the shared stale grace,
        // recomputing phase/envelopes from ctx.currentTime (the refocus
        // contract). Dispose (below) removes this listener with the rest.
        subscribeVisibility: (listener) => {
          const onVisibility = (): void => listener(document.hidden);
          document.addEventListener("visibilitychange", onVisibility);
          return () =>
            document.removeEventListener("visibilitychange", onVisibility);
        },
        audioTime,
        onDueHits: (hits, now) => {
          for (const hit of hits) {
            // VZ-IM-6: the phase window ingests the same drained hits the
            // engine ignites (real hit rates, audible timestamps).
            phaseCtl?.note(hit.audibleAt);
            nodeEngine?.ignite(hit);
            if (reduced && Number.isFinite(now)) {
              // The summarizer's own rate law (2 s floor) bounds these
              // announcements; null lines are counted, never spoken.
              const line = summarizer.note(hit, now);
              if (line !== null) announcer.announce(line);
            }
          }
        },
      });
      renderer = createVizRenderer({
        canvas: canvasEl,
        onFrame: (ctx, frame) => {
          pipeline?.onFrame(ctx, frame);
          // NaN `now` (no AudioContext yet) parks the live pass; the rest
          // rig still draws — the stage is legible before first play.
          const now = audioTime();
          // VZ-IM-6: the phase step runs before the draw so the frame
          // renders with the levels it computed (parked on NaN clock —
          // the boot diagram keeps the authored defaults).
          phaseCtl?.update(now);
          nodeEngine?.onFrame(ctx, frame, now, (now * bpm) / 60);
        },
        onReducedMotionChange: applyReducedMotion,
        // VZ-HU-1: the containment boundary's DOM half — the loop already
        // parked itself (state `error`) before this fires; write the ONE
        // fixed error line, idempotently (a second fault changes nothing).
        // The 2026-09-05 polish P3: the SAME line is SPOKEN through the
        // surface's one polite region — "Sam hears nothing when the show
        // parks" was the critique's flag, and a parked show is exactly the
        // closed list's "state changes only" class (one line per fault,
        // never the throw's own message). No second live region: the
        // announcement rides DD-2's existing region, the visible line
        // stays a plain div.
        onError: () => {
          if (errorEl && errorEl.textContent === "") {
            errorEl.textContent = VIZ_ERROR_LINE;
            announcer.announce(VIZ_ERROR_LINE);
          }
        },
      });
      renderer.start();
      // The preference read at mount (live flips ride the seam above).
      applyReducedMotion(renderer.probe().reducedMotion);
      // THE teardown contract (VZ-HU-1 extends), RETURNED so the stage-mode
      // effect below can run it on a live flip to the phone gate as well
      // as at unmount: dispose cancels the rAF, disconnects the
      // ResizeObserver, drops every listener AND unsubscribes the engine
      // seams — nothing of the viz survives. The arranger goes FIRST: a
      // reroll window pending at exit dies here, so no setArrangement can
      // fire into the teardown below (exit-while-arranging, the Hulk path).
      return () => {
        unsubscribeBpm();
        stopMemory(); // stop persisting before the arranger dies (belt+braces)
        releaseVizActivitySummarizer(summarizer); // the registry's teardown
        arranger?.dispose();
        arranger = null;
        renderer?.dispose();
        renderer = null;
        pipeline?.dispose();
        pipeline = null;
        phaseCtl?.dispose();
        phaseCtl = null;
        nodeEngine?.dispose();
        nodeEngine = null;
      };
    };
    let stopEngines: (() => void) | null = null;
    createEffect(() => {
      if (stageMode() === "phone") {
        stopEngines?.();
        stopEngines = null;
        return;
      }
      if (!stopEngines) stopEngines = bootEngines();
    });
    onCleanup(() => {
      stopEngines?.();
      stopEngines = null;
    });
  });

  // A named (labelled section = landmark) but non-interactive ground: no
  // tab stops of its own, cannot trap. The canvas is aria-hidden decoration
  // (the visual show carries no information the DOM chrome — the remote
  // below — and the announcements — VZ-DD-2 — don't carry better); the
  // remote is the surface's ONE interactive region (its four buttons are a
  // single roving Tab stop — the no-new-Tab-stops law, with the covered
  // stage inert in App while the page is on). The announcement region is
  // the E6 shape (InfoView's): role=status, polite, labelled, never
  // focusable, never a Tab stop — it speaks, it does not trap.
  return (
    <section class="viz-page" aria-label="VIZ — visualizer stage">
      <canvas
        ref={(el) => {
          canvasEl = el;
        }}
        class="viz-canvas"
        aria-hidden="true"
      />
      {/* VZ-DD-4: the canvas element persists across stage flips (the ref
          must stay valid for a wide-stage re-boot); viz.css display:nones
          it on the phone stage, where no renderer ever runs. */}
      <VizRemote
        getController={() => arranger}
        announce={(text) => announcer.announce(text)}
      />
      {/* VZ-HU-1: the draw-fault error line — a plain visible line (NOT a
          live region: DD-2's one-polite-region law), empty and unrendered
          (:empty) until a fault parks the loop. Bounded chrome write from
          the loop context: one textContent assignment, never reactive
          state (the rAF law). */}
      <div
        class="viz-error"
        ref={(el) => {
          errorEl = el;
        }}
      />
      <div
        ref={(el) => {
          announcer.attach(el);
        }}
        class="viz-announce"
        role="status"
        aria-live="polite"
        aria-label="VIZ announcements"
      />
    </section>
  );
}
