// Throwaway flexible-band EQ study. No project state, persistence or audio playback.
import "./prototype.js";

const types = {
  peaking: "Bell",
  lowshelf: "Low shelf",
  highshelf: "High shelf",
  highpass: "Low cut",
  lowpass: "High cut",
  notch: "Notch",
  bandpass: "Band pass",
};
const states = new Map();
const context = new OfflineAudioContext(1, 1, 48000);
const nodes = Array.from({ length: 8 }, () => context.createBiquadFilter());
const frequencies = Float32Array.from(
  { length: 180 },
  (_, i) => 20 * 1000 ** (i / 179),
);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const x = (f) => 28 + (Math.log10(f / 20) / 3) * 364;
const y = (g) => 12 + ((18 - g) / 54) * 134;
const gainType = (b) => ["peaking", "lowshelf", "highshelf"].includes(b.type);
const qType = (b) => !["lowshelf", "highshelf"].includes(b.type);
const make = (id, type, hz, gain = 0) => ({
  id,
  type,
  hz,
  gain,
  q: 1,
  on: true,
});
function initial() {
  return {
    selected: 2,
    next: 5,
    bands: [
      make(1, "highpass", 40),
      make(2, "peaking", 250, -4),
      make(3, "peaking", 1600, 3),
      make(4, "highshelf", 6000, 2),
    ],
  };
}

