# 001-rgb-cube — RGB Cube

- **Status:** live
- **Created:** 2026-07-09
- **Tags:** mesh, 3d, color, transparency

## Intent

A slowly spinning translucent cube whose surface maps 3D position directly to
RGB colour — a literal slice through the RGB colour space. Calm, minimal, and
deliberately simple: this was the bring-up doodle that established the shared
runtime (`lib/gpu.js`, `lib/loop.js`, `lib/support.js`) and the standalone
bootstrap shape.

## How it works

- **Geometry:** 8 corners spanning [-0.5, 0.5]³, 12 CCW-wound triangles,
  uint16 indices.
- **Colour:** the vertex shader shifts position by +0.5 so position == colour;
  the origin corner is black, the opposite corner white. Alpha 0.5 for the
  translucency.
- **Transparency without a depth buffer:** two render passes over the same
  geometry — first `cullMode: "front"` (faces pointing away), then
  `cullMode: "back"` (faces toward the camera). For a convex shape that's
  exact far-to-near ordering, so no depth attachment is needed. Blend is
  standard `src-alpha / one-minus-src-alpha`.
- **Uniform:** a single 64-byte `mat4x4<f32>` MVP at `group(0) binding(0)`,
  rewritten each frame (rotY(t·0.6) · rotX(t·0.35), camera at z = -3,
  45° perspective, depth 0..1 WebGPU convention).
- **Matrix math:** tiny hand-rolled column-major mat4 helpers in `doodle.js`
  (identity/mul/perspective/translate/rotX/rotY).

## Control surface

None beyond the contract — `frame` / `resize` / `destroy` only. `resize` is a
no-op (no size-dependent resources). The standalone page wires only the shared
pause/play button.

## Implementation notes

- `destroy()` releases the vertex, index, and uniform buffers.
- Aspect ratio is read from `context.canvas` each frame rather than cached in
  `resize`, which is why the resize no-op is safe.
- The two-pass convex trick only works because the cube is convex — anything
  self-occluding needs a real depth buffer (overarching spec §11; see 002).

## Ideas

- `thumb.png` still to be captured (owner).
- Could expose spin speed / alpha as instance methods, but the piece works
  fine as a fixed meditation.
