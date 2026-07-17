// 004-ring-sync — concentric ring machine, pure-SDF fragment.
// One fullscreen triangle + one fragment shader; the JS sim writes per-ring
// state each frame and the shader only draws. Doodle owns group(0):
//   binding(0) uniform Globals, binding(1) read-only storage array<Ring>.
// See spec.md §9. All radii here are in device pixels; the sim runs in
// normalised units (outer radius = 1) and hands over pixel radii per frame.

const PI  : f32 = 3.14159265359;
const TAU : f32 = 6.28318530718;
const HEATMAX : f32 = 5.0;   // |ω| (rad/s) at which a wall reads fully "hot"

struct Globals {
  res         : vec2<f32>,   // framebuffer size (px)
  time        : f32,
  ringCount   : f32,         // N (3..24)
  rOuter      : f32,         // outer radius (px) = N * pitch
  pitch       : f32,         // band pitch (px)
  borderW     : f32,         // full wall thickness at a boundary (px)
  gateFrac    : f32,         // (unused — gate width is per-ring in Ring.gw)
  color       : vec3<f32>,   // liquid colour (linear-ish sRGB)
  centreP     : f32,         // centre-ring pressure — liquid alpha is normalised to this
  liquidFade  : f32,         // global liquid alpha 0..1 (reset dissolve)
  ventBurst   : f32,         // outer-vent activity 0..1
  ventAngle   : f32,         // outer vent gate base angle (rad)
  shearLines  : f32,         // number of spiral shear lines = gates per ring (M)
};

struct Ring {
  phi   : f32,   // current rotation (rad)
  omega : f32,   // angular velocity (rad/s) — shimmer advection
  g0    : f32,   // gate base angle (spiral offset, at ring mid)
  shear : f32,   // within-ring shear (angle across the ring)
  fill  : f32,   // liquid fraction (pressure, uncapped)
  burst : f32,   // transfer activity 0..1
  gw    : f32,   // gate half-width as a fraction of circumference
  p7    : f32,
};

@group(0) @binding(0) var<uniform> u : Globals;
@group(0) @binding(1) var<storage, read> rings : array<Ring, 24>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var o : VSOut;
  let x = f32(i32(vi & 1u) * 4 - 1);
  let y = f32(i32(vi >> 1u) * 4 - 1);
  o.pos = vec4<f32>(x, y, 0.0, 1.0);
  o.uv  = vec2<f32>(x, y) * 0.5 + vec2<f32>(0.5);
  return o;
}

// Shortest signed angular difference a-b, wrapped to (-PI, PI].
fn wrapDelta(a : f32, b : f32) -> f32 {
  var d = a - b;
  d = d - TAU * round(d / TAU);
  return d;
}

