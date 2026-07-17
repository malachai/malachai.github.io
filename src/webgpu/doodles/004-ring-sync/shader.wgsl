// 004-ring-sync — concentric ring machine, pure-SDF fragment.
// One fullscreen triangle + one fragment shader; the JS sim writes per-ring
// state each frame and the shader only draws. Doodle owns group(0):
//   binding(0) uniform Globals, binding(1) read-only storage array<Ring>.
// See spec.md §9. All radii here are in device pixels; the sim runs in
// normalised units (outer radius = 1) and hands over pixel radii per frame.

const PI  : f32 = 3.14159265359;
const TAU : f32 = 6.28318530718;

struct Globals {
  res         : vec2<f32>,   // framebuffer size (px)
  time        : f32,
  ringCount   : f32,         // N (3..24)
  rOuter      : f32,         // outer radius (px) = N * pitch
  pitch       : f32,         // band pitch (px)
  borderW     : f32,         // full wall thickness at a boundary (px)
  gateHalfArc : f32,         // half gate arc-length (px), constant across rings
  color       : vec3<f32>,   // liquid colour (linear-ish sRGB)
  sysPressure : f32,         // highest outer-ring pressure — global liquid alpha
  liquidFade  : f32,         // global liquid alpha 0..1 (reset dissolve)
  ventBurst   : f32,         // outer-vent activity 0..1
  ventAngle   : f32,         // world angle of the outer vent gate (rad)
  reserved0   : f32,         // (per-gate cant now carries its own sign)
};

struct Ring {
  phi     : f32,   // current rotation (rad)
  omega   : f32,   // angular velocity (rad/s) — shimmer advection
  alpha   : f32,   // inner-border gate offset (rad, added to phi)
  beta    : f32,   // outer-border gate offset (rad, added to phi)
  fill    : f32,   // liquid fraction 0..1 = pressure
  burst   : f32,   // outer-gate transfer activity 0..1
  cantIn  : f32,   // inner-gate cant magnitude (slant across the wall)
  cantOut : f32,   // outer-gate cant magnitude
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

// Hard-edged, CANTED (angled, never radial) gate opening coverage across a wall
// band. 0..1, 1 = fully open. Gate centred at world angle gc, half arc-length
// halfArc (px) at boundary radius rb. `slant` leans the slot across the wall
// thickness (dr = signed radial offset from the boundary), so the gate is angled
// to the ring — this is what lets liquid impart a tangential force. Ends stay
// square; aa is a ~1px antialias only.
fn gateHole(rb : f32, dr : f32, theta : f32, gc : f32, halfArc : f32, slant : f32, aa : f32) -> f32 {
  let arc = wrapDelta(theta, gc) * rb - slant * dr;   // slanted arc-length (px)
  return 1.0 - smoothstep(halfArc - aa, halfArc + aa, abs(arc));
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

  // ---------------- LIQUID ----------------
  // No centrifugal band: pressure fills the whole channel volumetrically, and
  // brightness/opacity rises with pressure (fill) — so how loaded each ring is
  // reads directly, and empties read dark. Shimmer is advected by ω so spin
  // shows in the liquid itself.
  let k = i32(floor(r / pitch));
  if (k >= 0 && k < N && r < rOuter) {
    let ring = rings[k];
    let pr = clamp(ring.fill, 0.0, 1.0);           // pressure = fill
    var cov = 0.0;
    if (k == 0) {
      let rInt = pitch - hb;                        // centre core = full disc
      cov = 1.0 - smoothstep(rInt - aa, rInt + aa, r);
    } else {
      let rInCh  = f32(k) * pitch + hb;
      let rOutCh = f32(k + 1) * pitch - hb;
      cov = smoothstep(rInCh - aa, rInCh + aa, r) * (1.0 - smoothstep(rOutCh - aa, rOutCh + aa, r));
    }
    if (cov > 0.0 && pr > 0.002) {
      let shim = 0.85 + 0.15 * sin(theta * 18.0 - ring.omega * u.time * 3.0 + f32(k));
      var liqCol = u.color * (0.5 + 0.6 * shim);
      // Opacity saturates at full, so over-pressure (fill > 1) reads as extra
      // white-hot brightness — a visual cue for the uncapped pressure.
      let over = max(ring.fill, 0.0);
      liqCol = mix(liqCol, vec3<f32>(1.0, 1.0, 1.0) * (0.6 + 0.3 * shim), clamp(over * over * 0.22, 0.0, 0.92));
      let gAlpha = 0.30 + 0.70 * clamp(u.sysPressure, 0.0, 1.0);
      col = mix(col, liqCol, cov * pr * gAlpha * fade);
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
      let band = smoothstep(yLo - aa, yLo + aa, y) * (1.0 - smoothstep(yHi - aa, yHi + aa, y));
      if (band > 0.0) {
        var hole = 0.0;
        if (y <= 0.0) {
          let gc = rings[kb - 1].phi + rings[kb - 1].beta;    // giver's outer gate
          hole = gateHole(rb, y, theta, gc, u.gateHalfArc, rings[kb - 1].cantOut, aa);
        } else if (kb < N) {
          let gc = rings[kb].phi + rings[kb].alpha;           // receiver's inner gate
          hole = gateHole(rb, y, theta, gc, u.gateHalfArc, rings[kb].cantIn, aa);
        }
        let shade = 0.52 + 0.16 * (r / rOuter);
        let wallCol = vec3<f32>(0.62, 0.63, 0.68) * shade;
        col = mix(col, wallCol, band * (1.0 - hole));

        // Liquid streaming through the open gate while transfer is active.
        // burst on the giver ring (kb-1) drives this whole boundary; when both
        // half-gates line up the liquid plug spans the full wall thickness.
        let flow = clamp(rings[kb - 1].burst, 0.0, 1.0);
        if (flow > 0.002) {
          var fliq = u.color * (0.85 + 0.7 * flow);
          fliq += vec3<f32>(1.0, 1.0, 1.0) * (0.22 * flow);   // hot core of the jet
          col = mix(col, fliq, band * hole * flow * fade);
        }
      }
    }
  }

  // ---------------- TRANSFER BURSTS ----------------
  // A burst lights the giver's outer gate (ring kb-1) at boundary kb.
  if (kb >= 1 && kb <= N) {
    let g = kb - 1;
    let b = rings[g].burst;
    if (b > 0.002) {
      let rb  = f32(kb) * pitch;
      let gc  = rings[g].phi + rings[g].beta;
      let arc = wrapDelta(theta, gc) * rb;
      let radial = exp(-(r - rb) * (r - rb) / (pitch * pitch * 0.28));
      let ang    = exp(-arc * arc / (u.gateHalfArc * u.gateHalfArc * 1.6));
      let e = b * radial * ang;
      col += u.color * (0.8 * e);
      col += vec3<f32>(1.0, 1.0, 1.0) * (0.35 * e * ang);
    }
  }

  // ---------------- VENT STREAK ----------------
  {
    let dr = r - rOuter;
    if (dr > -aa) {
      let arc  = wrapDelta(theta, u.ventAngle) * rOuter;
      let ang  = exp(-arc * arc / (u.gateHalfArc * u.gateHalfArc * 1.3));
      let out  = exp(-max(dr, 0.0) / (pitch * 0.9));
      col += u.color * (u.ventBurst * 1.3 * ang * out);
    }
  }

  return vec4<f32>(col, 1.0);
}
