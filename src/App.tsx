/**
 * App shell — Arcade Stage Floor: the booth (transport) is fixed at the top
 * of the stage; below it the four lane floors render their pad grids (DES-4).
 * DES-3 adds the lane header strips between booth and floors.
 */

import Booth from "./components/Booth";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import PatternRail from "./components/PatternRail";
import StageFloor from "./components/StageFloor";
import Toasts from "./components/Toasts";
import AudioStatus from "./components/AudioStatus";
import SupportBanners from "./components/Banner";
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
    <div class="app">
      <SupportBanners />
      <Booth />
      <main class="stage" aria-label="Stage floor">
        <PatternRail />
        <StageFloor />
      </main>
      <AudioStatus />
      <Toasts />
      <KeyboardShortcuts />
    </div>
  );
}
