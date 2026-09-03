/**
 * App shell — Arcade Stage Floor: the booth (transport) is fixed at the top
 * of the stage; below it the four lane floors render their pad grids (DES-4).
 * DES-3 adds the lane header strips between booth and floors.
 *
 * HP-1: the shell carries the help-mode attribute (the mode-obvious CSS hook
 * — see styles/info-view.css) and mounts the InfoView ONLY while help mode
 * is on (the zero-cost clause: no help DOM, listeners or subscriptions while
 * off; TH-4 c asserts it on every frame-budget run).
 */

import { Show } from "solid-js";
import Booth from "./components/Booth";
import InfoView from "./components/InfoView";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import PatternRail from "./components/PatternRail";
import StageFloor from "./components/StageFloor";
import Toasts from "./components/Toasts";
import AudioStatus from "./components/AudioStatus";
import SupportBanners from "./components/Banner";
import { helpMode } from "./state/helpMode";
import { initPersistence } from "./persist/boot";
import "./styles/app.css";
import "./styles/grid.css";
import "./styles/lane-header.css";
import "./styles/fx-strip.css";
import "./styles/pattern-rail.css";
import "./styles/toasts.css";
import "./styles/banner.css";
import "./styles/help.css";

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
  return (
    <div class="app" data-help-mode={helpMode() ? "on" : "off"}>
      <SupportBanners />
      <Booth />
      <main class="stage" aria-label="Stage floor">
        <PatternRail />
        <StageFloor />
      </main>
      <AudioStatus />
      <Toasts />
      {/* HP-1: the info region mounts ONLY while help mode is on (Show
          unmounts it — and its listeners — the instant the mode turns off). */}
      <Show when={helpMode()}>
        <InfoView />
      </Show>
      <KeyboardShortcuts />
    </div>
  );
}
