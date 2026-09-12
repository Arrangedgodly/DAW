/* global document, window, location, history, URL, URLSearchParams, AudioContext, ResizeObserver, requestAnimationFrame */
// THROWAWAY: three treatments of the same four-lane instrument, selected by
// ?variant=A|B|C on the existing development route. No app/session persistence.
import { createComponent, createEffect } from "solid-js";
import { trackColors } from "../state/trackColors";
import { render } from "solid-js/web";
import TrackColorControl from "../components/TrackColorControl";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const study = $("#study");
const variants = {
  A: [
    "Membrane",
    "Membrane’s layout with Undertow’s luminous note buttons.",
    "Notes glow in their track color and brighten as they sound. Choose a color beside each track name; it also follows that instrument into the DAW and visualizer.",
  ],
  B: [
    "Precision",
    "Cool silver, quiet controls, and a fine seam of living color.",
    "Motion stays close to the instrument. Small signal ribbons follow each part while the silver body and rotary controls remain still.",
  ],
  C: [
    "Undertow",
    "Open notation suspended over a slow, flowing audio field.",
    "Bass lifts the shared field. Chords stretch it into long ribbons, while drums send short waves across the surface. Controls stay anchored.",
  ],
};
const colors = {
  A: ["#dfaaa1", "#c4d49e", "#93cfc7", "#aabbe7"],
  B: ["#a35c46", "#62713b", "#237f77", "#656398"],
  C: ["#efa9bb", "#a9b7ef", "#86d6d6", "#c2b0f4"],
};
const names = ["Drums", "Bass", "Chords", "Lead"];
const presets = [
  "Soft step / electronic kit",
  "Round triangle / sub",
  "Soft pulse / sustained",
  "Vibra triangle / melodic",
];
const labels = [
  ["Kick", "Snare", "Hat", "Open", "Clap", "Tom", "Rim"],
  ["A♭2", "G2", "F2", "E♭2", "D2", "C2", "B♭1"],
  ["A♭3", "G3", "F3", "E♭3", "D3", "C3", "B♭2"],
  ["A♭5", "G5", "F5", "E♭5", "D5", "C5", "B♭4"],
];
const midi = [
  [0, 1, 2, 3, 4, 5, 6],
  [44, 43, 41, 39, 38, 36, 34],
  [56, 55, 53, 51, 50, 48, 46],
  [80, 79, 77, 75, 74, 72, 70],
];
const patterns = [
  new Set([
    "0:0",
    "0:6",
    "0:8",
    "1:4",
    "1:12",
    "2:0",
    "2:2",
    "2:4",
    "2:6",
    "2:8",
    "2:10",
    "2:12",
    "2:14",
    "3:15",
  ]),
  new Set(["5:0", "5:3", "5:6", "5:8", "5:11", "1:14"]),
  new Set(["5:0", "3:0", "1:0", "4:8", "2:8", "0:8"]),
  new Set(["5:0", "3:3", "1:6", "2:8", "3:11", "0:14"]),
];
const initial = patterns.map((p) => new Set(p));
const lanes = names.map((name, i) => ({
  name,
  mute: false,
  solo: false,
  tone: 58,
  pattern: 0,
  pulse: 0,
  analyser: null,
  samples: null,
  gain: null,
  filter: null,
  index: i,
}));
let variant = new URLSearchParams(location.search).get("variant");
if (!variants[variant]) variant = "A";
let ctx,
  master,
  playing = false,
  nextTime = 0,
  step = 0,
  timer = null,
  queue = [],
  current = -1;
let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let motion = reduced ? 0 : 0.65;
let lastFrame = 0;
const nodes = new Set();
const canvas = $("#field");
const painter = canvas.getContext("2d");
let width = 0,
  height = 0;

