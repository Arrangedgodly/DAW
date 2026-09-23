# PR orchestration: audio FX performance

Started 2026-09-23. Preserve sound, saved projects, and live/offline behavior while measuring each effect's cost. Separate control latency, offline throughput, live processing load, and device output latency.

## Dependency graph and model assignments

- R-01: Audit every current FX and compare alternatives. gpt-6-sol, medium reasoning.
- R-02: Diagnose Elementary benchmark parity and timing. gpt-6-sol, medium reasoning. Parallel to R-01.
- P-01: Repair and validate the comparison benchmark. Depends on R-02. gpt-6-luna, high reasoning.
- P-02: Implement the highest-confidence bounded production optimization with measured regression coverage. Depends on R-01. gpt-6-luna, high reasoning. Parallel to P-01 if files remain independent.

Research uses Sol for analysis and source evaluation. Implementation uses Luna for bounded changes and verification, as requested. Additional replacement work requires evidence from these slices; no engine migration is assumed.

## Task ledger

| ID | Title | Branch | Base | Model / reasoning | Thread / worker | Blocked by | Status | PR URL | Linked? |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | Current FX audit | report only | main | gpt-6-sol / medium | [T3 thread](http://127.0.0.1:3773/chat/d942a95d-bf7b-4e90-8c20-31ef716b50f0?thread=5643d5a2-1c54-4cf0-a63b-7c415f1004d9) | None | report delivered | n/a | n/a |
| R-02 | Benchmark diagnosis | report only | main | gpt-6-sol / medium | [T3 thread](http://127.0.0.1:3773/chat/d942a95d-bf7b-4e90-8c20-31ef716b50f0?thread=bdfb5979-0c69-49d4-9071-390be32afcf6) | None | report delivered | n/a | n/a |
| P-01 | Benchmark repair | perf/fx-benchmark-parity | main | gpt-6-luna / high | [T3 thread](http://127.0.0.1:3773/chat/d942a95d-bf7b-4e90-8c20-31ef716b50f0?thread=4a8e185c-e50d-44d7-a620-7e187081f7ea) | None | pr-open | [PR 2](https://github.com/Arrangedgodly/DAW/pull/2) | Yes, worker and master |
| P-02 | Reverb update cost and delay sync | perf/fx-control-cost | main | gpt-6-luna / high | [T3 thread](http://127.0.0.1:3773/chat/d942a95d-bf7b-4e90-8c20-31ef716b50f0?thread=e9aaa40d-1fed-41f8-974f-cf2779476a5b) | None | pr-open | [PR 1](https://github.com/Arrangedgodly/DAW/pull/1) | Yes, worker and master |

## Baseline and constraints

- Baseline commit: 27acaec.
- Existing uncommitted work: package.json, package-lock.json, audio-engine-benchmark.html, docs/dev/audio-engine-benchmark.md, docs/dev/audio-engine-benchmark.ts. Preserve the original checkout; copy benchmark changes into its isolated implementation worktree.
- Existing benchmark has a substantial output mismatch. Its offline speed comparison is insufficient evidence for replacing production reverb.
- User requires project-attached T3 threads, not subagents. Initial subagents were interrupted; their findings were handed to the T3 threads. No subagents remain assigned work.
- A session-local copy of the T3 launcher passes `modelSelection.options` with `reasoningEffort` and the isolated `worktreePath`. Canonical option shape was checked against installed T3 server schemas. The skill itself is unchanged.
- Each T3 thread must write `docs/tasks/fx-handoffs/<ID>.md` in its assigned checkout and finish with completed work, evidence, remaining gaps, blockers, and next steps. Master reads thread completion and handoff files before dispatching dependencies.
- Timed workloads were serialized between P-02 and P-01. Both are complete.
- Implementation branches use isolated worktrees. Open and link PRs; merging and deployment are outside this pass.
- Validate relevant unit/browser tests, types, lint on changed code, and build. Report unavailable checks separately. No claim of audio audition without listening.

## Research handoffs

- [R-01 audit](../dev/fx-performance-audit.md) and [handoff](fx-handoffs/R-01.md): every creative FX plus EQ, compression, limiter, and routing reviewed. Further candidates are spectrum scratch reuse, avoiding parameter-only chain relinks, default mixer graph profiling, compressor arithmetic profiling, bounded IR reuse, and silent branch lifecycle. These are ranked follow-ups, not measured wins.
- [R-02 diagnosis](../dev/fx-benchmark-research.md) and [handoff](fx-handoffs/R-02.md): Elementary's default 20 ms graph-root fade explains onset attenuation. A silence prime fixes short probe onset; native gain automation is a separate comparison confounder. P-01 owns full browser validation.

## Review and remote checks

- P-02 initial local checks: 29 focused unit tests, 8 Chromium FX graph tests, typecheck, changed-file lint, build. Master requested per-step allocation assertions because the original implementation can accidentally satisfy the total-count assertion, baseline failure proof, and a retained real-Chromium control-cost benchmark.
- P-01 master review caught and worker corrected an invalid direct input-to-output connection in the draft production benchmark before timing.
- PR 1 initial GitHub unit CI passed. Native-browser CI fails two MP4 export checks at `tests/browser/exportVideo.test.tsx:67`, expected near 1 but received 1.0913378684807256. Exact same tests/value fail baseline main 27acaec, verified in job 106966698976 versus PR job 107137199031. This is an existing failure, not a green check.
- Cloudflare Workers build check failed; GitHub exposes a dashboard link but no diagnostic text. Cause unverified. No deployment was performed by this orchestration.
- Initial PR 1 broad browser run also repeats baseline missing `.fx-param-slider` selectors, Auto Mix help coverage, and dead help registry IDs. One per-lane sweep timing assertion failed that PR run but was absent from the baseline failure list; its cause remains unresolved. Do not call the full CI suite green.

## Delivered measurement evidence

- P-02 strengthened unit regression fails on baseline 27acaec at the redundant mix-only IR allocation and passes fixed. Native Chromium control workload: 120 setter calls per pass, allocations/assignments 97 baseline versus 49 fixed; initial medians 1048 ms versus 465 ms. All samples were emitted, but the first opt-in benchmark command timed out at 15 seconds. The retained benchmark then passed with exit code 0 under its corrected 60-second timeout. That separate run measured medians of 1254.3 ms baseline and 619.0 ms fixed, with the same 97 versus 49 counts. Raw JSON and both run histories are retained in PR 1. These timings measure synchronous control updates, not audio output latency.
- P-01 Chrome 154 full-window dry parity is exact; wet peak error 2.794e-9 and fixed full-chain peak error 5.960e-8; stereo isolation and sample-zero probes pass. Native settled median 134.8 ms versus Elementary 101.5 ms for 411136 frames including identical pre-roll and tail. Offline throughput only. Focused Chromium test, types, changed-file lint and build pass. Bundle helper's internal npm invocation failed with ENOENT; direct build and asset scan ran and found no Elementary identifiers in production assets.

## Review order and remaining work

Both PRs target main independently. Review the small production fix in PR 1, then the development benchmark and research in PR 2. No merge or deployment is part of this pass.

The research reports cover all effects. Further implementation candidates remain explicitly unmeasured: meter scratch reuse, param-only graph relink avoidance, lazy mixer node creation, compressor arithmetic, bounded IR reuse, and inactive branch lifecycle. A live Elementary trial requires target-device playback profiling, live/offline parity, bypass/disposal/control checks and listening review. The offline result alone does not select a new production engine.

