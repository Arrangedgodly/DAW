# Live event delivery headroom

R-05 measured the existing live Play path on `perf/latency-map` at `a292f3d733cd32e65fbb0dffb20afdd78686c6ed`. [Raw browser observations](live-event-headroom-samples.json) preserve each post, intended audio timestamp, main-thread audio-clock reading, worklet reply, 25 ms timer callback, click, visibility observation, and page error. This is a development Vite run on Windows 11 Pro 10.0.26200 x64, headless Chromium 151.0.7922.34, 1280 x 720. The raw file records the user agent and revision. The OS release fields were added from the same host after capture.

## Observation boundary

`src/audio/scheduler.ts` refills every 25 ms toward a 120 ms foreground horizon and switches to 1.5 s when `document.hidden` is true. `src/engine/session.ts` turns scheduled steps into lane events. `src/audio/voiceEngine.ts` posts those events to each worklet port and tracks consumed watermarks. `src/audio/worklets/voiceEngine.js` replies `loaded` after accepting an event batch and sends a `consumed` watermark after its render process advances through events.

The opt-in probe wraps browser APIs on the main thread. It records the audio clock immediately before each `events` post, the event's intended audio time, each existing worklet reply as observed by the main thread, and each 25 ms interval callback. It neither edits production code nor adds worklet messages. A `loaded` reply is evidence that the worklet accepted a batch, but its main-thread receipt timestamp is not the exact worklet receipt time. A `consumed` watermark shows that the worklet advanced through a queued event. The worklet reports the start of its render quantum as `untilTime` when it empties the queue, so the summary allows one 128-frame quantum when matching a watermark to an event.

The probe does not know whether the scheduler failed to create an expected musical event before posting it. It also cannot measure the worklet CPU deadline, speaker onset, or physical output latency. Existing offline onset tests cover a different path and do not establish live timer behavior.

## Repeat the capture

Run this on an idle host from this checkout, without other audio or browser timing work:

```powershell
$env:GIT_COMMIT = (git rev-parse HEAD)
node tests/perf/live-event-headroom.mjs --out docs/dev/live-event-headroom-samples.json
```

The script starts a local Vite server, launches one fresh Chromium context, loads Welcome and then Glass Arcade, and runs six sequential foreground Play windows per demo. Each window plays for about 1.4 s, then stops. A final Glass Arcade window opens another tab in the same browser context and attempts to hide the playing page for 2.5 s. The JSON labels this `hidden-attempt` so it cannot be mixed with foreground results. The script exited 0 and recorded no page or console errors. The first Welcome click took 110.4 ms to the first event post; all later Play clicks took 0.1 to 0.5 ms. That one development cold start is not a repeat of P-05's 12 fresh-context cold comparison.

## Measured foreground windows

| Demo | Windows | Posted events / batches | `loaded` / `consumed` replies | Minimum send lead | Refill interval median / p95 / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Welcome | 6 | 114 / 78 | 78 / 78 | 88.8 ms | 25.0 / 27.0 / 47.4 ms |
| Glass Arcade | 6 | 174 / 102 | 102 / 102 | 88.1 ms | 25.0 / 27.2 / 31.3 ms |

Send lead is `event.time - context.currentTime` at the main-thread port call. All 288 captured events had positive lead. Every event at least 50 ms behind the audio clock at the window end had a matching lane watermark, allowing one render quantum for the worklet's watermark convention. There were zero late posts, zero mature posts without a matching watermark, zero refill gaps above 120 ms, and zero page errors in these 12 windows. The first Welcome window's maximum refill gap was 47.4 ms; the other Welcome windows peaked at 26.2 to 30.2 ms. The trace does not identify the cause of the longer gap. Per-window timestamps and observations remain in the raw file.

These windows were short, uncontended, and used a headless virtual audio device. The Play sequence reused one context after the first click. Positive send lead and worklet watermarks do not prove glitch-free sound or physical output timing.

## Hidden-tab attempt

The covering tab did not change the playing page's `document.hidden` value in this headless Chromium run. The visibility array has no hidden transition, and the end snapshot reports `hidden: false`. Its 31 posts, 31 loaded replies, 31 consumed replies, and 25.0 ms median interval therefore describe another *visible* window. They do not test the 1.5 s hidden horizon or background timer throttling. A real browser tab or device session that confirms `document.hidden === true` is needed before drawing a background conclusion.

## Decision and next measurements

There is no supported production change in this PR. In particular, this capture has no missed posted events or refill gap near the 120 ms foreground horizon, and it has no sound parity measurement. Shortening the horizon would reduce the margin observed here without evidence that it fixes a problem. P-05 likewise reverted its startup ordering candidate after 12 fresh-context dev and built comparisons showed no median improvement: 52.05 to 52.50 ms in dev and 56.30 to 61.40 ms for built assets. P-05 measured first *post*, not worklet consumption or sound.

The next bounded measurement should use a target device with a confirmed hidden-tab transition, representative main-thread load, and an audio loopback or trustworthy render-deadline trace. It should record missed events and timer intervals beside audible glitches. Only then should a separate PR consider a scheduler policy change, with the same workload and sound parity checked before and after. The present headless foreground data does not identify a narrower safe engine edit.
