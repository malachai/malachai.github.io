# 005-cluster-cull — Cluster Cull

- **Status:** implemented — iterating from on-hardware feedback (Matt runs it)
- **Created:** 2026-07-20
- **Tags:** 2d, sdf, generative, composition, boolean

## Intent

A generative overlap-depth machine. Each cycle it throws a configurable number
of shapes — circle, square, triangle, oval, star, trapezoid, parallelogram —
at random positions, sizes, orientations and stroke widths, **without ever
showing them**. Then it draws the **outline of the region covered by at least
`x` shapes** — the deep overlaps, not the outer union. At `x = 1` that outline
is the boundary of the union; at `x = 3` it's the small cores where three or
more shapes pile up (the little curved-triangle "yellow" region in the
reference sketch). The outline fades in, holds, fades out; then a new throw.

The pleasure is the hidden structure surfacing: an unseen pile of shapes
resolving into a few clean nested cores. Dragging the `x` slider re-cuts the
same throw live — deeper and deeper into the overlaps — which makes the rule
itself a toy.

> **Design history.** v1 animated a visible scatter fusing into the boolean
> union with a glow. v2 (Matt): hide the throw, drop the glow, draw only the
> output line. v3 (Matt, current): the line isn't the *outer* union — it's the
> boundary of the **≥ x coverage** region (the inner overlaps). Union-find
> clustering was removed entirely; the rule is now per-pixel coverage depth.

## How it works

### The throw (unseen)

- `shapeCount` shapes (5–64). Each shape gets, independently:
  - **type:** uniform random among the **enabled** types (the shape pool — all
    seven by default);
  - **size:** uniform random in `[sizeMin, sizeMax]` (bounding radius, as a
    fraction of viewport min-dimension);
  - **rotation:** uniform random in `[rotMin, rotMax]` degrees;
  - **stroke width:** uniform random in `[strokeMin, strokeMax]` px.
  - Min/max pattern: if min = max the value is constant; otherwise uniform.
- **Position:** uniform random inside the viewport inset by the shape's
  bounding radius + half stroke, so every shape lands fully on-canvas.
- Seeded RNG (one seed per throw) so a throw is reproducible.
- None of this is drawn — the throw is a pure computation.

### The rule — coverage depth (the core idea)

For any point p, its **depth** is how many shapes cover it (filled area,
`sdf_i(p) ≤ 0`). We draw the outline of the region `{ p : depth(p) ≥ x }`.

The clean way to render that boundary: a point on **shape i's outline** is on
the boundary of the ≥ x region exactly when **`x − 1` other shapes cover it** —
crossing i's edge there toggles depth between `x − 1` and `x`. So, per pixel:

1. **Pass 1** — count total coverage `cov = Σ_i [sdf_i ≤ 0]`.
2. **Pass 2** — for each shape i whose stroke band contains the pixel
   (`|sdf_i| ≤ w_i/2`), compute `others = cov − [sdf_i ≤ 0]` (its own coverage
   removed). Draw the band iff `others == x − 1`.

This is exact (proven against the depth-≥-x set boundary for all x): segments
buried deeper (`others ≥ x`) or too shallow (`others < x − 1`) are dropped, so
only the inner overlap outline is drawn. Per-segment stroke width is whatever
shape contributed the arc, so the stroke range carries through. `x = 1`
(`others == 0`) recovers the outer-union outline. Two SDF passes over ≤ 64
shapes per pixel is comfortably cheap.

