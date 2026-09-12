import { createDemoProject } from "./demoSong";
import {
  ALL_LANE_IDS,
  DRUM_PIECES,
  createDefaultProject,
  type ProjectDocument,
  type PitchedPattern,
  type DrumPattern,
  type LaneId,
  type Note,
} from "./schema";

export const BUILT_IN_DEMOS = [
  {
    id: "welcome",
    name: "Welcome Song",
    description: "The original four-track demo.",
  },
  {
    id: "glass-arcade",
    name: "Glass Arcade",
    description:
      "8 tracks · 122 BPM · Bells, plucked replies and a brass lift.",
  },
  {
    id: "after-hours",
    name: "After Hours",
    description:
      "8 tracks · 88 BPM · Horns, vibes and a wind bed over a swung groove.",
  },
] as const;
export type DemoId = (typeof BUILT_IN_DEMOS)[number]["id"];

/** Each call returns independent editable data. The first-run composition stays untouched. */
export function createBuiltInDemo(id: DemoId): ProjectDocument {
  if (id === "welcome") return structuredClone(createDemoProject());
  return compose(id === "after-hours");
}

function compose(night: boolean): ProjectDocument {
  const base = createDefaultProject();
  const presets = night
    ? [
        "preset-bass-5",
        "preset-chords-3",
        "preset-keys-reed",
        "preset-brass-horn",
        "preset-bells-vibes",
        "preset-strings-dulcimer",
        "preset-fx-wind",
      ]
    : [
        "preset-bass-5",
        "preset-chords-3",
        "preset-lead-3",
        "preset-bells-crystal",
        "preset-strings-zither",
        "preset-brass-section",
        "preset-fx-riser",
      ];
  const volumes = night
    ? [0.65, 0.52, 0.27, 0.18, 0.32, 0.27, 0.19, 0.12]
    : [0.65, 0.5, 0.24, 0.2, 0.32, 0.22, 0.23, 0.16];
  const lanes: ProjectDocument["lanes"] = ALL_LANE_IDS.map((id, i) =>
    id === "drums"
      ? {
          id,
          kitId: "kit-soft",
          gate: { unit: "steps", value: 1 },
          volume: volumes[i],
          fxChain: [],
        }
      : {
          id,
          presetId: presets[i - 1]!,
          gate: { unit: "steps", value: 2 },
          volume: volumes[i],
          fxChain:
            i === 1
              ? [
                  {
                    type: "filter",
                    bypassed: false,
                    params: { kind: "lowpass", cutoffHz: 650, q: 0.7 },
                  },
                ]
              : [
                  {
                    type: "reverb",
                    bypassed: false,
                    params: {
                      size: night ? 0.48 : 0.32,
                      mix: i === 7 ? 0.35 : 0.18,
                    },
                  },
                  ...(i === 4 || i === 5
                    ? [
                        {
                          type: "delay" as const,
                          bypassed: false,
                          params: { timeSteps: 3, feedback: 0.22, mix: 0.16 },
                        },
                      ]
                    : []),
                ],
        },
  );
  const patterns = { ...base.patterns };
  const songChain = { ...base.songChain };
  const chainCues: { [K in LaneId]?: string[] } & {
    drums: string[];
    bass: string[];
    chords: string[];
    lead: string[];
  } = { drums: [], bass: [], chords: [], lead: [] };
  const sections = night
    ? ["ROOM", "POCKET", "HORNS", "DAWN"]
    : ["SPARK", "REPLY", "LIFT", "TURN"];
  for (const lane of ALL_LANE_IDS) {
    patterns[lane] = sections.map((section, index) =>
      lane === "drums"
        ? drums(index, night)
        : pitched(lane, index, night, section),
    );
    songChain[lane] = patterns[lane]!.map((p) => p.id);
    chainCues[lane] = [...sections];
  }
  return {
    ...base,
    name: night ? "AFTER HOURS" : "GLASS ARCADE",
    transport: {
      bpm: night ? 88 : 122,
      swing: night ? 0.22 : 0.08,
      metronome: false,
    },
    scale: { root: night ? 2 : 0, mode: night ? "minor" : "major" },
    lanes,
    patterns,
    songChain,
    chainCues,
  };
}

