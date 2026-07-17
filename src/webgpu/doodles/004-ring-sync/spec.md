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
than lock to one global rate). `spin` scales the drive rate and flips global
direction; the outermost ring vents to the void so liquid keeps flowing.

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
- **Gates** are arc-length-constant angular cutouts (a gate near the centre
  subtends a larger angle than the same gate far out), with **hard, square
  ends** (straight-sided slots, ~1px AA only). Their arc-length is
  **configurable** (`setGateWidth`), shared by the sim's overlap test and the
  shader. Ring `i`'s inner gate sits at `φ_i + α_i`, its outer gate at
  `φ_i + β_i`; α/β are randomised on reset and fixed in the ring's frame.
- **Gates are canted (angled), never radial, each with its own random
  orientation.** Every gate carries a signed cant: magnitude randomised in
  `[CMIN, CMAX]` (> 0, so no gate is ever perpendicular to the ring — always
  some tangential force when liquid crosses it) and an **independent random
  lean direction** (sign), so no two gates are alike (the range
  `[CMIN, CMAX] = [0.35, 1.70]` is wide on purpose — ~19°–60° from radial — for
  clearly varied angles). In the shader the signed
  cant leans the slot across the wall (a slanted, still-hard-edged parallelogram
  slot). In the sim only the *magnitude* couples flow to spin (see below).
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
**uncapped** (can exceed 1). A gate drives its ring toward `VJET · spin · cant`
— the target rate whose *direction is the gate's own signed orientation*.

- **Liquid model — pressure, not centrifugal.** Liquid fills a channel
  volumetrically; its pressure is its fill P_i (uncapped). Rendered as the whole
  channel with opacity ∝ clamp(P_i) and extra white-hot brightness for
  over-pressure (P_i > 1); the centre core is a full disc.
- **Centre as constant-flow pump + driven rotor (uncapped):** ring 0 injects
  mass at `flowRate · cap_0 · INJECT` per second, tapering to 0 near a soft stall
  `PSTALL` (finite pressure, no hard "full" ceiling; a `PMAX` clamp is a numeric
  backstop only). The centre **rotates at `spin`** so its outlet gate sweeps —
  necessary because a from-rest, fully-gated system can't self-start (no flow →
  no spin → gates never align). It is the one driven element; the outer rings'
  spin still emerges from their gates. Centre → ring 1 flows **only when the
  centre outlet gate overlaps ring 1's inlet**, amount ∝ overlap (so on a fresh
  reset ring 1 stays empty until the first alignment). `flowRate` sets pump
  throughput, live.
- **Pressure-driven transfer.** For an adjacent pair (i, i+1), flow runs only
  where `dP = P_i − P_{i+1} > 0`. Inter-ring flow is gated by gate alignment
  `o = max(0, 1 − |Δgate|/(2w))`, `w = gateHalfArc/r_b`; moved mass
  `dm = min(QMAX/viscosity·o·dP·dt·cap_i, m_i, dP·cap_i·cap_j/(cap_i+cap_j))`
  (last term = overshoot cap; receiver is **not** capped, so it can over-fill).
  The outermost ring vents to the void continuously.
- **Canted gates impart spin, per their orientation.** While dm > 0 with flow
  rate `q = dm/dt`, each gate the liquid crosses drives its ring toward
  `VJET·spin·cant`: `ω += (VJET·spin·cant − ω) · min(0.5, KDRIVE·q·|cant|·dt)` —
  applied to the giver (outer gate), the receiver (inner gate) and the vented
  ring. The *direction* is the gate's signed cant, so a ring's spin direction
  depends on its gates; a radial gate (cant → 0) would impart nothing. Different
  gate orientations pull rings different ways, so the machine need not lock to a
  single rate. The moving liquid additionally **viscously locks**
  neighbours: both are nudged toward their inertia-weighted mean rate by
  `min(0.5, KVISC·q·dt)`.
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
  transfer is active, **liquid is painted into the open gate** (coverage = wall
  band × gate opening × flow intensity), so the flow is visible passing through
  the gate, not just a glow. The outer vent gate streams liquid the same way.
