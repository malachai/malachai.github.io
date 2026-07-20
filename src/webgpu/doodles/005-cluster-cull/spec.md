# 005-cluster-cull — Cluster Cull

- **Status:** wip (spec agreed on the core rule — not yet implemented)
- **Created:** 2026-07-20
- **Tags:** 2d, sdf, generative, composition, boolean

*(Slug is a placeholder — rename before first publish; it becomes the
permalink.)*

## Intent

A generative composition machine. Each cycle it throws a configurable number
of outlined shapes — circle, square, triangle, oval, star, trapezoid,
parallelogram — onto the canvas at random positions, sizes, orientations, and
stroke widths. Then the cull: shapes are grouped into clusters by overlap
(union-find over filled-area intersection), and only clusters of **at least
`x` shapes** survive. Each surviving cluster is drawn as the **outline of the
boolean union** of its shapes — interior line segments dissolve, leaving one
composite silhouette per cluster: a union of lines contributed by at least
`x` shapes. Everything else fades away. Hold, admire, re-throw.

The pleasure is the fuse: a chaotic scatter of full outlines resolving into a
few clean merged figures. Dragging the `x` slider re-judges the current throw
live, which makes the rule itself a toy.

## How it works

### The throw

- `shapeCount` shapes (5–64). Each shape gets, independently:
  - **type:** uniform random among the 7 (circle, square, triangle, oval,
    star (5-point), trapezoid, parallelogram — canonical proportions,
    scaled/rotated per instance);
  - **size:** uniform random in `[sizeMin, sizeMax]` (bounding radius, as a
    fraction of viewport min-dimension);
  - **rotation:** uniform random in `[rotMin, rotMax]` degrees;
  - **stroke width:** uniform random in `[strokeMin, strokeMax]` px.
  - Min/max pattern throughout: if min = max the value is constant;
    otherwise uniform in the range. (Circle/oval ignore rotation only in
    effect, not in code — keep the path uniform.)
- **Position:** uniform random inside the viewport inset by the shape's
  bounding radius + half stroke, so every shape lands fully on-canvas.
- Seeded RNG (one seed per throw) so a throw is reproducible.

### The cull (union-find over area overlap)

