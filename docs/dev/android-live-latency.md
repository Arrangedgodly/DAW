# Android live playback capture protocol

R-08 uses the user's real Android Chrome tab and built-in speaker. The [probe](../../tests/perf/android-live.mjs) reads existing app and worklet traffic through browser API wrappers. It makes no production audio change. The raw JSON and compressed Chrome trace are generated only by a real run. None is checked in yet.

## Operator setup

1. Connect the Android phone with a USB **data** cable. On the phone, enable Developer options and USB debugging temporarily, then accept the USB debugging prompt for this PC. Keep the screen unlocked. No SSL cable is needed or expected.
2. Disconnect wired and Bluetooth audio accessories. Select the built-in **phone speaker** as the output and set a comfortable audible volume. Turn off battery saver. Record the model, Android version, Chrome version, battery percentage, whether the phone feels cool/warm/hot, and any accessory still connected. The probe reads the model, Android release, and Chrome version; the operator records the other conditions in a copy of the JSON template.
3. On the PC, confirm `adb devices -l` lists one authorized physical device. The existing Android SDK platform tools on this machine report `36.0.2-14143358` at `C:\Users\arran\AppData\Local\Android\Sdk\platform-tools\adb.exe`. No ADB download or shared dependency install was needed. If this path changes, use the [official SDK Platform-Tools release page](https://developer.android.com/tools/releases/platform-tools).
4. Prefer Chrome's supported remote debugging path: open desktop Chrome `chrome://inspect/#devices`, enable USB discovery, and inspect the Android Chrome tab. [Chrome's instructions](https://developer.chrome.com/docs/devtools/remote-debugging) explain the phone prompt and inspection. Keep screencasting off during timing because it can affect frame rate. The probe uses the same Android Chrome DevTools Protocol through `adb forward tcp:9222 localabstract:chrome_devtools_remote`. Chrome documents that alternative on the same page. Both forwarded endpoints are local to the PC; do not bind Vite or CDP to the LAN.
5. Inspect the device and page before the timing slot. Chrome's `chrome://inspect` port forwarding is a manual alternative: map device `5173` to PC `localhost:5173`. The automated probe uses `adb reverse tcp:5173 tcp:5173` instead. It starts Vite on `127.0.0.1:5173` and opens `http://localhost:5173/` on Android. Android Chrome treats its own localhost as a secure context, which is needed for Web Audio. Check `window.isSecureContext` and that Play is available. If CDP attachment or the secure origin fails, retain the error and stop; desktop emulation is not a phone result.

Copy [the conditions template](android-live-latency-conditions.example.json) to a local untracked JSON file and replace the null values with observed battery and thermal notes. `accessory` should say `none` only after checking both wired and Bluetooth routes. Keep the file with the raw capture. Before the run, request and receive the manager's explicit uncontended timing slot. No competing PC build, browser suite, browser trace, or audio benchmark may run during the capture.

## Capture

From this worktree, with one authorized phone and the manager's slot:

```powershell
$adb = 'C:\Users\arran\AppData\Local\Android\Sdk\platform-tools\adb.exe'
& $adb devices -l
node tests/perf/android-live.mjs --adb $adb --conditions C:\absolute\path\android-live-conditions.json --out C:\absolute\path\android-live-raw.json
node tests/perf/android-live-report.mjs C:\absolute\path\android-live-raw.json > C:\absolute\path\android-live-summary.json
```

Run once, sequentially. The script reloads a fresh page for each of five Welcome and five Glass Arcade `fresh-page` passes. Each fresh page gets a fresh audio context, but Chrome's HTTP cache and process may stay warm. It then repeats Play five times per song on the existing page as `repeat-play`. Each short pass plays for about 1.5 seconds and stops. Finally, Glass Arcade plays for 10 seconds with eight lanes while the probe records grid and visualizer callback durations and a compressed Chrome main-thread trace. The script writes raw JSON after every completed window and records a harness error if later work fails. It removes its local ADB forwards at exit.

The raw file records revision, Vite development mode, phone model/Android/Chrome details, user agent, conditions, each click timestamp, each nonempty event post with intended audio time, `loaded` and `consumed` replies, 25 ms refill callbacks, long tasks if the browser supports that observer, grid and visualizer rAF callback times, context latency metadata, and page errors. The report command leaves absent timing values as `null`. `baseLatency` and `outputLatency` are browser context metadata, not measured speaker latency. The `loaded` timestamp is when the main thread received the reply, not the exact worklet receive time. A consumed watermark is evidence of render progress, not proof of an audio deadline or speaker onset. Chrome's main-thread trace can identify long JavaScript, layout, and paint work, but cannot establish speaker onset or missed audio-render deadlines.

Review the compressed trace in Chrome DevTools' Performance panel. [Chrome documents saving and loading traces](https://developer.chrome.com/docs/devtools/performance/save-trace). Preserve the raw `.json.gz` before making any interpretation. The script's callback wrappers add some overhead, so identify large effects by comparing repeated windows and the trace, then use a separate production PR with a parity gate before claiming an improvement.

## Listening check on the speaker

Do this directly on the phone after the automated run, with the same output route and volume. Do not infer it from waveform or CDP timestamps.

- In Welcome, tap Play five times from a stopped state. For each pass, note whether the first audible note feels immediate, delayed, missing, or inconsistent. Listen for crackles or dropped notes during at least 20 seconds of playback.
- In Glass Arcade, repeat five Play starts and listen through at least 30 seconds with the eight-lane grid and visualizer visible. Pan or scroll the grid as you normally would. Note audible gaps, visual freezing, and whether the sound continues when the display stutters.
- Write pass-by-pass notes with approximate wall time, phone speaker confirmation, and any volume, heat, or battery change. A subjective listening note has no calibrated milliseconds. A phone microphone check is optional only if it captures a detectable speaker signal with echo cancellation, AGC, and noise suppression settings verified and accounts for input capture delay. This protocol does not claim physical output latency from microphone input.

After capture, tell the manager the timing slot is released. Rank any later production PR by observed phone bottleneck and require the same phone workload plus audible playback parity before and after the change. If there is no device or the origin fails, report that exact blocker and keep the measurement conclusion open.

## Current run status, 2026-09-24

The physical-phone study has not run. This checkout's preflight used the installed SDK ADB and the example conditions file, before asking for a timing slot. `adb devices -l` reported only `emulator-5562 offline`; it reported no authorized physical phone. The probe exited 1 with `Expected one authorized physical Android device`. No Vite server, Android Chrome session, Play passes, traces, or listening observations were produced. The offline emulator is explicitly rejected as a substitute.

Because there are no phone observations, there is no measured ranking of an engine bottleneck. The follow-up production PR contract remains conditional: if the phone shows refill gaps or late posts together with audible gaps, investigate the scheduler and verify sound parity; if event delivery remains timely but rAF or main-thread work is heavy, investigate the observed grid or visualizer stack with event-delivery parity; if neither appears, retain the measurement and make no production change. The first verified phone bottleneck, not the Windows headless numbers, should select the next bounded PR.
