/** Reduces browser observations without treating missing worklet replies as zero delay. */
export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

export function summarizeWindow(window) {
  const { posts, replies, refills, visibility } = window.data;
  const sampleRate = window.data.contexts?.[0]?.sampleRate;
  // The worklet reports currentTime at the start of the quantum that fired
  // the event, so its watermark can precede the event time by <128 frames.
  const quantumSeconds = Number.isFinite(sampleRate) ? 128 / sampleRate : 0;
  const events = posts.flatMap((post) => post.events.map((event) => ({
    lane: post.lane,
    time: event.time,
    sendWallMs: post.wallMs,
    sendAudioTime: post.audioTime,
  })));
  const leads = events.map((event) =>
    Number.isFinite(event.sendAudioTime) ? (event.time - event.sendAudioTime) * 1000 : null);
  const validLeads = leads.filter(Number.isFinite);
  const intervals = refills.slice(1).map((refill, index) => refill.wallMs - refills[index].wallMs);
  const loaded = replies.filter((reply) => reply.type === "loaded");
  const consumed = replies.filter((reply) => reply.type === "consumed");
  const mature = events.filter((event) =>
    Number.isFinite(window.end.audioTime) && event.time <= window.end.audioTime - 0.05);
  const withoutWatermark = mature.filter((event) => !consumed.some((reply) =>
    reply.lane === event.lane && reply.wallMs >= event.sendWallMs &&
    reply.untilTime + quantumSeconds >= event.time));
  return {
    workload: window.workload,
    pass: window.pass,
    label: window.visibility,
    observedHidden: window.end.hidden === true || visibility.some((sample) => sample.hidden === true),
    batches: posts.length,
    events: events.length,
    loadedReplies: loaded.length,
    consumedReplies: consumed.length,
    matureEventsWithoutWatermark: withoutWatermark.length,
    latePosts: validLeads.filter((lead) => lead < 0).length,
    minLeadMs: validLeads.length ? Math.min(...validLeads) : null,
    medianLeadMs: percentile(validLeads, 0.5),
    refillCount: refills.length,
    refillMedianMs: percentile(intervals, 0.5),
    refillP95Ms: percentile(intervals, 0.95),
    refillMaxMs: intervals.length ? Math.max(...intervals) : null,
    refillGapsOverHorizon: intervals.filter((interval) => interval > 120).length,
    errors: window.errors.length,
  };
}
