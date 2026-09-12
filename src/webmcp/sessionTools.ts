import * as v from "valibot";
import { getSession } from "../engine/session";
import { docStore, undo, redo } from "../state/store";
import { activeLane, selectLane } from "../state/selection";
import { phonePage, showPhonePage } from "../state/phonePage";
import { setVizMode, vizMode } from "../state/vizMode";
import { LaneIdSchema, ALL_LANE_IDS } from "../document/schema";
import type { DownloadSeam } from "../persist/fileIO";
import type { AgentTool } from "./tools";

const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });

export function createSessionTools(
  allowed: () => boolean,
  revision: () => number,
  capture: () => void,
): AgentTool[] {
  const session = getSession();
  let busy = false;
  const check = (signal?: AbortSignal) => {
    if (!allowed()) throw new Error("Agent access is off.");
    signal?.throwIfAborted();
  };
  const read = () => ({
    ...session.transport.snapshot,
    masterVolume: session.masterVolume,
    audioState: session.engine.state,
    lane: activeLane(),
    page: phonePage(),
    visualizer: vizMode(),
    revision: revision(),
  });
  function tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    readOnlyHint: boolean,
    run: (input: unknown, signal?: AbortSignal) => unknown | Promise<unknown>,
  ): AgentTool {
    return {
      name: `bitbounce_${name}`,
      description,
      inputSchema,
      annotations: { readOnlyHint, consequentialHint: name === "export" },
      async execute(input, options) {
        check(options?.signal);
        if (busy)
          throw new Error(
            "Another session command is running. Wait for it to finish.",
          );
        busy = true;
        try {
          return await run(input, options?.signal);
        } finally {
          busy = false;
        }
      },
    };
  }
  return [
    tool(
      "get_session",
      "Read playback, loop mode, master volume and selected view. audioState must be running to start playback; ask the user to press Play once if audio is locked.",
      object({}),
      true,
      (input) => {
        v.parse(v.strictObject({}), input);
        return read();
      },
    ),
    tool(
      "control_session",
      "Set playback, looping, master gain or the visible lane/page/visualizer. Omitted fields stay unchanged. Playback requires the user to unlock audio with Play once. Restore before agent restores loop/master/view settings and stops playback.",
      object(
        {
          playing: { type: "boolean" },
          loop: { type: "boolean" },
          masterVolume: { type: "number", minimum: 0, maximum: 1 },
          lane: { type: "string", enum: ALL_LANE_IDS },
          page: { type: "string", enum: ["edit", "song", "instruments"] },
          visualizer: { type: "boolean" },
        },
        [],
      ),
      false,
      async (input, signal) => {
        const args = v.parse(
          v.strictObject({
            playing: v.optional(v.boolean()),
            loop: v.optional(v.boolean()),
            masterVolume: v.optional(
              v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
            ),
            lane: v.optional(LaneIdSchema),
            page: v.optional(v.picklist(["edit", "song", "instruments"])),
            visualizer: v.optional(v.boolean()),
          }),
          input,
        );
        if (
          args.lane &&
          !docStore.getState().doc.lanes.some((lane) => lane.id === args.lane)
        )
          throw new Error("Lane is not present.");
        if (args.playing && session.engine.state !== "running")
          throw new Error(
            "Audio is locked. Ask the user to press Play once, then retry.",
          );
        capture();
        if (args.playing === false) {
          session.transport.stop();
          session.stopAllVoices();
        }
        if (args.playing === true && !session.transport.snapshot.playing) {
          await session.togglePlay();
          if (!allowed() || signal?.aborted) {
            session.transport.stop();
            session.stopAllVoices();
            check(signal);
          }
        }
        check(signal);
        if (args.loop !== undefined) session.setLoop(args.loop);
        if (args.masterVolume !== undefined)
          session.setMasterVolume(args.masterVolume);
        if (args.lane) selectLane(args.lane);
        if (args.page) showPhonePage(args.page);
        if (args.visualizer !== undefined) setVizMode(args.visualizer);
        return read();
      },
    ),
    tool(
      "history",
      "Undo or redo ONE most recent project edit, which may be a human edit. Read the current revision and use only when that is the intended change. The human's Restore before agent checkpoint remains available.",
      object({
        revision: { type: "integer", minimum: 0 },
        action: { type: "string", enum: ["undo", "redo"] },
      }),
      false,
      (input) => {
        const args = v.parse(
          v.strictObject({
            revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
            action: v.picklist(["undo", "redo"]),
          }),
          input,
        );
        if (args.revision !== revision())
          throw new Error("Project changed. Read the project again.");
        capture();
        if (args.action === "undo") undo();
        else redo();
        return { revision: revision() };
      },
    ),
    tool(
      "export",
      "Download the current project as WAV, MIDI or a Bitbounce JSON file, when the user requests a file. Uses local rendering. Downloads cannot be undone by project Undo or Restore. Returns download-dispatched status, not proof that the file was saved.",
      object({
        format: { type: "string", enum: ["wav", "midi", "project"] },
        revision: { type: "integer", minimum: 0 },
      }),
      false,
      async (input, signal) => {
        const args = v.parse(
          v.strictObject({
            format: v.picklist(["wav", "midi", "project"]),
            revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
          }),
          input,
        );
        if (args.revision !== revision())
          throw new Error("Project changed. Read the project again.");
        const doc = docStore.getState().doc;
        const assertDownload = () => {
          check(signal);
          if (docStore.getState().doc !== doc)
            throw new Error(
              "Project changed during export. Retry with the current revision.",
            );
        };
        const seam: DownloadSeam = {
          createObjectURL(blob) {
            assertDownload();
            return URL.createObjectURL(blob);
          },
          revokeObjectURL(url) {
            URL.revokeObjectURL(url);
          },
          createElement() {
            const anchor = document.createElement("a");
            return {
              get href() {
                return anchor.href;
              },
              set href(value: string) {
                anchor.href = value;
              },
              get download() {
                return anchor.download;
              },
              set download(value: string) {
                anchor.download = value;
              },
              click() {
                assertDownload();
                anchor.click();
              },
            };
          },
        };
        let result;
        if (args.format === "wav") {
          const { exportWav } = await import("../audio/exportWav");
          check(signal);
          result = await exportWav(doc, { seam });
        } else if (args.format === "midi") {
          const { exportMidi } = await import("../audio/exportMidi");
          check(signal);
          result = exportMidi(doc, { seam });
        } else {
          const { exportProjectFile } = await import("../persist/fileIO");
          check(signal);
          result = { ok: true, filename: exportProjectFile(doc, seam) };
        }
        check(signal);
        return { ...result, downloadDispatched: result.ok };
      },
    ),
  ];
}

export function sessionRestorer(): (restoreDocument: () => void) => void {
  const session = getSession();
  const loop = session.transport.snapshot.loop;
  const volume = session.masterVolume;
  const lane = activeLane();
  const page = phonePage();
  const viz = vizMode();
  return (restoreDocument) => {
    session.transport.stop();
    session.stopAllVoices();
    restoreDocument();
    session.setLoop(loop);
    session.setMasterVolume(volume);
    selectLane(lane);
    showPhonePage(page);
    setVizMode(viz);
  };
}
