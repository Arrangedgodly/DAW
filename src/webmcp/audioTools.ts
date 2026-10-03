import * as v from "valibot";
import { docStore } from "../state/store";
import {
  measureStereo,
  measureArrangementContext,
  proposeAutoMix,
  type AudioStats,
} from "../audio/autoMix";
import type { LaneId, ProjectDocument } from "../document/schema";
import { validateAgentDocument } from "./documentValidation";
import type { AgentTool } from "./tools";

const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const duration = v.optional(
  v.pipe(v.number(), v.minValue(1), v.maxValue(180)),
  60,
);
const optionsSchema = v.strictObject({
  amount: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.5),
  balance: v.optional(v.boolean(), true),
  eq: v.optional(v.boolean(), true),
  dynamics: v.optional(v.boolean(), true),
});
const common = { revision: revisionSchema, maxDurationSeconds: duration };
const commonJson = {
  revision: { type: "integer", minimum: 0 },
  maxDurationSeconds: {
    type: "number",
    minimum: 1,
    maximum: 180,
    description:
      "Reject arrangements longer than this bound including release/FX tails. Default 60 seconds; maximum 180. Analysis covers the complete finite linear arrangement, never a silently truncated excerpt.",
  },
};
const measurement = {
  peak: "linear sample peak, not true peak",
  activeDb: "dBFS RMS of active windows, not LUFS",
  crest: "sample peak dB minus active RMS dB",
  lowMidRatio: "approximate low-mid energy ratio",
  overlap: "fraction of a lane's active energy coinciding with each other lane",
};

export function createAudioTools(
  allowed: () => boolean,
  revision: () => number,
  savePreview: (before: ProjectDocument, next: ProjectDocument) => unknown,
): AgentTool[] {
  let busy = false;
  const check = (signal?: AbortSignal) => {
    if (!allowed()) throw new Error("Agent access is off.");
    signal?.throwIfAborted();
  };
  return [false, true].map((propose) => ({
    name: propose ? "bitbounce_propose_mix" : "bitbounce_analyze_audio",
    description: `${propose ? "Measure audio and propose conservative mix changes, with a previewId for separate apply_preview. Does not apply the proposal." : "Measure the current arrangement and stereo lane stems without changing project or playback."} Uses local offline rendering, bounded to 60 seconds by default and at most 180. Turn off Solo first. Returns sample peak, active RMS, crest, low-mid energy and arrangement overlap, NOT LUFS or true peak. Requires latest revision. Cancellation prevents results and proposals; an already-started native offline render may finish internally. Measurements do not establish musical preference.`,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        ...commonJson,
        ...(propose
          ? {
              options: {
                type: "object",
                properties: {
                  amount: { type: "number", minimum: 0, maximum: 1 },
                  balance: { type: "boolean" },
                  eq: { type: "boolean" },
                  dynamics: { type: "boolean" },
                },
                additionalProperties: false,
              },
            }
          : {}),
      },
      required: ["revision"],
      additionalProperties: false,
    },
    async execute(input, execution) {
      check(execution?.signal);
      const args = propose
        ? v.parse(
            v.strictObject({ ...common, options: v.optional(optionsSchema) }),
            input,
          )
        : v.parse(v.strictObject(common), input);
      if (args.revision !== revision())
        throw new Error(
          "Project changed. Read the project again before analysis.",
        );
      if (busy)
        throw new Error(
          "Another audio analysis is running. Wait for it to finish.",
        );
      const before = docStore.getState().doc;
      if (before.lanes.some((l) => l.solo))
        throw new Error("Turn off Solo before analyzing the full mix.");
      const assertCurrent = () => {
        check(execution?.signal);
        if (docStore.getState().doc !== before || revision() !== args.revision)
          throw new Error(
            "Project changed during analysis. Read the project and analyze again.",
          );
      };
      busy = true;
      try {
        const { renderProjectToBuffer } = await import("../audio/render");
        assertCurrent();
        const rendered = await renderProjectToBuffer(before, {
          arrangement: "linear",
          stereoLaneStems: true,
          maxDurationSeconds: args.maxDurationSeconds,
          maxOutputDurationSeconds: args.maxDurationSeconds,
        });
        assertCurrent();
        if (
          !rendered.stereoLaneStems ||
          rendered.stereoLaneStems.length !== before.lanes.length
        )
          throw new Error(
            "Audio renderer did not return the requested lane stems.",
          );
        const lanes: Partial<Record<LaneId, AudioStats>> = {};
        before.lanes.forEach((lane, i) => {
          lanes[lane.id] = measureStereo(
            rendered.stereoLaneStems![i],
            rendered.sampleRate,
          );
        });
        const context = measureArrangementContext(
          rendered.stereoLaneStems,
          before.lanes.map((l) => l.id),
          rendered.channels,
          rendered.sampleRate,
        );
        const result = {
          revision: revision(),
          arrangement: "linear",
          sampleRate: rendered.sampleRate,
          durationSeconds: rendered.channels[0].length / rendered.sampleRate,
          units: measurement,
          lanes,
          master: context.master,
          overlap: context.overlap,
        };
        if (!propose) return result;
        const options = v.parse(
          optionsSchema,
          "options" in args ? args.options : {},
        );
        const proposal = proposeAutoMix(before, lanes, options, context);
        const next = validateAgentDocument(proposal.document);
        assertCurrent();
        return {
          ...result,
          proposal: savePreview(before, next),
          reasons: proposal.changes,
          options,
          listeningRequired: true,
        };
      } finally {
        busy = false;
      }
    },
  }));
}
