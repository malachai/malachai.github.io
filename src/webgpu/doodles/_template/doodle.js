// @ts-check
// NNN-my-slug — one line on what this doodle is.
//
// Copy of doodles/_template. Fill in meta, write init(), keep the module
// scope environment-free (no top-level DOM/navigator) so tooling can import
// it in Node — see spec.md §5.

export default {
  meta: {
    title: "My Doodle",
    description: "One-liner shown on the gallery card.",
    tags: ["fragment"],
    created: "2026-01-01",
    prefersReducedMotionSafe: false,
  },

  /** @param {any} ctx */
  async init(ctx) {
    const { device, context, format, loadWGSL } = ctx;

    const module = device.createShaderModule({
      code: await loadWGSL("./shader.wgsl"),
    });

    // Doodle owns group(0) binding(0). Example: one vec4 (resolution.xy, time, dt).
    const ubuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: ubuf } }],
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const params = new Float32Array(4);

    return {
      frame({ t, dt }) {
        const canvas = context.canvas;
        params[0] = canvas.width;
        params[1] = canvas.height;
        params[2] = t;
        params[3] = dt;
        device.queue.writeBuffer(ubuf, 0, params);

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
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3); // fullscreen triangle
        pass.end();
        device.queue.submit([encoder.finish()]);
      },

      resize({ width, height, dpr }) {
        // Recreate size-dependent resources (e.g. a depth texture) here.
      },

      destroy() {
        ubuf.destroy();
      },
    };
  },
};
