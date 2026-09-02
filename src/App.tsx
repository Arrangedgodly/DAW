/**
 * App shell — Arcade Stage Floor: the booth (transport) is fixed at the top
 * of the stage; below it the four lane floors render their pad grids (DES-4).
 * DES-3 adds the lane header strips between booth and floors.
 */

import Booth from "./components/Booth";
import PatternRail from "./components/PatternRail";
import StageFloor from "./components/StageFloor";
import "./styles/app.css";
import "./styles/grid.css";
import "./styles/lane-header.css";
import "./styles/fx-strip.css";
import "./styles/pattern-rail.css";

export default function App() {
  return (
    <div class="app">
      <Booth />
      <main class="stage" aria-label="Stage floor">
        <PatternRail />
        <StageFloor />
      </main>
    </div>
  );
}
