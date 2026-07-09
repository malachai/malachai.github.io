// 002-yarn-pillow — a single woolen strand following a Hilbert curve wrapped
// around an invisible rounded pillow. The whole surface pattern (2-ply twist +
// fibre fuzz + rainbow) scrolls forward along the strand, so the yarn reads as
// physically advancing, endlessly. Doodle owns group(0) binding(0) (spec §16.2).

struct U {
  mvp    : mat4x4<f32>,   // projection * view * model
  model  : mat4x4<f32>,   // rotation only — transforms normals into view space
  p0     : vec4<f32>,     // x=time, y=totalLen, z=colorCycles, w=flowSpeed (units/s)
  p1     : vec4<f32>,     // x=twistCount, y=plyCount, z=fresnelAmt, w=unused
};
@group(0) @binding(0) var<uniform> u : U;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm   : vec3<f32>,
  @location(1) s     : f32,
  @location(2) coord : f32,        // position around the tube, 0..1
};

@vertex
fn vs_main(
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) arclen   : f32,
  @location(3) coord    : f32,
) -> VSOut {
  var out : VSOut;
  out.pos   = u.mvp * vec4<f32>(position, 1.0);
  out.nrm   = (u.model * vec4<f32>(normal, 0.0)).xyz;
  out.s     = arclen;
  out.coord = coord;
  return out;
}

fn hue2rgb(h : f32) -> vec3<f32> {
  let k = fract(h) * 6.0;
  let r = clamp(abs(k - 3.0) - 1.0, 0.0, 1.0);
  let g = clamp(2.0 - abs(k - 2.0), 0.0, 1.0);
  let b = clamp(2.0 - abs(k - 4.0), 0.0, 1.0);
  return vec3<f32>(r, g, b);
}

// --- cheap value-noise fbm for fibre fuzz ---
fn hash21(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let uu = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, uu.x), mix(c, d, uu.x), uu.y);
}
fn fbm(p : vec2<f32>) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    sum = sum + amp * vnoise(q);
    q = q * 2.03;
    amp = amp * 0.5;
  }
  return sum;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.nrm);
  let V = vec3<f32>(0.0, 0.0, 1.0);

  let t      = u.p0.x;
  let L      = u.p0.y;
  let cyc    = u.p0.z;
  let flowV  = u.p0.w;
  let twistN = u.p1.x;
  let ply    = u.p1.y;
  let fresA  = u.p1.z;

  // Everything is a function of sMove: the surface pattern slides forward along
  // the strand as time advances → the yarn looks like it's actually moving.
  let sMove = in.s - t * flowV;
  let c = in.coord;

  // Gradual rainbow flowing with the yarn (integer cyc ⇒ seamless at the seam).
  var base = hue2rgb(sMove / L * cyc);
  let luma = dot(base, vec3<f32>(0.333, 0.333, 0.333));
  base = mix(vec3<f32>(luma), base, 0.9);

  // 2-ply helical twist. twistN whole twists over the loop ⇒ seamless.
  let twoPi = 6.2831853;
  let plyPhase = c * ply * twoPi + (sMove / L) * twistN * twoPi;
  let groove = 0.5 + 0.5 * sin(plyPhase);
  let plyShade = mix(0.60, 1.0, smoothstep(0.0, 1.0, groove));

  // Fine fibre fuzz, stretched along the strand so it reads as loose hairs.
  let fib = fbm(vec2<f32>(c * 170.0, sMove * 22.0));
  let fluff = mix(0.70, 1.20, fib);

  // Matte two-light + ambient (wool doesn't shine much).
  let key  = normalize(vec3<f32>(0.4, 0.7, 0.6));
  let fill = normalize(vec3<f32>(-0.6, -0.3, 0.4));
  let d1 = max(dot(N, key), 0.0);
  let d2 = max(dot(N, fill), 0.0) * 0.35;
  var lit = base * (0.32 + d1 * 0.85 + d2);

  lit = lit * plyShade * fluff;

  // Fresnel halo → a fuzzy fringe of stray fibres at the silhouette.
  let fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  lit = lit + fres * fresA * (base * 0.5 + vec3<f32>(0.5, 0.5, 0.5));

  // A whisper of sheen.
  let H = normalize(key + V);
  let spec = pow(max(dot(N, H), 0.0), 16.0) * 0.05;
  lit = lit + vec3<f32>(spec, spec, spec);

  return vec4<f32>(lit, 1.0);
}