$("#lanes").innerHTML = lanes
  .map(
    (
      lane,
      i,
    ) => `<section class="lane ${i === 0 ? "selected" : ""}" data-index="${i}" aria-label="${lane.name}">
  <header class="lane-top"><div class="lane-ident"><i class="lane-orb"></i><div><h2>${lane.name}</h2><p class="preset">${presets[i]}</p></div></div><div class="mix"><button data-mute="${i}" aria-label="Mute ${lane.name}" aria-pressed="false">M</button><button data-solo="${i}" aria-label="Solo ${lane.name}" aria-pressed="false">S</button></div></header>
  <div class="grid-wrap"><div class="pitch-labels">${labels[i].map((l) => `<span>${l}</span>`).join("")}</div><div class="grid" role="group" aria-label="${lane.name} note grid">${Array.from(
    { length: 112 },
    (_, n) => {
      const row = Math.floor(n / 16),
        col = n % 16;
      return `<button class="cell" data-row="${row}" data-col="${col}" aria-label="${labels[i][row]}, step ${col + 1}" aria-pressed="${patterns[i].has(`${row}:${col}`)}" tabindex="${n === 0 ? "0" : "-1"}"></button>`;
    },
  ).join("")}</div></div>
  <div class="beats" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span></div>
  <div class="controls"><div class="tone-control"><div class="dial" aria-hidden="true"></div><label>Tone<output>58%</output><input type="range" min="0" max="100" value="58" data-tone="${i}" aria-label="${lane.name} tone"/></label></div><div class="pattern"><span>PATTERN</span>${["A", "B", "C"].map((p, n) => `<button data-pattern="${n}" aria-pressed="${n === 0}" aria-label="${lane.name} pattern ${p}">${p}</button>`).join("")}</div></div><div class="lane-signal" aria-hidden="true"></div>
</section>`,
  )
  .join("");
const sections = $$(".lane");
const cells = sections.map((s) => [...s.querySelectorAll(".cell")]);
const signalEls = $$(".lane-signal");
sections.forEach((section, i) => {
  const control = document.createElement("div");
  control.className = "prototype-color";
  section
    .querySelector(".lane-top")
    .insertBefore(control, section.querySelector(".mix"));
  render(
    () => createComponent(TrackColorControl, { lane: names[i].toLowerCase() }),
    control,
  );
});
createEffect(() => {
  const custom = trackColors();
  sections.forEach((section, i) => {
    const color = custom[names[i].toLowerCase()] ?? colors[variant][i];
    section.style.setProperty("--color", color);
  });
});

const active = (i) =>
  !lanes[i].mute && (!lanes.some((l) => l.solo) || lanes[i].solo);
