// 001-rgb-cube — map each vertex position to an RGB colour.
// Doodle owns a single uniform: the model-view-projection matrix.

struct U {
  mvp : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> u : U;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> VSOut {
  var out : VSOut;
  out.pos = u.mvp * vec4<f32>(position, 1.0);
  // Cube spans [-0.5, 0.5] on each axis; shift to [0, 1] so position == colour.
  // The origin corner is black, the opposite corner white — the full RGB cube.
  out.color = vec4<f32>(position + vec3<f32>(0.5), 0.5);
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  return in.color;
}
