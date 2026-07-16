# 002-yarn-pillow — Yarn Pillow

- **Status:** live
- **Created:** 2026-07-09
- **Tags:** mesh, 3d, curve, generative, color

## Intent

A set of disconnected woolen strands chase each other along one continuous
path wound around an invisible rounded pillow, covering both sides. The yarn
surface (2-ply twist + fibre fuzz + per-strand colour) scrolls forward
forever, so the strands read as physically moving. The pillow shape and the
strand population are live-editable from the standalone page.

## How it works

- **Path:** a Hilbert curve (order 5 → 32×32 cells) mapped across the top
  face via `pillowPoint(u, v)`, then the same curve in reverse across the
  underside — one closed loop covering the whole outside. Chaikin
  corner-cutting (2 passes) softens it into a wooly path.
- **Pillow surface:** a squircle footprint (`round` blends hard square → full
  circle) that bulges by `sin(πu)·sin(πv)` raised to the `dome` exponent;
  `aspect` reshapes W:H while keeping area roughly constant; `thickness` is
  the half-depth.
- **Tube:** the centreline is extruded into a round tube (ring = 10) using a
  parallel-transport frame with closure correction (the accumulated frame
  twist at loop closure is unwound linearly along the path so the seam is
  invisible). Vertex layout: interleaved `pos(3) nrm(3) arclen coord` — 8
  floats.
- **Strands:** the shader partitions the loop by arc length into
  `strandCount` cells; a `duty` fraction of each cell is yarn, the rest is
  `discard`ed as gap. Each strand gets a procedurally random hue from a
  colour seed. Twist, fuzz (value-noise fbm), fresnel halo, and the strand
  pattern all scroll forward at `FLOW_SPEED` via time-offset arc length.
- **Depth:** real depth buffer (`depth24plus`) — the tube self-occludes.
  Created lazily, recreated on `resize` (old texture destroyed first),
  guarded in `frame` in case a frame ever precedes a resize.
- **Uniform (176 bytes, `group(0) binding(0)`):**
  `mvp : mat4x4` (0), `model : mat4x4` for normals (64),
  `p0 = (time, totalLen, flowSpeed, strandCount)` (128),
  `p1 = (twistCount, plyCount, fresnelAmt, duty)` (144),
  `p2 = (colorSeed, …)` (160). Sub-ranges written independently with
  `queue.writeBuffer(ubuf, offset, …)`.

## Control surface

Extra instance methods beyond the contract, wired to sliders/buttons in the
standalone `index.html` (gallery mode would ignore them and render defaults):

| Method | UI | Notes |
|---|---|---|
| `setShape(partial)` / `getShape()` | round, thickness, aspect, dome sliders + reset | Sets a dirty flag; rebuild happens in the next `frame` |
| `setStrandCount(n)` / `getStrandCount()` | count slider (1..`maxStrands` = 1000) | Uniform-only change |
| `setCoverage(d)` / `getCoverage()` | coverage slider (duty 0.05..1) | Uniform-only change |
| `shuffleColors()` | "New colours" button | Re-seeds the palette |
| `maxStrands` | slider max | Constant property |

Defaults: `round 0.0, thickness 0.8, aspect 1.0, dome 0.2`, 50 strands,
60% coverage.

## Implementation notes

- **Rebuild without churn:** vertex *count* is fixed regardless of shape
  (order/Chaikin/ring are constants), so a shape edit recomputes positions
  and re-uploads to the same vertex buffer — no pipeline/buffer recreation,
  index buffer untouched. Slider drags coalesce to at most one rebuild per
  frame behind the dirty flag.
- Strand count and coverage are shader-side (uniform) parameters — changing
  them touches no geometry at all.
- This doodle introduced the cache-busting bootstrap (`?ts=` on `doodle.js`
  and `shader.wgsl`) after hitting the stale-module trap; now standard in
  `_template/` (overarching spec §6).
- Nothing relies on identifier names surviving minification.

## Ideas

- `thumb.png` still to be captured (owner).
- Strand thickness / flow speed as controls.
- A "tangle" mode: jitter the Hilbert cell centres for a messier wind.
