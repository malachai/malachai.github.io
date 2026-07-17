# 004-ring-sync — Ring Sync

- **Status:** wip (implemented — awaiting first on-hardware run & tuning)
- **Created:** 2026-07-17
- **Tags:** 2d, sdf, simulation, physics, generative

*(Slug confirmed: `004-ring-sync` — it is now the permalink; don't rename.)*

## Intent

A flat, top-down machine of concentric rings, filling the viewport. Each
ring is a channel with visibly thick borders — walls, not lines — and gates
cut into them, one on each border, at random orientations. **Every ring
starts completely at rest.**

The centre is a **constant-flow pump** (configurable colour). **Pressure — not
centrifugal force — pushes liquid outward** through the gates, and pressure is
**uncapped**: if the gates/viscosity restrict outflow the system builds real
back-pressure (well past a single "full" ring), bounded only by a soft pump
stall. The gates are **angled (canted, never radial), each at its own random
orientation**, so liquid crossing a gate always exerts a tangential force —
and **the gate's orientation sets the direction its ring spins**. Spin comes
*only* from the moving liquid, emerging from zero; because each ring is driven
by its own gates, rings may spin at different rates and directions (viscous
coupling still pulls neighbours together, so they may partially sync rather
than lock to one global rate). Each ring's spin direction and rate come entirely
from its gate orientation and the driving pressure — **there is no separate
drive/spin control**. The outermost ring vents to the void so liquid keeps
flowing.

Mood: hypnotic clockwork-meets-plumbing. The pleasure is in gate near-misses,
sudden bursts of transfer, and the slow emergence of order.

## How it works

### Geometry & sizing

- `ringCount` rings (3–24), **including the centre**. The whole assembly is
  scaled to fill the viewport: outer radius `rOuter = 0.475 · min(W, H)`;
  equal pitch `pitch = rOuter / ringCount`. Ring `i` occupies the band
  `[i·pitch, (i+1)·pitch]`. **Ring 0 is the centre chamber** — a disc
  `[0, pitch]` with only an outer border (one gate). Rings `1 … N-1` are
  annular channels, each with an inner and an outer border.
- **Borders are shared walls.** The wall at boundary radius `r_k = k·pitch`
  (for `k = 1 … N`) has full thickness `borderWidth · pitch` and is split
  radially into two half-borders: the inner half is ring `k-1`'s outer
  border (gate offset `β_{k-1}`), the outer half is ring `k`'s inner border
  (gate offset `α_k`). Liquid only passes where **both** half-gates line up,
  so near-misses read as the two notches sliding past each other. The
  outermost wall (`k = N`) has only its inner half — ring `N-1`'s outer
  border — whose gate is the vent to the void.
- **Gates are formed by `numShearLines` spiral "shear lines"** (`setShearLines`,
  default 3) that start at the centre and spiral outward through the rings. Each
  line cuts one gate per ring border, so every ring has `M = numShearLines`
  evenly-spaced gates (2π/M apart). Within a ring the gate is **one continuous
  sheared slot**: its centre shears with radius about the ring mid by the ring's
  `shear` amount, so the inlet (inner border) and outlet (outer border) lie on
  the same slot — their **left edges line up and their right edges line up**
  (same angular width, so the inner opening is naturally a little smaller in
  arc-length). The spiral base `g0` accumulates the shear outward so each ring's
  outlet connects to the next ring's inlet (continuous lines at reset, when all
  `φ_i = 0`).
