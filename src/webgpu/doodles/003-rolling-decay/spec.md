# 003-rolling-decay — Rolling Decay

- **Status:** wip (first implementation landed 2026-07-17 — choreography +
  analytic reflections; dynamic environment-cubemap deferred; awaiting first
  on-hardware run)
- **Created:** 2026-07-17
- **Tags:** mesh, 3d, simulation, instanced, generative, reflection

*(Slug is a placeholder — rename before first publish; it becomes the
permalink.)*

> **Build note (2026-07-17):** the choreography is fully implemented — board,
> rolling/decay, strand→fade→die, generational respawn, consume-to-reset,
> instanced squares & cubes, depth buffer, orbit camera, cosine palettes, full
> control panel (grid to 1000). Reflections in this first pass
> are the **analytic environment only** (the escape/fallback layer below); the
> dynamic 6-face cubemap probe with box-projection parallax is a deliberate
> follow-up. Everything described under "cubemap" in Reflections is therefore
> not yet live. See "Build status & divergences" under Implementation notes.

## Intent

A chessboard of coloured squares, seen from a slowly orbiting three-quarter
view. Shiny metal cubes roll from square to square in discrete iterations,
pivoting 90° on the ground edge like dice being tipped. Every square a cube
vacates slowly sinks out of view and can never be landed on again, so the
floor is consumed behind the cubes — the piece is about watching them strand
themselves. A cube with nowhere left to roll spins in place on its vertical
axis, glinting. When every cube is stranded, the board rises back up, the
cubes re-scatter, and it all begins again.

The cubes are genuinely reflective: they mirror the board, the sinking
squares, and each other via a dynamic environment cubemap (see Rendering).

Mood: clean, mechanical, slightly ominous. The satisfaction is in the crisp
90° tips and the slow inevitability of the collapse.

## How it works

### Simulation

State lives in JS; the GPU only draws. One **iteration** every
`1 / speed` seconds (`speed` = iterations per second, configurable).

Grid: `gridX × gridY` cells (each axis configurable, **2–1000**). Each cell is
one of: **alive** (valid to stand on / roll onto), **sinking** (animating
downward, invalid), or **gone** (fully out of view, invalid).

Per iteration:

1. Visit the cubes in a freshly shuffled random order; earlier cubes claim
   squares first — this is the conflict resolution (agreed).
2. For each cube, valid targets are the 4 orthogonal neighbours that are
   in-bounds, **alive**, not occupied, and not already claimed this
   iteration.
3. If the cube has ≥1 valid target: pick one uniformly at random, claim it,
   and begin a **roll**: a 90° rotation about the shared ground edge, eased
   (smoothstep) over the first ~70% of the iteration interval, the remainder
   a dwell. The vacated cell flips to **sinking** the moment the roll starts.
   Rolling resets the cube to fully opaque.
4. If the cube has no valid target: it is **stranded** — it yaws 90° about its
   vertical axis this iteration (same easing) **and fades**. A cube fades to
   nothing over `FADE_STEPS = 5` consecutive stranded iterations; the moment it
   reaches full transparency it is removed, and the square it was standing on
   flips to **sinking** (the floor consumes the spot it died on).
5. **Fade is per-consecutive-strand, not latched to death:** a cube blocked
   only transiently (a neighbour occupied this turn) fades a step, but the
   instant it can move again it rolls and snaps back to full opacity. Only a
   cube stranded five turns *in a row* actually dies. (This supersedes the
   original "spins forever" behaviour.)

Sinking: a sinking cell descends at a fixed world rate over ~4 iterations,
then flips to **gone** (skipped by the renderer). Descent speed scales with
iteration speed so the choreography reads the same at any tempo.

**Generations & reset (revised):** the board is *not* reset when cubes strand.
Instead cubes strand, fade, die, and consume their squares until a whole
generation has died off (`live == 0`). If **alive squares still remain**, a
fresh generation drops onto random surviving squares and play continues —
no board reset. Only when the board is **fully consumed** (no alive squares
left) does the full reset fire: all cells rise back to the surface over ~1.5s,
staggered by distance from centre for a wave, then a fresh full board is
scattered. The manual `reset()` button triggers this rise immediately.

Cube count `n` (1–64) is clamped to `gridX·gridY`; spawn cells are distinct.
Each respawned generation uses the same `n`, clamped to the surviving square
count.

### Rendering

- **Instanced draws, one pipeline each** for squares and cubes:
  - Squares: a thin box (not a flat quad — the sides read while sinking),
    `gridX·gridY` instances, per-instance data = cell coords + sink depth +
    palette parity. Model transform derived in the vertex shader.
  - Cubes: a unit cube (slightly bevelled if cheap — see Ideas), `n`
    instances, per-instance model matrix computed in JS each frame (roll
    pivots make this awkward in-shader) and written to a storage or
    instance buffer.