function mount() {
  for (const card of document.querySelectorAll(
    ".device-eq:not([data-flexible])",
  )) {
    card.dataset.flexible = "true";
    const id = card.dataset.id;
    if (!states.has(id)) states.set(id, initial());
    const state = states.get(id),
      body = card.querySelector(".device-body");
    body.className = "device-body flexible-eq";
    body.innerHTML = `<div class="eq-band-tools"><div class="eq-band-tabs" role="group" aria-label="EQ bands"></div><button class="eq-add" aria-label="Add EQ band">+ Band</button><button class="eq-remove" aria-label="Remove selected EQ band"><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
  <div class="eq-plot" role="group" aria-label="Editable equalizer frequency response"><svg viewBox="0 0 410 170" preserveAspectRatio="none" aria-hidden="true">${[100, 1000].map((f) => `<line x1="${x(f)}" x2="${x(f)}" y1="12" y2="146"/><text x="${x(f)}" y="164" text-anchor="middle">${f === 1000 ? "1k" : f}</text>`).join("")}${[12, 0, -12, -24].map((g) => `<line x1="28" x2="392" y1="${y(g)}" y2="${y(g)}"/><text x="2" y="${y(g) + 3}">${g}</text>`).join("")}<text x="28" y="164">20</text><text x="392" y="164" text-anchor="end">20k Hz</text><path class="eq-demo"/><path class="eq-band-response"/><path class="eq-total-response"/></svg><div class="eq-handles"></div></div>
  <div class="eq-legend"><span>Response <span class="eq-selected-name"></span></span><span>Demo spectrum</span></div>
  <div class="eq-fields"><label>Type<select aria-label="Selected band type">${Object.entries(
    types,
  )
    .map(([v, n]) => `<option value="${v}">${n}</option>`)
    .join(
      "",
    )}</select></label><label>Frequency<div><input aria-label="Band frequency" data-key="hz" type="number" min="20" max="20000" step="1"><small>Hz</small></div></label><label>Gain<div><input aria-label="Band gain" data-key="gain" type="number" min="-18" max="18" step="0.1"><small>dB</small></div></label><label>Q<input aria-label="Band Q" data-key="q" type="number" min="0.1" max="18" step="0.1"></label></div>
  <div class="eq-bottom"><label><input type="checkbox" aria-label="Selected band enabled">Band on</label><span class="eq-hint">Drag frequency / gain · Shift-drag Q</span></div>`;
    const plot = body.querySelector(".eq-plot");
    const selected = () => state.bands.find((b) => b.id === state.selected);
    function draw(rebuild = false) {
      const active = selected();
      if (rebuild) {
        body.querySelector(".eq-band-tabs").innerHTML = state.bands
          .map(
            (b) =>
              `<button data-select="${b.id}" aria-label="Select band ${b.id}" aria-pressed="${b.id === state.selected}" class="${b.on ? "" : "bypassed"}">${b.id}</button>`,
          )
          .join("");
        body.querySelector(".eq-handles").innerHTML = state.bands
          .map(
            (b) =>
              `<button data-node="${b.id}" class="eq-node" aria-label="Band ${b.id}. Arrow keys change frequency and gain, Shift changes Q.">${b.id}</button>`,
          )
          .join("");
      }
      const total = new Float32Array(180),
        mag = new Float32Array(180),
        phase = new Float32Array(180);
      let bandCurve = "";
      state.bands.forEach((b, i) => {
        const n = nodes[i];
        n.type = b.type;
        n.frequency.value = b.hz;
        n.gain.value = b.gain;
        n.Q.value = b.q;
        n.getFrequencyResponse(frequencies, mag, phase);
        const gains = Array.from(
          mag,
          (m) => 20 * Math.log10(Math.max(1e-6, m)),
        );
        if (b.on) gains.forEach((g, j) => (total[j] += g));
        if (b.id === state.selected)
          bandCurve = gains
            .map(
              (g, j) =>
                `${j ? "L" : "M"}${x(frequencies[j])},${clamp(y(g), 12, 146)}`,
            )
            .join("");
        const node = body.querySelector(`[data-node="${b.id}"]`);
        node.style.left = `${(x(b.hz) / 410) * 100}%`;
        node.style.top = `${(y(gainType(b) ? b.gain : 0) / 170) * 100}%`;
        node.classList.toggle("selected", b === active);
        node.classList.toggle("bypassed", !b.on);
        node.setAttribute("aria-pressed", String(b === active));
        body
          .querySelector(`[data-select="${b.id}"]`)
          .setAttribute("aria-pressed", String(b === active));
        body.querySelector(`[data-select="${b.id}"]`).classList.toggle("bypassed", !b.on);
      });
      body
        .querySelector(".eq-total-response")
        .setAttribute(
          "d",
          Array.from(
            total,
            (g, j) =>
              `${j ? "L" : "M"}${x(frequencies[j])},${clamp(y(g), 12, 146)}`,
          ).join(""),
        );
      body.querySelector(".eq-band-response").setAttribute("d", bandCurve);
      body
        .querySelector(".eq-demo")
        .setAttribute(
          "d",
          "M28,146" +
            Array.from(
              frequencies,
              (f, i) =>
                `L${x(f)},${clamp(115 - 25 * Math.sin(i / 70) - 10 * Math.sin(i * 0.31) ** 2, 40, 146)}`,
            ).join("") +
            "L392,146Z",
        );
      body.querySelector(".eq-add").disabled = state.bands.length >= 8;
      body.querySelector(".eq-remove").disabled = !active;
      for (const el of body.querySelectorAll(
        ".eq-fields input,.eq-fields select,.eq-bottom input",
      ))
        el.disabled = !active;
      body.querySelector(".eq-selected-name").textContent = active
        ? `· Band ${active.id}`
        : "· No bands";
      if (active) {
        body.querySelector("select").value = active.type;
        for (const el of body.querySelectorAll("[data-key]")) {
          el.value = active[el.dataset.key];
          el.disabled =
            (el.dataset.key === "gain" && !gainType(active)) ||
            (el.dataset.key === "q" && !qType(active));
          if (el.disabled) el.value = "";
        }
        body.querySelector('[type="checkbox"]').checked = active.on;
      }
      body.querySelector(".eq-hint").textContent =
        active && !gainType(active)
          ? "Drag frequency · Shift-drag Q"
          : "Drag frequency / gain · Shift-drag Q";
    }
    for (const event of [
      "click",
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "dblclick",
      "keydown",
      "input",
      "change",
    ])
      body.addEventListener(event, (e) => e.stopPropagation());
    body.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-select]");
      if (pick) {
        state.selected = Number(pick.dataset.select);
        draw();
      }
      if (e.target.closest(".eq-add") && state.bands.length < 8) {
        const occupied = [20, ...state.bands.map(b => b.hz), 20000].sort((a,b) => a-b);
        let gap = 0;
        for (let i=1;i<occupied.length-1;i++) if (occupied[i+1]/occupied[i] > occupied[gap+1]/occupied[gap]) gap=i;
        const frequency = Math.round(Math.sqrt(occupied[gap]*occupied[gap+1]));
        const b = make(state.next++, "peaking", frequency);
        state.bands.push(b);
        state.selected = b.id;
        draw(true);
        body.querySelector(`[data-node="${b.id}"]`).focus();
      }
      if (e.target.closest(".eq-remove") && selected()) {
        state.bands = state.bands.filter((b) => b.id !== state.selected);
        state.selected = state.bands.at(-1)?.id;
        draw(true);
        body.querySelector(".eq-add").focus();
      }
    });
    body.addEventListener("change", (e) => {
      const b = selected();
      if (!b) return;
      const el = e.target;
      if (el.matches("select")) b.type = el.value;
      else if (el.type === "checkbox") b.on = el.checked;
      else if (el.dataset.key && el.value !== "") {
        const key = el.dataset.key;
        if (Number.isFinite(el.valueAsNumber))
          b[key] = clamp(el.valueAsNumber, Number(el.min), Number(el.max));
      }
      draw();
    });
    let drag;
    body.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-node]");
      if (!handle || e.button !== 0) return;
      e.preventDefault();
      state.selected = Number(handle.dataset.node);
      handle.focus();
      handle.setPointerCapture(e.pointerId);
      drag = { id: state.selected, y: e.clientY, q: selected().q };
      draw();
    });
    body.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const b = selected(),
        r = plot.getBoundingClientRect();
      if (e.shiftKey) {
        if (qType(b))
          b.q = Number(
            clamp(drag.q + (drag.y - e.clientY) / 20, 0.1, 18).toFixed(1),
          );
      } else {
        b.hz = Math.round(
          20 *
            1000 **
              clamp((((e.clientX - r.left) / r.width) * 410 - 28) / 364, 0, 1),
        );
        if (gainType(b))
          b.gain = Number(
            clamp(
              18 - ((((e.clientY - r.top) / r.height) * 170 - 12) / 134) * 54,
              -18,
              18,
            ).toFixed(1),
          );
      }
      draw();
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      body.addEventListener(event, () => {
        drag = undefined;
      });
    body.addEventListener("keydown", (e) => {
      const handle = e.target.closest("[data-node]");
      if (!handle) return;
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
        dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      state.selected = Number(handle.dataset.node);
      const b = selected();
      if (e.shiftKey && qType(b))
        b.q = Number(clamp(b.q + (dx || dy) * 0.1, 0.1, 18).toFixed(1));
      else {
        b.hz = Math.round(clamp(b.hz * 1.03 ** dx, 20, 20000));
        if (gainType(b))
          b.gain = Number(clamp(b.gain + dy * 0.1, -18, 18).toFixed(1));
      }
      draw();
    });
    draw(true);
  }
}
document.getElementById("reset").addEventListener(
  "click",
  () => {
    states.clear();
    queueMicrotask(mount);
  },
  true,
);
new MutationObserver(mount).observe(document.getElementById("app"), {
  childList: true,
  subtree: true,
});
mount();
