# Visualizer MP4 export

Open VIZ and choose **Export video**. Choose Desktop for 1920 × 1080 or Mobile for 1080 × 1920. Both export at 30 fps with H.264 video and AAC stereo audio. Choose the full arrangement or an inclusive first/last bar range, render, preview, and save the MP4.

The song is captured when the dialog opens; composition and track colors are captured when rendering starts. Video contains the visual composition without editor controls. It renders on a separate canvas using the same composition engine and compiled note events as playback. Earlier frames are replayed before a selected section so held notes and motion survive the cut. Audio comes from the existing offline WAV renderer, including its mix, effects, and loop-tail folding.

Mediabunny is loaded on demand to encode and package the MP4. Browser support for both AVC and AAC encoding is checked before the audio render. There is no upload or server render. Unsupported browsers receive an error; the exporter does not substitute another file format.

The first version limits the complete arrangement cycle to five minutes, including when exporting only a section, because the audio renderer still allocates the full cycle. Cancellation during audio rendering waits for that render to complete before cleanup. Keep the tab open. Browser/device encoding performance varies; physical iPhone and Android export have not been verified.

Verification covers actual Chromium encoding and decoding in both orientations, audio energy and duration, changing video frames, a selected bar starting with a held note, cancellation cleanup, phone dialog fit, Escape focus return, and the render/preview/save flow. The existing visualizer composition tests also pass. Unit tests cover sample boundaries, swing, muted instruments, invalid ranges, and the cycle limit.

Implementation: `src/viz/videoPlan.ts`, `src/viz/exportVideo.ts`, and `src/components/VizVideoExport.tsx`. Tests: `tests/video-plan.test.ts` and `tests/browser/exportVideo.test.tsx`.

Encoding API reference: [Mediabunny media creation](https://mediabunny.dev/guide/quick-start#create-new-media-files).