- **Rolling transform:** for a roll from cell A to B, pivot `p` = midpoint of
  the shared ground edge, axis = the horizontal edge direction; model =
  `T(p) · R(axis, θ(t)) · T(−p) · M_A`, where `M_A` is the cube's accumulated
  orientation sitting on A and θ eases 0 → 90°. On completion, fold the 90°
  rotation into the accumulated orientation and **snap to the nearest of the
  24 axis-aligned rotations** so floating-point error never accumulates.
- **Depth buffer** (`depth24plus`), lazily created, recreated on `resize`,
  destroyed properly — overarching spec §11.
- **Camera:** fixed elevation three-quarter view, slow continuous yaw orbit
  (~0.05 rad/s), framing computed from grid extents so any grid size fits.

### Reflections (dynamic environment cubemap)

Real reflections without ray tracing:

- **One shared cubemap probe** at the board centre, slightly above the
  surface. Each frame, render the scene into the 6 faces of a small cubemap
  (~128px, `rgba8unorm` + small depth), using a **simplified shading path**
  (palette colour + basic lighting; no reflection sampling — one bounce
  only). Squares and cubes are both rendered into it so cubes reflect the
  board, the decay, and each other.
- **Box-projection parallax correction** in the cube fragment shader: a raw
  cubemap lookup assumes an environment at infinity, which slides wrongly on
  cubes away from the centre. Instead, intersect the reflected ray with the
  board's AABB (known extents) and sample the cubemap in the direction of
  the corrected hit point. A few lines of shader; makes floor reflections
  track cube positions convincingly.
- **Analytic environment as the escape/fallback layer:** reflected rays that
  miss the board AABB shade from a procedural sky gradient + ground tone +
  2–3 fake bright strip lights; fresnel + tight specular on top. This is
  also the **entire** reflection model when `ctx.quality < 1` (gallery
  mode): the cubemap passes are skipped so a future live-thumbnail gallery
  never pays 6 extra passes per card.
- Squares get the palette colour with a mild top-light (no reflection
  sampling); cubes are near-colourless metal so the palette reads through
  their reflections.
- **Accepted artifacts** (single shared probe, one bounce): a cube faintly
  reflects itself, and cube-on-cube reflections are plausible rather than
  geometrically exact. Fine at this scale.
- **Perf lever if ever needed:** round-robin — update one cubemap face per
  frame instead of six.

### Palette system

A palette is a **cosine gradient** (Inigo Quilez formulation):
`color(t) = a + b·cos(2π(c·t + d))` with `a,b,c,d : vec3`. Consequences:

- The active palette is 4 `vec4`s of uniform data (48 bytes used) —
  switching palettes is a single `writeBuffer`, no rebuilds.
- **Checker mapping:** light squares sample `t = 0.25`, dark squares
  `t = 0.75`. Preserves the chessboard read while letting palettes be rich.
- Optional **mosaic amount** (0–1): adds a small per-cell hash jitter to `t`
  so squares within each parity vary slightly. Default 0 (pure checker).
- Presets are a named list in `doodle.js`
  (`{ name, a, b, c, d }[]`) — e.g. Classic (near-B&W), Ember, Glacier,
  Synthwave, Moss. A **randomise** action generates coefficients within
  tasteful bounds.