- **Connectivity:** shapes i and j are connected iff their **filled areas
  overlap** — some point p exists with `sdf_i(p) ≤ 0` and `sdf_j(p) ≤ 0`.
  Note this means containment connects: a shape wholly inside another is in
  its cluster (it counts toward the `x` tally but contributes no visible
  line — it's entirely interior to the union).
- **Test (JS, once per throw):** bounding-circle/AABB reject; quick-accept
  if either shape's centre lies inside the other; otherwise grid-sample the
  AABB overlap box evaluating both SDFs for a jointly-inside point, spacing
  proportional to the smaller shape's size (with a floor). ≤ 64 shapes ⇒
  ≤ 2016 pairs, nearly all rejected early. Cheap and deterministic.
- **Clustering:** union-find with path compression over the connectivity
  edges. Survivors = members of components with **size ≥ `x`**
  (`minCluster`, 1–10, clamped to `shapeCount`; `x` = 1 keeps everything).
- **Live re-cull:** changing `x` re-filters the already-computed components
  of the *current* throw — no re-throw; casualties/survivors re-animate.
- **Empty result:** if no cluster reaches `x`, hold the empty verdict
  briefly (~1s) and re-throw early.

### The union outline (what survivors become)

Each surviving cluster renders as the outline of the boolean union of its
member shapes — the composite border is stitched from arcs of the members,
with each segment keeping the stroke width of the shape it came from:

- Per pixel, over **all surviving shapes**: `dU = min_i(sdf_i)`, tracking
  `argmin`. The drawn line is `|dU| ≤ w_argmin / 2` (AA smoothstep). Border
  segments lying inside another member go deeply negative and are
  suppressed — interior lines vanish for free.
- No per-cluster grouping is needed in the shader: two shapes in *different*
  clusters have no area overlap by definition, so they can never suppress
  each other's lines; a single min over all survivors is correct.
- Per-segment stroke width falls out of the argmin, so the min/max stroke
  variety carries through into the composite outline.

### The cycle

1. **Throw** (~1.0s): shapes scale/pop in with a small random stagger, each
   drawn with its **full individual outline** (interior segments included).
2. **Beat** (~0.5s): full scatter visible.
3. **Cull & fuse** (~0.8s): casualties fade + shrink out; simultaneously a
   global merge parameter crossfades survivors from individual outlines
   (`|sdf_i|` each) to the union outline (`|min sdf|`) — interior segments
   dissolve and the clusters visibly fuse into composite figures.
4. **Hold** (`holdTime`, default 5s): the surviving composition.
5. **Fade** (~0.6s) → new seed → next throw.

Range/count changes bake in at the next throw (slider drags never spam
re-throws); `x` and colour apply live; `rethrow()` skips to a new cycle.
Reduced-motion renders step 4 (a completed, fused composition) as the single
frame.

### Rendering

- Same architecture as 004: **one fullscreen triangle + one fragment
  shader**, no depth buffer, no meshes. `resize` is a no-op (everything
  resolution-relative).
- Per-shape record in a storage buffer (allocated at max 64, 16-byte
  aligned): type, centre, size, rotation (as cos/sin), stroke half-width,
  and animation state (phase + alive/culled flag) driven from JS each frame.
- The pixel loop evaluates each live shape's typed SDF in its local frame
  and accumulates both the individual-outline term and the (min, argmin)
  union term; the global merge parameter blends them (step 3 above). 64 SDF
  evaluations per pixel is comfortably cheap at this complexity.
- SDFs: the seven shapes use standard exact/near-exact 2D SDFs (the ellipse
  uses the usual good approximation — stroke uniformity is visually fine at
  these widths).
- **Style:** near-black background; a single configurable **ink** colour
  for all outlines with a mild glow, matching the section's aesthetic.
  Casualties fade through a dimmer grey as they shrink (they die politely).

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setShapeCount(n)` / `getShapeCount()` | slider (5–64) | Next throw |
| `setMinCluster(x)` / `getMinCluster()` | slider (1–10) | **Live re-cull** of the current throw |
| `setSizeRange({min,max})` / `getSizeRange()` | dual-thumb slider | Next throw |
| `setRotationRange({min,max})` / `getRotationRange()` | dual-thumb slider (0–360°) | Next throw |
| `setStrokeRange({min,max})` / `getStrokeRange()` | dual-thumb slider (1–12 px) | Next throw |
| `setColor(hex)` / `getColor()` | colour input | Live, uniform-only |
| `setHoldTime(s)` / `getHoldTime()` | slider (2–15 s) | Live |
| `rethrow()` | button | New seed, new cycle now |

Defaults: 24 shapes, `x` = 3, size 0.06–0.16, rotation 0–360°, stroke
2–5 px, ink `#e9e9ee`, hold 5s.

**Dual-thumb sliders:** no native HTML control exists; build a small custom
one from two stacked `<input type="range">` elements with pointer-events
routed to the nearer thumb and mutual clamping (min ≤ max). One reusable
snippet in the page, instanced three times.

## Implementation notes

- **SDFs exist twice** — WGSL (rendering) and JS (connectivity). They must
  agree or the cull will contradict the pixels. Keep both copies adjacent
  in the source with a shared comment block, same parameterisation, same
  canonical proportions; any change edits both.
- The area-overlap grid sample must scale with the *smaller* shape of the
  pair — a small shape overlapping a big one only slightly is easy to miss
  with a coarse grid. Floor the spacing; a ~0.5 px tolerance on the inside
  test keeps visually-overlapping pairs connected.
- Union-find components computed once per throw; `x` changes only
  re-filter. The merge crossfade re-runs on a live re-cull so promoted /
  demoted shapes animate rather than pop.
- Animation state is per-shape (phase offsets for stagger); the cycle clock
  derives from accumulated `dt` so pause/resume is coherent.
- Storage buffer rewritten per frame (≤ 64 records — trivial). No GPU
  resource ever recreated by any control.
- Watch struct alignment (overarching spec §9); nothing relies on
  identifier names surviving minification (spec §3).

## Open questions (confirm before implementation)

1. ~~The rule~~ — **resolved:** union-find over filled-area overlap;
   surviving clusters (≥ `x` members) render as the boolean-union outline,
   interior lines removed. `≥ x` (not strictly greater), per the original
   brief.
2. **Colour** — single configurable ink (specced). Alternative: colour per
   surviving cluster (each composite figure gets its own hue from a cosine
   palette, borrowing 003's system). Ink is calmer; per-cluster is more
   legible when several clusters survive. Preference?
3. **Slug** — `005-cluster-cull` is a placeholder.

## Ideas

- Shape-type toggles (enable/disable each of the seven per throw).
- Per-cluster colour mode (open Q2) as a toggle rather than either/or.
- A "verdict" flourish: a faint fill or underglow inside each fused
  silhouette during the hold.
- Slight per-shape aspect/skew jitter for trapezoid and parallelogram so
  repeats feel less stamped.
- Seed display + `rethrow(seed)` to replay a great composition (shared
  pattern with 004's idea list).
- Stats line in standalone mode: shapes thrown / survivors / cluster count.