function setVariant(key) {
  variant = key;
  study.dataset.variant = key;
  $("#direction").textContent = variants[key][0];
  $("#description").textContent = variants[key][1];
  $("#motion-description").textContent = variants[key][2];
  sections.forEach((el, i) => {
    const color = trackColors()[names[i].toLowerCase()] ?? colors[key][i];
    el.style.setProperty("--color", color);
  });
  $$(".switcher [data-variant]").forEach((b) =>
    b.setAttribute("aria-current", String(b.dataset.variant === key)),
  );
  const url = new URL(window.parent.location.href);
  url.searchParams.set("variant", key);
  window.parent.history.replaceState(null, "", url);
  if (window.parent !== window)
    history.replaceState(null, "", `?variant=${key}`);
  resize();
}
function cycle(delta) {
  const keys = Object.keys(variants);
  setVariant(keys[(keys.indexOf(variant) + delta + 3) % 3]);
}
$("#previous").onclick = () => cycle(-1);
$("#next").onclick = () => cycle(1);
$$(".switcher [data-variant]").forEach(
  (b) => (b.onclick = () => setVariant(b.dataset.variant)),
);
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,[contenteditable],.grid")) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    cycle(e.key === "ArrowLeft" ? -1 : 1);
  }
  if (e.code === "Space" && !e.target.closest("button,a")) {
    e.preventDefault();
    togglePlay();
  }
});
$$(".phone-lanes button").forEach(
  (b) =>
    (b.onclick = () => {
      $$(".phone-lanes button").forEach((el) =>
        el.setAttribute("aria-pressed", String(el === b)),
      );
      sections.forEach((el, i) =>
        el.classList.toggle("selected", i === Number(b.dataset.lane)),
      );
      resize();
    }),
);
sections.forEach((section, i) => {
  section.querySelector(".grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const key = `${cell.dataset.row}:${cell.dataset.col}`;
    if (patterns[i].has(key)) patterns[i].delete(key);
    else patterns[i].add(key);
    cell.setAttribute("aria-pressed", String(patterns[i].has(key)));
    cells[i].forEach((c) => (c.tabIndex = c === cell ? 0 : -1));
  });
  section.querySelector(".grid").addEventListener("keydown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const index = cells[i].indexOf(cell);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 }[
      e.key
    ];
    if (delta !== undefined) {
      e.preventDefault();
      const next = cells[i][Math.max(0, Math.min(111, index + delta))];
      cell.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  });
  section.querySelectorAll("[data-pattern]").forEach(
    (b) =>
      (b.onclick = () => {
        const n = Number(b.dataset.pattern);
        lanes[i].pattern = n;
        patterns[i] = new Set(
          [...initial[i]].map((k) => {
            const [r, c] = k.split(":").map(Number);
            return `${r}:${(c + n * 2) % 16}`;
          }),
        );
        cells[i].forEach((c) =>
          c.setAttribute(
            "aria-pressed",
            String(patterns[i].has(`${c.dataset.row}:${c.dataset.col}`)),
          ),
        );
        section
          .querySelectorAll("[data-pattern]")
          .forEach((el) => el.setAttribute("aria-pressed", String(el === b)));
      }),
  );
});
function updateMix() {
  let count = 0;
  lanes.forEach((lane, i) => {
    const on = active(i);
    if (on) count++;
    if (lane.gain)
      lane.gain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.008);
    if (!on) lane.pulse = 0;
    sections[i].classList.toggle("muted", !on);
  });
  $("#mix-status").textContent = `${count} voices active`;
}
$$("[data-mute]").forEach(
  (b) =>
    (b.onclick = () => {
      const lane = lanes[Number(b.dataset.mute)];
      lane.mute = !lane.mute;
      b.setAttribute("aria-pressed", String(lane.mute));
      updateMix();
    }),
);
$$("[data-solo]").forEach(
  (b) =>
    (b.onclick = () => {
      const lane = lanes[Number(b.dataset.solo)];
      lane.solo = !lane.solo;
      b.setAttribute("aria-pressed", String(lane.solo));
      updateMix();
    }),
);
$$("[data-tone]").forEach(
  (input) =>
    (input.oninput = () => {
      const lane = lanes[Number(input.dataset.tone)];
      lane.tone = Number(input.value);
      input.parentElement.querySelector("output").textContent = `${lane.tone}%`;
      input
        .closest(".tone-control")
        .querySelector(".dial")
        .style.setProperty("--angle", `${lane.tone * 2.7 - 135}deg`);
      if (lane.filter)
        lane.filter.frequency.setTargetAtTime(
          250 + lane.tone * 100,
          ctx.currentTime,
          0.02,
        );
    }),
);
$("#motion").value = motion * 100;
$("#motion-value").textContent = `${Math.round(motion * 100)}%`;
$("#motion").oninput = () => {
  motion = Number($("#motion").value) / 100;
  $("#motion-value").textContent = `${Math.round(motion * 100)}%`;
};
window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (e) => {
    reduced = e.matches;
  });
$("#master").oninput = () => {
  if (master)
    master.gain.setTargetAtTime(
      (Number($("#master").value) / 100) * 0.55,
      ctx.currentTime,
      0.02,
    );
};
$("#tempo").onchange = () => {
  $("#tempo").value = Math.max(
    60,
    Math.min(160, Number($("#tempo").value) || 112),
  );
};

function setupAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = (Number($("#master").value) / 100) * 0.55;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor);
  compressor.connect(ctx.destination);
  lanes.forEach((l) => {
    l.filter = ctx.createBiquadFilter();
    l.filter.type = "lowpass";
    l.filter.frequency.value = 250 + l.tone * 100;
    l.gain = ctx.createGain();
    l.analyser = ctx.createAnalyser();
    l.analyser.fftSize = 256;
    l.samples = new Uint8Array(256);
    l.filter.connect(l.gain);
    l.gain.connect(l.analyser);
    l.analyser.connect(master);
  });
  updateMix();
}
function note(lane, row, time, duration) {
  const amp = ctx.createGain();
  amp.connect(lanes[lane].filter);
  let source;
  if (lane === 0 && row > 0) {
    const length = Math.floor(ctx.sampleRate * (row === 3 ? 0.24 : 0.12));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = row === 1 ? 900 : 6500;
    source.connect(filter);
    filter.connect(amp);
    duration = row === 3 ? 0.22 : 0.085;
  } else {
    source = ctx.createOscillator();
    source.type = lane === 2 ? "sine" : "triangle";
    const freq = lane === 0 ? 140 : 440 * 2 ** ((midi[lane][row] - 69) / 12);
    source.frequency.setValueAtTime(freq, time);
    if (lane === 0) {
      source.type = "sine";
      source.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      duration = 0.25;
    }
    source.connect(amp);
  }
  const level =
    lane === 0
      ? row === 0
        ? 0.65
        : row === 1
          ? 0.18
          : 0.09
      : lane === 1
        ? 0.27
        : lane === 2
          ? 0.075
          : 0.1;
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.exponentialRampToValueAtTime(level, time + 0.008);
  amp.gain.setValueAtTime(level * 0.65, time + duration * 0.45);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  source.start(time);
  source.stop(time + duration + 0.03);
  nodes.add(source);
  source.onended = () => {
    nodes.delete(source);
    source.disconnect();
    amp.disconnect();
  };
}
function schedule() {
  const interval = 60 / Number($("#tempo").value) / 4;
  while (nextTime < ctx.currentTime + 0.12) {
    const hits = [];
    lanes.forEach((l, i) => {
      if (!active(i)) return;
      let hit = false;
      for (let row = 0; row < 7; row++)
        if (patterns[i].has(`${row}:${step}`)) {
          note(
            i,
            row,
            nextTime,
            i === 2
              ? interval * 7.5
              : i === 1
                ? interval * 1.4
                : interval * 1.8,
          );
          hit = true;
        }
      if (hit) hits.push(i);
    });
    queue.push({ time: nextTime, step, hits });
    step = (step + 1) % 16;
    nextTime += interval;
  }
}
async function togglePlay() {
  if (playing) {
    playing = false;
    window.clearInterval(timer);
    queue = [];
    for (const node of nodes) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
    }
    nodes.clear();
    lanes.forEach((l) => (l.pulse = 0));
    current = -1;
    cells.flat().forEach((c) => c.classList.remove("current"));
    $("#position").textContent = "01.01";
  } else {
    try {
      setupAudio();
      await ctx.resume();
      playing = true;
      step = 0;
      nextTime = ctx.currentTime + 0.06;
      schedule();
      timer = window.setInterval(schedule, 25);
    } catch {
      $("#signal-status").textContent =
        "Audio unavailable. Try reloading this tab.";
      return;
    }
  }
  study.classList.toggle("playing", playing);
  $("#play span").textContent = playing ? "Stop" : "Play";
  $("#play").setAttribute("aria-label", playing ? "Stop demo" : "Play demo");
  $("#play path").setAttribute(
    "d",
    playing ? "M6 6h12v12H6Z" : "m8 5 11 7-11 7Z",
  );
  $("#signal-status").textContent = playing ? "Demo playing" : "Ready to play";
}
$("#play").onclick = togglePlay;
function resize() {
  const rect = $(".instrument").getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  painter.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe($(".instrument"));
function draw(now) {
  requestAnimationFrame(draw);
  if (now - lastFrame < 32) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (playing) {
    while (queue.length && queue[0].time <= ctx.currentTime) {
      const event = queue.shift();
      current = event.step;
      event.hits.forEach((i) => {
        if (active(i)) lanes[i].pulse = 1;
      });
      $("#position").textContent = `01.${String(current + 1).padStart(2, "0")}`;
      cells.forEach((list, i) =>
        list.forEach((c) =>
          c.classList.toggle(
            "current",
            Number(c.dataset.col) === current && active(i),
          ),
        ),
      );
    }
  }
  painter.clearRect(0, 0, width, height);
  const amount = reduced ? 0 : motion;
  const outputLevel = Number($("#master").value) / 100;
  const rect = $(".instrument").getBoundingClientRect();
  lanes.forEach((lane, i) => {
    lane.pulse *= Math.exp(-dt / (i === 0 ? 0.11 : i === 2 ? 0.7 : 0.28));
    if (!active(i)) lane.pulse = 0;
    signalEls[i].style.transform =
      `scaleX(${lane.pulse * amount * Math.min(1, outputLevel / 0.55)})`;
    sections[i].style.setProperty("--light", "0");
    if (!playing || !amount || !active(i) || !outputLevel) return;
    const box = sections[i].getBoundingClientRect();
    if (!box.height) return;
    const x = box.left - rect.left,
      y = box.top - rect.top,
      w = box.width,
      h = box.height;
    lane.analyser.getByteTimeDomainData(lane.samples);
    let rms = 0;
    for (const val of lane.samples) rms += ((val - 128) / 128) ** 2;
    rms = Math.sqrt(rms / lane.samples.length);
    const energy =
      Math.min(1, rms * 7 + lane.pulse * 0.4) *
      amount *
      Math.min(1, outputLevel / 0.55);
    if (energy < 0.005) return;
    sections[i].style.setProperty("--light", energy.toFixed(3));
    const color = trackColors()[names[i].toLowerCase()] ?? colors[variant][i];
    if (variant === "A") {
      // The notes own the glow. Keep the background still.
      painter.globalAlpha = 1;
    } else if (variant === "B") {
      painter.strokeStyle = color;
      painter.globalAlpha = 0.5 * amount;
      painter.lineWidth = 1;
      painter.beginPath();
      for (let j = 0; j < 128; j++) {
        const xx = x + 32 + (j / 127) * (w - 64);
        const yy = y + h - 10 + ((lane.samples[j] - 128) / 128) * 19 * amount;
        if (j) painter.lineTo(xx, yy);
        else painter.moveTo(xx, yy);
      }
      painter.stroke();
    } else {
      painter.strokeStyle = color;
      for (let ribbon = 0; ribbon < 7; ribbon++) {
        painter.globalAlpha = energy * (0.12 - ribbon * 0.012);
        painter.lineWidth = ribbon === 0 ? 1.5 : 1;
        painter.beginPath();
        for (let j = 0; j <= 100; j++) {
          const xx = (j / 100) * width,
            yy =
              y +
              h * 0.7 +
              Math.sin(j * 0.036 + now * 0.0005 + i * 0.8 + ribbon * 0.1) *
                energy *
                100 +
              Math.sin(j * 0.09 - now * 0.0008) * energy * 25 +
              ribbon * 5;
          if (j) painter.lineTo(xx, yy);
          else painter.moveTo(xx, yy);
        }
        painter.stroke();
      }
      const glow = painter.createRadialGradient(
        x + w * 0.5,
        y + h * 0.75,
        0,
        x + w * 0.5,
        y + h * 0.75,
        w * 0.65,
      );
      glow.addColorStop(0, `${color}22`);
      glow.addColorStop(1, `${color}00`);
      painter.globalAlpha = energy;
      painter.fillStyle = glow;
      painter.fillRect(0, 0, width, height);
    }
    painter.globalAlpha = 1;
  });
}
setVariant(variant);
requestAnimationFrame(draw);
window.addEventListener("pagehide", () => {
  if (timer) window.clearInterval(timer);
  if (ctx) ctx.close();
});