- **Gate orientation** is the **angle of the gate's sides**, set per ring by a
  **min/max range in degrees** (`setOrientMin`/`setOrientMax`, 1°–179°, driven by
  a single paired-thumb slider whose ends can't cross). The **shear lines locate
  the gate's centre**; orientation then tilts the two sides of the slot about that
  centre (90° = radial, sides straight; away from 90° the sides cant). Each ring
  draws a random orientation in `[orientMin, orientMax]`; the orientation becomes
  the ring's `shear`
  (cant) as `shear = (orient − 90°)`, so **90° is a radial slot (zero shear, no
  drive)**, below 90° leans one way and above 90° the other. This single control
  replaces the old spiral-tightness slider and the random-shear checkbox — the
  spread of the range *is* the per-ring variation, and keeping the range off 90°
  guarantees every gate exerts some tangential force. `g0` still accumulates the
  per-ring shear outward so the slots connect ring-to-ring.
- **Gate width** is a **fraction of the circumference**, assigned per ring from a
  **min/max range** (`setGateMin`/`setGateMax`, shown as %): each ring draws a
  random width `gw` in `[gateMinFrac, gateMaxFrac]` (equal min = max → uniform
  width). Hard square ends, ~1px AA. Half-width `= gw · π`; with M evenly-spaced
  gates the sim folds the phase gap into the nearest gate and opens a pair by
  `overlap = max(0, 1 − d/((gw_i + gw_j)·π))` (the two rings' half-widths).
- Everything is resolution-relative, computed in-shader from a resolution
  uniform — there are **no size-dependent GPU resources**; `resize` is a
  no-op.

### Simulation (JS; the GPU only draws)

The sim runs in **normalised radii (`rOuter = 1`)** so mass, capacity and
inertia are viewport-independent; only the per-frame uniform upload converts
radii to device pixels.

Per ring i: angle φ_i, angular velocity ω_i (**all start at 0**), shell mass
`M_i = SHELL · r_mid,i` (outer rings heavier), liquid mass m_i, capacity cap_i
(= channel area, the shared π dropped), pressure P_i = f_i = m_i/cap_i, moment
of inertia `I_i = (M_i + m_i) · r_mid,i²`. Pressure P_i = m_i/cap_i is
**uncapped** (can exceed 1). A gate drives its ring toward `VJET · cant · jetP ·
(gw/GATE_REF)` — the target rate whose *direction is the gate's own signed
orientation* and whose *magnitude is set by pressure and gate width* (no drive
control).

- **Liquid model — pressure, not centrifugal.** Liquid fills a channel
  volumetrically; its pressure is its fill P_i (uncapped). Rendered as the whole
  channel with opacity ∝ clamp(P_i) and extra white-hot brightness for
  over-pressure (P_i > 1); the centre core is a full disc.
- **Centre (inner ring) — constant-flow pump, emergent spin (uncapped):** ring 0
  is the pump but is **not driven at a fixed speed** — its rotation emerges
  purely from the liquid flowing out through its own gate (`driveGate(0, …)`,
  exactly like every other ring), so it depends on the flow and the gate shear.
  Its outlet gate sweeps —
  which lets the machine self-start (a from-rest, fully-gated system otherwise
  can't) and finds ring 1's inlet on its own. It injects mass at a **constant**
  `flowRate · cap_0 · INJECT` per second **regardless of back-pressure** — there
  is no stall and no hard clamp. Pressure is instead bounded by physics: the
  outer ring vents (ungated, ∝ pressure), so at steady state inflow = vent
  outflow and every ring's pressure settles at a finite value (headless: peak
  pressure ~linear in `flowRate`). Centre → ring 1 flows **only when the outlet
  overlaps ring 1's inlet**, amount ∝ overlap (so on a fresh reset ring 1 stays
  empty until the sweep reaches it). `flowRate` sets pump throughput, live.
- **Pressure-driven transfer.** For an adjacent pair (i, i+1), flow runs only
  where `dP = P_i − P_{i+1} > 0`. Inter-ring flow is gated by gate alignment
  `o = max(0, 1 − |Δgate|/(2w))`, `w = gateHalfArc/r_b`; moved mass
  `dm = min(QMAX/viscosity·o·dP·dt·cap_i, m_i, dP·cap_i·cap_j/(cap_i+cap_j))`
  (last term = overshoot cap; receiver is **not** capped, so it can over-fill).
  The outermost ring vents to the void continuously.
- **Sheared gates impart spin — a function of pressure and gate width, uncapped.**
  While dm > 0 with flow rate `q = dm/dt`, each gate drives its ring toward a
  **terminal rate** `target = −VJET·shear·jetP·(gw/GATE_REF)`, where `shear`
  is the ring's signed cant, `jetP` is the driving (giver) pressure and `gw` is
  the ring's gate width (`GATE_REF = 0.03` is the reference width). There is **no
  cap** on this target — a ring that keeps gaining pressure, or that has a wider
  gate, keeps speeding up. The ring relaxes toward it at
  `ω += (target − ω) · min(0.5, KDRIVE·q·|shear|·dt)`, applied to giver, receiver
  and vented ring; because `q` itself grows with gate width (overlap) and
  pressure (`dP`), a wider/higher-pressure gate also spins its ring up *faster*.
  The *direction* is the shear's sign, negated so the induced spin matches the
  gate's on-screen lean. A radial gate (90° → cant 0) imparts nothing. The moving
  liquid additionally **viscously locks** neighbours: both are nudged toward
  their inertia-weighted mean rate by `min(0.5, KVISC·q·dt)`. Rotation is bounded
  in practice only by the pressure the physics actually reaches (below), not by
  any fixed ceiling — headless it scales ~linearly with `flowRate` (flow 0.4 →
  peak ω ≈ 2–3 rad/s; flow 1e6 → millions, finite).
- **Emergent behaviour:** rings spin up from rest, each driven by its own gates
  and coupled by viscosity. Because gate orientations differ, rings can settle
  to different rates/directions rather than one global rate; pressure climbs and
  can peg near the stall under the small default gate (headless: finite, ω
  bounded ~±1, core pressure climbs into the thousands of kPa). Speed/character
  are set by `KDRIVE`/`KVISC`/`flowRate`/`INJECT`/`SHELL`/`viscosity`/gate size.
- **Sync detection & reset:** synced when the ω spread `< EPS` **and** the mean
  rate `> SYNC_MIN_RATE` for `SYNC_HOLD` continuous seconds — with
  gate-orientation-dependent spin this may seldom fire (that's expected). On
  sync (auto-reset on): short dissolve (`FADE_DUR`), re-randomise φ_i, α_i, β_i
  and per-gate cants, ω_i = 0. `setAutoReset(false)` holds.
- **Integration:** fixed 240 Hz substeps inside `frame` (accumulator, capped
  at 8 steps/frame), independent of display rate; state uploaded once per
  rendered frame. Seeded RNG (mulberry32) so `reset(seed)` replays a run.

### Rendering

- **One fullscreen triangle + one fragment shader.** Per-pixel: polar (r, θ)
  about the viewport centre; constant pitch gives band index `floor(r/pitch)`
  and nearest boundary `round(r/pitch)` — O(1), no per-ring loop. SDFs draw
  the sub-wall half-borders (minus their **canted, hard-edged** gate cutouts —
  the slot leans across the wall by `cantSign · cant`), the volumetric channel
  liquid, and the centre core. ~1px smoothstep AA on every edge. While a
  transfer is active, the open gate is filled with the **average of the two
  sides' rendered liquid** — each side = liquid colour over the background at
  that ring's opacity (`fill/centreP`), averaged — so the result sits between the
  two and is never brighter than either (no glow or flash). The outer vent gate
  streams liquid the same way; there is **no additive vent glow** (a former
  bright bloom beyond the last ring was removed).
- **Per-ring state** (φ, ω, α, β, fill, burst, cantIn, cantOut, wIn, wOut — 10
  f32, 40-byte stride) in a `read-only` storage buffer sized for the max (24
  rings), rewritten each frame.
- **Style:** near-black background. **Walls are a uniform grey that heats up
  with rotation speed** — each half-wall reads its owning ring's |ω| and ramps
  grey → red → yellow (with a hot glow) as `|ω| → HEATMAX`, so faster rings look
  hotter. **Liquid is the selected colour** (no white bloom); its **alpha is
  normalised to the CENTRE ring's pressure** (`u.centreP` = fill of ring 0) — the
  **centre reads fully opaque** and every outer ring's transparency is
  proportional to its pressure relative to the centre (an empty ring is fully
  transparent). Because pressure falls off outward, the centre is normally the
  system max, so rings fade outward as they lose pressure. Liquid has a faint
  shimmer advected by ω (spin visible in the liquid). Active transfers show the
  liquid crossing the open gate at normal brightness (no glow accent). The
  outermost wall is cut **hard at `rOuter`** so no faint pixels bleed past the
  last ring's edge (no ghost line around the vent gate). No depth buffer, no
  meshes, no instancing — the section's first pure-SDF piece.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setRingCount(n)` / `getRingCount()` | slider (3–24) | Triggers a full reset |
| `setFlowRate(r)` / `getFlowRate()` | slider **log 0.01–1e6** | Centre pump throughput (the slider carries log10(flow)); live |
| `setViscosity(v)` / `getViscosity()` | slider (0.3–4) | Higher = liquid equalises between rings more slowly (scales inter-ring/vent flow by 1/v); live |
| `setColor(hex)` / `getColor()` | colour input | Liquid colour; uniform-only |
| `setBorderWidth(f)` / `getBorderWidth()` | slider (0.15–0.5) | Fraction of ring pitch; live, fills preserved |
| `setShearLines(n)` / `getShearLines()` | slider (1–8) | Number of spiral shear lines = gates per ring; live |
| `setGateMin(f)` / `setGateMax(f)` (+ getters) | **paired-thumb** slider (0.5–30%) | Gate width range (fraction of circumference); per-ring width drawn in [min,max]; equal → uniform. Thumbs can't cross (min ≤ max, clamped in the setters too); live |
| `setOrientMin(d)` / `setOrientMax(d)` (+ getters) | **paired-thumb** slider (1–179°) | Gate orientation range (angle of the sides); per-ring orientation drawn in [min,max]; 90° = radial (no spin). Thumbs can't cross; live |
| `setAutoReset(b)` / `getAutoReset()` | checkbox | Default on |
| `reset(seed?)` / `getSeed()` | button | Re-randomise and restart now |
| `getPressures()` / `getSpeeds()` | — (read) | Current per-ring fill 0..1 and angular speed (rad/s, signed); feed the ring table |

The standalone page also shows a **ring table** (top-left): one row per ring
(core + R1…R_{N-1}) with a palette-tinted bar and its live **pressure** (as a
percentage and absolute kPa — `KPA_FULL = 250` kPa at fill 1, **uncapped**, so
back-pressure reads well above 250 while the bar clamps at 100%) and its
**speed** (rad/s, signed). Polled from `getPressures()`/`getSpeeds()` on the
page's own rAF and rebuilt when `ringCount` changes; the bar colours mirror the
shader's `ringColor`.

Defaults: 8 rings, flow 0.4, viscosity 1.0, liquid `#0058AB`,
border 0.3, 3 shear lines, gate width 2–5%, orientation 100–150°, auto-reset on.
(With small gates, gate alignments are rare, so full sync is slow — headless
~20–25 min at defaults; raise `KDRIVE`/`KVISC`/`flow` or the gate widths to
hasten it.)

## Implementation notes

- **Uniform `Globals` (64 B, 16 f32):** `res.xy`, `time`, `ringCount` |
  `rOuter`, `pitch`, `borderW`(px), `gateFrac`(unused) | `color.xyz`,
  `centreP` | `liquidFade`, `ventBurst`, `ventAngle`, `shearLines`. `color` is
  a vec3 at a 16-byte-aligned offset (32) — no manual padding needed because
  the two preceding vec4-worths fill exactly. `gateFrac` (slot 7) is now unused —
  gate width is per-ring in the storage buffer (`Ring.gw`). **Per-ring `Ring`
  (32 B, 8 f32):** `phi, omega, g0, shear, fill, burst, gw, p7`; storage array
  stride is 32 (all f32), matching the JS writes.
- **Tunable sim constants** (top of `doodle.js`): `QMAX`, `VJET` (Ω scale),
  `KDRIVE` (gate spin drive), `KVISC` (neighbour lock), `SHELL`, `CMIN/CMAX`
  (gate cant range), `EPS`, `SYNC_MIN_RATE`, `SYNC_HOLD`, `BURST_*`.
  `KDRIVE`/`KVISC`/`flowRate`/`SHELL` set how fast it spins up and syncs —
  expect to tune against a real run; sync takes on the order of minutes.
- The sim is **frame-rate independent** (fixed 240 Hz substeps) so
  convergence speed doesn't depend on the viewer's monitor.
- Gate overlap and all angle handling wrap on the circle (`wrapDelta`), angles
  kept in [0, 2π).
- `setSpin` through zero → Ω = 0 → no drive → the machine winds down to a
  standstill (gates stay visibly canted; there's simply no flow force). Sign
  flips the cant/drive direction live.
- Changing `ringCount` re-derives radii/pitch and resets; changing
  `borderWidth` only re-derives capacities in JS and reshapes geometry
  in-shader (fills preserved proportionally — no reset).
- Storage buffer allocated at max ring count; the shader reads `ringCount`
  from the uniform. No GPU resource recreation for any control, and `resize`
  is a no-op.
- Reduced-motion renders one coherent mid-run pose (state is well-defined at
  any instant). Nothing depends on identifier names surviving minification
  (§3): controls are object properties (preserved) and RNG is value-based.

## Decisions

Resolved 2026-07-17 (initial):

1. **Outermost ring vents to the void** — with the little exit streak. Required
   for continuous flow.
2. **Auto-reset on sync** — default on; hold-forever via `setAutoReset(false)`.
3. **Slug `004-ring-sync`** — permanent.

Revised 2026-07-17 (model overhaul — supersedes the original centrifugal /
driven-centre design):

4. **Pressure, not centrifugal.** Liquid is pushed outward by pressure
   (fill-gradient), rendered volumetrically with brightness ∝ pressure. The old
   outer-wall fill band is gone.
5. **Angled gates impart spin; fully emergent.** No ring is driven; all start at
   rest. Canted gates convert flow into a tangential drive toward a common rate
   Ω, so spin emerges only from the liquid and the rings settle into sync at Ω.
6. **No gate is ever radial; each has a random orientation.** Every gate carries
   a signed cant with magnitude `[CMIN, CMAX] > 0` (always some tangential force)
   and an independent random lean direction, so no two gates are alike. The sim
   couples flow to spin via `|cant|`; `spin`'s sign sets the common direction.
7. **Liquid visual — volumetric fill** (was: fill band). Discrete slugs still
   deferred to a later variant (see Ideas).
8. **Spin direction follows each gate's orientation** (signed cant drive toward
   `VJET·spin·cant`), so rings can spin different ways and the machine need not
   globally sync — an accepted trade for physically honest gates.
9. **Uncapped pressure.** The centre is a constant-flow pump; ring pressure is
   not clamped at capacity, so real back-pressure builds and the table reads
   past 250 kPa. Bounded by the ungated outer vent (a linear drain), not by any
   ceiling — see decision 14, which removed the earlier stall/clamp.

Revised 2026-07-17 (gate controls + final-ring cleanup):

10. **Gate width is a min/max range, per ring.** `setGateMin`/`setGateMax` (as %
    of circumference); each ring draws a random width in the range (equal → uniform).
    Overlap uses the two rings' summed half-widths `(gw_i+gw_j)·π`. `Ring.gw`
    (storage slot 6) carries it; the old uniform `gateFrac` uniform (slot 7) is
    now unused.
11. **Gate orientation is a min/max range (1°–179°), replacing spiral tightness +
    random-shear.** Each ring draws a random orientation in `[orientMin, orientMax]`;
    `shear = orient − 90°`, so 90° is radial (no spin) and the range's spread is the
    per-ring variation. `setSpiral`/`setShearRandom` and the `dirSign` array are gone.
12. **Liquid alpha normalised to the CENTRE ring** (`u.centreP` = ring 0's fill),
    not the system max. The centre reads fully opaque; every outer ring's
    transparency is its pressure ÷ the centre's. Gate-fill sides use the same
    denominator.
13. **Vent glow removed; outer rim hard-cut.** The additive bright bloom beyond
    the last ring is gone (the vent now shows only through the wall's gate fill),
    and the outermost wall band is clamped hard at `rOuter` so no faint pixels
    ghost past the last gate's edge.
14. **Rotation = f(pressure, gate width); no artificial ceilings.** The drive
    terminal rate is `VJET·cant·jetP·(gw/GATE_REF)` — proportional to the
    driving pressure and the gate width — and is no longer clamped (`WMAX` gone).
    Pressure is no longer clamped either: the pump injects at a constant rate with
    no soft stall and no hard `PMAX`; the ungated outer vent provides the linear
    drain that gives a finite steady state. Headless verification: finite across
    seeds and 600 s runs, with peak pressure and peak ω scaling ~linearly with
    `flowRate` (e.g. flow 1e6 → ω in the millions, still finite).
15. **`drive`/`spin` control removed.** Spin direction and rate now come solely
    from gate orientation (the cant's sign and size) and the driving pressure ×
    gate width — there is no global drive knob. `setSpin`/`getSpin` and the slider
    are gone; `VJET` is a fixed internal gain.
16. **Width & orientation are paired-thumb range sliders.** Each is one control
    with two thumbs that cannot cross (min ≤ max, also clamped in the setters).
    **Orientation clarified:** the shear lines locate the gate's *centre*;
    orientation sets the *angle of the sides* (the slot's tilt about that centre),
    90° being a straight radial slot. (The shear-line spiral that connects one
    ring's outlet to the next ring's inlet is still built from the per-ring cant,
    so tilted gates line up across walls and the machine self-starts.)

## Ideas

- Discrete slug mode (per decision 1) as a later variant or quality tier.
- A thin sync meter: per-ring tick marks that glow as ω_i → Ω (spread → 0), so
  progress toward sync is legible at a glance.
- Seed display + `reset(seed)` so a good run can be replayed or shared
  (`getSeed()` already exposes the current seed).
- Sound-reactive spin rate (Web Audio) — the whole machine breathing with
  music.
- Colour per ring sampled from a cosine palette (borrowing 003's palette
  system) instead of a single liquid colour.
