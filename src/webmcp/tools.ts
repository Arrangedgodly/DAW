import * as v from "valibot";
import { DRUM_KITS, PRESET_LIBRARY } from "../audio/presets";
import { soundFamily } from "../components/laneMeta";
import { MAX_BPM, MIN_BPM, STEPS_PER_BAR } from "../audio/time";
import { ProjectValidationError } from "../document/validate";
import {
  documentDiagnostics,
  documentErrorMessage,
  validateAgentDocument,
} from "./documentValidation";
import { pitchDomain } from "../document/pitchWindow";
import { MODE_INTERVALS } from "../document/scales";
import {
  FX_DEVICE_SPECS,
  FX_DEVICE_TYPES,
  defaultFxDevice,
} from "../state/fxStrip";
import {
  ALL_LANE_IDS,
  CUE_MAX_CHARS,
  DRUM_PIECES,
  LaneIdSchema,
  NoteSchema,
  effectiveLaneMix,
  type LaneId,
  type ProjectDocument,
} from "../document/schema";
import { commitDocumentEdit, docStore } from "../state/store";

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
  execute: (
    input: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const laneJson = { type: "string", enum: ALL_LANE_IDS };
const revisionJson = { type: "integer", minimum: 0 };
const stringJson = { type: "string", minLength: 1, maxLength: 200 };
const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const idSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const emptySchema = v.strictObject({});
const patternAddress = { lane: LaneIdSchema, patternId: idSchema };
const patternAddressJson = { lane: laneJson, patternId: stringJson };
const mixSchema = v.strictObject({
  volume: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  mute: v.optional(v.boolean()),
  solo: v.optional(v.boolean()),
});

/** Session-scoped revision changes on every store write, including human edits. */
export function createAgentTools(
  allowed: () => boolean,
  edited: (message: string, before: ProjectDocument) => void = () => {},
) {
  let revision = 0;
  const unsubscribe = docStore.subscribe((state, previous) => {
    if (state.doc !== previous.doc) revision++;
  });
  const snapshot = () => ({ revision, doc: docStore.getState().doc });
  function current(expected: number) {
    if (expected !== revision)
      throw new Error(
        "Project changed. Call bitbounce_get_project again before editing.",
      );
    return docStore.getState().doc;
  }
  function laneOf(doc: ProjectDocument, lane: LaneId) {
    const found = doc.lanes.find((item) => item.id === lane);
    if (!found) throw new Error("Lane is not present in this project.");
    return found;
  }
  function patternOf(doc: ProjectDocument, lane: LaneId, id: string) {
    laneOf(doc, lane);
    const found = doc.patterns[lane]?.find((item) => item.id === id);
    if (!found)
      throw new Error(
        "Pattern not found in this lane. Read the project for current IDs.",
      );
    return found;
  }
  function write(
    before: ProjectDocument,
    next: ProjectDocument,
    message: string,
  ) {
    commitDocumentEdit(before, next);
    const changed = before !== docStore.getState().doc;
    if (changed) edited(message, before);
    return {
      revision,
      changed,
      message: changed ? message : "Already set; no change.",
    };
  }
  function tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    readOnly: boolean,
    run: (input: unknown) => unknown,
  ): AgentTool {
    return {
      name: `bitbounce_${name}`,
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
      async execute(input, options) {
        if (!allowed())
          throw new Error(
            "Agent access is off. The user can enable it in Projects.",
          );
        options?.signal?.throwIfAborted();
        try {
          return structuredClone(run(input));
        } catch (error) {
          if (error instanceof ProjectValidationError)
            throw new Error(documentErrorMessage(error), { cause: error });
          throw error;
        }
      },
    };
  }
  const tools = [
    tool(
      "get_project",
      "Read the open Bitbounce project, current revision, lanes and pattern IDs. Read before editing. No saved-project library or audio is returned. Positions use zero-based sixteenth-note steps, 16 per bar; pitched degrees are scale-relative, not MIDI notes.",
      object({}),
      true,
      (input) => {
        v.parse(emptySchema, input);
        const { doc, revision } = snapshot();
        return {
          revision,
          name: doc.name,
          transport: doc.transport,
          scale: doc.scale,
          laneOverrides: doc.laneOverrides,
          lanes: doc.lanes.map((lane) => ({
            ...lane,
            mix: effectiveLaneMix(lane),
            patterns: (doc.patterns[lane.id] ?? []).map((pattern) => ({
              id: pattern.id,
              name: pattern.name,
              kind: pattern.kind,
              bars: pattern.bars,
            })),
          })),
          songChain: doc.songChain,
          chainModes: doc.chainModes,
          chainCues: doc.chainCues,
          units: { stepsPerBar: STEPS_PER_BAR, noteLengthQuantum: 0.25 },
        };
      },
    ),
    tool(
      "list_sounds",
      "List built-in sound IDs and names. Drum kits apply only to drums; pitched presets apply to every other active lane.",
      object({}),
      true,
      (input) => {
        v.parse(emptySchema, input);
        const names = (items: { id: string; name: string }[]) =>
          items.map(({ id, name }) => ({ id, name }));
        return {
          kits: names(Object.values(DRUM_KITS)),
          drumPieces: DRUM_PIECES,
          presets: Object.values(PRESET_LIBRARY)
            .filter((p) => p.pitchRange)
            .map((p) => ({
              id: p.id,
              name: p.name,
              category: soundFamily(p.id),
              octaveBase: p.pitchRange!.octaveBase,
              ...(p.rootMidi !== undefined ? { rootMidi: p.rootMidi } : {}),
            })),
        };
      },
    ),
    tool(
      "get_pattern",
      "Read one pattern's notes or drum steps before replacing its content. IDs come from get_project. Pitched note degrees refer to the lane's effective scale; start is a zero-based step, length is measured in steps.",
      object(patternAddressJson),
      true,
      (input) => {
        const args = v.parse(v.strictObject(patternAddress), input);
        const doc = docStore.getState().doc;
        return {
          revision,
          pattern: patternOf(doc, args.lane, args.patternId),
          allowedDegrees:
            args.lane === "drums"
              ? undefined
              : pitchDomain(doc, args.lane).degrees,
        };
      },
    ),
    tool(
      "set_tempo",
      "Set project BPM, keeping notes at their musical positions. One undoable edit. Requires the latest revision.",
      object({
        revision: revisionJson,
        bpm: { type: "number", minimum: MIN_BPM, maximum: MAX_BPM },
      }),
      false,
      (input) => {
        const args = v.parse(
          v.strictObject({
            revision: revisionSchema,
            bpm: v.pipe(v.number(), v.minValue(MIN_BPM), v.maxValue(MAX_BPM)),
          }),
          input,
        );
        const before = current(args.revision);
        return write(
          before,
          { ...before, transport: { ...before.transport, bpm: args.bpm } },
          `Agent set tempo to ${args.bpm} BPM. Undo is available.`,
        );
      },
    ),
    tool(
      "set_lane",
      "Set an active lane's sound and/or mix in one undoable edit. Use list_sounds for soundId. Omitted fields stay unchanged; volume is linear gain 0 to 1. Requires the latest revision.",
      object(
        {
          revision: revisionJson,
          lane: laneJson,
          soundId: stringJson,
          mix: object(
            {
              volume: { type: "number", minimum: 0, maximum: 1 },
              mute: { type: "boolean" },
              solo: { type: "boolean" },
            },
            [],
          ),
        },
        ["revision", "lane"],
      ),
      false,
      (input) => {
        const args = v.parse(
          v.strictObject({
            revision: revisionSchema,
            lane: LaneIdSchema,
            soundId: v.optional(idSchema),
            mix: v.optional(mixSchema),
          }),
          input,
        );
        const before = current(args.revision);
        const lane = laneOf(before, args.lane);
        if (
          args.soundId &&
          !(args.lane === "drums"
            ? Object.values(DRUM_KITS).some((p) => p.id === args.soundId)
            : Object.values(PRESET_LIBRARY).some(
                (p) => p.id === args.soundId && p.pitchRange,
              ))
        ) {
          throw new Error(
            "Unknown or incompatible sound. Call bitbounce_list_sounds for valid IDs.",
          );
        }
        const nextLane = {
          ...lane,
          ...args.mix,
          ...(args.soundId
            ? lane.id === "drums"
              ? { kitId: args.soundId }
              : { presetId: args.soundId }
            : {}),
        };
        if (nextLane.volume === 1) delete nextLane.volume;
        if (nextLane.mute === false) delete nextLane.mute;
        if (nextLane.solo === false) delete nextLane.solo;
        return write(
          before,
          {
            ...before,
            lanes: before.lanes.map((item) =>
              item.id === lane.id ? nextLane : item,
            ),
          },
          `Agent updated ${lane.id} sound or mix. Undo is available.`,
        );
      },
    ),
    tool(
      "set_pattern",
      "Replace the notes of one pitched pattern OR selected drum rows. Read get_pattern first and retain notes you want to keep. An empty notes array clears that pitched pattern. Each supplied drum row replaces that entire row; omitted rows stay unchanged. Pattern length and arrangement stay unchanged. One undoable edit; requires latest revision.",
      object(
        {
          revision: revisionJson,
          ...patternAddressJson,
          notes: {
            type: "array",
            maxItems: 4096,
            items: object({
              degree: { type: "integer" },
              start: { type: "integer", minimum: 0, maximum: 2047 },
              length: {
                type: "number",
                minimum: 0.25,
                maximum: 2048,
                multipleOf: 0.25,
              },
            }),
          },
          drumRows: object(
            Object.fromEntries(
              DRUM_PIECES.map((piece) => [
                piece,
                { type: "array", maxItems: 2048, items: { type: "boolean" } },
              ]),
            ),
            [],
          ),
        },
        ["revision", "lane", "patternId"],
      ),
      false,
      (input) => {
        const args = v.parse(
          v.strictObject({
            revision: revisionSchema,
            ...patternAddress,
            notes: v.optional(v.pipe(v.array(NoteSchema), v.maxLength(4096))),
            drumRows: v.optional(
              v.strictObject(
                Object.fromEntries(
                  DRUM_PIECES.map((piece) => [
                    piece,
                    v.optional(v.pipe(v.array(v.boolean()), v.maxLength(2048))),
                  ]),
                ),
              ),
            ),
          }),
          input,
        );
        const before = current(args.revision);
        const pattern = patternOf(before, args.lane, args.patternId);
        if (pattern.kind === "pitched") {
          if (!args.notes || args.drumRows !== undefined)
            throw new Error(
              "Pitched patterns require notes and do not accept drumRows.",
            );
          const sorted = [...args.notes].sort(
            (a, b) => a.degree - b.degree || a.start - b.start,
          );
          if (
            sorted.some(
              (note, index) =>
                index > 0 &&
                sorted[index - 1].degree === note.degree &&
                sorted[index - 1].start + sorted[index - 1].length > note.start,
            )
          )
            throw new Error("Notes in the same degree must not overlap.");
          const domain = pitchDomain(
            before,
            args.lane as Exclude<LaneId, "drums">,
          ).degrees;
          if (sorted.some((note) => !domain.includes(note.degree)))
            throw new Error(
              "Note degree is outside this instrument's pitch range. Read get_pattern for allowedDegrees.",
            );
          const replacement = {
            ...pattern,
            notes: sorted,
            rowDegrees: [
              ...new Set([
                ...pattern.rowDegrees,
                ...sorted.map((note) => note.degree),
              ]),
            ].sort((a, b) => a - b),
          };
          return write(
            before,
            {
              ...before,
              patterns: {
                ...before.patterns,
                [args.lane]: before.patterns[args.lane]!.map((p) =>
                  p.id === pattern.id ? replacement : p,
                ),
              },
            },
            `Agent updated ${args.lane} pattern ${pattern.name}. Undo is available.`,
          );
        }
        if (!args.drumRows || args.notes !== undefined)
          throw new Error(
            "Drum patterns require drumRows and do not accept notes.",
          );
        const rows = Object.entries(args.drumRows).filter(
          (entry): entry is [string, boolean[]] => entry[1] !== undefined,
        );
        if (
          rows.some(
            ([, steps]) => steps.length !== pattern.bars * STEPS_PER_BAR,
          )
        )
          throw new Error(
            `Each drum row must have exactly ${pattern.bars * STEPS_PER_BAR} steps.`,
          );
        const replacement = {
          ...pattern,
          steps: { ...pattern.steps, ...Object.fromEntries(rows) },
        };
        return write(
          before,
          {
            ...before,
            patterns: {
              ...before.patterns,
              drums: before.patterns.drums.map((p) =>
                p.id === pattern.id ? replacement : p,
              ),
            },
          },
          `Agent updated drums pattern ${pattern.name}. Undo is available.`,
        );
      },
    ),
  ];
  tools.push(
    tool(
      "get_document",
      "Read the complete open project for structural editing with apply_document. Includes all active instruments, effects, patterns, scale settings and arrangement. Does not read other saved projects.",
      object({}),
      true,
      (input) => {
        v.parse(emptySchema, input);
        return {
          ...snapshot(),
          modes: Object.keys(MODE_INTERVALS),
          effects: FX_DEVICE_TYPES.map((type) => ({
            type,
            defaults: defaultFxDevice(type),
            controls: FX_DEVICE_SPECS[type],
          })),
          documentRules: {
            chainCues: {
              maxLength: CUE_MAX_CHARS,
              trim: true,
              emptyValue: null,
              example: "VERSE 1",
            },
            laneMix: {
              location: "document.lanes[index]",
              example: { volume: 0.8, mute: false, solo: false },
              nestedMixAllowed: false,
            },
            preflight: "bitbounce_validate_document",
          },
          editing: `Edit this response's doc, not the get_project summary. Keep version and all unrelated fields. Required lanes: drums, bass, chords, lead. Optional pitched lanes: extra1 through extra4. Lane IDs must match pattern and songChain keys. Each lane needs at least one pattern and a nonempty chain of existing pattern IDs. Pattern bars: any whole number from 1 to 128. Drum rows have exactly bars*16 booleans. Pitched notes are {degree,start,length}; start is an integer step and length is a multiple of 0.25; include each degree in rowDegrees. FX chains have at most 3 devices. chainModes entries are next or loop; chainCues are null or per-slot labels of at most ${CUE_MAX_CHARS} characters after trimming. Keep longer section names in pattern.name. Lane volume, mute and solo are top-level lane fields, NOT a nested mix object. Use list_sounds for valid sound IDs. Octave offsets are integers -3 to 3. Scale roots are pitch classes 0=C through 11=B. Swing is 0 to 1. Do not edit sampleProvenance; it is maintained automatically. Call bitbounce_validate_document with the edited document before apply_document; fix reported paths and use the latest revision.`,
        };
      },
    ),
    tool(
      "validate_document",
      `Check a complete document before apply_document without changing the project, revision, undo history or edit destination. Returns valid, field-specific issues and the current revision. Use get_document.doc as the starting point. Cue labels are at most ${CUE_MAX_CHARS} characters; lane volume/mute/solo are top-level fields. A successful check does not reserve the revision or confirm edit permission.`,
      object({
        document: {
          type: "object",
          description:
            "Complete edited get_document.doc to validate without applying.",
        },
      }),
      true,
      (input) => {
        const args = v.parse(v.strictObject({ document: v.unknown() }), input);
        try {
          validateAgentDocument(args.document);
          return {
            valid: true,
            revision,
            issueCount: 0,
            issues: [],
            truncated: false,
          };
        } catch (error) {
          if (error instanceof ProjectValidationError)
            return { ...documentDiagnostics(error), revision };
          throw error;
        }
      },
    ),
    tool(
      "apply_document",
      `Apply a complete edited project in ONE undo step. Enables full musical editing: add/remove optional instruments, create/duplicate/delete/resize patterns, arrange chains and cues, configure all effects, scales, octave, gate, swing, metronome, mix and project name. First read get_document and check edits with validate_document; preserve unrelated fields. Cue labels have at most ${CUE_MAX_CHARS} characters. Lane volume/mute/solo belong directly on each lane, not in mix. This replaces the open project's musical content, never the saved-project library. Requires latest revision. User can restore the pre-agent checkpoint.`,
      object({
        revision: revisionJson,
        document: {
          type: "object",
          description: `Complete version-3 get_document.doc, with desired edits. Validate first with bitbounce_validate_document. chainCues labels: max ${CUE_MAX_CHARS} characters after trim, or null. Lane volume/mute/solo are top-level fields, not nested mix. Unknown keys are rejected.`,
        },
      }),
      false,
      (input) => {
        const args = v.parse(
          v.strictObject({ revision: revisionSchema, document: v.unknown() }),
          input,
        );
        const before = current(args.revision);
        const next = validateAgentDocument(args.document);
        return write(
          before,
          next,
          "Agent updated the project. Undo or Restore before agent is available.",
        );
      },
    ),
  );
  return { tools, dispose: unsubscribe, revision: () => revision };
}
