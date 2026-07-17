# 004-ring-sync — Ring Sync

- **Status:** wip (spec only — not yet implemented)
- **Created:** 2026-07-17
- **Tags:** 2d, sdf, simulation, physics, generative

*(Slug is a placeholder — rename before first publish; it becomes the
permalink.)*

## Intent

A flat, top-down machine of concentric rings, filling the viewport. Each
ring is a channel with visibly thick borders — walls, not lines — and gates
cut into them: the centre ring has a single gate and spins at a fixed,
driven rate; every other ring has one gate on its inner border and one on
its outer border, all at random orientations, all free-spinning from random
starting angles.

At start, the centre begins producing liquid of a configurable colour at a
configurable rate. Liquid has mass. Whenever two gates line up, liquid
bursts through to the next ring out, and the exchange drags on both rings —
transferring momentum. Over minutes, coupling through the liquid pulls every
ring toward the centre's angular velocity: the machine audibly (visually)
*settles into sync*, which is the whole point of watching. The outermost
ring vents to the void, so liquid flows through the system continuously
rather than pooling.

Mood: hypnotic clockwork-meets-plumbing. The pleasure is in gate near-misses,
sudden bursts of transfer, and the slow emergence of order.

## How it works

### Geometry & sizing

- `ringCount` rings (3–24). The whole assembly is scaled to fill the
  viewport: outer radius = 0.475 · min(viewportW, viewportH), inner
  reserved disc for the centre chamber, remaining radial span divided into
  `ringCount` equal-pitch bands.
- Each band = one **channel** (where liquid sits) bounded by an inner and an
  outer **border** of thickness `borderWidth` (a fraction of the pitch,
  0.15–0.5 — visibly thick).
- **Gates** are angular cutouts in a border: arc-length-constant (so a gate
  on a big outer ring subtends a smaller angle than the same gate near the
  centre), with lightly rounded ends. Centre ring: one gate in its outer
  border. Ring i (i ≥ 1): one gate in its inner border at fixed offset α_i,
  one in its outer border at fixed offset β_i — both randomised on reset,
  fixed in the ring's rotating frame thereafter.
- Everything is resolution-relative, computed in-shader from a resolution
  uniform — there are **no size-dependent GPU resources**; `resize` is a
  no-op.

### Simulation (JS; the GPU only draws)

Per ring i: angle φ_i, angular velocity ω_i, shell mass M_i (∝ mid radius,
so outer rings are heavier), liquid mass m_i, capacity cap_i (∝ channel
area), moment of inertia I_i = (M_i + m_i) · r_mid,i². Centre ring:
kinematically driven — φ_0 advances at constant ω_0 (`spin`, configurable,
may be negative or zero); nothing ever alters it.

- **Liquid model:** within a channel, liquid is friction-locked to its ring
  (co-rotating) and pressed against the **outer border** (centrifugal), so
  it distributes uniformly around the circumference — rendered as an
  annular fill band of thickness ∝ m_i / cap_i hugging the outer wall.
  Consequence: flow through the system is **outward-only**.
- **Production:** the centre chamber gains mass at `flowRate` (mass/s),
  clamped at its capacity (production stalls while full).
- **Transfer:** for each adjacent pair (i, i+1), compute the angular
  overlap of ring i's outer gate with ring i+1's inner gate (both in world
  frame: φ + offset). If overlapping, mass flows outward at
  `q = qMax · overlap01 · fill_i · (1 − fill_{i+1})`
  — aperture × pressure × available capacity (back-pressure stalls flow
  into a full ring). The outermost ring's outer gate vents: mass leaves the
  system at the same formula with the void as an always-empty receiver.
- **Coupling (the momentum mechanic):** while q > 0 between rings i and
  i+1, a viscous torque acts through the moving liquid:
  `τ = k_c · q · r_b² · (ω_i − ω_{i+1})` at the shared boundary radius r_b —
  applied negatively to the giver and positively to the receiver, dragging
  each toward the other. If the giver is the centre ring, only the receiver
  side is applied (the centre is driven). Transferred mass also updates
  m, cap-fill, and therefore I on both sides. Venting applies a small
  reaction torque toward ω of the vented liquid (i.e. none — it co-rotates —
  so venting only sheds inertia).
- **Convergence argument (why sync is inevitable):** the only state with no
  future gate alignments between a pair is zero relative angular velocity.
  Any ring with ω ≠ ω of its inner neighbour will periodically align gates
  → flow → coupling torque toward that neighbour. The centre is fixed at
  ω_0, so ω_0 propagates outward; the unique absorbing state is all rings
  at ω_0. No hidden friction is needed for the effect (a tiny numerical
  damping term is permitted for stability, small enough not to be the
  mechanism).
