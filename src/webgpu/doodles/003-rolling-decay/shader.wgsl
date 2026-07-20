// 003-rolling-decay — stamped floor tiles + metal solids.
//
// The doodle owns group(0): a Globals uniform and a solid-instance storage
// buffer (spec.md §9). Each solid is assigned one palette colour for its whole
// life; the tiles it stamps carry that colour (with a faint per-tile jitter),
// and the solid itself is metal tinted by it. The dynamic environment-cubemap
// is a deliberate follow-up; reflections here are the analytic layer only.

struct Globals {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,   // xyz eye
  envTint  : vec4<f32>,   // xyz = palette average, for the analytic ground tone
  params   : vec4<f32>,   // x=clearDrop, z=time
  light    : vec4<f32>,   // xyz sun dir (normalised), w intensity
};
@group(0) @binding(0) var<uniform> U : Globals;

// Solid instance: model matrix + tint (x=opacity, y=explode push) + colour.
struct SolidInst { m : mat4x4<f32>, tint : vec4<f32>, color : vec4<f32> };
@group(0) @binding(1) var<storage, read> solids : array<SolidInst>;

const BG = vec3<f32>(0.02, 0.02, 0.024);

// --------------------------------------------------------------------- tiles
struct TileOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) @interpolate(flat) col : vec3<f32>,
  @location(1) worldY : f32,
};

@vertex
fn vs_tile(@location(0) position : vec3<f32>, @location(1) color : vec3<f32>) -> TileOut {
  var out : TileOut;
  out.pos = U.viewProj * vec4<f32>(position, 1.0);
  out.col = color;
  out.worldY = position.y;
  return out;
}

@fragment
fn fs_tile(in : TileOut) -> @location(0) vec4<f32> {
  let sun = normalize(U.light.xyz);
  let ndl = max(dot(vec3<f32>(0.0, 1.0, 0.0), sun), 0.0) * 0.7 + 0.3;   // flat top-light
  var col = in.col * ndl;
  let f = clamp(-in.worldY / U.params.x, 0.0, 1.0);   // fade as it drops on clear
  col = mix(col, BG, f);
  return vec4<f32>(col, 1.0);
}

// --------------------------------------------------------------------- solids
struct SolidOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) world : vec3<f32>,
  @location(2) @interpolate(flat) op : f32,
  @location(3) @interpolate(flat) col : vec3<f32>,
};

@vertex
fn vs_solid(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>, @builtin(instance_index) ii : u32) -> SolidOut {
  let m = solids[ii].m;
  // tint.y = explode push: shove each face outward along its own normal so the
  // solid bursts into its faces as it dies.
  let local = position + normal * solids[ii].tint.y;
  let world = m * vec4<f32>(local, 1.0);
  var out : SolidOut;
  out.pos = U.viewProj * world;
  out.nrm = (m * vec4<f32>(normal, 0.0)).xyz;
  out.world = world.xyz;
  out.op = solids[ii].tint.x;
  out.col = solids[ii].color.xyz;
  return out;
}

fn envColor(dir : vec3<f32>) -> vec3<f32> {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  var c = mix(vec3<f32>(0.10, 0.11, 0.14), vec3<f32>(0.42, 0.52, 0.68), up);
  c = mix(c, U.envTint.xyz * 0.55 + vec3<f32>(0.02), clamp(-dir.y * 1.6, 0.0, 1.0));
  let L0 = normalize(vec3<f32>(0.3, 0.9, 0.2));
  let L1 = normalize(vec3<f32>(-0.6, 0.5, -0.5));
  let L2 = normalize(vec3<f32>(0.1, 0.4, 0.95));
  var strips = 0.0;
  strips += pow(max(dot(dir, L0), 0.0), 220.0) * 1.6;
  strips += pow(max(dot(dir, L1), 0.0), 160.0) * 1.0;
  strips += pow(max(dot(dir, L2), 0.0), 300.0) * 1.3;
  return c + vec3<f32>(strips);
}

@fragment
fn fs_solid(in : SolidOut) -> @location(0) vec4<f32> {
  let N = normalize(in.nrm);
  let V = normalize(U.camPos.xyz - in.world);
  let R = reflect(-V, N);
  let F0 = 0.7;
  let ndv = max(dot(N, V), 0.0);
  let fres = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  // Coloured metal: reflectance tinted by the solid's assigned colour, going
  // white at grazing angles (fresnel).
  let tint = mix(in.col, vec3<f32>(1.0), fres);
  var col = envColor(R) * tint;
  let sun = normalize(U.light.xyz);
  let H = normalize(sun + V);
  col += vec3<f32>(pow(max(dot(N, H), 0.0), 90.0)) * 0.6 * U.light.w;
  col += in.col * max(dot(N, sun), 0.0) * 0.12;   // faint diffuse fill in its colour
  col = col / (col + vec3<f32>(0.7)) * 1.4;
  return vec4<f32>(col, in.op);
}