// Coverage of the nearest of M evenly-spaced gates (0..1, 1 = fully open). The
// gate centre shears with radius about the ring mid (a ring's inlet and outlet
// lie on the same sheared slot → edges line up). `center` is the m=0 gate centre
// at this radius; M gates repeat every 2π/M. Ends square; aa ≈ 1px in angle.
fn gateHole(theta : f32, center : f32, rMid : f32, m : f32, halfAngle : f32, aa : f32) -> f32 {
  let spacing = TAU / max(m, 1.0);
  let rel = wrapDelta(theta, center);
  let ang = rel - spacing * round(rel / spacing);   // distance to the nearest gate
  let aaA = aa / rMid;
  return 1.0 - smoothstep(halfAngle - aaA, halfAngle + aaA, abs(ang));
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let res   = u.res;
  let p     = in.pos.xy - res * 0.5;
  let r     = length(p);
  let th0   = atan2(p.y, p.x);
  let theta = th0 - TAU * floor(th0 / TAU);   // [0, TAU)

  let N      = i32(u.ringCount + 0.5);
  let pitch  = u.pitch;
  let hb     = u.borderW * 0.5;
  let rOuter = u.rOuter;
  let aa     = 1.0;
  let fade   = clamp(u.liquidFade, 0.0, 1.0);

  // Background: near-black with a faint interior lift.
  var col = vec3<f32>(0.020, 0.022, 0.028);
  col += vec3<f32>(0.010, 0.012, 0.020) * (1.0 - smoothstep(0.0, rOuter, r));
  let bgCol = col;   // background behind the liquid (for the gate-fill average)

  // ---------------- LIQUID ----------------
  // No centrifugal band: pressure fills the whole channel volumetrically, and
  // brightness/opacity rises with pressure (fill) — so how loaded each ring is
  // reads directly, and empties read dark. Shimmer is advected by ω so spin
  // shows in the liquid itself.
  let k = i32(floor(r / pitch));
  if (k >= 0 && k < N && r < rOuter) {
    let ring = rings[k];
    var cov = 0.0;
    if (k == 0) {
      let rInt = pitch - hb;                        // centre core = full disc
      cov = 1.0 - smoothstep(rInt - aa, rInt + aa, r);
    } else {
      let rInCh  = f32(k) * pitch + hb;
      let rOutCh = f32(k + 1) * pitch - hb;
      cov = smoothstep(rInCh - aa, rInCh + aa, r) * (1.0 - smoothstep(rOutCh - aa, rOutCh + aa, r));
    }
    if (cov > 0.0 && ring.fill > 0.0005) {
      let shim = 0.85 + 0.15 * sin(theta * 18.0 - ring.omega * u.time * 3.0 + f32(k));
      let liqCol = u.color * (0.6 + 0.5 * shim);   // the selected colour, no white bloom
      // Alpha normalised to the CENTRE ring's pressure: the centre reads fully
      // opaque and every outer ring's transparency is proportional to its
      // pressure relative to the centre (empty ring → transparent).
      let alpha = cov * clamp(ring.fill / max(u.centreP, 1e-4), 0.0, 1.0) * fade;
      col = mix(col, liqCol, alpha);
    }
  }

  // ---------------- WALLS ----------------
  // One continuous wall band per boundary (no interior seam); each radial
  // half carries its own ring's gate. Inner half = ring (kb-1)'s outer border
  // (gate beta); outer half = ring kb's inner border (gate alpha). The
  // outermost wall (kb == N) has only its inner half — ring N-1's vent gate.
  let kb = i32(round(r / pitch));
  if (kb >= 1 && kb <= N) {
    let rb  = f32(kb) * pitch;
    let y   = r - rb;
    let yLo = -hb;
    var yHi = hb;
    if (kb == N) { yHi = 0.0; }
    if (y >= yLo - aa && y <= yHi + aa) {
      // Outer rim (kb == N): cut the band hard at r = rOuter so no faint wall
      // pixels bleed past the last ring's edge (no ghost line around the gate).
      var bandHi = 1.0 - smoothstep(yHi - aa, yHi + aa, y);
      if (kb == N) { bandHi = 1.0 - smoothstep(yHi - aa, yHi, y); }
      let band = smoothstep(yLo - aa, yLo + aa, y) * bandHi;
      if (band > 0.0) {
        // Each half-wall belongs to a ring (inner half = ring kb-1's outer
        // border, outer half = ring kb's inner border).
        var hole = 0.0;
        var owner = kb - 1;
        if (y <= 0.0) {
          // inner half = ring (kb-1)'s OUTLET (its outer border)
          let rM = (f32(kb) - 0.5) * pitch;                  // ring kb-1's mid radius
          let center = rings[kb - 1].phi + rings[kb - 1].g0 + rings[kb - 1].shear * (r - rM) / pitch;
          hole = gateHole(theta, center, rM, u.shearLines, rings[kb - 1].gw * PI, aa);
        } else if (kb < N) {
          owner = kb;
          // outer half = ring kb's INLET (its inner border)
          let rM = (f32(kb) + 0.5) * pitch;                  // ring kb's mid radius
          let center = rings[kb].phi + rings[kb].g0 + rings[kb].shear * (r - rM) / pitch;
          hole = gateHole(theta, center, rM, u.shearLines, rings[kb].gw * PI, aa);
        }
        // Walls are a uniform grey that heats up (grey → red → yellow) with how
        // fast the owning ring turns — faster rings glow hotter.
        let shade = 0.62 + 0.20 * (r / rOuter);
        let heat = clamp(abs(rings[owner].omega) / HEATMAX, 0.0, 1.0);
        var wc = mix(vec3<f32>(0.60, 0.61, 0.64), vec3<f32>(0.95, 0.25, 0.08), smoothstep(0.0, 0.5, heat));
        wc = mix(wc, vec3<f32>(1.0, 0.90, 0.50), smoothstep(0.5, 1.0, heat));
        var wallCol = wc * shade;
        wallCol += vec3<f32>(1.0, 0.85, 0.45) * (smoothstep(0.4, 1.0, heat) * heat * 0.5);   // hot glow
        col = mix(col, wallCol, band * (1.0 - hole));

        // Liquid streaming through the open gate while transfer is active. The
        // gate is filled with a MIX of the two exchanging rings' colours (inner
        // ring kb-1 and outer ring kb) — not a white flash — so you can see
        // whose liquid is crossing.
        let flow = clamp(rings[kb - 1].burst, 0.0, 1.0);
        if (flow > 0.002) {
          // Fill the open gate with the AVERAGE of the two sides' *rendered*
          // liquid (each = liquid colour over the background at that ring's
          // opacity). The result sits between the two sides, so it's never
          // brighter than either — no multiple of the colour.
          let cP    = max(u.centreP, 1e-4);
          let aIn   = clamp(rings[kb - 1].fill / cP, 0.0, 1.0);
          var aOut  = aIn;
          if (kb < N) { aOut = clamp(rings[kb].fill / cP, 0.0, 1.0); }
          let liqBase = u.color * 0.9;
          let sideIn  = mix(bgCol, liqBase, aIn);
          let sideOut = mix(bgCol, liqBase, aOut);
          let gateCol = 0.5 * (sideIn + sideOut);
          col = mix(col, gateCol, band * hole * flow * fade);
        }
      }
    }
  }

  // (The outer vent's liquid crossing is shown by the outermost wall's gate fill;
  // no additive glow streak — it read as a bright bloom.)

  return vec4<f32>(col, 1.0);
}