- **Per-ring state** (φ, ω, α, β, fill, burst, cantIn, cantOut) in a
  `read-only` storage buffer sized for the max (24 rings), rewritten each frame.
- **Style:** near-black background; borders light neutral grey with a subtle
  radial shade; liquid the configurable colour with a faint shimmer advected by
  ω (spin visible in the liquid). **Pressure feedback:** the whole channel
  carries liquid whose brightness/opacity rises with fill and tinges toward
  white-hot when highly loaded, so a ring's pressure reads at a glance (empties
  read dark). **Global liquid alpha:** on top of the per-ring opacity, the whole
  liquid's alpha scales continuously with the system's highest outer-ring
  pressure (`sysPressure` uniform, `gAlpha = 0.30 + 0.70·sysP`) — the liquid
  breathes with how loaded the machine is. Active transfers paint a bright
  liquid jet through the open gate (plus a small glow accent); the outer vent
  paints a brief fading streak beyond the last ring. No depth buffer, no meshes,
  no instancing — the section's first pure-SDF piece.

## Control surface

Extra instance methods beyond the contract, wired to the standalone page
(gallery mode ignores them; defaults must look good unattended):

| Method | UI | Notes |
|---|---|---|
| `setRingCount(n)` / `getRingCount()` | slider (3–24) | Triggers a full reset |
| `setSpin(w)` / `getSpin()` | slider (−1.5 – 1.5) | Drive rate scale (each gate targets `VJET·w·cant`); sign flips global direction, magnitude sets vigour; 0 = standstill. Live |
| `setFlowRate(r)` / `getFlowRate()` | slider (0.05–1.2) | Centre pump throughput; live |
| `setViscosity(v)` / `getViscosity()` | slider (0.3–4) | Higher = liquid equalises between rings more slowly (scales inter-ring/vent flow by 1/v); live |
| `setColor(hex)` / `getColor()` | colour input | Liquid colour; uniform-only |
| `setBorderWidth(f)` / `getBorderWidth()` | slider (0.15–0.5) | Fraction of ring pitch; live, fills preserved |
| `setGateWidth(w)` / `getGateWidth()` | slider (0.03–0.2) | Gate half arc-length (normalised); live, no reset |
| `setAutoReset(b)` / `getAutoReset()` | checkbox | Default on |
| `reset(seed?)` / `getSeed()` | button | Re-randomise and restart now |
| `getPressures()` | — (read) | Current per-ring fill 0..1 (index 0 = core); feeds the pressure table |

The standalone page also shows a **ring-pressure table** (top-left): one bar
per ring (core + R1…R_{N-1}) showing its live pressure both as a **percentage**
and as an **absolute value in kPa** (`KPA_FULL = 250` kPa at fill 1; **uncapped**, so
back-pressure reads well above 250 while the bar clamps at 100%), polled from
`getPressures()` on the page's own rAF and rebuilt when `ringCount` changes.

Defaults: 8 rings, spin 0.6, flow 0.4, viscosity 1.0, liquid `#0058AB`,
border 0.3, gate 0.03, auto-reset on. (With the small 0.03 gate, gate
alignments are rare, so full sync is slow — headless ~20–25 min at defaults;
raise `KDRIVE`/`KVISC`/`flow` or the gate size to hasten it.)

## Implementation notes

- **Uniform `Globals` (64 B, 16 f32):** `res.xy`, `time`, `ringCount` |
  `rOuter`, `pitch`, `borderW`(px), `gateHalfArc`(px) | `color.xyz`,
  `sysPressure` | `liquidFade`, `ventBurst`, `ventAngle`, `reserved0`. `color` is
  a vec3 at a 16-byte-aligned offset (32) — no manual padding needed because
  the two preceding vec4-worths fill exactly. **Per-ring `Ring` (32 B, 8
  f32):** `phi, omega, alpha, beta, fill, burst, cantIn, cantOut`; storage array
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
   past 250 kPa. A soft pump stall + hard `PMAX` keep it finite (no true
   infinity is possible with a steady pump and a bottleneck).

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