function pitched(
  lane: LaneId,
  section: number,
  night: boolean,
  name: string,
): PitchedPattern {
  const notes: Note[] = [];
  const put = (degree: number, start: number, length: number) =>
    notes.push({ degree, start, length });
  for (let bar = 0; bar < 2; bar++) {
    const root = [0, 5, 3, 4][(section * 2 + bar) % 4]!;
    const t = bar * 16;
    switch (lane) {
      case "bass":
        for (const step of night ? [0, 6, 10, 14] : [0, 3, 6, 8, 11, 14])
          put(root, t + step, step === 0 ? 2.5 : 1.5);
        break;
      case "chords":
        for (const d of [root, root + 2, root + 4]) put(d, t, night ? 12 : 10);
        break;
      case "lead":
        if (section > 0)
          for (const [j, d] of [root + 2, root + 4, root + 1, root].entries())
            put(d, t + [2, 5, 10, 14][j]!, night ? 1 : 1.5);
        break;
      case "extra1":
        if (night) {
          if (section > 0) {
            put(root + 2, t + 1, 5);
            put(root + 4, t + 8, 3);
            put(root + 2, t + 12, 2);
          }
        } else {
          for (const [j, d] of [root, root + 4, root + 2, root + 4].entries())
            put(d, t + [0, 4, 7, 12][j]!, 1.5);
        }
        break;
      case "extra2":
        if (section !== 2)
          for (const [j, d] of [root + 4, root + 2, root].entries())
            put(d, t + [3, 9, 14][j]!, night ? 2 : 1);
        break;
      case "extra3":
        if (night) {
          if (section === 0 || section === 3)
            for (const step of [0, 4, 8, 12])
              put(root + (step % 8 === 0 ? 0 : 4), t + step, 1.5);
        } else if (section === 2 || (section === 3 && bar === 0)) {
          for (const step of [0, 6, 10])
            for (const d of [root, root + 2, root + 4]) put(d, t + step, 2);
        }
        break;
      case "extra4":
        if (night) {
          if (bar === 0 && (section === 0 || section === 3)) put(0, t, 24);
        } else if (bar === 1 && (section === 1 || section === 3))
          put(0, t + 8, 7);
        break;
    }
  }
  return {
    kind: "pitched",
    id: `${lane}-${section + 1}`,
    name,
    bars: 2,
    rowDegrees: Array.from({ length: 12 }, (_, i) => i),
    notes: notes.sort((a, b) => a.start - b.start || a.degree - b.degree),
  };
}
function drums(section: number, night: boolean): DrumPattern {
  const steps = Object.fromEntries(
    DRUM_PIECES.map((piece) => [piece, Array<boolean>(32).fill(false)]),
  ) as Record<(typeof DRUM_PIECES)[number], boolean[]>;
  for (let bar = 0; bar < 2; bar++) {
    const t = bar * 16;
    for (const s of night ? [0, 7, 10] : [0, 4, 8, 12])
      steps.kick[t + s] = true;
    for (const s of [4, 12]) steps.snare[t + s] = true;
    for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) steps.hat[t + s] = true;
    if (section > 0) steps.openhat[t + 14] = true;
    if (section === 2) for (const s of [4, 12]) steps.clap[t + s] = true;
  }
  if (section === 3) {
    steps.snare[29] = true;
    steps.tom[30] = true;
    steps.tom[31] = true;
  }
  return {
    kind: "drums",
    id: `drums-${section + 1}`,
    name: ["A", "B", "C", "D"][section]!,
    bars: 2,
    steps,
  };
}
