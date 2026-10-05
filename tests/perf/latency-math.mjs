export function summarizePlay(data) {
  const gesture = data.clicks[0];
  const firstNote = data.messages.find((message) => message.count > 0);
  const elapsed = (at) =>
    Number.isFinite(gesture) && Number.isFinite(at) ? at - gesture : null;
  return {
    gestureToFirstPostedNoteMs: elapsed(firstNote?.at),
    firstPostedAudioTime: firstNote?.firstAudioTime ?? null,
    workletModuleMs: data.modules.map((module) => ({
      url: module.url,
      durationMs: Number.isFinite(module.end) ? module.end - module.start : null,
    })),
    resumeMs: data.resumes.map((sample) =>
      Number.isFinite(sample.end) ? sample.end - sample.start : null,
    ),
  };
}
