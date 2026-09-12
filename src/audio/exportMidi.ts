/**
 * MIDI export pipeline (MF-5, D6 law): project → OWN typed note model →
 * midi-file writeMidi → Blob (audio/midi) download `<name>.bitbounce.mid`.
 *
 * Architecture (RES-5b): `midi-file` (2.8 KB gz) owns ONLY the byte framing —
 * varlen quantities, delta times, MThd/MTrk chunk layout. The event model is
 * ours: one section below builds typed per-lane note lists from the SAME
 * note-walking semantics as the audio compiler (compile.ts): v2 note lengths
 * are durations, chords lane stacks diatonic triads
 * [degree, degree+2, degree+4], pitch comes from degreeToMidi on the lane's
 * effective scale at the preset's octave base. Nothing here reads
 * VoiceNoteOnEvent (audio-clock payloads are wrong units for MIDI and drum
 * pieces are already synthesized to freqs) — the document is the source of
 * truth, walked with the same laws.
 *
 * Format-1 rules (RES-5b, per midi.org):
 * - Track 0 carries the tempo map (single setTempo from transport.bpm), a 4/4
 *   time signature, and — free win — section MARKERS from chainCues (DES-6):
 *   each non-null cue label becomes a marker meta event at its chain slot's
 *   start tick (deduped across lanes: the same label at the same tick is one
 *   marker).
 * - One track per lane AFTER track 0, always all four (drums, bass, chords,
 *   lead) in schema lane order — a silent lane still gets its track name +
 *   program hint + end-of-track so importers see a stable 5-track shape.
 *
 * Mapping law (documented choices):
 * - Drums → channel 9 (ZERO-BASED; GM "channel 10" one-based) with GM drum
 *   note numbers from one constant table (GM_DRUM_NOTES) and per-piece
 *   velocities from GM_DRUM_VELOCITIES.
 * - Pitched lanes → one channel each: bass 0, chords 1, lead 2 (LANE_CHANNELS).
 * - Program-change hints: preset → GM program (PRESET_GM_PROGRAMS, 0-based
 *   program numbers). HINT-ONLY by design (town-hall MIDI-illusion risk): the
 *   Bitbounce engine is a custom chiptune synth; a GM soundfont is at best an
 *   approximation of the preset's character, and velocity/gate are quantized
 *   to the MIDI grid. The notes, timing and structure are exact.
 * - Octave base per lane: the PRESET's pitchRange.octaveBase (same value the
 *   audio engine uses — exported pitches match what you hear), falling back
 *   to LANE_OCTAVE_FALLBACK (bass 2, chords 3, lead 4 — bass low, lead high)
 *   for hypothetical presets without a pitch range.
 * - Velocities: fixed sensible defaults (no dynamic expression exists in the
 *   document); pitched notes at PITCHED_VELOCITY.
 * - Duration (SC-2): pitched notes carry their own lengths — ticks are exact
 *   on the 0.25-step grid (length × TICKS_PER_STEP, always an integer); the
 *   lane gate does not scale durations (it is only the single-click default).
 *   Notes on degrees outside the pattern's row manifest are skipped, exactly
 *   like the audio compiler (v1: no row). Drums keep the gate: steps → exact
 *   ticks, seconds → rounded to ticks at the project BPM.
 * - Swing: odd 16th steps shift by round(swing × TICKS_PER_STEP) ticks — the
 *   same delay fraction the audio groove applies, on the tick grid.
 *
 * Determinism (golden HW-3): pure function of the document; writeMidi is
 * deterministic; event order is fully ordered (tick, noteOff-before-noteOn,
 * note number, velocity). Identical documents produce byte-identical files.
 *
 * XP-1 (i3-5) — the LCM cycle law: the file spans EXACTLY ONE full export
 * cycle. Lanes poly-loop (each chain wraps at its own total), so a lane
 * whose chain is shorter than the cycle has its notes AND cue markers
 * repeated at its chain length within the cycle — the same expansion law
 * the offline WAV render applies (render.ts expandLaneEventsForLoop over
 * computeLoopSteps). Equal-chain documents (cycle === every chain total)
 * are the identity: their bytes are UNCHANGED by the law (the iteration-3
 * zero-drift rule; pinned by midi/reference-project-v1).
 */