- Sinking squares darken toward the background as they descend
  (depth-based multiply in-shader) so they fade rather than pop.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setGrid({x, y})` / `getGrid()` | two sliders (2–1000) | Instant re-scatter at the next iteration boundary; square storage grows to fit |
| `setCubeCount(n)` / `getCubeCount()` | slider (1–64, clamped to grid area) | Full reset, as above |
| `setSpeed(itersPerSec)` / `getSpeed()` | slider (0.25–8) | Takes effect next iteration; no reset |
| `setPalette(name)` / `getPalette()` / `paletteNames` | dropdown | Uniform-only |
| `setMosaic(v)` / `getMosaic()` | slider (0–1) | Uniform-only |
| `randomPalette()` | button | Generates coefficients, returns them |
| `reset()` | button | Runs the reset choreography immediately |

Defaults: 12×12 grid, 6 cubes, 1.5 iters/sec, Classic palette, mosaic 0.

## Implementation notes

- Iteration ticking is decoupled from frames: accumulate `dt`, fire an
  iteration when the accumulator crosses the interval, and derive every
  animation (roll θ, yaw, sink depth, reset wave) from phase within the
  interval — so pause/resume and reduced-motion single-frame both render a
  coherent pose.
- Allocate instance buffers at max size (32×32 squares, 64 cubes) and draw
  sub-ranges — grid/cube-count changes then never recreate GPU resources
  (contrast 002, which reuploads positions; here even counts changing is
  absorbed by the max-allocation).
- The cubemap needs its own tiny depth texture and 6 render-pass encodes per
  frame; face views are created once. `destroy()` releases the cubemap, its
  depth texture, and everything else — reset reuses existing resources and
  must not leak.
- Per-frame uploads are tiny: ≤64 cube matrices + one float per square + the
  uniform block(s). No perf concerns at this scale.
- Mind uniform alignment for the palette block and the per-face cubemap
  view-projection matrices (overarching spec §9).
- Nothing may rely on identifier names surviving minification (spec §3).

### Build status & divergences (first implementation, 2026-07-17)

What's live and how it maps to the brief above, plus where the code diverges —
all pending a first on-hardware run (the analytic material especially will want
tuning, spec §1):

- **Reflections: analytic only.** Cubes shade from the analytic environment
  (sky gradient + palette-tinted ground + three fake strip lights + fresnel +
  Blinn specular, gently tonemapped) — i.e. exactly the escape/fallback layer,
  which is also the intended `quality < 1` path. The 6-face dynamic cubemap
  probe, box-projection parallax, and one-bounce scene render are **not built
  yet**; cubes currently reflect a studio environment, not the actual board.
  This is the single biggest follow-up and the reason cube-reflects-board reads
  as "chrome in a room" rather than "mirror of the decay" for now.
- **Cube matrices on the CPU, snapped to the 24.** Per-frame model =
  `T(pivot)·R(axis,θ)·T(−pivot)·T(A)·O_A` for rolls, `T(A)·R_y(θ)·O_A` for
  strand yaws; on the iteration boundary the 90° turn folds into `O` and snaps
  to the nearest of the 24 axis-aligned rotations (`buildRot24`/`snap24`).
  Verified numerically: centres land exactly on the target cell and every fold
  stays axis-aligned (cube rests flat). Roll-direction sign table lives in
  `DIRS`.
- **Iteration clock is phase-derived** (accumulator + `interval = 1/speed`),
  so pause/resume and reduced-motion single-frame render coherent poses. Sink
  depth, roll θ, yaw and the rise wave are all functions of phase / continuous
  tick.
- **Sinking:** a vacated cell sinks over `SINK_ITERS = 4` iterations to
  `SINK_DIST = 5` world units, then is `gone` (skipped by the renderer);
  squares fade toward the background as they descend. Descent is tied to
  iteration count (not wall-clock), so tempo doesn't change the choreography.
- **Strand → fade → die → respawn → consume-to-reset** (revised per feedback
  2026-07-17, see Simulation above): stranded cubes fade over `FADE_STEPS = 5`
  consecutive strands (per-instance opacity via the widened cube instance +
  alpha blending on the cube pipeline), then vanish and sink their square. When
  a whole generation dies, a fresh one respawns on random surviving squares; the
  full rise-reset (`RISE_DUR = 1.5 s`, centre-out stagger) fires only when no
  alive squares remain. Validated headlessly (`sim.mjs`): deaths cap at exactly
  5 spins, mid-generation respawns and consume-to-reset both occur, and every
  live cube always rests on an alive cell.
- **Grid / cube-count edits do an *instant* re-scatter** at the next iteration
  boundary (full board rebuilt, cubes re-placed), **not** the rise-wave
  animation. The `reset()` button *does* play the rise choreography.
  Speed/palette/mosaic are live with no reset.
- **Transparency divergence:** fading cubes use standard alpha blend with depth
  write still on, so an occasional fading cube can blend slightly wrong against
  another cube directly behind it. Cubes are packed opaque-first each frame to
  minimise this; it's an accepted artifact at this scale.
- **Growable square storage:** grids run up to 1000×1000, so the square storage
  buffer and the board arrays (`cellState`/`sinkAt`/`riseFrom`) are allocated to
  the current grid and grown when it increases (rebuilding the bind group),
  rather than always reserving the maximum — a 1000² board is a 16 MB instance
  buffer and ~1 M CPU-side cells per frame, so **very large grids are heavy**
  (both the per-frame cell sweep in JS and the instance draw). Cube storage
  stays fixed at 64. Depth texture is the only other size-dependent resource
  (lazy, recreated on resize, destroyed in `destroy`).
- **Geometry:** squares are a thin box (`y ∈ [−0.14, 0]`, footprint 0.92·pitch
  so gaps read); cubes a unit box with per-face normals (24 verts) for the
  reflection lighting. `cullMode: "none"` on both — cheap at this vertex count,
  sidesteps winding bugs, depth resolves occlusion.
- **Not bevelled yet** (Ideas) — cubes are hard-edged; the chamfer that "sells
  metal" is a follow-up alongside the cubemap.
- **Uniform block** is `viewProj(64) + camPos(16) + palA/B/C/D(64) +
  params(16) + light(16) = 176 B`; the doodle owns `group(0)` bindings 0–2
  (uniform, square storage, cube storage).

## Ideas

- Bevelled cube edges (tiny chamfer in the geometry) — sells "metal" hard
  for ~24 extra triangles per cube, and gives the reflections bright edge
  glints.
- Trail mode: vacated squares leave a faint ghost outline at floor level.
- A "greedy" behaviour toggle: cubes prefer the neighbour with the most
  alive neighbours (survive longer) vs pure random (current spec).
- Stats overlay in standalone mode: iteration count, cubes mobile/stranded,
  squares remaining, longest run since load.
- Reflective floor (mirror the cubes in the alive squares) — cheap planar
  reflection pass; would compound nicely with the cubemap but is a separate
  effect. Later, if ever.