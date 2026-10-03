import * as v from "valibot";
import {
  DRUM_PIECES,
  LaneIdSchema,
  NoteSchema,
  type Pattern,
  type ProjectDocument,
} from "../document/schema";
import { FxDeviceSchema } from "../document/fx";
import { validateAgentDocument } from "./documentValidation";

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const bars = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(128));
const address = { lane: LaneIdSchema, patternId: id };
const named = {
  ...address,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
};
const slot = v.strictObject({
  patternId: id,
  cue: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(12))), null),
  mode: v.optional(v.picklist(["next", "loop"]), "next"),
});
export const editOperationsSchema = v.pipe(
  v.array(
    v.variant("action", [
      v.strictObject({ action: v.literal("create_pattern"), ...named, bars }),
      v.strictObject({
        action: v.literal("duplicate_pattern"),
        ...address,
        newPatternId: id,
        name: named.name,
      }),
      v.strictObject({ action: v.literal("rename_pattern"), ...named }),
      v.strictObject({ action: v.literal("resize_pattern"), ...address, bars }),
      v.strictObject({ action: v.literal("delete_pattern"), ...address }),
      v.strictObject({
        action: v.literal("set_notes"),
        ...address,
        notes: v.pipe(v.array(NoteSchema), v.maxLength(4096)),
      }),
      v.strictObject({
        action: v.literal("set_drum_rows"),
        ...address,
        drumRows: v.strictObject(
          Object.fromEntries(
            DRUM_PIECES.map((piece) => [
              piece,
              v.optional(v.pipe(v.array(v.boolean()), v.maxLength(2048))),
            ]),
          ),
        ),
      }),
      v.strictObject({
        action: v.literal("set_chain"),
        lane: LaneIdSchema,
        slots: v.pipe(v.array(slot), v.minLength(1), v.maxLength(512)),
      }),
      v.strictObject({
        action: v.literal("set_fx_chain"),
        lane: LaneIdSchema,
        devices: v.pipe(v.array(FxDeviceSchema), v.maxLength(3)),
      }),
    ]),
  ),
  v.minLength(1),
  v.maxLength(64),
);

const str = { type: "string", minLength: 1, maxLength: 200 };
const lane = { type: "string", enum: LaneIdSchema.options };
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const jsonAddress = { lane, patternId: str };
const note = obj({
  degree: { type: "integer", minimum: -128, maximum: 128 },
  start: { type: "integer", minimum: 0, maximum: 2047 },
  length: { type: "number", minimum: 0.25, maximum: 2048, multipleOf: 0.25 },
});
const size = { type: "integer", minimum: 1, maximum: 128 };
// Effects are checked against the shared discriminated runtime schema and document validator.
const device = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["filter", "drive", "bitcrusher", "delay", "reverb"],
    },
    bypassed: { type: "boolean" },
    params: { type: "object" },
  },
  required: ["type", "bypassed", "params"],
  additionalProperties: false,
};
const action = (name: string, properties: Record<string, unknown>) =>
  obj({ action: { const: name, type: "string" }, ...properties });
export const editOperationsJson = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: {
    oneOf: [
      action("create_pattern", { ...jsonAddress, name: str, bars: size }),
      action("duplicate_pattern", {
        ...jsonAddress,
        newPatternId: str,
        name: str,
      }),
      action("rename_pattern", { ...jsonAddress, name: str }),
      action("resize_pattern", { ...jsonAddress, bars: size }),
      action("delete_pattern", jsonAddress),
      action("set_notes", {
        ...jsonAddress,
        notes: { type: "array", maxItems: 4096, items: note },
      }),
      action("set_drum_rows", {
        ...jsonAddress,
        drumRows: obj(
          Object.fromEntries(
            DRUM_PIECES.map((piece) => [
              piece,
              { type: "array", maxItems: 2048, items: { type: "boolean" } },
            ]),
          ),
          [],
        ),
      }),
      action("set_chain", {
        lane,
        slots: {
          type: "array",
          minItems: 1,
          maxItems: 512,
          items: obj(
            {
              patternId: str,
              cue: { type: ["string", "null"], maxLength: 12 },
              mode: { type: "string", enum: ["next", "loop"] },
            },
            ["patternId"],
          ),
        },
      }),
      action("set_fx_chain", {
        lane,
        devices: { type: "array", maxItems: 3, items: device },
      }),
    ],
  },
};

function resize(pattern: Pattern, bars: number): Pattern {
  if (pattern.bars === bars) return pattern;
  const length = bars * 16;
  if (pattern.kind === "pitched") {
    const all = [...pattern.notes, ...(pattern.overflow ?? [])].sort(
      (a, b) => a.degree - b.degree || a.start - b.start,
    );
    const { overflow: _overflow, ...rest } = pattern;
    void _overflow;
    const overflow = all.filter((n) => n.start >= length);
    return {
      ...rest,
      bars,
      notes: all.filter((n) => n.start < length),
      ...(overflow.length ? { overflow } : {}),
    };
  }
  const { overflow: _overflow, ...rest } = pattern;
  void _overflow;
  const steps = { ...pattern.steps };
  const overflow: Partial<Record<(typeof DRUM_PIECES)[number], boolean[]>> = {};
  for (const piece of DRUM_PIECES) {
    const all = [...pattern.steps[piece], ...(pattern.overflow?.[piece] ?? [])];
    steps[piece] = Array.from({ length }, (_, i) => all[i] ?? false);
    const tail = all.slice(length);
    while (tail.length && !tail[tail.length - 1]) tail.pop();
    if (tail.length) overflow[piece] = tail;
  }
  return {
    ...rest,
    bars,
    steps,
    ...(Object.keys(overflow).length ? { overflow } : {}),
  };
}

