import { compileSong } from "../audio/song";
import {
  computeLoopSteps,
  expandLaneEventsForLoop,
  EXPORT_SAMPLE_RATE,
} from "../audio/render";
import { secondsPerStep } from "../audio/time";
import { documentLaneMixGains, type ProjectDocument } from "../document/schema";
import type { VizNoteOn } from "../engine/session";

export const VIDEO_FORMATS = {
  desktop: { width: 1920, height: 1080, label: "Desktop · 16:9" },
  mobile: { width: 1080, height: 1920, label: "Mobile · 9:16" },
} as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;
export const VIDEO_FPS = 30;
// Bound the existing whole-cycle audio renderer's allocation before starting it.
export const MAX_VIDEO_CYCLE_SECONDS = 300;

export function videoCycleBars(doc: ProjectDocument): number {
  const schedules = compileSong(doc, doc.transport);
  return (
    computeLoopSteps(Object.values(schedules).map((s) => s.chainSteps)) / 16
  );
}

export function createVideoPlan(
  doc: ProjectDocument,
  startBar = 1,
  endBar = videoCycleBars(doc),
) {
  const bars = videoCycleBars(doc);
  if (
    !Number.isInteger(startBar) ||
    !Number.isInteger(endBar) ||
    startBar < 1 ||
    endBar < startBar ||
    endBar > bars
  )
    throw new Error(`Choose a bar range between 1 and ${bars}.`);
  const secondsPerBar = 16 * secondsPerStep(doc.transport.bpm);
  if (bars * secondsPerBar > MAX_VIDEO_CYCLE_SECONDS)
    throw new Error(
      "Video export currently supports song cycles up to 5 minutes. Shorten the arrangement before exporting.",
    );
  const startSample = Math.round(
    (startBar - 1) * secondsPerBar * EXPORT_SAMPLE_RATE,
  );
  const endSample = Math.round(endBar * secondsPerBar * EXPORT_SAMPLE_RATE);
  const duration = (endSample - startSample) / EXPORT_SAMPLE_RATE;
  const schedules = compileSong(doc, doc.transport);
  const gains = documentLaneMixGains(doc);
  const hits: VizNoteOn[] = [];
  doc.lanes.forEach((lane, index) => {
    const schedule = schedules[lane.id];
    if (!schedule || !(gains[index]! > 0)) return;
    for (const event of expandLaneEventsForLoop(
      schedule,
      endBar * 16,
      doc.transport,
    )) {
      hits.push({
        lane: lane.id,
        pitch: Math.round(69 + 12 * Math.log2(event.freq / 440)),
        velocity: event.level,
        audibleAt: event.time,
        holdSeconds: event.holdSeconds,
        releaseSeconds: event.release,
      });
    }
  });
  hits.sort((a, b) => a.audibleAt - b.audibleAt);
  return {
    bars,
    startSample,
    endSample,
    duration,
    startSeconds: startSample / EXPORT_SAMPLE_RATE,
    frames: Math.ceil(duration * VIDEO_FPS),
    hits,
  };
}
