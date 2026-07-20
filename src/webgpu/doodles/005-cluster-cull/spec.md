# 005-cluster-cull — Cluster Cull

- **Status:** implemented — awaiting first on-hardware test (Matt runs it)
- **Created:** 2026-07-20
- **Tags:** 2d, sdf, generative, composition, boolean

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
- **Test (JS, once per throw):** bounding-circle reject; quick-accept
  if either shape's centre lies inside the other; otherwise grid-sample the
  AABB overlap box evaluating both SDFs for a jointly-inside point, spacing
  proportional to the smaller shape's size (floored at 0.006 n-units). ≤ 64
  shapes ⇒ ≤ 2016 pairs, nearly all rejected early. Cheap and deterministic.
- **Clustering:** union-find with path compression over the connectivity
  edges. Survivors = members of components with **size ≥ `x`**
  (`minCluster`, 1–10, clamped to `shapeCount`; `x` = 1 keeps everything).
- **Live re-cull:** changing `x` re-filters the already-computed components
  of the *current* throw — no re-throw; the fuse crossfade replays from CULL
  so casualties/survivors re-animate.
- **Empty result:** if no cluster reaches `x`, the cull greys everything out
  and holds the empty verdict briefly (~1s, `EMPTYHOLD`) before re-throwing.

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

Driven by a phase clock accumulated from `dt` (pause/resume coherent):

1. **Throw** (`THROW`, ~1.0s): shapes scale/pop in with a small random
   stagger (per-shape `popDelay`, `POP_DUR` 0.36s), each drawn with its
   **full individual outline** (interior segments included).
2. **Beat** (`BEAT`, ~0.5s): full scatter visible.
3. **Cull & fuse** (`CULL`, ~0.8s): casualties fade + shrink out (and tint
   ink→grey); simultaneously a global `fuse` parameter (smoothstep 0→1)
   crossfades survivors from individual outlines (`|sdf_i|` each) to the union
   outline (`|min sdf|`) — interior segments dissolve and clusters visibly
   fuse.
4. **Hold** (`HOLD`, `holdTime`, default 5s): the surviving composition.
5. **Fade** (`FADE`, ~0.6s) → new seed → next throw.

Range/count changes bake in at the next throw (slider drags never spam
re-throws; a count change while idling in HOLD/EMPTYHOLD throws immediately);
`x` and colour apply live; `rethrow()` skips to a new cycle now.
**Reduced-motion** renders step 4 as the single held frame: `init` throws
(retrying seeds until at least one cluster survives) and sets `fuse = 1`, so
the runtime's one-frame render shows a completed, fused composition.

### Rendering

- Same architecture as 004: **one fullscreen triangle + one fragment
  shader**, no depth buffer, no meshes. `resize` is a no-op (everything
  resolution-relative).
- **Coordinate space ("n-units"):** normalised, centred, scaled by the
  viewport min dimension — `qn = (fragCoord − res/2) / minDim`. Centres and
  sizes live here; stroke widths are px and divided by `minDim` in the shader.
  Positions are laid out from the canvas *aspect at throw time* (half-extents
  `hw = w/2minDim`, `hh = h/2minDim`); a mid-hold resize can nudge a shape to
  the edge, and the next throw re-fits — acceptable per §"resize is a no-op".
- **Per-shape record** in a storage buffer (`array<Shape, 64>`, 12×f32 = 48 B,
  16-aligned): `kind, cx, cy, size, cosR, sinR, strokeHalf, scale, alpha,
  tint, surv, pad`. `scale`/`alpha`/`tint` are animation state written from JS
  each frame; `surv` flags union membership; `fuse`/`globalFade`/`ink` are
  uniforms.
- The pixel loop evaluates each live shape's typed SDF in its local frame:
  survivors feed `survIndiv = max(band·alpha)` **and** the `(min, argmin)`
  union; the crossfade is `mix(survIndiv, unionCov, fuse)`. Casualties
  composite their own greying/fading outline. 64 SDF evaluations per pixel is
  comfortably cheap.
- SDFs: circle and oval are analytic (the ellipse uses the usual `k1(k1−1)/k2`
  approximation — near-exact at the boundary, correct sign throughout so the
  connectivity inside-test is safe); square, triangle, star, trapezoid and
  parallelogram share one iq polygon SDF over hardcoded canonical unit
  vertices (bounding radius 1). The **same vertex tables appear in `doodle.js`
  and `shader.wgsl`** and are diff-checked.