/** Construct the entire draft without any store writes; intermediate chain states may be incomplete. */
export function editProject(
  before: ProjectDocument,
  input: unknown,
): ProjectDocument {
  if (JSON.stringify(input)?.length > 10 * 1024 * 1024)
    throw new Error("operations: exceeds the 10 MB editing limit.");
  const operations = v.parse(editOperationsSchema, input);
  let doc = before;
  for (const [index, op] of operations.entries()) {
    try {
      if (!doc.lanes.some((l) => l.id === op.lane))
        throw new Error("Lane is not present.");
      const patterns = doc.patterns[op.lane]!;
      const unique = (id: string) => {
        if (
          Object.values(doc.patterns).some((ps) => ps.some((p) => p.id === id))
        )
          throw new Error("New pattern ID already exists.");
      };
      if (op.action === "set_fx_chain") {
        doc = {
          ...doc,
          lanes: doc.lanes.map((l) =>
            l.id === op.lane ? { ...l, fxChain: op.devices } : l,
          ),
        };
        continue;
      }
      if (op.action === "set_chain") {
        if (doc.playbackRules?.[op.lane]?.some(Boolean))
          throw new Error(
            "This chain has playback rules. Use apply_document to reconcile its rules explicitly.",
          );
        doc = {
          ...doc,
          songChain: {
            ...doc.songChain,
            [op.lane]: op.slots.map((s) => s.patternId),
          },
          chainCues: {
            drums: doc.songChain.drums.map(() => null),
            bass: doc.songChain.bass.map(() => null),
            chords: doc.songChain.chords.map(() => null),
            lead: doc.songChain.lead.map(() => null),
            ...doc.chainCues,
            [op.lane]: op.slots.map((s) => s.cue),
          },
          chainModes: {
            drums: doc.songChain.drums.map(() => "next" as const),
            bass: doc.songChain.bass.map(() => "next" as const),
            chords: doc.songChain.chords.map(() => "next" as const),
            lead: doc.songChain.lead.map(() => "next" as const),
            ...doc.chainModes,
            [op.lane]: op.slots.map((s) => s.mode),
          },
          ...(doc.playbackRules?.[op.lane]
            ? {
                playbackRules: {
                  ...doc.playbackRules,
                  [op.lane]: op.slots.map(() => null),
                },
              }
            : {}),
        };
        continue;
      }
      if (op.action === "create_pattern") {
        unique(op.patternId);
        const pattern: Pattern =
          op.lane === "drums"
            ? {
                kind: "drums",
                id: op.patternId,
                name: op.name,
                bars: op.bars,
                steps: Object.fromEntries(
                  DRUM_PIECES.map((piece) => [
                    piece,
                    Array<boolean>(op.bars * 16).fill(false),
                  ]),
                ) as Record<(typeof DRUM_PIECES)[number], boolean[]>,
              }
            : {
                kind: "pitched",
                id: op.patternId,
                name: op.name,
                bars: op.bars,
                notes: [],
                rowDegrees: [],
              };
        doc = {
          ...doc,
          patterns: { ...doc.patterns, [op.lane]: [...patterns, pattern] },
        };
        continue;
      }
      const pattern = patterns.find((p) => p.id === op.patternId);
      if (!pattern)
        throw new Error("Pattern not found. Read get_project for current IDs.");
      if (op.action === "delete_pattern") {
        if (patterns.length === 1)
          throw new Error("Cannot delete the lane's last pattern.");
        if (doc.songChain[op.lane]!.includes(op.patternId))
          throw new Error(
            "Remove this pattern from its chain before deleting it.",
          );
        doc = {
          ...doc,
          patterns: {
            ...doc.patterns,
            [op.lane]: patterns.filter((p) => p !== pattern),
          },
        };
        continue;
      }
      if (op.action === "duplicate_pattern") {
        unique(op.newPatternId);
        doc = {
          ...doc,
          patterns: {
            ...doc.patterns,
            [op.lane]: [
              ...patterns,
              {
                ...structuredClone(pattern),
                id: op.newPatternId,
                name: op.name,
              },
            ],
          },
        };
        continue;
      }
      let next: Pattern;
      if (op.action === "rename_pattern") next = { ...pattern, name: op.name };
      else if (op.action === "resize_pattern") next = resize(pattern, op.bars);
      else if (op.action === "set_notes") {
        if (pattern.kind !== "pitched")
          throw new Error("set_notes requires a pitched pattern.");
        const notes = [...op.notes].sort(
          (a, b) => a.degree - b.degree || a.start - b.start,
        );
        next = {
          ...pattern,
          notes,
          rowDegrees: [
            ...new Set([...pattern.rowDegrees, ...notes.map((n) => n.degree)]),
          ].sort((a, b) => a - b),
        };
      } else {
        if (pattern.kind !== "drums")
          throw new Error("set_drum_rows requires a drum pattern.");
        const rows = Object.entries(op.drumRows).filter(
          (entry): entry is [string, boolean[]] => entry[1] !== undefined,
        );
        if (rows.some(([, row]) => row.length !== pattern.bars * 16))
          throw new Error(
            `Each drum row must have exactly ${pattern.bars * 16} steps.`,
          );
        next = {
          ...pattern,
          steps: { ...pattern.steps, ...Object.fromEntries(rows) },
        };
      }
      doc = {
        ...doc,
        patterns: {
          ...doc.patterns,
          [op.lane]: patterns.map((p) => (p === pattern ? next : p)),
        },
      };
    } catch (error) {
      throw new Error(
        `operations.${index}: ${error instanceof Error ? error.message : "Invalid musical operation."}`,
        { cause: error },
      );
    }
  }
  return validateAgentDocument(doc);
}