import { writeMidi, type MidiData, type MidiEvent } from "midi-file";
import {
  DRUM_PIECES,
  type DrumPiece,
  type LaneGate,
  type LaneId,
  type Pattern,
  type ProjectDocument,
} from "../document/schema";
import { effectiveScale, degreeToMidi } from "../document/scales";
import { getPreset } from "./presets";
import { laneCycleSteps, resolveChainPatterns } from "./song";
import { computeLoopSteps } from "./render";
import { safeFileStem, type DownloadSeam } from "../persist/fileIO";

export const MIDI_EXTENSION = ".bitbounce.mid";
export const MIDI_MIME = "audio/midi";

/** midi-file PPQ convention: header.ticksPerBeat is ticks per quarter note. */
export const PPQ = 480;
/** One 16th-grid step = PPQ / 4 ticks (STEPS_PER_BEAT = 4). */
export const TICKS_PER_STEP = PPQ / 4; // 120

/** GM drum channel, zero-based (the wire format's channel 9 = GM "ch 10"). */
export const DRUM_CHANNEL = 9;

/** GM note numbers for the six drum pieces (one constant table, RES-5b). */
export const GM_DRUM_NOTES: Readonly<Record<DrumPiece, number>> = {
  kick: 36, // Bass Drum 1
  snare: 38, // Acoustic Snare
  hat: 42, // Closed Hi-Hat
  openhat: 46, // Open Hi-Hat
  clap: 39, // Hand Clap
  tom: 45, // Low Tom
} as const;

/** Fixed sensible drum velocities (piece-typical accents). */
export const GM_DRUM_VELOCITIES: Readonly<Record<DrumPiece, number>> = {
  kick: 105,
  snare: 100,
  hat: 80,
  openhat: 85,
  clap: 98,
  tom: 96,
} as const;

export const PITCHED_VELOCITY = 96;

/** One MIDI channel per pitched lane (drums own channel 9). */
export const LANE_CHANNELS: Readonly<Record<Exclude<LaneId, "drums">, number>> =
  {
    bass: 0,
    chords: 1,
    lead: 2,
    extra1: 3,
    extra2: 4,
    extra3: 5,
    extra4: 6,
  } as const;

/** Fallback octave of scale degree 0 when a preset carries no pitch range. */
export const LANE_OCTAVE_FALLBACK: Readonly<
  Record<Exclude<LaneId, "drums">, number>
> = {
  bass: 2,
  chords: 3,
  lead: 4,
  extra1: 4,
  extra2: 4,
  extra3: 4,
  extra4: 4,
} as const;

/**
 * Preset → GM program (0-based program numbers), best-effort character hints.
 * The engine's custom chiptune voices have no GM equivalent; these pick the
 * nearest GM family so a stock soundfont lands in the right ballpark.
 */