- **Style:** near-black background; a single configurable **ink** colour for
  all outlines (default `#e9e9ee`) with a mild glow (self-bloom + a broad soft
  halo on the union field). Casualties die through a dimmer grey
  (`vec3(0.34,0.35,0.40)`) as they shrink.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setShapeCount(n)` / `getShapeCount()` | slider (5–64) | Next throw (throws now if idling) |
| `setMinCluster(x)` / `getMinCluster()` | slider (1–10) | **Live re-cull** of the current throw |
| `setSizeRange({min,max})` / `getSizeRange()` | dual-thumb slider | Next throw |
| `setRotationRange({min,max})` / `getRotationRange()` | dual-thumb slider (0–360°) | Next throw |
| `setStrokeRange({min,max})` / `getStrokeRange()` | dual-thumb slider (1–12 px) | Next throw |
| `setColor(hex)` / `getColor()` | colour input | Live, uniform-only |
| `setHoldTime(s)` / `getHoldTime()` | slider (2–15 s) | Live |
| `rethrow(seed?)` | button | New seed, new cycle now |
| `getSeed()` / `getStats()` | — | seed; `{thrown, survivors, clusters}` for the stats line |

Defaults: 24 shapes, `x` = 3, size 0.06–0.16, rotation 0–360°, stroke
2–5 px, ink `#e9e9ee`, hold 5s.

**Dual-thumb sliders:** no native HTML control exists; built from two stacked
`<input type="range">` elements with pointer-events routed to the thumbs and
mutual clamping (min ≤ max). One reusable `bindDualRange` in the page,
instanced three times (size, rotation, stroke).

## Implementation notes

- **SDFs exist twice** — WGSL (rendering) and JS (connectivity). They must
  agree or the cull will contradict the pixels. The canonical unit vertex
  tables are kept byte-identical in both files (checked with a diff during the
  build); circle/oval/polygon dispatch and the ellipse approximation match.
- The area-overlap grid sample scales with the *smaller* shape of the pair
  (`0.25·min(size)`, floored at 0.006 n-units); a ~0.004 n-unit inside
  tolerance keeps visually-overlapping pairs connected.
- Union-find components computed once per throw; `x` changes only re-filter
  (`applyCull`). The merge crossfade re-runs (jump back to `CULL`) on a live
  re-cull so promoted/demoted shapes animate rather than pop.
- Animation state is per-shape (`popDelay` stagger); the cycle clock derives
  from accumulated `dt` so pause/resume is coherent.
- Storage buffer rewritten per frame (≤ 64 records — trivial). No GPU resource
  is ever recreated by any control.
- Struct alignment: all-`f32` record, 48-byte stride (overarching spec §9);
  nothing relies on identifier names surviving minification (spec §3).

## What to look for (first on-hardware test)

Serve from the repo root and open `/src/webgpu/doodles/005-cluster-cull/`.
Watch one full cycle and check:

- The throw pops in a readable scatter of seven distinct outlined shape types
  (are the star / trapezoid / parallelogram recognisable at these sizes?).
- At the fuse, overlapping groups of ≥ `x` merge into a single clean composite
  outline with **interior segments gone**; smaller groups grey out and shrink.
- Dragging **min cluster (x)** re-judges the *same* throw live (no re-throw)
  and the survivors/casualties re-animate; the stats line tracks
  thrown/survivors/clusters.
- Stroke-width variety survives into the composite outline (segments keep their
  source shape's width).
- Glow is mild, not a bloom; casualties "die politely"; background stays near
  black. Report anything that reads wrong and I'll tune from there.

## Open questions

1. ~~The rule~~ — **resolved:** union-find over filled-area overlap;
   surviving clusters (≥ `x` members) render as the boolean-union outline,
   interior lines removed. `≥ x` (not strictly greater).
2. ~~Colour~~ — **resolved:** single configurable ink (implemented).
   Per-cluster hue kept as a listed idea (would need a cluster-id per shape in
   the record).
3. ~~Slug~~ — **resolved:** `005-cluster-cull` kept as the permalink.

## Ideas

- Shape-type toggles (enable/disable each of the seven per throw).
- Per-cluster colour mode (was open Q2) as a toggle: each composite figure
  gets its own hue from a cosine palette (borrowing 003's system).
- A "verdict" flourish: a faint fill or underglow inside each fused silhouette
  during the hold.
- Slight per-shape aspect/skew jitter for trapezoid and parallelogram so
  repeats feel less stamped.
- `rethrow(seed)` from a seed display to replay a great composition (the seed
  is already exposed via `getSeed()`).
