# 003-rolling-decay — Rolling Decay

- **Status:** wip (2026-07-17 — real edge-pivot rolling with **overlap→explode**
  collision: tiling solids lay a seamless mosaic, non-tiling ones (dodeca,
  Archimedean) roll freely and burst on overlap; eight solids; analytic
  reflections; dynamic cubemap deferred; awaiting an on-hardware run)
- **Created:** 2026-07-17
- **Tags:** mesh, 3d, simulation, instanced, generative

*(Slug/title are a placeholder mismatch — the piece no longer "decays", it rolls
and paves. Rename before first publish; the slug becomes the permalink.)*

> **History:** started as cubes rolling across a chessboard *consuming* the
> floor; inverted to a paint-the-grid Tron-paver on a square lattice with
> face-shaped stamps; now the **movement itself is a true roll** — each solid
> tips over an edge of its contact face so the next face lands flat and shares
> that edge, tiling the plane seamlessly. Earlier mechanics are gone. Reflections
> are still the analytic layer only (dynamic cubemap deferred).

## Intent

An empty dark arena. Shiny solids **roll edge over edge** across it — each tip
lands a new face flat on the plane, stamped down as a coloured tile. Solids whose
faces tile the plane (triangles → tetra/octa/icosa, squares → cube) lay a
*seamless mosaic*; the rest (dodecahedron, Archimedean) roll freely and, the
instant a new face would **overlap** the existing mosaic — or run off the arena —
the solid **explodes**, its faces bursting apart and fading. When a wave is gone
a fresh wave drops onto the free space; once there's no free space the grid
clears in a ripple and begins again. Mood: clean, mechanical, a little
relentless — the tiling solids fill space patiently, the others detonate.

## How it works

### Rolling + overlap collision

A polyhedron rolling on a plane rests on one face; to advance it pivots about an
edge of that face by its **exterior dihedral angle** (`arccos(n₁·n₂)` for
adjacent outward normals) until the neighbouring face lands flat, sharing the
pivot edge. `rollOver` does this for **any** convex solid and any edge (the tip
angle emerges from the geometry). For congruent regular faces the new footprint
is the reflection of the old across the edge, which **tiles the plane** —
triangles → triangular lattice (tetra/octa/icosa), squares → square lattice
(cube). Pentagons and mixed faces don't tile, so those solids' footprints
eventually overlap; that overlap is what ends them.

Movement is **continuous** (a full 3-D pose per solid, not a lattice index).
Collision is **convex-polygon overlap** (SAT, edge-touching excluded) between a
candidate footprint and the stamped mosaic, accelerated by a spatial hash.
Geometry is unit-tested in `roll_proto.mjs`/`cont_proto.mjs` and the loop in
`sim3.mjs` (tiling footprints stay lattice-exact to ~1e-13; no drift) and
`cont_proto.mjs` (all eight solids roll, explode, respawn, reset; **no live solid
ever overlaps a stamp**).

### Simulation

State lives in JS; the GPU only draws. One **iteration** every `1/speed`
seconds. Per iteration, in shuffled order:

1. Project the contact face to its footprint; for each non-incoming edge,
   `rollOver` gives the candidate landing pose + footprint. Candidates rank by
   **momentum** (dot with the heading).
2. The first candidate that is **in-bounds and whose footprint doesn't overlap**
   any stamp, any other living solid, or a footprint already claimed this
   iteration is chosen. The solid **stamps the face it's leaving**, then rolls
   (pivot eased over ~72% of the interval, then a dwell).
3. **If no candidate is clean** (every roll would overlap / leave the arena) the
   solid **explodes**: it stamps its current face and is moved to a short
   explosion animation (faces burst outward along their normals + fade over
   ~0.55 s), independent of the iteration clock.

Every move or explosion stamps a face, so the mosaic grows monotonically → the
arena fills. **Respawn & reset:** a solid is replaced the **moment it explodes** —
each iteration the population is topped back up to `n` on any free spawn slots
(not waiting for a whole generation to die). Once the mosaic leaves no free slot
the population can't be replaced and dwindles to zero; then the grid **clears**
(tiles drop & fade over ~1.5 s, staggered from centre) and refills. `reset()`
forces the clear.

### Solids