There is **no clustering and no `sdf` union/min** — coverage counting makes the
grouping implicit (only overlapping shapes raise each other's depth), and
different overlap cores never interact.

### Empty detection & stats (JS)

The shader draws whatever qualifies; JS separately samples coverage on a
`128×128` grid over the viewport once per throw to find `maxDepth` (the deepest
overlap). If `x > maxDepth` nothing is drawn → the cycle holds a blank verdict
briefly and re-throws. `maxDepth` and the current `x` also feed the stats line.
(A very thin core could be missed by the grid; the only cost is an occasional
skipped throw, never a wrong pixel.)

### The cycle

Driven by a phase clock accumulated from `dt` (pause/resume coherent). Throw
and coverage-sample are instantaneous; only the fade is animated:

1. **Reveal** (`REVEAL`, ~0.6s): the ≥ x outline fades in (`globalFade` 0→1).
2. **Hold** (`HOLD`, `holdTime`, default 5s): fully opaque.
3. **Fade** (`FADE`, ~0.6s): fades out → new seed → next throw.
4. **Empty** (`EMPTYHOLD`, ~1s): `x > maxDepth` → hold blank, then re-throw.

Range/count/pool changes bake in at the next throw (a count change while idling
throws immediately); `x` and colour apply live — `x` is a uniform the shader
reads every frame, so dragging it re-cuts the current throw instantly.
`rethrow()` skips to a new cycle. **Reduced-motion** renders a completed, held
composition as the single frame (`init` retries seeds until `x ≤ maxDepth`,
holds at `globalFade = 1`).

### Rendering

- Same architecture as 004: **one fullscreen triangle + one fragment shader**,
  no depth buffer, no meshes. `resize` is a no-op (everything
  resolution-relative).
- **Coordinate space ("n-units"):** normalised, centred, scaled by the viewport
  min dimension — `qn = (fragCoord − res/2) / minDim`. Centres/sizes live here;
  stroke widths are px and divided by `minDim`. Positions are laid out from the
  canvas *aspect at throw time*; a mid-hold resize can nudge a shape toward the
  edge and the next throw re-fits.
- **Per-shape record** in a storage buffer (`array<Shape, 64>`, 8×f32 = 32 B,
  16-aligned): `kind, cx, cy, size, cosR, sinR, strokeHalf, pad`. All shapes
  participate (no survivor flag). Records are re-packed only on a throw (dirty
  flag). `x`/`globalFade`/`ink` are uniforms.
- SDFs: circle and oval analytic (ellipse uses the `k1(k1−1)/k2` approximation —
  near-exact at the boundary, correct sign throughout so the coverage
  inside-test is safe); square, triangle, star, trapezoid and parallelogram
  share one iq polygon SDF over hardcoded canonical unit vertices (bounding
  radius 1). The **same vertex tables appear in `doodle.js` and `shader.wgsl`**
  and are diff-checked.
- **Style:** near-black background with a faint centre lift; a single
  configurable **ink** colour for the outline (default `#e9e9ee`). No glow, no
  fill — just the line.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setShapeCount(n)` / `getShapeCount()` | slider (5–64) | Next throw (throws now if idling) |
| `setMinOverlap(x)` / `getMinOverlap()` | slider (1–10) | **Live** overlap depth: 1 = outer union, 2 = pairwise+, 3 = triple+ cores, … |
| `setTypeEnabled(i,on)` / `getEnabledTypes()` / `getTypeNames()` | toggle chips | Shape pool; next throw; last type can't be disabled |
| `setSizeRange({min,max})` / `getSizeRange()` | dual-thumb slider | Next throw |
| `setRotationRange({min,max})` / `getRotationRange()` | dual-thumb slider (0–360°) | Next throw |
| `setStrokeRange({min,max})` / `getStrokeRange()` | dual-thumb slider (1–12 px) | Next throw |
| `setColor(hex)` / `getColor()` | colour input | Live, uniform-only |
| `setHoldTime(s)` / `getHoldTime()` | slider (2–15 s) | Live |
| `rethrow(seed?)` | button | New seed, new cycle now |
| `getSeed()` / `getStats()` | — | seed; `{thrown, maxDepth, x}` for the stats line |

Defaults: 24 shapes, `x` = 3, all seven types enabled, size 0.06–0.16, rotation
0–360°, stroke 2–5 px, ink `#e9e9ee`, hold 5s.

**Dual-thumb sliders:** two stacked `<input type="range">` with mutual clamping;
one reusable `bindDualRange`, instanced three times. **Shape pool:** toggle
chips, one per type; the doodle refuses to disable the last enabled type and the
chip reflects that. **Stats line:** shapes / max depth (deepest overlap this
throw) / current x.

## Implementation notes

- **SDFs exist twice** — WGSL (rendering) and JS (coverage sample). They must
  agree; the canonical unit vertex tables are kept byte-identical in both files
  (diff-checked during the build).
- **WGSL gotcha (hit during build):** a comparison inside a
  `vec3<bool>(…, a < b, …)` constructor is mis-parsed as a template argument
  list. Wrap comparison operands in parentheses:
  `vec3<bool>((p.y >= vi.y), (p.y < vj.y), (e.x*w.y > e.y*w.x))`. Only surfaces
  at `createShaderModule`; `node --check` can't see it.
- The `others == x − 1` boundary predicate was verified in JS against the true
  `depth ≥ x` set boundary across many edge points and all x (0 mismatches).
- `thrownCount` (records of the current throw) is tracked separately from
  `shapeCount` (desired next count), so a pending count change never desyncs.
- Storage buffer re-packed only on a throw. No GPU resource is ever recreated by
  any control.
- Struct alignment: all-`f32` record, 32-byte stride (overarching spec §9);
  nothing relies on identifier names surviving minification (spec §3).
- **Slug:** `005-cluster-cull` predates the coverage-depth rule; "cull" is now a
  loose fit (nothing is culled — regions are thresholded by depth). Kept as the
  permalink for now; rename before first publish if a better slug turns up
  (e.g. `005-overlap-depth`). Ask Matt.

## What to look for (on-hardware test)

Serve from the repo root and open `/src/webgpu/doodles/005-cluster-cull/`.

- At the default `x = 3`, only the **inner cores** where ≥ 3 shapes overlap are
  outlined — no outer shape outlines, nothing else.
- Slide `x` down to 1 → the outer union outline; up → deeper, smaller cores,
  until `x` exceeds the deepest overlap and the canvas goes blank (then
  re-throws). The stats line shows the deepest overlap available.
- Stroke-width variety shows in the outline; the line is clean (no glow/fill).
- **Shape pool** chips restrict which types a throw draws from; the last chip
  can't be turned off.
- Report anything off (fade timings, default `x`, density/sizes, whether the
  small cores read too thin at these strokes) and I'll tune.

## Open questions

1. ~~The rule~~ — **resolved (v3):** boundary of the ≥ x coverage-depth region.
2. ~~Colour~~ — **resolved:** single configurable ink.
3. **Slug** — `005-cluster-cull` no longer describes the rule; keep or rename to
   something like `005-overlap-depth` before first publish?
4. ~~Show the throw / glow~~ — **resolved:** don't; output line only.

## Ideas

- Colour the outline by the depth of the region it bounds (a core at depth 5
  reads hotter than the union edge), via a cosine palette (003's system).
- Fill each ≥ x region faintly during the hold (a translucent wash under the
  line) as an optional toggle.
- A "peel" animation on reveal: sweep `x` from 1 up to its set value so the
  outer union collapses inward to the core, instead of a plain fade.
- `rethrow(seed)` from a seed display to replay a great throw (seed already
  exposed via `getSeed()`).
- Slight per-shape aspect/skew jitter for trapezoid and parallelogram so repeats
  feel less stamped.
