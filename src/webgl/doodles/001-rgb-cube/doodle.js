// @ts-check
// 001-rgb-cube — a slowly spinning, translucent cube whose surface maps
// XYZ position to RGB colour, so you see a slice through the whole RGB space.
//
// Transparency is handled without a depth buffer by drawing in two passes:
// first the faces pointing away from the camera (cull front), then the faces
// facing it (cull back). For a convex shape that's exact far-to-near order.

// 8 cube corners, spanning [-0.5, 0.5] on each axis.
const CORNERS = new Float32Array([
  -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
  -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
]);

// 12 triangles, wound counter-clockwise as seen from outside the cube.
const INDICES = new Uint16Array([
  4, 5, 6,  4, 6, 7,   // +Z
  1, 0, 3,  1, 3, 2,   // -Z
  1, 2, 6,  1, 6, 5,   // +X
  0, 4, 7,  0, 7, 3,   // -X
  3, 6, 2,  3, 7, 6,   // +Y
  0, 1, 5,  0, 5, 4,   // -Y
]);

// --- tiny column-major mat4 helpers -----------------------------------------

function identity() {
  const o = new Float32Array(16);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}

/** result = a * b (column-major). */
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/** Right-handed perspective, clip-space depth 0..1 (WebGPU convention). */
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = far * nf;
  o[11] = -1;
  o[14] = far * near * nf;
  return o;
}

function translate(x, y, z) {
  const o = identity();
  o[12] = x;
  o[13] = y;
  o[14] = z;
  return o;
}

function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = identity();
  o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
  return o;
}

function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = identity();
  o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
  return o;
}

// ----------------------------------------------------------------------------

export default {
  meta: {
    title: "RGB Cube",
    description:
      "A slowly spinning translucent cube whose surface maps 3D position to " +
      "colour, showing the full RGB space.",
    tags: ["mesh", "3d", "color", "transparency"],
    created: "2026-07-09",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    const module = device.createShaderModule({
      code: await loadWGSL("./shader.wgsl"),
    });

    const vbuf = device.createBuffer({
      size: CORNERS.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vbuf, 0, CORNERS);

    const ibuf = device.createBuffer({
      size: INDICES.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ibuf, 0, INDICES);

    const ubuf = device.createBuffer({
      size: 64, // one mat4x4<f32>
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ],
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const blend = {
      color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const vertexBuffers = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
    ];

    const makePipeline = (cullMode) =>
      device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_main", buffers: vertexBuffers },
        fragment: { module, entryPoint: "fs_main", targets: [{ format, blend }] },
        primitive: { topology: "triangle-list", cullMode, frontFace: "ccw" },
      });

    const pipeFar = makePipeline("front");  // faces pointing away — drawn first
    const pipeNear = makePipeline("back");  // faces toward camera — drawn last

    const mvp = new Float32Array(16);

    return {
      frame({ t }) {
        const canvas = context.canvas;
        const aspect = canvas.width / Math.max(1, canvas.height);
        const proj = perspective(Math.PI / 4, aspect, 0.1, 100);
        const view = translate(0, 0, -3.0);
        const model = mul(rotY(t * 0.6), rotX(t * 0.35));
        mvp.set(mul(proj, mul(view, model)));
        device.queue.writeBuffer(ubuf, 0, mvp);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, "uint16");
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(pipeFar);
        pass.drawIndexed(INDICES.length);
        pass.setPipeline(pipeNear);
        pass.drawIndexed(INDICES.length);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },

      resize() {
        // No size-dependent resources (no depth texture); nothing to recreate.
      },

      destroy() {
        vbuf.destroy();
        ibuf.destroy();
        ubuf.destroy();
      },
    };
  },
};