export const PRESET_GM_PROGRAMS: Readonly<Record<string, number>> = {
  // GM 0-based: 16 Drawbar Organ, 34 Electric Bass (pick), 35 Fretless,
  // 38 Synth Bass 1, 39 Synth Bass 2
  "preset-bells-crystal": 14,
  "preset-bells-musicbox": 10,
  "preset-bells-church": 14,
  "preset-bells-vibes": 11,
  "preset-brass-trumpet": 56,
  "preset-brass-horn": 60,
  "preset-brass-section": 61,
  "preset-brass-staccato": 62,
  "preset-fx-riser": 103,
  "preset-fx-wind": 122,
  "preset-fx-laser": 103,
  "preset-fx-shimmer": 98,
  "preset-keys-reed": 20,
  "preset-strings-dulcimer": 15,
  "preset-strings-zither": 107,
  "preset-pads-air": 89,
  "preset-bass-1": 38, // THICK PULSE → Synth Bass 1
  "preset-bass-2": 39, // SUB TRI → Synth Bass 2
  "preset-bass-3": 38, // GLUE P25 → Synth Bass 1
  "preset-bass-4": 38, // DIRTY 12.5 → Synth Bass 1
  "preset-bass-5": 39, // ROUND TRI → Synth Bass 2
  "preset-bass-6": 38, // BITE P50 → Synth Bass 1
  "preset-bass-7": 34, // PLUCK LOW → Electric Bass (pick) — Karplus–Strong IS a picked string
  "preset-bass-8": 35, // DARK PLUCK → Fretless bass
  "preset-bass-9": 38, // TAPE DROP → Synth Bass 1
  "preset-bass-10": 39, // RISE P25 → Synth Bass 2
  "preset-bass-11": 39, // BREATH SUB → Synth Bass 2
  "preset-bass-12": 16, // HELD TRI → Drawbar Organ
  // PS-4 sample voices (recorded one-shots; pitch = degreeToMidi at the
  // preset's octaveBase — the same MIDI the audio playbackRate maps from
  // rootMidi, so exports match what you hear; GM hint-only as ever).
  "preset-bass-13": 38, // SUB DROP (sampled falling sweep) → Synth Bass 1
  // GM 0-based: 24 Nylon Guitar, 52 Choir Aahs, 61 Brass Section, 88 Pad 1
  // (new age), 89 Pad 2 (warm), 90 Pad 3 (polysynth), 91 Pad 4 (choir),
  // 92 Pad 5 (bowed), 98 FX 3 (crystal), 106 Koto
  "preset-chords-1": 89, // WARM PAD → Pad 2 (warm)
  "preset-chords-2": 88, // GLASS TRI → Pad 1 (new age)
  "preset-chords-3": 90, // SOFT P25 → Pad 3 (polysynth)
  "preset-chords-4": 98, // ARP PLUCK → FX 3 (crystal)
  "preset-chords-5": 89, // DUST PAD → Pad 2 (warm)
  "preset-chords-6": 91, // HOLLOW P25 → Pad 4 (choir)
  "preset-chords-7": 24, // NYLON STAB → Nylon Guitar
  "preset-chords-8": 106, // KOTO PAD → Koto
  "preset-chords-9": 61, // BRASS STAB → Brass Section
  "preset-chords-10": 52, // CHOIR TRI → Choir Aahs
  "preset-chords-11": 98, // SPARK 12.5 → FX 3 (crystal)
  "preset-chords-12": 92, // SWELL PAD → Pad 5 (bowed)
  // PS-4 sample voices (Kenney tonal one-shots, GM hint-only).
  "preset-chords-13": 88, // PURE TONE → Pad 1 (new age)
  "preset-chords-14": 90, // TWO TONE → Pad 3 (polysynth)
  "preset-chords-15": 91, // THREE TONE → Pad 4 (choir)
  // GM 0-based: 46 Orchestral Harp, 56 Trumpet, 73 Flute, 80 Lead 1 (square),
  // 81 Lead 2 (sawtooth), 82 Lead 3 (calliope), 85 Lead 6 (voice), 106 Koto
  "preset-lead-1": 80, // CUT P50 → Lead 1 (square)
  "preset-lead-2": 82, // BRIGHT TRI → Lead 3 (calliope)
  "preset-lead-3": 85, // VIBRA TRI → Lead 6 (voice)
  "preset-lead-4": 81, // NEEDLE 12.5 → Lead 2 (sawtooth)
  "preset-lead-5": 80, // SQUARE SOLO → Lead 1 (square)
  "preset-lead-6": 81, // GRIT LEAD → Lead 2 (sawtooth)
  "preset-lead-7": 106, // KOTO LEAD → Koto
  "preset-lead-8": 46, // HARP HIGH → Orchestral Harp
  "preset-lead-9": 81, // FALL P50 → Lead 2 (sawtooth)
  "preset-lead-10": 73, // AIR LEAD → Flute
  "preset-lead-11": 56, // SOFT HORN → Trumpet
  "preset-lead-12": 73, // FLUTE TRI → Flute
  // PS-4 sample voices (Kenney risers, GM hint-only).
  "preset-lead-13": 81, // PHASER UP (sampled riser) → Lead 2 (sawtooth)
  "preset-lead-14": 82, // HIGH SWEEP (sampled riser) → Lead 3 (calliope)
} as const;

/** Track names exported for importer UIs (schema lane order). */
export const TRACK_NAMES = {
  tempo: "TEMPO \u0026 CUES",
  drums: "DRUMS",
  bass: "BASS",
  chords: "CHORDS",
  lead: "LEAD",
  extra1: "INSTRUMENT 5",
  extra2: "INSTRUMENT 6",
  extra3: "INSTRUMENT 7",
  extra4: "INSTRUMENT 8",
} as const;

export const TRACK_COUNT = 5; // track 0 (tempo/cues) + 4 lanes

// ---------------------------------------------------------------------------
// Own typed event model (D6): notes at ticks, before any midi-file types
// ---------------------------------------------------------------------------

/** One note in our model: absolute tick, GM note, gate in ticks. */
export interface MidiNote {
  readonly tick: number;
  readonly noteNumber: number;
  readonly velocity: number;
  readonly durationTicks: number;
}

