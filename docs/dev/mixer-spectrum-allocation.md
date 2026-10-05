# Mixer spectrum scratch allocation

`MixerPage` polls the selected meter every 80 ms and requests 2048 bins. Before
P-03, `Session.readMixerSpectrum` constructed one right-channel
`Float32Array(out.length)` on every poll. At that fixed UI size this is 8192
bytes of typed-array storage per poll, or about 100 KiB/s of allocation traffic
per open mixer page, before allocator and garbage-collection overhead. This is
a source-derived estimate, not a timed benchmark or a measurement of audio
latency.

The session now allocates one private right-channel workspace after the first
meter read for a given output length. It reuses that buffer across lane/master
selection changes and replaces it when the output length changes. Releasing
mixer taps also releases the workspace. The returned caller buffer remains
independent. The focused unit test checks stable scratch identity across meter
selection after warm-up, length replacement, output independence, stereo
maximums, and the missing-meter fallback.

The practical benefit is modest and limited to UI-side allocation pressure:
at the normal polling rate it avoids roughly 100 KiB/s of short-lived typed
arrays. No reduction in audio processing or device output latency is implied.
`MixerPage` still creates a fresh 2048-bin output array per signal update to
preserve Solid's reactive update behavior.
