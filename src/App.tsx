import InstrumentsPage from "./components/InstrumentsPage";
/**
 * App shell — Hybrid Performance Console: the booth (transport) is fixed at
 * the top of the stage; below it the four lane floors render their pad grids.
 * The active theme supplies the luminous Vector or polished Alloy surface,
 * while the shared shell preserves the composing flow and control positions.
 *
 * HP-1: the shell carries the help-mode attribute (the mode-obvious CSS hook
 * — see styles/info-view.css) and mounts the InfoView ONLY while help mode
 * is on (the zero-cost clause: no help DOM, listeners or subscriptions while
 * off; TH-4 c asserts it on every frame-budget run).
 */

import { createEffect, on, Show } from "solid-js";
import Booth, { PlayStopButton } from "./components/Booth";
import {
  OptionsBackdrop,
  OptionsButton,
  OptionsDrawerPanel,
} from "./components/PhoneOptions";
import InfoView from "./components/InfoView";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import PatternRail from "./components/PatternRail";
import PhonePageToggle from "./components/PhonePageToggle";
import { phonePage, showPhonePage } from "./state/phonePage";
import StageFloor, { LaneSwitcher } from "./components/StageFloor";
import Toasts from "./components/Toasts";
import AudioStatus from "./components/AudioStatus";
import SupportBanners from "./components/Banner";
import VizPage from "./components/VizPage";
import { helpMode } from "./state/helpMode";
import { vizMode } from "./state/vizMode";
import { optionsOpen } from "./state/optionsDrawer";
import { activeLane, stageMode } from "./state/selection";
import { isDefaultLane } from "./document/schema";
import { initPersistence } from "./persist/boot";
import "./styles/app.css";
import "./styles/chassis.css";
import "./styles/grid.css";
import "./styles/lane-header.css";
import "./styles/fx-strip.css";
import "./styles/pattern-rail.css";
import "./styles/toasts.css";
import "./styles/banner.css";
import "./styles/help.css";
import "./styles/viz.css";
// ⟲/→ slot follow + the phone SONG page (2026-09-11).
import "./styles/song.css";
// THE FULL UNIT (overdrive): imported last — its paint rules win ties.
import "./styles/unit.css";
import "./styles/themes.css";
import "./styles/membrane.css";
import SaveIndicator from "./components/SaveIndicator";

// Boot restore + autosave (MF-2): fire-and-forget — the store's default
// document is already live, so the app renders immediately and the restored
// project (if any) swaps in as soon as IndexedDB answers. A corrupt row is
// quarantined inside initPersistence (HU-2) with a RECOVER toast; only an
// outright boot failure (e.g. no storage at all) lands here.
void initPersistence().catch((error) => {
  console.warn(
    "[persist] boot restore failed; starting from default project",
    error,
  );
});

