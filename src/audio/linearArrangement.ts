import type { PlaybackRule } from "../document/schema";
import type { LaneSchedule, LaneSegment } from "./song";
import type { VoiceNoteOnEvent } from "./presets";

/** A finite pass: duration controls apply; live routing and indefinite holds do not. */
export function linearBlockSteps(
  steps: number,
  rule?: PlaybackRule | null,
): number {
  if (rule?.unit === "bars") return rule.amount * 16;
  if (rule?.unit === "repeats") return rule.amount * steps;
  return steps;
}

export function linearizeSchedule(schedule: LaneSchedule): LaneSchedule {
  const byStep = new Map<number, VoiceNoteOnEvent[]>();
  const segments: LaneSegment[] = [];
  let cursor = 0;
  for (const segment of schedule.segments) {
    const duration = linearBlockSteps(segment.steps, segment.rule);
    segments.push({ ...segment, startStep: cursor, steps: duration });
    for (let step = 0; step < duration; step++) {
      const events = schedule.byStep.get(
        segment.startStep + (step % segment.steps),
      );
      if (events) byStep.set(cursor + step, [...events]);
    }
    cursor += duration;
  }
  return { chainSteps: cursor, segments, byStep };
}
