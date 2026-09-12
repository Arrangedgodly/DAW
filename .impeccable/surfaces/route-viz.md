---
version: 1
slug: "route-viz"
primary_target: "route:/viz"
related_targets: ["src/components/VizPage.tsx","src/components/VizRemote.tsx","src/styles/viz.css"]
---

# Visual composition

Mode: Operate while editing; Experience while viewing. User approved option B's canvas with one inspector, then approved permanent advanced motion controls with Blended as the default. The original code prototype and concept seed a1f9b8d7 record the layout exploration, not a constraint on the old placement model.

## Visual direction

Large graphite canvas, crisp additive lane-colored procedural geometry, one 304px inspector, warm mono controls inherited from the DAW. On phones the inspector scrolls below the canvas. Header and footer actions remain reachable. Motion is musical: explosive drums, sustained pitched deformations, then empty space through silence. Reduced motion uses textual summaries with no artwork.

## Controls and composition

Permanent Motion selector: Fluid folds (default), Flowing trails, Orbit. Permanent Composition selector: Blended (default), Distinct. Blending applies to fluid/trails; Orbit disables that selector and exposes the selected lane's 0-100% orbit strength. Scale is 35-130% independently. Four instrument tabs select effect/scale controls. No manual positioning or draggable handles. Orbit's dashed guide is editing-only. Hide controls removes controls and guide for clean viewing; Escape restores editing focus.

## State

Each lane owns an effect from 24 geometries, seeded variation, scale, optional orbit strength (legacy default 60) and a starting phase derived from legacy normalized x/y. Reroll changes effects, variations and starting phases, preserving motion, blending, scale and orbit strength. Composition v2 localStorage remains separate from project saves and undo; old values default to Fluid folds + Blended and retain effects. The former motion-study URL is no longer special.

## Boundaries

Actual audible-time note metadata only. Audio scheduling, sound generation and unrelated DAW editing remain unchanged. Silent lanes skip drawing after their release, and mute/solo/zero-volume uses the shared gain law. Hidden tabs park and discard stale hits. Render faults leave audio and exit usable. Existing dense high-DPI performance limitation remains unresolved; no performance claim is inferred from functional or visual verification.