export default function App() {
  createEffect(
    on(stageMode, (mode) => {
      if (phonePage() === "song") return;
      showPhonePage(
        mode === "phone" || isDefaultLane(activeLane())
          ? "edit"
          : "instruments",
      );
    }),
  );
  return (
    <div
      class="app membrane"
      data-help-mode={helpMode() ? "on" : "off"}
      data-viz-mode={vizMode() ? "on" : "off"}
      data-stage={stageMode()}
      // 2026-09-11 (user call): the EDIT/SONG split is stage-WIDE now, so
      // the page attribute is written on every stage (was phone-only).
      data-page={phonePage()}
    >
      <SupportBanners />
      {/* MB-1 (mobile slice): the committed phone law — sticky chrome +
          scrolling grid. At phone width the booth + lane switcher +
          condensed rail form ONE pinned group (position: sticky inside the
          scrolling document) and the single-lane stage below scrolls; the
          desktop/tablet structure is the original shell, unchanged (m4).
          VZ-DD-1: while the VIZ surface is on, the covered stage (booth +
          floors, or the phone chrome + stage) goes INERT — no Tab stops,
          no a11y tree, no stray key targets under the full-bleed page (the
          "no Tab stop outside the remote" law). Toasts (60), the
          audio-resume affordance (70) and the KEYS modal (90) stay live:
          the failure/reference chrome outranks the surface by design. */}
      <Show
        when={stageMode() === "phone"}
        fallback={
          <>
            <Booth covered={vizMode()} />
            {/* 2026-09-11 (user call): the chain is no longer a permanent
                BAR above the quadrants — desktop and tablet get the phone's
                two-page split. EDIT is the quadrant stage; SONG is the
                arrangement page. The EDIT stage stays MOUNTED (hidden) so
                the grids keep their scroll/register place and the
                store→engine bridge StageFloor owns keeps running — the same
                law the phone branch below has always followed. */}
            <main
              class="stage"
              aria-label="Stage floor"
              hidden={phonePage() !== "edit"}
              inert={vizMode() ? true : undefined}
            >
              <StageFloor />
            </main>
            <Show when={phonePage() === "song"}>
              <main
                class="stage stage-song"
                aria-label="Song sequencer"
                inert={vizMode() ? true : undefined}
              >
                <PatternRail />
              </main>
            </Show>
          </>
        }
      >
        {/* M-4: the drawer's outside-tap dismissal surface — OUTSIDE the
            chrome (fixed, z 5 < the chrome's 10): taps on the scrolling
            grid close the drawer; the chrome stays interactive above it.
            Show law: unmounted while collapsed. */}
        <Show when={optionsOpen()}>
          <OptionsBackdrop />
        </Show>
        <div class="phone-chrome" inert={vizMode() ? true : undefined}>
          {/* M-2: phone stage thins the booth — KEYS ?/INFO ? buttons do
              not render (render guard, not CSS; VZ-DD-1 a11y-tree law).
              The desktop/tablet fallback branch above stays unchanged. */}
          <Booth compact />
          {/* 2026-09-11 (user call): the phone is two pages — EDIT (the
              lane switcher + one lane's grid) and SONG (every lane's chain,
              the sequencer). The condensed one-row rail left the chrome:
              the SONG page owns the chain, EDIT gets the height back. */}
          <Show when={phonePage() === "edit"}>
            <LaneSwitcher />
          </Show>
          {/* M-3: the pinned centered transport — the ONE play/stop
              control (Booth's shared PlayStopButton) rides a centered row
              as the LAST child of the sticky chrome, so PLAY/STOP stays
              visible and horizontally centered at every scroll offset.
              M-4 (iteration 4): the row is a 1fr-auto-1fr grid whose LEFT
              edge column carries the OPTIONS drawer toggle — the equal
              side columns keep PLAY exactly centered whether the drawer is
              open or closed (the M-3 ±8px gate re-verified by M-4's gate).
              Inside `.phone-chrome`, so it inherits the VZ-DD-1 inert
              wiring and the strap hit-target law for free. The Booth's
              in-group copy is render-guarded away by `compact` — one
              handler, one help entry, one button. */}
          <div class="phone-transport">
            <OptionsButton />
            <PlayStopButton />
            <PhonePageToggle />
          </div>
          {/* M-4: the collapsible options drawer — the Show law: collapsed
              means ZERO drawer DOM (no panel, no backdrop, no listeners).
              The panel grows the sticky chrome BELOW the transport (it
              never covers the centered PLAY) and houses the compact
              BoothOptions groups (loop, metronome, viz, tempo, scale,
              swing, master) — the same components and store seams as the
              desktop Booth. */}
          <Show when={optionsOpen()}>
            <OptionsDrawerPanel />
          </Show>
        </div>
        {/* The EDIT stage stays MOUNTED (hidden) under the SONG page: the
            grids keep their scroll/register place and the store→engine
            bridge StageFloor owns keeps running. */}
        <main
          class="stage"
          aria-label="Stage floor"
          hidden={phonePage() !== "edit"}
          inert={vizMode() ? true : undefined}
        >
          <StageFloor />
        </main>
        <Show when={phonePage() === "song"}>
          <main
            class="stage stage-song"
            aria-label="Song sequencer"
            inert={vizMode() ? true : undefined}
          >
            <PatternRail />
          </main>
        </Show>
      </Show>
      <Show
        when={
          stageMode() !== "phone" && phonePage() === "instruments" && !vizMode()
        }
      >
        <InstrumentsPage />
      </Show>
      <AudioStatus />
      <Show when={stageMode() === "phone" && !vizMode()}>
        <div class="mobile-save-status">
          <SaveIndicator />
        </div>
      </Show>
      <Toasts />
      {/* HP-1: the info region mounts ONLY while help mode is on (Show
          unmounts it — and its listeners — the instant the mode turns off). */}
      <Show when={helpMode()}>
        <InfoView />
      </Show>
      {/* VZ-IM-2: the VIZ page mounts ONLY while viz mode is on — the same
          Show law, so VIZ closed means zero VIZ DOM/listeners (zero-cost
          clause); transport-isolated by construction (VizPage never touches
          the engine). */}
      <Show when={vizMode()}>
        <VizPage />
      </Show>
      <KeyboardShortcuts />
    </div>
  );
}
