// NNN-my-slug — fullscreen-triangle starter.
// Doodle owns group(0) binding(0) (spec.md §9).

struct U {
  p0 : vec4<f32>,   // x=width, y=height, z=time, w=dt
};
@group(0) @binding(0) var<uniform> u : U;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  // One triangle covering the screen: (-1,-1) (3,-1) (-1,3).
  var out : VSOut;
  let x = f32(i32(vi & 1u) * 4 - 1);
  let y = f32(i32(vi >> 1u) * 4 - 1);
  out.pos = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>(x, y) * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let t = u.p0.z;
  let c = 0.5 + 0.5 * cos(t + in.uv.xyx * 4.0 + vec3<f32>(0.0, 2.0, 4.0));
  return vec4<f32>(c, 1.0);
}
