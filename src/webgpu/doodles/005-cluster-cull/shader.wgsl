// 005-cluster-cull — generative composition machine, pure-SDF fragment.
//
// One fullscreen triangle + one fragment shader; the JS side does the throw,
// the union-find cull and the whole animation clock, then writes a per-shape
// record each frame and the shader only draws. Doodle owns group(0):
//   binding(0) uniform Globals, binding(1) read-only storage array<Shape>.
// See ../../spec.md §9.
//
// COORDINATE SPACE. All geometry is in "n-units": normalised, centred, scaled
// by the viewport's min dimension. A fragment at pixel `fc` maps to
//   qn = (fc - res*0.5) / minDim,   minDim = min(res.x, res.y).
// Shape centres/sizes live in the same n-units; stroke half-width arrives in
// pixels and is divided by minDim here. This makes the piece resolution- and
// (via the throw) aspect-relative, so resize() is a no-op.
//
// SDF NOTE. The seven shape SDFs are duplicated in doodle.js (connectivity).
// The two copies MUST agree — same canonical unit vertices, same maths. Any
// edit here edits there. Canonical shapes all have bounding radius 1, so a
// record's `size` is its bounding radius in n-units.

const PI  : f32 = 3.14159265359;
const TAU : f32 = 6.28318530718;

// Casualty ink→grey as it dies (see Shape.tint).
const GREY : vec3<f32> = vec3<f32>(0.34, 0.35, 0.40);

struct Globals {
  // p0: res.xy, time, shapeCount (live record count)
  p0 : vec4<f32>,
  // p1: fuse (0 scatter → 1 fused survivors), globalFade, glow, pad
  p1 : vec4<f32>,
  // ink.rgb (outline colour), pad
  ink : vec4<f32>,
};

// One thrown shape. All scalars (align 4); stride 48 B, a multiple of 16.
struct Shape {
  kind       : f32,   // 0 circle 1 square 2 triangle 3 oval 4 star 5 trapezoid 6 parallelogram
  cx         : f32,   // centre (n-units, centred)
  cy         : f32,
  size       : f32,   // bounding radius (n-units)
  cosR       : f32,   // rotation
  sinR       : f32,
  strokeHalf : f32,   // half stroke width (px)
  scale      : f32,   // animated size multiplier (pop-in / casualty shrink)
  alpha      : f32,   // individual-outline opacity (pop-in / casualty fade)
  tint       : f32,   // 0 ink … 1 grey (casualty death colour)
  surv       : f32,   // 1 = survivor (feeds the union), 0 = casualty
  pad        : f32,
};

@group(0) @binding(0) var<uniform> u : Globals;
@group(0) @binding(1) var<storage, read> shapes : array<Shape, 64>;

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