/** Absolute tick of a grid step, including the swing delay on odd steps. */
export function stepTick(step: number, swing = 0): number {
  const delay = step % 2 === 1 ? Math.round(swing * TICKS_PER_STEP) : 0;
  return step * TICKS_PER_STEP + delay;
}

/** Gate length in ticks (steps are exact; seconds round at the project BPM). */
export function gateTicks(gate: LaneGate, bpm: number): number {
  return gate.unit === "steps"
    ? Math.round(gate.value * TICKS_PER_STEP)
    : Math.round((gate.value * (PPQ * bpm)) / 60);
}

/**
 * SC-2: a v2 note length in ticks. Lengths live on the 0.25-step grid, so
 * length × TICKS_PER_STEP is always an integer; the max(1, …) guard keeps a
 * hypothetical zero/near-zero length round-tripping as a note.
 */
export function noteLengthTicks(length: number): number {
  return Math.max(1, Math.round(length * TICKS_PER_STEP));
}

/** Minimum one tick so a zero/near-zero gate still round-trips as a note. */
function gateDurationTicks(gate: LaneGate, bpm: number): number {
  return Math.max(1, gateTicks(gate, bpm));
}

/**
 * XP-1 (i3-5): the export cycle in steps — the LCM of the lanes' chain
 * totals through the SAME pure law the offline WAV render and the
 * transport's cycle basis use (render.ts computeLoopSteps over
 * laneCycleSteps; engineBridge's docCycleSteps is the identical derivation
 * — one LCM for one-shot, position, WAV and MIDI). Chain totals are
 * multiples of 16, so at the powers-of-two vocabulary the LCM is simply
 * the longest lane (I3-d: drums 64B + bass 4B + chords 8B → 1024 steps);
 * a degenerate all-empty document falls back to the constant 16.
 */
export function exportCycleSteps(doc: ProjectDocument): number {
  return computeLoopSteps(
    doc.lanes.map((l) => l.id).map((lane) => laneCycleSteps(doc, lane)),
  );
}

/**
 * XP-1 (i3-5): fill one lane's chain-walked notes to the FULL export cycle:
 * chain-local notes repeat at every k × chainSteps (exact tick offsets —
 * chain steps are multiples of 16, so iteration offsets are even steps and
 * the swing parity of pattern-local steps is preserved, the same law
 * render.ts expandLaneEventsForLoop applies to audio). `cycleSteps` is a
 * multiple of every lane's `chainSteps` by construction (both are LCM
 * inputs); a cycle equal to or below the chain, or an impossible non-multiple,
 * is the identity. Equal-chain documents therefore keep their exact bytes.
 */
export function repeatNotesToCycle(
  notes: readonly MidiNote[],
  chainSteps: number,
  cycleSteps: number,
): MidiNote[] {
  if (
    chainSteps <= 0 ||
    cycleSteps <= chainSteps ||
    cycleSteps % chainSteps !== 0
  ) {
    return [...notes];
  }
  const iterations = cycleSteps / chainSteps;
  const out: MidiNote[] = [...notes];
  for (let k = 1; k < iterations; k++) {
    const offset = k * chainSteps * TICKS_PER_STEP;
    for (const n of notes) out.push({ ...n, tick: n.tick + offset });
  }
  return out;
}

/** Drums lane → GM notes (piece identity maps directly; pattern walk). */
export function buildDrumNotes(
  chain: readonly Pattern[],
  gate: LaneGate,
  bpm: number,
  swing = 0,
): MidiNote[] {
  const notes: MidiNote[] = [];
  let cursor = 0;
  for (const pattern of chain) {
    if (pattern.kind !== "drums") {
      cursor += pattern.bars * 16 * TICKS_PER_STEP;
      continue;
    }
    const dur = gateDurationTicks(gate, bpm);
    // Fixed piece order (never Object.keys — the canonical codec key-sorts;
    // same-tick note order must be stable across a save/load round trip).
    for (const piece of DRUM_PIECES) {
      const steps = pattern.steps[piece];
      for (let step = 0; step < steps.length; step++) {
        if (!steps[step]) continue;
        notes.push({
          // Same uniform groove shift as pitched lanes (odd 16ths delayed).
          tick: cursor + stepTick(step, swing),
          noteNumber: GM_DRUM_NOTES[piece],
          velocity: GM_DRUM_VELOCITIES[piece],
          durationTicks: dur,
        });
      }
    }
    cursor += pattern.bars * 16 * TICKS_PER_STEP;
  }
  return notes;
}

