// UI experiment only: isolated in-memory state, no DAW persistence or audio.
import { graphMarkup, updateGraph, graphDrag } from "./spectrum.js";
const variants = {
  A: "Rotary rack",
  B: "Control rows",
  C: "Touch panels",
  D: "Hybrid rack",
};
const icons = {
  left: '<path d="m10 3-5 5 5 5"/>',
  right: '<path d="m6 3 5 5-5 5"/>',
  close: '<path d="m4 4 8 8m0-8-8 8"/>',
  power: '<path d="M8 1v7M4 3a6 6 0 1 0 8 0"/>',
};
const icon = (name) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icons[name]}</svg>`;
const spec = {
  filter: {
    name: "Filter",
    choice: ["LP", "HP", "BP"],
    params: [
      ["cutoff", "Cutoff", 20, 20000, 1, "Hz", true],
      ["q", "Resonance", 0.1, 18, 0.1, "Q"],
    ],
  },
  delay: {
    name: "Delay",
    choice: ["1/8", "1/8.", "1/4", "1/2"],
    params: [
      ["feedback", "Feedback", 0, 95, 1, "%"],
      ["mix", "Mix", 0, 100, 1, "%"],
    ],
  },
  reverb: {
    name: "Reverb",
    params: [
      ["size", "Size", 0, 100, 1, "%"],
      ["mix", "Mix", 0, 100, 1, "%"],
    ],
  },
  drive: { name: "Drive", params: [["amount", "Amount", 0, 100, 1, "%"]] },
  crush: {
    name: "Crush",
    params: [
      ["bits", "Bits", 1, 16, 1, "bit"],
      ["decimate", "Decimate", 1, 64, 1, "×"],
    ],
  },
  eq: {
    name: "Equalizer",
    params: [
      ["lowCut", "Low cut", 20, 400, 1, "Hz"],
      ["low", "Low", -12, 12, 0.1, "dB"],
      ["mid", "Mid", -12, 12, 0.1, "dB"],
      ["midHz", "Mid freq", 150, 8000, 1, "Hz", true],
      ["high", "High", -12, 12, 0.1, "dB"],
    ],
  },
  compressor: {
    name: "Compressor",
    params: [
      ["threshold", "Threshold", -60, 0, 1, "dB"],
      ["ratio", "Ratio", 1, 12, 0.1, ":1"],
      ["attack", "Attack", 1, 100, 1, "ms"],
      ["release", "Release", 20, 1000, 1, "ms"],
      ["makeup", "Makeup", 0, 12, 0.1, "dB"],
    ],
  },
  limiter: {
    name: "Limiter",
    params: [
      ["ceiling", "Ceiling", -12, -0.1, 0.1, "dBFS"],
      ["release", "Release", 20, 500, 1, "ms"],
    ],
  },
};
const defaults = {
  filter: { cutoff: 8000, q: 1.2 },
  delay: { feedback: 35, mix: 25 },
  reverb: { size: 40, mix: 22 },
  drive: { amount: 30 },
  crush: { bits: 8, decimate: 4 },
  eq: { lowCut: 40, low: 0, mid: 0, midHz: 350, high: 0 },
  compressor: { threshold: -18, ratio: 2, attack: 25, release: 150, makeup: 0 },
  limiter: { ceiling: -1, release: 80 },
};
let serial = 0;
const device = (type) => ({
  id: ++serial,
  type,
  on: true,
  choice: 0,
  values: { ...defaults[type] },
});
const makeTracks = () =>
  [
    ["Drums", "Dusty kit", "#dfaaa1", -3, 0],
    ["Bass", "Sub pulse", "#c4d49e", -6, 0],
    ["Chords", "Soft keys", "#93cfc7", -9, -12],
    ["Lead", "Glass lead", "#aabbe7", -7, 15],
    ["Master", "Stereo output", "#b7eeeb", 0, 0],
  ].map(([name, preset, color, level, pan], i) => ({
    name,
    preset,
    color,
    level,
    pan,
    mute: false,
    solo: false,
    lock: false,
    devices: (i === 4
      ? ["drive", "delay", "reverb", "compressor", "limiter"]
      : ["filter", "delay", "reverb", "eq", "compressor"]
    ).map(device),
  }));
let tracks = makeTracks(),
  selected = 0,
  variant = new URLSearchParams(location.search).get("variant") || "A";
if (!variants[variant]) variant = "A";
let lastEdit = "Select a channel, then try its controls.";
const app = document.querySelector("#app");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const normalize = (value, p) =>
  p[6]
    ? Math.log(value / p[2]) / Math.log(p[3] / p[2])
    : (value - p[2]) / (p[3] - p[2]);
const denormalize = (value, p) =>
  p[6] ? p[2] * Math.pow(p[3] / p[2], value) : p[2] + value * (p[3] - p[2]);
const display = (value, p) => Number(value).toFixed(p[4] < 1 ? 1 : 0);
const activeDevice = (id) =>
  tracks[selected].devices.find((d) => d.id === Number(id));
const getParam = (d, key) => spec[d.type].params.find((p) => p[0] === key);
function number(d, p) {
  return `<span class="number-wrap"><input type="number" data-value="${p[0]}" data-device="${d.id}" value="${display(d.values[p[0]], p)}" min="${p[2]}" max="${p[3]}" step="${p[4]}" aria-label="${spec[d.type].name} ${p[1]} value"><span class="unit">${p[5]}</span></span>`;
}
function param(d, p, large = false, stepper = false) {
  const n = normalize(d.values[p[0]], p);
  return `<div class="param"><span class="param-label">${p[1]}</span>${stepper ? `<div class="stepper"><button data-step="-1" data-device="${d.id}" data-key="${p[0]}" aria-label="Decrease ${p[1]}">−</button>${number(d, p)}<button data-step="1" data-device="${d.id}" data-key="${p[0]}" aria-label="Increase ${p[1]}">+</button></div>` : `<div class="knob ${large ? "large" : ""}" role="slider" tabindex="0" data-knob="${p[0]}" data-device="${d.id}" style="--angle:${-135 + n * 270}deg;--sweep:${n * 270}deg" aria-label="${spec[d.type].name} ${p[1]}" aria-valuemin="${p[2]}" aria-valuemax="${p[3]}" aria-valuenow="${d.values[p[0]]}" aria-valuetext="${display(d.values[p[0]], p)} ${p[5]}"></div>${number(d, p)}`}</div>`;
}
function choice(d) {
  return spec[d.type].choice
    ? `<div class="segments" role="group" aria-label="${d.type === "filter" ? "Filter type" : "Delay sync"}">${spec[d.type].choice.map((c, i) => `<button data-choice="${i}" data-device="${d.id}" aria-pressed="${d.choice === i}">${c}</button>`).join("")}</div>`
    : "";
}
function xy(d) {
  const [p, q] = spec[d.type].params;
  return `<div class="xy" role="group" aria-label="${spec[d.type].name} XY pad. Drag to change ${p[1]} and ${q[1]}; numeric inputs below provide keyboard control." data-pad="${d.id}" style="--x:${normalize(d.values[p[0]], p) * 100}%;--y:${normalize(d.values[q[0]], q) * 100}%"><span class="xy-x">${p[1]} →</span><span class="xy-y">${q[1]} ↑</span><i class="xy-point"></i></div><div class="xy-values">${param(d, p)}${param(d, q)}</div>`;
}
function card(d, index) {
  const s = spec[d.type],
    creative = !["eq", "compressor", "limiter"].includes(d.type),
    count = tracks[selected].devices.filter(
      (x) => !["eq", "compressor", "limiter"].includes(x.type),
    ).length;
  const pad = variant === "C" && ["filter", "delay", "reverb"].includes(d.type);
  const graph = variant === "D" && ["filter", "eq"].includes(d.type);
  return `<article class="device device-${d.type} ${d.on ? "" : "off"}" data-id="${d.id}"><header class="device-head"><button class="on" data-bypass="${d.id}" aria-label="${d.on ? "Bypass" : "Enable"} ${s.name}" aria-pressed="${d.on}" title="${d.on ? "On" : "Bypassed"}">${icon("power")}</button><h3>${s.name}</h3><div class="device-actions">${creative ? `<button class="icon-button" data-move="-1" data-device="${d.id}" aria-label="Move ${s.name} earlier" ${index === 0 ? "disabled" : ""}>${icon("left")}</button><button class="icon-button" data-move="1" data-device="${d.id}" aria-label="Move ${s.name} later" ${index === count - 1 ? "disabled" : ""}>${icon("right")}</button><button class="icon-button" data-remove="${d.id}" aria-label="Remove ${s.name}">${icon("close")}</button>` : ""}</div></header><div class="device-body">${choice(d)}${graph ? graphMarkup(d) + `<div class="graph-values">${s.params.map((p) => `<label class="param"><span class="param-label">${p[1]}</span>${number(d, p)}</label>`).join("")}</div>` : pad ? (d.type === "reverb" ? '<div class="pad-top"><span>Room character</span><span>Size × mix</span></div>' : "") + xy(d) : `<div class="parameters">${s.params.map((p, i) => param(d, p, d.type === "filter" && i === 0, variant === "C" && d.type === "eq")).join("")}</div>`}</div></article>`;
}
function channel(t, i) {
  return `<article class="channel ${i === selected ? "selected" : ""}" style="--track:${t.color};--level:${[63, 54, 40, 47, 72][i]}%" data-track="${i}" tabindex="0" role="group" aria-label="${t.name} channel. Click background or press Enter to select." ${i === selected ? 'aria-current="true"' : ""}><div class="channel-top"><span class="channel-index">${i === 4 ? "OUT" : String(i + 1).padStart(2, "0")}</span><span class="channel-name">${t.name}</span><span class="preset">${t.preset}</span></div><div class="channel-controls"><div class="fader-block"><div class="fader-scale"><span>0</span><span>−12</span><span>−24</span><span>−∞</span></div><input class="fader" type="range" min="-60" max="6" step=".1" value="${t.level}" data-level="${i}" aria-label="${t.name} level"><div class="mini-meter" aria-label="Illustrative level only"></div></div><div class="pan-small"><label for="pan-${i}">${i === 4 ? "Output" : "Pan"}</label>${i === 4 ? "<span>STEREO</span>" : `<input id="pan-${i}" type="number" min="-100" max="100" value="${t.pan}" data-pan="${i}" aria-label="${t.name} pan"><span>L · C · R</span>`}</div></div><div class="level-number"><input type="number" data-level="${i}" min="-60" max="6" step=".1" value="${t.level.toFixed(1)}" aria-label="${t.name} level value"><span>dB</span></div><div class="channel-footer">${i === 4 ? '<span class="state-readout">Creative FX → dynamics → output</span>' : `<button data-toggle="mute" data-index="${i}" aria-pressed="${t.mute}" aria-label="Mute ${t.name}">M</button><button data-toggle="solo" data-index="${i}" aria-pressed="${t.solo}" aria-label="Solo ${t.name}">S</button><button class="lock" data-toggle="lock" data-index="${i}" aria-pressed="${t.lock}">Lock</button>`}</div></article>`;
}
function rack() {
  const t = tracks[selected];
  return `<div class="fx-heading"><h2 style="color:${t.color}">${t.name} effects</h2><span class="signal">${t.devices.map((d) => spec[d.type].name).join(" → ")}</span><div class="fx-tools"><select id="add-type" aria-label="Effect to add"><option value="filter">Filter</option><option value="drive">Drive</option><option value="crush">Crush</option><option value="delay">Delay</option><option value="reverb">Reverb</option></select><button id="add">+ Add FX</button></div></div><div class="rack">${t.devices.map(card).join("")}</div><footer class="bottom-status"><span id="edit-state">${lastEdit}</span><span>Drag knobs vertically · type values · double-click to reset</span></footer>`;
}
function render() {
  document.body.dataset.variant = variant;
  app.innerHTML = `<div class="page-heading"><h1>Mixer</h1><div class="tools"><span class="track-count">4 instruments + master</span><button id="auto" class="quiet" aria-expanded="false">Auto Mix</button></div></div><div class="auto-panel" hidden><label><input type="checkbox" checked>Balance</label><label><input type="checkbox" checked>EQ</label><label><input type="checkbox" checked>Dynamics</label><span>Analysis is not connected in this prototype.</span><button disabled>Analyze</button></div><section class="channels" aria-label="Instrument channels">${tracks.map(channel).join("")}</section><section id="processing" aria-label="Selected instrument effects">${rack()}</section>`;
  switcher();
}
function selectTrack(i) {
  selected = Number(i);
  document.querySelectorAll(".channel").forEach((el, index) => {
    el.classList.toggle("selected", index === selected);
    if (index === selected) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });
  document.querySelector("#processing").innerHTML = rack();
  document.querySelector("#announcement").textContent =
    `${tracks[selected].name} selected`;
}
function switcher() {
  document.querySelector(".variants").innerHTML = Object.entries(variants)
    .map(
      ([key, name]) =>
        `<button data-variant="${key}" aria-pressed="${variant === key}">${key} · ${name}</button>`,
    )
    .join("");
}
function setVariant(v) {
  variant = v;
  const url = new URL(location.href);
  url.searchParams.set("variant", v);
  history.replaceState(null, "", url);
  render();
  console.info("Prototype state", {
    variant,
    selected: tracks[selected].name,
    tracks: structuredClone(tracks),
  });
}
function cycle(delta) {
  const keys = Object.keys(variants);
  setVariant(keys[(keys.indexOf(variant) + delta + keys.length) % keys.length]);
}
function setValue(d, p, value, source) {
  const step = p[4];
  value = clamp(Math.round(value / step) * step, p[2], p[3]);
  d.values[p[0]] = Number(value.toFixed(4));
  const el = app.querySelector(`[data-id="${d.id}"]`);
  el.querySelectorAll(`[data-value="${p[0]}"]`).forEach((input) => {
    if (input !== source) input.value = display(value, p);
  });
  el.querySelectorAll(`[data-knob="${p[0]}"]`).forEach((knob) => {
    knob.style.setProperty("--angle", `${-135 + normalize(value, p) * 270}deg`);
    knob.style.setProperty("--sweep", `${normalize(value, p) * 270}deg`);
    knob.setAttribute("aria-valuenow", value);
    knob.setAttribute("aria-valuetext", `${display(value, p)} ${p[5]}`);
  });
  updateGraph(d, app);
  const pad = el.querySelector(".xy");
  if (pad) {
    const [x, y] = spec[d.type].params;
    pad.style.setProperty("--x", `${normalize(d.values[x[0]], x) * 100}%`);
    pad.style.setProperty("--y", `${normalize(d.values[y[0]], y) * 100}%`);
  }
  lastEdit = `${tracks[selected].name} / ${spec[d.type].name} / ${p[1]} ${display(value, p)} ${p[5]}`;
  document.querySelector("#edit-state").textContent = lastEdit;
}
document.querySelector("#previous").innerHTML = icon("left");
document.querySelector("#next").innerHTML = icon("right");
document.querySelector("#previous").onclick = () => cycle(-1);
document.querySelector("#next").onclick = () => cycle(1);
document.querySelector(".variants").onclick = (e) => {
  const b = e.target.closest("[data-variant]");
  if (b) setVariant(b.dataset.variant);
};
document.querySelector("#reset").onclick = () => {
  tracks = makeTracks();
  lastEdit = "Demo values reset.";
  render();
};
document.querySelector("#theme").onclick = (e) => {
  document.documentElement.classList.toggle("light");
  e.target.textContent = document.documentElement.classList.contains("light")
    ? "Dark"
    : "Light";
};
app.addEventListener("click", (e) => {
  const el = e.target.closest("button"),
    ch = e.target.closest(".channel");
  if (ch && !e.target.closest("button,input,select"))
    selectTrack(ch.dataset.track);
  if (!el) return;
  if (el.dataset.focusBand)
    app
      .querySelector(
        `[data-id="${el.dataset.device}"] [data-band="${el.dataset.focusBand}"]`,
      )
      .focus();
  if (el.id === "auto") {
    const panel = app.querySelector(".auto-panel");
    panel.hidden = !panel.hidden;
    el.setAttribute("aria-expanded", !panel.hidden);
  }
  if (el.dataset.toggle) {
    const t = tracks[el.dataset.index];
    t[el.dataset.toggle] = !t[el.dataset.toggle];
    el.setAttribute("aria-pressed", t[el.dataset.toggle]);
    selectTrack(el.dataset.index);
  }
  if (el.dataset.choice !== undefined) {
    const d = activeDevice(el.dataset.device);
    d.choice = Number(el.dataset.choice);
    updateGraph(d, app);
    el.parentElement
      .querySelectorAll("button")
      .forEach((b, i) => b.setAttribute("aria-pressed", i === d.choice));
    lastEdit = `${tracks[selected].name} / ${spec[d.type].name} / ${spec[d.type].choice[d.choice]}`;
    document.querySelector("#edit-state").textContent = lastEdit;
  }
  if (el.dataset.bypass) {
    const d = activeDevice(el.dataset.bypass);
    d.on = !d.on;
    const parent = el.closest(".device");
    parent.classList.toggle("off", !d.on);
    el.setAttribute("aria-pressed", d.on);
    el.setAttribute(
      "aria-label",
      `${d.on ? "Bypass" : "Enable"} ${spec[d.type].name}`,
    );
  }
  if (el.dataset.remove) {
    tracks[selected].devices = tracks[selected].devices.filter(
      (d) => d.id !== Number(el.dataset.remove),
    );
    document.querySelector("#processing").innerHTML = rack();
  }
  if (el.dataset.move) {
    const ds = tracks[selected].devices,
      i = ds.findIndex((d) => d.id === Number(el.dataset.device)),
      j = i + Number(el.dataset.move);
    [ds[i], ds[j]] = [ds[j], ds[i]];
    document.querySelector("#processing").innerHTML = rack();
  }
  if (el.dataset.step) {
    const d = activeDevice(el.dataset.device),
      p = getParam(d, el.dataset.key);
    setValue(d, p, d.values[p[0]] + Number(el.dataset.step) * p[4]);
  }
  if (el.id === "add") {
    const t = tracks[selected],
      n = t.devices.filter(
        (d) => !["eq", "compressor", "limiter"].includes(d.type),
      ).length,
      max = selected === 4 ? 8 : 3;
    if (n >= max) {
      document.querySelector("#edit-state").textContent =
        `${max} creative effects maximum. Remove one to try another.`;
      return;
    }
    t.devices.splice(n, 0, device(document.querySelector("#add-type").value));
    document.querySelector("#processing").innerHTML = rack();
  }
});
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.value) {
    const d = activeDevice(el.dataset.device),
      p = getParam(d, el.dataset.value);
    if (el.value !== "" && Number.isFinite(Number(el.value)))
      setValue(d, p, Number(el.value), el);
  }
  if (el.dataset.level !== undefined) {
    const i = Number(el.dataset.level),
      v = clamp(Number(el.value), -60, 6);
    tracks[i].level = v;
    app.querySelectorAll(`[data-level="${i}"]`).forEach((input) => {
      if (input !== el) input.value = v;
    });
    if (i !== selected) selectTrack(i);
  }
  if (el.dataset.pan !== undefined) {
    const i = Number(el.dataset.pan);
    tracks[i].pan = clamp(Number(el.value), -100, 100);
    if (i !== selected) selectTrack(i);
  }
});
app.addEventListener("keydown", (e) => {
  const knob = e.target.closest("[data-knob]");
  if (knob) {
    const d = activeDevice(knob.dataset.device),
      p = getParam(d, knob.dataset.knob);
    if (
      [
        "ArrowUp",
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? p[4] * 10 : p[4];
      setValue(
        d,
        p,
        e.key === "Home"
          ? p[2]
          : e.key === "End"
            ? p[3]
            : d.values[p[0]] +
              (["ArrowUp", "ArrowRight"].includes(e.key) ? step : -step),
      );
    }
  } else if (e.target.matches(".channel") && ["Enter", " "].includes(e.key)) {
    e.preventDefault();
    selectTrack(e.target.dataset.track);
  }
});
app.addEventListener("dblclick", (e) => {
  const knob = e.target.closest("[data-knob]");
  if (knob) {
    const d = activeDevice(knob.dataset.device),
      p = getParam(d, knob.dataset.knob);
    setValue(d, p, defaults[d.type][p[0]]);
  }
});
app.addEventListener("pointerdown", (e) => {
  const band = e.target.closest("[data-band]");
  if (band) {
    e.preventDefault();
    band.focus();
    band.setPointerCapture(e.pointerId);
    const d = activeDevice(band.dataset.device),
      rect = band.closest(".frequency-graph").getBoundingClientRect();
    const move = (event) =>
      graphDrag(d, band.dataset.band, event, rect).forEach(([key, value]) =>
        setValue(d, getParam(d, key), value),
      );
    band.addEventListener("pointermove", move);
    const end = () => {
      band.removeEventListener("pointermove", move);
      band.removeEventListener("pointerup", end);
      band.removeEventListener("pointercancel", end);
    };
    band.addEventListener("pointerup", end);
    band.addEventListener("pointercancel", end);
    return;
  }
  const channel = e.target.closest(".channel");
  if (channel && Number(channel.dataset.track) !== selected)
    selectTrack(channel.dataset.track);
  const knob = e.target.closest("[data-knob]"),
    pad = e.target.closest("[data-pad]");
  if (!knob && !pad) return;
  e.preventDefault();
  const el = knob || pad;
  el.setPointerCapture(e.pointerId);
  if (knob) knob.focus();
  const d = activeDevice(el.dataset.device || el.dataset.pad),
    p = knob ? getParam(d, knob.dataset.knob) : null,
    startY = e.clientY,
    initial = p ? normalize(d.values[p[0]], p) : 0;
  const move = (event) => {
    if (knob)
      setValue(
        d,
        p,
        denormalize(
          clamp(
            initial + (startY - event.clientY) / (event.shiftKey ? 1200 : 160),
            0,
            1,
          ),
          p,
        ),
      );
    else {
      const rect = pad.getBoundingClientRect(),
        [x, y] = spec[d.type].params;
      setValue(
        d,
        x,
        denormalize(clamp((event.clientX - rect.left) / rect.width, 0, 1), x),
      );
      setValue(
        d,
        y,
        denormalize(
          clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
          y,
        ),
      );
    }
  };
  if (pad) move(e);
  el.addEventListener("pointermove", move);
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
});
document.addEventListener("keydown", (e) => {
  const band = e.target.closest("[data-band]");
  if (
    band &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
  ) {
    e.preventDefault();
    const d = activeDevice(band.dataset.device),
      key = band.dataset.band,
      horizontal = ["ArrowLeft", "ArrowRight"].includes(e.key),
      direction = ["ArrowRight", "ArrowUp"].includes(e.key) ? 1 : -1;
    const parameter =
      key === "cutoff"
        ? horizontal
          ? "cutoff"
          : "q"
        : key === "mid"
          ? horizontal
            ? "midHz"
            : "mid"
          : key;
    const p = getParam(d, parameter),
      frequency = ["cutoff", "midHz", "lowCut"].includes(parameter);
    setValue(
      d,
      p,
      frequency
        ? d.values[parameter] * Math.pow(1.04, direction)
        : d.values[parameter] + direction * p[4],
    );
    return;
  }
  if (
    e.defaultPrevented ||
    e.target.closest(
      "input,textarea,select,[role=slider],[contenteditable=true]",
    )
  )
    return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    cycle(e.key === "ArrowLeft" ? -1 : 1);
  }
});
// Refresh only newly rendered chart content. Edits update the existing paths in place.
new MutationObserver((records) => {
  if (
    records.some((record) =>
      [...record.addedNodes].some(
        (node) =>
          node.nodeType === 1 &&
          (node.matches?.(".frequency-graph") ||
            node.querySelector?.(".frequency-graph")),
      ),
    )
  )
    tracks[selected].devices.forEach((d) => updateGraph(d, app));
}).observe(app, { childList: true, subtree: true });
render();