// ---- polygon SDF (iq): exact signed distance to a simple polygon ----------
// Works for convex and non-convex (the star) alike. `n` ≤ 10 vertices used.
fn sdPoly(p : vec2<f32>, v : ptr<function, array<vec2<f32>, 10>>, n : i32) -> f32 {
  var d = dot(p - (*v)[0], p - (*v)[0]);
  var s = 1.0;
  var j = n - 1;
  for (var i = 0; i < n; i = i + 1) {
    let vi = (*v)[i];
    let vj = (*v)[j];
    let e = vj - vi;
    let w = p - vi;
    let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    let c = vec3<bool>(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(!c)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

// Approximate ellipse SDF (near-exact at the boundary — plenty for a thin
// stroke). Sign is correct everywhere inside/outside, so it is safe for the
// connectivity inside-test too (mirrored in JS).
fn sdEllipse(p : vec2<f32>, ab : vec2<f32>) -> f32 {
  let k1 = length(p / ab);
  let k2 = length(p / (ab * ab));
  return k1 * (k1 - 1.0) / max(k2, 1e-6);
}

// Canonical unit SDF for a shape kind, evaluated in the shape's local frame.
// All canonical shapes have bounding radius 1. Vertices below are byte-for-byte
// the same as SHAPES[] in doodle.js.
fn shapeSDF(kind : i32, q : vec2<f32>) -> f32 {
  if (kind == 0) { return length(q) - 1.0; }                 // circle
  if (kind == 3) { return sdEllipse(q, vec2<f32>(1.0, 0.62)); } // oval

  var v : array<vec2<f32>, 10>;
  var n = 0;
  if (kind == 1) {                                            // square
    v[0] = vec2<f32>( 0.70710678,  0.70710678);
    v[1] = vec2<f32>(-0.70710678,  0.70710678);
    v[2] = vec2<f32>(-0.70710678, -0.70710678);
    v[3] = vec2<f32>( 0.70710678, -0.70710678);
    n = 4;
  } else if (kind == 2) {                                     // triangle
    v[0] = vec2<f32>( 0.0,        1.0);
    v[1] = vec2<f32>(-0.86602540, -0.5);
    v[2] = vec2<f32>( 0.86602540, -0.5);
    n = 3;
  } else if (kind == 4) {                                     // star (5-point)
    v[0] = vec2<f32>( 0.0,         1.0);
    v[1] = vec2<f32>(-0.24686980,  0.33978710);
    v[2] = vec2<f32>(-0.95105650,  0.30901700);
    v[3] = vec2<f32>(-0.39944370, -0.12978710);
    v[4] = vec2<f32>(-0.58778530, -0.80901700);
    v[5] = vec2<f32>( 0.0,        -0.42);
    v[6] = vec2<f32>( 0.58778530, -0.80901700);
    v[7] = vec2<f32>( 0.39944370, -0.12978710);
    v[8] = vec2<f32>( 0.95105650,  0.30901700);
    v[9] = vec2<f32>( 0.24686980,  0.33978710);
    n = 10;
  } else if (kind == 5) {                                     // trapezoid
    v[0] = vec2<f32>( 0.86602540, -0.5);
    v[1] = vec2<f32>( 0.45,        0.5);
    v[2] = vec2<f32>(-0.45,        0.5);
    v[3] = vec2<f32>(-0.86602540, -0.5);
    n = 4;
  } else {                                                    // parallelogram (6)
    v[0] = vec2<f32>(-0.55889100, -0.46574300);
    v[1] = vec2<f32>( 0.55889100, -0.46574300);
    v[2] = vec2<f32>( 0.88491100,  0.46574300);
    v[3] = vec2<f32>(-0.23287100,  0.46574300);
    n = 4;
  }
  return sdPoly(q, &v, n);
}

// Signed distance (n-units) to shape i's outline at pixel-space point qn.
fn shapeDist(i : i32, qn : vec2<f32>) -> f32 {
  let s = shapes[i];
  let sz = s.size * s.scale;
  let rel = qn - vec2<f32>(s.cx, s.cy);
  // rotate by -θ into the shape's local frame
  let local = vec2<f32>( s.cosR * rel.x + s.sinR * rel.y,
                        -s.sinR * rel.x + s.cosR * rel.y);
  return sz * shapeSDF(i32(s.kind + 0.5), local / max(sz, 1e-5));
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let res    = u.p0.xy;
  let minDim = min(res.x, res.y);
  let qn     = (in.pos.xy - res * 0.5) / minDim;

  let count  = i32(u.p0.w + 0.5);
  let fuse   = clamp(u.p1.x, 0.0, 1.0);
  let gFade  = clamp(u.p1.y, 0.0, 1.0);
  let glow   = u.p1.z;
  let ink    = u.ink.rgb;
  let aa     = 1.2 / minDim;

  // Near-black background with a faint centre lift.
  var col = vec3<f32>(0.021, 0.023, 0.030);
  col += vec3<f32>(0.010, 0.011, 0.017) * (1.0 - smoothstep(0.0, 0.9, length(qn)));

  var survIndiv = 0.0;    // survivors' individual-outline coverage (max)
  var dU        = 1e30;   // union: nearest survivor signed distance
  var wArg      = 0.004;  // stroke half-width (n-units) of the union argmin
  var glowAcc   = 0.0;    // soft halo accumulator (nearest survivor line)

  for (var i = 0; i < count; i = i + 1) {
    let s = shapes[i];
    let sz = s.size * s.scale;
    if (sz < 1e-5 || s.alpha < 0.002) { continue; }

    let d  = shapeDist(i, qn);
    let wN = max(s.strokeHalf, 0.5) / minDim;      // stroke half-width, n-units
    let band = 1.0 - smoothstep(wN - aa, wN + aa, abs(d));

    if (s.surv > 0.5) {
      survIndiv = max(survIndiv, band * s.alpha);
      if (d < dU) { dU = d; wArg = wN; }
      glowAcc = max(glowAcc, exp(-abs(d) * minDim * 0.03));
    } else {
      // Casualty: composite its (greying, fading) individual outline now.
      let cc = mix(ink, GREY, s.tint);
      col = mix(col, cc, band * s.alpha * gFade);
    }
  }

  // Survivors crossfade from individual outlines to the boolean-union outline.
  // At fuse=1 interior segments go deeply negative under the min and vanish.
  let unionCov = 1.0 - smoothstep(wArg - aa, wArg + aa, abs(dU));
  let survCov  = mix(survIndiv, unionCov, fuse);

  col = mix(col, ink, survCov * gFade);

  // Mild glow: a slight self-bloom on the ink plus a broad soft halo.
  col += ink * survCov * 0.14 * gFade;
  col += ink * glowAcc * glow * mix(0.35, 1.0, fuse) * gFade;

  return vec4<f32>(col, 1.0);
}
