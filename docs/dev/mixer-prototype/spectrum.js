// Frequency-response preview only. Offline context never renders or plays audio.
// The subdued input spectrum is illustrative data, not a live analyser.
const context = new OfflineAudioContext(1, 1, 48000);
const filters = Array.from({ length: 4 }, () => context.createBiquadFilter());
const frequencies = Float32Array.from(
  { length: 180 },
  (_, i) => 20 * 1000 ** (i / 179),
);
const magnitudes = new Float32Array(180),
  phases = new Float32Array(180);
const left = 28,
  right = 392,
  top = 12,
  bottom = 146;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fx = (f) => left + (Math.log10(f / 20) / 3) * (right - left);
const gy = (db) => top + ((18 - db) / 54) * (bottom - top);
const bands = {
  cutoff: "Cutoff / resonance",
  lowCut: "Low cut",
  low: "Low shelf",
  mid: "Mid band",
  high: "High shelf",
};
function response(d) {
  const v = d.values;
  const settings =
    d.type === "filter"
      ? [[["lowpass", "highpass", "bandpass"][d.choice], v.cutoff, v.q, 0]]
      : [
          ["highpass", v.lowCut, Math.SQRT1_2, 0],
          ["lowshelf", 150, 1, v.low],
          ["peaking", v.midHz, 0.7, v.mid],
          ["highshelf", 6000, 1, v.high],
        ];
  const result = new Float32Array(180);
  settings.forEach(([type, f, q, gain], index) => {
    const node = filters[index];
    node.type = type;
    node.frequency.value = f;
    node.Q.value = q;
    node.gain.value = gain;
    node.getFrequencyResponse(frequencies, magnitudes, phases);
    for (let i = 0; i < 180; i++)
      result[i] += 20 * Math.log10(Math.max(1e-6, magnitudes[i]));
  });
  return result;
}
function handles(d) {
  const v = d.values;
  return d.type === "filter"
    ? [["cutoff", v.cutoff, Math.min(15, (v.q / 18) * 18 - 3), "F"]]
    : [
        ["lowCut", v.lowCut, -3, "C"],
        ["low", 150, v.low, "L"],
        ["mid", v.midHz, v.mid, "M"],
        ["high", 6000, v.high, "H"],
      ];
}
export function graphMarkup(d) {
  return `${
    d.type === "eq"
      ? `<div class="segments" role="group" aria-label="Focus EQ band">${[
          ["lowCut", "Low cut"],
          ["low", "Low"],
          ["mid", "Mid"],
          ["high", "High"],
        ]
          .map(
            ([key, label]) =>
              `<button data-focus-band="${key}" data-device="${d.id}">${label}</button>`,
          )
          .join("")}</div>`
      : ""
  }<div class="frequency-graph" data-graph="${d.id}" role="group" aria-label="${d.type === "eq" ? "Equalizer" : "Filter"} frequency response. Drag a labeled point or edit values below.">
    <svg viewBox="0 0 410 170" preserveAspectRatio="none" aria-hidden="true">
      ${[100, 1000].map((f) => `<line class="graph-grid" x1="${fx(f)}" x2="${fx(f)}" y1="${top}" y2="${bottom}"/><text x="${fx(f)}" y="163" text-anchor="middle">${f < 1000 ? f : f / 1000 + "k"}</text>`).join("")}
      ${[12, 0, -12, -24].map((db) => `<line class="graph-grid ${db === 0 ? "zero" : ""}" x1="${left}" x2="${right}" y1="${gy(db)}" y2="${gy(db)}"/><text x="3" y="${gy(db) + 3}">${db > 0 ? "+" : ""}${db}</text>`).join("")}
      <text x="${left}" y="163">20</text><text x="${right}" y="163" text-anchor="end">20k Hz</text>
      <path class="demo-spectrum"/><path class="response-line"/>
    </svg>
    ${handles(d)
      .map(
        ([key, , , letter]) =>
          `<button class="band-handle" data-band="${key}" data-device="${d.id}" aria-label="${bands[key]}. Arrow keys adjust; numeric fields below provide exact values." title="${bands[key]}">${letter}</button>`,
      )
      .join("")}
  </div><div class="graph-legend"><span><i class="response-key"></i>Response</span><span><i class="spectrum-key"></i>Demo spectrum</span></div>`;
}
export function updateGraph(d, root) {
  const graph = root.querySelector(`[data-graph="${d.id}"]`);
  if (!graph) return;
  const values = response(d);
  let curve = "",
    spectrum = `M${left},${bottom}`;
  for (let i = 0; i < 180; i++) {
    const x = fx(frequencies[i]);
    curve += `${i ? "L" : "M"}${x.toFixed(2)},${clamp(gy(values[i]), top, bottom).toFixed(2)}`;
    const t = i / 179;
    const demo =
      -27 +
      17 * Math.exp(-(((t - 0.25) / 0.2) ** 2)) +
      9 * Math.exp(-(((t - 0.59) / 0.13) ** 2)) +
      Math.sin(i * 1.37) * 2 +
      Math.sin(i * 0.37) * 2;
    spectrum += `L${x.toFixed(2)},${clamp(gy(demo), top, bottom).toFixed(2)}`;
  }
  graph.querySelector(".response-line").setAttribute("d", curve);
  graph
    .querySelector(".demo-spectrum")
    .setAttribute("d", spectrum + `L${right},${bottom}Z`);
  for (const [key, f, gain] of handles(d)) {
    const handle = graph.querySelector(`[data-band="${key}"]`);
    handle.style.left = `${(fx(f) / 410) * 100}%`;
    handle.style.top = `${(gy(gain) / 170) * 100}%`;
  }
}
export function graphDrag(d, key, event, rect) {
  const x = clamp(
    ((event.clientX - rect.left) / rect.width) * 410,
    left,
    right,
  );
  const y = clamp(
    ((event.clientY - rect.top) / rect.height) * 170,
    top,
    bottom,
  );
  const frequency = 20 * 1000 ** ((x - left) / (right - left)),
    gain = 18 - ((y - top) / (bottom - top)) * 54;
  if (key === "cutoff")
    return [
      ["cutoff", frequency],
      ["q", clamp(gain + 3, 0.1, 18)],
    ];
  if (key === "lowCut") return [["lowCut", frequency]];
  if (key === "mid")
    return [
      ["midHz", frequency],
      ["mid", gain],
    ];
  return [[key, gain]];
}