/**
 * Pitched lane → GM notes. Same laws as compile.ts (SC-2): v2 note lengths are
 * the durations (exact on the 0.25-step grid — parse-back equality holds),
 * chords lane stacks [degree, degree+2, degree+4], pitch = degreeToMidi(
 * effective scale, note degree + offset, preset octave base). Notes on degrees
 * outside the pattern's row manifest are skipped, exactly like the compiler.
 * RC-1 (v3): the lane's `octave` register offset rides the SAME law — an
 * offset on the preset's octave base (exported pitch = heard pitch), with the
 * final note number clamped to 0..127 (the schema's consumer-side pitch law).
 */
export function buildPitchedNotes(
  doc: ProjectDocument,
  lane: Exclude<LaneId, "drums">,
  chain: readonly Pattern[],
  swing: number,
): MidiNote[] {
  const laneConf = doc.lanes.find((l) => l.id === lane);
  const presetId =
    laneConf && laneConf.id !== "drums" ? laneConf.presetId : undefined;
  const preset =
    (presetId !== undefined ? getPreset(presetId) : undefined) ??
    getPreset("preset-lead-1");
  const octaveBase =
    (preset?.pitchRange?.octaveBase ?? LANE_OCTAVE_FALLBACK[lane]) +
    ((laneConf && laneConf.id !== "drums" ? laneConf.octave : undefined) ?? 0);
  const scale = effectiveScale(doc, lane);
  const stack = lane === "chords" ? [0, 2, 4] : [0];
  const notes: MidiNote[] = [];
  let cursor = 0;
  for (const pattern of chain) {
    if (pattern.kind !== "pitched") {
      cursor += pattern.bars * 16 * TICKS_PER_STEP;
      continue;
    }
    const manifest = new Set(pattern.rowDegrees);
    for (const note of pattern.notes) {
      if (!manifest.has(note.degree)) continue;
      const durationTicks = noteLengthTicks(note.length);
      for (const off of stack) {
        notes.push({
          tick: cursor + stepTick(note.start, swing),
          noteNumber: Math.min(
            127,
            Math.max(0, degreeToMidi(scale, note.degree + off, octaveBase)),
          ),
          velocity: PITCHED_VELOCITY,
          durationTicks,
        });
      }
    }
    cursor += pattern.bars * 16 * TICKS_PER_STEP;
  }
  return notes;
}

/**
 * Cue markers (DES-6 free win): every non-null chainCues label at its slot's
 * chain-start tick, deduped across lanes (same tick + same text = one event).
 * XP-1 (i3-5): with `cycleSteps` (the export cycle), a lane's markers repeat
 * at its chain length within the cycle — the file renders exactly one full
 * LCM cycle, so a shorter lane's section labels recur on every chain
 * iteration, exactly as its notes do. Equal-chain docs: one iteration, the
 * previous bytes.
 */
