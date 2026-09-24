import { percentile } from "./live-event-math.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const delta = (end, start) => finite(end) && finite(start) ? end - start : null;

export function summarizeAndroidWindow(window) {
  const { posts = [], replies = [], refills = [], frames = [], longTasks = [], gestures = [],
    contexts = [], longTaskSupported = false } = window.data;
  const firstPost = posts.find((post) => post.count > 0);
  const events = posts.flatMap((post) => post.events.map((event) => ({ ...event,
    lane: post.lane, sendWallMs: post.wallMs, sendAudioTime: post.audioTime })));
  const leads = events.map((event) => finite(event.time) && finite(event.sendAudioTime) ?
    (event.time - event.sendAudioTime) * 1000 : null).filter(finite);
  const gaps = refills.slice(1).map((refill, index) => delta(refill.wallMs, refills[index].wallMs)).filter(finite);
  const firstLoaded = replies.find((reply) => reply.type === "loaded");
  const firstConsumed = replies.find((reply) => reply.type === "consumed");
  const sampleRate = contexts.find((context) => finite(context.sampleRate))?.sampleRate;
  const quantum = sampleRate ? 128 / sampleRate : null;
  const mature = events.filter((event) => finite(window.end?.audioTime) &&
    finite(event.time) && event.time <= window.end.audioTime - 0.05);
  const unconfirmed = quantum === null ? null : mature.filter((event) => !replies.some((reply) =>
    reply.type === "consumed" && reply.lane === event.lane && reply.wallMs >= event.sendWallMs &&
    finite(reply.untilTime) && reply.untilTime + quantum >= event.time)).length;
  const frame = (kind) => {
    const costs = frames.filter((sample) => sample.kind === kind).map((sample) => sample.callbackMs).filter(finite);
    return { count: costs.length, medianMs: percentile(costs, 0.5), p95Ms: percentile(costs, 0.95),
      maxMs: costs.length ? Math.max(...costs) : null };
  };
  return {
    workload: window.workload, temperature: window.temperature, pass: window.pass,
    gestureToFirstPostMs: delta(firstPost?.wallMs, gestures[0]?.wallMs),
    gestureToFirstLoadedReplyMs: delta(firstLoaded?.wallMs, gestures[0]?.wallMs),
    gestureToFirstConsumedReplyMs: delta(firstConsumed?.wallMs, gestures[0]?.wallMs),
    posts: posts.length, events: events.length,
    loadedReplies: replies.filter((reply) => reply.type === "loaded").length,
    consumedReplies: replies.filter((reply) => reply.type === "consumed").length,
    matureEventsWithoutConsumedWatermark: unconfirmed,
    minimumSendLeadMs: leads.length ? Math.min(...leads) : null,
    latePosts: leads.filter((lead) => lead < 0).length,
    refillMedianGapMs: percentile(gaps, 0.5), refillP95GapMs: percentile(gaps, 0.95),
    refillMaximumGapMs: gaps.length ? Math.max(...gaps) : null,
    refillGapsBeyond120Ms: gaps.filter((gap) => gap > 120).length,
    longTasks: longTaskSupported ? longTasks.length : null,
    longTaskMaximumMs: longTaskSupported && longTasks.length ? Math.max(...longTasks.map((task) => task.durationMs)) : null,
    grid: frame("grid"), visualizer: frame("visualizer"), errors: window.errors?.length ?? null,
  };
}