- **Sync detection & reset:** synced when max|ω_i − ω_0| < ε for 5
  continuous seconds. Then (default) auto-reset: fade the liquid, dissolve,
  re-randomise φ_i, α_i, β_i, small random initial ω_i, refill from the
  centre. A toggle can hold the synced state instead.
- **Integration:** fixed-step substeps (e.g. 240 Hz accumulator) inside
  `frame`, independent of display rate; state uploaded once per rendered
  frame. Seeded RNG so a reset can be replayed (see Ideas).

### Rendering

- **One fullscreen triangle + one fragment shader.** Per-pixel: convert to
  polar (r, θ) about the viewport centre; the constant ring pitch means the
  band index is `floor((r − r_inner) / pitch)` — O(1), no per-ring loop.
  Evaluate an SDF for: border arcs (minus their gate cutouts), channel
  liquid band (fill thickness from that ring's state), centre chamber pool.
  ~1px smoothstep anti-aliasing on every edge.
- **Per-ring state** (φ, fill, plus static α, β, radii) in a storage buffer
  sized for the max (24 rings), rewritten each frame — tiny.
- **Style:** near-black background; borders a light neutral grey with a
  subtle radial shade so they read as solid parts; liquid is the
  configurable colour with a mild glow (brighter core, soft falloff) and a
  faint animated shimmer advected by the ring's ω so spin is visible in the
  liquid itself, not just the gates. During an active transfer, the
  overlapping gate region gets a short bright **burst** highlight — the
  main motion cue for the fill-band model.
- Vented liquid: a brief fading streak beyond the outer ring at the vent
  angle (pure shader effect, no particle system).
- No depth buffer, no meshes, no instancing — this doodle is the section's
  first pure-SDF piece and deliberately exercises a different slice of the
  runtime than 001–003.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setRingCount(n)` / `getRingCount()` | slider (3–24) | Triggers a full reset |
| `setSpin(w)` / `getSpin()` | slider (−1.5 – 1.5 rad/s) | Centre's driven rate; live, no reset |
| `setFlowRate(r)` / `getFlowRate()` | slider | Production rate; live |
| `setColor(hex)` / `getColor()` | colour input | Liquid colour; uniform-only |
| `setBorderWidth(f)` / `getBorderWidth()` | slider (0.15–0.5) | Fraction of ring pitch; live |
| `setAutoReset(b)` / `getAutoReset()` | checkbox | Default on |
| `reset()` | button | Re-randomise and restart now |

Defaults: 8 rings, spin 0.6 rad/s, mid flow rate, liquid `#56b6c2`, border
0.3, auto-reset on.

## Implementation notes

- The sim must be **frame-rate independent** (fixed substeps) — coupling
  torques integrated at display rate would make convergence speed depend on
  the viewer's monitor.
- Gate overlap must handle angle wrap-around correctly (compare on the
  circle, not the line); keep all angles wrapped to [0, 2π).
- `setSpin` through zero is legal — everything then converges to a
  standstill, which is its own (slightly bleak) show.
- Changing `ringCount` re-derives radii/pitch and resets; changing
  `borderWidth` only reshapes geometry in-shader (capacities re-derived,
  fills preserved proportionally — no reset).
- Storage buffer allocated at max ring count; draw logic reads
  `ringCount` from the uniform block. No GPU resource recreation for any
  control.
- Watch uniform/storage alignment (overarching spec §9): per-ring struct
  padded to 16 bytes; scalars bundled into vec4 slots.
- Reduced-motion single frame renders a coherent mid-run pose (state is
  well-defined at any instant); nothing depends on identifier names
  surviving minification (spec §3).

## Open questions (confirm before implementation)

1. **Liquid visual model** — specced as a uniform fill band hugging each
   channel's outer wall (+ gate-burst highlights + shimmer). The
   alternative is discrete slugs of liquid you watch travel around
   channels: prettier, ~3–4× the sim & shader complexity. Fill band OK?
2. **Outermost ring vents to the void** — required for continuous flow and
   the sync mechanic (a closed system fills up and goes inert). Confirm
   the vent (with the little exit streak), or propose an alternative sink.
3. **Outward-only flow** — falls out of the centrifugal model. If you
   wanted bidirectional exchange (pressure equalisation both ways) the
   coupling still works but the visual story is muddier. Assume
   outward-only?
4. **Auto-reset on sync** (hold-forever available as a toggle) — right
   default?
5. **Slug — I mean slug the name**: `004-ring-sync` is a placeholder.

## Ideas

- Discrete slug mode (per Open Q1) as a later variant or quality tier.
- A thin sync meter: per-ring tick marks that glow as |ω_i − ω_0| → 0, so
  progress toward sync is legible at a glance.
- Seed display + `reset(seed)` so a particularly good run can be replayed
  or shared.
- Sound-reactive spin rate (Web Audio) — the whole machine breathing with
  music.
- Colour per ring sampled from a cosine palette (borrowing 003's palette
  system) instead of a single liquid colour.