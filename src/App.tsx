/**
 * App shell — Arcade Stage Floor: the booth (transport) is fixed at the top
 * of the stage; the stage floor below waits for its lanes (DES-3/DES-4).
 */

import Booth from "./components/Booth";
import "./styles/app.css";

export default function App() {
  return (
    <div class="app">
      <Booth />
      <main class="stage" aria-label="Stage floor">
        <p class="stage-note">STAGE FLOOR · 4 LANES LIGHT UP HERE</p>
      </main>
    </div>
  );
}