export function buildCueMarkers(
  doc: ProjectDocument,
  cycleSteps?: number,
): { tick: number; text: string }[] {
  const cues = doc.chainCues;
  if (!cues) return [];
  const seen = new Set<string>();
  const out: { tick: number; text: string }[] = [];
  // Fixed lane order (LANE_IDS, not Object.keys — canonical key-sorting).
  for (const { id: lane } of doc.lanes) {
    const labels = cues[lane];
    if (!labels) continue;
    const chain = resolveChainPatterns(doc, lane);
    const chainSteps = laneCycleSteps(doc, lane);
    const iterations =
      cycleSteps !== undefined &&
      chainSteps > 0 &&
      cycleSteps > chainSteps &&
      cycleSteps % chainSteps === 0
        ? cycleSteps / chainSteps
        : 1;
    for (let slot = 0; slot < labels.length && slot < chain.length; slot++) {
      const label = labels[slot];
      if (!label) continue;
      let startStep = 0;
      for (let i = 0; i < slot; i++) startStep += chain[i].bars * 16;
      for (let k = 0; k < iterations; k++) {
        const tick = (startStep + k * chainSteps) * TICKS_PER_STEP;
        const key = `${tick}:${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ tick, text: label });
      }
    }
  }
  // Stable tick sort (ties keep schema lane order — insertion order — then
  // the dedupe above already collapsed identical tick+text pairs).
  out.sort((a, b) => a.tick - b.tick);
  return out;
}

// ---------------------------------------------------------------------------
// midi-file assembly
// ---------------------------------------------------------------------------

/** A track event before delta encoding: absolute tick + a zero-delta event. */
interface PendingEvent {
  readonly tick: number;
  readonly event: MidiEvent;
}

function deltaEncode(events: readonly PendingEvent[]): MidiEvent[] {
  const sorted = [...events].sort(
    (a, b) =>
      a.tick - b.tick ||
      orderOf(a.event) - orderOf(b.event) ||
      noteOf(a.event) - noteOf(b.event) ||
      velocityOf(a.event) - velocityOf(b.event),
  );
  const out: MidiEvent[] = [];
  let last = 0;
  for (const { tick, event } of sorted) {
    out.push({ ...event, deltaTime: tick - last });
    last = tick;
  }
  return out;
}

// noteOff sorts before noteOn at the same tick (retrigger safety).
function orderOf(e: MidiEvent): number {
  return e.type === "noteOff" ? 0 : 1;
}
function noteOf(e: MidiEvent): number {
  return e.type === "noteOn" ||
    e.type === "noteOff" ||
    e.type === "noteAftertouch"
    ? e.noteNumber
    : -1;
}
function velocityOf(e: MidiEvent): number {
  return e.type === "noteOn" ? e.velocity : -1;
}

/** Encoded tracks end with an explicit endOfTrack after the last event. */

/**
 * Build the full format-1 MidiData (own model → midi-file event lists).
 * Pure and deterministic; exported for the golden test.
 */
export function buildMidiData(doc: ProjectDocument, swing = 0): MidiData {
  const bpm = doc.transport.bpm;
  // XP-1 (i3-5): the whole file spans EXACTLY one export cycle.
  const cycleSteps = exportCycleSteps(doc);

  // --- Track 0: tempo map + 4/4 + cue markers ------------------------------
  const tempoUs = Math.round(60_000_000 / bpm);
  const track0 = deltaEncode([
    {
      tick: 0,
      event: {
        deltaTime: 0,
        type: "trackName",
        meta: true,
        text: TRACK_NAMES.tempo,
      },
    },
    {
      tick: 0,
      event: {
        deltaTime: 0,
        type: "timeSignature",
        meta: true,
        numerator: 4,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
      },
    },
    {
      tick: 0,
      event: {
        deltaTime: 0,
        type: "setTempo",
        meta: true,
        microsecondsPerBeat: tempoUs,
      },
    },
    ...buildCueMarkers(doc, cycleSteps).map((m) => ({
      tick: m.tick,
      event: {
        deltaTime: 0,
        type: "marker",
        meta: true,
        text: m.text,
      } as const,
    })),
  ]);
  const tempoTrack: MidiEvent[] = [
    ...track0,
    { deltaTime: 0, type: "endOfTrack", meta: true },
  ];

  // --- Lane tracks ----------------------------------------------------------
  const laneTracks: MidiEvent[][] = [];
  for (const laneConf of doc.lanes) {
    const lane = laneConf.id;
    const chain = resolveChainPatterns(doc, lane);
    // XP-1: the lane's notes fill the export cycle (identity for equal
    // chains — the zero-drift law).
    const laneSteps = laneCycleSteps(doc, lane);
    const events: PendingEvent[] = [
      {
        tick: 0,
        event: {
          deltaTime: 0,
          type: "trackName",
          meta: true,
          text: TRACK_NAMES[lane],
        },
      },
    ];
    if (lane === "drums") {
      // Drums: GM channel 9, no program change (channel 10 IS the program).
      const notes = repeatNotesToCycle(
        buildDrumNotes(chain, laneConf.gate, bpm, swing),
        laneSteps,
        cycleSteps,
      );
      for (const note of notes) {
        events.push({
          tick: note.tick,
          event: {
            deltaTime: 0,
            type: "noteOn",
            channel: DRUM_CHANNEL,
            noteNumber: note.noteNumber,
            velocity: note.velocity,
          },
        });
        events.push({
          tick: note.tick + note.durationTicks,
          event: {
            deltaTime: 0,
            type: "noteOff",
            channel: DRUM_CHANNEL,
            noteNumber: note.noteNumber,
            velocity: 0,
          },
        });
      }
    } else {
      const channel = LANE_CHANNELS[lane];
      const presetId = laneConf.presetId;
      const program = PRESET_GM_PROGRAMS[presetId];
      if (program !== undefined) {
        events.push({
          tick: 0,
          event: {
            deltaTime: 0,
            type: "programChange",
            channel,
            programNumber: program,
          },
        });
      }
      const pitched = repeatNotesToCycle(
        buildPitchedNotes(doc, lane, chain, swing),
        laneSteps,
        cycleSteps,
      );
      for (const note of pitched) {
        events.push({
          tick: note.tick,
          event: {
            deltaTime: 0,
            type: "noteOn",
            channel,
            noteNumber: note.noteNumber,
            velocity: note.velocity,
          },
        });
        events.push({
          tick: note.tick + note.durationTicks,
          event: {
            deltaTime: 0,
            type: "noteOff",
            channel,
            noteNumber: note.noteNumber,
            velocity: 0,
          },
        });
      }
    }
    laneTracks.push([
      ...deltaEncode(events),
      { deltaTime: 0, type: "endOfTrack", meta: true },
    ]);
  }

  return {
    header: { format: 1, numTracks: 1 + laneTracks.length, ticksPerBeat: PPQ },
    tracks: [tempoTrack, ...laneTracks],
  };
}

/** Deterministic SMF bytes of the project (pure; golden-pinned by HW-3). */
export function encodeMidi(doc: ProjectDocument): Uint8Array {
  return Uint8Array.from(writeMidi(buildMidiData(doc, doc.transport.swing)));
}

/**
 * Total note count across lane tracks (display + tests). XP-1: counts the
 * FILLED cycle — shorter chains repeat within the export LCM, so the toast's
 * count is exactly what the file carries (equal-chain docs unchanged).
 */
export function noteCount(doc: ProjectDocument): number {
  const cycleSteps = exportCycleSteps(doc);
  let n = 0;
  for (const laneConf of doc.lanes) {
    const chain = resolveChainPatterns(doc, laneConf.id);
    const laneSteps = laneCycleSteps(doc, laneConf.id);
    const notes =
      laneConf.id === "drums"
        ? buildDrumNotes(
            chain,
            laneConf.gate,
            doc.transport.bpm,
            doc.transport.swing,
          )
        : buildPitchedNotes(doc, laneConf.id, chain, doc.transport.swing);
    n += repeatNotesToCycle(notes, laneSteps, cycleSteps).length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Download (typed result, never throws — mirrors exportWav)
// ---------------------------------------------------------------------------

export interface ExportMidiSuccess {
  readonly ok: true;
  readonly filename: string;
  /** Always 5: tempo/cue track + 4 lanes. */
  readonly trackCount: number;
  readonly noteCount: number;
  /**
   * XP-1 (i3-5): bars in the export cycle (exportCycleSteps / 16) — the
   * same LCM cycle the WAV render exports. Display (toast) + assertions.
   */
  readonly bars: number;
  readonly byteLength: number;
}

export interface ExportMidiFailure {
  readonly ok: false;
  readonly kind: "encode";
  readonly message: string;
  readonly suggestion: string;
}

export type ExportMidiResult = ExportMidiSuccess | ExportMidiFailure;

export interface ExportMidiOptions {
  /** Download seam (unit tests capture the Blob). */
  readonly seam?: DownloadSeam;
}

/** Export the project as a format-1 SMF download. Returns a typed result. */
export function exportMidi(
  project: ProjectDocument,
  opts: ExportMidiOptions = {},
): ExportMidiResult {
  let bytes: Uint8Array;
  try {
    bytes = encodeMidi(project);
  } catch {
    return {
      ok: false,
      kind: "encode",
      message: "MIDI could not be encoded.",
      suggestion: "The project is untouched — try exporting again.",
    };
  }
  const seam = opts.seam ?? defaultSeam();
  const filename = `${safeFileStem(project.name)}${MIDI_EXTENSION}`;
  const blob = new Blob([bytes.slice()], { type: MIDI_MIME });
  const url = seam.createObjectURL(blob);
  try {
    const anchor = seam.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    seam.revokeObjectURL(url);
  }
  return {
    ok: true,
    filename,
    trackCount: TRACK_COUNT,
    noteCount: noteCount(project),
    bars: exportCycleSteps(project) / 16,
    byteLength: bytes.byteLength,
  };
}

function defaultSeam(): DownloadSeam {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createElement: (tag) =>
      document.createElement(tag as "a") as HTMLAnchorElement,
  };
}