Eight, chosen live via `setSolid` (any change ⇒ full reset): the five **Platonic**
plus three **Archimedean** (Cuboctahedron, Truncated Octahedron, Truncated Cube).
The four with a single regular face type that tiles (tetra/octa/icosa on a
triangular lattice, cube on a square lattice) **spawn on a shared lattice** so
their mosaics line up seamlessly and they only explode when genuinely boxed in;
the others (dodecahedron + Archimedean) spawn on a coarse grid and explode as
soon as their curving path would overlap — so they burst far more often. Geometry
is built at init by a generic convex-hull face finder returning the render mesh
(flat per-face normals — faceted metal), face rings/centroids/**edge adjacency**,
and the face-0 canonical footprint; each solid is scaled to inradius 0.5.

### Rendering

- **Two pipelines, one bind group.** Tiles: a **rebuilt flat triangle mesh** each
  frame — each stamped footprint contributes its polygon (fan-triangulated at
  `y=0`, dropped/faded during a clear), vertex attrs = position + mottle seed.
  Solids: the selected mesh, live (rolling) **and** dying (exploding) instances
  via a storage buffer; per-instance model matrix + `tint` (opacity + explode
  push).
- **Roll pose:** `Rot(edge, tip·ease, P) · pose₀`; on commit the final pose
  becomes the resting pose. Verified: contact face lands flat, shares the pivot
  edge, nothing penetrates the plane.
- **Explosion:** dying solids carry a timer; the shader pushes each vertex along
  its face normal by `tint.y` (`= t·EXPLODE_PUSH`) while `tint.x` (opacity) fades
  — the solid bursts into its faces over ~0.55 s, decoupled from the iteration
  clock.
- **Depth buffer** (`depth24plus`), lazy, recreated on `resize`, destroyed —
  overarching §11.
- **Camera:** orbit rig (yaw/pitch/distance/pan), framed from arena extents;
  gentle toggleable auto-orbit. Standalone: drag to orbit, scroll to zoom,
  shift/right-drag to pan (horizontal inverted per feedback); listeners on the
  canvas, standalone only, removed in `destroy`.

### Colour (per-solid palette)

A **palette** of six **analogous** colours — a random base hue with six
variations inside a tight ~0.12 (±~22°) hue band, varied sat/val — is generated
per load / `newColors()`, so the colours are clearly related rather than wildly
different. **Each solid is assigned one palette colour when it spawns and keeps
it for its whole life** —
while rolling, and through its explosion. Every tile it stamps carries that colour
(with a faint per-tile value jitter for texture), so the mosaic is a patchwork of
each solid's own hue, and the solid renders as **metal tinted by its colour**
(going white at grazing angles via fresnel). Colours are stored explicitly:
per-vertex on the tile mesh, per-instance (an extra `vec4`) on the solids. The
analytic environment's ground tone uses the palette **average**. Clearing tiles
fade to the background as they drop.

### Reflections (dynamic cubemap — DEFERRED)

Analytic escape layer only (sky gradient + base-tinted ground + strip lights +
fresnel/specular + tonemap); also the intended `quality < 1` path. The 6-face
dynamic cubemap so solids mirror the actual mosaic and each other is the biggest
follow-up, **not built yet**.

## Control surface

| Method | UI | Notes |
|---|---|---|
| `setGrid({x, y})` / `getGrid()` | two sliders (2–1000) | Arena size; full reset at next boundary |
| `setSolidCount(n)` / `getSolidCount()` | slider (1–64) | Full reset |
| `setSpeed(itersPerSec)` / `getSpeed()` | slider (0.25–8) | Next iteration; no reset |
| `setSolid(name)` / `getSolid()` / `solidNames` | dropdown (8 solids) | Full reset |
| `newColors()` / `getColors()` | "new colours" button | Regenerates the palette; live solids/tiles keep their assigned colours |
| `setAutoOrbit(b)` / `getAutoOrbit()` | "auto-orbit" checkbox | — |
| `resetView()` | "reset view" button | Recentres orbit/zoom/pan |
| `reset()` | "reset board" button | Clear choreography now |

Camera (standalone): drag orbit · scroll zoom · shift/right-drag pan. Defaults:
12×12 arena, 6 solids, Octahedron, 1.5 iters/sec, auto-orbit on, random hue.

## Implementation notes

- **Rolling is incremental & drift-free.** The pose updates by an exact rotation
  about the world pivot edge; for tiling solids `sim3.mjs` confirms the footprint
  stays lattice-exact to ~1e-13 over hundreds of rolls.
- **`poseForCell`** brute-forces the yaw over all vertex correspondences (an
  equilateral triangle's mirror is a 60° rotation, so naive 120° steps miss it —
  a real bug caught in the prototype).
- **Collision** is a `overlap()` SAT test between convex footprints with an
  edge-touching margin, over stamps found via a **spatial hash** (buckets keyed by
  footprint bbox, bucket size ≈ face diameter). Spawn slots: the shared lattice
  for tiling solids, a coarse grid for the rest; a slot is free if its footprint
  overlaps no stamp. Arena is a world rectangle from `gridX·gridY` × edge length.
- **Tile mesh** is rebuilt each frame from `stamps` into a growable vertex
  buffer, capped at `MAX_TILE_FLOATS` (~24 MB; one-time warn if exceeded). Large
  grids / many stamps are heavy.
- **Transparency:** exploding solids alpha-blend with depth write on (drawn after
  the opaque rolling ones). Accepted at this scale.
- **Uniform block** 128 B: `viewProj + camPos + envTint + params + light`; group(0)
  bindings 0–1 (uniform, solid storage). Solid instance is 96 B (mat4 + tint + a
  colour `vec4`); tiles are a plain vertex mesh of `pos + colour` (24 B/vertex).
- All matrix math is Float64 for pose precision, packed to Float32 for the GPU.
  Nothing relies on identifier names surviving minification (§3).

## Ideas

- **The big one:** the dynamic environment-cubemap (solids mirror the mosaic and
  each other; analytic layer becomes the `quality < 1` fallback).
- Bevelled solid edges for brighter glints.
- More non-tiling solids (rest of the Archimedean set, prisms/antiprisms,
  Catalan duals) — the hull builder takes any convex vertex set.
- Tune the explosion (debris arcs, a flash, a shockwave on the mosaic); fade
  each tile in as it's stamped; per-generation hue drift; a stats overlay.
