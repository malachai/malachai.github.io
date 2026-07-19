// 003-rolling-decay — instanced floor squares + metal cubes.
//
// The doodle owns group(0): a Globals uniform, a square-instance storage
// buffer, and a cube-instance storage buffer (spec.md §9). Squares take a
// cosine-palette colour by checker parity and fade into the background as they
// sink; cubes are near-colourless metal shaded by an ANALYTIC environment
// (sky + palette-tinted ground + a few strip lights) with fresnel + specular.
// The dynamic environment-cubemap is a deliberate follow-up (this doodle's
// spec) — this is the analytic escape layer standing in for it.

struct Globals {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,   // xyz eye, w unused
  palA     : vec4<f32>,
  palB     : vec4<f32>,
  palC     : vec4<f32>,
  palD     : vec4<f32>,
  params   : vec4<f32>,   // x=sinkDist, y=mosaic, z=time, w unused
  light    : vec4<f32>,   // xyz sun dir (normalised), w intensity
};
@group(0) @binding(0) var<uniform> U : Globals;

// Square instance: (centreX, centreZ, sinkY, t).
struct SquareInst { d : vec4<f32> };
@group(0) @binding(1) var<storage, read> squares : array<SquareInst>;

// Cube instance: model matrix + tint (tint.x = opacity, used while fading out).
struct CubeInst { m : mat4x4<f32>, tint : vec4<f32> };
@group(0) @binding(2) var<storage, read> cubes : array<CubeInst>;

const TAU = 6.2831853;
const BG = vec3<f32>(0.02, 0.02, 0.024);

fn palette(t : f32) -> vec3<f32> {
  return U.palA.xyz + U.palB.xyz * cos(TAU * (U.palC.xyz * t + U.palD.xyz));
}

// -------------------------------------------------------------------- squares
struct SqOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) @interpolate(flat) t : f32,
  @location(2) @interpolate(flat) sinkY : f32,
};

@vertex
fn vs_sq(@location(0) position : vec3<f32>,
         @location(1) normal : vec3<f32>,
         @builtin(instance_index) ii : u32) -> SqOut {
  let inst = squares[ii].d;
  let world = vec3<f32>(position.x + inst.x, position.y + inst.z, position.z + inst.y);
  var out : SqOut;
  out.pos = U.viewProj * vec4<f32>(world, 1.0);
  out.nrm = normal;
  out.t = inst.w;
  out.sinkY = inst.z;
  return out;
}

@fragment
fn fs_sq(in : SqOut) -> @location(0) vec4<f32> {
  var col = palette(in.t);
  let N = normalize(in.nrm);
  let sun = normalize(U.light.xyz);
  let ndl = max(dot(N, sun), 0.0) * 0.7 + 0.3;   // soft top-light
  col = col * ndl;
  // Fade toward the background as the square descends (0 at surface, 1 sunk).
  let f = clamp(-in.sinkY / U.params.x, 0.0, 1.0);
  col = mix(col, BG, f);
  return vec4<f32>(col, 1.0);
}

// ---------------------------------------------------------------------- cubes
struct CubeOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) world : vec3<f32>,
  @location(2) @interpolate(flat) op : f32,
};

@vertex
fn vs_cube(@location(0) position : vec3<f32>,
           @location(1) normal : vec3<f32>,
           @builtin(instance_index) ii : u32) -> CubeOut {
  let m = cubes[ii].m;
  let world = m * vec4<f32>(position, 1.0);
  var out : CubeOut;
  out.pos = U.viewProj * world;
  out.nrm = (m * vec4<f32>(normal, 0.0)).xyz;   // model is rotation+translation, no scale
  out.world = world.xyz;
  out.op = cubes[ii].tint.x;
  return out;
}

// Analytic studio environment sampled along a reflected ray. Stands in for the
// dynamic cubemap: a vertical sky gradient, a palette-tinted ground below the
// horizon, and a few bright strip lights that give the metal its glints.
fn envColor(dir : vec3<f32>) -> vec3<f32> {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let skyTop = vec3<f32>(0.42, 0.52, 0.68);
  let skyBot = vec3<f32>(0.10, 0.11, 0.14);
  var c = mix(skyBot, skyTop, up);

  // Ground: rays pointing down reflect the floor. Tint by the palette average
  // (≈ palA) so the board's mood reads faintly in the metal even without the
  // real cubemap.
  let ground = U.palA.xyz * 0.55 + vec3<f32>(0.02);
  c = mix(c, ground, clamp(-dir.y * 1.6, 0.0, 1.0));

  // Three fake strip lights (directions in world space). Tight lobes → glints.
  let L0 = normalize(vec3<f32>(0.3, 0.9, 0.2));
  let L1 = normalize(vec3<f32>(-0.6, 0.5, -0.5));
  let L2 = normalize(vec3<f32>(0.1, 0.4, 0.95));
  var strips = 0.0;
  strips += pow(max(dot(dir, L0), 0.0), 220.0) * 1.6;
  strips += pow(max(dot(dir, L1), 0.0), 160.0) * 1.0;
  strips += pow(max(dot(dir, L2), 0.0), 300.0) * 1.3;
  c += vec3<f32>(strips);
  return c;
}

@fragment
fn fs_cube(in : CubeOut) -> @location(0) vec4<f32> {
  let N = normalize(in.nrm);
  let V = normalize(U.camPos.xyz - in.world);
  let R = reflect(-V, N);

  // Metal fresnel: high base reflectance, brightening at grazing angles.
  let F0 = 0.85;
  let ndv = max(dot(N, V), 0.0);
  let fres = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);

  let env = envColor(R);
  let metalTint = vec3<f32>(0.82, 0.83, 0.86);   // near-colourless chrome
  var col = env * mix(metalTint, vec3<f32>(1.0), fres);

  // A little direct Blinn-Phong so faces read even against a dim sky.
  let sun = normalize(U.light.xyz);
  let H = normalize(sun + V);
  col += vec3<f32>(pow(max(dot(N, H), 0.0), 90.0)) * 0.6 * U.light.w;
  col += metalTint * max(dot(N, sun), 0.0) * 0.05;   // faint fill

  // Gentle tonemap so the glints don't blow out hard.
  col = col / (col + vec3<f32>(0.7)) * 1.4;
  return vec4<f32>(col, in.op);
}
